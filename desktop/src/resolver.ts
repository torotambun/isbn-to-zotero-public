import { ISBNValidationError, parseISBN } from "./isbn.ts";
import { reconcile } from "./reconcile.ts";
import { defaultSources, type SourceAdapter } from "./sources.ts";
import type { ReconciledBook, Resolution, SourceRecord, SourceStatus } from "./types.ts";

function deduplicate(records: SourceRecord[]): SourceRecord[] {
  const output: SourceRecord[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const marker = `${record.source}\0${record.source_id || record.source_url}`;
    if (!seen.has(marker)) {
      seen.add(marker);
      output.push(record);
    }
  }
  return output;
}

export class Resolver {
  readonly sources: SourceAdapter[];

  constructor(sources = defaultSources()) {
    this.sources = sources;
  }

  async resolveOne(rawInput: unknown): Promise<Resolution> {
    const raw = String(rawInput ?? "");
    let info;
    try {
      info = parseISBN(raw);
    } catch (error) {
      if (!(error instanceof ISBNValidationError)) throw error;
      let message = error.message;
      if (error.suggestion) {
        message += ` A mechanically corrected check digit would be ${error.suggestion}, but it was not searched.`;
      }
      return {
        raw_input: raw,
        valid: false,
        isbn10: null,
        isbn13: null,
        canonical: null,
        validation_message: message,
        source_statuses: [],
        records: [],
        choices: [],
        state: "invalid",
        state_message: "",
        recommended_choice_id: null,
      };
    }

    const results = await Promise.all(this.sources.map(async source => {
      try {
        return await source.search(info);
      } catch (error) {
        return {
          records: [],
          status: {
            source: source.name,
            ok: false,
            records: 0,
            message: `Adapter error: ${error instanceof Error ? error.message : String(error)}`,
          } satisfies SourceStatus,
        };
      }
    }));
    const records = deduplicate(results.flatMap(result => result.records));
    const choices = records.length ? reconcile(records, info) : [];
    const titleClusters = new Set(choices.map(choice => choice.title_cluster_id));
    let state: Resolution["state"];
    let stateMessage: string;
    let recommendedChoiceID: string | null = null;
    if (!choices.length) {
      state = "not_found";
      stateMessage = "No verified record was found. No RIS was generated. Use the assisted fallback search or add a source adapter.";
    } else if (titleClusters.size > 1) {
      state = "ambiguous_title";
      stateMessage = "The identifier is linked to multiple titles. Select only after matching the physical title and copyright pages.";
    } else if (choices.length > 1) {
      state = "multiple_editions";
      stateMessage = "The sources represent multiple printings or editions. Select the physical edition before export.";
    } else if (choices[0].confidence === "high") {
      state = "ready";
      stateMessage = "One edition is supported by multiple records and is ready for RIS export.";
      recommendedChoiceID = choices[0].choice_id;
    } else {
      state = "review";
      stateMessage = "One candidate was found, but a physical-book check is still required.";
      recommendedChoiceID = choices[0].choice_id;
    }
    return {
      raw_input: raw,
      valid: true,
      isbn10: info.isbn10,
      isbn13: info.isbn13,
      canonical: info.canonical,
      validation_message: "Valid ISBN. ISBN-10 and ISBN-13 forms were searched where conversion is defined.",
      source_statuses: results.map(result => result.status),
      records,
      choices,
      state,
      state_message: stateMessage,
      recommended_choice_id: recommendedChoiceID,
    };
  }

  findChoice(resolution: Resolution, choiceID: string): ReconciledBook | null {
    return resolution.choices.find(choice => choice.choice_id === choiceID) ?? null;
  }
}
