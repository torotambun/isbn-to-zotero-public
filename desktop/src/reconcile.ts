import { createHash } from "node:crypto";

import { validISBNs } from "./isbn.ts";
import type { ISBNInfo, ReconciledBook, SourceRecord } from "./types.ts";

const PLACEHOLDER_PUBLISHERS = new Set(["alauddin university", "unknown", "s.n.", "sn"]);

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replaceAll("&", " dan ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeTitle(value: unknown): string {
  return normalizeText(value).trim().replace(/\s+/g, " ");
}

function longestCommonBlock(
  left: string,
  leftStart: number,
  leftEnd: number,
  right: string,
  rightStart: number,
  rightEnd: number,
): [number, number, number] {
  let bestLeft = leftStart;
  let bestRight = rightStart;
  let bestSize = 0;
  let previous = new Map<number, number>();
  for (let leftIndex = leftStart; leftIndex < leftEnd; leftIndex += 1) {
    const current = new Map<number, number>();
    for (let rightIndex = rightStart; rightIndex < rightEnd; rightIndex += 1) {
      if (left[leftIndex] !== right[rightIndex]) continue;
      const size = (previous.get(rightIndex - 1) ?? 0) + 1;
      current.set(rightIndex, size);
      if (size > bestSize) {
        bestLeft = leftIndex - size + 1;
        bestRight = rightIndex - size + 1;
        bestSize = size;
      }
    }
    previous = current;
  }
  return [bestLeft, bestRight, bestSize];
}

export function sequenceRatio(left: string, right: string): number {
  if (!left.length && !right.length) return 1;
  const pending: Array<[number, number, number, number]> = [[0, left.length, 0, right.length]];
  let matches = 0;
  while (pending.length) {
    const [leftStart, leftEnd, rightStart, rightEnd] = pending.pop()!;
    const [matchLeft, matchRight, size] = longestCommonBlock(left, leftStart, leftEnd, right, rightStart, rightEnd);
    if (!size) continue;
    matches += size;
    if (leftStart < matchLeft && rightStart < matchRight) {
      pending.push([leftStart, matchLeft, rightStart, matchRight]);
    }
    const leftAfter = matchLeft + size;
    const rightAfter = matchRight + size;
    if (leftAfter < leftEnd && rightAfter < rightEnd) pending.push([leftAfter, leftEnd, rightAfter, rightEnd]);
  }
  return (2 * matches) / (left.length + right.length);
}

export function titleSimilarity(left: string, right: string): number {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    if (shorter / longer >= 0.55) return 0.91;
  }
  return sequenceRatio(a, b);
}

function personKey(value: string): string {
  const ignored = new Set(["dkk", "et", "al", "dr"]);
  return normalizeText(value.replaceAll(",", " "))
    .split(" ")
    .filter(token => token && !ignored.has(token))
    .sort()
    .join(" ");
}

function peopleSimilarity(left: string[], right: string[]): number {
  let best = 0;
  for (const a of left) {
    for (const b of right) {
      const first = personKey(a);
      const second = personKey(b);
      if (first && second) best = Math.max(best, sequenceRatio(first, second));
    }
  }
  return best;
}

export function normalizeDate(value: string): string {
  const match = String(value ?? "").match(/\b(1[5-9]\d{2}|20\d{2}|2100)\b/);
  return match?.[1] ?? normalizeText(value);
}

export function editionNumber(value: string): string {
  const normalized = normalizeText(value);
  const match = normalized.match(/\b(?:ed(?:isi|ition)?)\s*(?:ke\s*)?(\d+)\b/);
  return match?.[1] ?? normalized;
}

export function printingNumber(value: string): string {
  const normalized = normalizeText(value);
  const match = normalized.match(/\b(?:cet(?:akan)?|printing|impression)\s*(?:ke\s*)?(\d+)\b/);
  return match?.[1] ?? normalized;
}

function publisherKey(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function publisherSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  return sequenceRatio(publisherKey(left), publisherKey(right));
}

function sameTitleFamily(left: SourceRecord, right: SourceRecord): boolean {
  if (titleSimilarity(left.title, right.title) >= 0.86) return true;
  const a = normalizeTitle(left.title);
  const b = normalizeTitle(right.title);
  if (!a || !b) return false;
  if (!(a.startsWith(b) || b.startsWith(a) || a.includes(b) || b.includes(a))) return false;
  const authorScore = peopleSimilarity(left.authors, right.authors);
  const sameYear = Boolean(normalizeDate(left.date)) && normalizeDate(left.date) === normalizeDate(right.date);
  const samePublisher = publisherSimilarity(left.publisher, right.publisher) >= 0.82;
  return authorScore >= 0.72 || (sameYear && samePublisher);
}

