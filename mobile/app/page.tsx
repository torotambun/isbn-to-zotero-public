"use client";

import {
  AlertTriangle,
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  CloudUpload,
  Download,
  ExternalLink,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { bookToRIS, safeFilename } from "../lib/ris";
import type { ReconciledBook, Resolution } from "../lib/types";
import { worldCatISBNURL } from "../lib/worldcat";

const TEST_ISBNS = ["9789793930152", "9786029402063", "9786028174886", "9792704043"];
const KEY_STORAGE = "isbn-zotero-key-v1";
const PROFILE_STORAGE = "isbn-zotero-profile-v1";
const COLLECTION_STORAGE = "isbn-zotero-collection-v1";
const COLLECTION_PATH_STORAGE = "isbn-zotero-collection-path-v1";

type Notice = { kind: "success" | "error"; text: string } | null;
type Profile = { username: string; userID: string };
type ZoteroCollection = {
  key: string;
  name: string;
  parentCollection: string | null;
  path: string;
};
type ZoteroDuplicateMatch = {
  itemKey: string;
  title: string;
  creators: string[];
  date: string;
  edition: string;
  publisher: string;
  ISBN: string;
  collections: string[];
  sameTitle: boolean;
  sameISBN: boolean;
};
type ZoteroCreateResult = {
  message: string;
  created: boolean;
  duplicate: boolean;
  blocked: boolean;
  collectionAdded: boolean;
  itemKey: string;
  matches?: ZoteroDuplicateMatch[];
};

function resultTitle(state: Resolution["state"]): string {
  const labels: Record<Resolution["state"], string> = {
    invalid: "The ISBN is not valid",
    not_found: "No verified record found",
    ambiguous_title: "The ISBN is linked to different titles",
    multiple_editions: "Several physical editions found",
    ready: "One well-supported edition found",
    review: "One candidate needs a book check",
  };
  return labels[state];
}

function editionLine(book: ReconciledBook): string {
  return [
    book.edition,
    book.date,
    book.publisher,
    book.place,
    book.extent || (book.num_pages ? `${book.num_pages} pages` : ""),
  ].filter(Boolean).join(" · ");
}

function WorldCatFallback({ isbn }: { isbn: string }) {
  return (
    <aside className="worldcat-fallback" aria-label="WorldCat fallback">
      <div>
        <strong>Check whether WorldCat has the book</strong>
        <p>A WorldCat result confirms that a catalogue record exists. Note the exact title, then open ISBN to Zotero Mac and search by title. The Mac app handles review and Zotero import. No RIS download is normally needed.</p>
      </div>
      <a href={worldCatISBNURL(isbn)} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={17} /> Check WorldCat catalogue
      </a>
    </aside>
  );
}

function EditionCard({
  book,
  selected,
  onSelect,
}: {
  book: ReconciledBook;
  selected: boolean;
  onSelect: () => void;
}) {
  const sources = [...new Set(book.source_records.map((record) => record.source))];
  return (
    <button type="button" className={`edition-card ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={onSelect}>
      <div className="edition-card-head">
        <span className={`radio ${selected ? "checked" : ""}`}>
          {selected ? <Check size={15} strokeWidth={3} /> : null}
        </span>
        <span className={`confidence ${book.confidence}`}>
          {book.confidence === "high" ? "Supported" : book.confidence === "review" ? "Check book" : "Conflicting"}
        </span>
      </div>
      <h3>{book.title}</h3>
      {book.authors.length ? <p className="authors">{book.authors.join("; ")}</p> : null}
      <p className="edition-summary">{editionLine(book) || "Edition details not reported"}</p>
      <dl>
        <div><dt>Edition</dt><dd>{book.edition || "Not reported"}</dd></div>
        <div><dt>Year</dt><dd>{book.date || "Not reported"}</dd></div>
        <div><dt>Publisher</dt><dd>{book.publisher || "Not reported"}</dd></div>
        <div><dt>Extent</dt><dd>{book.extent || book.num_pages || "Not reported"}</dd></div>
      </dl>
      {Object.keys(book.conflicts).length ? (
        <div className="conflict">
          <AlertTriangle size={16} />
          <span>Sources disagree on {Object.keys(book.conflicts).join(", ")}. Both values remain in the record note.</span>
        </div>
      ) : null}
      <div className="evidence">
        <span>{book.source_records.length} matching record{book.source_records.length === 1 ? "" : "s"}</span>
        <span>{sources.join(" + ")}</span>
      </div>
    </button>
  );
}

export default function Home() {
  const [isbn, setISBN] = useState("");
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [apiKey, setAPIKey] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [collectionKey, setCollectionKey] = useState("");
  const [collectionPath, setCollectionPath] = useState("My Library");
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionError, setCollectionError] = useState("");
  const [remember, setRemember] = useState(false);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<ZoteroDuplicateMatch[]>([]);
  const [duplicateChoice, setDuplicateChoice] = useState("");
  const isbnInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const loadCollections = useCallback(async (key: string) => {
    if (!key) return;
    setCollectionsLoading(true);
    setCollectionError("");
    try {
      const response = await fetch("/api/zotero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "collections", apiKey: key }),
      });
      const data = (await response.json()) as { collections?: ZoteroCollection[]; error?: string };
      if (!response.ok || !data.collections) throw new Error(data.error || "Collections could not be loaded.");
      setCollections(data.collections);

      const savedKey = localStorage.getItem(COLLECTION_STORAGE) ?? "";
      const savedCollection = data.collections.find((collection) => collection.key === savedKey);
      if (savedCollection) {
        setCollectionKey(savedCollection.key);
        setCollectionPath(savedCollection.path);
        localStorage.setItem(COLLECTION_PATH_STORAGE, savedCollection.path);
      } else if (savedKey) {
        setCollectionKey("");
        setCollectionPath("My Library");
        localStorage.removeItem(COLLECTION_STORAGE);
        localStorage.removeItem(COLLECTION_PATH_STORAGE);
      }
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : "Collections could not be loaded.");
    } finally {
      setCollectionsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const savedKey = localStorage.getItem(KEY_STORAGE) ?? "";
      const savedProfile = localStorage.getItem(PROFILE_STORAGE);
      const savedCollectionKey = localStorage.getItem(COLLECTION_STORAGE) ?? "";
      const savedCollectionPath = localStorage.getItem(COLLECTION_PATH_STORAGE) ?? "My Library";
      if (savedKey) {
        setAPIKey(savedKey);
        void loadCollections(savedKey);
      }
      if (savedCollectionKey) {
        setCollectionKey(savedCollectionKey);
        setCollectionPath(savedCollectionPath);
      }
      if (savedProfile) {
        try {
          setProfile(JSON.parse(savedProfile) as Profile);
        } catch {
          localStorage.removeItem(PROFILE_STORAGE);
        }
      }
    });
    return () => { active = false; };
  }, [loadCollections]);

  const lookup = useCallback(async (value: string) => {
    const query = value.trim();
    if (!query) {
      setNotice({ kind: "error", text: "Enter or scan an ISBN first." });
      return;
    }
    setISBN(query);
    setLoading(true);
    setResolution(null);
    setSelectedID(null);
    setDuplicateOpen(false);
    setDuplicateMatches([]);
    setDuplicateChoice("");
    setNotice(null);
    try {
      const response = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isbn: query }),
      });
      const data = (await response.json()) as Resolution & { error?: string };
      if (!response.ok) throw new Error(data.error || "The catalogue search failed.");
      setResolution(data);
      setSelectedID(data.recommended_choice_id ?? (data.choices.length === 1 ? data.choices[0].choice_id : null));
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "The catalogue search failed." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return;
    let active = true;
    let controls: { stop: () => void } | null = null;
    setScannerError("");
    void (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          videoRef.current!,
          (result) => {
            if (!active || !result) return;
            const value = result.getText().replace(/[^0-9Xx]/g, "");
            if (value.length !== 10 && value.length !== 13) return;
            controls?.stop();
            setScannerOpen(false);
            void lookup(value);
          },
        );
      } catch {
        if (active) setScannerError("Camera access failed. Check Safari camera permission, then try again.");
      }
    })();
    return () => {
      active = false;
      controls?.stop();
    };
  }, [scannerOpen, lookup]);

  const selectedBook = useMemo(
    () => resolution?.choices.find((choice) => choice.choice_id === selectedID) ?? null,
    [resolution, selectedID],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void lookup(isbn);
  };

  const appendISBN10X = () => {
    const bare = isbn.toUpperCase().replace(/[^0-9X]/g, "");
    if (!/^\d{9}$/.test(bare)) return;
    setISBN(`${isbn}X`);
    isbnInputRef.current?.focus();
  };

  const startNewSearch = () => {
    setISBN("");
    setResolution(null);
    setSelectedID(null);
    setNotice(null);
    setDuplicateOpen(false);
    setDuplicateMatches([]);
    setDuplicateChoice("");
    requestAnimationFrame(() => {
      isbnInputRef.current?.focus();
      isbnInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const exportRIS = async () => {
    if (!selectedBook) return;
    const file = new File([bookToRIS(selectedBook)], safeFilename(selectedBook), {
      type: "application/x-research-info-systems",
    });
    try {
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: selectedBook.title, files: [file] });
      } else {
        const url = URL.createObjectURL(file);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.name;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice({ kind: "success", text: "RIS file downloaded." });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice({ kind: "error", text: "The RIS file could not be shared." });
    }
  };

  const checkZotero = async () => {
    setChecking(true);
    setNotice(null);
    try {
      const response = await fetch("/api/zotero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check", apiKey }),
      });
      const data = (await response.json()) as { profile?: Profile; error?: string };
      if (!response.ok || !data.profile) throw new Error(data.error || "Key check failed.");
      setProfile(data.profile);
      if (remember) {
        localStorage.setItem(KEY_STORAGE, apiKey);
        localStorage.setItem(PROFILE_STORAGE, JSON.stringify(data.profile));
      } else {
        localStorage.removeItem(KEY_STORAGE);
        localStorage.removeItem(PROFILE_STORAGE);
      }
      void loadCollections(apiKey);
      setSetupOpen(false);
      setNotice({ kind: "success", text: `Zotero connected as ${data.profile.username}.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Key check failed." });
    } finally {
      setChecking(false);
    }
  };

  const disconnect = () => {
    setAPIKey("");
    setProfile(null);
    setCollections([]);
    setCollectionKey("");
    setCollectionPath("My Library");
    setDuplicateOpen(false);
    setDuplicateMatches([]);
    setDuplicateChoice("");
    localStorage.removeItem(KEY_STORAGE);
    localStorage.removeItem(PROFILE_STORAGE);
    localStorage.removeItem(COLLECTION_STORAGE);
    localStorage.removeItem(COLLECTION_PATH_STORAGE);
    setNotice({ kind: "success", text: "The Zotero key was removed from this browser." });
  };

  const openCollectionPicker = () => {
    if (!apiKey) {
      setSetupOpen(true);
      return;
    }
    setCollectionOpen(true);
    void loadCollections(apiKey);
  };

  const chooseCollection = (collection: ZoteroCollection | null) => {
    const nextKey = collection?.key ?? "";
    const nextPath = collection?.path ?? "My Library";
    setCollectionKey(nextKey);
    setCollectionPath(nextPath);
    if (nextKey) {
      localStorage.setItem(COLLECTION_STORAGE, nextKey);
      localStorage.setItem(COLLECTION_PATH_STORAGE, nextPath);
    } else {
      localStorage.removeItem(COLLECTION_STORAGE);
      localStorage.removeItem(COLLECTION_PATH_STORAGE);
    }
    setCollectionOpen(false);
  };

  const destinationLabel = collectionPath === "My Library" ? "My Library" : `“${collectionPath}”`;

  const createInZotero = async (allowTitleDuplicate = false) => {
    if (!selectedBook || !apiKey) return;
    setSending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/zotero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          apiKey,
          book: selectedBook,
          collectionKey,
          allowTitleDuplicate,
        }),
      });
      const data = (await response.json()) as {
        result?: ZoteroCreateResult;
        error?: string;
      };
      if (!response.ok || !data.result) throw new Error(data.error || "Zotero import failed.");
      if (data.result.blocked && data.result.matches?.length) {
        setDuplicateMatches(data.result.matches);
        setDuplicateChoice(data.result.matches[0].itemKey);
        setDuplicateOpen(true);
        return;
      }
      setDuplicateOpen(false);
      setDuplicateMatches([]);
      setDuplicateChoice("");
      setNotice({ kind: "success", text: data.result.created ? `Added to ${destinationLabel}.` : data.result.message });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Zotero import failed." });
    } finally {
      setSending(false);
    }
  };

  const addToZotero = () => {
    if (!selectedBook) return;
    if (!apiKey) {
      setSetupOpen(true);
      return;
    }
    void createInZotero(false);
  };

  const keepExistingDuplicate = async () => {
    if (!duplicateChoice || !apiKey) return;
    setSending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/zotero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "use_existing",
          apiKey,
          itemKey: duplicateChoice,
          collectionKey,
        }),
      });
      const data = (await response.json()) as { result?: ZoteroCreateResult; error?: string };
      if (!response.ok || !data.result) throw new Error(data.error || "The existing Zotero record could not be used.");
      setDuplicateOpen(false);
      setDuplicateMatches([]);
      setDuplicateChoice("");
      const message = data.result.collectionAdded
        ? `The existing Zotero record was filed in ${destinationLabel}. No duplicate was created.`
        : collectionKey
          ? `The existing record is already in ${destinationLabel}. No duplicate was created.`
          : "The existing Zotero record was kept. No duplicate was created.";
      setNotice({ kind: "success", text: message });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "The existing Zotero record could not be used." });
    } finally {
      setSending(false);
    }
  };

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top">
          <span className="brand-mark"><BookOpen size={20} /></span>
          <span>ISBN → Zotero</span>
        </a>
        <button className="connect" type="button" onClick={() => setSetupOpen(true)}>
          <span className={`connection-dot ${profile ? "online" : ""}`} />
          <span>{profile?.username || "Connect"}</span>
          <Settings2 size={17} />
        </button>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow">For Indonesian and older books</p>
        <h1>Scan the book.<br />Keep the right edition.</h1>
        <p className="intro">Search several catalogues, compare physical editions, then add the selected record to Zotero.</p>
        <form className="search-card" onSubmit={submit}>
          <label htmlFor="isbn">ISBN or barcode number</label>
          <div className="isbn-row">
            <input
              ref={isbnInputRef}
              id="isbn"
              inputMode="numeric"
              enterKeyHint="search"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-describedby="isbn-help"
              value={isbn}
              onChange={(event) => setISBN(event.target.value.toUpperCase())}
              placeholder="978 979 3930 15 2"
            />
            <button
              type="button"
              className="isbn-x"
              aria-label="Add final X to an ISBN-10"
              disabled={!/^\d{9}$/.test(isbn.toUpperCase().replace(/[^0-9X]/g, ""))}
              onClick={appendISBN10X}
            >
              X
            </button>
            <button type="button" className="camera" aria-label="Scan barcode" onClick={() => setScannerOpen(true)}><Camera size={22} /></button>
          </div>
          <small id="isbn-help">No barcode? Type the ISBN printed in the book. Spaces and hyphens are accepted. If an ISBN-10 ends in X, tap the X key above. Then tap Search ISBN.</small>
          <button className="search-button" type="submit" disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={20} /> : <Search size={20} />}
            {loading ? "Searching catalogues…" : "Search ISBN"}
          </button>
        </form>
        <div className="tests">
          <span>Test:</span>
          {TEST_ISBNS.map((value) => <button type="button" key={value} onClick={() => void lookup(value)}>{value}</button>)}
        </div>
        <aside className="recovery-guide" aria-label="What to do when ISBN lookup finds no record">
          <span className="recovery-label">If no ISBN match appears</span>
          <strong>Confirm the title here. Complete the record on Mac.</strong>
          <p>Check WorldCat to see whether the book is catalogued. If a record exists, open ISBN to Zotero Mac and search by title. The Mac title search is the normal recovery route.</p>
        </aside>
      </section>

      {notice ? (
        <div className={`notice ${notice.kind}`} role="status">
          {notice.kind === "success" ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
          <span>{notice.text}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={18} /></button>
        </div>
      ) : null}

      {loading ? (
        <section className="loading-panel" aria-live="polite">
          <div className="orbit"><BookOpen size={28} /></div>
          <h2>Checking the identifier and catalogues</h2>
          <p>Indonesia OneSearch, Open Library, and Google Books are searched independently.</p>
          <div className="progress"><span /></div>
        </section>
      ) : null}

      {resolution ? (
        <section className="results" aria-live="polite">
          <div className="result-head">
            <div>
              <p className="eyebrow">ISBN {resolution.canonical || resolution.raw_input}</p>
              <h2>{resultTitle(resolution.state)}</h2>
              <p>{resolution.state_message || resolution.validation_message}</p>
            </div>
            <div className="result-tools">
              {resolution.valid ? <span className="valid"><ShieldCheck size={17} /> Valid ISBN</span> : null}
              <button type="button" className="new-search" onClick={startNewSearch}><Search size={16} /> New ISBN search</button>
            </div>
          </div>
          {resolution.source_statuses.length ? (
            <>
              <div className="sources">
                {resolution.source_statuses.map((source) => (
                  <span className={source.ok ? "" : "warning"} key={source.source} title={source.message || "Source responded normally"}><i /> {source.source} <b>{source.records}</b></span>
                ))}
              </div>
              {resolution.source_statuses.some((source) => !source.ok) ? (
                <div className="source-warnings">
                  {resolution.source_statuses.filter((source) => !source.ok).map((source) => (
                    <p key={source.source}><AlertTriangle size={14} /><strong>{source.source}:</strong> {source.message}</p>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
          {resolution.choices.length ? (
            <>
              <div className="instruction">
                <BookOpen size={21} />
                <div><strong>Match the copy in hand</strong><span>Check edition, year, publisher, and page count.</span></div>
              </div>
              <div className="edition-grid">
                {resolution.choices.map((book) => (
                  <EditionCard
                    key={book.choice_id}
                    book={book}
                    selected={book.choice_id === selectedID}
                    onSelect={() => {
                      setSelectedID(book.choice_id);
                      setDuplicateOpen(false);
                      setDuplicateMatches([]);
                      setDuplicateChoice("");
                    }}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="empty"><AlertTriangle size={24} /><div><strong>No record was generated.</strong><p>Missing metadata stays missing. Nothing was guessed.</p></div></div>
              {resolution.valid ? <WorldCatFallback isbn={resolution.canonical || resolution.raw_input} /> : null}
            </>
          )}
        </section>
      ) : null}

      {!loading && !resolution ? (
        <section className="steps">
          <article><span>01</span><strong>Validate</strong><p>Reject mistyped check digits before a catalogue request.</p></article>
          <article><span>02</span><strong>Compare</strong><p>Keep source disagreements visible instead of silently choosing.</p></article>
          <article><span>03</span><strong>Import</strong><p>Send the selected edition to Zotero Cloud or share RIS.</p></article>
        </section>
      ) : null}

      <footer>
        <p>On iPhone: Safari Share menu → <strong>Add to Home Screen</strong>.</p>
        <p>No catalogue source is authoritative on its own.</p>
      </footer>

      {resolution?.choices.length ? (
        <div className="action-dock">
          <div className="dock-meta">
            <div className="selection">
              <span>{selectedBook ? "Selected edition" : "Selection required"}</span>
              <strong>{selectedBook ? editionLine(selectedBook) || selectedBook.title : "Match the physical book"}</strong>
            </div>
            <button
              type="button"
              className="collection-choice"
              aria-label={`Choose Zotero collection. Current destination: ${collectionPath}`}
              onClick={openCollectionPicker}
            >
              <FolderOpen size={18} />
              <span><small>Save in Zotero</small><strong>{collectionPath}</strong></span>
              {collectionsLoading ? <LoaderCircle className="spin" size={17} /> : <ChevronRight size={17} />}
            </button>
          </div>
          <div className="actions">
            <button type="button" className="new-isbn" onClick={startNewSearch}><Search size={19} /> New ISBN</button>
            <button type="button" className="ris" disabled={!selectedBook} onClick={() => void exportRIS()}><Download size={20} /> RIS</button>
            <button type="button" className="zotero" disabled={!selectedBook || sending} onClick={() => void addToZotero()}>
              {sending ? <LoaderCircle className="spin" size={20} /> : profile ? <ShieldCheck size={20} /> : <CloudUpload size={20} />}
              {sending ? "Checking Zotero…" : profile ? "Check & add" : "Connect & add"}
            </button>
          </div>
        </div>
      ) : null}

      {collectionOpen ? (
        <div className="backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setCollectionOpen(false); }}>
          <section className="setup-sheet collection-sheet" role="dialog" aria-modal="true" aria-labelledby="collection-title">
            <div className="handle" />
            <div className="setup-head">
              <span className="key-icon"><FolderOpen size={22} /></span>
              <div><p className="eyebrow">Zotero destination</p><h2 id="collection-title">Choose a collection</h2></div>
              <button type="button" aria-label="Close collection chooser" onClick={() => setCollectionOpen(false)}><X size={22} /></button>
            </div>
            <p className="setup-copy">The selected destination is remembered for the next book.</p>
            {collectionError ? <p className="collection-error"><AlertTriangle size={17} /> {collectionError}</p> : null}
            <div className="collection-list" role="list">
              <button type="button" className={collectionKey ? "collection-option" : "collection-option selected"} aria-pressed={!collectionKey} onClick={() => chooseCollection(null)}>
                <span className={`radio ${collectionKey ? "" : "checked"}`}>{collectionKey ? null : <Check size={15} strokeWidth={3} />}</span>
                <span><strong>My Library</strong><small>No collection</small></span>
              </button>
              {collections.map((collection) => (
                <button type="button" key={collection.key} className={`collection-option ${collection.key === collectionKey ? "selected" : ""}`} aria-pressed={collection.key === collectionKey} onClick={() => chooseCollection(collection)}>
                  <span className={`radio ${collection.key === collectionKey ? "checked" : ""}`}>{collection.key === collectionKey ? <Check size={15} strokeWidth={3} /> : null}</span>
                  <span><strong>{collection.path}</strong><small>Zotero collection</small></span>
                </button>
              ))}
            </div>
            {collectionsLoading && !collections.length ? <p className="collection-status"><LoaderCircle className="spin" size={18} /> Loading Zotero collections…</p> : null}
            {!collectionsLoading && !collections.length && !collectionError ? <p className="collection-status">No collections were found. My Library remains available.</p> : null}
          </section>
        </div>
      ) : null}

      {duplicateOpen ? (
        <div className="backdrop" onMouseDown={(event) => { if (!sending && event.currentTarget === event.target) setDuplicateOpen(false); }}>
          <section className="setup-sheet duplicate-sheet" role="dialog" aria-modal="true" aria-labelledby="duplicate-title">
            <div className="handle" />
            <div className="setup-head">
              <span className="key-icon duplicate-icon"><AlertTriangle size={23} /></span>
              <div><p className="eyebrow">Duplicate check</p><h2 id="duplicate-title">Already in Zotero?</h2></div>
              <button type="button" aria-label="Close duplicate review" disabled={sending} onClick={() => setDuplicateOpen(false)}><X size={22} /></button>
            </div>
            <p className="setup-copy">Nothing has been added. Zotero already contains the same title or ISBN. Compare the existing record with the physical book.</p>
            <div className="duplicate-list" role="list">
              {duplicateMatches.map((match) => (
                <button
                  type="button"
                  key={match.itemKey}
                  className={`duplicate-option ${match.itemKey === duplicateChoice ? "selected" : ""}`}
                  aria-pressed={match.itemKey === duplicateChoice}
                  onClick={() => setDuplicateChoice(match.itemKey)}
                >
                  <span className={`radio ${match.itemKey === duplicateChoice ? "checked" : ""}`}>
                    {match.itemKey === duplicateChoice ? <Check size={15} strokeWidth={3} /> : null}
                  </span>
                  <span className="duplicate-data">
                    <span className="duplicate-badges">
                      {match.sameTitle ? <small>Same title</small> : null}
                      {match.sameISBN ? <small>Same ISBN</small> : null}
                    </span>
                    <strong>{match.title}</strong>
                    {match.creators.length ? <span>{match.creators.join("; ")}</span> : null}
                    <span>{[match.date, match.edition, match.publisher].filter(Boolean).join(" · ") || "Edition details not reported"}</span>
                    <span>ISBN: {match.ISBN || "Not reported"}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="duplicate-destination"><FolderOpen size={16} /> Current destination: <strong>{collectionPath}</strong></p>
            <div className="duplicate-actions">
              <button type="button" className="use-existing" disabled={!duplicateChoice || sending} onClick={() => void keepExistingDuplicate()}>
                {sending ? <LoaderCircle className="spin" size={18} /> : <CheckCircle2 size={18} />}
                {collectionKey ? "Use existing record" : "Keep existing record"}
              </button>
              <button type="button" className="add-edition" disabled={sending} onClick={() => void createInZotero(true)}>
                Add as different edition
              </button>
            </div>
            <p className="duplicate-help">“Add as different edition” creates another Zotero item. Use it only when the physical edition is genuinely different.</p>
          </section>
        </div>
      ) : null}

      {scannerOpen ? (
        <div className="scanner" role="dialog" aria-modal="true" aria-label="Barcode scanner">
          <div className="scanner-head">
            <div><p className="eyebrow">Barcode scanner</p><h2>Hold the ISBN barcode inside the frame</h2></div>
            <button type="button" aria-label="Close scanner" onClick={() => setScannerOpen(false)}><X size={24} /></button>
          </div>
          <div className="video-wrap"><video ref={videoRef} muted playsInline /><div className="scan-frame"><span /></div></div>
          {scannerError ? <p className="scanner-error"><AlertTriangle size={18} /> {scannerError}</p> : null}
          <p className="scanner-tip">Good light and a steady distance improve recognition.</p>
        </div>
      ) : null}

      {setupOpen ? (
        <div className="backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setSetupOpen(false); }}>
          <section className="setup-sheet" role="dialog" aria-modal="true" aria-labelledby="setup-title">
            <div className="handle" />
            <div className="setup-head">
              <span className="key-icon"><KeyRound size={22} /></span>
              <div><p className="eyebrow">One-time setup</p><h2 id="setup-title">Connect Zotero Cloud</h2></div>
              <button type="button" aria-label="Close setup" onClick={() => setSetupOpen(false)}><X size={22} /></button>
            </div>
            <p className="setup-copy">A personal Zotero API key allows direct creation from iPhone. It is sent only for Zotero checks and imports and is never stored by this app’s server.</p>
            <a href="https://www.zotero.org/settings/keys/new" target="_blank" rel="noreferrer">Create a Zotero key <ExternalLink size={16} /></a>
            <p className="key-help">Name it “ISBN to Zotero” and enable personal library write access.</p>
            <label htmlFor="api-key">Zotero API key</label>
            <input id="api-key" className="key-input" type="password" autoComplete="off" value={apiKey} onChange={(event) => setAPIKey(event.target.value.trim())} placeholder="Paste the private key" />
            <label className="remember">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              <span><strong>Remember on this iPhone</strong><small>Recommended only for a private device. Safari stores the key locally.</small></span>
            </label>
            <button type="button" className="check-key" disabled={!apiKey || checking} onClick={() => void checkZotero()}>
              {checking ? <LoaderCircle className="spin" size={20} /> : <ShieldCheck size={20} />}
              {checking ? "Checking…" : "Check and connect"}
            </button>
            {profile ? <button type="button" className="disconnect" onClick={disconnect}>Remove saved connection</button> : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
