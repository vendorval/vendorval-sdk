"""Certifications resource (sync + async). Phase N customer-facing
reshape, Workstream B.

Today this surface is read-only — `list` + `retrieve`. POST + DELETE
(manual upload + revoke) land in a follow-up SDK release once those
API routes ship.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from .._models import Response
from .._request import ResolvedConfig, execute_async, execute_sync, prepare


def _build_query(
    *,
    entity_id: str | None,
    tin: str | None,
    uei: str | None,
    duns: str | None,
    lei: str | None,
    vat_id: str | None,
    state_entity_id: str | None,
    npi: str | None,
    issuer: str | None,
    status: str | None,
    scope: str | list[str] | None,
    expiring_within_days: int | None,
    limit: int | None,
    offset: int | None,
) -> dict[str, Any]:
    """Build the GET query payload.

    Identifier params (tin / uei / duns / lei / vat_id / state_entity_id /
    npi) are normalized + hashed + joined server-side via the same path
    `/v1/entities/lookup` uses. Saves callers a 2-step lookup-then-query
    flow. Tenant-scoped at the API; passing multiple identifiers that
    resolve to different entities → 400.

    `scope` is Phase 5 of data #155 — comma-separated multi-select on
    the awarding authority's coarse scope. Pass a single value
    (e.g. `'federal'`) or a list — the SDK joins lists with `,` for
    the api's wire format.
    """
    return {
        "entity_id": entity_id,
        "tin": tin,
        "uei": uei,
        "duns": duns,
        "lei": lei,
        "vat_id": vat_id,
        "state_entity_id": state_entity_id,
        "npi": npi,
        "issuer": issuer,
        "status": status,
        "scope": ",".join(scope) if isinstance(scope, list) else scope,
        "expiring_within_days": expiring_within_days,
        "limit": limit,
        "offset": offset,
    }


class CertificationsResource:
    def __init__(self, cfg: ResolvedConfig, client: httpx.Client) -> None:
        self._cfg = cfg
        self._client = client

    def list(
        self,
        *,
        entity_id: str | None = None,
        tin: str | None = None,
        uei: str | None = None,
        duns: str | None = None,
        lei: str | None = None,
        vat_id: str | None = None,
        state_entity_id: str | None = None,
        npi: str | None = None,
        issuer: str | None = None,
        status: str | None = None,
        scope: str | list[str] | None = None,
        expiring_within_days: int | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> Response:
        """List certifications for the calling org.

        Returns the full list envelope verbatim so callers see pagination
        metadata (`total`, `has_more`, `limit`, `offset`) without
        re-querying for the count. Access rows via `response["data"]`,
        or call `response.to_dict()` to work with the full payload as a
        plain dictionary.

        Identifier params (`tin`, `uei`, `duns`, `lei`, `vat_id`,
        `state_entity_id`, `npi`) scope to the entity that matches the
        identifier — server normalizes + hashes + joins the same way
        `/v1/entities/lookup` does. Saves a 2-step lookup-then-query flow.
        """
        prepared = prepare(
            self._cfg,
            method="GET",
            path="/v1/certifications",
            query=_build_query(
                entity_id=entity_id,
                tin=tin,
                uei=uei,
                duns=duns,
                lei=lei,
                vat_id=vat_id,
                state_entity_id=state_entity_id,
                npi=npi,
                issuer=issuer,
                status=status,
                scope=scope,
                expiring_within_days=expiring_within_days,
                limit=limit,
                offset=offset,
            ),
        )
        res = execute_sync(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    def retrieve(self, certification_id: str) -> Response:
        """Fetch a single certification by its public id (`cert_…`)."""
        prepared = prepare(
            self._cfg,
            method="GET",
            path=f"/v1/certifications/{quote(certification_id, safe='')}",
        )
        res = execute_sync(self._client, prepared)
        return Response(res.data, res.request_id, res.status)


class AsyncCertificationsResource:
    def __init__(self, cfg: ResolvedConfig, client: httpx.AsyncClient) -> None:
        self._cfg = cfg
        self._client = client

    async def list(
        self,
        *,
        entity_id: str | None = None,
        tin: str | None = None,
        uei: str | None = None,
        duns: str | None = None,
        lei: str | None = None,
        vat_id: str | None = None,
        state_entity_id: str | None = None,
        npi: str | None = None,
        issuer: str | None = None,
        status: str | None = None,
        scope: str | list[str] | None = None,
        expiring_within_days: int | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> Response:
        prepared = prepare(
            self._cfg,
            method="GET",
            path="/v1/certifications",
            query=_build_query(
                entity_id=entity_id,
                tin=tin,
                uei=uei,
                duns=duns,
                lei=lei,
                vat_id=vat_id,
                state_entity_id=state_entity_id,
                npi=npi,
                issuer=issuer,
                status=status,
                scope=scope,
                expiring_within_days=expiring_within_days,
                limit=limit,
                offset=offset,
            ),
        )
        res = await execute_async(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    async def retrieve(self, certification_id: str) -> Response:
        prepared = prepare(
            self._cfg,
            method="GET",
            path=f"/v1/certifications/{quote(certification_id, safe='')}",
        )
        res = await execute_async(self._client, prepared)
        return Response(res.data, res.request_id, res.status)
