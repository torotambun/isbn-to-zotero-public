import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface CacheEntry {
  created: number;
  value: unknown;
}

const CACHE_SCHEMA_VERSION = 2;

export class ResolutionCache {
  readonly path: string;
  readonly ttlMilliseconds: number;
  private data = new Map<string, CacheEntry>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(path: string, ttlMilliseconds = 24 * 60 * 60 * 1_000) {
    this.path = path;
    this.ttlMilliseconds = ttlMilliseconds;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)
        && (parsed as { schema_version?: unknown }).schema_version === CACHE_SCHEMA_VERSION) {
        const entries = (parsed as { entries?: unknown }).entries;
        if (!entries || typeof entries !== "object" || Array.isArray(entries)) return;
        for (const [key, value] of Object.entries(entries as Record<string, CacheEntry>)) {
          if (value && typeof value === "object") this.data.set(key, value);
        }
        return;
      }
    } catch {
      // Unsupported, malformed, or absent caches are treated as empty.
    }
    this.data.clear();
    try {
      await rm(this.path, { force: true });
    } catch {
      // A locked-down filesystem may prevent legacy-cache removal.
    }
  }

  async get<T>(key: string): Promise<T | null> {
    await this.load();
    const item = this.data.get(key);
    if (!item || Date.now() - Number(item.created ?? 0) > this.ttlMilliseconds) return null;
    return item.value as T;
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.load();
    this.data.set(key, { created: Date.now(), value });
    this.writeChain = this.writeChain.then(async () => {
      try {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.tmp`;
        const payload = { schema_version: CACHE_SCHEMA_VERSION, entries: Object.fromEntries(this.data) };
        await writeFile(temporary, JSON.stringify(payload, null, 2), "utf8");
        await rename(temporary, this.path);
      } catch {
        // Search results still work on a locked-down filesystem.
      }
    });
    await this.writeChain;
  }
}
