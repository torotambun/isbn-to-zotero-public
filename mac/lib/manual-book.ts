import type { ReconciledBook } from "./types";

export interface ManualBookFields {
  title: string;
  subtitle: string;
  authors: string;
  editors: string;
  translators: string;
  publisher: string;
  place: string;
  date: string;
  edition: string;
  series: string;
  series_number: string;
  volume: string;
  number_of_volumes: string;
  num_pages: string;
  extent: string;
  language: string;
}

function clean(value: unknown): string {
  return String(value ?? "").replaceAll("\0", "").trim().replace(/\s+/g, " ");
}

function people(value: string): string[] {
  return value
    .split(/[;\n]+/)
    .map(clean)
    .filter(Boolean)
    .filter((name, index, values) => values.findIndex((candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase()) === index);
}

function stableID(parts: string[]): string {
  let hash = 0x811c9dc5;
  for (const character of parts.join("|")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function manualBook(raw: ManualBookFields): ReconciledBook {
  const fields = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, clean(value)]),
  ) as unknown as ManualBookFields;
  if (!fields.title) throw new Error("Enter the title exactly as printed on the title page.");

  const id = stableID([fields.title, fields.authors, fields.publisher, fields.date, fields.edition]);
  return {
    choice_id: `manual-${id}`,
    title_cluster_id: `manual-work-${stableID([fields.title, fields.authors])}`,
    title: fields.title,
    subtitle: fields.subtitle,
    authors: people(fields.authors),
    editors: people(fields.editors),
    translators: people(fields.translators),
    publisher: fields.publisher,
    place: fields.place,
    date: fields.date,
    edition: fields.edition,
    series: fields.series,
    series_number: fields.series_number,
    volume: fields.volume,
    number_of_volumes: fields.number_of_volumes,
    num_pages: fields.num_pages,
    extent: fields.extent,
    languages: fields.language ? [fields.language] : [],
    isbns: [],
    subjects: [],
    abstract: "",
    notes: ["Metadata manually transcribed from the physical title and copyright pages."],
    source_records: [],
    conflicts: {},
    confidence: "review",
    reason: "Manual record. Confirm every populated field against the physical book before import.",
  };
}
