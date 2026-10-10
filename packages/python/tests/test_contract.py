"""Request-shape contract tests against ``specs/openapi.json``.

Every public resource method, sync and async, is called against a recording
transport, and each request it sends is checked against the spec: the
operation must exist, query parameters must be declared, and the JSON body
must validate, including enum values. Fields the API does not declare fail
the test, because the API drops them silently.

The enum section checks that the SDK's ``Literal`` types list exactly the
values the spec declares, so a refreshed spec snapshot fails these tests until
the SDK follows the API.
"""

from __future__ import annotations

import asyncio
import inspect
import json
from collections.abc import Callable
from typing import Any, get_args
from urllib.parse import urlsplit

import httpx
import pytest

from vendorval_sdk import AsyncVendorval, Vendorval, types
from vendorval_sdk.resources import (
    _addresses,
    _bank_accounts,
    _certifications,
    _entities,
    _meta,
    _monitors,
    _simple,
    _verifications,
)

from ._openapi import body_schema_at, check_request, query_schema

# Query parameters the API accepts but its OpenAPI document does not yet
# declare. The monitor list routes parse `limit` and `offset` in the handler
# and return `has_more`, so the SDK paginates with them.
UNDECLARED_QUERY: dict[str, tuple[str, ...]] = {
    "GET /v1/monitors": ("limit", "offset"),
    "GET /v1/monitors/{id}/events": ("limit", "offset"),
}

LIST_PATHS = ("/v1/monitors", "/v1/providers", "/v1/certifications", "/v1/meta/countries")


class Recorder:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, Any]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        self.calls.append((request.method, str(request.url), body))
        path = request.url.path
        if path in LIST_PATHS or path.endswith("/events"):
            payload: dict[str, Any] = {
                "object": "list",
                "data": [],
                "total": 0,
                "has_more": False,
                "limit": 20,
                "offset": 0,
            }
        else:
            payload = {
                "object": "verification_bundle",
                "entity": {},
                "verification": {"id": "ver_1", "status": "completed"},
            }
        return httpx.Response(200, json=payload)


def _problems(rec: Recorder) -> list[str]:
    problems: list[str] = []
    for method, url, body in rec.calls:
        path = urlsplit(url).path
        key = f"{method} {path}"
        if path.startswith("/v1/monitors/") and path.endswith("/events"):
            key = f"{method} /v1/monitors/{{id}}/events"
        problems += check_request(
            method, url, body, undeclared_query=UNDECLARED_QUERY.get(key, ())
        )
    return problems


