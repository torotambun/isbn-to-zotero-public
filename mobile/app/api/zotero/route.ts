import {
  addBook,
  checkKey,
  findDuplicateMatches,
  keepExistingItem,
  listCollections,
  ZoteroError,
} from "../../../lib/zotero-cloud";
import type { ReconciledBook } from "../../../lib/types";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: unknown;
      apiKey?: unknown;
      book?: ReconciledBook;
      collectionKey?: unknown;
      itemKey?: unknown;
      allowTitleDuplicate?: unknown;
    };
    const key = String(body.apiKey ?? "").trim();
    if (body.action === "check") {
      return Response.json({ profile: await checkKey(key) }, { headers: NO_STORE });
    }
    if (body.action === "collections") {
      return Response.json(
        { collections: await listCollections(key) },
        { headers: NO_STORE },
      );
    }
    if (body.action === "duplicates" && body.book) {
      return Response.json(
        { matches: await findDuplicateMatches(key, body.book) },
        { headers: NO_STORE },
      );
    }
    if (body.action === "use_existing") {
      return Response.json({
        result: await keepExistingItem(
          key,
          String(body.itemKey ?? ""),
          String(body.collectionKey ?? ""),
        ),
      }, { headers: NO_STORE });
    }
    if (body.action === "create" && body.book) {
      return Response.json({
        result: await addBook(
          key,
          body.book,
          String(body.collectionKey ?? ""),
          body.allowTitleDuplicate === true,
        ),
      }, { headers: NO_STORE });
    }
    return Response.json(
      { error: "Unsupported Zotero action." },
      { status: 400, headers: NO_STORE },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The Zotero request failed." },
      {
        status: error instanceof ZoteroError ? error.status : 500,
        headers: NO_STORE,
      },
    );
  }
}
