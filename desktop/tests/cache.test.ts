import { describe, expect, test } from "bun:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ResolutionCache } from "../src/cache.ts";

describe("cache policy", () => {
  test("uses a one-day default TTL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "isbn-zotero-cache-test-"));
    try {
      const cache = new ResolutionCache(join(directory, "cache.json"));
      expect(cache.ttlMilliseconds).toBe(24 * 60 * 60 * 1_000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("discards the legacy unscoped cache format", async () => {
    const directory = await mkdtemp(join(tmpdir(), "isbn-zotero-cache-test-"));
    const path = join(directory, "cache.json");
    try {
      await writeFile(path, JSON.stringify({ old: { created: 1, value: { source: "Google Books" } } }));
      const cache = new ResolutionCache(path);
      expect(await cache.get("old")).toBeNull();
      await expect(access(path)).rejects.toBeDefined();

      await cache.put("safe", { records: [] });
      const stored = JSON.parse(await readFile(path, "utf8"));
      expect(stored.schema_version).toBe(2);
      expect(stored.entries.safe.value).toEqual({ records: [] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
