"""Addresses resource — standalone USPS verify + typeahead.

Both endpoints are FREE (no per-call meter), rate-limited per tenant to align
with USPS upstream + DB-load budgets. Use these for one-shot address
typeahead + verification (e.g. inside an onboarding form). For audited
verification records tied to an entity (with monitor eligibility) attach the
address to an entity and use ``verifications.create(checks=["usps_address"])``
instead.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx

from .._models import Response
from .._request import ResolvedConfig, execute_async, execute_sync, prepare


def _build_lookup_body(
    *,
    street_address: str,
    state: str,
    city: str | None,
    zip_code: str | None,
    secondary_address: str | None,
    firm: str | None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"street_address": street_address, "state": state}
    if city is not None:
        body["city"] = city
    if zip_code is not None:
        body["zip_code"] = zip_code
    if secondary_address is not None:
        body["secondary_address"] = secondary_address
    if firm is not None:
        body["firm"] = firm
    return body


def _build_suggest_query(
    *,
    q: str,
    state: str | None,
    limit: int | None,
) -> str:
    params: dict[str, str] = {"q": q}
    if state is not None:
        params["state"] = state
    if limit is not None:
        params["limit"] = str(limit)
    return urlencode(params)


class AddressesResource:
    """Synchronous addresses resource."""

    def __init__(self, cfg: ResolvedConfig, client: httpx.Client) -> None:
        self._cfg = cfg
        self._client = client

    def lookup(
        self,
        *,
        street_address: str,
        state: str,
        city: str | None = None,
        zip_code: str | None = None,
        secondary_address: str | None = None,
        firm: str | None = None,
    ) -> Response:
        """USPS-verify + standardize a single US address.

        See response shape on ``docs.vendorval.com``. Outcomes are surfaced
        on ``response.data['deliverability']``:
            * ``"deliverable"`` — DPV Y/D/S, not vacant
            * ``"undeliverable"`` — DPV N
            * ``"vacant"`` — DPV Y but vacant=Y (red flag)
            * ``"unknown"`` — USPS returned no DPV

        ``not_found`` is HTTP 404 — raises ``NotFoundError``.
        """
        body = _build_lookup_body(
            street_address=street_address,
            state=state,
            city=city,
            zip_code=zip_code,
            secondary_address=secondary_address,
            firm=firm,
        )
        prepared = prepare(self._cfg, method="POST", path="/v1/addresses/lookup", body=body)
        res = execute_sync(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    def suggest(
        self,
        *,
        q: str,
        state: str | None = None,
        limit: int | None = None,
    ) -> Response:
        """Typeahead suggestions from the global ``canonical_addresses`` corpus.

        ``q`` is required, minimum 3 characters. ``state`` is optional —
        pre-filter by USPS 2-letter state code. ``limit`` defaults to 10
        server-side, max 25.

        Results are NOT USPS-verified. Call ``lookup()`` against the user's
        selection to USPS-verify before persisting.
        """
        path = f"/v1/addresses/suggest?{_build_suggest_query(q=q, state=state, limit=limit)}"
        prepared = prepare(self._cfg, method="GET", path=path)
        res = execute_sync(self._client, prepared)
        return Response(res.data, res.request_id, res.status)


class AsyncAddressesResource:
    """Async addresses resource (mirror of :class:`AddressesResource`)."""

    def __init__(self, cfg: ResolvedConfig, client: httpx.AsyncClient) -> None:
        self._cfg = cfg
        self._client = client

    async def lookup(
        self,
        *,
        street_address: str,
        state: str,
        city: str | None = None,
        zip_code: str | None = None,
        secondary_address: str | None = None,
        firm: str | None = None,
    ) -> Response:
        body = _build_lookup_body(
            street_address=street_address,
            state=state,
            city=city,
            zip_code=zip_code,
            secondary_address=secondary_address,
            firm=firm,
        )
        prepared = prepare(self._cfg, method="POST", path="/v1/addresses/lookup", body=body)
        res = await execute_async(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    async def suggest(
        self,
        *,
        q: str,
        state: str | None = None,
        limit: int | None = None,
    ) -> Response:
        path = f"/v1/addresses/suggest?{_build_suggest_query(q=q, state=state, limit=limit)}"
        prepared = prepare(self._cfg, method="GET", path=path)
        res = await execute_async(self._client, prepared)
        return Response(res.data, res.request_id, res.status)
