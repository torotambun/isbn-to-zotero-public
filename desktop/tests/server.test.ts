import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ResolutionCache } from "../src/cache.ts";
import { Resolver } from "../src/resolver.ts";
import { AppState, createHandler, startServer } from "../src/server.ts";
import { LocalZotero } from "../src/zotero.ts";
import { makeBook } from "./ris.test.ts";
import type { Resolution } from "../src/types.ts";

let server: ReturnType<typeof Bun.serve>;
let baseURL: string;

beforeAll(() => {
  const state = new AppState(
    new Resolver([]),
    new ResolutionCache(join(tmpdir(), `isbn-to-zotero-test-${process.pid}.json`)),
    new LocalZotero(100),
  );
  server = startServer({ hostname: "127.0.0.1", port: 0, open: false, state });
  baseURL = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

describe("desktop HTTP interface", () => {
  test("serves the app and health endpoint", async () => {
    expect(await (await fetch(`${baseURL}/api/health`)).json()).toEqual({ ok: true, app: "isbn-to-zotero", version: "1.2.0" });
    const frontPage = await (await fetch(`${baseURL}/`)).text();
    expect(frontPage).toContain("ISBN to Zotero");
    expect(frontPage).toContain("Google Books is not queried");
  });

  test("returns an invalid ISBN without contacting sources", async () => {
    const response = await fetch(`${baseURL}/api/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbns: ["9786028174887"] }),
    });
    const payload = await response.json();
    expect(payload.results[0].valid).toBeFalse();
    expect(payload.results[0].state).toBe("invalid");
  });

  test("rejects review export without server-side physical confirmation", async () => {
    const choice = makeBook();
    choice.confidence = "review";
    choice.requires_physical_confirmation = true;
    const resolution: Resolution = {
      raw_input: "9786028174886",
      valid: true,
      isbn10: "6028174882",
      isbn13: "9786028174886",
      canonical: "9786028174886",
      validation_message: "",
      source_statuses: [],
      records: choice.source_records,
      choices: [choice],
      state: "review",
      state_message: "Review required.",
      recommended_choice_id: choice.choice_id,
    };
    const fakeState = {
      resolve: async () => structuredClone(resolution),
      resolver: { findChoice: (value: Resolution, choiceID: string) => value.choices.find(item => item.choice_id === choiceID) ?? null },
      zotero: new LocalZotero(100),
    } as unknown as AppState;
    const handler = createHandler(fakeState);
    const request = (path: "/api/export" | "/api/zotero", physicalConfirmed?: boolean) => new Request(`http://127.0.0.1${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isbn: resolution.raw_input,
        choice_id: choice.choice_id,
        overrides: {},
        ...(physicalConfirmed === undefined ? {} : { physical_confirmed: physicalConfirmed }),
      }),
    });
    const rejected = await handler(request("/api/export"));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).code).toBe("physical_confirmation_required");
    const zoteroRejected = await handler(request("/api/zotero"));
    expect(zoteroRejected.status).toBe(400);
    expect((await zoteroRejected.json()).code).toBe("physical_confirmation_required");
    const accepted = await handler(request("/api/export", true));
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toContain("TY  - BOOK");
  });
});
