import unittest

from isbn_zotero.models import ReconciledBook, SourceRecord
from isbn_zotero.ris import book_to_ris


class RISTests(unittest.TestCase):
    def test_book_export(self):
        source = SourceRecord(source="Test catalogue", source_id="1", source_url="https://example.test/1", title="Buku")
        book = ReconciledBook(
            choice_id="one",
            title_cluster_id="work",
            title="Buku",
            authors=["Example, Author"],
            publisher="Penerbit",
            place="Jakarta",
            date="2006",
            edition="Edisi revisi",
            printing="Cet. 1",
            num_pages="432",
            languages=["Indonesian"],
            isbns=["9792704043", "9789792704044"],
            source_records=[source],
            confidence="high",
            reason="Test evidence.",
        )
        ris = book_to_ris(book)
        self.assertIn("TY  - BOOK\r\n", ris)
        self.assertIn("TI  - Buku\r\n", ris)
        self.assertIn("SP  - 432\r\n", ris)
        self.assertIn("ET  - Edisi revisi\r\n", ris)
        self.assertIn("N1  - Printing statement: Cet. 1\r\n", ris)
        self.assertNotIn("ET  - Cet. 1", ris)
        self.assertIn("SN  - 9792704043\r\n", ris)
        self.assertTrue(ris.endswith("ER  -\r\n"))


if __name__ == "__main__":
    unittest.main()
