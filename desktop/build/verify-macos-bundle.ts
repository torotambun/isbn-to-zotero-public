import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "..", "dist", "ISBN to Zotero.app");
const executablePath = resolve(appRoot, "Contents", "MacOS", "ISBN to Zotero");
const infoPath = resolve(appRoot, "Contents", "Info.plist");
const iconPath = resolve(appRoot, "Contents", "Resources", "AppIcon.icns");
const noticesPath = resolve(appRoot, "Contents", "Resources", "THIRD-PARTY-NOTICES.txt");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function version(value: number): string {
  return `${value >>> 16}.${(value >>> 8) & 0xff}.${value & 0xff}`;
}

function verifySlice(slice: Buffer, expectedCPU: number): { minimumOS: string; codeSignatureBytes: number } {
  assert(slice.length >= 32 && slice.readUInt32LE(0) === 0xfeedfacf, "A universal slice is not a 64-bit Mach-O executable");
  assert(slice.readUInt32LE(4) === expectedCPU, "Universal slice CPU metadata does not match its Mach-O header");
  assert(slice.readUInt32LE(12) === 2, "Universal slice is not an executable");
  const commandCount = slice.readUInt32LE(16);
  let cursor = 32;
  let minimumOS = "";
  let signatureOffset = 0;
  let signatureSize = 0;
  for (let index = 0; index < commandCount; index += 1) {
    assert(cursor + 8 <= slice.length, "Mach-O load command falls outside the slice");
    const command = slice.readUInt32LE(cursor);
    const commandSize = slice.readUInt32LE(cursor + 4);
    assert(commandSize >= 8 && cursor + commandSize <= slice.length, "Mach-O load command size is invalid");
    if (command === 0x32) minimumOS = version(slice.readUInt32LE(cursor + 12));
    if (command === 0x1d) {
      signatureOffset = slice.readUInt32LE(cursor + 8);
      signatureSize = slice.readUInt32LE(cursor + 12);
    }
    cursor += commandSize;
  }
  assert(minimumOS === "13.0.0", `Unexpected minimum macOS version: ${minimumOS || "missing"}`);
  assert(signatureOffset > 0 && signatureSize > 0, "Mach-O slice has no embedded code signature structure");
  assert(signatureOffset + signatureSize <= slice.length, "Embedded code signature falls outside the Mach-O slice");
  assert(slice.readUInt32BE(signatureOffset) === 0xfade0cc0, "Embedded code signature SuperBlob is invalid");
  return { minimumOS, codeSignatureBytes: signatureSize };
}

const executable = await readFile(executablePath);
assert(executable.readUInt32BE(0) === 0xcafebabe, "Executable is not a universal Mach-O binary");
const architectureCount = executable.readUInt32BE(4);
assert(architectureCount === 2, `Expected two architectures, found ${architectureCount}`);
const architectures = [];
for (let index = 0; index < architectureCount; index += 1) {
  const entry = 8 + index * 20;
  const cpuType = executable.readUInt32BE(entry);
  const offset = executable.readUInt32BE(entry + 8);
  const size = executable.readUInt32BE(entry + 12);
  const alignmentExponent = executable.readUInt32BE(entry + 16);
  assert(offset % (2 ** alignmentExponent) === 0, "Universal slice is not correctly aligned");
  assert(offset + size <= executable.length, "Universal slice falls outside the executable");
  architectures.push({ cpuType, offset, size, ...verifySlice(executable.subarray(offset, offset + size), cpuType) });
}
assert(new Set(architectures.map(item => item.cpuType)).size === 2, "Universal executable contains duplicate CPU slices");
assert(architectures.some(item => item.cpuType === 0x01000007), "Intel x86_64 slice is missing");
assert(architectures.some(item => item.cpuType === 0x0100000c), "Apple silicon arm64 slice is missing");

const mode = (await stat(executablePath)).mode & 0o777;
assert((mode & 0o111) !== 0, "App executable is not marked executable");
const info = await readFile(infoPath, "utf8");
for (const value of ["app.isbntozotero.desktop", "ISBN to Zotero", "1.1.0", "13.0"]) {
  assert(info.includes(`<string>${value}</string>`), `Info.plist is missing ${value}`);
}
const icon = await readFile(iconPath);
assert(icon.subarray(0, 4).toString("ascii") === "icns", "App icon is not an ICNS file");
assert(icon.readUInt32BE(4) === icon.length, "ICNS declared size does not match its file size");
assert((await readFile(noticesPath, "utf8")).includes("Bun 1.3.14"), "Third-party notice is missing");

console.log(JSON.stringify({
  app: appRoot,
  executable_bytes: executable.length,
  architectures: architectures.map(item => ({
    name: item.cpuType === 0x01000007 ? "x86_64" : "arm64",
    bytes: item.size,
    minimum_macos: item.minimumOS,
    code_signature_bytes: item.codeSignatureBytes,
  })),
  icon_bytes: icon.length,
}, null, 2));
