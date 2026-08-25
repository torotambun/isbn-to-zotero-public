import { describe, expect, test } from "bun:test";

import { parseISBN } from "../src/isbn.ts";
import { reconcile } from "../src/reconcile.ts";
import { sourceRecord } from "../src/types.ts";

function record(source: string, sourceID: string, title: string, author: string, publisher: string, date: string, edition = "", printing = "") {
  return sourceRecord({
    source,
    source_id: sourceID,
    source_url: `https://example.test/${sourceID}`,
    title,
    authors: [author],
    publisher,
    date,
    edition,
    printing,
    isbns: ["9792704043", "9789792704044"],
  });
}

describe("metadata reconciliation", () => {
  test("keeps two titles attached to a reused identifier separate", () => {
    const choices = reconcile([
      record("Open Library", "a", "Sejarah Kanjeng Sultan Hamengku Buwono IX", "Purwadi", "Hanan Pustaka", "2006", "", "Cet. 1"),
      record("Google Books", "b", "Lulus Kuliah Cari Kerja Kuno !!", "Dodi Mawardi", "Hanan Pustaka", "2013"),
    ], parseISBN("9792704043"));
    expect(new Set(choices.map(choice => choice.title_cluster_id)).size).toBe(2);
    expect(choices.every(choice => choice.confidence === "ambiguous")).toBeTrue();
  });

  test("does not collapse distinct printings", () => {
    const isbn = parseISBN("9789793930152");
    const choices = reconcile([
      sourceRecord({ source: "Indonesia OneSearch", source_id: "a", source_url: "x", title: "Intel", authors: ["Ken Conboy"], publisher: "Pustaka Primatama", date: "2007", printing: "Cet. 3", isbns: [isbn.isbn13!] }),
      sourceRecord({ source: "Indonesia OneSearch", source_id: "b", source_url: "y", title: "Intel", authors: ["Ken Conboy"], publisher: "Pustaka Primatama", date: "2008", printing: "Cet. 4", isbns: [isbn.isbn13!] }),
    ], isbn);
    expect(choices).toHaveLength(2);
    expect(new Set(choices.map(choice => choice.printing))).toEqual(new Set(["Cet. 3", "Cet. 4"]));
    expect(choices.every(choice => choice.edition === "")).toBeTrue();
  });

  test("does not treat two records from one catalogue as independent", () => {
    const isbn = parseISBN("9786028174886");
    const choices = reconcile([
      sourceRecord({ source: "Indonesia OneSearch", source_id: "a", source_url: "x", title: "Prabowo", authors: ["Femi"], publisher: "Galang Press", date: "2012", isbns: [isbn.isbn13!] }),
      sourceRecord({ source: "Indonesia OneSearch", source_id: "b", source_url: "y", title: "Prabowo", authors: ["Femi"], publisher: "Galang Press", date: "2012", isbns: [isbn.isbn13!] }),
    ], isbn);
    expect(choices[0].confidence).toBe("review");
    expect(choices[0].reason).toContain("one catalogue source");
  });

  test("allows high confidence from two distinct catalogue sources", () => {
    const isbn = parseISBN("9786028174886");
    const choices = reconcile([
      sourceRecord({ source: "Indonesia OneSearch", source_id: "a", source_url: "x", title: "Prabowo", authors: ["Femi"], publisher: "Galang Press", date: "2012", isbns: [isbn.isbn13!] }),
      sourceRecord({ source: "Open Library", source_id: "b", source_url: "y", title: "Prabowo", authors: ["Femi"], publisher: "Galang Press", date: "2012", isbns: [isbn.isbn13!] }),
    ], isbn);
    expect(choices[0].confidence).toBe("high");
    expect(choices[0].requires_physical_confirmation).toBeFalse();
  });
});