function clusterByTitle(records: SourceRecord[]): SourceRecord[][] {
  const clusters: SourceRecord[][] = [];
  for (const record of records) {
    let bestIndex: number | null = null;
    let bestScore = 0;
    clusters.forEach((cluster, index) => {
      let score = 0;
      for (const item of cluster) {
        if (sameTitleFamily(record, item)) score = Math.max(score, titleSimilarity(record.title, item.title), 0.86);
      }
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex !== null && bestScore >= 0.86) clusters[bestIndex].push(record);
    else clusters.push([record]);
  }
  return clusters;
}

function clusterByManifestation(records: SourceRecord[]): SourceRecord[][] {
  const precise = new Map<string, SourceRecord[]>();
  const unresolved: SourceRecord[] = [];
  for (const record of records) {
    const date = normalizeDate(record.date);
    const edition = editionNumber(record.edition);
    const printing = printingNumber(record.printing);
    if (!edition && !printing) {
      unresolved.push(record);
      continue;
    }
    const key = `${date}\0${edition}\0${printing}`;
    const group = precise.get(key) ?? [];
    group.push(record);
    precise.set(key, group);
  }

  if (!precise.size) {
    const dated = new Map<string, SourceRecord[]>();
    const undated: SourceRecord[] = [];
    for (const record of records) {
      const date = normalizeDate(record.date);
      if (date) {
        const group = dated.get(date) ?? [];
        group.push(record);
        dated.set(date, group);
      } else undated.push(record);
    }
    if (dated.size === 1) {
      const only = [...dated.values()][0];
      only.push(...undated);
      return [only];
    }
    const clusters = [...dated.values()];
    if (clusters.length === 1) clusters[0].push(...undated);
    else if (undated.length) clusters.push(undated);
    return clusters.length ? clusters : [records];
  }

  const clusters = [...precise.values()];
  const pending: SourceRecord[] = [];
  for (const record of unresolved) {
    const date = normalizeDate(record.date);
    const compatible = clusters.filter(cluster => !date || cluster.some(item => normalizeDate(item.date) === date));
    if (compatible.length === 1) compatible[0].push(record);
    else pending.push(record);
  }

  const pendingByDate = new Map<string, SourceRecord[]>();
  const undated: SourceRecord[] = [];
  for (const record of pending) {
    const date = normalizeDate(record.date);
    if (date) {
      const group = pendingByDate.get(date) ?? [];
      group.push(record);
      pendingByDate.set(date, group);
    } else undated.push(record);
  }
  clusters.push(...pendingByDate.values());
  if (clusters.length === 1) clusters[0].push(...undated);
  else if (undated.length) {
    const publisherMatches = clusters.filter(cluster => undated.some(record => cluster.some(item =>
      Boolean(record.publisher && item.publisher) && publisherSimilarity(record.publisher, item.publisher) >= 0.82,
    )));
    if (publisherMatches.length === 1) publisherMatches[0].push(...undated);
    else clusters.push(undated);
  }
  return clusters;
}

function sourceWeight(record: SourceRecord): number {
  if (record.source === "Open Library") return 3;
  if (record.source === "Indonesia OneSearch" || record.source === "Google Books") return 2;
  return 1;
}

function isPlaceholder(field: string, value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  return field === "publisher" && PLACEHOLDER_PUBLISHERS.has(normalized);
}

function compareTuples(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function pickScalar(
  records: SourceRecord[],
  field: keyof SourceRecord,
  normalizer: (value: string) => string = normalizeText,
): [string, string[]] {
  const values = new Map<string, Array<[string, number]>>();
  const firstIndex = new Map<string, number>();
  records.forEach((record, index) => {
    const value = String(record[field] ?? "").trim();
    if (isPlaceholder(String(field), value)) return;
    const key = normalizer(value);
    if (!key) return;
    const entries = values.get(key) ?? [];
    entries.push([value, sourceWeight(record)]);
    values.set(key, entries);
    if (!firstIndex.has(key)) firstIndex.set(key, index);
  });
  if (!values.size) return ["", []];

  const evidence = (key: string): number[] => {
    const caps = new Map<string, number>();
    for (const record of records) {
      const value = String(record[field] ?? "").trim();
      if (value && normalizer(value) === key) caps.set(record.source, Math.max(caps.get(record.source) ?? 0, sourceWeight(record)));
    }
    return [
      [...caps.values()].reduce((sum, value) => sum + value, 0),
      caps.size,
      values.get(key)?.length ?? 0,
      Math.max(...(values.get(key) ?? []).map(([value]) => value.length)),
    ];
  };
  const ranked = [...values.keys()].sort((left, right) => {
    const score = compareTuples(evidence(right), evidence(left));
    return score || (firstIndex.get(left) ?? 0) - (firstIndex.get(right) ?? 0);
  });
  const variants = (values.get(ranked[0]) ?? []).map(([value]) => value);
  const counts = new Map<string, number>();
  variants.forEach(value => counts.set(value, (counts.get(value) ?? 0) + 1));
  const chosen = [...variants].sort((left, right) =>
    (counts.get(right) ?? 0) - (counts.get(left) ?? 0) || right.length - left.length,
  )[0];
  const conflicts: string[] = [];
  for (const key of ranked) {
    const representative = [...(values.get(key) ?? [])].sort((left, right) => right[0].length - left[0].length)[0]?.[0] ?? "";
    if (representative && !conflicts.some(item => item.toLocaleLowerCase() === representative.toLocaleLowerCase())) {
      conflicts.push(representative);
    }
  }
  return [chosen, conflicts.length > 1 ? conflicts : []];
}

function pickPeople(records: SourceRecord[], field: "authors" | "editors" | "translators"): [string[], string[]] {
  if (!records.some(record => record[field]?.length)) return [[], []];
  const clusters: Array<{ key: string; variants: string[][]; sources: Map<string, number> }> = [];
  for (const record of records) {
    const values = [...(record[field] ?? [])];
    if (!values.length) continue;
    const joined = values.map(personKey).sort().join("|");
    let cluster = clusters.find(candidate => sequenceRatio(joined, candidate.key) >= 0.84);
    if (!cluster) {
      cluster = { key: joined, variants: [], sources: new Map() };
      clusters.push(cluster);
    }
    cluster.variants.push(values);
    cluster.sources.set(record.source, Math.max(cluster.sources.get(record.source) ?? 0, sourceWeight(record)));
  }
  const winner = [...clusters].sort((left, right) => compareTuples(
    [
      [...right.sources.values()].reduce((sum, value) => sum + value, 0),
      right.sources.size,
      right.variants.length,
      right.key.length,
    ],
    [
      [...left.sources.values()].reduce((sum, value) => sum + value, 0),
      left.sources.size,
      left.variants.length,
      left.key.length,
    ],
  ))[0];
  const candidates: Array<{ values: string[]; weight: number }> = [];
  for (const record of records) {
    const values = [...(record[field] ?? [])];
    if (!values.length) continue;
    const joined = values.map(personKey).sort().join("|");
    if (sequenceRatio(joined, winner.key) >= 0.84) candidates.push({ values, weight: sourceWeight(record) });
  }
  candidates.sort((left, right) =>
    right.weight - left.weight ||
    right.values.length - left.values.length ||
    right.values.reduce((sum, value) => sum + value.length, 0) - left.values.reduce((sum, value) => sum + value.length, 0),
  );
  const conflictLists = clusters.map(cluster => [...cluster.variants].sort((left, right) =>
    right.reduce((sum, value) => sum + value.length, 0) - left.reduce((sum, value) => sum + value.length, 0),
  )[0].join("; ")).filter(Boolean);
  return [candidates[0]?.values ?? [], conflictLists.length > 1 ? [...new Set(conflictLists)] : []];
}

function union(records: SourceRecord[], field: "languages" | "isbns" | "subjects" | "notes"): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const raw of record[field] ?? []) {
      const value = String(raw).trim();
      const key = normalizeText(value);
      if (value && !seen.has(key)) {
        seen.add(key);
        output.push(value);
      }
    }
  }
  return output;
}

