from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


CACHE_SCHEMA_VERSION = 2


@dataclass(slots=True)
class CacheItem:
    created: float
    value: dict[str, Any]


class ResolutionCache:
    def __init__(self, path: Path, ttl_seconds: int = 24 * 60 * 60):
        self.path = path
        self.ttl_seconds = ttl_seconds
        self.lock = threading.Lock()
        self.data: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        try:
            loaded = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict) and loaded.get("schema_version") == CACHE_SCHEMA_VERSION:
                entries = loaded.get("entries")
                self.data = entries if isinstance(entries, dict) else {}
                return
        except (OSError, json.JSONDecodeError):
            pass
        self.data = {}
        try:
            self.path.unlink(missing_ok=True)
        except OSError:
            pass

    def get(self, key: str) -> dict[str, Any] | None:
        with self.lock:
            item = self.data.get(key)
            if not isinstance(item, dict):
                return None
            created = float(item.get("created", 0))
            if time.time() - created > self.ttl_seconds:
                return None
            value = item.get("value")
            return value if isinstance(value, dict) else None

    def put(self, key: str, value: dict[str, Any]) -> None:
        with self.lock:
            self.data[key] = {"created": time.time(), "value": value}
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self.path.with_suffix(self.path.suffix + ".tmp")
                payload = {"schema_version": CACHE_SCHEMA_VERSION, "entries": self.data}
                temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
                temporary.replace(self.path)
            except OSError:
                # Resolution still succeeds when a locked-down system prevents a disk cache.
                return
