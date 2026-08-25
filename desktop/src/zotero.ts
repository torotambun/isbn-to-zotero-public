import { randomBytes } from "node:crypto";

import { equivalentISBN } from "./isbn.ts";
import { normalizeText, sequenceRatio, titleSimilarity } from "./reconcile.ts";
import { pageTotal } from "./ris.ts";
import type { ReconciledBook } from "./types.ts";

const DEFAULT_BASE_URL = "http://127.0.0.1:23119/api";

type JsonObject = Record<string, unknown>;

export class LocalZoteroError extends Error {
  code: string;
  status: number | null;

  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = "LocalZoteroError";
    this.code = code;
    this.status = status;
  }
}

export class LocalZotero {
  readonly timeoutMilliseconds: number;
  readonly baseURL: string;
  private rememberedKeys = new Map<string, string>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(timeoutMilliseconds = 90_000, baseURL = DEFAULT_BASE_URL) {
    this.timeoutMilliseconds = timeoutMilliseconds;
    this.baseURL = baseURL.replace(/\/+$/, "");
  }

  async status(): Promise<JsonObject> {
    try {
      const response = await this.request("GET", `${this.baseURL}/`, {}, undefined, 4_000);
      const serverID = response.headers.get("Zotero-Server-ID") ?? "";
      const version = response.headers.get("Zotero-API-Version") ?? "";
      if (!serverID) {
        return {
          available: false,
          code: "write_api_unavailable",
          message: "Zotero responded, but this version does not expose authorized local writes. Use RIS import.",
        };
      }
      return {
        available: true,
        code: "ready",
        message: "Zotero is open and direct import is available.",
        server_id: serverID,
        api_version: version || "3",
      };
    } catch (error) {
      if (!(error instanceof LocalZoteroError)) throw error;
      return { available: false, code: error.code, message: error.message };
    }
  }

