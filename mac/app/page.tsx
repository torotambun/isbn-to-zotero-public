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
import { manualBook, type ManualBookFields } from "../lib/manual-book";
import { perpusnasISBNURL } from "../lib/perpusnas";
import type { BookSearchInput, ReconciledBook, Resolution } from "../lib/types";
import { worldCatISBNURL } from "../lib/worldcat";

const TEST_ISBNS = ["9789793930152", "9786029402063", "9786028174886", "9792704043"];
const KEY_STORAGE = "isbn-zotero-key-v1";
const PROFILE_STORAGE = "isbn-zotero-profile-v1";
const COLLECTION_STORAGE = "isbn-zotero-collection-v1";
const COLLECTION_PATH_STORAGE = "isbn-zotero-collection-path-v1";

type Notice = { kind: "success" | "error"; text: string } | null;
type SearchMode = "isbn" | "no-isbn";
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

const EMPTY_BOOK_QUERY: BookSearchInput = { title: "", author: "", publisher: "", year: "" };
const EMPTY_MANUAL: ManualBookFields = {
  title: "",
  subtitle: "",
  authors: "",
  editors: "",
  translators: "",
  publisher: "",
  place: "",
  date: "",
  edition: "",
  series: "",
  series_number: "",
  volume: "",
  number_of_volumes: "",
  num_pages: "",
  extent: "",
  language: "Indonesian",
};

const MANUAL_FIELDS: Array<{
  key: keyof ManualBookFields;
  label: string;
  placeholder: string;
  wide?: boolean;
}> = [
  { key: "title", label: "Title", placeholder: "Exactly as printed on the title page", wide: true },
  { key: "subtitle", label: "Subtitle", placeholder: "Leave blank if absent", wide: true },
  { key: "authors", label: "Authors", placeholder: "Separate several names with semicolons", wide: true },
  { key: "editors", label: "Editors", placeholder: "Separate several names with semicolons" },
  { key: "translators", label: "Translators", placeholder: "Separate several names with semicolons" },
  { key: "publisher", label: "Publisher", placeholder: "Publisher printed in this copy" },
  { key: "place", label: "Publication place", placeholder: "City" },
  { key: "date", label: "Publication date", placeholder: "Year or date printed in this copy" },
  { key: "edition", label: "Edition or printing", placeholder: "For example: Cetakan ke-3" },
  { key: "num_pages", label: "Number of pages", placeholder: "Arabic-numbered pages" },
  { key: "extent", label: "Physical extent", placeholder: "For example: xii + 284 hlm.; 23 cm", wide: true },
  { key: "series", label: "Series title", placeholder: "Leave blank if absent" },
  { key: "series_number", label: "Series number", placeholder: "Leave blank if absent" },
  { key: "volume", label: "Volume", placeholder: "Volume number for this book" },
  { key: "number_of_volumes", label: "Number of volumes", placeholder: "Total volumes in the set" },
  { key: "language", label: "Language", placeholder: "For example: Indonesian" },
];

function resultTitle(state: Resolution["state"], mode: SearchMode): string {
  if (mode === "no-isbn") {
    const labels: Record<Resolution["state"], string> = {
      invalid: "The title search is not valid",
      source_unavailable: "Catalogues could not be reached",
      not_found: "No plausible catalogue record found",
      ambiguous_title: "Different titles or variants were found",
      multiple_editions: "Several possible physical editions found",
      ready: "One catalogue candidate found",
      review: "Catalogue candidates need a book check",
    };
    return labels[state];
  }
  const labels: Record<Resolution["state"], string> = {
    invalid: "The ISBN is not valid",
    source_unavailable: "Catalogues could not be reached",
    not_found: "No verified record found",
    ambiguous_title: "The ISBN is linked to different titles",
    multiple_editions: "Several physical editions found",
    ready: "One well-supported edition found",
    review: "One candidate needs a book check",
  };
  return labels[state];
}

