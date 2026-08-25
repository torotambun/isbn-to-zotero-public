from __future__ import annotations

import re


PRINTING_MARKER = re.compile(r"\b(?:cet(?:akan)?|printing|impression)\b", flags=re.I)
EDITION_MARKER = re.compile(r"\b(?:ed(?:isi|ition)?)\b", flags=re.I)


def split_manifestation_statement(value: object) -> tuple[str, str]:
    """Return (edition, printing) without treating cetakan as an edition.

    A mixed statement is kept conservatively as a printing statement so it is
    never written to Zotero's edition field without human review.
    """

    statement = " ".join(str(value or "").replace("\x00", "").split())
    if not statement:
        return "", ""
    if PRINTING_MARKER.search(statement):
        return "", statement
    return statement, ""


def is_printing_statement(value: object) -> bool:
    return bool(PRINTING_MARKER.search(str(value or "")))