function makeID(prefix: string, parts: string[]): string {
  const digest = createHash("sha1").update(parts.join("|"), "utf8").digest("hex").slice(0, 10);
  return `${prefix}-${digest}`;
}

export function reconcile(records: SourceRecord[], isbn: ISBNInfo): ReconciledBook[] {
  const choices: ReconciledBook[] = [];
  const titleClusters = clusterByTitle(records);
  const multipleTitles = titleClusters.length > 1;

  for (const titleRecords of titleClusters) {
    const longestTitle = [...titleRecords].sort((left, right) => right.title.length - left.title.length)[0]?.title ?? "";
    const titleClusterID = makeID("work", [isbn.canonical, normalizeTitle(longestTitle)]);
    const manifestationClusters = clusterByManifestation(titleRecords);
    for (const editionRecords of manifestationClusters) {
      const conflicts: Record<string, string[]> = {};
      const assignScalar = (field: keyof SourceRecord, normalizer?: (value: string) => string): string => {
        const [value, variants] = pickScalar(editionRecords, field, normalizer);
        if (variants.length) conflicts[String(field)] = variants;
        return value;
      };
      const title = assignScalar("title", normalizeTitle);
      const subtitle = assignScalar("subtitle");
      const [authors, authorVariants] = pickPeople(editionRecords, "authors");
      if (authorVariants.length) conflicts.authors = authorVariants;
      const [editors, editorVariants] = pickPeople(editionRecords, "editors");
      if (editorVariants.length) conflicts.editors = editorVariants;
      const [translators, translatorVariants] = pickPeople(editionRecords, "translators");
      if (translatorVariants.length) conflicts.translators = translatorVariants;

      const roleConflicts: string[] = [];
      for (const author of authors) {
        for (const [role, people] of [["editor", editors], ["translator", translators]] as const) {
          for (const person of people) {
            if (sequenceRatio(personKey(author), personKey(person)) >= 0.9) {
              roleConflicts.push(`${person}: reported as both author and ${role}`);
            }
          }
        }
      }
      if (roleConflicts.length) conflicts.creator_roles = [...new Set(roleConflicts)].sort();

      const publisher = assignScalar("publisher");
      const place = assignScalar("place");
      const date = assignScalar("date", normalizeDate);
      const edition = assignScalar("edition", editionNumber);
      const printing = assignScalar("printing", printingNumber);
      const numPages = assignScalar("num_pages", normalizeText);
      const extent = assignScalar("extent", normalizeText);
      const abstract = pickScalar(editionRecords, "abstract", normalizeText)[0];
      const isbns = validISBNs([...union(editionRecords, "isbns"), ...isbn.searchForms]);
      const notes = union(editionRecords, "notes");
      const sourceCount = new Set(editionRecords.map(record => record.source)).size;
      const critical = ["title", "authors", "publisher", "date", "edition", "printing"].some(field => field in conflicts);

      let confidence: ReconciledBook["confidence"];
      let reason: string;
      if (multipleTitles) {
        confidence = "ambiguous";
        reason = "This ISBN is attached to more than one distinct title. Match the title page and copyright page.";
      } else if (manifestationClusters.length > 1) {
        confidence = "review";
        reason = "More than one printing or edition is represented. Match the edition statement and year.";
      } else if (critical) {
        confidence = "review";
        reason = "Sources disagree on important bibliographic fields. Inspect the listed conflicts.";
      } else if (sourceCount >= 2) {
        confidence = "high";
        reason = "At least two distinct catalogue sources agree on the principal bibliographic metadata.";
      } else if (editionRecords.length >= 2) {
        confidence = "review";
        reason = "Several records agree, but they come from only one catalogue source. Confirm the physical book.";
      } else {
        confidence = "review";
        reason = "Only one usable record was found. Confirm it against the physical book.";
      }

      const choiceID = makeID("edition", [
        isbn.canonical,
        titleClusterID,
        normalizeDate(date),
        editionNumber(edition),
        printingNumber(printing),
        normalizeText(publisher),
      ]);
      choices.push({
        choice_id: choiceID,
        title_cluster_id: titleClusterID,
        title,
        subtitle,
        authors,
        editors,
        translators,
        publisher,
        place,
        date,
        edition,
        printing,
        num_pages: numPages,
        extent,
        languages: union(editionRecords, "languages"),
        isbns,
        subjects: union(editionRecords, "subjects"),
        abstract,
        notes,
        source_records: editionRecords,
        conflicts,
        confidence,
        reason,
        requires_physical_confirmation: confidence !== "high",
      });
    }
  }

  const confidenceOrder: Record<string, number> = { high: 0, review: 1, ambiguous: 2 };
  choices.sort((left, right) => {
    const confidence = (confidenceOrder[left.confidence] ?? 9) - (confidenceOrder[right.confidence] ?? 9);
    if (confidence) return confidence;
    const sourceDifference = new Set(right.source_records.map(record => record.source)).size
      - new Set(left.source_records.map(record => record.source)).size;
    if (sourceDifference) return sourceDifference;
    const recordDifference = right.source_records.length - left.source_records.length;
    if (recordDifference) return recordDifference;
    const dateDifference = normalizeDate(left.date).localeCompare(normalizeDate(right.date), "en");
    return dateDifference || normalizeTitle(left.title).localeCompare(normalizeTitle(right.title), "en");
  });
  return choices;
}
