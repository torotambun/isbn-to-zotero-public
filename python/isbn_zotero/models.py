from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class SourceRecord:
    source: str
    source_id: str
    source_url: str
    title: str
    subtitle: str = ""
    authors: list[str] = field(default_factory=list)
    editors: list[str] = field(default_factory=list)
    translators: list[str] = field(default_factory=list)
    publisher: str = ""
    place: str = ""
    date: str = ""
    edition: str = ""
    printing: str = ""
    num_pages: str = ""
    extent: str = ""
    languages: list[str] = field(default_factory=list)
    isbns: list[str] = field(default_factory=list)
    subjects: list[str] = field(default_factory=list)
    abstract: str = ""
    notes: list[str] = field(default_factory=list)
    identifiers: dict[str, list[str]] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data.pop("raw", None)
        return data


@dataclass(slots=True)
class SourceStatus:
    source: str
    ok: bool
    records: int = 0
    message: str = ""


@dataclass(slots=True)
class ReconciledBook:
    choice_id: str
    title_cluster_id: str
    title: str
    subtitle: str = ""
    authors: list[str] = field(default_factory=list)
    editors: list[str] = field(default_factory=list)
    translators: list[str] = field(default_factory=list)
    publisher: str = ""
    place: str = ""
    date: str = ""
    edition: str = ""
    printing: str = ""
    num_pages: str = ""
    extent: str = ""
    languages: list[str] = field(default_factory=list)
    isbns: list[str] = field(default_factory=list)
    subjects: list[str] = field(default_factory=list)
    abstract: str = ""
    notes: list[str] = field(default_factory=list)
    source_records: list[SourceRecord] = field(default_factory=list)
    conflicts: dict[str, list[str]] = field(default_factory=dict)
    confidence: str = "review"
    reason: str = ""
    requires_physical_confirmation: bool = True

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["source_records"] = [r.to_dict() for r in self.source_records]
        return data


@dataclass(slots=True)
class Resolution:
    raw_input: str
    valid: bool
    isbn10: str | None = None
    isbn13: str | None = None
    canonical: str | None = None
    validation_message: str = ""
    source_statuses: list[SourceStatus] = field(default_factory=list)
    records: list[SourceRecord] = field(default_factory=list)
    choices: list[ReconciledBook] = field(default_factory=list)
    state: str = "invalid"
    state_message: str = ""
    recommended_choice_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "raw_input": self.raw_input,
            "valid": self.valid,
            "isbn10": self.isbn10,
            "isbn13": self.isbn13,
            "canonical": self.canonical,
            "validation_message": self.validation_message,
            "source_statuses": [asdict(s) for s in self.source_statuses],
            "records": [r.to_dict() for r in self.records],
            "choices": [c.to_dict() for c in self.choices],
            "state": self.state,
            "state_message": self.state_message,
            "recommended_choice_id": self.recommended_choice_id,
        }
