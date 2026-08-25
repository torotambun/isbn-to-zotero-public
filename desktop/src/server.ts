import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

import { STATIC_ASSETS } from "./assets.ts";
import { ResolutionCache } from "./cache.ts";
import { ISBNValidationError, parseISBN } from "./isbn.ts";
import { splitManifestationStatement } from "./manifestation.ts";
import { Resolver } from "./resolver.ts";
import { bookToRIS, safeFilename } from "./ris.ts";
import type { ReconciledBook, Resolution } from "./types.ts";
import { LocalZotero, LocalZoteroError } from "./zotero.ts";

type JsonObject = Record<string, unknown>;
const APP_ID = "isbn-to-zotero";
const APP_VERSION = "1.2.0";

function migrateResolution(resolution: Resolution): Resolution {
  const migrated = structuredClone(resolution);
  const migrateRecord = (record: ReconciledBook["source_records"][number]) => {
    if (!("printing" in record) || (!record.printing && record.edition)) {
      const statement = splitManifestationStatement(record.edition);
      record.edition = statement.edition;
      record.printing = statement.printing;
    }
    record.printing ??= "";
  };
  migrated.records.forEach(migrateRecord);
  migrated.choices.forEach(choice => {
    if (!("printing" in choice) || (!choice.printing && choice.edition)) {
      const statement = splitManifestationStatement(choice.edition);
      choice.edition = statement.edition;
      choice.printing = statement.printing;
    }
    choice.printing ??= "";
    choice.requires_physical_confirmation ??= choice.confidence !== "high";
    choice.source_records.forEach(migrateRecord);
  });
  return migrated;
}

export class AppState {
  readonly resolver: Resolver;
  readonly cache: ResolutionCache;
  readonly zotero: LocalZotero;

  constructor(
    resolver = new Resolver(),
    cache = new ResolutionCache(join(homedir(), "Library", "Caches", "ISBN to Zotero", "cache.json")),
    zotero = new LocalZotero(),
  ) {
    this.resolver = resolver;
    this.cache = cache;
    this.zotero = zotero;
  }

  async resolve(rawInput: string, refresh = false): Promise<Resolution> {
    let key: string | null = null;
    try {
      key = parseISBN(rawInput).canonical;
    } catch (error) {
      if (!(error instanceof ISBNValidationError)) throw error;
      return this.resolver.resolveOne(rawInput);
    }
    if (!refresh) {
      const cached = await this.cache.get<Resolution>(key);
      if (cached) return migrateResolution(cached);
    }
    const resolution = await this.resolver.resolveOne(rawInput);
    await this.cache.put(key, resolution);
    return migrateResolution(resolution);
  }
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

async function readJSON(request: Request): Promise<JsonObject> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > 1_000_000) throw new Error("Invalid request body");
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new Error("Request body must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  return value as JsonObject;
}

function applyOverrides(choice: ReconciledBook, rawOverrides: unknown): void {
  const overrides = asObject(rawOverrides);
  const scalarFields = ["title", "subtitle", "publisher", "place", "date", "edition", "printing", "num_pages", "extent", "abstract"] as const;
  const listFields = ["authors", "editors", "translators", "languages", "subjects", "isbns"] as const;
  for (const field of scalarFields) {
    if (field in overrides) choice[field] = String(overrides[field] ?? "").trim().replace(/\s+/g, " ");
  }
  for (const field of listFields) {
    if (!(field in overrides)) continue;
    const value = overrides[field];
    const values = typeof value === "string"
      ? value.replaceAll("\n", ";").split(";")
      : Array.isArray(value) ? value.map(item => String(item)) : [];
    choice[field] = values.map(item => item.trim()).filter(Boolean);
  }
}

async function selectedChoice(state: AppState, body: JsonObject): Promise<ReconciledBook | null> {
  const resolution = await state.resolve(String(body.isbn ?? ""));
  const choice = state.resolver.findChoice(resolution, String(body.choice_id ?? ""));
  if (!choice) return null;
  applyOverrides(choice, body.overrides);
  return choice;
}