  async addBook(book: ReconciledBook): Promise<JsonObject> {
    let release!: () => void;
    const previous = this.writeChain;
    this.writeChain = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const connection = await this.status();
      if (!connection.available) {
        throw new LocalZoteroError(String(connection.code ?? "unavailable"), String(connection.message ?? "Zotero is unavailable."));
      }
      const serverID = String(connection.server_id);
      const duplicate = await this.findDuplicate(book, serverID);
      if (duplicate) {
        return {
          created: false,
          duplicate: true,
          message: "A likely matching book already exists in Zotero. No duplicate was created.",
          item_key: duplicate.key ?? "",
          title: duplicate.title ?? "",
        };
      }

      const template = await this.newBookTemplate(serverID);
      const item = LocalZotero.fillTemplate(template, book);
      let key = this.rememberedKeys.get(serverID);
      if (!key) {
        const authorization = await this.authorize(serverID);
        key = authorization.key;
        if (authorization.remember) this.rememberedKeys.set(serverID, key);
      }

      let response: JsonObject;
      try {
        response = await this.writeItem(serverID, key, item);
      } catch (error) {
        if (!(error instanceof LocalZoteroError) || error.status !== 401) throw error;
        this.rememberedKeys.delete(serverID);
        const authorization = await this.authorize(serverID);
        key = authorization.key;
        if (authorization.remember) this.rememberedKeys.set(serverID, key);
        response = await this.writeItem(serverID, key, item);
      }

      const successful = asObject(response.successful);
      const created = Object.values(successful)[0];
      if (created && typeof created === "object") {
        return {
          created: true,
          duplicate: false,
          message: "The book was added directly to Zotero.",
          item_key: asObject(created).key ?? "",
          title: book.title,
        };
      }
      const failed = asObject(response.failed);
      const detail = Object.keys(failed).length ? JSON.stringify(failed) : "Zotero did not report a created item.";
      throw new LocalZoteroError("write_failed", `Zotero rejected the item: ${detail}`);
    } finally {
      release();
    }
  }

  private async findDuplicate(book: ReconciledBook, serverID: string): Promise<JsonObject | null> {
    const queryISBN = book.isbns.find(value => value.length === 13) ?? book.isbns[0] ?? "";
    const queryValues = [queryISBN, book.title].filter(Boolean);
    const candidates = new Map<string, JsonObject>();
    for (const queryValue of queryValues) {
      const query = new URLSearchParams({ q: queryValue, qmode: "everything", itemType: "book", limit: "50" });
      const response = await this.request("GET", `${this.baseURL}/users/0/items?${query}`, {
        "Zotero-Server-ID": serverID,
        "Zotero-API-Version": "3",
      }, undefined, 10_000);
      if (!Array.isArray(response.payload)) continue;
      response.payload.forEach((wrapper, index) => {
        const data = asObject(asObject(wrapper).data);
        const key = String(data.key ?? "") || `${queryValue}:${index}`;
        candidates.set(key, data);
      });
    }
    for (const data of candidates.values()) {
      const storedISBNs = String(data.ISBN ?? "").replace(/[;,]/g, " ").split(/\s+/).filter(Boolean);
      const sameISBN = Boolean(queryISBN) && storedISBNs.some(value => equivalentISBN(queryISBN, value));
      const titleScore = titleSimilarity(book.title, String(data.title ?? ""));
      if (sameISBN && titleScore >= 0.86) return data;
      if (!storedISBNs.length && titleScore >= 0.92 && (
        LocalZotero.creatorMatches(book, data) || LocalZotero.yearMatches(book.date, String(data.date ?? ""))
      )) return data;
    }
    return null;
  }

  private static creatorMatches(book: ReconciledBook, data: JsonObject): boolean {
    const key = (value: string): string => normalizeText(value.replaceAll(",", " ")).split(" ").sort().join(" ");
    const expected = book.authors.map(key).filter(Boolean);
    const creators = Array.isArray(data.creators) ? data.creators : [];
    const stored = creators.map(value => {
      const creator = asObject(value);
      const displayName = String(creator.name ?? "").trim();
      const splitName = [creator.firstName, creator.lastName].map(item => String(item ?? "").trim()).filter(Boolean).join(" ");
      return key(displayName || splitName);
    }).filter(Boolean);
    return expected.some(left => stored.some(right => sequenceRatio(left, right) >= 0.84));
  }

  private static yearMatches(left: string, right: string): boolean {
    const first = left.match(/\b(?:1[5-9]\d{2}|20\d{2}|2100)\b/)?.[0];
    const second = right.match(/\b(?:1[5-9]\d{2}|20\d{2}|2100)\b/)?.[0];
    return Boolean(first && second && first === second);
  }

  private async newBookTemplate(serverID: string): Promise<JsonObject> {
    const response = await this.request("GET", `${this.baseURL}/items/new?itemType=book`, {
      "Zotero-Server-ID": serverID,
      "Zotero-API-Version": "3",
    }, undefined, 10_000);
    const template = asObject(response.payload);
    if (template.itemType !== "book") throw new LocalZoteroError("template_failed", "Zotero did not return a valid book template.");
    return template;
  }

  private async authorize(serverID: string): Promise<{ key: string; remember: boolean }> {
    const response = await this.request("POST", `${this.baseURL}/local/authorize`, {
      "Zotero-Server-ID": serverID,
      "Zotero-API-Version": "3",
    }, { appName: "ISBN to Zotero" }, this.timeoutMilliseconds);
    const payload = asObject(response.payload);
    if (!payload.key) throw new LocalZoteroError("authorization_failed", "Zotero did not grant a local write key.");
    return { key: String(payload.key), remember: Boolean(payload.remember) };
  }

  private async writeItem(serverID: string, key: string, item: JsonObject): Promise<JsonObject> {
    const response = await this.request("POST", `${this.baseURL}/users/0/items`, {
      "Zotero-Server-ID": serverID,
      "Zotero-API-Version": "3",
      "Zotero-API-Key": key,
      "Zotero-Write-Token": randomBytes(16).toString("hex"),
    }, [item], 20_000);
    return asObject(response.payload);
  }

  static fillTemplate(template: JsonObject, book: ReconciledBook): JsonObject {
    const item = structuredClone(template);
    const fullTitle = book.subtitle && !book.title.toLocaleLowerCase().includes(book.subtitle.toLocaleLowerCase())
      ? `${book.title}: ${book.subtitle}`
      : book.title;
    const values: Record<string, string> = {
      title: fullTitle,
      abstractNote: book.abstract,
      edition: book.edition,
      place: book.place,
      publisher: book.publisher,
      date: book.date,
      numPages: pageTotal(book),
      language: book.languages.join("; "),
      ISBN: book.isbns.join(" "),
      url: book.source_records[0]?.source_url ?? "",
      libraryCatalog: "ISBN-to-Zotero reconciliation",
      extra: LocalZotero.extra(book),
    };
    for (const [field, value] of Object.entries(values)) if (field in item && value) item[field] = value;
    const creators: JsonObject[] = [];
    for (const [creatorType, people] of [
      ["author", book.authors],
      ["editor", book.editors],
      ["translator", book.translators],
    ] as const) {
      for (const person of people) if (person) creators.push({ creatorType, name: person });
    }
    item.creators = creators;
    if ("tags" in item) item.tags = book.subjects.filter(Boolean).map(tag => ({ tag }));
    item.collections = [];
    item.relations = {};
    return item;
  }

  static extra(book: ReconciledBook): string {
    const lines = [`ISBN-to-Zotero assessment: ${book.confidence}. ${book.reason}`];
    if (book.printing) lines.push(`Printing statement: ${book.printing}`);
    if (book.extent) lines.push(`Reported physical description: ${book.extent}`);
    if (Object.keys(book.conflicts).length) {
      lines.push("Source conflicts:");
      for (const [field, values] of Object.entries(book.conflicts)) lines.push(`- ${field}: ${values.join(" | ")}`);
    }
    if (book.source_records.length) {
      lines.push("Source records:");
      for (const record of book.source_records) lines.push(`- ${record.source}: ${record.source_url}`);
    }
    return lines.join("\n");
  }

  private async request(
    method: string,
    url: string,
    headers: Record<string, string> = {},
    body?: unknown,
    timeoutMilliseconds = this.timeoutMilliseconds,
  ): Promise<{ status: number; headers: Headers; payload: unknown }> {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMilliseconds),
      });
    } catch (error) {
      throw new LocalZoteroError(
        "zotero_not_running",
        "Zotero is not reachable. Open Zotero, or download the RIS file instead.",
      );
    }
    const raw = await response.text();
    let payload: unknown = {};
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        if (response.ok) throw new LocalZoteroError("invalid_response", "Zotero returned an unreadable response.");
      }
    }
    if (!response.ok) {
      const denied = Boolean(asObject(payload).denied);
      let message: string;
      let code: string;
      if (response.status === 401) [message, code] = ["Zotero requires a new write authorization.", "unauthorized"];
      else if (response.status === 403 && denied) [message, code] = ["The Zotero write request was denied.", "authorization_denied"];
      else if (response.status === 403) [message, code] = [
        "Enable ‘Allow other applications on this computer to communicate with Zotero’ in Zotero Settings > Advanced.",
        "local_api_disabled",
      ];
      else if (response.status === 412) [message, code] = ["The Zotero database changed. Try the direct import again.", "server_changed"];
      else if (response.status === 428) [message, code] = ["Zotero rejected a missing write precondition.", "precondition_required"];
      else if (response.status === 429) [message, code] = ["Zotero is limiting repeated authorization prompts. Wait a minute and try again.", "authorization_rate_limited"];
      else [message, code] = [`Zotero returned HTTP ${response.status}.`, "zotero_http_error"];
      throw new LocalZoteroError(code, message, response.status);
    }
    return { status: response.status, headers: response.headers, payload };
  }
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
