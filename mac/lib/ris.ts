import type { ReconciledBook } from "./types";

function clean(value: unknown): string {
  return String(value ?? "").replaceAll("\0", "").trim().replace(/\s+/g, " ");
}

function line(tag: string, value: unknown): string | null {
  const text = clean(value);
  return text ? `${tag}  - ${text}` : null;
}

export function pageTotal(book: ReconciledBook): string {
  if (/^\d+$/.test(clean(book.num_pages))) return clean(book.num_pages);
  const matches = [
    ...clean(book.extent).matchAll(
      /\b(\d{1,5})\s*(?:hlm\.?|halaman|p\.?|pages?|pg\.?)\b/gi,
    ),
  ];
  return matches.at(-1)?.[1] ?? "";
}

function auditNote(book: ReconciledBook): string {
  const parts = [
    book.isbns.length
      ? "Generated after independent-source ISBN reconciliation."
      : book.source_records.length
        ? "Generated after a title-based catalogue search and physical-book review."
        : "Generated from fields transcribed and verified against the physical book.",
    `Assessment: ${book.confidence}. ${book.reason}`,
  ];
  if (book.extent) parts.push(`Physical description reported by a source: ${book.extent}.`);
  if (Object.keys(book.conflicts).length) {
    parts.push(
      `Source conflicts retained: ${Object.entries(book.conflicts)
        .map(([field, values]) => `${field} = ${values.join(" | ")}`)
        .join("; ")}.`,
    );
  }
  const sources = book.source_records
    .filter((record) => record.source_url)
    .map((record) => `${record.source}: ${record.source_url}`)
    .join("; ");
  if (sources) parts.push(`Source records: ${sources}`);
  return parts.join(" ");
}

export function bookToRIS(book: ReconciledBook): string {
  if (!book.title) throw new Error("RIS export requires a verified title.");
  const title =
    book.subtitle && !book.title.toLowerCase().includes(book.subtitle.toLowerCase())
      ? `${book.title}: ${book.subtitle}`
      : book.title;
  const lines = ["TY  - BOOK", line("TI", title)!];
  for (const person of book.authors) lines.push(line("AU", person)!);
  for (const person of book.editors) lines.push(line("ED", person)!);
  for (const person of book.translators) lines.push(line("A4", person)!);
  for (const [tag, value] of [
    ["PY", book.date],
    ["ET", book.edition],
    ["CY", book.place],
    ["PB", book.publisher],
    ["SP", pageTotal(book)],
    ["LA", book.languages.join("; ")],
    ["AB", book.abstract],
    ["T3", book.series ?? ""],
    ["VL", book.volume ?? ""],
  ]) {
    const rendered = line(tag, value);
    if (rendered) lines.push(rendered);
  }
  for (const isbn of book.isbns) lines.push(line("SN", isbn)!);
  for (const subject of book.subjects) lines.push(line("KW", subject)!);
  for (const note of book.notes) lines.push(line("N1", note)!);
  lines.push(line("N1", auditNote(book))!);
  const url = line("UR", book.source_records[0]?.source_url);
  if (url) lines.push(url);
  lines.push("ER  -");
  return `${lines.filter(Boolean).join("\r\n")}\r\n`;
}

export function safeFilename(book: ReconciledBook): string {
  const isbn = book.isbns.find((value) => value.length === 13) ?? book.isbns[0] ?? "no-isbn";
  const title = book.title
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52);
  return `${isbn}-${title || "book"}.ris`;
}
