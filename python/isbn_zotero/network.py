from __future__ import annotations

import json
import socket
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass


USER_AGENT = "ISBN-to-Zotero/1.2 (local personal bibliographic resolver)"


def application_user_agent(contact: str = "") -> str:
    cleaned = " ".join(str(contact or "").split())[:200]
    if not cleaned:
        return USER_AGENT
    return f"ISBN-to-Zotero/1.2 (local personal bibliographic resolver; contact: {cleaned})"


class RequestPacer:
    def __init__(self, minimum_interval_seconds: float):
        self.minimum_interval_seconds = max(float(minimum_interval_seconds), 0.0)
        self.lock = threading.Lock()
        self.next_start = 0.0

    def wait(self) -> None:
        with self.lock:
            delay = self.next_start - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            self.next_start = time.monotonic() + self.minimum_interval_seconds


@dataclass(slots=True)
class FetchError(Exception):
    url: str
    message: str
    status: int | None = None
    temporary: bool = False

    def __str__(self) -> str:
        return self.message


class HTTPClient:
    def __init__(self, timeout: float = 18.0):
        self.timeout = timeout

    def get_bytes(self, url: str, accept: str = "*/*", user_agent: str | None = None) -> bytes:
        request = urllib.request.Request(
            url,
            headers={"User-Agent": user_agent or USER_AGENT, "Accept": accept},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            temporary = error.code in {408, 425, 429, 500, 502, 503, 504}
            if error.code == 404:
                message = "No record at this source"
            elif error.code == 429:
                message = "Source rate limit reached"
            else:
                message = f"HTTP {error.code} from source"
            raise FetchError(url, message, error.code, temporary) from error
        except (urllib.error.URLError, TimeoutError, socket.timeout) as error:
            raise FetchError(url, f"Source unavailable: {error}", temporary=True) from error

    def get_text(self, url: str, accept: str = "text/plain,*/*", user_agent: str | None = None) -> str:
        return self.get_bytes(url, accept, user_agent=user_agent).decode("utf-8", "replace")

    def get_json(self, url: str, user_agent: str | None = None) -> dict:
        try:
            return json.loads(self.get_text(url, "application/json", user_agent=user_agent))
        except json.JSONDecodeError as error:
            raise FetchError(url, "Source returned malformed JSON") from error