# One case per public method, using every optional argument the SDK can send.
# Each takes a client (sync) and returns the call's result, or an awaitable
# when given the async client.
CASES: dict[str, Callable[[Any], Any]] = {
    "entities.lookup": lambda c: c.entities.lookup(
        identifiers={
            "uei": "LYHWAQBA7Q15",
            "name": "Acme Federal",
            "state_entity_id": {"value": "123", "issuer": "NY-DOS"},
        },
        mode="fuzzy",
        country="US",
        fields=["legal_name", "identifiers"],
        options={"sam_refresh": "auto"},
    ),
    "entities.create": lambda c: c.entities.create(
        identifiers=[{"type": "uei", "value": "LYHWAQBA7Q15"}],
        legal_name="Acme Federal Services LLC",
        entity_type="sole_proprietor",
        country="US",
        address={"line_1": "1 Main St", "city": "Albany", "state": "NY", "country": "US"},
    ),
    "entities.retrieve": lambda c: c.entities.retrieve("ent_sam/1"),
    "verifications.create": lambda c: c.verifications.create(
        identifiers={"uei": "LYHWAQBA7Q15", "vat_id": "DE123456789"},
        checks=["sam_registration", "small_business_certification", "regulatory_disclosure_check"],
        legal_name="Acme Federal Services LLC",
        entity_type="llc",
        country="US",
        address={"line_1": "1 Main St", "country": "US"},
        mode="realtime",
        verify_via="providers",
        options={
            "sync": False,
            "webhook_url": "https://hooks.example.com/v",
            "create_if_not_found": False,
            "match_threshold": 0.8,
        },
    ),
    "verifications.create_for_entity": lambda c: c.verifications.create_for_entity(
        entity_id="ent_1",
        checks=["tin_match"],
        mode="cached",
        options={"sync": True, "webhook_url": "https://hooks.example.com/v"},
    ),
    "verifications.retrieve": lambda c: c.verifications.retrieve("ver_1"),
    "verifications.create_and_wait": lambda c: c.verifications.create_and_wait(
        identifiers=[{"type": "lei", "value": "5493001KJTIIGC8Y1R12"}],
        checks=[],
        verify_via="fara_only",
    ),
    "certifications.list": lambda c: c.certifications.list(
        entity_id="ent_1",
        tin="123456789",
        uei="LYHWAQBA7Q15",
        duns="123456789",
        lei="5493001KJTIIGC8Y1R12",
        vat_id="DE123456789",
        state_entity_id="NY-DOS:1",
        npi="1234567893",
        issuer="SBA-DSBS",
        status="active",
        scope=["federal", "state"],
        expiring_within_days=30,
        limit=10,
        offset=5,
    ),
    "certifications.retrieve": lambda c: c.certifications.retrieve("cert_1"),
    "monitors.create": lambda c: c.monitors.create(
        entity_id="ent_1",
        checks=["sam_registration", "sanctions_screening"],
        frequency="monthly",
        webhook_url="https://hooks.example.com/vendorval",
    ),
    "monitors.retrieve": lambda c: c.monitors.retrieve("mon_1"),
    "monitors.list": lambda c: c.monitors.list(limit=50, offset=100),
    "monitors.delete": lambda c: c.monitors.delete("mon_1"),
    "monitors.rotate_secret": lambda c: c.monitors.rotate_secret("mon_1"),
    "monitors.events": lambda c: c.monitors.events("mon_1", limit=10, offset=0),
    "providers.list": lambda c: c.providers.list(),
    "meta.list_supported_countries": lambda c: c.meta.list_supported_countries(),
    "meta.get_supported_country": lambda c: c.meta.get_supported_country("gb"),
    "usage.retrieve": lambda c: c.usage.retrieve("org_1"),
    "jobs.retrieve": lambda c: c.jobs.retrieve("job_1"),
    "addresses.lookup": lambda c: c.addresses.lookup(
        street_address="1 Main St",
        state="NY",
        city="Albany",
        zip_code="12207",
        secondary_address="Ste 2",
        firm="Acme",
    ),
    "addresses.suggest": lambda c: c.addresses.suggest(q="1 Main", state="NY", limit=5),
    "bank_accounts.validate_iban": lambda c: c.bank_accounts.validate_iban(
        iban="DE89370400440532013000", bic="DEUTDEFF", account_holder_name="Acme"
    ),
    "bank_accounts.validate_us_ach": lambda c: c.bank_accounts.validate_us_ach(
        routing_number="011000015", account_number="1234", account_holder_name="Acme"
    ),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_sync_request_matches_spec(name: str) -> None:
    rec = Recorder()
    with Vendorval(
        api_key="vv_test_contract",
        base_url="https://api.example",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(rec)),
    ) as client:
        CASES[name](client)
    assert rec.calls
    assert _problems(rec) == []


@pytest.mark.parametrize("name", sorted(CASES))
def test_async_request_matches_spec_and_sync(name: str) -> None:
    sync_rec, async_rec = Recorder(), Recorder()
    with Vendorval(
        api_key="vv_test_contract",
        base_url="https://api.example",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(sync_rec)),
    ) as client:
        CASES[name](client)

    async def run() -> None:
        async with AsyncVendorval(
            api_key="vv_test_contract",
            base_url="https://api.example",
            max_retries=0,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(async_rec)),
        ) as client:
            await CASES[name](client)

    asyncio.run(run())
    assert _problems(async_rec) == []

    def strip_keys(calls: list[tuple[str, str, Any]]) -> list[tuple[str, str, Any]]:
        out = []
        for method, url, body in calls:
            if isinstance(body, dict) and isinstance(body.get("options"), dict):
                body = {**body, "options": {**body["options"], "idempotency_key": "<generated>"}}
            out.append((method, url, body))
        return out

    assert strip_keys(async_rec.calls) == strip_keys(sync_rec.calls)