export function createHandler(state: AppState): (request: Request) => Promise<Response> {
  return async request => {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const asset = STATIC_ASSETS[url.pathname as keyof typeof STATIC_ASSETS];
      if (asset) {
        const filePath = asset.file.startsWith("./") ? resolvePath(import.meta.dir, asset.file) : asset.file;
        return new Response(Bun.file(filePath), {
          headers: { "Content-Type": asset.contentType, "Cache-Control": "no-cache" },
        });
      }
      if (url.pathname === "/api/health") return json({ ok: true, app: APP_ID, version: APP_VERSION });
      if (url.pathname === "/api/zotero/status") return json(await state.zotero.status());
      return new Response("Not Found", { status: 404 });
    }

    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    let body: JsonObject;
    try {
      body = await readJSON(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }

    if (url.pathname === "/api/resolve") {
      if (!Array.isArray(body.isbns) || !body.isbns.length) return json({ error: "Provide at least one ISBN." }, 400);
      const values = body.isbns.slice(0, 50).map(value => String(value));
      const refresh = Boolean(body.refresh);
      const results = await Promise.all(values.map(value => state.resolve(value, refresh)));
      return json({ results });
    }
    if (url.pathname === "/api/export") {
      const choice = await selectedChoice(state, body);
      if (!choice) return json({ error: "The selected edition is no longer available. Search again." }, 404);
      if (!choice.title) return json({ error: "A title is required before export." }, 400);
      if (choice.requires_physical_confirmation && body.physical_confirmed !== true) {
        return json({
          error: "Confirm that this candidate matches the physical title and copyright pages.",
          code: "physical_confirmation_required",
        }, 400);
      }
      const data = bookToRIS(choice);
      return new Response(data, {
        headers: {
          "Content-Type": "application/x-research-info-systems; charset=utf-8",
          "Content-Disposition": `attachment; filename="${safeFilename(choice)}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    if (url.pathname === "/api/zotero") {
      const choice = await selectedChoice(state, body);
      if (!choice) return json({ error: "The selected edition is no longer available. Search again." }, 404);
      if (!choice.title) return json({ error: "A title is required before direct import." }, 400);
      if (choice.requires_physical_confirmation && body.physical_confirmed !== true) {
        return json({
          error: "Confirm that this candidate matches the physical title and copyright pages.",
          code: "physical_confirmation_required",
        }, 400);
      }
      try {
        return json(await state.zotero.addBook(choice));
      } catch (error) {
        if (!(error instanceof LocalZoteroError)) throw error;
        return json({ error: error.message, code: error.code }, error.status === 403 ? 403 : 409);
      }
    }
    return new Response("Not Found", { status: 404 });
  };
}

export function openBrowser(url: string): void {
  const command = process.platform === "darwin"
    ? ["/usr/bin/open", url]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : ["xdg-open", url];
  try {
    Bun.spawn({ cmd: command, stdout: "ignore", stderr: "ignore" }).unref();
  } catch {
    // The URL remains in the log when no default browser can be opened.
  }
}

export function startServer(options: { hostname?: string; port?: number; open?: boolean; state?: AppState } = {}) {
  const hostname = options.hostname ?? "127.0.0.1";
  const server = Bun.serve({
    hostname,
    port: options.port ?? 8765,
    fetch: createHandler(options.state ?? new AppState()),
  });
  const url = `http://${hostname}:${server.port}`;
  console.log(`ISBN to Zotero is running at ${url}`);
  if (options.open !== false) setTimeout(() => openBrowser(url), 450);
  return server;
}

if (import.meta.main) {
  const noOpen = process.argv.includes("--no-open");
  const portIndex = process.argv.indexOf("--port");
  const portValue = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 8765;
  const requestedPort = Number.isInteger(portValue) && portValue >= 0 ? portValue : 8765;
  const defaultURL = `http://127.0.0.1:${requestedPort}`;
  let existing = false;
  if (requestedPort !== 0) {
    try {
      const response = await fetch(`${defaultURL}/api/health`, { signal: AbortSignal.timeout(450) });
      const payload = await response.json();
      existing = response.ok && payload?.ok === true && payload?.app === APP_ID;
    } catch {
      existing = false;
    }
  }
  if (existing) {
    console.log(`ISBN to Zotero is already running at ${defaultURL}`);
    if (!noOpen) openBrowser(defaultURL);
  } else {
    try {
      startServer({ port: requestedPort, open: !noOpen });
    } catch (error) {
      if (requestedPort === 0) throw error;
      console.warn(`Port ${requestedPort} is occupied. Using a temporary local port.`);
      startServer({ port: 0, open: !noOpen });
    }
  }
}
