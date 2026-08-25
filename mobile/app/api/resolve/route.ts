import { resolveISBN } from "../../../lib/resolver";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { isbn?: unknown };
    const result = await resolveISBN(String(body.isbn ?? "").slice(0, 80));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The catalogue search failed." },
      { status: 500 },
    );
  }
}
