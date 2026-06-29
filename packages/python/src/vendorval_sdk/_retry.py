"""Retry policy."""

from __future__ import annotations

import random
from datetime import UTC

import httpx

from ._errors import parse_retry_after

_BASE_DELAY = 0.5
_MAX_DELAY = 30.0


def should_retry_status(status: int) -> bool:
    if status in (408, 429):
        return True
    return 500 <= status <= 599


def compute_backoff(attempt: int) -> float:
    exp = min(_MAX_DELAY, _BASE_DELAY * (2 ** attempt))
    # Full jitter in [exp/2, exp).
    return float(exp / 2 + random.random() * (exp / 2))


def decide_retry(
    *,
    attempt: int,
    status: int,
    headers: httpx.Headers,
) -> float | None:
    """Return delay in seconds if we should retry, else None."""
    if not should_retry_status(status):
        return None
    if status == 429:
        retry_after = parse_retry_after(headers.get("retry-after"))
        if retry_after is not None:
            return min(_MAX_DELAY, retry_after)
        reset = headers.get("x-ratelimit-reset")
        if reset:
            try:
                from datetime import datetime

                ts = datetime.fromisoformat(reset.replace("Z", "+00:00"))
                delta = (ts - datetime.now(UTC)).total_seconds()
                return max(0.0, min(_MAX_DELAY, delta))
            except ValueError:
                pass
    return compute_backoff(attempt)
