import assert from "node:assert/strict";
import test from "node:test";

const noISBNBook = {
  choice_id: "manual-1",
  title_cluster_id: "manual-work-1",
  title: "Madilog",
  subtitle: "Materialisme, dialektika, dan logika",
  authors: ["Tan Malaka"],
  editors: [],
  translators: [],
  publisher: "Widjaya",
  place: "Djakarta",
  date: "1951",
  edition: "Cetakan kedua",
  series: "Pustaka Rakyat",
  series_number: "7",
  volume: "",
  number_of_volumes: "",
  num_pages: "568",
  extent: "568 hlm.",
  languages: ["Indonesian"],
  isbns: [],
  subjects: [],
  abstract: "",
  notes: ["Transcribed from the physical book."],
  source_records: [],
  conflicts: {},
  confidence: "review",
  reason: "Manual record. Confirm every field.",
};

function workerImport(label) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(label, `${process.pid}-${Date.now()}-${Math.random()}`);
  return import(workerUrl.href);
}

test("searches by title without inventing an ISBN", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("onesearch.id")) return new Response("<rss><channel></channel></rss>");
    if (url.includes("openlibrary.org/search.json")) {
      return Response.json({
        docs: [{
          key: "/works/OL123W",
          title: "Madilog",
          author_name: ["Tan Malaka"],
          publisher: ["Widjaya"],
          publish_year: [1951],
          language: ["ind"],
          subject: ["Philosophy"],
        }],
      });
    }
    if (url.includes("googleapis.com/books")) return Response.json({ totalItems: 0, items: [] });
    throw new Error(`Unexpected external request: ${url}`);
  };

  try {
    const { default: worker } = await workerImport("title-search");
    const response = await worker.fetch(
      new Request("http://localhost/api/search-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Madilog", author: "Tan Malaka", publisher: "Widjaya", year: "1951" }),
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.valid, true);
    assert.equal(result.canonical, null);
    assert.equal(result.choices.length, 1);
    assert.equal(result.choices[0].title, "Madilog");
    assert.deepEqual(result.choices[0].isbns, []);
    assert.equal(result.recommended_choice_id, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an unusably short title before catalogue requests", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("must not be called");
  };
  try {
    const { default: worker } = await workerImport("short-title");
    const response = await worker.fetch(
      new Request("http://localhost/api/search-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "A" }),
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports catalogue outages separately from no matching record", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch failed");
  };
  try {
    const { default: worker } = await workerImport("title-source-outage");
    const response = await worker.fetch(
      new Request("http://localhost/api/search-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Madilog", author: "Tan Malaka" }),
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.state, "source_unavailable");
    assert.match(result.state_message, /not evidence/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creates a verified no-ISBN book with book and series fields", async () => {
  const originalFetch = globalThis.fetch;
  let submittedRequest;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/keys/current")) {
      return Response.json({ userID: "42", username: "test-user", access: { user: { write: true } } });
    }
    if (url.includes("/users/42/items?") && !init.method) return Response.json([]);
    if (url.endsWith("/users/42/items") && init.method === "POST") {
      submittedRequest = init;
      return Response.json({ successful: { 0: { key: "ABCD2345" } }, failed: {} });
    }
    throw new Error(`Unexpected external request: ${url}`);
  };

  try {
    const { default: worker } = await workerImport("no-isbn-create");
    const response = await worker.fetch(
      new Request("http://localhost/api/zotero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", apiKey: "test-key", book: noISBNBook, collectionKey: "BCDE3456" }),
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.created, true);
    const submitted = JSON.parse(submittedRequest.body)[0];
    assert.equal(submitted.ISBN, "");
    assert.equal(submitted.series, "Pustaka Rakyat");
    assert.equal(submitted.seriesNumber, "7");
    assert.equal(submitted.libraryCatalog, "Physical-book transcription");
    assert.match(submittedRequest.headers["Zotero-Write-Token"], /^[0-9a-f]{32}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
