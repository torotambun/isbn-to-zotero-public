import { pageTotal } from "./ris";
import { parseISBN } from "./resolver";
import type { ReconciledBook } from "./types";

const API = "https://api.zotero.org";
type JsonObject = Record<string, unknown>;

export interface ZoteroCollection {
  key: string;
  name: string;
  parentCollection: string | null;
  path: string;
}

export interface ZoteroDuplicateMatch {
  itemKey: string;
  title: string;
  creators: string[];
  date: string;
  edition: string;
  publisher: string;
  ISBN: string;
  collections: string[];
  sameTitle: boolean;
  sameISBN: boolean;
}

export class ZoteroError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function responseMessage(raw: string, payload: unknown): string {
  const data = object(payload);
  const candidate = [data.message, data.error, data.reason].find(
    (value) => typeof value === "string" && value.trim(),
  );
  const message = typeof candidate === "string" ? candidate : raw;
  if (!message || /^\s*</.test(message)) return "";
  return message.replace(/\s+/g, " ").trim().slice(0, 300);
}

function writeToken(): string {
  // Zotero requires exactly 32 characters. randomUUID() contains four hyphens.
  return crypto.randomUUID().replaceAll("-", "");
}

async function request(
  path: string,
  key: string,
  init: RequestInit = {},
): Promise<unknown> {
  if (!key || key.length > 220) throw new ZoteroError("Enter a Zotero API key.", 400);
  const response = await fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Zotero-API-Version": "3",
      "Zotero-API-Key": key,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let payload: unknown = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ZoteroError(
        "The Zotero key is invalid or lacks personal-library write access.",
        response.status,
      );
    }
    if (response.status === 429) throw new ZoteroError("Zotero is limiting requests. Try again shortly.", 429);
    const detail = responseMessage(raw, payload);
    if (response.status === 400) {
      throw new ZoteroError(
        detail ? `Zotero rejected the record: ${detail}` : "Zotero rejected the record because one field was invalid.",
        400,
      );
    }
    throw new ZoteroError(
      detail ? `Zotero returned HTTP ${response.status}: ${detail}` : `Zotero returned HTTP ${response.status}.`,
      response.status,
    );
  }
  return payload;
}

export async function checkKey(key: string) {
  const payload = object(await request("/keys/current", key));
  const userAccess = object(object(payload.access).user);
  const profile = {
    userID: String(payload.userID ?? ""),
    username: String(payload.username ?? "Zotero user"),
    canWrite: userAccess.write === true,
  };
  if (!profile.userID) throw new ZoteroError("Zotero did not identify this key.", 502);
  if (!profile.canWrite) {
    throw new ZoteroError("This key cannot write to the personal library.", 403);
  }
  return profile;
}

