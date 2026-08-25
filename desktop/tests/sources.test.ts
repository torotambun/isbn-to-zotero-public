import { describe, expect, test } from "bun:test";

import { GoogleBooks, IndonesiaOneSearch, OpenLibrary, defaultSources } from "../src/sources.ts";
import { splitManifestationStatement } from "../src/manifestation.ts";
import { RequestPacer, applicationUserAgent } from "../src/network.ts";

describe("source parsers", () => {
  test("parses Indonesia OneSearch EndNote output", () => {
    const text = "%0 Book\n%A Conboy, Ken\n%E Danny Raharto\n%I Pustaka Primatama\n%D 2007\n%@ 9789793930152\n%T Intel menguak tabir dunia intelijen Indonesia\n%7 Cet. 3\n";
    const fields = IndonesiaOneSearch.parseEndNote(text);
    expect(fields.A).toEqual(["Conboy, Ken"]);
    expect(fields["@"]).toEqual(["9789793930152"]);
    expect(fields["7"]).toEqual(["Cet. 3"]);
  });

  test("classifies cetakan as printing rather than edition", () => {
    expect(splitManifestationStatement("Cet. 3")).toEqual({ edition: "", printing: "Cet. 3" });
    expect(splitManifestationStatement("Edisi revisi")).toEqual({ edition: "Edisi revisi", printing: "" });
  });

  test("uses a conservative default source policy", () => {
    expect(defaultSources({}).map(source => source.name)).toEqual(["Open Library"]);
    expect(defaultSources({ ISBN_ZOTERO_ENABLE_ONESEARCH: "1" }).map(source => source.name)).toEqual([
      "Indonesia OneSearch",
      "Open Library",
    ]);
    expect(defaultSources({ ISBN_ZOTERO_ENABLE_ONESEARCH: "1" }).some(source => source instanceof GoogleBooks)).toBeFalse();
  });

  test("sanitizes Open Library contact identity and sets conservative pacing", () => {
    expect(applicationUserAgent("public@example.org\r\nInjected")).toContain("contact: public@example.org Injected");
    expect(applicationUserAgent("public@example.org\r\nInjected")).not.toContain("\r");
    expect(applicationUserAgent("public@example.org\r\nInjected")).not.toContain("\n");
    expect((new OpenLibrary("", new RequestPacer(1_000)).pacer as RequestPacer).minimumIntervalMs).toBe(1_000);
    expect(new IndonesiaOneSearch().maxRecords).toBe(8);
  });
});
