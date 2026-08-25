import json
import tempfile
import unittest
from pathlib import Path

from isbn_zotero.cache import CACHE_SCHEMA_VERSION, ResolutionCache


class CachePolicyTests(unittest.TestCase):
    def test_default_ttl_is_one_day(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = ResolutionCache(Path(directory) / "cache.json")
            self.assertEqual(cache.ttl_seconds, 24 * 60 * 60)

    def test_legacy_unscoped_cache_is_discarded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            path.write_text(json.dumps({"9789793930152": {"created": 1, "value": {"records": [{"source": "Google Books"}]}}}))
            cache = ResolutionCache(path)
            self.assertIsNone(cache.get("9789793930152"))
            self.assertFalse(path.exists())

            cache.put("safe", {"records": []})
            stored = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(stored["schema_version"], CACHE_SCHEMA_VERSION)
            self.assertEqual(stored["entries"]["safe"]["value"], {"records": []})


if __name__ == "__main__":
    unittest.main()
