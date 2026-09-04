import assert from "node:assert/strict";
import test from "node:test";

import { readFile } from "node:fs/promises";

import { worldCatISBNURL } from "../lib/worldcat.ts";

test("builds the official WorldCat ISBN deep link", () => {
  assert.equal(
    worldCatISBNURL("978 602 72173 0 0"),
    "https://www.worldcat.org/isbn/9786027217300",
  );
  assert.equal(
    worldCatISBNURL("979-428-047-X"),
    "https://www.worldcat.org/isbn/979428047X",
  );
});

test("keeps WorldCat behind the Perpusnas recovery check", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Check Perpusnas first/);
  assert.match(page, /Check WorldCat only if Perpusnas also has no record/);
  assert.match(page, /Neither page imports metadata automatically/);
  assert.match(page, /Check WorldCat catalogue/);
  assert.match(page, /target="_blank"/);
});
