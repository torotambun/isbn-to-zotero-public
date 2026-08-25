from __future__ import annotations

import os
import re
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Iterable, Mapping

from .isbn import ISBNInfo, ISBNValidationError, equivalent_isbn, parse_isbn, valid_isbns
from .manifestation import split_manifestation_statement
from .models import SourceRecord, SourceStatus
from .network import FetchError, HTTPClient, RequestPacer, application_user_agent


LANGUAGES = {
    "id": "Indonesian",
    "ind": "Indonesian",
    "en": "English",
    "eng": "English",
    "jv": "Javanese",
    "jav": "Javanese",
    "ms": "Malay",
    "msa": "Malay",
    "may": "Malay",
}


def _clean(value: object) -> str:
    return " ".join(str(value or "").replace("\x00", "").split())


def _unique(values: Iterable[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = _clean(raw)
        marker = value.casefold()
        if value and marker not in seen:
            seen.add(marker)
            output.append(value)
    return output


def _language(value: str) -> str:
    value = _clean(value)
    return LANGUAGES.get(value.casefold(), value)


def _dict_text(value: object) -> str:
    if isinstance(value, dict):
        return _clean(value.get("value", ""))
    return _clean(value)


def _authors_from_by_statement(value: str) -> list[str]:
    statement = _clean(value)
    if not statement:
        return []
    head = statement.split(";", 1)[0]
    if re.search(r"\b(?:editor|edited|penyunting|penerjemah|translator|kata pengantar)\b", head, flags=re.I):
        return []
    head = re.sub(r"^(?:oleh|by)\s+", "", head, flags=re.I)
    pieces = re.split(r"\s+(?:dan|and)\s+|\s*&\s*", head, flags=re.I)
    if len(pieces) < 2:
        return []
    authors = []
    for piece in pieces:
        name = re.sub(r"^(?:Dr\.?|Prof\.?)\s+", "", _clean(piece), flags=re.I)
        if name:
            authors.append(name)
    return authors if 2 <= len(authors) <= 6 else []


def _record_matches(record_isbns: list[str], wanted: ISBNInfo) -> bool:
    return any(equivalent_isbn(value, wanted.canonical) for value in record_isbns)


class IndonesiaOneSearch:
    name = "Indonesia OneSearch"
    base_url = "https://onesearch.id"

    def __init__(
        self,
        client: HTTPClient | None = None,
        max_records: int = 8,
        pacer: RequestPacer | None = None,
    ):
        self.client = client or HTTPClient()
        self.max_records = max_records
        self.pacer = pacer or RequestPacer(1.0)

    def search(self, isbn: ISBNInfo) -> tuple[list[SourceRecord], SourceStatus]:
        links: list[str] = []
        errors: list[str] = []
        with ThreadPoolExecutor(max_workers=len(isbn.search_forms)) as executor:
            form_results = list(executor.map(self._search_form, isbn.search_forms))
        for found, form_errors in form_results:
            errors.extend(form_errors)
            for link in found:
                if link not in links:
                    links.append(link)

        links = links[: self.max_records]
        records: list[SourceRecord] = []
        if links:
            worker_count = min(8, len(links))
            with ThreadPoolExecutor(max_workers=worker_count) as executor:
                futures = {executor.submit(self._fetch_record, link, isbn): link for link in links}
                for future in as_completed(futures):
                    try:
                        record = future.result()
                    except FetchError as error:
                        errors.append(str(error))
                        continue
                    if record:
                        records.append(record)
            order = {link: index for index, link in enumerate(links)}
            records.sort(key=lambda item: order.get(item.source_url, len(order)))

        if records:
            message = ""
            if errors:
                message = f"{len(errors)} catalogue request(s) failed; usable records were retained."
            return records, SourceStatus(self.name, True, len(records), message)
        if errors:
            return [], SourceStatus(self.name, False, 0, errors[0])
        return [], SourceStatus(self.name, True, 0, "No matching catalogue record")

    def _search_form(self, form: str) -> tuple[list[str], list[str]]:
        form_errors: list[str] = []
        found: list[str] = []
        for search_type in ("ISN", "AllFields"):
            query = urllib.parse.urlencode(
                {
                    "lookfor": form,
                    "type": search_type,
                    "view": "rss",
                    "limit": "50",
                }
            )
            url = f"{self.base_url}/Search/Results?{query}"
            try:
                self.pacer.wait()
                root = ET.fromstring(self.client.get_bytes(url, "application/rss+xml, application/xml"))
                found = [
                    _clean(item.findtext("link"))
                    for item in root.findall("./channel/item")
                    if _clean(item.findtext("link"))
                ]
            except (FetchError, ET.ParseError) as error:
                form_errors.append(str(error))
                continue
            if found:
                break
        return found, form_errors

    def _fetch_record(self, link: str, wanted: ISBNInfo) -> SourceRecord | None:
        export_url = link.rstrip("/") + "/Export?style=EndNote"
        self.pacer.wait()
        text = self.client.get_text(export_url, "application/x-endnote-refer, text/plain")
        fields = self._parse_endnote(text)
        isbn_values = valid_isbns(fields.get("@", []))
        if not _record_matches(isbn_values, wanted):
            return None

        publisher = _clean((fields.get("I") or [""])[0])
        place = _clean((fields.get("C") or [""])[0])
        date = _clean((fields.get("D") or [""])[0])
        imprint_match = re.match(r"^(.+?)\s*:\s*(.+?)\s*,\s*(\d{4})$", publisher)
        if imprint_match:
            place = place or _clean(imprint_match.group(1))
            publisher = _clean(imprint_match.group(2))
            date = date or imprint_match.group(3)

        format_values = fields.get("0", [])
        extent_candidates = []
        for value in format_values:
            cleaned = re.sub(r"^Other\s*:\s*", "", value, flags=re.I).strip()
            if re.search(r"\b(?:hlm|halaman|pages?|pg)\b", cleaned, flags=re.I):
                extent_candidates.append(cleaned)
        extent = max(extent_candidates, key=len, default="")

        record_id = link.rstrip("/").rsplit("/", 1)[-1]
        title = _clean((fields.get("T") or [""])[0])
        if not title:
            return None
        edition, printing = split_manifestation_statement((fields.get("7") or [""])[0])
        return SourceRecord(
            source=self.name,
            source_id=record_id,
            source_url=link,
            title=title,
            authors=_unique(fields.get("A", [])),
            editors=_unique(fields.get("E", [])),
            publisher=publisher,
            place=place,
            date=date,
            edition=edition,
            printing=printing,
            extent=extent,
            languages=_unique(_language(value) for value in fields.get("G", [])),
            isbns=isbn_values,
            subjects=_unique(fields.get("K", [])),
            abstract=_clean(" ".join(fields.get("X", []))),
            notes=_unique(fields.get("N", [])),
            raw={"endnote": fields, "export_url": export_url},
        )

    @staticmethod
    def _parse_endnote(text: str) -> dict[str, list[str]]:
        fields: dict[str, list[str]] = {}
        current: str | None = None
        for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
            match = re.match(r"^%(.?)\s+(.*)$", raw_line)
            if match:
                current = match.group(1)
                fields.setdefault(current, []).append(_clean(match.group(2)))
            elif current and raw_line.startswith((" ", "\t")) and fields.get(current):
                fields[current][-1] = _clean(fields[current][-1] + " " + raw_line)
        return fields


class OpenLibrary:
    name = "Open Library"
    base_url = "https://openlibrary.org"

    def __init__(
        self,
        client: HTTPClient | None = None,
        contact: str | None = None,
        pacer: RequestPacer | None = None,
    ):
        self.client = client or HTTPClient()
        self.contact = contact if contact is not None else os.getenv("OPEN_LIBRARY_CONTACT", "")
        self.user_agent = application_user_agent(self.contact)
        self.pacer = pacer or RequestPacer(1 / 3 if self.contact else 1.0)

    def search(self, isbn: ISBNInfo) -> tuple[list[SourceRecord], SourceStatus]:
        bibkeys = ",".join(f"ISBN:{form}" for form in isbn.search_forms)
        query = urllib.parse.urlencode({"bibkeys": bibkeys, "jscmd": "data", "format": "json"})
        url = f"{self.base_url}/api/books?{query}"
        try:
            self.pacer.wait()
            payload = self.client.get_json(url, user_agent=self.user_agent)
        except FetchError as error:
            return [], SourceStatus(self.name, False, 0, str(error))

        editions: dict[str, dict] = {}
        matched_forms: dict[str, list[str]] = {}
        for bibkey, data in payload.items():
            if not isinstance(data, dict):
                continue
            key = _clean(data.get("key")) or _clean(data.get("url")) or bibkey
            editions[key] = data
            form = bibkey.split(":", 1)[-1]
            matched_forms.setdefault(key, []).append(form)

        records: list[SourceRecord] = []
        for key, data in editions.items():
            record = self._record_from_api_book(key, data, matched_forms.get(key, []), isbn)
            if record:
                records.append(record)

        if records:
            return records, SourceStatus(self.name, True, len(records), "")
        return [], SourceStatus(self.name, True, 0, "No matching edition record")

    def _record_from_api_book(
        self,
        key: str,
        data: dict,
        query_forms: list[str],
        wanted: ISBNInfo,
    ) -> SourceRecord | None:
        source_identifiers = data.get("identifiers", {}) if isinstance(data.get("identifiers"), dict) else {}
        isbn_values = valid_isbns(
            list(source_identifiers.get("isbn_13", []))
            + list(source_identifiers.get("isbn_10", []))
            + query_forms
        )
        if not _record_matches(isbn_values, wanted):
            return None

        authors = [
            _clean(author.get("name"))
            for author in data.get("authors", [])
            if isinstance(author, dict) and _clean(author.get("name"))
        ]

        notes: list[str] = []
        by_statement = _clean(data.get("by_statement"))
        if by_statement:
            notes.append(f"Statement of responsibility: {by_statement}")
            authors.extend(_authors_from_by_statement(by_statement))
        contributions = _unique(data.get("contributions", []))
        if contributions:
            notes.append("Other contributions listed by source: " + "; ".join(contributions))
        source_notes = _dict_text(data.get("notes"))
        if source_notes:
            notes.append(source_notes)

        languages = []
        for language in data.get("languages", []):
            if isinstance(language, dict):
                key_value = _clean(language.get("key") or language.get("name"))
            else:
                key_value = _clean(language)
            languages.append(_language(key_value.rsplit("/", 1)[-1]))

        identifiers: dict[str, list[str]] = {}
        for field, label in (("lccn", "LCCN"), ("oclc", "OCLC")):
            values = _unique(source_identifiers.get(field, []))
            if values:
                identifiers[label] = values

        record_id = key.rsplit("/", 1)[-1]
        publishers = [
            _clean(item.get("name")) if isinstance(item, dict) else _clean(item)
            for item in data.get("publishers", [])
        ]
        places = [
            _clean(item.get("name")) if isinstance(item, dict) else _clean(item)
            for item in data.get("publish_places", [])
        ]
        subjects = [
            _clean(item.get("name")) if isinstance(item, dict) else _clean(item)
            for item in data.get("subjects", [])
        ]
        source_url = _clean(data.get("url"))
        if source_url.startswith("http://"):
            source_url = "https://" + source_url[len("http://") :]
        if not source_url:
            source_url = f"{self.base_url}{key}"
        edition, printing = split_manifestation_statement(data.get("edition_name"))
        return SourceRecord(
            source=self.name,
            source_id=record_id,
            source_url=source_url,
            title=_clean(data.get("title")),
            subtitle=_clean(data.get("subtitle")),
            authors=_unique(authors),
            publisher=next((value for value in publishers if value), ""),
            place=next((value for value in places if value), ""),
            date=_clean(data.get("publish_date")),
            edition=edition,
            printing=printing,
            num_pages=_clean(data.get("number_of_pages")),
            extent=_clean(data.get("pagination")),
            languages=_unique(languages),
            isbns=isbn_values,
            subjects=_unique(subjects),
            abstract=_dict_text(data.get("description")),
            notes=_unique(notes),
            identifiers=identifiers,
            raw=data,
        )


class GoogleBooks:
    """Dormant adapter: use only in a separate, non-intermixed compliant view."""

    name = "Google Books"
    api_url = "https://www.googleapis.com/books/v1/volumes"

    def __init__(self, client: HTTPClient | None = None, api_key: str | None = None):
        self.client = client or HTTPClient()
        self.api_key = api_key if api_key is not None else os.getenv("GOOGLE_BOOKS_API_KEY", "")

    def search(self, isbn: ISBNInfo) -> tuple[list[SourceRecord], SourceStatus]:
        items: dict[str, dict] = {}
        errors: list[str] = []
        for form in isbn.search_forms:
            params = {"q": f"isbn:{form}", "maxResults": "40", "projection": "full"}
            if self.api_key:
                params["key"] = self.api_key
            url = self.api_url + "?" + urllib.parse.urlencode(params)
            try:
                data = self.client.get_json(url)
            except FetchError as error:
                errors.append(str(error))
                continue
            for item in data.get("items", []) or []:
                item_id = _clean(item.get("id"))
                if item_id:
                    items[item_id] = item

        records: list[SourceRecord] = []
        for item_id, item in items.items():
            info = item.get("volumeInfo", {}) or {}
            identifier_values = [
                _clean(identifier.get("identifier"))
                for identifier in info.get("industryIdentifiers", []) or []
                if isinstance(identifier, dict)
            ]
            isbn_values = valid_isbns(identifier_values)
            if not _record_matches(isbn_values, isbn):
                continue
            title = _clean(info.get("title"))
            if not title:
                continue
            records.append(
                SourceRecord(
                    source=self.name,
                    source_id=item_id,
                    source_url=f"https://books.google.com/books?id={urllib.parse.quote(item_id)}",
                    title=title,
                    subtitle=_clean(info.get("subtitle")),
                    authors=_unique(info.get("authors", []) or []),
                    publisher=_clean(info.get("publisher")),
                    date=_clean(info.get("publishedDate")),
                    num_pages=_clean(info.get("pageCount")),
                    languages=_unique([_language(_clean(info.get("language")))]),
                    isbns=isbn_values,
                    subjects=_unique(info.get("categories", []) or []),
                    abstract=_clean(info.get("description")),
                    raw=item,
                )
            )

        if records:
            message = "" if not errors else "Some Google Books requests failed; verified matches were retained."
            return records, SourceStatus(self.name, True, len(records), message)
        if errors:
            return [], SourceStatus(self.name, False, 0, errors[0])
        return [], SourceStatus(self.name, True, 0, "No matching volume record")


DEFAULT_SOURCES = (OpenLibrary,)


def configured_source_classes(environment: Mapping[str, str] | None = None) -> tuple[type, ...]:
    values = environment if environment is not None else os.environ
    enabled = str(values.get("ISBN_ZOTERO_ENABLE_ONESEARCH", "")).strip().casefold() in {"1", "true", "yes", "on"}
    return (IndonesiaOneSearch, OpenLibrary) if enabled else DEFAULT_SOURCES
