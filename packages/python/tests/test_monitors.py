"""Monitors: request shape, one-time secret, rotation, pagination, ID encoding."""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from vendorval_sdk import AsyncPage, AsyncVendorval, Page, Vendorval

MONITOR: dict[str, Any] = {
    "object": "monitor",
    "id": "mon_1",
    "entity_id": "ent_1",
    "checks": ["sam_registration"],
    "frequency": "weekly",
    "webhook_url": "https://hooks.example.com/vendorval",
    "webhook_secret_rotated_at": "2026-10-09T12:00:00.000Z",
    "status": "active",
    "last_run_at": None,
    "next_run_at": "2026-10-16T12:00:00.000Z",
    "created_at": "2026-10-09T12:00:00.000Z",
}


def list_page(ids: list[str], offset: int, total: int, limit: int = 2) -> dict[str, Any]:
    return {
        "object": "list",
        "data": [{**MONITOR, "id": i} for i in ids],
        "total": total,
        "has_more": offset + len(ids) < total,
        "limit": limit,
        "offset": offset,
    }


class Recorder:
    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self.responses = responses
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        body = self.responses[min(len(self.requests), len(self.responses)) - 1]
        return httpx.Response(200, json=body, headers={"x-request-id": "req_mon"})


def sync_client(rec: Recorder) -> Vendorval:
    return Vendorval(
        api_key="vv_test_x",
        base_url="https://api.example",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(rec)),
    )


def async_client(rec: Recorder) -> AsyncVendorval:
    return AsyncVendorval(
        api_key="vv_test_x",
        base_url="https://api.example",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(rec)),
    )


def test_create_sends_frequency_and_webhook_url_and_returns_secret() -> None:
    rec = Recorder([{**MONITOR, "webhook_secret": "whsec_once"}])
    with sync_client(rec) as client:
        monitor = client.monitors.create(
            entity_id="ent_1",
            checks=["sam_registration"],
            frequency="weekly",
            webhook_url="https://hooks.example.com/vendorval",
        )
    request = rec.requests[0]
    assert request.method == "POST"
    assert request.url.path == "/v1/monitors"
    assert json.loads(request.content) == {
        "entity_id": "ent_1",
        "checks": ["sam_registration"],
        "frequency": "weekly",
        "webhook_url": "https://hooks.example.com/vendorval",
    }
    assert monitor["webhook_secret"] == "whsec_once"


def test_rotate_secret_and_url_encoded_ids() -> None:
    rec = Recorder([{**MONITOR, "webhook_secret": "whsec_new"}])
    with sync_client(rec) as client:
        rotated = client.monitors.rotate_secret("mon/1")
        client.monitors.retrieve("mon/1")
        client.monitors.delete("mon/1")
        client.jobs.retrieve("job/1")
        client.usage.retrieve("org/1")
    raw_paths = [r.url.raw_path.decode() for r in rec.requests]
    assert raw_paths == [
        "/v1/monitors/mon%2F1/rotate-secret",
        "/v1/monitors/mon%2F1",
        "/v1/monitors/mon%2F1",
        "/v1/jobs/job%2F1",
        "/v1/orgs/org%2F1/usage",
    ]
    assert rec.requests[0].method == "POST"
    assert rec.requests[2].method == "DELETE"
    assert rotated["webhook_secret"] == "whsec_new"


def test_list_follows_has_more_with_offset() -> None:
    rec = Recorder(
        [
            list_page(["mon_1", "mon_2"], 0, 5),
            list_page(["mon_3", "mon_4"], 2, 5),
            list_page(["mon_5"], 4, 5),
        ]
    )
    with sync_client(rec) as client:
        page = client.monitors.list(limit=2)
        assert isinstance(page, Page)
        assert [m["id"] for m in page.data] == ["mon_1", "mon_2"]
        assert page.has_more and page.total == 5
        assert [m["id"] for m in page] == ["mon_1", "mon_2", "mon_3", "mon_4", "mon_5"]

    queries = [parse_qs(urlsplit(str(r.url)).query) for r in rec.requests]
    assert [q["offset"] for q in queries] == [["0"], ["2"], ["4"]]
    assert all(q["limit"] == ["2"] for q in queries)
    assert all("status" not in q for q in queries)


def test_list_stops_on_empty_page_claiming_more() -> None:
    rec = Recorder(
        [
            list_page(["mon_1"], 0, 3, limit=1),
            {"object": "list", "data": [], "total": 3, "has_more": True, "limit": 1, "offset": 1},
        ]
    )
    with sync_client(rec) as client:
        assert [m["id"] for m in client.monitors.list(limit=1).all()] == ["mon_1"]
    assert len(rec.requests) == 2


@pytest.mark.asyncio
async def test_async_list_and_events_follow_pages() -> None:
    rec = Recorder([list_page(["mon_1", "mon_2"], 0, 3), list_page(["mon_3"], 2, 3)])
    async with async_client(rec) as client:
        page = await client.monitors.list(limit=2)
        assert isinstance(page, AsyncPage)
        assert [m["id"] async for m in page] == ["mon_1", "mon_2", "mon_3"]

    event = {"object": "change_event", "id": "evt_1", "event_type": "status_changed"}
    rec = Recorder([{"object": "list", "data": [event], "total": 1, "has_more": False}])
    async with async_client(rec) as client:
        events = await client.monitors.events("mon_1", limit=10)
        assert [e["id"] for e in await events.all()] == ["evt_1"]
    assert rec.requests[0].url.path == "/v1/monitors/mon_1/events"
