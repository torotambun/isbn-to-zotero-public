const PRINTING_MARKER = /\b(?:cet(?:akan)?|printing|impression)\b/i;

export function splitManifestationStatement(value: unknown): { edition: string; printing: string } {
  const statement = String(value ?? "").replaceAll("\0", "").trim().replace(/\s+/g, " ");
  if (!statement) return { edition: "", printing: "" };
  // A mixed statement is kept conservatively out of Zotero's edition field.
  if (PRINTING_MARKER.test(statement)) return { edition: "", printing: statement };
  return { edition: statement, printing: "" };
}
