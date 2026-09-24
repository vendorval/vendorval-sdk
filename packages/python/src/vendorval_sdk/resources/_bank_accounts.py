"""Bank account validation — structural checks on vendor payment details.

Validates an IBAN's check digits and country layout, a BIC's structure, a US
ABA routing number's checksum and Federal Reserve range, and whether an IBAN
and BIC name the same country.

Read the boundary carefully, because it matters more here than elsewhere in the
API. These calls answer "are these details well-formed and internally
consistent". They do NOT answer "does this account exist" or "does it belong to
this vendor". Confirming those is account ownership verification, a separate
capability this endpoint does not provide.

FREE (no per-call meter) and stateless: nothing is stored, and the account
number is never persisted or logged. That makes it safe to call from a
vendor-onboarding form's field validation without taking on any obligation to
store payment credentials.
"""

from __future__ import annotations

from typing import Any

import httpx

from .._models import Response
from .._request import ResolvedConfig, execute_async, execute_sync, prepare

_PATH = "/v1/bank-accounts/validate"


def _build_iban_body(
    *,
    iban: str,
    bic: str | None,
    account_holder_name: str | None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"scheme": "iban", "iban": iban}
    # Omit empty optionals rather than sending "". The API requires a non-empty
    # value for these fields and rejects the whole request otherwise.
    if bic:
        body["bic"] = bic
    if account_holder_name:
        body["account_holder_name"] = account_holder_name
    return body


def _build_us_ach_body(
    *,
    routing_number: str,
    account_number: str | None,
    account_holder_name: str | None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"scheme": "us_ach", "routing_number": routing_number}
    if account_number:
        body["account_number"] = account_number
    if account_holder_name:
        body["account_holder_name"] = account_holder_name
    return body




class BankAccountsResource:
    """Synchronous bank-accounts resource."""

    def __init__(self, cfg: ResolvedConfig, client: httpx.Client) -> None:
        self._cfg = cfg
        self._client = client

    def validate_iban(
        self,
        *,
        iban: str,
        bic: str | None = None,
        account_holder_name: str | None = None,
    ) -> Response:
        """Validate an IBAN, optionally against a BIC.

        Returns HTTP 200 **even when the account is structurally invalid** —
        that is a successful answer to the question asked, reported as
        ``res["valid"] is False`` with one finding per failed rule. A raised
        error means the REQUEST was malformed, which is a different problem.

        Never treat ``valid`` as approval to pay: it means well-formed and
        internally consistent, not that the account exists or belongs to this
        vendor. The response carries a ``disclaimer`` saying so; pass it
        through to whoever sees the result.
        """
        body = _build_iban_body(
            iban=iban, bic=bic, account_holder_name=account_holder_name
        )
        prepared = prepare(self._cfg, method="POST", path=_PATH, body=body)
        res = execute_sync(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    def validate_us_ach(
        self,
        *,
        routing_number: str,
        account_number: str | None = None,
        account_holder_name: str | None = None,
    ) -> Response:
        """Validate a US ABA routing number.

        Both the weighted checksum and the assigned Federal Reserve prefix
        range are checked — a number can satisfy the checksum and still be
        impossible.

        ``account_number`` is accepted but NOT validated: US account numbers
        carry no checksum. It is used only to return a masked display form, and
        is never stored or logged. Same 200-on-invalid and same disclaimer
        caveat as ``validate_iban``.
        """
        body = _build_us_ach_body(
            routing_number=routing_number,
            account_number=account_number,
            account_holder_name=account_holder_name,
        )
        prepared = prepare(self._cfg, method="POST", path=_PATH, body=body)
        res = execute_sync(self._client, prepared)
        return Response(res.data, res.request_id, res.status)


class AsyncBankAccountsResource:
    """Asynchronous bank-accounts resource."""

    def __init__(self, cfg: ResolvedConfig, client: httpx.AsyncClient) -> None:
        self._cfg = cfg
        self._client = client

    async def validate_iban(
        self,
        *,
        iban: str,
        bic: str | None = None,
        account_holder_name: str | None = None,
    ) -> Response:
        body = _build_iban_body(
            iban=iban, bic=bic, account_holder_name=account_holder_name
        )
        prepared = prepare(self._cfg, method="POST", path=_PATH, body=body)
        res = await execute_async(self._client, prepared)
        return Response(res.data, res.request_id, res.status)

    async def validate_us_ach(
        self,
        *,
        routing_number: str,
        account_number: str | None = None,
        account_holder_name: str | None = None,
    ) -> Response:
        body = _build_us_ach_body(
            routing_number=routing_number,
            account_number=account_number,
            account_holder_name=account_holder_name,
        )
        prepared = prepare(self._cfg, method="POST", path=_PATH, body=body)
        res = await execute_async(self._client, prepared)
        return Response(res.data, res.request_id, res.status)
