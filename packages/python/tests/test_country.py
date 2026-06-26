"""Country-routing smoke tests — country surface for the Python SDK.

Covers:
  - meta endpoints (list_supported_countries, get_supported_country)
  - country forwarded on request bodies (lookup, verify)
  - vat_id is accepted as an identifier
  - new check types pass through unchanged
  - the five 422 country errors round-trip as `CountryError`
"""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from vendorval_sdk import (
    AsyncVendorval,
    CountryError,
    ValidationError,
    Vendorval,
)

SAMPLE_COUNTRY = {
    "code": "DE",
    "name": "Germany",
    "region": "european_union",
    "tier": "full",
    "available_identifiers": ["vat_id", "lei", "duns", "domain", "phone"],
    "available_checks": ["vat_validation", "lei_validation", "sanctions_screening"],
}

SAMPLE_LIST = {
    "object": "list",
    "total_count": 2,
    "data": [
        {
            "code": "US",
            "name": "United States",
            "region": "north_america",
            "tier": "full",
            "available_identifiers": ["uei", "tin", "duns", "cage", "lei", "domain", "phone"],
            "available_checks": [
                "sam_registration",
                "uei_validation",
                "tin_match",
                "lei_validation",
                "sanctions_screening",
            ],
        },
        SAMPLE_COUNTRY,
    ],
}


def make_client() -> Vendorval:
    return Vendorval(
        api_key="vv_test_phase_j",
        base_url="https://api.example",
        max_retries=0,
    )


# --- meta ----------------------------------------------------------------------


@respx.mock
def test_list_supported_countries_hits_meta_endpoint() -> None:
    route = respx.get("https://api.example/v1/meta/countries").mock(
        return_value=httpx.Response(200, json=SAMPLE_LIST, headers={"x-request-id": "req_meta_1"})
    )
    with make_client() as client:
        res = client.meta.list_supported_countries()

    assert route.called
    assert res.status == 200
    assert res.request_id == "req_meta_1"
    payload = res.to_dict()
    assert payload["total_count"] == 2
    assert [c["code"] for c in payload["data"]] == ["US", "DE"]


@respx.mock
def test_get_supported_country_uppercases_path() -> None:
    route = respx.get("https://api.example/v1/meta/countries/DE").mock(
        return_value=httpx.Response(200, json=SAMPLE_COUNTRY)
    )
    with make_client() as client:
        res = client.meta.get_supported_country("de")  # mixed case

    assert route.called
    payload = res.to_dict()
    assert payload["code"] == "DE"
    assert "vat_validation" in payload["available_checks"]


# --- country forwarded on request bodies --------------------------------------


@respx.mock
def test_lookup_forwards_country_and_vat_id() -> None:
    route = respx.post("https://api.example/v1/entities/lookup").mock(
        return_value=httpx.Response(200, json={"match": "not_found", "entity": None})
    )
    with make_client() as client:
        client.entities.lookup(
            identifiers={"vat_id": "DE123456789"},
            country="DE",
        )

    body = json.loads(route.calls.last.request.content)
    assert body == {
        "identifiers": {"vat_id": "DE123456789"},
        "country": "DE",
    }


@respx.mock
def test_verifications_create_forwards_country_and_new_checks() -> None:
    route = respx.post("https://api.example/v1/verify").mock(
        return_value=httpx.Response(
            200,
            json={
                "object": "verification_bundle",
                "entity": {"id": "ent_x", "legal_name": "Acme GmbH", "country": "DE"},
                "verification": {"id": "ver_x", "status": "completed"},
            },
        )
    )
    with make_client() as client:
        client.verifications.create(
            identifiers=[{"type": "vat_id", "value": "DE123456789"}],
            checks=["vat_validation", "lei_validation", "sanctions_screening"],
            country="DE",
        )

    body = json.loads(route.calls.last.request.content)
    assert body["country"] == "DE"
    assert body["checks"] == ["vat_validation", "lei_validation", "sanctions_screening"]
    assert body["identifiers"] == [{"type": "vat_id", "value": "DE123456789"}]


# --- CountryError mapping ------------------------------------------------------


def _country_422_route(path: str, code: str, details: dict) -> respx.Route:
    return respx.post(f"https://api.example{path}").mock(
        return_value=httpx.Response(
            422,
            json={
                "error": {
                    "type": "invalid_request_error",
                    "code": code,
                    "message": f"mocked {code}",
                    "param": "country",
                    "details": details,
                }
            },
            headers={"x-request-id": "req_country_err"},
        )
    )


