export type Confidence = "high" | "review" | "ambiguous";

export interface ISBNInfo {
  raw: string;
  canonical: string;
  isbn10: string | null;
  isbn13: string | null;
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
  series: string;
  series_number: string;
  volume: string;
  number_of_volumes: string;
  num_pages: string;
  extent: string;
  languages: string[];
  isbns: string[];
  subjects: string[];
  abstract: string;
  notes: string[];
}

export interface SourceStatus {
  source: string;
  ok: boolean;
  records: number;
  message: string;
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
  series: string;
  series_number: string;
  volume: string;
  number_of_volumes: string;
  num_pages: string;
  extent: string;
  languages: string[];
  isbns: string[];
  subjects: string[];
  abstract: string;
  notes: string[];
  source_records: SourceRecord[];
  conflicts: Record<string, string[]>;
  confidence: Confidence;
  reason: string;
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
  state:
    | "invalid"
    | "source_unavailable"
    | "not_found"
    | "ambiguous_title"
    | "multiple_editions"
    | "ready"
    | "review";
  state_message: string;
  recommended_choice_id: string | null;
}

export interface BookSearchInput {
  title: string;
  author: string;
  publisher: string;
  year: string;
}
