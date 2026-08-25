import { describe, expect, test } from "bun:test";

import { bookToRIS } from "../src/ris.ts";
import { sourceRecord, type ReconciledBook } from "../src/types.ts";

export function makeBook(): ReconciledBook {
  return {
    choice_id: "one",
    title_cluster_id: "work",
    title: "Buku",
    subtitle: "",
    authors: ["Example, Author"],
    editors: [],
    translators: [],
    publisher: "Penerbit",
    place: "Jakarta",
    date: "2006",
    edition: "Edisi revisi",
    printing: "Cet. 1",
    num_pages: "432",
    extent: "",
    languages: ["Indonesian"],
    isbns: ["9792704043", "9789792704044"],
    subjects: [],
    abstract: "",
    notes: [],
    source_records: [sourceRecord({ source: "Test catalogue", source_id: "1", source_url: "https://example.test/1", title: "Buku" })],
    conflicts: {},
    confidence: "high",
    reason: "Test evidence.",
    requires_physical_confirmation: false,
  };
}

describe("RIS output", () => {
  test("creates a Zotero-compatible book record", () => {
    const ris = bookToRIS(makeBook());
    expect(ris).toContain("TY  - BOOK\r\n");
    expect(ris).toContain("TI  - Buku\r\n");
    expect(ris).toContain("SP  - 432\r\n");
    expect(ris).toContain("ET  - Edisi revisi\r\n");
    expect(ris).toContain("N1  - Printing statement: Cet. 1\r\n");
    expect(ris).not.toContain("ET  - Cet. 1");
    expect(ris).toContain("SN  - 9792704043\r\n");
    expect(ris.endsWith("ER  -\r\n")).toBeTrue();
  });
});
