import { describe, expect, test } from "bun:test";

import {
  ISBNValidationError,
  cleanISBN,
  equivalentISBN,
  isbn10ToISBN13,
  isbn13ToISBN10,
  parseISBN,
} from "../src/isbn.ts";

describe("ISBN validation", () => {
  test("normalizes and converts the initial ISBNs", () => {
    expect(parseISBN("978-979-3930-15-2").canonical).toBe("9789793930152");
    expect(isbn10ToISBN13("9792704043")).toBe("9789792704044");
    expect(isbn13ToISBN10("9789792704044")).toBe("9792704043");
    expect(equivalentISBN("9792704043", "9789792704044")).toBeTrue();
    expect(cleanISBN(" ISBN 978 602 8174 88 6 ")).toBe("9786028174886");
  });

  test("rejects a bad check digit without searching a correction", () => {
    expect(() => parseISBN("9786028174887")).toThrow(ISBNValidationError);
    try {
      parseISBN("9786028174887");
    } catch (error) {
      expect(error).toBeInstanceOf(ISBNValidationError);
      expect((error as ISBNValidationError).suggestion).toBe("9786028174886");
    }
  });
});
