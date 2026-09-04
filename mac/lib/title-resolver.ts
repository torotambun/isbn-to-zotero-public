import { normalized, reconcileRecords, tokenSimilarity } from "./resolver";
import type { BookSearchInput, Resolution, SourceRecord, SourceStatus } from "./types";

const SOURCE_NAMES = ["Indonesia OneSearch", "Open Library", "Google Books"];

function clean(value: unknown): string {
  return String(value ?? "").replaceAll("\0", "").trim().replace(/\s+/g, " ");
}

function sourceError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return /internal error|fetch failed|aborted|aborterror/i.test(message)
    ? "Source connection unavailable"
    : message;
}

function unique(values: Iterable<unknown>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = clean(raw);
    const key = value.toLocaleLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function inBatches<T, R>(values: T[], size: number, run: (value: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let index = 0; index < values.length; index += size) {
    results.push(...(await Promise.allSettled(values.slice(index, index + size).map(run))));
  }
  return results;
}

function emptyRecord(source: string, sourceID: string, sourceURL: string, title: string): SourceRecord {
  return {
    source,
    source_id: sourceID,
    source_url: sourceURL,
    title,
    subtitle: "",
    authors: [],
    editors: [],
    translators: [],
    publisher: "",
    place: "",
    date: "",
    edition: "",
    series: "",
    series_number: "",
    volume: "",
    number_of_volumes: "",
    num_pages: "",
    extent: "",
    languages: [],
    isbns: [],
    subjects: [],
    abstract: "",
    notes: [],
  };
}

async function fetchText(url: string, accept = "text/plain,*/*"): Promise<string> {
  const response = await fetch(url, {
    headers: { Accept: accept },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("Source rate limit reached");
    if (response.status === 404) throw new Error("No record at this source");
    throw new Error(`HTTP ${response.status} from source`);
  }
  return response.text();
}

async function fetchJSON(url: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await fetchText(url, "application/json"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Source returned malformed JSON");
  }
  return value as Record<string, unknown>;
}

function decodeXML(value: string): string {
  return value
    .trim()
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function rssLinks(xml: string): string[] {
  if (!/<(?:rss|channel)\b/i.test(xml)) throw new Error("Source returned malformed XML");
  const links: string[] = [];
  for (const item of xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []) {
    const match = item.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const link = match ? clean(decodeXML(match[1])) : "";
    if (link && !links.includes(link)) links.push(link);
  }
  return links;
}

function parseEndNote(text: string): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  let current = "";
  for (const rawLine of text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    const match = rawLine.match(/^%(.?)\s+(.*)$/);
    if (match) {
      current = match[1];
      (fields[current] ??= []).push(clean(match[2]));
    } else if (current && /^[ \t]/.test(rawLine)) {
      const values = fields[current];
      values[values.length - 1] = clean(`${values.at(-1)} ${rawLine}`);
    }
  }
  return fields;
}

function titleScore(query: BookSearchInput, record: SourceRecord): number {
  const queryTitle = normalized(query.title);
  const recordTitle = normalized(record.title);
  const similarity = tokenSimilarity(queryTitle, recordTitle);
  const exact = queryTitle === recordTitle ? 30 : 0;
  const contained = queryTitle.includes(recordTitle) || recordTitle.includes(queryTitle) ? 12 : 0;
  let score = similarity * 100 + exact + contained;
  if (query.author) {
    const authorText = record.authors.join(" ");
    score += tokenSimilarity(query.author, authorText) * 24;
  }
  if (query.publisher) score += tokenSimilarity(query.publisher, record.publisher) * 12;
  if (query.year && record.date.match(/\b\d{4}\b/)?.[0] === query.year) score += 16;
  return score;
}

function plausible(query: BookSearchInput, record: SourceRecord): boolean {
  const left = normalized(query.title);
  const right = normalized(record.title);
  if (!left || !right) return false;
  if (left === right) return true;
  if ((left.includes(right) || right.includes(left)) && Math.min(left.length, right.length) / Math.max(left.length, right.length) >= 0.55) {
    return true;
  }
  return tokenSimilarity(left, right) >= 0.58;
}

async function searchOneSearch(query: BookSearchInput): Promise<{ records: SourceRecord[]; status: SourceStatus }> {
  const errors: string[] = [];
  const links: string[] = [];
  const rssRequests = await Promise.allSettled(["Title", "AllFields"].map(async (type) => {
    const params = new URLSearchParams({ lookfor: query.title, type, view: "rss", limit: "50" });
    return rssLinks(await fetchText(`https://onesearch.id/Search/Results?${params}`, "application/rss+xml, application/xml"));
  }));
  for (const result of rssRequests) {
    if (result.status === "rejected") {
      errors.push(sourceError(result.reason));
      continue;
    }
    for (const link of result.value) if (!links.includes(link)) links.push(link);
  }
  const records: SourceRecord[] = [];
  const exports = await inBatches(links.slice(0, 35), 6, async (link) => ({
    link,
    fields: parseEndNote(await fetchText(`${link.replace(/\/+$/, "")}/Export?style=EndNote`, "application/x-endnote-refer, text/plain")),
  }));
  for (const result of exports) {
    if (result.status === "rejected") {
      errors.push(sourceError(result.reason));
      continue;
    }
    const { link, fields } = result.value;
    try {
      const title = clean(fields.T?.[0]);
      if (!title) continue;
      let publisher = clean(fields.I?.[0]);
      let place = clean(fields.C?.[0]);
      let date = clean(fields.D?.[0]);
      const imprint = publisher.match(/^(.+?)\s*:\s*(.+?)\s*,\s*(\d{4})$/);
      if (imprint) {
        place ||= clean(imprint[1]);
        publisher = clean(imprint[2]);
        date ||= imprint[3];
      }
      const extent = (fields["0"] ?? [])
        .map((value) => value.replace(/^Other\s*:\s*/i, ""))
        .filter((value) => /\b(?:hlm|halaman|pages?|pg)\b/i.test(value))
        .sort((a, b) => b.length - a.length)[0] ?? "";
      const record = {
        ...emptyRecord("Indonesia OneSearch", link.replace(/\/+$/, "").split("/").at(-1) ?? link, link, title),
        authors: unique(fields.A ?? []),
        editors: unique(fields.E ?? []),
        publisher,
        place,
        date,
        edition: clean(fields["7"]?.[0]),
        extent,
        isbns: unique(fields["@"] ?? []),
        subjects: unique(fields.K ?? []),
        abstract: clean((fields.X ?? []).join(" ")),
        notes: unique(fields.N ?? []),
      } satisfies SourceRecord;
      if (plausible(query, record)) records.push(record);
    } catch (error) {
      errors.push(sourceError(error));
    }
  }
  records.sort((a, b) => titleScore(query, b) - titleScore(query, a));
  return {
    records: records.slice(0, 25),
    status: {
      source: "Indonesia OneSearch",
      ok: records.length > 0 || errors.length === 0,
      records: records.length,
      message: records.length ? (errors.length ? "Some catalogue requests failed; matches were retained." : "") : errors[0] ?? "No matching title record",
    },
  };
}

async function searchOpenLibrary(query: BookSearchInput): Promise<{ records: SourceRecord[]; status: SourceStatus }> {
  try {
    const params = new URLSearchParams({ title: query.title, limit: "30" });
    if (query.author) params.set("author", query.author);
    const payload = await fetchJSON(`https://openlibrary.org/search.json?${params}`);
    const records: SourceRecord[] = [];
    for (const raw of asArray(payload.docs)) {
      const data = asObject(raw);
      const title = clean(data.title);
      const key = clean(data.key);
      if (!title || !key) continue;
      const record = emptyRecord("Open Library", key.split("/").at(-1) ?? key, `https://openlibrary.org${key}`, title);
      record.subtitle = clean(data.subtitle);
      record.authors = unique(asArray(data.author_name));
      record.publisher = unique(asArray(data.publisher)).find((value) => !query.publisher || tokenSimilarity(value, query.publisher) > 0.5) ?? unique(asArray(data.publisher))[0] ?? "";
      const publishYears = asArray(data.publish_year).map(String);
      record.date = query.year && publishYears.includes(query.year) ? query.year : "";
      record.num_pages = clean(data.number_of_pages_median);
      record.languages = unique(asArray(data.language));
      record.isbns = unique(asArray(data.isbn));
      record.subjects = unique(asArray(data.subject).slice(0, 15));
      record.notes = ["Open Library supplied a work-level search result. Confirm the physical edition before import."];
      if (plausible(query, record)) records.push(record);
    }
    records.sort((a, b) => titleScore(query, b) - titleScore(query, a));
    return { records: records.slice(0, 20), status: { source: "Open Library", ok: true, records: records.length, message: records.length ? "" : "No matching title record" } };
  } catch (error) {
    return { records: [], status: { source: "Open Library", ok: false, records: 0, message: sourceError(error) } };
  }
}

async function searchGoogleBooks(query: BookSearchInput): Promise<{ records: SourceRecord[]; status: SourceStatus }> {
  try {
    const terms = [`intitle:${query.title}`];
    if (query.author) terms.push(`inauthor:${query.author}`);
    const params = new URLSearchParams({ q: terms.join(" "), maxResults: "40", projection: "full" });
    const payload = await fetchJSON(`https://www.googleapis.com/books/v1/volumes?${params}`);
    const records: SourceRecord[] = [];
    for (const raw of asArray(payload.items)) {
      const item = asObject(raw);
      const info = asObject(item.volumeInfo);
      const id = clean(item.id);
      const title = clean(info.title);
      if (!id || !title) continue;
      const record = emptyRecord("Google Books", id, `https://books.google.com/books?id=${encodeURIComponent(id)}`, title);
      record.subtitle = clean(info.subtitle);
      record.authors = unique(asArray(info.authors));
      record.publisher = clean(info.publisher);
      record.date = clean(info.publishedDate);
      record.num_pages = clean(info.pageCount);
      record.languages = unique([info.language]);
      record.isbns = unique(asArray(info.industryIdentifiers).map((entry) => asObject(entry).identifier));
      record.subjects = unique(asArray(info.categories));
      record.abstract = clean(info.description);
      if (plausible(query, record)) records.push(record);
    }
    records.sort((a, b) => titleScore(query, b) - titleScore(query, a));
    return { records: records.slice(0, 20), status: { source: "Google Books", ok: true, records: records.length, message: records.length ? "" : "No matching title record" } };
  } catch (error) {
    return { records: [], status: { source: "Google Books", ok: false, records: 0, message: sourceError(error) } };
  }
}

export async function resolveByTitle(rawInput: Partial<BookSearchInput>): Promise<Resolution> {
  const query: BookSearchInput = {
    title: clean(rawInput.title).slice(0, 300),
    author: clean(rawInput.author).slice(0, 200),
    publisher: clean(rawInput.publisher).slice(0, 200),
    year: clean(rawInput.year).slice(0, 20),
  };
  if (query.title.length < 3) throw new Error("Enter at least three title characters from the physical book.");
  if (query.year && !/^\d{4}$/.test(query.year)) throw new Error("Enter a four-digit publication year or leave it blank.");

  const settled = await Promise.all([searchOneSearch(query), searchOpenLibrary(query), searchGoogleBooks(query)]);
  const statuses = settled.map((entry) => entry.status);
  const records = settled.flatMap((entry) => entry.records);
  const deduplicated = records.filter((record, index) => records.findIndex((candidate) => candidate.source === record.source && candidate.source_id === record.source_id) === index);
  deduplicated.sort((a, b) => titleScore(query, b) - titleScore(query, a));
  const choices = reconcileRecords(deduplicated.slice(0, 50), normalized(`${query.title}|${query.author}|${query.publisher}|${query.year}`), [], "catalogue");
  const titleCount = new Set(choices.map((choice) => choice.title_cluster_id)).size;
  let state: Resolution["state"] = "review";
  let stateMessage = "Catalogue candidates were found. Match the physical title and copyright pages before selecting one.";
  if (!choices.length && statuses.every((status) => !status.ok)) {
    state = "source_unavailable";
    stateMessage = "The catalogues could not be reached. This is not evidence that the book has no catalogue record. Try again later or use verified manual entry.";
  } else if (!choices.length) {
    state = "not_found";
    stateMessage = "No plausible catalogue record was found. Use verified manual entry from the physical book.";
  } else if (titleCount > 1) {
    state = "ambiguous_title";
    stateMessage = "The search returned different titles or title variants. Match the physical title page.";
  } else if (choices.length > 1) {
    state = "multiple_editions";
    stateMessage = "Several editions or printings may be represented. Match the copyright page.";
  }
  return {
    raw_input: query.title,
    valid: true,
    isbn10: null,
    isbn13: null,
    canonical: null,
    validation_message: "Title search completed without assuming an ISBN.",
    source_statuses: statuses.length ? statuses : SOURCE_NAMES.map((source) => ({ source, ok: false, records: 0, message: "Source unavailable" })),
    records: deduplicated,
    choices,
    state,
    state_message: stateMessage,
    recommended_choice_id: null,
  };
}
