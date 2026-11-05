"""Exercise the example's actual cache without Flask or a listening server."""

import runpy
from pathlib import Path

DeliveryCache = runpy.run_path(
    str(Path(__file__).resolve().parents[3] / "examples/python/webhook-handler/delivery_cache.py")
)["DeliveryCache"]


def test_unsigned_id_cannot_suppress_or_poison_another_authenticated_payload() -> None:
    cache = DeliveryCache()
    cache.record("sha256=aaa", "delivery-a", b"payload-a")
    assert not cache.is_duplicate("sha256=bbb", "delivery-a", b"payload-b")
    assert not cache.is_duplicate("sha256=bbb", "delivery-b", b"payload-b")


def test_resigned_retry_and_its_altered_id_replay_are_duplicates() -> None:
    cache = DeliveryCache()
    cache.record("sha256=aaa", "delivery-a", b"payload-a")
    assert cache.is_duplicate("sha256=bbb", "delivery-a", b"payload-a")
    assert cache.is_duplicate("SHA256=BBB", "changed-id", b"payload-a")


def test_signature_replay_does_not_bind_an_unseen_delivery_id() -> None:
    cache = DeliveryCache()
    cache.record("sha256=aaa", "delivery-a", b"payload-a")
    assert cache.is_duplicate("sha256=aaa", "delivery-b", b"payload-a")
    assert not cache.is_duplicate("sha256=bbb", "delivery-b", b"payload-b")


def test_only_completed_handling_is_recorded() -> None:
    cache = DeliveryCache()
    assert not cache.is_duplicate("sha256=aaa", None, b"payload-a")
    assert not cache.is_duplicate("sha256=aaa", None, b"payload-a")
    cache.record("sha256=aaa", None, b"payload-a")
    assert cache.is_duplicate("SHA256=AAA", None, b"payload-a")


def test_missing_id_does_not_match_a_recorded_empty_id() -> None:
    cache = DeliveryCache()
    body = b"payload-a"
    cache.record("sha256=aaa", "", body)
    assert not cache.is_duplicate("sha256=bbb", None, body)
    # A missing-ID attempt must not mark its unhandled signature as processed.
    assert not cache.is_duplicate("sha256=bbb", "delivery-b", body)
    # An explicitly present empty ID still supports a matching authenticated retry.
    assert cache.is_duplicate("sha256=ccc", "", body)
