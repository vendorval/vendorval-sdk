"""Minimal Flask webhook handler for monitor deliveries.

Run with `python main.py` after `pip install flask`. Flask is not a dependency
of the SDK; any framework that exposes the raw body and the headers works.

Each monitor has its own signing secret, returned once by
``client.monitors.create()`` (or ``client.monitors.rotate_secret()``). This
example reads them from the environment::

    VENDORVAL_WEBHOOK_SECRETS='{"<monitor id>": "<webhook_secret>"}'

A real handler would look them up in its own datastore.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

from vendorval_sdk import WEBHOOK_DELIVERY_ID_HEADER, VendorvalError, construct_event


def _load_secrets() -> dict[str, str]:
    try:
        secrets = json.loads(os.environ.get("VENDORVAL_WEBHOOK_SECRETS", "{}"))
    except json.JSONDecodeError:
        secrets = None
    if not isinstance(secrets, dict) or not secrets:
        print(
            "Set VENDORVAL_WEBHOOK_SECRETS to a JSON object of monitor id -> secret.",
            file=sys.stderr,
        )
        sys.exit(1)
    return {str(k): str(v) for k, v in secrets.items()}


def _secret_for(secrets: dict[str, str], body: bytes) -> str | None:
    # The monitor id is read before the signature is checked, only to choose
    # which secret to verify with. Nothing else in the body is used until
    # construct_event() has verified it.
    try:
        payload: Any = json.loads(body)
        monitor_id = payload["data"]["monitor_id"]
    except (ValueError, KeyError, TypeError):
        return None
    return secrets.get(monitor_id) if isinstance(monitor_id, str) else None


def main() -> None:
    try:
        from flask import Flask, request
    except ImportError:
        print("Install flask first: pip install flask", file=sys.stderr)
        sys.exit(1)

    secrets = _load_secrets()
    # Deliveries are at-least-once and retries reuse the delivery id. Keep this
    # in durable storage in production.
    seen: set[str] = set()
    app = Flask(__name__)

    @app.post("/webhook")
    def hook() -> tuple[str, int]:
        # Verify the exact bytes received; re-serializing parsed JSON would
        # change them and the signature would not match.
        body = request.get_data()
        secret = _secret_for(secrets, body)
        if secret is None:
            return "unknown monitor", 400
        try:
            event = construct_event(body, request.headers, secret)
        except VendorvalError as err:
            print("invalid webhook:", err.code)
            return "invalid", 400

        delivery_id = request.headers.get(WEBHOOK_DELIVERY_ID_HEADER)
        if delivery_id is not None:
            if delivery_id in seen:
                return "duplicate", 200
            seen.add(delivery_id)

        if event["event"] == "monitoring.changes_detected":
            for change in event["data"]["changes"]:
                print(
                    f"monitor {event['data']['monitor_id']}: {change['event_type']}",
                    change["field_path"] or "",
                    change["previous_value"],
                    "->",
                    change["new_value"],
                )
        else:
            print("received event", event["event"])
        return "ok", 200

    app.run(port=8787)


if __name__ == "__main__":
    main()
