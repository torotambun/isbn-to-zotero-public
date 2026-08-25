export interface ISBNInfo {
  raw: string;
  normalized: string;
  isbn10: string | null;
  isbn13: string | null;
  canonical: string;
  searchForms: string[];
}

export interface SourceRecord {
  source: string;
  source_id: string;
  source_url: string;
  title: string;
  subtitle: string;
  authors: string[];
  editors: string[];
  translators: string[];
  publisher: string;
  place: string;
  date: string;
  edition: string;
  printing: string;
  num_pages: string;
  extent: string;
  languages: string[];
  isbns: string[];
  subjects: string[];
  abstract: string;
  notes: string[];
  identifiers: Record<string, string[]>;
}

export interface SourceStatus {
  source: string;
  ok: boolean;
  records: number;
  message: string;
}

export interface SourceResult {
  records: SourceRecord[];
  status: SourceStatus;
}

export interface ReconciledBook {
  choice_id: string;
  title_cluster_id: string;
  title: string;
  subtitle: string;
  authors: string[];
  editors: string[];
  translators: string[];
  publisher: string;
  place: string;
  date: string;
  edition: string;
  printing: string;
  num_pages: string;
  extent: string;
  languages: string[];
  isbns: string[];
  subjects: string[];
  abstract: string;
  notes: string[];
  source_records: SourceRecord[];
  conflicts: Record<string, string[]>;
  confidence: "high" | "review" | "ambiguous";
  reason: string;
  requires_physical_confirmation: boolean;
}

export interface Resolution {
  raw_input: string;
  valid: boolean;
  isbn10: string | null;
  isbn13: string | null;
  canonical: string | null;
  validation_message: string;
  source_statuses: SourceStatus[];
  records: SourceRecord[];
  choices: ReconciledBook[];
  state: "invalid" | "not_found" | "ambiguous_title" | "multiple_editions" | "ready" | "review";
  state_message: string;
  recommended_choice_id: string | null;
}

export function sourceRecord(values: Partial<SourceRecord> & Pick<SourceRecord, "source" | "source_id" | "source_url" | "title">): SourceRecord {
  return {
    subtitle: "",
    authors: [],
    editors: [],
    translators: [],
    publisher: "",
    place: "",
    date: "",
    edition: "",
    printing: "",
    num_pages: "",
    extent: "",
    languages: [],
    isbns: [],
    subjects: [],
    abstract: "",
    notes: [],
    identifiers: {},
    ...values,
  };
}
