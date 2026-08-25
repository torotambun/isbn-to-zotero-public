from __future__ import annotations

from .models import ReconciledBook, Resolution, SourceRecord, SourceStatus
from .manifestation import split_manifestation_statement


def source_record_from_dict(data: dict) -> SourceRecord:
    payload = dict(data)
    if not payload.get("printing"):
        edition, printing = split_manifestation_statement(payload.get("edition", ""))
        payload["edition"] = edition
        payload["printing"] = printing
    allowed = SourceRecord.__dataclass_fields__.keys()
    return SourceRecord(**{key: payload[key] for key in allowed if key in payload})


def book_from_dict(data: dict) -> ReconciledBook:
    payload = dict(data)
    if not payload.get("printing"):
        edition, printing = split_manifestation_statement(payload.get("edition", ""))
        payload["edition"] = edition
        payload["printing"] = printing
    if "requires_physical_confirmation" not in payload:
        payload["requires_physical_confirmation"] = payload.get("confidence") != "high"
    payload["source_records"] = [source_record_from_dict(item) for item in data.get("source_records", [])]
    allowed = ReconciledBook.__dataclass_fields__.keys()
    return ReconciledBook(**{key: payload[key] for key in allowed if key in payload})


def resolution_from_dict(data: dict) -> Resolution:
    payload = dict(data)
    payload["source_statuses"] = [SourceStatus(**item) for item in data.get("source_statuses", [])]
    payload["records"] = [source_record_from_dict(item) for item in data.get("records", [])]
    payload["choices"] = [book_from_dict(item) for item in data.get("choices", [])]
    allowed = Resolution.__dataclass_fields__.keys()
    return Resolution(**{key: payload[key] for key in allowed if key in payload})
