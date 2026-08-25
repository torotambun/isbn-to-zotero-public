from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import Counter
from difflib import SequenceMatcher
from typing import Callable, Iterable

from .isbn import ISBNInfo, valid_isbns
from .models import ReconciledBook, SourceRecord


PLACEHOLDER_PUBLISHERS = {
    "alauddin university",
    "unknown",
    "s.n.",
    "sn",
}


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = value.casefold().replace("&", " dan ")
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(value.split())


def normalize_title(value: str) -> str:
    value = normalize_text(value)
    return re.sub(r"\s+", " ", value).strip()


def title_similarity(left: str, right: str) -> float:
    a = normalize_title(left)
    b = normalize_title(right)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if a in b or b in a:
        shorter = min(len(a), len(b))
        longer = max(len(a), len(b))
        if shorter / longer >= 0.55:
            return 0.91
    return SequenceMatcher(None, a, b).ratio()


def _person_key(value: str) -> str:
    tokens = normalize_text(value.replace(",", " ")).split()
    ignored = {"dkk", "et", "al", "dr"}
    return " ".join(sorted(token for token in tokens if token not in ignored))


def _people_similarity(left: list[str], right: list[str]) -> float:
    if not left or not right:
        return 0.0
    return max(
        SequenceMatcher(None, _person_key(a), _person_key(b)).ratio()
        for a in left
        for b in right
        if _person_key(a) and _person_key(b)
    )


def _same_title_family(left: SourceRecord, right: SourceRecord) -> bool:
    score = title_similarity(left.title, right.title)
    if score >= 0.86:
        return True
    a = normalize_title(left.title)
    b = normalize_title(right.title)
    if not a or not b:
        return False
    prefix_or_contained = a.startswith(b) or b.startswith(a) or a in b or b in a
    if not prefix_or_contained:
        return False
    author_score = _people_similarity(left.authors, right.authors)
    same_year = bool(_normalize_date(left.date)) and _normalize_date(left.date) == _normalize_date(right.date)
    same_publisher = _publisher_similarity(left.publisher, right.publisher) >= 0.82
    return author_score >= 0.72 or (same_year and same_publisher)


def _cluster_by_title(records: list[SourceRecord]) -> list[list[SourceRecord]]:
    clusters: list[list[SourceRecord]] = []
    for record in records:
        best_index = None
        best_score = 0.0
        for index, cluster in enumerate(clusters):
            score = max(
                max(title_similarity(record.title, item.title), 0.86)
                if _same_title_family(record, item)
                else 0.0
                for item in cluster
            )
            if score > best_score:
                best_score = score
                best_index = index
        if best_index is not None and best_score >= 0.86:
            clusters[best_index].append(record)
        else:
            clusters.append([record])
    return clusters


def _normalize_date(value: str) -> str:
    match = re.search(r"\b(1[5-9]\d{2}|20\d{2}|2100)\b", value or "")
    return match.group(1) if match else normalize_text(value)


def _edition_number(value: str) -> str:
    value = normalize_text(value)
    match = re.search(r"\b(?:ed(?:isi|ition)?)\s*(?:ke\s*)?(\d+)\b", value)
    return match.group(1) if match else value


def _printing_number(value: str) -> str:
    value = normalize_text(value)
    match = re.search(r"\b(?:cet(?:akan)?|printing|impression)\s*(?:ke\s*)?(\d+)\b", value)
    return match.group(1) if match else value


def _publisher_key(value: str) -> str:
    normalized = normalize_text(value)
    return re.sub(r"\s+", "", normalized)


def _publisher_similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, _publisher_key(left), _publisher_key(right)).ratio()


def _cluster_by_manifestation(records: list[SourceRecord]) -> list[list[SourceRecord]]:
    precise: dict[tuple[str, str, str], list[SourceRecord]] = {}
    unresolved: list[SourceRecord] = []
    for record in records:
        date = _normalize_date(record.date)
        edition = _edition_number(record.edition)
        printing = _printing_number(record.printing)
        if not edition and not printing:
            unresolved.append(record)
            continue
        key = (date, edition, printing)
        precise.setdefault(key, []).append(record)

    if not precise:
        dated: dict[str, list[SourceRecord]] = {}
        undated: list[SourceRecord] = []
        for record in records:
            date = _normalize_date(record.date)
            if date:
                dated.setdefault(date, []).append(record)
            else:
                undated.append(record)
        if len(dated) == 1:
            only = next(iter(dated.values()))
            only.extend(undated)
            return [only]
        clusters = list(dated.values())
        if len(clusters) == 1:
            clusters[0].extend(undated)
        elif undated:
            clusters.append(undated)
        return clusters or [records]

    clusters = list(precise.values())
    pending: list[SourceRecord] = []
    for record in unresolved:
        date = _normalize_date(record.date)
        compatible = [
            cluster
            for cluster in clusters
            if not date or any(_normalize_date(item.date) == date for item in cluster)
        ]
        if len(compatible) == 1:
            compatible[0].append(record)
        else:
            pending.append(record)

    pending_by_date: dict[str, list[SourceRecord]] = {}
    undated: list[SourceRecord] = []
    for record in pending:
        date = _normalize_date(record.date)
        if date:
            pending_by_date.setdefault(date, []).append(record)
        else:
            undated.append(record)
    clusters.extend(pending_by_date.values())
    if len(clusters) == 1:
        clusters[0].extend(undated)
    elif undated:
        publisher_matches = [
            cluster
            for cluster in clusters
            if any(
                record.publisher
                and item.publisher
                and _publisher_similarity(record.publisher, item.publisher) >= 0.82
                for record in undated
                for item in cluster
            )
        ]
        if len(publisher_matches) == 1:
            publisher_matches[0].extend(undated)
        else:
            clusters.append(undated)
    return clusters


