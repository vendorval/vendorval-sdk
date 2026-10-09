"""Verification resource (sync + async) with createAndWait polling."""

from __future__ import annotations

import asyncio
import builtins
import time
from collections.abc import Mapping
from typing import Any
from urllib.parse import quote

import httpx

from .._errors import APITimeoutError
from .._models import Response, VerificationBundleResponse
from .._request import ResolvedConfig, execute_async, execute_sync, prepare
from ..types import VerifyIdentifiers

_TERMINAL = {"completed", "failed"}


def _serialize_identifiers(
    identifiers: VerifyIdentifiers,
) -> Mapping[str, str] | list[dict[str, str]]:
    """Pass identifiers through unchanged in either supported shape.

    The API accepts both the object-keyed form (e.g. ``{"uei": "..."}``) and
    the legacy list of ``{"type": ..., "value": ...}`` pairs, so we just
    shallow-copy whichever the caller gave us. Items are iterated via
    ``.items()`` rather than passed to ``dict(...)`` directly so the
    TypedDict variants in :data:`VerifyIdentifiers` typecheck cleanly.
    """
    if isinstance(identifiers, Mapping):
        return {str(key): str(value) for key, value in identifiers.items()}
    return [{str(key): str(value) for key, value in item.items()} for item in identifiers]


def _build_verify_body(
    *,
    identifiers: VerifyIdentifiers,
    checks: list[str],
    legal_name: str | None,
    entity_type: str | None,
    country: str | None,
    address: Mapping[str, Any] | None,
    mode: str | None,
    verify_via: str | None,
    options: Mapping[str, Any] | None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "identifiers": _serialize_identifiers(identifiers),
        "checks": list(checks),
    }
    if legal_name is not None:
        body["legal_name"] = legal_name
    if entity_type is not None:
        body["entity_type"] = entity_type
    if country is not None:
        body["country"] = country
    if address is not None:
        body["address"] = dict(address)
    if mode is not None:
        body["mode"] = mode
    if verify_via is not None:
        body["verify_via"] = verify_via
    if options is not None:
        body["options"] = dict(options)
    return body


