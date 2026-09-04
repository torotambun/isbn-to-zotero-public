export function worldCatISBNURL(input: string): string {
  const isbn = input.toUpperCase().replace(/[^0-9X]/g, "");
  return `https://www.worldcat.org/isbn/${encodeURIComponent(isbn)}`;
}