function CatalogueFallback({ isbn }: { isbn: string }) {
  return (
    <aside className="catalogue-fallback" aria-label="Separate Indonesian and international catalogue checks">
      <div>
        <strong>Check Perpusnas first</strong>
        <p>Perpusnas may identify an Indonesian book missed by the automatic sources. Note the exact title, return here, and search it under No ISBN. Check WorldCat only if Perpusnas also has no record. Neither page imports metadata automatically.</p>
      </div>
      <div className="catalogue-fallback-actions">
        <a href={perpusnasISBNURL(isbn)} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={17} /> Check Perpusnas ISBN
        </a>
        <a className="secondary" href={worldCatISBNURL(isbn)} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={17} /> Check WorldCat catalogue
        </a>
      </div>
    </aside>
  );
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
        {book.source_records.length ? (
          <>
            <span>{book.source_records.length} matching record{book.source_records.length === 1 ? "" : "s"}</span>
            <span>{sources.join(" + ")}</span>
          </>
        ) : (
          <span>Verified physical-book transcription</span>
        )}
      </div>
    </button>
  );
}

export default function Home() {
  const [mode, setMode] = useState<SearchMode>("isbn");
  const [isbn, setISBN] = useState("");
  const [bookQuery, setBookQuery] = useState<BookSearchInput>(EMPTY_BOOK_QUERY);
  const [manualFields, setManualFields] = useState<ManualBookFields>(EMPTY_MANUAL);
  const [manualOpen, setManualOpen] = useState(false);
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
  const titleInputRef = useRef<HTMLInputElement>(null);
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

  const lookupTitle = useCallback(async (value: BookSearchInput) => {
    const query = {
      title: value.title.trim(),
      author: value.author.trim(),
      publisher: value.publisher.trim(),
      year: value.year.trim(),
    };
    if (query.title.length < 3) {
      setNotice({ kind: "error", text: "Enter at least three title characters from the physical book." });
      return;
    }
    setBookQuery(query);
    setLoading(true);
    setResolution(null);
    setSelectedID(null);
    setManualOpen(false);
    setDuplicateOpen(false);
    setDuplicateMatches([]);
    setDuplicateChoice("");
    setNotice(null);
    try {
      const response = await fetch("/api/search-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });
      const data = (await response.json()) as Resolution & { error?: string };
      if (!response.ok) throw new Error(data.error || "The title search failed.");
      setResolution(data);
      setSelectedID(null);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "The title search failed." });
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

  const submitBookSearch = (event: FormEvent) => {
    event.preventDefault();
    void lookupTitle(bookQuery);
  };

  const appendISBN10X = () => {
    const bare = isbn.toUpperCase().replace(/[^0-9X]/g, "");
    if (!/^\d{9}$/.test(bare)) return;
    setISBN(`${isbn}X`);
    isbnInputRef.current?.focus();
  };

  const startNewSearch = () => {
    setISBN("");
    setBookQuery(EMPTY_BOOK_QUERY);
    setResolution(null);
    setSelectedID(null);
    setManualOpen(false);
    setNotice(null);
    setDuplicateOpen(false);
    setDuplicateMatches([]);
    setDuplicateChoice("");
    requestAnimationFrame(() => {
      const input = mode === "isbn" ? isbnInputRef.current : titleInputRef.current;
      input?.focus();
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const switchMode = (nextMode: SearchMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setISBN("");
    setBookQuery(EMPTY_BOOK_QUERY);
    setResolution(null);
    setSelectedID(null);
    setManualOpen(false);
    setDuplicateOpen(false);
    setDuplicateMatches([]);
    setDuplicateChoice("");
    setNotice(null);
    requestAnimationFrame(() => {
      (nextMode === "isbn" ? isbnInputRef.current : titleInputRef.current)?.focus();
    });
  };

  const openManualEntry = () => {
    setManualFields({
      ...EMPTY_MANUAL,
      title: bookQuery.title,
      authors: bookQuery.author,
      publisher: bookQuery.publisher,
      date: bookQuery.year,
    });
    setManualOpen(true);
  };

  const prepareManualRecord = (event: FormEvent) => {
    event.preventDefault();
    try {
      const book = manualBook(manualFields);
      setResolution({
        raw_input: book.title,
        valid: true,
        isbn10: null,
        isbn13: null,
        canonical: null,
        validation_message: "Manual physical-book record prepared.",
        source_statuses: [],
        records: [],
        choices: [book],
        state: "review",
        state_message: "This record came from manual transcription. Confirm every populated field against the title and copyright pages.",
        recommended_choice_id: book.choice_id,
      });
      setSelectedID(book.choice_id);
      setManualOpen(false);
      setNotice({ kind: "success", text: "Manual record prepared. Review it before checking Zotero." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "The manual record is incomplete." });
    }
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
          <span>Book → Zotero Mac</span>
        </a>
        <button className="connect" type="button" onClick={() => setSetupOpen(true)}>
          <span className={`connection-dot ${profile ? "online" : ""}`} />
          <span>{profile?.username || "Connect"}</span>
          <Settings2 size={17} />
        </button>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow">Mac workflow for Indonesian and older books</p>
        <h1>Find the book.<br />Keep the right edition.</h1>
        <p className="intro">Search by ISBN when one exists. Search by title and verify the physical book when it does not.</p>
        <div className="mode-switch" role="tablist" aria-label="Choose book search method">
          <button type="button" role="tab" aria-selected={mode === "isbn"} className={mode === "isbn" ? "active" : ""} onClick={() => switchMode("isbn")}>Book has ISBN</button>
          <button type="button" role="tab" aria-selected={mode === "no-isbn"} className={mode === "no-isbn" ? "active" : ""} onClick={() => switchMode("no-isbn")}>No ISBN</button>
        </div>
        {mode === "isbn" ? (
          <>
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
              <small id="isbn-help">Type or scan the ISBN. Spaces and hyphens are accepted. For an ISBN-10 ending in X, use the X key.</small>
              <button className="search-button" type="submit" disabled={loading}>
                {loading ? <LoaderCircle className="spin" size={20} /> : <Search size={20} />}
                {loading ? "Searching catalogues…" : "Search ISBN"}
              </button>
            </form>
            <div className="tests">
              <span>Test:</span>
              {TEST_ISBNS.map((value) => <button type="button" key={value} onClick={() => void lookup(value)}>{value}</button>)}
            </div>
          </>
        ) : (
          <form className="search-card no-isbn-search" onSubmit={submitBookSearch}>
            <div className="query-grid">
              <label className="wide" htmlFor="book-title">
                <span>Title from the title page</span>
                <input ref={titleInputRef} id="book-title" autoComplete="off" value={bookQuery.title} onChange={(event) => setBookQuery({ ...bookQuery, title: event.target.value })} placeholder="Enter the printed title" />
              </label>
              <label htmlFor="book-author">
                <span>Author</span>
                <input id="book-author" autoComplete="off" value={bookQuery.author} onChange={(event) => setBookQuery({ ...bookQuery, author: event.target.value })} placeholder="Optional but useful" />
              </label>
              <label htmlFor="book-publisher">
                <span>Publisher</span>
                <input id="book-publisher" autoComplete="off" value={bookQuery.publisher} onChange={(event) => setBookQuery({ ...bookQuery, publisher: event.target.value })} placeholder="Optional" />
              </label>
              <label htmlFor="book-year">
                <span>Year</span>
                <input id="book-year" inputMode="numeric" autoComplete="off" value={bookQuery.year} onChange={(event) => setBookQuery({ ...bookQuery, year: event.target.value.replace(/[^0-9]/g, "").slice(0, 4) })} placeholder="Optional" />
              </label>
            </div>
            <small>Use the title page, not promotional text on the cover. Search old and modern spelling separately when necessary.</small>
            <button className="search-button" type="submit" disabled={loading}>
              {loading ? <LoaderCircle className="spin" size={20} /> : <Search size={20} />}
              {loading ? "Searching catalogues…" : "Search without ISBN"}
            </button>
            <button className="manual-link" type="button" onClick={openManualEntry}>No catalogue search? Enter a verified physical-book record</button>
          </form>
        )}
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
          <h2>{mode === "isbn" ? "Checking the identifier and catalogues" : "Searching catalogues by title"}</h2>
          <p>Indonesia OneSearch, Open Library, and Google Books are searched independently.</p>
          <div className="progress"><span /></div>
        </section>
      ) : null}

      {resolution ? (
        <section className="results" aria-live="polite">
          <div className="result-head">
            <div>
              <p className="eyebrow">{mode === "isbn" ? `ISBN ${resolution.canonical || resolution.raw_input}` : "Search without ISBN"}</p>
              <h2>{resultTitle(resolution.state, mode)}</h2>
              <p>{resolution.state_message || resolution.validation_message}</p>
            </div>
            <div className="result-tools">
              {resolution.valid ? <span className="valid">{mode === "isbn" ? <ShieldCheck size={17} /> : <Search size={17} />} {mode === "isbn" ? "Valid ISBN" : "Title search"}</span> : null}
              <button type="button" className="new-search" onClick={startNewSearch}><Search size={16} /> New search</button>
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
                <div><strong>Match the copy in hand</strong><span>{mode === "isbn" ? "Check edition, year, publisher, and page count." : "Check the title page, copyright page, edition or printing, publisher, year, and extent."}</span></div>
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
              {mode === "no-isbn" ? <button type="button" className="manual-after-results" onClick={openManualEntry}>None match the physical book. Enter it manually.</button> : null}
            </>
          ) : (
            <>
              <div className="empty">
                <AlertTriangle size={24} />
                <div>
                  <strong>No record was generated.</strong>
                  <p>Missing metadata stays missing. Nothing was guessed.</p>
                  {mode === "no-isbn" ? <button type="button" className="manual-empty" onClick={openManualEntry}>Enter from the physical book</button> : null}
                </div>
              </div>
              {mode === "isbn" && resolution.valid ? <CatalogueFallback isbn={resolution.canonical || resolution.raw_input} /> : null}
            </>
          )}
        </section>
      ) : null}

      {!loading && !resolution ? (
        <section className="steps">
          <article><span>01</span><strong>Search</strong><p>Use ISBN when present. Otherwise search title, author, publisher, and year.</p></article>
          <article><span>02</span><strong>Verify</strong><p>Keep source disagreements visible and match the physical copy.</p></article>
          <article><span>03</span><strong>Import</strong><p>Check Zotero duplicates, then create or file the verified record.</p></article>
        </section>
      ) : null}

      <footer>
        <p>Mac edition: ISBN search and no-ISBN catalogue recovery.</p>
        <p>No catalogue source is authoritative on its own.</p>
      </footer>

      {resolution?.choices.length ? (
        <div className="action-dock">
          <div className="dock-meta">
            <div className="selection">
              <span>{selectedBook ? (mode === "isbn" ? "Selected edition" : "Selected record") : "Selection required"}</span>
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
            <button type="button" className="new-isbn" onClick={startNewSearch}><Search size={19} /> New search</button>
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

      {manualOpen ? (
        <div className="backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setManualOpen(false); }}>
          <section className="setup-sheet manual-sheet" role="dialog" aria-modal="true" aria-labelledby="manual-title">
            <div className="handle" />
            <div className="setup-head">
              <span className="key-icon"><BookOpen size={22} /></span>
              <div><p className="eyebrow">No ISBN and no reliable match</p><h2 id="manual-title">Transcribe the physical book</h2></div>
              <button type="button" aria-label="Close manual entry" onClick={() => setManualOpen(false)}><X size={22} /></button>
            </div>
            <p className="setup-copy">Use the title page and copyright page. Leave an uncertain field blank. Do not copy a guessed date or edition from another book.</p>
            <form onSubmit={prepareManualRecord}>
              <div className="manual-grid">
                {MANUAL_FIELDS.map((field) => (
                  <label className={field.wide ? "wide" : ""} key={field.key} htmlFor={`manual-${field.key}`}>
                    <span>{field.label}{field.key === "title" ? " *" : ""}</span>
                    <input
                      id={`manual-${field.key}`}
                      autoComplete="off"
                      value={manualFields[field.key]}
                      onChange={(event) => setManualFields({ ...manualFields, [field.key]: event.target.value })}
                      placeholder={field.placeholder}
                    />
                  </label>
                ))}
              </div>
              <p className="manual-help">Several authors, editors, or translators must be separated with semicolons. ISBN remains blank.</p>
              <button type="submit" className="check-key">Prepare record for review</button>
            </form>
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
            <p className="setup-copy">A personal Zotero API key allows direct creation from this Mac. It is sent only for Zotero checks and imports and is never stored by this app’s server.</p>
            <a href="https://www.zotero.org/settings/keys/new" target="_blank" rel="noreferrer">Create a Zotero key <ExternalLink size={16} /></a>
            <p className="key-help">Name it “ISBN to Zotero - iMac”. Enable personal library access and write access. Leave notes and groups disabled.</p>
            <label htmlFor="api-key">Zotero API key</label>
            <input id="api-key" className="key-input" type="password" autoComplete="off" value={apiKey} onChange={(event) => setAPIKey(event.target.value.trim())} placeholder="Paste the private key" />
            <label className="remember">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              <span><strong>Remember on this Mac</strong><small>Recommended only for a private device. The Mac web app stores the key locally.</small></span>
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
