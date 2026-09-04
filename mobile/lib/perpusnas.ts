function cleanISBN(input: string): string {
  return input.toUpperCase().replace(/[^0-9X]/g, "");
}

export function perpusnasISBNURL(input: string): string {
  const url = new URL("https://isbn.perpusnas.go.id/Account/SearchBuku");
  url.searchParams.set("searchTxt", cleanISBN(input));
  url.searchParams.set("searchCat", "ISBN");
  return url.toString();
}
