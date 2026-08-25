import { equivalentISBN, validISBNs } from "./isbn.ts";
import { splitManifestationStatement } from "./manifestation.ts";
import { FetchError, RequestPacer, applicationUserAgent, fetchJSON, fetchText, mapLimit } from "./network.ts";
import { sourceRecord, type ISBNInfo, type SourceRecord, type SourceResult } from "./types.ts";

const LANGUAGES: Record<string, string> = {
  id: "Indonesian",
  ind: "Indonesian",
  en: "English",
  eng: "English",
  jv: "Javanese",
  jav: "Javanese",
  ms: "Malay",
  msa: "Malay",
  may: "Malay",
};

export interface SourceAdapter {
  name: string;
  search(isbn: ISBNInfo): Promise<SourceResult>;
}

interface Pacer {
  wait(): Promise<void>;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function clean(value: unknown): string {
  return String(value ?? "").replaceAll("\0", "").trim().replace(/\s+/g, " ");
}

export function unique(values: Iterable<unknown>): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = clean(raw);
    const marker = value.toLocaleLowerCase();
    if (value && !seen.has(marker)) {
      seen.add(marker);
      output.push(value);
    }
  }
  return output;
}

function language(value: unknown): string {
  const cleaned = clean(value);
  return LANGUAGES[cleaned.toLocaleLowerCase()] ?? cleaned;
}

function dictText(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) return clean((value as JsonObject).value);
  return clean(value);
}

function authorsFromByStatement(value: unknown): string[] {
  const statement = clean(value);
  if (!statement) return [];
  let head = statement.split(";", 1)[0];
  if (/\b(?:editor|edited|penyunting|penerjemah|translator|kata pengantar)\b/i.test(head)) return [];
  head = head.replace(/^(?:oleh|by)\s+/i, "");
  const pieces = head.split(/\s+(?:dan|and)\s+|\s*&\s*/i);
  if (pieces.length < 2) return [];
  const authors = pieces.map(piece => clean(piece).replace(/^(?:Dr\.?|Prof\.?)\s+/i, "")).filter(Boolean);
  return authors.length >= 2 && authors.length <= 6 ? authors : [];
}

function recordMatches(recordISBNs: string[], wanted: ISBNInfo): boolean {
  return recordISBNs.some(value => equivalentISBN(value, wanted.canonical));
}

