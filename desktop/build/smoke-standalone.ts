import { resolve } from "node:path";

const executable = resolve(import.meta.dir, "..", "dist", "isbn-to-zotero-linux");
const processHandle = Bun.spawn([executable, "--no-open", "--port", "0"], {
  stdout: "pipe",
  stderr: "pipe",
});

const reader = processHandle.stdout.getReader();
const decoder = new TextDecoder();
let output = "";
let baseURL = "";
const deadline = Date.now() + 8_000;
while (Date.now() < deadline && !baseURL) {
  const next = await Promise.race([
    reader.read(),
    Bun.sleep(250).then(() => ({ done: false, value: new Uint8Array() })),
  ]);
  if (next.done) break;
  output += decoder.decode(next.value, { stream: true });
  baseURL = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? "";
}

try {
  if (!baseURL) {
    const errorOutput = await new Response(processHandle.stderr).text();
    throw new Error(`Standalone server did not start. ${output} ${errorOutput}`.trim());
  }
  const health = await (await fetch(`${baseURL}/api/health`)).json();
  if (health?.ok !== true || health?.app !== "isbn-to-zotero") throw new Error("Health response is invalid");
  const page = await (await fetch(`${baseURL}/`)).text();
  if (!page.includes("ISBN to Zotero")) throw new Error("Embedded front page is missing");
  const response = await fetch(`${baseURL}/api/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isbns: ["9786028174887"] }),
  });
  const payload = await response.json();
  if (payload?.results?.[0]?.state !== "invalid") throw new Error("Invalid-ISBN path failed");
  console.log(`Standalone smoke test passed at ${baseURL}`);
} finally {
  processHandle.kill("SIGTERM");
  await processHandle.exited;
}
