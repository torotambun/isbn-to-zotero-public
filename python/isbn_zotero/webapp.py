from __future__ import annotations

import json
import mimetypes
import threading
import urllib.parse
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .cache import ResolutionCache
from .isbn import ISBNValidationError, parse_isbn
from .resolver import Resolver
from .ris import book_to_ris, safe_filename
from .serde import resolution_from_dict
from .zotero_local import LocalZotero, LocalZoteroError


PACKAGE_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = PACKAGE_ROOT / "static"


@dataclass(slots=True)
class AppState:
    resolver: Resolver
    cache: ResolutionCache
    zotero: LocalZotero

    def resolve(self, raw_input: str, refresh: bool = False):
        try:
            key = parse_isbn(raw_input).canonical
        except ISBNValidationError:
            return self.resolver.resolve_one(raw_input)
        if not refresh:
            cached = self.cache.get(key)
            if cached:
                return resolution_from_dict(cached)
        resolution = self.resolver.resolve_one(raw_input)
        self.cache.put(key, resolution.to_dict())
        return resolution


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "ISBNtoZotero/1.2"

    @property
    def state(self) -> AppState:
        return self.server.state  # type: ignore[attr-defined]

    def log_message(self, format: str, *args) -> None:
        return

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in {"/", "/index.html"}:
            return self._send_file(STATIC_ROOT / "index.html", "text/html; charset=utf-8")
        if parsed.path == "/app.js":
            return self._send_file(STATIC_ROOT / "app.js", "text/javascript; charset=utf-8")
        if parsed.path == "/style.css":
            return self._send_file(STATIC_ROOT / "style.css", "text/css; charset=utf-8")
        if parsed.path == "/api/health":
            return self._json({"ok": True})
        if parsed.path == "/api/zotero/status":
            return self._json(self.state.zotero.status())
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            body = self._read_json()
        except ValueError as error:
            return self._json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        if parsed.path == "/api/resolve":
            values = body.get("isbns", [])
            if not isinstance(values, list) or not values:
                return self._json({"error": "Provide at least one ISBN."}, HTTPStatus.BAD_REQUEST)
            refresh = bool(body.get("refresh"))
            values = [str(value) for value in values[:50]]
            with ThreadPoolExecutor(max_workers=min(4, len(values))) as executor:
                results = list(executor.map(lambda value: self.state.resolve(value, refresh=refresh).to_dict(), values))
            return self._json({"results": results})
        if parsed.path == "/api/export":
            choice = self._selected_choice(body)
            if not choice:
                return self._json({"error": "The selected edition is no longer available. Search again."}, HTTPStatus.NOT_FOUND)
            if not choice.title:
                return self._json({"error": "A title is required before export."}, HTTPStatus.BAD_REQUEST)
            if choice.requires_physical_confirmation and body.get("physical_confirmed") is not True:
                return self._json(
                    {
                        "error": "Confirm that this candidate matches the physical title and copyright pages.",
                        "code": "physical_confirmation_required",
                    },
                    HTTPStatus.BAD_REQUEST,
                )
            data = book_to_ris(choice).encode("utf-8")
            filename = safe_filename(choice)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/x-research-info-systems; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == "/api/zotero":
            choice = self._selected_choice(body)
            if not choice:
                return self._json({"error": "The selected edition is no longer available. Search again."}, HTTPStatus.NOT_FOUND)
            if not choice.title:
                return self._json({"error": "A title is required before direct import."}, HTTPStatus.BAD_REQUEST)
            if choice.requires_physical_confirmation and body.get("physical_confirmed") is not True:
                return self._json(
                    {
                        "error": "Confirm that this candidate matches the physical title and copyright pages.",
                        "code": "physical_confirmation_required",
                    },
                    HTTPStatus.BAD_REQUEST,
                )
            try:
                result = self.state.zotero.add_book(choice)
            except LocalZoteroError as error:
                return self._json(
                    {"error": error.message, "code": error.code},
                    HTTPStatus.CONFLICT if error.status != 403 else HTTPStatus.FORBIDDEN,
                )
            return self._json(result)
        self.send_error(HTTPStatus.NOT_FOUND)

    def _selected_choice(self, body: dict):
        raw_input = str(body.get("isbn", ""))
        choice_id = str(body.get("choice_id", ""))
        resolution = self.state.resolve(raw_input)
        choice = self.state.resolver.find_choice(resolution, choice_id)
        overrides = body.get("overrides", {})
        if choice and isinstance(overrides, dict):
            self._apply_overrides(choice, overrides)
        return choice

    @staticmethod
    def _apply_overrides(choice, overrides: dict) -> None:
        scalar_fields = {
            "title",
            "subtitle",
            "publisher",
            "place",
            "date",
            "edition",
            "printing",
            "num_pages",
            "extent",
            "abstract",
        }
        list_fields = {"authors", "editors", "translators", "languages", "subjects", "isbns"}
        for field in scalar_fields:
            if field in overrides:
                setattr(choice, field, " ".join(str(overrides[field] or "").split()))
        for field in list_fields:
            if field not in overrides:
                continue
            value = overrides[field]
            if isinstance(value, str):
                values = [item.strip() for item in value.replace("\n", ";").split(";")]
            elif isinstance(value, list):
                values = [str(item).strip() for item in value]
            else:
                values = []
            setattr(choice, field, [item for item in values if item])

    def _read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid request length") from error
        if length <= 0 or length > 1_000_000:
            raise ValueError("Invalid request body")
        try:
            value = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("Request body must be valid JSON") from error
        if not isinstance(value, dict):
            raise ValueError("Request body must be a JSON object")
        return value

    def _json(self, value: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, path: Path, content_type: str | None = None) -> None:
        if not path.is_file() or path.parent != STATIC_ROOT:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class ApplicationServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, state: AppState):
        super().__init__(address, RequestHandler)
        self.state = state


def serve(host: str = "127.0.0.1", port: int = 8765, open_browser: bool = True) -> None:
    cache_path = Path.home() / ".isbn-to-zotero" / "cache.json"
    state = AppState(Resolver(), ResolutionCache(cache_path), LocalZotero())
    server = ApplicationServer((host, port), state)
    url = f"http://{host}:{port}"
    print(f"ISBN-to-Zotero is running at {url}")
    print("Press Ctrl+C to stop it.")
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Run the local ISBN-to-Zotero interface")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    serve(args.host, args.port, open_browser=not args.no_browser)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
