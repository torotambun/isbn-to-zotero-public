import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { LocalZotero } from "../src/zotero.ts";
import { makeBook } from "./ris.test.ts";

let fakeServer: ReturnType<typeof Bun.serve>;
let received: unknown = null;
let writeToken = "";
let searchResults: unknown[] = [];

beforeAll(() => {
  fakeServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const headers = { "Content-Type": "application/json", "Zotero-Server-ID": "test-server", "Zotero-API-Version": "3" };
      if (request.method === "GET" && url.pathname === "/api/") return Response.json({}, { headers });
      if (request.method === "GET" && url.pathname === "/api/users/0/items") return Response.json(searchResults, { headers });
      if (request.method === "GET" && url.pathname === "/api/items/new") {
        return Response.json({
          itemType: "book", title: "", creators: [], abstractNote: "", edition: "", place: "", publisher: "", date: "",
          numPages: "", language: "", ISBN: "", url: "", libraryCatalog: "", extra: "", tags: [], collections: [], relations: {},
        }, { headers });
      }
      if (request.method === "POST" && url.pathname === "/api/local/authorize") {
        return Response.json({ key: "x".repeat(32), remember: false }, { headers });
      }
      if (request.method === "POST" && url.pathname === "/api/users/0/items") {
        writeToken = request.headers.get("Zotero-Write-Token") ?? "";
        if (!/^[0-9a-f]{32}$/.test(writeToken)) return Response.json({ error: "bad token" }, { status: 400, headers });
        received = await request.json();
        return Response.json({ successful: { "0": { key: "ABCD1234", version: 1 } }, failed: {} }, { headers });
      }
      return new Response("Not Found", { status: 404 });
    },
  });
});

afterAll(() => fakeServer.stop(true));

describe("local Zotero integration", () => {
  test("fills creator names and pagination without guessing", () => {
    const book = makeBook();
    book.authors = ["Purwadi"];
    book.extent = "xi, 432 p.";
    book.num_pages = "";
    const item = LocalZotero.fillTemplate({
      itemType: "book", title: "", creators: [], abstractNote: "", edition: "", place: "", publisher: "", date: "",
      numPages: "", language: "", ISBN: "", url: "", libraryCatalog: "", extra: "", tags: [], collections: [], relations: {},
    }, book);
    expect(item.creators).toEqual([{ creatorType: "author", name: "Purwadi" }]);
    expect(item.numPages).toBe("432");
    expect(item.edition).toBe("Edisi revisi");
    expect(String(item.extra)).toContain("Printing statement: Cet. 1");
  });

  test("authorizes and writes to the Zotero local API", async () => {
    const zotero = new LocalZotero(3_000, `http://127.0.0.1:${fakeServer.port}/api`);
    const result = await zotero.addBook(makeBook());
    expect(result.created).toBeTrue();
    expect(result.item_key).toBe("ABCD1234");
    expect((received as Array<Record<string, unknown>>)[0].title).toBe("Buku");
    expect(writeToken).toMatch(/^[0-9a-f]{32}$/);
  });

  test("blocks a legacy title and creator match without an ISBN", async () => {
    searchResults = [{
      data: {
        key: "LEGACY01",
        title: "Buku",
        ISBN: "",
        date: "2006",
        creators: [{ creatorType: "author", name: "Example, Author" }],
      },
    }];
    try {
      const zotero = new LocalZotero(3_000, `http://127.0.0.1:${fakeServer.port}/api`);
      const result = await zotero.addBook(makeBook());
      expect(result.duplicate).toBeTrue();
      expect(result.item_key).toBe("LEGACY01");
    } finally {
      searchResults = [];
    }
  });
});