def test_checker_catches_the_drift_it_exists_for() -> None:
    legacy_monitor = "\n".join(
        check_request(
            "POST",
            "https://api.example/v1/monitors",
            {"entity_id": "ent_1", "checks": ["sam_registration"], "cadence": "weekly"},
        )
    )
    assert "frequency: required" in legacy_monitor
    assert "cadence: not in the API schema" in legacy_monitor

    dropped = "\n".join(
        check_request(
            "POST",
            "https://api.example/v1/entities/lookup",
            {"identifiers": {"uei": "X"}, "legal_name": "Acme"},
        )
    )
    assert "legal_name: not in the API schema" in dropped

    bad_enum = "\n".join(
        check_request(
            "POST",
            "https://api.example/v1/entities",
            {
                "identifiers": [{"type": "uei", "value": "X"}],
                "legal_name": "A",
                "entity_type": "individual",
            },
        )
    )
    assert '"individual" is not one of' in bad_enum

    no_route = check_request("GET", "https://api.example/v1/verifications", None)
    assert "no such operation" in no_route[0]


def test_covers_every_public_resource_method() -> None:
    resources: dict[str, list[type]] = {
        "entities": [_entities.EntitiesResource, _entities.AsyncEntitiesResource],
        "verifications": [
            _verifications.VerificationsResource,
            _verifications.AsyncVerificationsResource,
        ],
        "certifications": [
            _certifications.CertificationsResource,
            _certifications.AsyncCertificationsResource,
        ],
        "monitors": [_monitors.MonitorsResource, _monitors.AsyncMonitorsResource],
        "providers": [_simple.ProvidersResource, _simple.AsyncProvidersResource],
        "meta": [_meta.MetaResource, _meta.AsyncMetaResource],
        "usage": [_simple.UsageResource, _simple.AsyncUsageResource],
        "jobs": [_simple.JobsResource, _simple.AsyncJobsResource],
        "addresses": [_addresses.AddressesResource, _addresses.AsyncAddressesResource],
        "bank_accounts": [
            _bank_accounts.BankAccountsResource,
            _bank_accounts.AsyncBankAccountsResource,
        ],
    }
    methods = {
        f"{name}.{attr}"
        for name, classes in resources.items()
        for cls in classes
        for attr, member in inspect.getmembers(cls, inspect.isfunction)
        if not attr.startswith("_")
    }
    assert sorted(methods - set(CASES)) == []


# ─── Enum parity with the spec ────────────────────────────────────────────────

ENUM_CASES: list[tuple[str, Any, list[Any]]] = [
    ("CheckType", types.CheckType, body_schema_at("POST", "/v1/verifications", "checks.items")["enum"]),
    ("EntityType", types.EntityType, body_schema_at("POST", "/v1/entities", "entity_type")["enum"]),
    (
        "IdentifierType",
        types.IdentifierType,
        body_schema_at("POST", "/v1/entities", "identifiers.items.type")["enum"],
    ),
    (
        "LookupIdentifierKey",
        types.LookupIdentifierKey,
        list(body_schema_at("POST", "/v1/entities/lookup", "identifiers")["properties"]),
    ),
    (
        "VerifyIdentifierObject keys",
        tuple(types.VerifyIdentifierObject.__annotations__),
        list(body_schema_at("POST", "/v1/verify", "identifiers.anyOf[0]")["properties"]),
    ),
    ("VerificationMode", types.VerificationMode, body_schema_at("POST", "/v1/verifications", "mode")["enum"]),
    ("VerifyVia", types.VerifyVia, body_schema_at("POST", "/v1/verify", "verify_via")["enum"]),
    ("MonitorFrequency", types.MonitorFrequency, body_schema_at("POST", "/v1/monitors", "frequency")["enum"]),
    ("LookupMode", types.LookupMode, body_schema_at("POST", "/v1/entities/lookup", "mode")["enum"]),
    (
        "SamRefreshMode",
        types.SamRefreshMode,
        body_schema_at("POST", "/v1/entities/lookup", "options.sam_refresh")["enum"],
    ),
    (
        "LookupEntityField",
        types.LookupEntityField,
        body_schema_at("POST", "/v1/entities/lookup", "fields.items")["enum"],
    ),
    (
        "CertificationStatus",
        types.CertificationStatus,
        query_schema("GET", "/v1/certifications", "status")["enum"],
    ),
    (
        "CertificationIssuerScope",
        types.CertificationIssuerScope,
        query_schema("GET", "/v1/certifications", "scope")["items"]["enum"],
    ),
]


@pytest.mark.parametrize(("name", "sdk", "spec"), ENUM_CASES, ids=[c[0] for c in ENUM_CASES])
def test_sdk_enum_matches_spec(name: str, sdk: Any, spec: list[Any]) -> None:
    values = sdk if isinstance(sdk, tuple) else get_args(sdk)
    assert sorted(map(str, values)) == sorted(map(str, spec)), name