export async function listCollections(key: string): Promise<ZoteroCollection[]> {
  const profile = await checkKey(key);
  const records: Array<Omit<ZoteroCollection, "path">> = [];

  for (let start = 0; start < 500; start += 100) {
    const query = new URLSearchParams({
      limit: "100",
      start: String(start),
      sort: "title",
      direction: "asc",
    });
    const payload = await request(
      `/users/${encodeURIComponent(profile.userID)}/collections?${query}`,
      key,
    );
    if (!Array.isArray(payload)) break;

    for (const wrapper of payload) {
      const container = object(wrapper);
      const data = object(container.data);
      const collectionKey = String(data.key ?? container.key ?? "");
      const name = String(data.name ?? "").trim();
      if (!collectionKey || !name) continue;
      const parent = data.parentCollection;
      records.push({
        key: collectionKey,
        name,
        parentCollection: typeof parent === "string" && parent ? parent : null,
      });
    }
    if (payload.length < 100) break;
  }

  const byKey = new Map(records.map((collection) => [collection.key, collection]));
  const pathFor = (collection: Omit<ZoteroCollection, "path">, trail = new Set<string>()): string => {
    if (!collection.parentCollection || trail.has(collection.key)) return collection.name;
    const parent = byKey.get(collection.parentCollection);
    if (!parent) return collection.name;
    const nextTrail = new Set(trail).add(collection.key);
    return `${pathFor(parent, nextTrail)} / ${collection.name}`;
  };

  return records
    .map((collection) => ({ ...collection, path: pathFor(collection) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function sameISBN(left: string, right: string): boolean {
  try {
    return parseISBN(left).canonical === parseISBN(right).canonical;
  } catch {
    return false;
  }
}

function titleTokens(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean),
  );
}

function normalizedTitle(value: string): string {
  return [...titleTokens(value)].join(" ");
}

function titleSimilar(left: string, right: string): boolean {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (!a.size || !b.size) return false;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.max(a.size, b.size) >= 0.82;
}

function creatorNames(data: JsonObject): string[] {
  if (!Array.isArray(data.creators)) return [];
  return data.creators
    .map((value) => {
      const creator = object(value);
      const singleField = String(creator.name ?? "").trim();
      if (singleField) return singleField;
      return [creator.firstName, creator.lastName]
        .map((part) => String(part ?? "").trim())
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean);
}

function isbnValues(value: unknown): string[] {
  return String(value ?? "")
    .replace(/[;,]/g, " ")
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function fullTitle(book: ReconciledBook): string {
  return book.subtitle && !book.title.toLowerCase().includes(book.subtitle.toLowerCase())
    ? `${book.title}: ${book.subtitle}`
    : book.title;
}

function extra(book: ReconciledBook): string {
  const lines = [`ISBN reconciliation: ${book.confidence}. ${book.reason}`];
  if (book.extent) lines.push(`Reported physical description: ${book.extent}`);
  if (Object.keys(book.conflicts).length) {
    lines.push("Source conflicts:");
    for (const [field, values] of Object.entries(book.conflicts)) {
      lines.push(`- ${field}: ${values.join(" | ")}`);
    }
  }
  if (book.source_records.length) {
    lines.push("Source records:");
    for (const record of book.source_records) {
      if (record.source_url) lines.push(`- ${record.source}: ${record.source_url}`);
    }
  }
  return lines.join("\n");
}

function item(book: ReconciledBook, collectionKey: string): JsonObject {
  const creators: JsonObject[] = [];
  for (const [creatorType, people] of [
    ["author", book.authors],
    ["editor", book.editors],
    ["translator", book.translators],
  ] as const) {
    for (const name of people) if (name) creators.push({ creatorType, name });
  }
  return {
    itemType: "book",
    title: fullTitle(book),
    creators,
    abstractNote: book.abstract,
    series: "",
    seriesNumber: "",
    volume: "",
    numberOfVolumes: "",
    edition: book.edition,
    place: book.place,
    publisher: book.publisher,
    date: book.date,
    numPages: pageTotal(book),
    language: book.languages.join("; "),
    ISBN: book.isbns.join(" "),
    shortTitle: "",
    url: book.source_records[0]?.source_url ?? "",
    accessDate: "",
    archive: "",
    archiveLocation: "",
    libraryCatalog: "ISBN-to-Zotero reconciliation",
    callNumber: "",
    rights: "",
    extra: extra(book),
    tags: book.subjects.map((tag) => ({ tag })),
    collections: collectionKey ? [collectionKey] : [],
    relations: {},
  };
}

async function duplicateMatchesForUser(
  key: string,
  userID: string,
  book: ReconciledBook,
): Promise<ZoteroDuplicateMatch[]> {
  const isbn = book.isbns.find((value) => value.length === 13) ?? book.isbns[0] ?? "";
  const searches: Promise<unknown>[] = [];
  if (isbn) {
    const isbnQuery = new URLSearchParams({
      q: isbn,
      qmode: "everything",
      itemType: "book",
      limit: "50",
    });
    searches.push(request(`/users/${encodeURIComponent(userID)}/items?${isbnQuery}`, key));
  }
  const titleQuery = new URLSearchParams({
    q: fullTitle(book).slice(0, 180),
    qmode: "titleCreatorYear",
    itemType: "book",
    limit: "50",
  });
  searches.push(request(`/users/${encodeURIComponent(userID)}/items?${titleQuery}`, key));

  const results = await Promise.all(searches);
  const records = new Map<string, JsonObject>();
  for (const payload of results) {
    if (!Array.isArray(payload)) continue;
    for (const wrapper of payload) {
      const container = object(wrapper);
      const data = object(container.data);
      const itemKey = String(data.key ?? container.key ?? "");
      if (itemKey) records.set(itemKey, data);
    }
  }

  const selectedTitle = fullTitle(book);
  const selectedISBNs = book.isbns.filter(Boolean);
  const matches: ZoteroDuplicateMatch[] = [];
  for (const data of records.values()) {
    const storedTitle = String(data.title ?? "").trim();
    const storedISBNs = isbnValues(data.ISBN);
    const sameTitle = titleSimilar(storedTitle, selectedTitle);
    const sameISBNValue = storedISBNs.some((stored) => selectedISBNs.some((selected) => sameISBN(stored, selected)));
    if (!sameTitle && !sameISBNValue) continue;
    matches.push({
      itemKey: String(data.key ?? ""),
      title: storedTitle || "Untitled Zotero book",
      creators: creatorNames(data),
      date: String(data.date ?? ""),
      edition: String(data.edition ?? ""),
      publisher: String(data.publisher ?? ""),
      ISBN: String(data.ISBN ?? ""),
      collections: Array.isArray(data.collections) ? data.collections.map(String).filter(Boolean) : [],
      sameTitle,
      sameISBN: sameISBNValue,
    });
  }

  return matches.sort((left, right) => {
    const leftRank = Number(left.sameISBN) * 2 + Number(normalizedTitle(left.title) === normalizedTitle(selectedTitle));
    const rightRank = Number(right.sameISBN) * 2 + Number(normalizedTitle(right.title) === normalizedTitle(selectedTitle));
    return rightRank - leftRank || left.date.localeCompare(right.date);
  });
}

export async function findDuplicateMatches(key: string, book: ReconciledBook): Promise<ZoteroDuplicateMatch[]> {
  if (!book.title) throw new ZoteroError("The selected record has no title.", 400);
  const profile = await checkKey(key);
  return duplicateMatchesForUser(key, profile.userID, book);
}

function validCollectionKey(value: string): boolean {
  return !value || /^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$/.test(value);
}

function validItemKey(value: string): boolean {
  return /^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$/.test(value);
}

export async function keepExistingItem(key: string, requestedItemKey: string, requestedCollectionKey = "") {
  const itemKey = requestedItemKey.trim();
  const collectionKey = requestedCollectionKey.trim();
  if (!validItemKey(itemKey)) throw new ZoteroError("The selected Zotero item is invalid.", 400);
  if (!validCollectionKey(collectionKey)) throw new ZoteroError("The selected Zotero collection is invalid.", 400);
  const profile = await checkKey(key);

  const wrapper = object(await request(
    `/users/${encodeURIComponent(profile.userID)}/items/${encodeURIComponent(itemKey)}`,
    key,
  ));
  const data = object(wrapper.data);
  if (String(data.itemType ?? "") !== "book") throw new ZoteroError("The selected Zotero record is not a book.", 400);
  const collections = Array.isArray(data.collections) ? data.collections.map(String).filter(Boolean) : [];
  let collectionAdded = false;
  if (collectionKey && !collections.includes(collectionKey)) {
    if (!data.version) throw new ZoteroError("Zotero did not return the current item version.", 502);
    await request(
      `/users/${encodeURIComponent(profile.userID)}/items/${encodeURIComponent(itemKey)}`,
      key,
      {
        method: "PATCH",
        body: JSON.stringify({
          version: data.version,
          collections: [...collections, collectionKey],
        }),
      },
    );
    collectionAdded = true;
  }

  return {
    created: false,
    duplicate: true,
    blocked: false,
    collectionAdded,
    itemKey,
    message: collectionAdded
      ? "The existing Zotero item was added to the selected collection."
      : collectionKey
        ? "The existing Zotero item is already in the selected collection."
        : "The existing Zotero item was kept. Nothing new was added.",
  };
}

export async function addBook(
  key: string,
  book: ReconciledBook,
  requestedCollectionKey = "",
  allowTitleDuplicate = false,
) {
  if (!book.title || !book.isbns.length) throw new ZoteroError("The selected record is incomplete.", 400);
  const collectionKey = requestedCollectionKey.trim();
  if (!validCollectionKey(collectionKey)) throw new ZoteroError("The selected Zotero collection is invalid.", 400);
  const profile = await checkKey(key);
  if (!allowTitleDuplicate) {
    const matches = await duplicateMatchesForUser(key, profile.userID, book);
    if (matches.length) {
      return {
        created: false,
        duplicate: true,
        blocked: true,
        collectionAdded: false,
        itemKey: "",
        matches,
        message: "A possible duplicate already exists in Zotero. Nothing was added.",
      };
    }
  }
  const payload = object(
    await request(`/users/${encodeURIComponent(profile.userID)}/items`, key, {
      method: "POST",
      headers: { "Zotero-Write-Token": writeToken() },
      body: JSON.stringify([item(book, collectionKey)]),
    }),
  );
  const failed = object(Object.values(object(payload.failed))[0]);
  if (failed.message) {
    throw new ZoteroError(`Zotero rejected the record: ${String(failed.message)}`, Number(failed.code) || 400);
  }
  const createdValue = Object.values(object(payload.successful ?? payload.success))[0];
  const created = object(createdValue);
  const itemKey = typeof createdValue === "string"
    ? createdValue
    : String(created.key ?? object(created.data).key ?? "");
  if (!itemKey) throw new ZoteroError("Zotero did not confirm the new item.", 502);
  return {
    created: true,
    duplicate: false,
    blocked: false,
    collectionAdded: Boolean(collectionKey),
    itemKey,
    message: collectionKey
      ? "Added to the selected Zotero collection."
      : "Added to My Library without a collection.",
  };
}
