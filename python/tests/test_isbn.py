import unittest

from isbn_zotero.isbn import ISBNValidationError, equivalent_isbn, parse_isbn


class ISBNTests(unittest.TestCase):
    def test_normalizes_isbn13(self):
        result = parse_isbn("978-602-8174-88-6")
        self.assertEqual(result.isbn13, "9786028174886")
        self.assertEqual(result.isbn10, "6028174882")

    def test_normalizes_isbn10(self):
        result = parse_isbn("979 270 404 3")
        self.assertEqual(result.isbn10, "9792704043")
        self.assertEqual(result.isbn13, "9789792704044")

    def test_equivalence(self):
        self.assertTrue(equivalent_isbn("9792704043", "9789792704044"))

    def test_invalid_check_digit_is_not_silently_fixed(self):
        with self.assertRaises(ISBNValidationError) as context:
            parse_isbn("9786028174887")
        self.assertEqual(context.exception.suggestion, "9786028174886")


if __name__ == "__main__":
    unittest.main()