@respx.mock
def test_country_required_raises_country_error() -> None:
    _country_422_route(
        "/v1/entities/lookup",
        "country_required",
        {"identifiers_seen": ["domain"], "recommended_action": "supply_country_field"},
    )
    with make_client() as client, pytest.raises(CountryError) as ei:
        client.entities.lookup(identifiers={"domain": "acme.example"})

    err = ei.value
    assert isinstance(err, ValidationError)  # subclass relationship
    assert err.code == "country_required"
    assert err.status == 422
    assert err.details == {"identifiers_seen": ["domain"], "recommended_action": "supply_country_field"}


@respx.mock
def test_country_not_supported_includes_supported_countries() -> None:
    _country_422_route(
        "/v1/entities/lookup",
        "country_not_supported",
        {
            "country_resolved": "JP",
            "supported_countries": ["US", "DE", "FR"],
            "recommended_action": "use_a_supported_country",
        },
    )
    with make_client() as client, pytest.raises(CountryError) as ei:
        client.entities.lookup(identifiers={"domain": "x.test"}, country="JP")

    assert ei.value.code == "country_not_supported"
    assert ei.value.details["country_resolved"] == "JP"
    assert "US" in ei.value.details["supported_countries"]


@respx.mock
def test_identifier_not_supported_for_country() -> None:
    _country_422_route(
        "/v1/entities/lookup",
        "identifier_not_supported_for_country",
        {
            "country_resolved": "DE",
            "recommended_action": "use_vat_id_for_eu_entities",
            "identifiers_seen": ["tin"],
        },
    )
    with make_client() as client, pytest.raises(CountryError) as ei:
        client.entities.lookup(identifiers={"tin": "12-3456789"}, country="DE")

    assert ei.value.code == "identifier_not_supported_for_country"
    assert ei.value.details["recommended_action"] == "use_vat_id_for_eu_entities"


@respx.mock
def test_check_not_supported_for_country_on_verify() -> None:
    _country_422_route(
        "/v1/verify",
        "check_not_supported_for_country",
        {"country_resolved": "DE", "recommended_action": "use_vat_validation_for_eu"},
    )
    with make_client() as client, pytest.raises(CountryError) as ei:
        client.verifications.create(
            identifiers=[{"type": "tin", "value": "12-3456789"}],
            checks=["tin_match"],
            country="DE",
        )

    assert ei.value.code == "check_not_supported_for_country"
    assert ei.value.details["country_resolved"] == "DE"


@respx.mock
def test_country_mismatch_includes_candidates() -> None:
    _country_422_route(
        "/v1/entities/lookup",
        "country_mismatch",
        {
            "candidates": [
                {"country": "DE", "source": "explicit"},
                {"country": "FR", "source": "identifier", "via": "vat_id"},
            ],
            "recommended_action": "remove_explicit_country_or_fix_identifier",
        },
    )
    with make_client() as client, pytest.raises(CountryError) as ei:
        client.entities.lookup(identifiers={"vat_id": "FR12345678901"}, country="DE")

    assert ei.value.code == "country_mismatch"
    assert len(ei.value.details["candidates"]) == 2
    assert ei.value.details["candidates"][0]["country"] == "DE"


@respx.mock
def test_non_country_422_is_validation_error_not_country_error() -> None:
    respx.post("https://api.example/v1/entities/lookup").mock(
        return_value=httpx.Response(
            422,
            json={
                "error": {
                    "type": "invalid_request_error",
                    "code": "invalid_request",
                    "message": "something else",
                }
            },
        )
    )
    with make_client() as client, pytest.raises(ValidationError) as ei:
        client.entities.lookup(identifiers={"uei": "X"})

    assert not isinstance(ei.value, CountryError)
    assert ei.value.status == 422


# --- async parity -------------------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_async_meta_and_country_error_round_trip() -> None:
    respx.get("https://api.example/v1/meta/countries").mock(
        return_value=httpx.Response(200, json=SAMPLE_LIST)
    )
    respx.post("https://api.example/v1/entities/lookup").mock(
        return_value=httpx.Response(
            422,
            json={
                "error": {
                    "type": "invalid_request_error",
                    "code": "country_required",
                    "message": "no country",
                    "details": {"recommended_action": "supply_country_field"},
                }
            },
        )
    )

    async with AsyncVendorval(
        api_key="vv_test_phase_j",
        base_url="https://api.example",
        max_retries=0,
    ) as client:
        listing = await client.meta.list_supported_countries()
        assert listing.to_dict()["total_count"] == 2

        with pytest.raises(CountryError) as ei:
            await client.entities.lookup(identifiers={"domain": "x.test"})
        assert ei.value.code == "country_required"