class VerificationsResource:
    def __init__(self, cfg: ResolvedConfig, client: httpx.Client) -> None:
        self._cfg = cfg
        self._client = client

    def create(
        self,
        *,
        identifiers: VerifyIdentifiers,
        checks: list[str],
        legal_name: str | None = None,
        entity_type: str | None = None,
        country: str | None = None,
        address: Mapping[str, Any] | None = None,
        mode: str | None = None,
        verify_via: str | None = None,
        options: Mapping[str, Any] | None = None,
    ) -> VerificationBundleResponse:
        body = _build_verify_body(
            identifiers=identifiers,
            checks=checks,
            legal_name=legal_name,
            entity_type=entity_type,
            country=country,
            address=address,
            mode=mode,
            verify_via=verify_via,
            options=options,
        )
        prepared = prepare(
            self._cfg, method="POST", path="/v1/verify", body=body, auto_idempotency=True,
        )
        res = execute_sync(self._client, prepared)
        return VerificationBundleResponse(res.data, res.request_id, res.status)

    def create_for_entity(
        self,
        *,
        entity_id: str,
        checks: list[str],
        mode: str | None = None,
        options: Mapping[str, Any] | None = None,
    ) -> Response:
        body: dict[str, Any] = {"entity_id": entity_id, "checks": list(checks)}
        if mode is not None:
            body["mode"] = mode
        if options is not None:
            body["options"] = dict(options)
        prepared = prepare(
            self._cfg, method="POST", path="/v1/verifications", body=body, auto_idempotency=True,
        )
        res = execute_sync(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    def retrieve(self, verification_id: str) -> Response:
        prepared = prepare(self._cfg, method="GET", path=f"/v1/verifications/{quote(verification_id, safe='')}")
        res = execute_sync(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    def create_and_wait(
        self,
        *,
        identifiers: VerifyIdentifiers,
        checks: builtins.list[str],
        legal_name: str | None = None,
        entity_type: str | None = None,
        country: str | None = None,
        address: Mapping[str, Any] | None = None,
        mode: str | None = None,
        verify_via: str | None = None,
        options: Mapping[str, Any] | None = None,
        timeout: float = 5 * 60.0,
        poll_interval: float = 1.0,
    ) -> VerificationBundleResponse:
        if timeout <= 0:
            raise ValueError("timeout must be greater than 0")
        if poll_interval <= 0:
            raise ValueError("poll_interval must be greater than 0")
        bundle = self.create(
            identifiers=identifiers,
            checks=checks,
            legal_name=legal_name,
            entity_type=entity_type,
            country=country,
            address=address,
            mode=mode,
            verify_via=verify_via,
            options=options,
        )
        verification = bundle.verification
        if verification.get("status") in _TERMINAL:
            return bundle

        deadline = time.monotonic() + timeout
        delay = poll_interval
        verification_id = verification["id"]
        while time.monotonic() < deadline:
            time.sleep(min(delay, max(0.0, deadline - time.monotonic())))
            refreshed = self.retrieve(verification_id)
            if refreshed.get("status") in _TERMINAL:
                return VerificationBundleResponse(
                    {"object": "verification_bundle", "entity": bundle.entity.to_dict(), "verification": refreshed.to_dict()},
                    refreshed.request_id,
                    refreshed.status,
                )
            delay = min(delay * 2, 30.0)

        raise APITimeoutError(timeout, request_id=bundle.request_id)


class AsyncVerificationsResource:
    def __init__(self, cfg: ResolvedConfig, client: httpx.AsyncClient) -> None:
        self._cfg = cfg
        self._client = client

    async def create(
        self,
        *,
        identifiers: VerifyIdentifiers,
        checks: list[str],
        legal_name: str | None = None,
        entity_type: str | None = None,
        country: str | None = None,
        address: Mapping[str, Any] | None = None,
        mode: str | None = None,
        verify_via: str | None = None,
        options: Mapping[str, Any] | None = None,
    ) -> VerificationBundleResponse:
        body = _build_verify_body(
            identifiers=identifiers,
            checks=checks,
            legal_name=legal_name,
            entity_type=entity_type,
            country=country,
            address=address,
            mode=mode,
            verify_via=verify_via,
            options=options,
        )
        prepared = prepare(
            self._cfg, method="POST", path="/v1/verify", body=body, auto_idempotency=True,
        )
        res = await execute_async(self._client, prepared)
        return VerificationBundleResponse(res.data, res.request_id, res.status)

    async def create_for_entity(
        self,
        *,
        entity_id: str,
        checks: list[str],
        mode: str | None = None,
        options: Mapping[str, Any] | None = None,
    ) -> Response:
        body: dict[str, Any] = {"entity_id": entity_id, "checks": list(checks)}
        if mode is not None:
            body["mode"] = mode
        if options is not None:
            body["options"] = dict(options)
        prepared = prepare(
            self._cfg, method="POST", path="/v1/verifications", body=body, auto_idempotency=True,
        )
        res = await execute_async(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    async def retrieve(self, verification_id: str) -> Response:
        prepared = prepare(self._cfg, method="GET", path=f"/v1/verifications/{quote(verification_id, safe='')}")
        res = await execute_async(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    async def create_and_wait(
        self,
        *,
        identifiers: VerifyIdentifiers,
        checks: builtins.list[str],
        legal_name: str | None = None,
        entity_type: str | None = None,
        country: str | None = None,
        address: Mapping[str, Any] | None = None,
        mode: str | None = None,
        verify_via: str | None = None,
        options: Mapping[str, Any] | None = None,
        timeout: float = 5 * 60.0,
        poll_interval: float = 1.0,
    ) -> VerificationBundleResponse:
        if timeout <= 0:
            raise ValueError("timeout must be greater than 0")
        if poll_interval <= 0:
            raise ValueError("poll_interval must be greater than 0")
        bundle = await self.create(
            identifiers=identifiers,
            checks=checks,
            legal_name=legal_name,
            entity_type=entity_type,
            country=country,
            address=address,
            mode=mode,
            verify_via=verify_via,
            options=options,
        )
        verification = bundle.verification
        if verification.get("status") in _TERMINAL:
            return bundle

        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        delay = poll_interval
        verification_id = verification["id"]
        while loop.time() < deadline:
            await asyncio.sleep(min(delay, max(0.0, deadline - loop.time())))
            refreshed = await self.retrieve(verification_id)
            if refreshed.get("status") in _TERMINAL:
                return VerificationBundleResponse(
                    {"object": "verification_bundle", "entity": bundle.entity.to_dict(), "verification": refreshed.to_dict()},
                    refreshed.request_id,
                    refreshed.status,
                )
            delay = min(delay * 2, 30.0)

        raise APITimeoutError(timeout, request_id=bundle.request_id)
