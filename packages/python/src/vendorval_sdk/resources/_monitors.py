"""Monitors resource (sync + async).

A monitor re-runs a set of checks on an entity at a fixed frequency and POSTs
each detected change to its ``webhook_url``, signed with that monitor's
secret. Verify deliveries with :func:`vendorval_sdk.construct_event`.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from .._models import Response
from .._pagination import AsyncPage, Page, envelope_fields
from .._request import ResolvedConfig, execute_async, execute_sync, prepare


def _create_body(
    *, entity_id: str, checks: list[str], frequency: str, webhook_url: str
) -> dict[str, Any]:
    return {
        "entity_id": entity_id,
        "checks": list(checks),
        "frequency": frequency,
        "webhook_url": webhook_url,
    }


def _monitor_path(monitor_id: str, suffix: str = "") -> str:
    return f"/v1/monitors/{quote(monitor_id, safe='')}{suffix}"


class MonitorsResource:
    def __init__(self, cfg: ResolvedConfig, client: httpx.Client) -> None:
        self._cfg = cfg
        self._client = client

    def create(
        self, *, entity_id: str, checks: list[str], frequency: str, webhook_url: str
    ) -> Response:
        """Create a monitor.

        ``frequency`` is ``"daily"``, ``"weekly"`` or ``"monthly"``.
        ``webhook_url`` receives this monitor's ``monitoring.changes_detected``
        deliveries.

        The response carries ``webhook_secret``, which is returned only here.
        Store it: it is the key for verifying this monitor's deliveries. Use
        :meth:`rotate_secret` if it is lost.

        No idempotency key is sent: the API does not deduplicate monitor
        creation, so a retry after a lost response can create a second monitor.
        """
        body = _create_body(
            entity_id=entity_id, checks=checks, frequency=frequency, webhook_url=webhook_url
        )
        prepared = prepare(self._cfg, method="POST", path="/v1/monitors", body=body)
        res = execute_sync(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    def retrieve(self, monitor_id: str) -> Response:
        prepared = prepare(self._cfg, method="GET", path=_monitor_path(monitor_id))
        res = execute_sync(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    def list(self, *, limit: int | None = None, offset: int | None = None) -> Page[Response]:
        """List the organization's monitors. Iterating the page follows every page."""

        def fetch(page_offset: int) -> Page[Response]:
            prepared = prepare(
                self._cfg,
                method="GET",
                path="/v1/monitors",
                query={"limit": limit, "offset": page_offset},
            )
            res = execute_sync(self._client, prepared)
            items, meta = envelope_fields(res.data)
            return Page(
                [Response(it, res.request_id, res.status) for it in items],
                fetch_page=fetch,
                **meta,
            )

        return fetch(offset or 0)

    def delete(self, monitor_id: str) -> None:
        """Cancel a monitor. It stops running and stops sending deliveries."""
        prepared = prepare(self._cfg, method="DELETE", path=_monitor_path(monitor_id))
        execute_sync(self._client, prepared)

    def rotate_secret(self, monitor_id: str) -> Response:
        """Issue a new webhook signing secret.

        The new ``webhook_secret`` is returned once; the previous one stops
        being used for future deliveries.
        """
        prepared = prepare(
            self._cfg, method="POST", path=_monitor_path(monitor_id, "/rotate-secret")
        )
        res = execute_sync(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    def events(
        self, monitor_id: str, *, limit: int | None = None, offset: int | None = None
    ) -> Page[Response]:
        """Changes a monitor has detected. Iterating the page follows every page."""
        path = _monitor_path(monitor_id, "/events")

        def fetch(page_offset: int) -> Page[Response]:
            prepared = prepare(
                self._cfg, method="GET", path=path, query={"limit": limit, "offset": page_offset}
            )
            res = execute_sync(self._client, prepared)
            items, meta = envelope_fields(res.data)
            return Page(
                [Response(it, res.request_id, res.status) for it in items],
                fetch_page=fetch,
                **meta,
            )

        return fetch(offset or 0)


class AsyncMonitorsResource:
    def __init__(self, cfg: ResolvedConfig, client: httpx.AsyncClient) -> None:
        self._cfg = cfg
        self._client = client

    async def create(
        self, *, entity_id: str, checks: list[str], frequency: str, webhook_url: str
    ) -> Response:
        body = _create_body(
            entity_id=entity_id, checks=checks, frequency=frequency, webhook_url=webhook_url
        )
        prepared = prepare(self._cfg, method="POST", path="/v1/monitors", body=body)
        res = await execute_async(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    async def retrieve(self, monitor_id: str) -> Response:
        prepared = prepare(self._cfg, method="GET", path=_monitor_path(monitor_id))
        res = await execute_async(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    async def list(
        self, *, limit: int | None = None, offset: int | None = None
    ) -> AsyncPage[Response]:
        async def fetch(page_offset: int) -> AsyncPage[Response]:
            prepared = prepare(
                self._cfg,
                method="GET",
                path="/v1/monitors",
                query={"limit": limit, "offset": page_offset},
            )
            res = await execute_async(self._client, prepared)
            items, meta = envelope_fields(res.data)
            return AsyncPage(
                [Response(it, res.request_id, res.status) for it in items],
                fetch_page=fetch,
                **meta,
            )

        return await fetch(offset or 0)

    async def delete(self, monitor_id: str) -> None:
        prepared = prepare(self._cfg, method="DELETE", path=_monitor_path(monitor_id))
        await execute_async(self._client, prepared)

    async def rotate_secret(self, monitor_id: str) -> Response:
        prepared = prepare(
            self._cfg, method="POST", path=_monitor_path(monitor_id, "/rotate-secret")
        )
        res = await execute_async(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    async def events(
        self, monitor_id: str, *, limit: int | None = None, offset: int | None = None
    ) -> AsyncPage[Response]:
        path = _monitor_path(monitor_id, "/events")

        async def fetch(page_offset: int) -> AsyncPage[Response]:
            prepared = prepare(
                self._cfg, method="GET", path=path, query={"limit": limit, "offset": page_offset}
            )
            res = await execute_async(self._client, prepared)
            items, meta = envelope_fields(res.data)
            return AsyncPage(
                [Response(it, res.request_id, res.status) for it in items],
                fetch_page=fetch,
                **meta,
            )

        return await fetch(offset or 0)
