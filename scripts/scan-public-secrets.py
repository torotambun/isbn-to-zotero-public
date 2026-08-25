#!/usr/bin/env python3
"""Dependency-free pre-publication scan of Git-tracked text files."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("Google API key", re.compile(r"AIza[0-9A-Za-z_-]{35}")),
    ("GitHub token", re.compile(r"gh[pousr]_[0-9A-Za-z]{30,}")),
    ("Slack token", re.compile(r"xox[baprs]-[0-9A-Za-z-]{10,}")),
    ("AWS access key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("assigned credential", re.compile(r"(?i)(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|password)\s*[:=]\s*['\"][0-9A-Za-z_./+=-]{16,}['\"]")),
    ("private hosting identifier", re.compile(r"appgprj_[0-9A-Za-z]+")),
    ("production Site address", re.compile(r"https?://[^\s)>]+\.chatgpt\.site\b", re.I)),
    ("private shared-chat link", re.compile(r"https?://(?:www\.)?chatgpt\.com/share/", re.I)),
    ("personal social-media link", re.compile(r"https?://(?:www\.)?linkedin\.com/(?:posts|in)/", re.I)),
    ("private repository link", re.compile(r"https?://github\.com/torotambun/", re.I)),
)


def tracked_files() -> list[Path]:
    output = subprocess.check_output(["git", "ls-files", "-z"])
    return [Path(value.decode("utf-8")) for value in output.split(b"\0") if value]


def main() -> int:
    findings: list[str] = []
    for path in tracked_files():
        try:
            data = path.read_bytes()
        except OSError as exc:
            findings.append(f"{path}: unreadable tracked file: {exc}")
            continue
        if b"\0" in data:
            continue
        text = data.decode("utf-8", errors="replace")
        for label, pattern in PATTERNS:
            for match in pattern.finditer(text):
                line_number = text.count("\n", 0, match.start()) + 1
                findings.append(f"{path}:{line_number}: {label}")

    if findings:
        print("Pre-publication scan found prohibited content:")
        print("\n".join(findings))
        return 1
    print(f"Pre-publication content scan passed for {len(tracked_files())} tracked files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
