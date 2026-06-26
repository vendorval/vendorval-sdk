"""Error classes mirroring the VendorVal API error envelope."""

from __future__ import annotations

from email.utils import parsedate_to_datetime
from typing import Any

import httpx


class VendorvalError(Exception):
    """Base class for all SDK errors."""

    def __init__(
        self,
        message: str,
        *,
        status: int = 0,
        type: str = "api_error",
        code: str = "api_error",
        request_id: str | None = None,
        param: str | None = None,
        details: Any = None,
        headers: httpx.Headers | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.type = type
        self.code = code
        self.request_id = request_id
        self.param = param
        self.details = details
        self.headers = headers


class APIError(VendorvalError):
    pass


class AuthenticationError(VendorvalError):
    pass


class PermissionError(VendorvalError):  # noqa: A001 - shadowing builtin is intentional
    pass


class ValidationError(VendorvalError):
    pass


class CountryError(ValidationError):
    """422 raised when a request can't be routed to a country/provider.

    Subclass of :class:`ValidationError` so existing 4xx catch-all handlers
    continue to match. Use ``err.code`` to switch on the specific failure:

      - ``country_required`` — no explicit country and nothing inferable
      - ``country_not_supported`` — resolved country isn't in SUPPORTED_COUNTRIES
      - ``identifier_not_supported_for_country`` — e.g. ``tin`` with ``country='DE'``
      - ``check_not_supported_for_country`` — e.g. ``sam_registration`` for an EU country
      - ``country_mismatch`` — explicit country contradicts identifier inference

    The ``details`` attribute carries a :data:`CountryErrorDetails`-shaped dict
    with ``country_resolved``, ``identifiers_seen``, ``recommended_action``,
    ``supported_countries``, and (for ``country_mismatch``) ``candidates``.
    """


_COUNTRY_ERROR_CODES = frozenset(
    {
        "country_required",
        "country_not_supported",
        "identifier_not_supported_for_country",
        "check_not_supported_for_country",
        "country_mismatch",
    }
)


class NotFoundError(VendorvalError):
    pass


class ConflictError(VendorvalError):
    def __init__(self, *args: Any, candidates: list[Any] | None = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.candidates = candidates


class RateLimitError(VendorvalError):
    def __init__(self, *args: Any, retry_after: float | None = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.retry_after = retry_after


class ProviderError(VendorvalError):
    pass


class APIConnectionError(VendorvalError):
    def __init__(self, message: str, *, request_id: str | None = None) -> None:
        super().__init__(
            message,
            status=0,
            type="connection_error",
            code="connection_error",
            request_id=request_id,
        )


class APITimeoutError(APIConnectionError):
    def __init__(self, timeout: float, *, request_id: str | None = None) -> None:
        super().__init__(f"Request timed out after {timeout}s", request_id=request_id)


_STATUS_TO_CLS: dict[int, type[VendorvalError]] = {
    400: ValidationError,
    401: AuthenticationError,
    403: PermissionError,
    404: NotFoundError,
    # 422 is an invalid-request status the API uses for semantic-validation
    # failures (country routing emits 422 + CountryError, but other
    # semantic violations also land here). Mapping to ValidationError keeps
    # catch-all 4xx handlers working consistently.
    422: ValidationError,
    429: RateLimitError,
    502: ProviderError,
}


def parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        pass
    try:
        dt = parsedate_to_datetime(value)
        from datetime import datetime, timezone

        return max(0.0, (dt - datetime.now(timezone.utc)).total_seconds())
    except (TypeError, ValueError):
        return None


def error_from_response(
    *,
    status: int,
    payload: Any,
    headers: httpx.Headers,
    request_id: str | None,
) -> VendorvalError:
    envelope = None
    if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
        envelope = payload["error"]

    msg = (envelope or {}).get("message") or f"VendorVal API error (status {status})"
    type_ = (envelope or {}).get("type") or "api_error"
    code = (envelope or {}).get("code") or f"http_{status}"
    param = (envelope or {}).get("param")
    details = (envelope or {}).get("details")

    common: dict[str, Any] = dict(
        message=msg,
        status=status,
        type=type_,
        code=code,
        request_id=request_id,
        param=param,
        details=details,
        headers=headers,
    )

    if status == 409:
        candidates = None
        if envelope:
            if isinstance(envelope.get("candidates"), list):
                candidates = envelope["candidates"]
            elif isinstance(envelope.get("details"), dict):
                inner = envelope["details"].get("candidates")
                if isinstance(inner, list):
                    candidates = inner
        return ConflictError(**common, candidates=candidates)

    if status == 429:
        return RateLimitError(
            **common,
            retry_after=parse_retry_after(headers.get("retry-after")),
        )

    # 422 envelopes with a country-routing code surface as CountryError
    # (a ValidationError subclass) so consumers can switch on `err.code` and
    # inspect the structured `err.details` payload. The `isinstance(code, str)`
    # guard handles malformed payloads where `code` is a non-string (e.g. a list
    # or dict) — set membership on a frozenset[str] would otherwise TypeError
    # on unhashable values, breaking error normalization for the rest of the
    # response.
    if status == 422 and isinstance(code, str) and code in _COUNTRY_ERROR_CODES:
        return CountryError(**common)

    cls = _STATUS_TO_CLS.get(status, APIError)
    return cls(**common)
