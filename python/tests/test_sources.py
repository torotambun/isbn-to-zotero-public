import unittest

from isbn_zotero.isbn import parse_isbn
from isbn_zotero.network import application_user_agent
from isbn_zotero.sources import (
    GoogleBooks,
    IndonesiaOneSearch,
    OpenLibrary,
    _authors_from_by_statement,
    configured_source_classes,
)
from isbn_zotero.manifestation import split_manifestation_statement


class SourceParserTests(unittest.TestCase):
    def test_endnote_parser(self):
        text = """%0 Book\n%A Conboy, Ken\n%E Danny Raharto\n%I Pustaka Primatama\n%D 2007\n%@ 9789793930152\n%T Intel menguak tabir dunia intelijen Indonesia\n%7 Cet. 3\n"""
        fields = IndonesiaOneSearch._parse_endnote(text)
        self.assertEqual(fields["A"], ["Conboy, Ken"])
        self.assertEqual(fields["@"], ["9789793930152"])
        self.assertEqual(fields["7"], ["Cet. 3"])

    def test_indonesian_responsibility_statement(self):
        self.assertEqual(
            _authors_from_by_statement("Femi Adi Soempeno dan Firlana Laksitasari"),
            ["Femi Adi Soempeno", "Firlana Laksitasari"],
        )
        self.assertEqual(_authors_from_by_statement("Dr. Purwadi ; kata pengantar, Agus Purnomo"), [])

    def test_cetakan_is_classified_as_printing_not_edition(self):
        self.assertEqual(split_manifestation_statement("Cet. 3"), ("", "Cet. 3"))
        self.assertEqual(split_manifestation_statement("Edisi revisi"), ("Edisi revisi", ""))

    def test_safe_default_sources_exclude_google_and_onesearch(self):
        self.assertEqual(configured_source_classes({}), (OpenLibrary,))
        self.assertEqual(
            configured_source_classes({"ISBN_ZOTERO_ENABLE_ONESEARCH": "1"}),
            (IndonesiaOneSearch, OpenLibrary),
        )
        self.assertNotIn(GoogleBooks, configured_source_classes({"ISBN_ZOTERO_ENABLE_ONESEARCH": "1"}))

    def test_open_library_contact_is_sanitized_and_sent(self):
        class FakeClient:
            user_agent = ""

            def get_json(self, _url, user_agent=None):
                self.user_agent = user_agent
                return {}

        class FakePacer:
            calls = 0

            def wait(self):
                self.calls += 1

        client = FakeClient()
        pacer = FakePacer()
        source = OpenLibrary(client=client, contact="public@example.org\r\nInjected", pacer=pacer)
        records, status = source.search(parse_isbn("9789793930152"))
        self.assertEqual(records, [])
        self.assertTrue(status.ok)
        self.assertEqual(pacer.calls, 1)
        self.assertEqual(client.user_agent, application_user_agent("public@example.org Injected"))
        self.assertNotIn("\r", client.user_agent)
        self.assertNotIn("\n", client.user_agent)

    def test_conservative_source_limits(self):
        self.assertEqual(IndonesiaOneSearch().max_records, 8)
        self.assertEqual(IndonesiaOneSearch().pacer.minimum_interval_seconds, 1.0)
        self.assertEqual(OpenLibrary(contact="").pacer.minimum_interval_seconds, 1.0)
        self.assertAlmostEqual(OpenLibrary(contact="public@example.org").pacer.minimum_interval_seconds, 1 / 3)


if __name__ == "__main__":
    unittest.main()
