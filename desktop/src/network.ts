export const USER_AGENT = "ISBN-to-Zotero/1.2 (local personal bibliographic resolver)";

export function applicationUserAgent(contact = ""): string {
  const cleaned = String(contact).trim().replace(/\s+/g, " ").slice(0, 200);
  if (!cleaned) return USER_AGENT;
  return `ISBN-to-Zotero/1.2 (local personal bibliographic resolver; contact: ${cleaned})`;
}

export class RequestPacer {
  readonly minimumIntervalMs: number;
  private queue: Promise<void> = Promise.resolve();
  private nextStart = 0;

  constructor(minimumIntervalMs: number) {
    this.minimumIntervalMs = Math.max(Number(minimumIntervalMs) || 0, 0);
  }

  async wait(): Promise<void> {
    let release = () => {};
    const previous = this.queue;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const delay = this.nextStart - Date.now();
      if (delay > 0) await Bun.sleep(delay);
      this.nextStart = Date.now() + this.minimumIntervalMs;
    } finally {
      release();
    }
  }
}

export class FetchError extends Error {
  url: string;
  status: number | null;
  temporary: boolean;

  constructor(url: string, message: string, status: number | null = null, temporary = false) {
    super(message);
    this.name = "FetchError";
    this.url = url;
    this.status = status;
    this.temporary = temporary;
  }
}

function sourceMessage(status: number): string {
  if (status === 404) return "No record at this source";
  if (status === 429) return "Source rate limit reached";
  return `HTTP ${status} from source`;
}

export async function fetchText(
  url: string,
  accept = "text/plain,*/*",
  timeoutMs = 18_000,
  userAgent = USER_AGENT,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": userAgent, Accept: accept },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new FetchError(url, `Source unavailable: ${detail}`, null, true);
  }
  if (!response.ok) {
    const temporary = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
    throw new FetchError(url, sourceMessage(response.status), response.status, temporary);
  }
  return response.text();
}

export async function fetchJSON(url: string, timeoutMs = 18_000, userAgent = USER_AGENT): Promise<Record<string, unknown>> {
  const text = await fetchText(url, "application/json", timeoutMs, userAgent);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof FetchError) throw error;
    throw new FetchError(url, "Source returned malformed JSON");
  }
}

export async function mapLimit<T, R>(values: T[], limit: number, operation: (value: T, index: number) => Promise<R>): Promise<R[]> {
  if (!values.length) return [];
  const output = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await operation(values[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}
