from __future__ import annotations

import json
import re
import secrets
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from .isbn import ISBNValidationError, equivalent_isbn
from .models import ReconciledBook
from .reconcile import normalize_text, title_similarity
from .ris import page_total


BASE_URL = "http://127.0.0.1:23119/api"


@dataclass(slots=True)
class LocalZoteroError(Exception):
    code: str
    message: str
    status: int | None = None

    def __str__(self) -> str:
        return self.message


class LocalZotero:
    def __init__(self, timeout: float = 90.0):
        self.timeout = timeout
        self._remembered_keys: dict[str, str] = {}
        self._lock = threading.Lock()

    def status(self) -> dict[str, Any]:
        try:
            status, headers, data = self._request("GET", f"{BASE_URL}/", timeout=4.0)
        except LocalZoteroError as error:
            return {"available": False, "code": error.code, "message": error.message}
        server_id = headers.get("Zotero-Server-ID", "")
        version = headers.get("Zotero-API-Version", "")
        if not server_id:
            return {
                "available": False,
                "code": "write_api_unavailable",
                "message": "Zotero responded, but this version does not expose authorized local writes. Use RIS import.",
            }
        return {
            "available": True,
            "code": "ready",
            "message": "Zotero is open and direct import is available.",
            "server_id": server_id,
            "api_version": version or "3",
        }

    def add_book(self, book: ReconciledBook) -> dict[str, Any]:
        with self._lock:
            connection = self.status()
            if not connection.get("available"):
                raise LocalZoteroError(
                    str(connection.get("code", "unavailable")),
                    str(connection.get("message", "Zotero is unavailable.")),
                )
            server_id = str(connection["server_id"])

            duplicate = self._find_duplicate(book, server_id)
            if duplicate:
                return {
                    "created": False,
                    "duplicate": True,
                    "message": "A likely matching book already exists in Zotero. No duplicate was created.",
                    "item_key": duplicate.get("key", ""),
                    "title": duplicate.get("title", ""),
                }

            template = self._new_book_template(server_id)
            item = self._fill_template(template, book)
            key = self._remembered_keys.get(server_id)
            if not key:
                key, remember = self._authorize(server_id)
                if remember:
                    self._remembered_keys[server_id] = key

            try:
                response = self._write_item(server_id, key, item)
            except LocalZoteroError as error:
                if error.status != 401:
                    raise
                self._remembered_keys.pop(server_id, None)
                key, remember = self._authorize(server_id)
                if remember:
                    self._remembered_keys[server_id] = key
                response = self._write_item(server_id, key, item)

            successful = response.get("successful", {}) if isinstance(response, dict) else {}
            if successful:
                created = next(iter(successful.values()))
                return {
                    "created": True,
                    "duplicate": False,
                    "message": "The book was added directly to Zotero.",
                    "item_key": created.get("key", "") if isinstance(created, dict) else "",
                    "title": book.title,
                }
            failed = response.get("failed", {}) if isinstance(response, dict) else {}
            detail = json.dumps(failed, ensure_ascii=False) if failed else "Zotero did not report a created item."
            raise LocalZoteroError("write_failed", f"Zotero rejected the item: {detail}")

    def _find_duplicate(self, book: ReconciledBook, server_id: str) -> dict[str, Any] | None:
        query_isbn = next((value for value in book.isbns if len(value) == 13), None) or next(iter(book.isbns), "")
        queries = [value for value in (query_isbn, book.title) if value]
        candidates: dict[str, dict[str, Any]] = {}
        for query_value in queries:
            query = urllib.parse.urlencode(
                {"q": query_value, "qmode": "everything", "itemType": "book", "limit": "50"}
            )
            _, _, payload = self._request(
                "GET",
                f"{BASE_URL}/users/0/items?{query}",
                headers={"Zotero-Server-ID": server_id, "Zotero-API-Version": "3"},
                timeout=10.0,
            )
            if not isinstance(payload, list):
                continue
            for index, wrapper in enumerate(payload):
                data = wrapper.get("data", {}) if isinstance(wrapper, dict) else {}
                if isinstance(data, dict):
                    candidates[str(data.get("key", "")) or f"{query_value}:{index}"] = data

        for data in candidates.values():
            stored_isbns = str(data.get("ISBN", "")).replace(",", " ").replace(";", " ").split()
            same_isbn = bool(query_isbn) and any(equivalent_isbn(query_isbn, value) for value in stored_isbns)
            title_score = title_similarity(book.title, str(data.get("title", "")))
            if same_isbn and title_score >= 0.86:
                return data
            if not stored_isbns and title_score >= 0.92 and (
                self._creator_matches(book, data) or self._year_matches(book.date, str(data.get("date", "")))
            ):
                return data
        return None

    @staticmethod
    def _creator_matches(book: ReconciledBook, data: dict[str, Any]) -> bool:
        def key(value: str) -> str:
            return " ".join(sorted(normalize_text(value.replace(",", " ")).split()))

        expected = [key(value) for value in book.authors if value]
        stored: list[str] = []
        for creator in data.get("creators", []) if isinstance(data.get("creators"), list) else []:
            if not isinstance(creator, dict):
                continue
            name = str(creator.get("name", "")).strip()
            if not name:
                name = " ".join(
                    value for value in (str(creator.get("firstName", "")).strip(), str(creator.get("lastName", "")).strip()) if value
                )
            if name:
                stored.append(key(name))
        return any(
            left and right and SequenceMatcher(None, left, right).ratio() >= 0.84
            for left in expected
            for right in stored
        )

    @staticmethod
    def _year_matches(left: str, right: str) -> bool:
        first = re.search(r"\b(?:1[5-9]\d{2}|20\d{2}|2100)\b", left or "")
        second = re.search(r"\b(?:1[5-9]\d{2}|20\d{2}|2100)\b", right or "")
        return bool(first and second and first.group(0) == second.group(0))

    def _new_book_template(self, server_id: str) -> dict[str, Any]:
        _, _, payload = self._request(
            "GET",
            f"{BASE_URL}/items/new?itemType=book",
            headers={"Zotero-Server-ID": server_id, "Zotero-API-Version": "3"},
            timeout=10.0,
        )
        if not isinstance(payload, dict) or payload.get("itemType") != "book":
            raise LocalZoteroError("template_failed", "Zotero did not return a valid book template.")
        return payload

    def _authorize(self, server_id: str) -> tuple[str, bool]:
        _, _, payload = self._request(
            "POST",
            f"{BASE_URL}/local/authorize",
            headers={"Zotero-Server-ID": server_id, "Zotero-API-Version": "3"},
            body={"appName": "ISBN to Zotero"},
            timeout=self.timeout,
        )
        if not isinstance(payload, dict) or not payload.get("key"):
            raise LocalZoteroError("authorization_failed", "Zotero did not grant a local write key.")
        return str(payload["key"]), bool(payload.get("remember"))

    def _write_item(self, server_id: str, key: str, item: dict[str, Any]) -> dict[str, Any]:
        _, _, payload = self._request(
            "POST",
            f"{BASE_URL}/users/0/items",
            headers={
                "Zotero-Server-ID": server_id,
                "Zotero-API-Version": "3",
                "Zotero-API-Key": key,
                "Zotero-Write-Token": secrets.token_hex(16),
            },
            body=[item],
            timeout=20.0,
        )
        return payload if isinstance(payload, dict) else {}

    @staticmethod
    def _fill_template(template: dict[str, Any], book: ReconciledBook) -> dict[str, Any]:
        item = dict(template)
        full_title = book.title
        if book.subtitle and book.subtitle.casefold() not in book.title.casefold():
            full_title = f"{book.title}: {book.subtitle}"
        values = {
            "title": full_title,
            "abstractNote": book.abstract,
            "edition": book.edition,
            "place": book.place,
            "publisher": book.publisher,
            "date": book.date,
            "numPages": page_total(book),
            "language": "; ".join(book.languages),
            "ISBN": " ".join(book.isbns),
            "url": book.source_records[0].source_url if book.source_records else "",
            "libraryCatalog": "ISBN-to-Zotero reconciliation",
            "extra": LocalZotero._extra(book),
        }
        for field, value in values.items():
            if field in item and value:
                item[field] = value
        creators = []
        for creator_type, people in (
            ("author", book.authors),
            ("editor", book.editors),
            ("translator", book.translators),
        ):
            creators.extend({"creatorType": creator_type, "name": person} for person in people if person)
        item["creators"] = creators
        if "tags" in item:
            item["tags"] = [{"tag": subject} for subject in book.subjects if subject]
        item["collections"] = []
        item["relations"] = {}
        return item

    @staticmethod
    def _extra(book: ReconciledBook) -> str:
        lines = [f"ISBN-to-Zotero assessment: {book.confidence}. {book.reason}"]
        if book.printing:
            lines.append(f"Printing statement: {book.printing}")
        if book.extent:
            lines.append(f"Reported physical description: {book.extent}")
        if book.conflicts:
            lines.append("Source conflicts:")
            for field, values in book.conflicts.items():
                lines.append(f"- {field}: {' | '.join(values)}")
        if book.source_records:
            lines.append("Source records:")
            for record in book.source_records:
                lines.append(f"- {record.source}: {record.source_url}")
        return "\n".join(lines)

    def _request(
        self,
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        body: object | None = None,
        timeout: float | None = None,
    ) -> tuple[int, Any, Any]:
        request_headers = {"Accept": "application/json", **(headers or {})}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=request_headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout or self.timeout) as response:
                raw = response.read()
                payload = json.loads(raw.decode("utf-8")) if raw else {}
                return response.status, response.headers, payload
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", "replace")
            try:
                payload = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                payload = {}
            denied = isinstance(payload, dict) and payload.get("denied")
            if error.code == 401:
                message, code = "Zotero requires a new write authorization.", "unauthorized"
            elif error.code == 403 and denied:
                message, code = "The Zotero write request was denied.", "authorization_denied"
            elif error.code == 403:
                message, code = (
                    "Enable ‘Allow other applications on this computer to communicate with Zotero’ in Zotero Settings > Advanced.",
                    "local_api_disabled",
                )
            elif error.code == 412:
                message, code = "The Zotero database changed. Try the direct import again.", "server_changed"
            elif error.code == 428:
                message, code = "Zotero rejected a missing write precondition.", "precondition_required"
            elif error.code == 429:
                message, code = "Zotero is limiting repeated authorization prompts. Wait a minute and try again.", "authorization_rate_limited"
            else:
                message, code = f"Zotero returned HTTP {error.code}.", "zotero_http_error"
            raise LocalZoteroError(code, message, error.code) from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise LocalZoteroError(
                "zotero_not_running",
                "Zotero is not reachable. Open Zotero, or download the RIS file instead.",
            ) from error
        except json.JSONDecodeError as error:
            raise LocalZoteroError("invalid_response", "Zotero returned an unreadable response.") from error
