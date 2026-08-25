import os
import unittest

from isbn_zotero.resolver import Resolver


@unittest.skipUnless(os.getenv("RUN_LIVE_TESTS") == "1", "set RUN_LIVE_TESTS=1 for network tests")
class LiveTests(unittest.TestCase):
    def test_initial_isbns(self):
        resolver = Resolver(timeout=30)
        results = resolver.resolve_many(
            ["9789793930152", "9786029402063", "9786028174886", "9792704043"],
            workers=2,
        )
        expected_words = ["intel", "350", "prabowo", "sultan"]
        for result, expected in zip(results, expected_words):
            self.assertTrue(result.valid)
            self.assertTrue(result.choices)
            self.assertTrue(any(expected in choice.title.casefold() for choice in result.choices))


if __name__ == "__main__":
    unittest.main()
