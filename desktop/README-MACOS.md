# ISBN to Zotero for macOS

> Experimental maintained v1.2 source candidate. No v1.2 `.app` is included or approved for distribution. The install notes below describe a possible future application after Zotero 10 acceptance, signing, notarization, and clean-Mac testing.

This is a self-contained macOS app for resolving Indonesian and older books by ISBN. It does not use Zotero's ISBN resolver as an authority. It validates the identifier, searches independent catalogues, keeps edition and title conflicts visible, and produces a direct Zotero item or RIS file without inventing missing metadata.

## Requirements

- macOS 13 or later, on Apple silicon or Intel
- Zotero 10 or later for direct import
- an internet connection for catalogue searches

Python and command-line setup are not required.

## Install

1. Unzip the download.
2. Move `ISBN to Zotero.app` to the Applications folder.
3. On the first launch, Control-click the app and choose **Open**, then confirm **Open**.

Do not distribute an unsigned candidate. A release must be signed and notarized with an Apple Developer ID, pass strict signature checks, and be tested on clean Apple-silicon and Intel Macs.

The included bundle verifier still contains a stale v1.1.0 assertion. Correcting and rerunning it is intentionally deferred to the separate desktop-distribution phase; it is not part of the source-publication approval.

## Use

1. Open Zotero.
2. In Zotero, enable **Settings > Advanced > Allow other applications on this computer to communicate with Zotero**.
3. Open **ISBN to Zotero**. The app opens the interface in the default browser at a local `127.0.0.1` address.
4. Scan a barcode or paste one or more ISBNs.
5. Choose the physical printing or edition when more than one candidate appears.
6. For a review or ambiguous result, compare the title page and copyright page, then tick the confirmation box.
7. Press **Send directly to Zotero**. Zotero asks for local-write permission. If that route is unavailable, press **Download RIS instead** and open the downloaded file with Zotero.

The app prevents a direct-write duplicate when Zotero already contains a closely matching title with an equivalent ISBN.

## Evidence rules

- A source record is accepted only when it reports the searched ISBN or its valid ISBN-10/ISBN-13 equivalent.
- Source errors remain distinct from zero results.
- Separate titles and known printings remain separate choices.
- Missing title, creator, publisher, date, edition, place, pagination, and language fields remain blank.
- Physical-book corrections replace only the fields entered before export.

## Sources and privacy

The app enables Open Library by default and sends only the ISBN. Regular users should set `OPEN_LIBRARY_CONTACT` to a public support address so Open Library can identify the client. Results are cached for one day in `~/Library/Caches/ISBN to Zotero/cache.json`; legacy cache data is discarded automatically.

Indonesia OneSearch is disabled by default until supported access is confirmed. It can be enabled for authorized private testing with `ISBN_ZOTERO_ENABLE_ONESEARCH=1`, which uses conservative request pacing. Google Books is not queried in the combined view because current branding rules prohibit intermixing Google results with third-party results. The interface listens only on `127.0.0.1`, so it is not exposed to other devices on the network.

Direct import requests a local key from the running Zotero app. No zotero.org password is requested, stored, or transmitted. A remembered key exists only in app memory and disappears when the app quits.

## Quit

Quit **ISBN to Zotero** from its Dock menu or Activity Monitor. Closing the browser tab does not stop the local app process.

## Limitations

- A hosted web version cannot reliably write to a desktop Zotero library. This app must run on the same Mac as Zotero.
- A phone camera cannot type into the Mac without a scanner or bridge application. USB and Bluetooth scanners that act as keyboards work directly.
- An ambiguous ISBN is never auto-selected. `9792704043`, for example, is attached to two distinct titles in public records.
- The app does not auto-update.