def _source_weight(record: SourceRecord) -> int:
    if record.source == "Open Library":
        return 3
    if record.source == "Indonesia OneSearch":
        return 2
    if record.source == "Google Books":
        return 2
    return 1


def _is_placeholder(field: str, value: str) -> bool:
    normalized = normalize_text(value)
    if not normalized:
        return True
    if field == "publisher" and normalized in PLACEHOLDER_PUBLISHERS:
        return True
    return False


def _pick_scalar(
    records: list[SourceRecord],
    field: str,
    normalizer: Callable[[str], str] = normalize_text,
) -> tuple[str, list[str]]:
    values: dict[str, list[tuple[str, int]]] = {}
    first_index: dict[str, int] = {}
    for index, record in enumerate(records):
        value = str(getattr(record, field, "") or "").strip()
        if _is_placeholder(field, value):
            continue
        key = normalizer(value)
        if not key:
            continue
        values.setdefault(key, []).append((value, _source_weight(record)))
        first_index.setdefault(key, index)
    if not values:
        return "", []

    def evidence(key: str) -> tuple[int, int, int, int]:
        source_caps: dict[str, int] = {}
        for record in records:
            value = str(getattr(record, field, "") or "").strip()
            if value and normalizer(value) == key:
                source_caps[record.source] = max(source_caps.get(record.source, 0), _source_weight(record))
        return (
            sum(source_caps.values()),
            len(source_caps),
            len(values[key]),
            max(len(value) for value, _ in values[key]),
        )

    ranked = sorted(
        values,
        key=lambda key: (
            evidence(key),
            -first_index[key],
        ),
        reverse=True,
    )
    winner = ranked[0]
    variants = [value for value, _ in values[winner]]
    chosen = max(variants, key=lambda value: (Counter(variants)[value], len(value)))
    conflicts = []
    for key in ranked:
        representative = max((value for value, _ in values[key]), key=len)
        if representative.casefold() not in {item.casefold() for item in conflicts}:
            conflicts.append(representative)
    return chosen, conflicts if len(conflicts) > 1 else []


def _pick_people(records: list[SourceRecord], field: str) -> tuple[list[str], list[str]]:
    lists = [list(getattr(record, field, []) or []) for record in records if getattr(record, field, [])]
    if not lists:
        return [], []

    clusters: list[dict] = []
    for record in records:
        values = list(getattr(record, field, []) or [])
        if not values:
            continue
        joined = "|".join(sorted(_person_key(value) for value in values))
        match = None
        for cluster in clusters:
            if SequenceMatcher(None, joined, cluster["key"]).ratio() >= 0.84:
                match = cluster
                break
        if match is None:
            match = {"key": joined, "variants": [], "sources": {}}
            clusters.append(match)
        match["variants"].append(values)
        match["sources"][record.source] = max(match["sources"].get(record.source, 0), _source_weight(record))

    winner = max(
        clusters,
        key=lambda cluster: (
            sum(cluster["sources"].values()),
            len(cluster["sources"]),
            len(cluster["variants"]),
            len(cluster["key"]),
        ),
    )
    source_priority = {record.source: _source_weight(record) for record in records}
    candidates: list[tuple[list[str], int]] = []
    for record in records:
        values = list(getattr(record, field, []) or [])
        if not values:
            continue
        joined = "|".join(sorted(_person_key(value) for value in values))
        if SequenceMatcher(None, joined, winner["key"]).ratio() >= 0.84:
            candidates.append((values, source_priority.get(record.source, 1)))
    chosen = max(candidates, key=lambda item: (item[1], len(item[0]), sum(len(value) for value in item[0])))[0]
    conflict_lists = []
    for cluster in clusters:
        representative = max(cluster["variants"], key=lambda values: sum(len(value) for value in values))
        joined = "; ".join(representative)
        if joined and joined not in conflict_lists:
            conflict_lists.append(joined)
    return chosen, conflict_lists if len(conflict_lists) > 1 else []


def _union(records: list[SourceRecord], field: str) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for record in records:
        for raw in getattr(record, field, []) or []:
            value = str(raw).strip()
            key = normalize_text(value)
            if value and key not in seen:
                seen.add(key)
                output.append(value)
    return output


