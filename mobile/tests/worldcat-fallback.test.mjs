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

test("explains the WorldCat confirmation and Mac recovery workflow", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /If no ISBN match appears/);
  assert.match(page, /Check whether WorldCat has the book/);
  assert.match(page, /A WorldCat result confirms that a catalogue record exists/);
  assert.match(page, /open ISBN to Zotero Mac and search by title/);
  assert.match(page, /Mac title search is the normal recovery route/);
  assert.match(page, /No RIS download is normally needed/);
  assert.match(page, /Check WorldCat catalogue/);
  assert.match(page, /target="_blank"/);
});
