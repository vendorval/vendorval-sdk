"""Construction and request-shape tests."""

from __future__ import annotations

import httpx
import pytest
import respx

from vendorval_sdk import Vendorval, VendorvalError


def test_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VENDORVAL_API_KEY", raising=False)
    with pytest.raises(VendorvalError):
        Vendorval()


def test_rejects_unknown_prefix() -> None:
    with pytest.raises(VendorvalError, match="prefix"):
        Vendorval(api_key="sk_live_abcdef")


def test_accepts_vv_test_prefix() -> None:
    client = Vendorval(api_key="vv_test_abc")
    assert client.api_key == "vv_test_abc"
    client.close()


def test_can_skip_validation() -> None:
    client = Vendorval(api_key="custom", validate_api_key=False)
    assert client.api_key == "custom"
    client.close()


def test_falls_back_to_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VENDORVAL_API_KEY", "vv_test_envkey")
    monkeypatch.setenv("VENDORVAL_BASE_URL", "https://staging.example/")
    client = Vendorval()
    try:
        assert client.api_key == "vv_test_envkey"
        assert client.base_url == "https://staging.example"
    finally:
        client.close()


@respx.mock
def test_lookup_sends_bearer_and_version_headers() -> None:
    route = respx.post("https://api.example/v1/entities/lookup").mock(
        return_value=httpx.Response(
            200,
            json={"match": "not_found", "entity": None},
            headers={"x-request-id": "req_abc"},
        )
    )
    with Vendorval(api_key="vv_test_x", base_url="https://api.example") as client:
        result = client.entities.lookup(identifiers={"uei": "X"})

    assert route.called
    request = route.calls.last.request
    assert request.headers["authorization"] == "Bearer vv_test_x"
    assert request.headers["x-vendorval-api-version"] == Vendorval.API_VERSION
    assert request.headers["user-agent"].startswith("vendorval-python/")
    assert result.match == "not_found"
    assert result.request_id == "req_abc"


# Opt in to the widened per-result enum is
# SDK-default. Without this header the API would alias the new values
# (`clear` / `exact_match` / `probable_match`) down to the legacy
# 4-value enum.
@respx.mock
def test_auto_attaches_accept_version_header() -> None:
    route = respx.post("https://api.example/v1/entities/lookup").mock(
        return_value=httpx.Response(200, json={"match": "not_found", "entity": None})
    )
    with Vendorval(api_key="vv_test_x", base_url="https://api.example") as client:
        client.entities.lookup(identifiers={"uei": "X"})

    request = route.calls.last.request
    assert request.headers["accept-version"] == Vendorval.API_VERSION
    # YYYY-MM-DD shape — lex-compared on the server, format matters.
    import re

    assert re.match(r"^\d{4}-\d{2}-\d{2}$", request.headers["accept-version"])


# Certifications resource is now wired.
@respx.mock
def test_certifications_list_forwards_filters() -> None:
    route = respx.get("https://api.example/v1/certifications").mock(
        return_value=httpx.Response(
            200,
            json={
                "object": "list",
                "data": [
                    {
                        "object": "certification",
                        "id": "cert_01",
                        "entity_id": "ent_01",
                        "entity_legal_name": "Acme Federal LLC",
                        "issuer": "NY-DMWBD",
                        "cert_number": "NY-MWBE-1001",
                        "status": "active",
                        "issued_at": "2024-01-15",
                        "expires_at": "2027-01-15",
                        "expiring_soon": False,
                        "retrieved_at": "2026-05-11T08:00:00Z",
                        "classifications": [],
                        "source": {
                            "name": "ny_dmwbd",
                            "mapping_version": "ny_dmwbd_v1",
                            "retrieved_at": "2026-05-11T08:00:00Z",
                        },
                    }
                ],
                "total": 1,
                "has_more": False,
                "limit": 50,
                "offset": 0,
            },
        )
    )
    with Vendorval(api_key="vv_test_x", base_url="https://api.example") as client:
        result = client.certifications.list(
            entity_id="ent_01",
            issuer="NY-DMWBD",
            status="active",
            expiring_within_days=30,
            limit=25,
        )

    request = route.calls.last.request
    assert request.url.params["entity_id"] == "ent_01"
    assert request.url.params["issuer"] == "NY-DMWBD"
    assert request.url.params["status"] == "active"
    assert request.url.params["expiring_within_days"] == "30"
    assert request.url.params["limit"] == "25"

    # The list endpoint returns the full envelope verbatim via the
    # Response wrapper. Pagination metadata + the row array live at
    # the top level — index keys directly on the Response.
    assert result["total"] == 1
    assert result["has_more"] is False
    rows = result["data"]
    assert len(rows) == 1
    assert rows[0]["issuer"] == "NY-DMWBD"
    assert rows[0]["entity_legal_name"] == "Acme Federal LLC"


@respx.mock
def test_certifications_retrieve_by_id() -> None:
    route = respx.get("https://api.example/v1/certifications/cert_01").mock(
        return_value=httpx.Response(
            200,
            json={
                "object": "certification",
                "id": "cert_01",
                "entity_id": "ent_01",
                "issuer": "NMSDC",
                "cert_number": "NMSDC-12345",
                "status": "active",
                "issued_at": "2024-08-01",
                "expires_at": "2026-08-01",
                "expiring_soon": True,
                "retrieved_at": "2026-05-11T08:00:00Z",
                "classifications": [],
                "source": {
                    "name": "nmsdc",
                    "mapping_version": "nmsdc_v1",
                    "retrieved_at": "2026-05-11T08:00:00Z",
                },
            },
            headers={"x-request-id": "req_cert"},
        )
    )
    with Vendorval(api_key="vv_test_x", base_url="https://api.example") as client:
        result = client.certifications.retrieve("cert_01")

    assert route.called
    # Retrieve returns a single Certification verbatim — access fields
    # via attribute (__getattr__) or item lookup.
    assert result.id == "cert_01"
    assert result.expiring_soon is True
    assert result["status"] == "active"
    assert result.request_id == "req_cert"


@respx.mock
def test_certifications_retrieve_encodes_id() -> None:
    route = respx.get("https://api.example/v1/certifications/cert%2F01").mock(
        return_value=httpx.Response(
            200,
            json={"object": "certification", "id": "cert/01", "status": "active"},
            headers={"x-request-id": "req_cert_enc"},
        )
    )
    with Vendorval(api_key="vv_test_x", base_url="https://api.example") as client:
        result = client.certifications.retrieve("cert/01")

    assert route.called
    assert result.id == "cert/01"
    assert result.request_id == "req_cert_enc"