function decodeXML(value: string): string {
  const stripped = value.trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1");
  return stripped
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#(\d+);/g, (_match, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

function rssLinks(xml: string): string[] {
  if (!/<(?:rss|channel)\b/i.test(xml)) throw new FetchError("", "Source returned malformed XML");
  const output: string[] = [];
  for (const item of xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []) {
    const match = item.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const link = match ? clean(decodeXML(match[1])) : "";
    if (link) output.push(link);
  }
  return output;
}

export class IndonesiaOneSearch implements SourceAdapter {
  readonly name = "Indonesia OneSearch";
  readonly baseURL = "https://onesearch.id";
  readonly maxRecords: number;
  readonly pacer: Pacer;

  constructor(maxRecords = 8, pacer: Pacer = new RequestPacer(1_000)) {
    this.maxRecords = maxRecords;
    this.pacer = pacer;
  }

  async search(isbn: ISBNInfo): Promise<SourceResult> {
    const links: string[] = [];
    const errors: string[] = [];
    const formResults = await Promise.all(isbn.searchForms.map(form => this.searchForm(form)));
    for (const result of formResults) {
      errors.push(...result.errors);
      for (const link of result.links) if (!links.includes(link)) links.push(link);
    }

    const selected = links.slice(0, this.maxRecords);
    const records: SourceRecord[] = [];
    if (selected.length) {
      const fetched = await mapLimit(selected, 8, async link => {
        try {
          return { link, record: await this.fetchRecord(link, isbn), error: "" };
        } catch (error) {
          return { link, record: null, error: error instanceof Error ? error.message : String(error) };
        }
      });
      for (const result of fetched) {
        if (result.error) errors.push(result.error);
        if (result.record) records.push(result.record);
      }
      const order = new Map(selected.map((link, index) => [link, index]));
      records.sort((left, right) => (order.get(left.source_url) ?? selected.length) - (order.get(right.source_url) ?? selected.length));
    }

    if (records.length) {
      return {
        records,
        status: {
          source: this.name,
          ok: true,
          records: records.length,
          message: errors.length ? `${errors.length} catalogue request(s) failed; usable records were retained.` : "",
        },
      };
    }
    if (errors.length) {
      return { records: [], status: { source: this.name, ok: false, records: 0, message: errors[0] } };
    }
    return {
      records: [],
      status: { source: this.name, ok: true, records: 0, message: "No matching catalogue record" },
    };
  }

  private async searchForm(form: string): Promise<{ links: string[]; errors: string[] }> {
    const errors: string[] = [];
    for (const searchType of ["ISN", "AllFields"]) {
      const query = new URLSearchParams({ lookfor: form, type: searchType, view: "rss", limit: "50" });
      const url = `${this.baseURL}/Search/Results?${query}`;
      try {
        await this.pacer.wait();
        const xml = await fetchText(url, "application/rss+xml, application/xml");
        const links = rssLinks(xml);
        if (links.length) return { links, errors };
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    return { links: [], errors };
  }

  private async fetchRecord(link: string, wanted: ISBNInfo): Promise<SourceRecord | null> {
    const exportURL = `${link.replace(/\/+$/, "")}/Export?style=EndNote`;
    await this.pacer.wait();
    const text = await fetchText(exportURL, "application/x-endnote-refer, text/plain");
    const fields = IndonesiaOneSearch.parseEndNote(text);
    const isbnValues = validISBNs(fields["@"] ?? []);
    if (!recordMatches(isbnValues, wanted)) return null;

    let publisher = clean(fields.I?.[0]);
    let place = clean(fields.C?.[0]);
    let date = clean(fields.D?.[0]);
    const imprint = publisher.match(/^(.+?)\s*:\s*(.+?)\s*,\s*(\d{4})$/);
    if (imprint) {
      place = place || clean(imprint[1]);
      publisher = clean(imprint[2]);
      date = date || imprint[3];
    }

    const extents = (fields["0"] ?? [])
      .map(value => value.replace(/^Other\s*:\s*/i, "").trim())
      .filter(value => /\b(?:hlm|halaman|pages?|pg)\b/i.test(value));
    const extent = extents.sort((left, right) => right.length - left.length)[0] ?? "";
    const title = clean(fields.T?.[0]);
    if (!title) return null;
    const manifestation = splitManifestationStatement(fields["7"]?.[0]);
    return sourceRecord({
      source: this.name,
      source_id: link.replace(/\/+$/, "").split("/").at(-1) ?? link,
      source_url: link,
      title,
      authors: unique(fields.A ?? []),
      editors: unique(fields.E ?? []),
      publisher,
      place,
      date,
      edition: manifestation.edition,
      printing: manifestation.printing,
      extent,
      languages: unique((fields.G ?? []).map(language)),
      isbns: isbnValues,
      subjects: unique(fields.K ?? []),
      abstract: clean((fields.X ?? []).join(" ")),
      notes: unique(fields.N ?? []),
    });
  }

  static parseEndNote(text: string): Record<string, string[]> {
    const fields: Record<string, string[]> = {};
    let current: string | null = null;
    for (const rawLine of text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
      const match = rawLine.match(/^%(.?)\s+(.*)$/);
      if (match) {
        current = match[1];
        (fields[current] ??= []).push(clean(match[2]));
      } else if (current && /^[ \t]/.test(rawLine) && fields[current]?.length) {
        const index = fields[current].length - 1;
        fields[current][index] = clean(`${fields[current][index]} ${rawLine}`);
      }
    }
    return fields;
  }
}

export class OpenLibrary implements SourceAdapter {
  readonly name = "Open Library";
  readonly baseURL = "https://openlibrary.org";
  readonly contact: string;
  readonly userAgent: string;
  readonly pacer: Pacer;

  constructor(contact = process.env.OPEN_LIBRARY_CONTACT ?? "", pacer?: Pacer) {
    this.contact = String(contact).trim();
    this.userAgent = applicationUserAgent(this.contact);
    this.pacer = pacer ?? new RequestPacer(this.contact ? 334 : 1_000);
  }

  async search(isbn: ISBNInfo): Promise<SourceResult> {
    const bibkeys = isbn.searchForms.map(form => `ISBN:${form}`).join(",");
    const query = new URLSearchParams({ bibkeys, jscmd: "data", format: "json" });
    const url = `${this.baseURL}/api/books?${query}`;
    let payload: JsonObject;
    try {
      await this.pacer.wait();
      payload = await fetchJSON(url, 18_000, this.userAgent);
    } catch (error) {
      return {
        records: [],
        status: { source: this.name, ok: false, records: 0, message: error instanceof Error ? error.message : String(error) },
      };
    }

    const editions = new Map<string, JsonObject>();
    const matchedForms = new Map<string, string[]>();
    for (const [bibkey, rawData] of Object.entries(payload)) {
      const data = asObject(rawData);
      if (!Object.keys(data).length) continue;
      const key = clean(data.key) || clean(data.url) || bibkey;
      editions.set(key, data);
      const form = bibkey.split(":", 2).at(-1) ?? bibkey;
      const values = matchedForms.get(key) ?? [];
      values.push(form);
      matchedForms.set(key, values);
    }

    const records: SourceRecord[] = [];
    for (const [key, data] of editions) {
      const record = this.recordFromAPIBook(key, data, matchedForms.get(key) ?? [], isbn);
      if (record) records.push(record);
    }
    if (records.length) return { records, status: { source: this.name, ok: true, records: records.length, message: "" } };
    return {
      records: [],
      status: { source: this.name, ok: true, records: 0, message: "No matching edition record" },
    };
  }

  private recordFromAPIBook(key: string, data: JsonObject, queryForms: string[], wanted: ISBNInfo): SourceRecord | null {
    const identifiers = asObject(data.identifiers);
    const isbnValues = validISBNs([
      ...asArray(identifiers.isbn_13),
      ...asArray(identifiers.isbn_10),
      ...queryForms,
    ]);
    if (!recordMatches(isbnValues, wanted)) return null;

    const authors = asArray(data.authors)
      .map(author => clean(asObject(author).name))
      .filter(Boolean);
    const notes: string[] = [];
    const byStatement = clean(data.by_statement);
    if (byStatement) {
      notes.push(`Statement of responsibility: ${byStatement}`);
      authors.push(...authorsFromByStatement(byStatement));
    }
    const contributions = unique(asArray(data.contributions));
    if (contributions.length) notes.push(`Other contributions listed by source: ${contributions.join("; ")}`);
    const sourceNotes = dictText(data.notes);
    if (sourceNotes) notes.push(sourceNotes);

    const languages = asArray(data.languages).map(value => {
      const item = asObject(value);
      const keyValue = Object.keys(item).length ? clean(item.key || item.name) : clean(value);
      return language(keyValue.split("/").at(-1));
    });
    const sourceIdentifiers: Record<string, string[]> = {};
    for (const [field, label] of [["lccn", "LCCN"], ["oclc", "OCLC"]] as const) {
      const values = unique(asArray(identifiers[field]));
      if (values.length) sourceIdentifiers[label] = values;
    }

    const namedValues = (value: unknown): string[] => asArray(value).map(item => {
      const objectValue = asObject(item);
      return Object.keys(objectValue).length ? clean(objectValue.name) : clean(item);
    });
    let sourceURL = clean(data.url);
    if (sourceURL.startsWith("http://")) sourceURL = `https://${sourceURL.slice("http://".length)}`;
    if (!sourceURL) sourceURL = `${this.baseURL}${key}`;
    const title = clean(data.title);
    if (!title) return null;
    const manifestation = splitManifestationStatement(data.edition_name);
    return sourceRecord({
      source: this.name,
      source_id: key.split("/").at(-1) ?? key,
      source_url: sourceURL,
      title,
      subtitle: clean(data.subtitle),
      authors: unique(authors),
      publisher: namedValues(data.publishers).find(Boolean) ?? "",
      place: namedValues(data.publish_places).find(Boolean) ?? "",
      date: clean(data.publish_date),
      edition: manifestation.edition,
      printing: manifestation.printing,
      num_pages: clean(data.number_of_pages),
      extent: clean(data.pagination),
      languages: unique(languages),
      isbns: isbnValues,
      subjects: unique(namedValues(data.subjects)),
      abstract: dictText(data.description),
      notes: unique(notes),
      identifiers: sourceIdentifiers,
    });
  }
}

export class GoogleBooks implements SourceAdapter {
  // Dormant adapter: use only in a separate, non-intermixed compliant view.
  readonly name = "Google Books";
  readonly apiURL = "https://www.googleapis.com/books/v1/volumes";
  readonly apiKey: string;

  constructor(apiKey = process.env.GOOGLE_BOOKS_API_KEY ?? "") {
    this.apiKey = apiKey;
  }

  async search(isbn: ISBNInfo): Promise<SourceResult> {
    const errors: string[] = [];
    const responses = await Promise.all(isbn.searchForms.map(async form => {
      const params: Record<string, string> = { q: `isbn:${form}`, maxResults: "40", projection: "full" };
      if (this.apiKey) params.key = this.apiKey;
      const url = `${this.apiURL}?${new URLSearchParams(params)}`;
      try {
        return await fetchJSON(url);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return {};
      }
    }));

    const items = new Map<string, JsonObject>();
    for (const response of responses) {
      for (const rawItem of asArray(response.items)) {
        const item = asObject(rawItem);
        const id = clean(item.id);
        if (id) items.set(id, item);
      }
    }

    const records: SourceRecord[] = [];
    for (const [id, item] of items) {
      const info = asObject(item.volumeInfo);
      const identifierValues = asArray(info.industryIdentifiers).map(value => clean(asObject(value).identifier));
      const isbnValues = validISBNs(identifierValues);
      if (!recordMatches(isbnValues, isbn)) continue;
      const title = clean(info.title);
      if (!title) continue;
      records.push(sourceRecord({
        source: this.name,
        source_id: id,
        source_url: `https://books.google.com/books?id=${encodeURIComponent(id)}`,
        title,
        subtitle: clean(info.subtitle),
        authors: unique(asArray(info.authors)),
        publisher: clean(info.publisher),
        date: clean(info.publishedDate),
        num_pages: clean(info.pageCount),
        languages: unique([language(info.language)]),
        isbns: isbnValues,
        subjects: unique(asArray(info.categories)),
        abstract: clean(info.description),
      }));
    }

    if (records.length) {
      return {
        records,
        status: {
          source: this.name,
          ok: true,
          records: records.length,
          message: errors.length ? "Some Google Books requests failed; verified matches were retained." : "",
        },
      };
    }
    if (errors.length) return { records: [], status: { source: this.name, ok: false, records: 0, message: errors[0] } };
    return {
      records: [],
      status: { source: this.name, ok: true, records: 0, message: "No matching volume record" },
    };
  }
}

export function defaultSources(environment: Record<string, string | undefined> = process.env): SourceAdapter[] {
  const sources: SourceAdapter[] = [new OpenLibrary(environment.OPEN_LIBRARY_CONTACT ?? "")];
  if (["1", "true", "yes", "on"].includes(String(environment.ISBN_ZOTERO_ENABLE_ONESEARCH ?? "").trim().toLowerCase())) {
    sources.unshift(new IndonesiaOneSearch());
  }
  return sources;
}