def _make_id(prefix: str, parts: Iterable[str]) -> str:
    material = "|".join(parts).encode("utf-8")
    return f"{prefix}-{hashlib.sha1(material).hexdigest()[:10]}"


def reconcile(records: list[SourceRecord], isbn: ISBNInfo) -> list[ReconciledBook]:
    choices: list[ReconciledBook] = []
    title_clusters = _cluster_by_title(records)
    multiple_titles = len(title_clusters) > 1

    for title_records in title_clusters:
        title_cluster_id = _make_id(
            "work",
            [isbn.canonical, normalize_title(max((record.title for record in title_records), key=len))],
        )
        manifestation_clusters = _cluster_by_manifestation(title_records)
        for edition_records in manifestation_clusters:
            conflicts: dict[str, list[str]] = {}
            title, values = _pick_scalar(edition_records, "title", normalize_title)
            if values:
                conflicts["title"] = values
            subtitle, values = _pick_scalar(edition_records, "subtitle")
            if values:
                conflicts["subtitle"] = values
            authors, values = _pick_people(edition_records, "authors")
            if values:
                conflicts["authors"] = values
            editors, values = _pick_people(edition_records, "editors")
            if values:
                conflicts["editors"] = values
            translators, values = _pick_people(edition_records, "translators")
            if values:
                conflicts["translators"] = values
            role_conflicts = []
            for author in authors:
                for role, people in (("editor", editors), ("translator", translators)):
                    for person in people:
                        if SequenceMatcher(None, _person_key(author), _person_key(person)).ratio() >= 0.9:
                            role_conflicts.append(f"{person}: reported as both author and {role}")
            if role_conflicts:
                conflicts["creator_roles"] = sorted(set(role_conflicts))
            publisher, values = _pick_scalar(edition_records, "publisher")
            if values:
                conflicts["publisher"] = values
            place, values = _pick_scalar(edition_records, "place")
            if values:
                conflicts["place"] = values
            date, values = _pick_scalar(edition_records, "date", _normalize_date)
            if values:
                conflicts["date"] = values
            edition, values = _pick_scalar(edition_records, "edition", _edition_number)
            if values:
                conflicts["edition"] = values
            printing, values = _pick_scalar(edition_records, "printing", _printing_number)
            if values:
                conflicts["printing"] = values
            num_pages, values = _pick_scalar(edition_records, "num_pages", normalize_text)
            if values:
                conflicts["num_pages"] = values
            extent, values = _pick_scalar(edition_records, "extent", normalize_text)
            if values:
                conflicts["extent"] = values
            abstract, _ = _pick_scalar(edition_records, "abstract", normalize_text)

            isbns = valid_isbns(_union(edition_records, "isbns") + list(isbn.search_forms))
            notes = _union(edition_records, "notes")
            source_count = len({record.source for record in edition_records})
            record_count = len(edition_records)
            critical_conflicts = {"title", "authors", "publisher", "date", "edition", "printing"} & set(conflicts)

            if multiple_titles:
                confidence = "ambiguous"
                reason = "This ISBN is attached to more than one distinct title. Match the title page and copyright page."
            elif len(manifestation_clusters) > 1:
                confidence = "review"
                reason = "More than one printing or edition is represented. Match the edition statement and year."
            elif critical_conflicts:
                confidence = "review"
                reason = "Sources disagree on important bibliographic fields. Inspect the listed conflicts."
            elif source_count >= 2:
                confidence = "high"
                reason = "At least two distinct catalogue sources agree on the principal bibliographic metadata."
            elif record_count >= 2:
                confidence = "review"
                reason = "Several records agree, but they come from only one catalogue source. Confirm the physical book."
            else:
                confidence = "review"
                reason = "Only one usable record was found. Confirm it against the physical book."

            choice_id = _make_id(
                "edition",
                [
                    isbn.canonical,
                    title_cluster_id,
                    _normalize_date(date),
                    _edition_number(edition),
                    _printing_number(printing),
                    normalize_text(publisher),
                ],
            )
            choices.append(
                ReconciledBook(
                    choice_id=choice_id,
                    title_cluster_id=title_cluster_id,
                    title=title,
                    subtitle=subtitle,
                    authors=authors,
                    editors=editors,
                    translators=translators,
                    publisher=publisher,
                    place=place,
                    date=date,
                    edition=edition,
                    printing=printing,
                    num_pages=num_pages,
                    extent=extent,
                    languages=_union(edition_records, "languages"),
                    isbns=isbns,
                    subjects=_union(edition_records, "subjects"),
                    abstract=abstract,
                    notes=notes,
                    source_records=edition_records,
                    conflicts=conflicts,
                    confidence=confidence,
                    reason=reason,
                    requires_physical_confirmation=confidence != "high",
                )
            )

    confidence_order = {"high": 0, "review": 1, "ambiguous": 2}
    choices.sort(
        key=lambda item: (
            confidence_order.get(item.confidence, 9),
            -len({record.source for record in item.source_records}),
            -len(item.source_records),
            _normalize_date(item.date),
            normalize_title(item.title),
        )
    )
    return choices
