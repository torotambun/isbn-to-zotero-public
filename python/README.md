# ISBN to Zotero

> Experimental maintained v1.2 source candidate. Its audited repairs, tests, and release boundaries are documented in the repository [README](../README.md) and [testing guide](../docs/TESTING.md). It is not bound to any production Site.

This local tool resolves ISBNs without treating Zotero's own resolver as authoritative. It was designed for Indonesian and older books, where valid ISBNs often have sparse, duplicated, inconsistent, or edition-mixed records.

## Related desktop source

The matching TypeScript/Bun v1.2 candidate is in `../desktop/`. This Python implementation remains available for source review, local browser use, and command-line use.

## What it does

1. Accepts a scanned barcode, ISBN-10, ISBN-13, or a batch list.
2. Removes spaces and hyphens, validates the check digit, and searches both ISBN forms when conversion is defined.
3. Searches Open Library by default and supports a separately authorized, conservatively paced Indonesia OneSearch opt-in.
4. Rejects returned records that do not actually contain an equivalent ISBN.
5. Groups distinct titles before grouping printings and editions.
6. Shows source conflicts and links to every retained source record.
7. Sends the selected record directly to Zotero 10 or later, with Zotero's permission, or exports a Zotero-compatible RIS fallback. Ambiguous or weak records require confirmation against the physical title and copyright pages.

No missing title, author, publisher, year, edition, page count, or language is guessed. Physical-book corrections can be entered immediately before direct import or RIS export.

## Fastest use

### macOS or Linux

Double-click `start.command`, or run:

```sh
python3 start.py
```

### Windows

Double-click `start.bat`. Python 3 must be installed.

The browser opens at `http://127.0.0.1:8765`. Scan or paste the ISBN and review the selected physical edition.

- With Zotero 10 or later open, press **Send directly to Zotero**. Zotero displays its own permission dialog. Approval creates the item in the local Zotero library immediately.
- If direct writing is unavailable, press **Download RIS instead**. Open the downloaded `.ris` file. With Zotero registered for RIS files, that opens Zotero's import dialog. Otherwise use **File > Import** in Zotero and select the file.

For direct writing, enable **Settings > Advanced > Allow other applications on this computer to communicate with Zotero**. The tool requests a local write key from Zotero at runtime. It does not ask for, store, or transmit a zotero.org password. A remembered key remains in this program's memory only and is discarded when the program stops.

The tool uses only Python's standard library. It does not require `pip install`.

Run the tool on the same computer as the Zotero desktop application. Results from enabled sources are cached for one day, so reopening the same ISBN is immediate unless **Refresh sources** is pressed. Legacy seven-day cache files are discarded automatically because they could contain Google Books data retained without source cache directives.

Open Library is the only source enabled by default. Regular users should identify the application without placing a private address in source code:

```sh
export OPEN_LIBRARY_CONTACT="public-contact@example.org"
```

Indonesia OneSearch is disabled by default until a supported access method or permission is confirmed. For authorized private testing only, enable its conservatively paced adapter with:

```sh
export ISBN_ZOTERO_ENABLE_ONESEARCH=1
```

Google Books is not queried in the combined search because its current branding rules prohibit intermixing Google results with third-party results. Its adapter remains dormant for a future separately displayed integration.

## Barcode scanner behavior

Most USB and Bluetooth barcode scanners behave like keyboards. Place the cursor in the ISBN box. A scan that ends with Enter starts a one-book search. Multiple scanned or pasted ISBNs can be placed one per line and searched together.

A phone camera cannot send a scan directly to a program on a different computer without a bridge application. The simple options are:

- scan into the tool when it is running on the same device;
- use a Bluetooth scanner paired as a keyboard;
- scan several ISBNs into a note, then paste the list.

## Command line

From this folder:

```sh
python3 -m isbn_zotero.cli 9789793930152 9786029402063
```

Full audit JSON:

```sh
python3 -m isbn_zotero.cli --json 9786028174886
```

Export only records assessed as ready:

```sh
python3 -m isbn_zotero.cli --ris resolved-books.ris 9786028174886
```

The CLI deliberately blocks ambiguous titles and multiple editions. `--allow-review` permits a single weak candidate, but never chooses among several candidates.

## Why physical-edition confirmation matters

ISBNs should identify editions, but real catalogues contain reused, mistyped, and inherited identifiers. The initial test set proves the point:

- `9789793930152` is attached to at least a 2007 third printing and a 2008 fourth printing.
- `9786029402063` appears in records for several printings with inconsistent years and physical extents.
- `9786028174886` has broad agreement on the 2012 book, but catalogue spelling and page extent vary.
- `9792704043`, whose ISBN-13 equivalent is `9789792704044`, is attached to two distinct titles in public records. It must not be auto-selected by title alone.

For an ambiguous book, inspect the physical title page and the reverse copyright page. Match title, responsibility statement, publisher, year, printing or edition statement, and pagination. The interface allows those observed facts to replace the reconciled fields immediately before RIS export.

## Source policy

The source adapters are deliberately different:

- **Open Library** is enabled by default and often exposes edition-level records derived from library MARC data.
- **Indonesia OneSearch** can provide Indonesian library holdings and catalogue exports, but remains an authorized private opt-in because the used routes have no located official developer contract.
- **Google Books** has a retained adapter for possible future work but is never included in the combined view. A future integration must display Google results separately and satisfy current branding and cache rules.

Absence from one source is not evidence that an ISBN is invalid. Source errors are distinct from zero results. Every accepted record must report the searched ISBN or its valid ISBN-10/ISBN-13 equivalent.

The authenticated Perpusnas publisher API is not used because it requires publisher credentials. Search-engine snippets and bookshop pages are useful for human fallback checking but are not parsed into automatic records in version 1, because their structure and evidentiary quality vary.

## Assisted fallback when all adapters miss

If no verified record appears:

1. Search the exact ISBN in quotation marks in a normal web browser.
2. Prefer a national, university, government, or established public library record.
3. Search both normalized forms shown by the tool.
4. Compare the result with the physical title and copyright pages.
5. Do not inherit a year, edition, or page count from a different printing.

Version 1 does not turn an unverified search snippet into RIS automatically. This is intentional. Minimizing manual work cannot justify fabricated or edition-mixed metadata.

## Duplicate protection

Before a direct write, the tool searches the open Zotero library for the same equivalent ISBN and a closely matching title. If found, it reports the existing item and does not create another one. This check applies to direct writes. Zotero controls duplication when an RIS file is imported manually.

## Tests

Unit tests:

```sh
python3 -m unittest discover -s tests -v
```

Live source tests:

```sh
RUN_LIVE_TESTS=1 python3 -m unittest tests.test_live -v
```

Live tests depend on external catalogues. A rate limit or outage should be interpreted as a source-availability failure, not a metadata failure.

## Data and privacy

Searches send only the ISBN to enabled bibliographic services. Results are cached for one day in `~/.isbn-to-zotero/cache.json`. Use **Refresh sources** to ignore the cache. The application listens on `127.0.0.1` by default, so it is not exposed to other devices on the network.
