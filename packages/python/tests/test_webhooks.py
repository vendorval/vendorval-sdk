"""Webhook verification against deliveries shaped exactly like the API's."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

import httpx
import pytest

from vendorval_sdk import VendorvalError, construct_event

SECRET = "whsec_per_monitor_secret"

EVENT: dict[str, Any] = {
    "event": "monitoring.changes_detected",
    "created_at": "2026-10-09T12:00:00.000Z",
    "data": {
        "monitor_id": "mon_01J9ZK",
        "entity_id": "ent_sam_lyhwaqba7q15",
        "changes": [
            {
                "event_type": "status_changed",
                "field_path": "sam_registration.status",
                "previous_value": "pass",
                "new_value": "fail",
                "detected_at": "2026-10-09T11:59:58.000Z",
            }
        ],
        "verification_id": "ver_01J9ZK",
    },
}


def deliver(
    body: str, *, secret: str = SECRET, timestamp: int | None = None
) -> tuple[str, dict[str, str]]:
    ts = str(int(time.time()) if timestamp is None else timestamp)
    digest = hmac.new(secret.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
    return body, {
        "Content-Type": "application/json",
        "X-ETP-Signature": f"sha256={digest}",
        "X-ETP-Timestamp": ts,
        "X-ETP-Delivery-Id": "dlv_evt_0001",
        "X-ETP-Event": "monitoring.changes_detected",
    }


def code_of(fn: Any) -> str | None:
    with pytest.raises(VendorvalError) as info:
        fn()
    return info.value.code


def test_verifies_a_real_delivery() -> None:
    body, headers = deliver(json.dumps(EVENT))
    event = construct_event(body, headers, SECRET)
    assert event == EVENT
    assert event["event"] == "monitoring.changes_detected"


def test_accepts_bytes_and_any_case_insensitive_mapping() -> None:
    body, headers = deliver(json.dumps(EVENT))
    lower = {k.lower(): v for k, v in headers.items()}
    assert construct_event(body.encode(), lower, SECRET) == EVENT
    assert construct_event(body.encode(), httpx.Headers(headers), SECRET) == EVENT


def test_verifies_raw_bytes_not_reserialized_json() -> None:
    body, headers = deliver(json.dumps(EVENT, indent=2))
    assert construct_event(body, headers, SECRET) == EVENT
    assert code_of(lambda: construct_event(json.dumps(EVENT), headers, SECRET)) == (
        "signature_mismatch"
    )


def test_rejects_other_secret_and_tampered_body() -> None:
    body, headers = deliver(json.dumps(EVENT), secret="another-monitor")
    assert code_of(lambda: construct_event(body, headers, SECRET)) == "signature_mismatch"
    body, headers = deliver(json.dumps(EVENT))
    tampered = body.replace("fail", "pass")
    assert code_of(lambda: construct_event(tampered, headers, SECRET)) == "signature_mismatch"


def test_signature_covers_the_timestamp() -> None:
    body, headers = deliver(json.dumps(EVENT))
    headers["X-ETP-Timestamp"] = str(int(headers["X-ETP-Timestamp"]) + 1)
    assert code_of(lambda: construct_event(body, headers, SECRET)) == "signature_mismatch"


def test_tolerance_window_both_directions() -> None:
    now = 1_800_000_000
    body, old = deliver(json.dumps(EVENT), timestamp=now - 301)
    assert code_of(lambda: construct_event(body, old, SECRET, now=now)) == "timestamp_out_of_range"
    body, future = deliver(json.dumps(EVENT), timestamp=now + 301)
    assert (
        code_of(lambda: construct_event(body, future, SECRET, now=now))
        == "timestamp_out_of_range"
    )
    body, edge = deliver(json.dumps(EVENT), timestamp=now - 300)
    assert construct_event(body, edge, SECRET, now=now) == EVENT
    body, recent = deliver(json.dumps(EVENT), timestamp=now - 30)
    assert (
        code_of(lambda: construct_event(body, recent, SECRET, now=now, tolerance=10))
        == "timestamp_out_of_range"
    )


@pytest.mark.parametrize(
    "options",
    [
        {"tolerance": float("nan")},
        {"tolerance": float("inf")},
        {"tolerance": -1},
        {"now": float("nan")},
    ],
)
def test_rejects_tolerance_or_clock_that_disables_replay_check(options: dict[str, float]) -> None:
    body, headers = deliver(json.dumps(EVENT), timestamp=1)
    with pytest.raises(ValueError):
        construct_event(body, headers, SECRET, **options)  # type: ignore[arg-type]


def test_names_missing_or_malformed_headers() -> None:
    body, headers = deliver(json.dumps(EVENT))
    no_sig = {k: v for k, v in headers.items() if k != "X-ETP-Signature"}
    assert code_of(lambda: construct_event(body, no_sig, SECRET)) == "missing_signature_header"
    no_ts = {k: v for k, v in headers.items() if k != "X-ETP-Timestamp"}
    assert code_of(lambda: construct_event(body, no_ts, SECRET)) == "missing_timestamp_header"
    legacy = {**headers, "X-ETP-Signature": f"t={headers['X-ETP-Timestamp']},v1=abc"}
    assert code_of(lambda: construct_event(body, legacy, SECRET)) == "invalid_signature_header"
    bad_ts = {**headers, "X-ETP-Timestamp": "2026-10-09T12:00:00Z"}
    assert code_of(lambda: construct_event(body, bad_ts, SECRET)) == "invalid_timestamp"


def test_requires_secret_and_json() -> None:
    body, headers = deliver(json.dumps(EVENT))
    assert code_of(lambda: construct_event(body, headers, "")) == "missing_secret"
    body, headers = deliver("not json")
    assert code_of(lambda: construct_event(body, headers, SECRET)) == "invalid_payload"


def test_old_signature_string_argument_gets_a_clear_error() -> None:
    body, headers = deliver(json.dumps(EVENT))
    with pytest.raises(TypeError, match="headers"):
        construct_event(body, headers["X-ETP-Signature"], SECRET)  # type: ignore[arg-type]
