import type { ISBNInfo } from "./types.ts";

export class ISBNValidationError extends Error {
  value: string;
  suggestion: string | null;

  constructor(value: string, message: string, suggestion: string | null = null) {
    super(message);
    this.name = "ISBNValidationError";
    this.value = value;
    this.suggestion = suggestion;
  }
}

export function cleanISBN(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^0-9X]/g, "");
}

export function isbn10CheckDigit(firstNine: string): string {
  if (!/^\d{9}$/.test(firstNine)) throw new Error("ISBN-10 body must contain nine digits");
  let total = 0;
  for (let index = 0; index < firstNine.length; index += 1) {
    total += (10 - index) * Number(firstNine[index]);
  }
  const value = (11 - (total % 11)) % 11;
  return value === 10 ? "X" : String(value);
}

export function isbn13CheckDigit(firstTwelve: string): string {
  if (!/^\d{12}$/.test(firstTwelve)) throw new Error("ISBN-13 body must contain twelve digits");
  let total = 0;
  for (let index = 0; index < firstTwelve.length; index += 1) {
    total += (index % 2 === 0 ? 1 : 3) * Number(firstTwelve[index]);
  }
  return String((10 - (total % 10)) % 10);
}

export function isValidISBN10(value: unknown): boolean {
  const cleaned = cleanISBN(value);
  return /^\d{9}[0-9X]$/.test(cleaned) && cleaned[9] === isbn10CheckDigit(cleaned.slice(0, 9));
}

export function isValidISBN13(value: unknown): boolean {
  const cleaned = cleanISBN(value);
  return /^(978|979)\d{10}$/.test(cleaned) && cleaned[12] === isbn13CheckDigit(cleaned.slice(0, 12));
}

export function isbn10ToISBN13(value: unknown): string {
  const cleaned = cleanISBN(value);
  if (!isValidISBN10(cleaned)) throw new ISBNValidationError(cleaned, "Invalid ISBN-10");
  const body = `978${cleaned.slice(0, 9)}`;
  return `${body}${isbn13CheckDigit(body)}`;
}

export function isbn13ToISBN10(value: unknown): string | null {
  const cleaned = cleanISBN(value);
  if (!isValidISBN13(cleaned)) throw new ISBNValidationError(cleaned, "Invalid ISBN-13");
  if (!cleaned.startsWith("978")) return null;
  const body = cleaned.slice(3, 12);
  return `${body}${isbn10CheckDigit(body)}`;
}

export function parseISBN(value: unknown): ISBNInfo {
  const raw = String(value ?? "");
  const normalized = cleanISBN(raw);
  if (normalized.length === 10) {
    if (isValidISBN10(normalized)) {
      const isbn13 = isbn10ToISBN13(normalized);
      return { raw, normalized, isbn10: normalized, isbn13, canonical: isbn13, searchForms: [isbn13, normalized] };
    }
    const suggestion = /^\d{9}/.test(normalized)
      ? `${normalized.slice(0, 9)}${isbn10CheckDigit(normalized.slice(0, 9))}`
      : null;
    throw new ISBNValidationError(
      raw,
      "The ISBN-10 check digit is invalid. Rescan the barcode or inspect the printed ISBN.",
      suggestion,
    );
  }
  if (normalized.length === 13) {
    if (isValidISBN13(normalized)) {
      const isbn10 = isbn13ToISBN10(normalized);
      return {
        raw,
        normalized,
        isbn10,
        isbn13: normalized,
        canonical: normalized,
        searchForms: isbn10 ? [normalized, isbn10] : [normalized],
      };
    }
    const suggestion = /^\d{12}/.test(normalized)
      ? `${normalized.slice(0, 12)}${isbn13CheckDigit(normalized.slice(0, 12))}`
      : null;
    throw new ISBNValidationError(
      raw,
      "The ISBN-13 check digit or prefix is invalid. Rescan the barcode or inspect the printed ISBN.",
      suggestion,
    );
  }
  throw new ISBNValidationError(
    raw,
    `Expected 10 or 13 ISBN characters after removing spaces and hyphens; found ${normalized.length}.`,
  );
}

export function equivalentISBN(left: unknown, right: unknown): boolean {
  try {
    return parseISBN(left).canonical === parseISBN(right).canonical;
  } catch (error) {
    if (error instanceof ISBNValidationError) return false;
    throw error;
  }
}

export function validISBNs(values: unknown[]): string[] {
  const output: string[] = [];
  const canonicalSeen = new Set<string>();
  for (const value of values) {
    let info: ISBNInfo;
    try {
      info = parseISBN(value);
    } catch (error) {
      if (error instanceof ISBNValidationError) continue;
      throw error;
    }
    if (canonicalSeen.has(info.canonical)) continue;
    canonicalSeen.add(info.canonical);
    for (const form of info.searchForms) if (!output.includes(form)) output.push(form);
  }
  return output;
}
