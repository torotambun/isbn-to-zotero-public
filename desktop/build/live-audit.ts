import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Resolver } from "../src/resolver.ts";

const isbns = ["9789793930152", "9786029402063", "9786028174886", "9792704043"];
const resolver = new Resolver();
const results = [];
for (const isbn of isbns) {
  console.log(`Resolving ${isbn}...`);
  const resolution = await resolver.resolveOne(isbn);
  results.push(resolution);
  console.log(`${isbn}: ${resolution.state}, ${resolution.choices.length} choice(s)`);
}
const outputDirectory = resolve(import.meta.dir, "..", "test-results");
const outputPath = resolve(outputDirectory, "desktop-live-results.json");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, JSON.stringify({ tested_at: new Date().toISOString(), results }, null, 2), "utf8");
console.log(outputPath);
