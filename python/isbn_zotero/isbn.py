from __future__ import annotations

from dataclasses import dataclass


class ISBNValidationError(ValueError):
    def __init__(self, value: str, message: str, suggestion: str | None = None):
        super().__init__(message)
        self.value = value
        self.message = message
        self.suggestion = suggestion


@dataclass(frozen=True, slots=True)
class ISBNInfo:
    raw: str
    normalized: str
    isbn10: str | None
    isbn13: str | None

    @property
    def canonical(self) -> str:
        return self.isbn13 or self.normalized

    @property
    def search_forms(self) -> tuple[str, ...]:
        values = [self.isbn13, self.isbn10]
        return tuple(value for index, value in enumerate(values) if value and value not in values[:index])


def clean_isbn(value: str) -> str:
    return "".join(char for char in str(value).upper() if char.isdigit() or char == "X")


def isbn10_check_digit(first_nine: str) -> str:
    if len(first_nine) != 9 or not first_nine.isdigit():
        raise ValueError("ISBN-10 body must contain nine digits")
    total = sum((10 - index) * int(char) for index, char in enumerate(first_nine))
    value = (11 - (total % 11)) % 11
    return "X" if value == 10 else str(value)


def isbn13_check_digit(first_twelve: str) -> str:
    if len(first_twelve) != 12 or not first_twelve.isdigit():
        raise ValueError("ISBN-13 body must contain twelve digits")
    total = sum((1 if index % 2 == 0 else 3) * int(char) for index, char in enumerate(first_twelve))
    return str((10 - (total % 10)) % 10)


def is_valid_isbn10(value: str) -> bool:
    value = clean_isbn(value)
    return len(value) == 10 and value[:9].isdigit() and value[-1] == isbn10_check_digit(value[:9])


def is_valid_isbn13(value: str) -> bool:
    value = clean_isbn(value)
    return (
        len(value) == 13
        and value.isdigit()
        and value.startswith(("978", "979"))
        and value[-1] == isbn13_check_digit(value[:12])
    )


def isbn10_to_isbn13(value: str) -> str:
    value = clean_isbn(value)
    if not is_valid_isbn10(value):
        raise ISBNValidationError(value, "Invalid ISBN-10")
    body = "978" + value[:9]
    return body + isbn13_check_digit(body)


def isbn13_to_isbn10(value: str) -> str | None:
    value = clean_isbn(value)
    if not is_valid_isbn13(value):
        raise ISBNValidationError(value, "Invalid ISBN-13")
    if not value.startswith("978"):
        return None
    body = value[3:12]
    return body + isbn10_check_digit(body)


def parse_isbn(value: str) -> ISBNInfo:
    normalized = clean_isbn(value)
    if len(normalized) == 10:
        if is_valid_isbn10(normalized):
            return ISBNInfo(str(value), normalized, normalized, isbn10_to_isbn13(normalized))
        suggestion = normalized[:9] + isbn10_check_digit(normalized[:9]) if normalized[:9].isdigit() else None
        raise ISBNValidationError(
            str(value),
            "The ISBN-10 check digit is invalid. Rescan the barcode or inspect the printed ISBN.",
            suggestion,
        )
    if len(normalized) == 13:
        if is_valid_isbn13(normalized):
            return ISBNInfo(str(value), normalized, isbn13_to_isbn10(normalized), normalized)
        suggestion = normalized[:12] + isbn13_check_digit(normalized[:12]) if normalized[:12].isdigit() else None
        raise ISBNValidationError(
            str(value),
            "The ISBN-13 check digit or prefix is invalid. Rescan the barcode or inspect the printed ISBN.",
            suggestion,
        )
    raise ISBNValidationError(
        str(value),
        f"Expected 10 or 13 ISBN characters after removing spaces and hyphens; found {len(normalized)}.",
    )


def equivalent_isbn(left: str, right: str) -> bool:
    try:
        a = parse_isbn(left)
        b = parse_isbn(right)
    except ISBNValidationError:
        return False
    return a.canonical == b.canonical


def valid_isbns(values: list[str]) -> list[str]:
    output: list[str] = []
    canonical_seen: set[str] = set()
    for value in values:
        try:
            info = parse_isbn(value)
        except ISBNValidationError:
            continue
        if info.canonical in canonical_seen:
            continue
        canonical_seen.add(info.canonical)
        output.extend(form for form in info.search_forms if form not in output)
    return output
