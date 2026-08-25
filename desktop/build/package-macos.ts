import { appendFile, chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const desktopRoot = resolve(import.meta.dir, "..");
const distRoot = resolve(desktopRoot, "dist");
const entrypoint = resolve(desktopRoot, "src", "server.ts");
const armPath = resolve(distRoot, "isbn-to-zotero-arm64");
const x64Path = resolve(distRoot, "isbn-to-zotero-x64");
const appRoot = resolve(distRoot, "ISBN to Zotero.app");
const executablePath = resolve(appRoot, "Contents", "MacOS", "ISBN to Zotero");
const resourcesPath = resolve(appRoot, "Contents", "Resources");

async function compile(target: Bun.Build.CompileTarget, outfile: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    minify: true,
    compile: { target, outfile },
  });
  if (!result.success) {
    const detail = result.logs.map(log => log.message).join("\n");
    throw new Error(`Compilation for ${target} failed.\n${detail}`);
  }
}

interface MachSlice {
  path: string;
  data: Buffer;
  cpuType: number;
  cpuSubtype: number;
}

async function readSlice(path: string): Promise<MachSlice> {
  const data = await readFile(path);
  if (data.length < 32 || data.readUInt32LE(0) !== 0xfeedfacf) throw new Error(`${basename(path)} is not a 64-bit Mach-O executable`);
  return {
    path,
    data,
    cpuType: data.readUInt32LE(4),
    cpuSubtype: data.readUInt32LE(8),
  };
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

async function makeUniversal(outputPath: string, slices: MachSlice[]): Promise<void> {
  const alignmentExponent = 14;
  const alignment = 2 ** alignmentExponent;
  const headerLength = 8 + slices.length * 20;
  const offsets: number[] = [];
  let cursor = align(headerLength, alignment);
  for (const slice of slices) {
    offsets.push(cursor);
    cursor = align(cursor + slice.data.length, alignment);
  }
  const header = Buffer.alloc(offsets[0]);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(slices.length, 4);
  slices.forEach((slice, index) => {
    const offset = 8 + index * 20;
    header.writeUInt32BE(slice.cpuType >>> 0, offset);
    header.writeUInt32BE(slice.cpuSubtype >>> 0, offset + 4);
    header.writeUInt32BE(offsets[index], offset + 8);
    header.writeUInt32BE(slice.data.length, offset + 12);
    header.writeUInt32BE(alignmentExponent, offset + 16);
  });
  await writeFile(outputPath, header);
  for (let index = 0; index < slices.length; index += 1) {
    const currentSize = index === 0 ? offsets[0] : offsets[index - 1] + slices[index - 1].data.length;
    const padding = offsets[index] - currentSize;
    if (padding > 0) await appendFile(outputPath, Buffer.alloc(padding));
    await appendFile(outputPath, slices[index].data);
  }
  await chmod(outputPath, 0o755);
}

await mkdir(distRoot, { recursive: true });
await Promise.all([
  compile("bun-darwin-arm64", armPath),
  compile("bun-darwin-x64-baseline", x64Path),
]);
await rm(appRoot, { recursive: true, force: true });
await mkdir(resolve(appRoot, "Contents", "MacOS"), { recursive: true });
await mkdir(resourcesPath, { recursive: true });
const slices = [await readSlice(x64Path), await readSlice(armPath)];
await makeUniversal(executablePath, slices);
await copyFile(resolve(import.meta.dir, "Info.plist"), resolve(appRoot, "Contents", "Info.plist"));
await copyFile(resolve(import.meta.dir, "AppIcon.icns"), resolve(resourcesPath, "AppIcon.icns"));
await copyFile(resolve(desktopRoot, "THIRD-PARTY-NOTICES.txt"), resolve(resourcesPath, "THIRD-PARTY-NOTICES.txt"));
await writeFile(resolve(appRoot, "Contents", "PkgInfo"), "APPL????", "ascii");
console.log(appRoot);
