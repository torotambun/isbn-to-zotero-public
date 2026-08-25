import json
import re
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from isbn_zotero.models import ReconciledBook, SourceRecord
import isbn_zotero.zotero_local as zotero_module
from isbn_zotero.zotero_local import LocalZotero


class FakeZoteroHandler(BaseHTTPRequestHandler):
    received = None
    search_results = []
    write_token = ""

    def log_message(self, format, *args):
        return

    def _json(self, value, server_headers=True):
        data = json.dumps(value).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        if server_headers:
            self.send_header("Zotero-Server-ID", "test-server")
            self.send_header("Zotero-API-Version", "3")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/":
            return self._json({})
        if self.path.startswith("/api/users/0/items?"):
            return self._json(FakeZoteroHandler.search_results)
        if self.path == "/api/items/new?itemType=book":
            return self._json(
                {
                    "itemType": "book", "title": "", "creators": [], "abstractNote": "",
                    "edition": "", "place": "", "publisher": "", "date": "", "numPages": "",
                    "language": "", "ISBN": "", "url": "", "libraryCatalog": "", "extra": "",
                    "tags": [], "collections": [], "relations": {},
                }
            )
        self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/api/local/authorize":
            self.assert_header("Zotero-Server-ID", "test-server")
            return self._json({"key": "x" * 32, "remember": False})
        if self.path == "/api/users/0/items":
            self.assert_header("Zotero-API-Key", "x" * 32)
            token = self.headers.get("Zotero-Write-Token", "")
            if not re.fullmatch(r"[0-9a-f]{32}", token):
                self.send_error(400)
                raise AssertionError("Zotero-Write-Token must be 32 lowercase hexadecimal characters")
            FakeZoteroHandler.write_token = token
            FakeZoteroHandler.received = payload
            return self._json({"successful": {"0": {"key": "ABCD1234", "version": 1}}, "failed": {}})
        self.send_error(404)

    def assert_header(self, name, value):
        if self.headers.get(name) != value:
            self.send_error(400)
            raise AssertionError(f"Missing {name}")


class LocalZoteroTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_base = zotero_module.BASE_URL
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeZoteroHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        zotero_module.BASE_URL = f"http://127.0.0.1:{cls.server.server_port}/api"

    @classmethod
    def tearDownClass(cls):
        zotero_module.BASE_URL = cls.original_base
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)

    @staticmethod
    def make_book():
        source = SourceRecord(source="Catalogue", source_id="1", source_url="https://example.test/1", title="Buku")
        return ReconciledBook(
            choice_id="one", title_cluster_id="work", title="Buku", authors=["Purwadi"],
            publisher="Hanan Pustaka", date="2006", extent="xi, 432 p.",
            edition="Edisi revisi", printing="Cet. 1",
            languages=["Indonesian"], isbns=["9792704043", "9789792704044"],
            source_records=[source], confidence="review", reason="Confirm the edition.",
        )

    def test_fills_live_template_without_splitting_names(self):
        template = {
            "itemType": "book",
            "title": "",
            "creators": [],
            "abstractNote": "",
            "edition": "",
            "place": "",
            "publisher": "",
            "date": "",
            "numPages": "",
            "language": "",
            "ISBN": "",
            "url": "",
            "libraryCatalog": "",
            "extra": "",
            "tags": [],
            "collections": [],
            "relations": {},
        }
        book = self.make_book()
        item = LocalZotero._fill_template(template, book)
        self.assertEqual(item["title"], "Buku")
        self.assertEqual(item["creators"], [{"creatorType": "author", "name": "Purwadi"}])
        self.assertEqual(item["numPages"], "432")
        self.assertEqual(item["ISBN"], "9792704043 9789792704044")
        self.assertEqual(item["edition"], "Edisi revisi")
        self.assertIn("Printing statement: Cet. 1", item["extra"])

    def test_authorizes_and_writes_to_local_zotero(self):
        result = LocalZotero(timeout=3).add_book(self.make_book())
        self.assertTrue(result["created"])
        self.assertEqual(result["item_key"], "ABCD1234")
        self.assertEqual(FakeZoteroHandler.received[0]["title"], "Buku")
        self.assertRegex(FakeZoteroHandler.write_token, r"^[0-9a-f]{32}$")

    def test_title_creator_match_blocks_legacy_item_without_isbn(self):
        FakeZoteroHandler.search_results = [
            {
                "data": {
                    "key": "LEGACY01",
                    "title": "Buku",
                    "ISBN": "",
                    "date": "2006",
                    "creators": [{"creatorType": "author", "name": "Purwadi"}],
                }
            }
        ]
        try:
            result = LocalZotero(timeout=3).add_book(self.make_book())
        finally:
            FakeZoteroHandler.search_results = []
        self.assertTrue(result["duplicate"])
        self.assertEqual(result["item_key"], "LEGACY01")


if __name__ == "__main__":
    unittest.main()
