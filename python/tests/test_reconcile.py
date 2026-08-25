import unittest

from isbn_zotero.isbn import parse_isbn
from isbn_zotero.models import SourceRecord
from isbn_zotero.reconcile import reconcile


def record(source, source_id, title, author, publisher, date, edition="", printing=""):
    return SourceRecord(
        source=source,
        source_id=source_id,
        source_url=f"https://example.test/{source_id}",
        title=title,
        authors=[author],
        publisher=publisher,
        date=date,
        edition=edition,
        printing=printing,
        isbns=["9792704043", "9789792704044"],
    )


class ReconcileTests(unittest.TestCase):
    def test_reused_identifier_creates_title_choices(self):
        records = [
            record("Open Library", "a", "Sejarah Kanjeng Sultan Hamengku Buwono IX", "Purwadi", "Hanan Pustaka", "2006", printing="Cet. 1"),
            record("Google Books", "b", "Lulus Kuliah Cari Kerja Kuno !!", "Dodi Mawardi", "Hanan Pustaka", "2013"),
        ]
        choices = reconcile(records, parse_isbn("9792704043"))
        self.assertEqual(len({choice.title_cluster_id for choice in choices}), 2)
        self.assertTrue(all(choice.confidence == "ambiguous" for choice in choices))

    def test_printings_are_not_collapsed(self):
        isbn = parse_isbn("9789793930152")
        records = [
            SourceRecord(source="Indonesia OneSearch", source_id="a", source_url="x", title="Intel", authors=["Ken Conboy"], publisher="Pustaka Primatama", date="2007", printing="Cet. 3", isbns=[isbn.isbn13]),
            SourceRecord(source="Indonesia OneSearch", source_id="b", source_url="y", title="Intel", authors=["Ken Conboy"], publisher="Pustaka Primatama", date="2008", printing="Cet. 4", isbns=[isbn.isbn13]),
        ]
        choices = reconcile(records, isbn)
        self.assertEqual(len(choices), 2)
        self.assertEqual({choice.printing for choice in choices}, {"Cet. 3", "Cet. 4"})
        self.assertTrue(all(choice.edition == "" for choice in choices))

    def test_two_records_from_one_catalogue_are_not_independent(self):
        isbn = parse_isbn("9786028174886")
        records = [
            SourceRecord(source="Indonesia OneSearch", source_id="a", source_url="x", title="Prabowo", authors=["Femi"], publisher="Galang Press", date="2012", isbns=[isbn.isbn13]),
            SourceRecord(source="Indonesia OneSearch", source_id="b", source_url="y", title="Prabowo", authors=["Femi"], publisher="Galang Press", date="2012", isbns=[isbn.isbn13]),
        ]
        choices = reconcile(records, isbn)
        self.assertEqual(choices[0].confidence, "review")
        self.assertIn("one catalogue source", choices[0].reason)

    def test_two_distinct_catalogues_can_produce_high_confidence(self):
        isbn = parse_isbn("9786028174886")
        records = [
            SourceRecord(source="Indonesia OneSearch", source_id="a", source_url="x", title="Prabowo", authors=["Femi"], publisher="Galang Press", date="2012", isbns=[isbn.isbn13]),
            SourceRecord(source="Open Library", source_id="b", source_url="y", title="Prabowo", authors=["Femi"], publisher="Galang Press", date="2012", isbns=[isbn.isbn13]),
        ]
        choices = reconcile(records, isbn)
        self.assertEqual(choices[0].confidence, "high")
        self.assertFalse(choices[0].requires_physical_confirmation)


if __name__ == "__main__":
    unittest.main()
