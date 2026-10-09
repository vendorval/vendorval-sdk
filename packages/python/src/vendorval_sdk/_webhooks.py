"""Webhook signature verification.

VendorVal signs every delivery with HMAC-SHA256. The signed string is the
``X-ETP-Timestamp`` value, a ``.``, and the raw request body; the result is
sent hex-encoded as ``X-ETP-Signature: sha256=<hex>``.

The secret is the monitor's ``webhook_secret``, returned once by
``monitors.create()`` and ``monitors.rotate_secret()``.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from collections.abc import Mapping
from typing import Any, cast

from ._errors import VendorvalError
from .types import WebhookEvent

#: ``sha256=<hex>``: HMAC-SHA256 of ``"<timestamp>.<raw body>"`` with the secret.
WEBHOOK_SIGNATURE_HEADER = "x-etp-signature"
#: Unix time in seconds when the delivery was signed. Part of the signed string.
WEBHOOK_TIMESTAMP_HEADER = "x-etp-timestamp"
#: Stable per logical delivery; retries reuse it. Use it to drop duplicates.
WEBHOOK_DELIVERY_ID_HEADER = "x-etp-delivery-id"
#: The event name, e.g. ``monitoring.changes_detected``.
WEBHOOK_EVENT_HEADER = "x-etp-event"

#: Default maximum age (and clock skew) of a delivery, in seconds.
DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300

_SIGNATURE_RE = re.compile(r"^sha256=([0-9a-fA-F]{64})$")
_TIMESTAMP_RE = re.compile(r"^\d{1,12}$")


def construct_event(
    payload: str | bytes,
    headers: Mapping[str, Any],
    secret: str,
    *,
    tolerance: int = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
    now: float | None = None,
) -> WebhookEvent:
    """Verify a VendorVal webhook delivery and return its parsed payload.

    Args:
        payload: The request body exactly as received. Re-serializing parsed
            JSON changes the bytes and the signature will not match.
        headers: The request headers. Any mapping works (Flask/Werkzeug,
            Django ``request.headers``, Starlette, httpx, a plain dict); the
            lookup is case-insensitive.
        secret: The monitor's ``webhook_secret``.
        tolerance: Reject deliveries whose timestamp is further than this many
            seconds from now. Default 300. This stops replayed deliveries.
        now: Current Unix time in seconds. For tests.

    Deliveries are at-least-once: use the ``X-ETP-Delivery-Id`` header to
    ignore repeats.

    Raises:
        VendorvalError: ``type="webhook_error"`` with one of the codes
            ``missing_secret``, ``missing_signature_header``,
            ``missing_timestamp_header``, ``invalid_signature_header``,
            ``invalid_timestamp``, ``timestamp_out_of_range``,
            ``signature_mismatch`` or ``invalid_payload``.
    """
    if isinstance(headers, (str, bytes)):
        raise TypeError(
            "construct_event() takes the request headers mapping, not a signature string. "
            "Pass request.headers; the SDK reads X-ETP-Signature and X-ETP-Timestamp from it."
        )
    if not secret:
        raise _error("A webhook signing secret is required.", "missing_secret")
    signature = _header(headers, WEBHOOK_SIGNATURE_HEADER)
    if not signature:
        raise _error("The X-ETP-Signature header is missing.", "missing_signature_header")
    timestamp = _header(headers, WEBHOOK_TIMESTAMP_HEADER)
    if not timestamp:
        raise _error("The X-ETP-Timestamp header is missing.", "missing_timestamp_header")

    match = _SIGNATURE_RE.match(signature.strip())
    if not match:
        raise _error(
            "The X-ETP-Signature header is not in the form sha256=<hex>.",
            "invalid_signature_header",
        )
    ts = timestamp.strip()
    if not _TIMESTAMP_RE.match(ts):
        raise _error(
            "The X-ETP-Timestamp header is not a Unix time in seconds.", "invalid_timestamp"
        )

    current = time.time() if now is None else now
    age = abs(current - int(ts))
    if age > tolerance:
        raise _error(
            f"Webhook timestamp is outside the tolerance window ({age:.0f}s > {tolerance}s).",
            "timestamp_out_of_range",
        )

    raw = payload if isinstance(payload, bytes) else payload.encode("utf-8")
    expected = hmac.new(
        secret.encode("utf-8"), ts.encode("ascii") + b"." + raw, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(match.group(1).lower(), expected):
        raise _error("Webhook signature does not match.", "signature_mismatch")

    try:
        return cast(WebhookEvent, json.loads(raw.decode("utf-8")))
    except (UnicodeDecodeError, json.JSONDecodeError) as err:
        raise _error("Webhook payload is not valid JSON.", "invalid_payload") from err


def _header(headers: Mapping[str, Any], name: str) -> str | None:
    value = headers.get(name)
    if value is None:
        for key, candidate in headers.items():
            if isinstance(key, str) and key.lower() == name:
                value = candidate
                break
    if isinstance(value, (list, tuple)):
        value = value[0] if value else None
    if isinstance(value, bytes):
        value = value.decode("latin-1")
    return value if isinstance(value, str) else None


def _error(message: str, code: str) -> VendorvalError:
    return VendorvalError(message, type="webhook_error", code=code)
