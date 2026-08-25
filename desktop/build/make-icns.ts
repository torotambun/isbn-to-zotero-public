import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const buildRoot = resolve(import.meta.dir);
const chunks: Array<[string, string]> = [
  ["icp4", "icon-16.png"],
  ["icp5", "icon-32.png"],
  ["icp6", "icon-64.png"],
  ["ic07", "icon-128.png"],
  ["ic08", "icon-256.png"],
  ["ic09", "icon-512.png"],
  ["ic10", "icon-1024.png"],
  ["ic11", "icon-32.png"],
  ["ic12", "icon-64.png"],
  ["ic13", "icon-256.png"],
  ["ic14", "icon-512.png"],
];

const encoded: Buffer[] = [];
for (const [type, filename] of chunks) {
  const data = await readFile(resolve(buildRoot, "icon-png", filename));
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(data.length + 8, 4);
  encoded.push(header, data);
}
const header = Buffer.alloc(8);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(8 + encoded.reduce((sum, value) => sum + value.length, 0), 4);
await writeFile(resolve(buildRoot, "AppIcon.icns"), Buffer.concat([header, ...encoded]));
