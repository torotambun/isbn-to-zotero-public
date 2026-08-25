import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path

from isbn_zotero.cache import ResolutionCache
from isbn_zotero.resolver import Resolver
from isbn_zotero.isbn import parse_isbn
from isbn_zotero.models import ReconciledBook, Resolution, SourceRecord
from isbn_zotero.webapp import AppState, ApplicationServer
from isbn_zotero.zotero_local import LocalZotero


class WebAppTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        state = AppState(
            Resolver(timeout=1),
            ResolutionCache(Path(cls.temp.name) / "cache.json"),
            LocalZotero(timeout=1),
        )
        cls.server = ApplicationServer(("127.0.0.1", 0), state)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)
        cls.temp.cleanup()

    def test_health_and_front_page(self):
        with urllib.request.urlopen(self.base + "/api/health", timeout=3) as response:
            self.assertEqual(json.load(response), {"ok": True})
        with urllib.request.urlopen(self.base + "/", timeout=3) as response:
            html = response.read().decode("utf-8")
        self.assertIn("ISBN to Zotero", html)

    def test_invalid_isbn_response(self):
        request = urllib.request.Request(
            self.base + "/api/resolve",
            data=json.dumps({"isbns": ["9786028174887"]}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=3) as response:
            payload = json.load(response)
        result = payload["results"][0]
        self.assertFalse(result["valid"])
        self.assertEqual(result["state"], "invalid")

    def test_review_export_requires_server_confirmation(self):
        isbn = parse_isbn("9786028174886")
        source = SourceRecord(source="Test", source_id="1", source_url="https://example.test/1", title="Buku")
        choice = ReconciledBook(
            choice_id="review-one",
            title_cluster_id="work",
            title="Buku",
            isbns=[isbn.isbn13],
            source_records=[source],
            confidence="review",
            reason="Physical verification required.",
            requires_physical_confirmation=True,
        )

        class FixedResolver:
            def resolve_one(self, raw_input):
                return Resolution(
                    raw_input=raw_input,
                    valid=True,
                    isbn10=isbn.isbn10,
                    isbn13=isbn.isbn13,
                    canonical=isbn.canonical,
                    choices=[choice],
                    state="review",
                )

            @staticmethod
            def find_choice(resolution, choice_id):
                return next((item for item in resolution.choices if item.choice_id == choice_id), None)

        with tempfile.TemporaryDirectory() as directory:
            state = AppState(
                FixedResolver(),
                ResolutionCache(Path(directory) / "cache.json"),
                LocalZotero(timeout=1),
            )
            server = ApplicationServer(("127.0.0.1", 0), state)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = f"http://127.0.0.1:{server.server_port}/api/export"
            body = {"isbn": isbn.canonical, "choice_id": choice.choice_id, "overrides": {}}
            try:
                request = urllib.request.Request(
                    url,
                    data=json.dumps(body).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with self.assertRaises(urllib.error.HTTPError) as raised:
                    urllib.request.urlopen(request, timeout=3)
                try:
                    self.assertEqual(raised.exception.code, 400)
                    payload = json.loads(raised.exception.read().decode("utf-8"))
                    self.assertEqual(payload["code"], "physical_confirmation_required")
                finally:
                    raised.exception.close()

                body["physical_confirmed"] = True
                confirmed = urllib.request.Request(
                    url,
                    data=json.dumps(body).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(confirmed, timeout=3) as response:
                    self.assertIn("TY  - BOOK", response.read().decode("utf-8"))

                zotero_request = urllib.request.Request(
                    url.replace("/api/export", "/api/zotero"),
                    data=json.dumps({key: value for key, value in body.items() if key != "physical_confirmed"}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with self.assertRaises(urllib.error.HTTPError) as zotero_raised:
                    urllib.request.urlopen(zotero_request, timeout=3)
                try:
                    self.assertEqual(zotero_raised.exception.code, 400)
                    payload = json.loads(zotero_raised.exception.read().decode("utf-8"))
                    self.assertEqual(payload["code"], "physical_confirmation_required")
                finally:
                    zotero_raised.exception.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
