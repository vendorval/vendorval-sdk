"""Resources without complex shapes: providers, usage, jobs."""

from __future__ import annotations

from urllib.parse import quote

import httpx

from .._models import Response
from .._pagination import AsyncPage, Page, envelope_fields
from .._request import ResolvedConfig, execute_async, execute_sync, prepare


class ProvidersResource:
    def __init__(self, cfg: ResolvedConfig, client: httpx.Client) -> None:
        self._cfg = cfg
        self._client = client

    def list(self) -> Page[Response]:
        prepared = prepare(self._cfg, method="GET", path="/v1/providers")
        res = execute_sync(self._client, prepared)
        items, _ = envelope_fields(res.data)
        return Page([Response(it, res.request_id, res.status) for it in items])


class AsyncProvidersResource:
    def __init__(self, cfg: ResolvedConfig, client: httpx.AsyncClient) -> None:
        self._cfg = cfg
        self._client = client

    async def list(self) -> AsyncPage[Response]:
        prepared = prepare(self._cfg, method="GET", path="/v1/providers")
        res = await execute_async(self._client, prepared)
        items, _ = envelope_fields(res.data)
        return AsyncPage([Response(it, res.request_id, res.status) for it in items])


class UsageResource:
    def __init__(self, cfg: ResolvedConfig, client: httpx.Client) -> None:
        self._cfg = cfg
        self._client = client

    def retrieve(self, org_id: str) -> Response:
        prepared = prepare(self._cfg, method="GET", path=f"/v1/orgs/{quote(org_id, safe='')}/usage")
        res = execute_sync(self._client, prepared)
        return Response(res.data, res.request_id, res.status)


class AsyncUsageResource:
    def __init__(self, cfg: ResolvedConfig, client: httpx.AsyncClient) -> None:
        self._cfg = cfg
        self._client = client

    async def retrieve(self, org_id: str) -> Response:
        prepared = prepare(self._cfg, method="GET", path=f"/v1/orgs/{quote(org_id, safe='')}/usage")
        res = await execute_async(self._client, prepared)
        return Response(res.data, res.request_id, res.status)


class JobsResource:
    def __init__(self, cfg: ResolvedConfig, client: httpx.Client) -> None:
        self._cfg = cfg
        self._client = client

    def retrieve(self, job_id: str) -> Response:
        prepared = prepare(self._cfg, method="GET", path=f"/v1/jobs/{quote(job_id, safe='')}")
        res = execute_sync(self._client, prepared)
        return Response(res.data, res.request_id, res.status)


class AsyncJobsResource:
    def __init__(self, cfg: ResolvedConfig, client: httpx.AsyncClient) -> None:
        self._cfg = cfg
        self._client = client

    async def retrieve(self, job_id: str) -> Response:
        prepared = prepare(self._cfg, method="GET", path=f"/v1/jobs/{quote(job_id, safe='')}")
        res = await execute_async(self._client, prepared)
        return Response(res.data, res.request_id, res.status)
