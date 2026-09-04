import assert from "node:assert/strict";
import test from "node:test";

import { readFile } from "node:fs/promises";

import { perpusnasISBNURL } from "../lib/perpusnas.ts";

const CASES = [
  ["9786342779361", "Hasta Brata di Dunia Pendidikan"],
  ["9786238468836", "Optimalisasi Pengelolaan CSR dalam Bisnis Keluarga"],
  ["9786231340184", "Great Family Business: Strategi Membangun Nilai Bisnis Keluarga Lintas Generasi"],
  ["9786231150011", "Mengelola Bisnis Keluarga"],
];

test("builds exact Perpusnas ISBN searches for the four reported failures", () => {
  for (const [isbn] of CASES) {
    assert.equal(
      perpusnasISBNURL(isbn),
      `https://isbn.perpusnas.go.id/Account/SearchBuku?searchTxt=${isbn}&searchCat=ISBN`,
    );
  }
});

test("preserves the four Indonesian ISBN regression titles", () => {
  assert.deepEqual(CASES, [
    ["9786342779361", "Hasta Brata di Dunia Pendidikan"],
    ["9786238468836", "Optimalisasi Pengelolaan CSR dalam Bisnis Keluarga"],
    ["9786231340184", "Great Family Business: Strategi Membangun Nilai Bisnis Keluarga Lintas Generasi"],
    ["9786231150011", "Mengelola Bisnis Keluarga"],
  ]);
});

test("returns Perpusnas results to the Mac No ISBN workflow", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Check Perpusnas ISBN/);
  assert.match(page, /return here, and search it under No ISBN/);
  assert.doesNotMatch(page, /Perpusnas, Indonesia OneSearch, Open Library, and Google Books are searched independently/);
  assert.ok(page.indexOf("Check Perpusnas ISBN") < page.indexOf("Check WorldCat catalogue"));
});
