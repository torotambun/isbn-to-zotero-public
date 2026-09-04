import assert from "node:assert/strict";
import test from "node:test";

const book = {
  choice_id: "edition-test",
  title_cluster_id: "title-test",
  title: "Bukan 350 Tahun Dijajah",
  subtitle: "",
  authors: ["Resink, G.J"],
  editors: ["Tim Komunitas Bambu"],
  translators: [],
  publisher: "Komunitas Bambu",
  place: "Depok",
  date: "2012",
  edition: "Printing 1",
  series: "",
  series_number: "",
  volume: "",
  number_of_volumes: "",
  num_pages: "",
  extent: "xxxiv + 366 pg; 24 cm",
  languages: ["Indonesian"],
  isbns: ["9786029402063", "6029402064"],
  subjects: [],
  abstract: "",
  notes: [],
  source_records: [],
  conflicts: {},
  confidence: "review",
  reason: "Match the physical edition.",
};

test("accepts an ISBN-10 with X as its printed check digit", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response("Not found", { status: 404 });

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("isbn-x-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isbn: "979-428-047-X" }),
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );

    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.valid, true);
    assert.equal(result.isbn10, "979428047X");
    assert.equal(result.canonical, "9789794280478");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creates a Zotero book with a valid 32-character write token", async () => {
  const originalFetch = globalThis.fetch;
  let submittedRequest;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/keys/current")) {
      return Response.json({
        userID: "42",
        username: "test-user",
        access: { user: { write: true } },
      });
    }
    if (url.includes("/users/42/items?") && !init.method) return Response.json([]);
    if (url.endsWith("/users/42/items") && init.method === "POST") {
      submittedRequest = init;
      return Response.json({ successful: { 0: { key: "ABCD2345" } }, unchanged: {}, failed: {} });
    }
    throw new Error(`Unexpected external request: ${url}`);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/zotero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", apiKey: "test-key", book, collectionKey: "BCDE3456" }),
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      result: {
        created: true,
        duplicate: false,
        blocked: false,
        collectionAdded: true,
        itemKey: "ABCD2345",
        message: "Added to the selected Zotero collection.",
      },
    });
    assert.ok(submittedRequest);
    assert.match(submittedRequest.headers["Zotero-Write-Token"], /^[0-9a-f]{32}$/);
    const submittedBook = JSON.parse(submittedRequest.body)[0];
    assert.equal(submittedBook.title, book.title);
    assert.deepEqual(submittedBook.collections, ["BCDE3456"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("lists Zotero collections with readable parent paths", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/keys/current")) {
      return Response.json({
        userID: "42",
        username: "test-user",
        access: { user: { write: true } },
      });
    }
    if (url.includes("/users/42/collections?")) {
      return Response.json([
        { key: "BCDE3456", data: { key: "BCDE3456", name: "Research", parentCollection: false } },
        { key: "CDEF3456", data: { key: "CDEF3456", name: "Indonesian Books", parentCollection: "BCDE3456" } },
      ]);
    }
    throw new Error(`Unexpected external request: ${url}`);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("collections-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/zotero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "collections", apiKey: "test-key" }),
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );

    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).collections.map(({ key, path }) => ({ key, path })), [
      { key: "BCDE3456", path: "Research" },
      { key: "CDEF3456", path: "Research / Indonesian Books" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("blocks creation when Zotero already has the same title without an ISBN", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/keys/current")) {
      return Response.json({
        userID: "42",
        username: "test-user",
        access: { user: { write: true } },
      });
    }
    if (url.includes("/users/42/items?") && !init.method) {
      if (url.includes("qmode=everything")) return Response.json([]);
      return Response.json([{
        data: {
          key: "ABCD2345",
          version: 7,
          itemType: "book",
          title: "Bukan 350 tahun dijajah",
          creators: [{ creatorType: "author", name: "G.J. Resink" }],
          date: "2012",
          edition: "Printing 1",
          publisher: "Komunitas Bambu",
          ISBN: "",
          collections: [],
        },
      }]);
    }
    throw new Error(`Unexpected external request: ${url}`);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("duplicate-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/zotero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", apiKey: "test-key", book, collectionKey: "BCDE3456" }),
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.result.created, false);
    assert.equal(payload.result.duplicate, true);
    assert.equal(payload.result.blocked, true);
    assert.equal(payload.result.matches.length, 1);
    assert.deepEqual(payload.result.matches[0], {
      itemKey: "ABCD2345",
      title: "Bukan 350 tahun dijajah",
      creators: ["G.J. Resink"],
      date: "2012",
      edition: "Printing 1",
      publisher: "Komunitas Bambu",
      ISBN: "",
      collections: [],
      sameTitle: true,
      sameISBN: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("files the selected existing item instead of creating another item", async () => {
  const originalFetch = globalThis.fetch;
  let patchRequest;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/keys/current")) {
      return Response.json({
        userID: "42",
        username: "test-user",
        access: { user: { write: true } },
      });
    }
    if (url.endsWith("/users/42/items/ABCD2345") && !init.method) {
      return Response.json({
        data: {
          key: "ABCD2345",
          version: 7,
          itemType: "book",
          title: book.title,
          collections: [],
        },
      });
    }
    if (url.endsWith("/users/42/items/ABCD2345") && init.method === "PATCH") {
      patchRequest = init;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected external request: ${url}`);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("use-existing-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/zotero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "use_existing",
          apiKey: "test-key",
          itemKey: "ABCD2345",
          collectionKey: "BCDE3456",
        }),
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      result: {
        created: false,
        duplicate: true,
        blocked: false,
        collectionAdded: true,
        itemKey: "ABCD2345",
        message: "The existing Zotero item was added to the selected collection.",
      },
    });
    assert.ok(patchRequest);
    assert.deepEqual(JSON.parse(patchRequest.body), { version: 7, collections: ["BCDE3456"] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("allows an explicitly confirmed different edition", async () => {
  const originalFetch = globalThis.fetch;
  let submittedRequest;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/keys/current")) {
      return Response.json({
        userID: "42",
        username: "test-user",
        access: { user: { write: true } },
      });
    }
    if (url.endsWith("/users/42/items") && init.method === "POST") {
      submittedRequest = init;
      return Response.json({ successful: { 0: { key: "CDEF3456" } }, unchanged: {}, failed: {} });
    }
    throw new Error(`Unexpected external request: ${url}`);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("different-edition-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/zotero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          apiKey: "test-key",
          book,
          collectionKey: "BCDE3456",
          allowTitleDuplicate: true,
        }),
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );

    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.created, true);
    assert.ok(submittedRequest);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
