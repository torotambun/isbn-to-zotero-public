from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .resolver import Resolver
from .ris import books_to_ris


def _inputs(args: argparse.Namespace) -> list[str]:
    values = list(args.isbn or [])
    if args.file:
        values.extend(Path(args.file).read_text(encoding="utf-8").splitlines())
    return [value.strip() for value in values if value.strip()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Resolve Indonesian and older-book ISBNs into reviewable Zotero RIS.")
    parser.add_argument("isbn", nargs="*", help="One or more ISBN-10 or ISBN-13 values")
    parser.add_argument("--file", help="Text file with one ISBN per line")
    parser.add_argument("--json", action="store_true", help="Print the complete audit result as JSON")
    parser.add_argument("--ris", help="Write automatically safe single-candidate records to this RIS file")
    parser.add_argument("--allow-review", action="store_true", help="Include one-candidate review records in --ris output")
    parser.add_argument("--timeout", type=float, default=18.0, help="Per-source request timeout in seconds")
    args = parser.parse_args(argv)
    values = _inputs(args)
    if not values:
        parser.error("provide at least one ISBN or --file")

    resolver = Resolver(timeout=args.timeout)
    results = resolver.resolve_many(values)
    if args.json:
        json.dump([result.to_dict() for result in results], sys.stdout, ensure_ascii=False, indent=2)
        print()
    else:
        for result in results:
            print(f"{result.raw_input}: {result.state}. {result.state_message}")
            for choice in result.choices:
                print(
                    f"  {choice.choice_id}: {choice.title} | {', '.join(choice.authors)} | "
                    f"{choice.publisher} | {choice.date} | {choice.edition} [{choice.confidence}]"
                )

    if args.ris:
        books = []
        blocked = []
        for result in results:
            if len(result.choices) != 1:
                blocked.append(result.raw_input)
                continue
            choice = result.choices[0]
            if result.state == "ready" or (args.allow_review and result.state == "review"):
                books.append(choice)
            else:
                blocked.append(result.raw_input)
        Path(args.ris).write_bytes(books_to_ris(books).encode("utf-8"))
        print(f"Wrote {len(books)} record(s) to {args.ris}", file=sys.stderr)
        if blocked:
            print("Not exported because selection or review is required: " + ", ".join(blocked), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
