"""Bank account validation resource — request shape and response passthrough.

The API's own validation rules are tested server-side. What matters here is
that the client builds a body the API accepts and does not mangle the response.
"""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from vendorval_sdk import AsyncVendorval, Vendorval
from vendorval_sdk._errors import ValidationError

_URL = "https://api.example/v1/bank-accounts/validate"

DISCLAIMER = (
    "Structural validation only. This confirms the details are well-formed and "
    "internally consistent. It does not confirm the account exists, and it does "
    "not confirm the account belongs to this vendor. Do not treat it as approval to pay."
)


def _ok(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "valid": True,
        "scheme": "iban",
        "findings": [
            {"field": "iban", "valid": True, "code": "ok", "message": "Well-formed."}
        ],
        "display": {"iban": "DE89••••••••••••••3000"},
        "countries": {"iban": "DE"},
        "disclaimer": DISCLAIMER,
    }
    body.update(overrides)
    return body


def _client() -> Vendorval:
    return Vendorval(api_key="vv_test_x", base_url="https://api.example")


@respx.mock
def test_validate_iban_posts_expected_body() -> None:
    route = respx.post(_URL).mock(
        return_value=httpx.Response(
            200, json=_ok(), headers={"x-request-id": "req_bank_1"}
        )
    )
    res = _client().bank_accounts.validate_iban(iban="DE89 3704 0044 0532 0130 00")

    sent = json.loads(route.calls[0].request.content)
    assert sent == {"scheme": "iban", "iban": "DE89 3704 0044 0532 0130 00"}
    assert res["valid"] is True
    assert res.request_id == "req_bank_1"


@respx.mock
def test_validate_iban_includes_bic_when_given() -> None:
    route = respx.post(_URL).mock(return_value=httpx.Response(200, json=_ok()))
    _client().bank_accounts.validate_iban(iban="DE89370400440532013000", bic="DEUTDEFF")

    sent = json.loads(route.calls[0].request.content)
    assert sent["bic"] == "DEUTDEFF"


@respx.mock
def test_empty_optionals_are_omitted_not_sent_blank() -> None:
    # The API requires a non-empty value for these and would reject the whole
    # request if the client sent "".
    route = respx.post(_URL).mock(return_value=httpx.Response(200, json=_ok()))
    _client().bank_accounts.validate_iban(
        iban="DE89370400440532013000", bic="", account_holder_name=""
    )

    sent = json.loads(route.calls[0].request.content)
    assert "bic" not in sent
    assert "account_holder_name" not in sent


@respx.mock
def test_validate_us_ach_sends_no_iban_field() -> None:
    route = respx.post(_URL).mock(
        return_value=httpx.Response(
            200, json=_ok(scheme="us_ach", display={}, countries={})
        )
    )
    _client().bank_accounts.validate_us_ach(
        routing_number="021000021", account_number="123456789"
    )

    sent = json.loads(route.calls[0].request.content)
    assert sent == {
        "scheme": "us_ach",
        "routing_number": "021000021",
        "account_number": "123456789",
    }
    assert "iban" not in sent


@respx.mock
def test_structurally_invalid_account_does_not_raise() -> None:
    # The distinction the API contract rests on: a raised error must mean the
    # REQUEST was malformed, never that the account was bad.
    respx.post(_URL).mock(
        return_value=httpx.Response(
            200,
            json=_ok(
                valid=False,
                findings=[
                    {
                        "field": "iban",
                        "valid": False,
                        "code": "bad_check_digits",
                        "message": "The check digits do not match the rest of the IBAN.",
                    }
                ],
            ),
        )
    )
    res = _client().bank_accounts.validate_iban(iban="DE89370400440532013001")
    assert res["valid"] is False
    assert res["findings"][0]["code"] == "bad_check_digits"


@respx.mock
def test_every_finding_is_preserved() -> None:
    respx.post(_URL).mock(
        return_value=httpx.Response(
            200,
            json=_ok(
                valid=False,
                countries={"iban": "DE", "bic": "NL"},
                findings=[
                    {"field": "iban", "valid": True, "code": "ok", "message": "ok"},
                    {"field": "bic", "valid": True, "code": "ok", "message": "ok"},
                    {
                        "field": "iban_bic_agreement",
                        "valid": False,
                        "code": "country_mismatch",
                        "message": "The IBAN is a DE account but the BIC is registered in NL.",
                    },
                ],
            ),
        )
    )
    res = _client().bank_accounts.validate_iban(
        iban="DE89370400440532013000", bic="ABNANL2A"
    )
    findings = res["findings"]
    assert len(findings) == 3
    assert [f["code"] for f in findings if not f["valid"]] == ["country_mismatch"]


@respx.mock
def test_disclaimer_passes_through_unmodified() -> None:
    # Consumers are told to surface this. If the SDK dropped or truncated it the
    # caveat would silently stop reaching whoever sees the result.
    respx.post(_URL).mock(return_value=httpx.Response(200, json=_ok()))
    res = _client().bank_accounts.validate_iban(iban="DE89370400440532013000")
    assert res["disclaimer"] == DISCLAIMER


@respx.mock
def test_malformed_request_raises() -> None:
    respx.post(_URL).mock(
        return_value=httpx.Response(
            422, json={"error": {"code": "validation_error", "message": "scheme required"}}
        )
    )
    # Assert the specific type: a 422 must surface as ValidationError, not just
    # "something raised". A bare Exception would also pass on a typo in the URL.
    with pytest.raises(ValidationError):
        _client().bank_accounts.validate_iban(iban="")


@pytest.mark.asyncio
@respx.mock
async def test_async_validate_iban() -> None:
    route = respx.post(_URL).mock(
        return_value=httpx.Response(
            200, json=_ok(), headers={"x-request-id": "req_bank_async"}
        )
    )
    async with AsyncVendorval(
        api_key="vv_test_x", base_url="https://api.example"
    ) as client:
        res = await client.bank_accounts.validate_iban(
            iban="DE89370400440532013000", bic="DEUTDEFF"
        )

    sent = json.loads(route.calls[0].request.content)
    assert sent["scheme"] == "iban"
    assert sent["bic"] == "DEUTDEFF"
    assert res.request_id == "req_bank_async"


@pytest.mark.asyncio
@respx.mock
async def test_async_validate_us_ach() -> None:
    route = respx.post(_URL).mock(
        return_value=httpx.Response(
            200, json=_ok(scheme="us_ach", display={}, countries={})
        )
    )
    async with AsyncVendorval(
        api_key="vv_test_x", base_url="https://api.example"
    ) as client:
        res = await client.bank_accounts.validate_us_ach(routing_number="021000021")

    sent = json.loads(route.calls[0].request.content)
    assert sent == {"scheme": "us_ach", "routing_number": "021000021"}
    assert res["valid"] is True
