import { resolveByTitle } from "../../../lib/title-resolver";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      title?: unknown;
      author?: unknown;
      publisher?: unknown;
      year?: unknown;
    };
    const result = await resolveByTitle({
      title: String(body.title ?? ""),
      author: String(body.author ?? ""),
      publisher: String(body.publisher ?? ""),
      year: String(body.year ?? ""),
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The title search failed." },
      { status: 400 },
    );
  }
}
