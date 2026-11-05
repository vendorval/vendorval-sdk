"""Shared request plumbing for both sync and async clients."""

from __future__ import annotations

import ipaddress
import json
import os
import platform
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

import httpx

from ._errors import (
    APIConnectionError,
    APITimeoutError,
    VendorvalError,
    error_from_response,
)
from ._idempotency import generate_idempotency_key
from ._retry import decide_retry
from ._version import API_VERSION, VERSION

DEFAULT_BASE_URL = "https://api.vendorval.com"
DEFAULT_TIMEOUT = 60.0
DEFAULT_MAX_RETRIES = 2

_KEY_PREFIX = re.compile(r"^vv_(test|live|mcp)_")
_KEY_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
_USER_AGENT = (
    f"vendorval-python/{VERSION} "
    f"(python/{platform.python_version()}; {platform.python_implementation().lower()})"
)


@dataclass
class ResolvedConfig:
    api_key: str = field(repr=False)
    base_url: str
    timeout: float
    max_retries: int


@dataclass
class Prepared:
    method: str
    # These hold the API key and request data, so keep them out of any repr
    # that ends up in a log or a captured stack frame.
    url: str = field(repr=False)
    headers: dict[str, str] = field(repr=False)
    json_body: Any = field(repr=False)
    timeout: float
    auto_idempotency: bool
    max_retries: int


def _is_loopback_host(host: str) -> bool:
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _check_base_url(url: str) -> None:
    try:
        parsed = httpx.URL(url)
    except httpx.InvalidURL:
        return  # Reported by the first request, as before.
    if parsed.scheme == "http" and not _is_loopback_host(parsed.host):
        raise VendorvalError(
            "base_url must use https:// unless it points at localhost, because the API key "
            "is sent with every request. For a trusted private network, pass "
            "allow_insecure_base_url=True.",
            type="configuration_error",
            code="insecure_base_url",
        )


def resolve_config(
    *,
    api_key: str | None,
    base_url: str | None,
    timeout: float | None,
    max_retries: int | None,
    validate_api_key: bool,
    allow_insecure_base_url: bool = False,
) -> ResolvedConfig:
    # An explicit api_key wins, even "", so a blank config value is never
    # silently replaced by the environment key (same as the Node SDK).
    key = api_key if api_key is not None else (os.environ.get("VENDORVAL_API_KEY") or "")
    # Keys read from a file or a mounted secret often end in a newline.
    key = key.strip()
    if not key:
        raise VendorvalError(
            "Missing API key. Pass api_key= or set VENDORVAL_API_KEY in the environment.",
            type="configuration_error",
            code="missing_api_key",
        )
    # Checked even with validate_api_key=False: no key contains these, and the
    # HTTP layer's error for such a header value would quote it.
    if _KEY_CONTROL_CHARS.search(key):
        raise VendorvalError(
            "API key contains control characters. Check how it is loaded.",
            type="configuration_error",
            code="invalid_api_key_format",
        )
    if validate_api_key and not _KEY_PREFIX.match(key):
        raise VendorvalError(
            "API key has an unexpected prefix. Expected 'vv_live_', 'vv_test_' or 'vv_mcp_'.",
            type="configuration_error",
            code="invalid_api_key_prefix",
        )

    url = base_url or os.environ.get("VENDORVAL_BASE_URL") or DEFAULT_BASE_URL
    url = url.rstrip("/")
    if not allow_insecure_base_url:
        _check_base_url(url)

    resolved_timeout = DEFAULT_TIMEOUT if timeout is None else timeout
    resolved_max_retries = DEFAULT_MAX_RETRIES if max_retries is None else max_retries
    if resolved_timeout <= 0:
        raise VendorvalError(
            "timeout must be > 0 seconds.",
            type="configuration_error",
            code="invalid_timeout",
        )
    if resolved_max_retries < 0:
        raise VendorvalError(
            "max_retries must be >= 0.",
            type="configuration_error",
            code="invalid_max_retries",
        )

    return ResolvedConfig(
        api_key=key,
        base_url=url,
        timeout=resolved_timeout,
        max_retries=resolved_max_retries,
    )


def prepare(
    cfg: ResolvedConfig,
    *,
    method: str,
    path: str,
    body: Any = None,
    query: Mapping[str, Any] | None = None,
    auto_idempotency: bool = False,
    headers: Mapping[str, str] | None = None,
    timeout: float | None = None,
    max_retries: int | None = None,
) -> Prepared:
    if not path.startswith("/"):
        path = f"/{path}"
    url = f"{cfg.base_url}{path}"
    if query:
        params = {k: str(v) for k, v in query.items() if v is not None}
        if params:
            url = str(httpx.URL(url).copy_merge_params(params))

    h = {
        "Authorization": f"Bearer {cfg.api_key}",
        "User-Agent": _USER_AGENT,
        # The API's version-negotiation header. Today it opts in to the
        # widened per-result enum (`clear` / `exact_match` / `probable_match`);
        # without it the API aliases those down to the legacy values. Sending
        # the SDK's pinned date keeps responses stable for a given SDK release.
        "Accept-Version": API_VERSION,
        "Accept": "application/json",
    }
    if headers:
        h.update(headers)
    if body is not None and method != "GET":
        h["Content-Type"] = "application/json"

    return Prepared(
        method=method,
        url=url,
        headers=h,
        json_body=body,
        timeout=cfg.timeout if timeout is None else timeout,
        auto_idempotency=auto_idempotency,
        max_retries=cfg.max_retries if max_retries is None else max_retries,
    )


def inject_idempotency_key(body: Any) -> Any:
    if not isinstance(body, dict):
        return body
    cloned = dict(body)
    options = cloned.get("options")
    if isinstance(options, dict):
        new_opts = dict(options)
        new_opts.setdefault("idempotency_key", generate_idempotency_key())
        cloned["options"] = new_opts
    else:
        cloned["options"] = {"idempotency_key": generate_idempotency_key()}
    return cloned


@dataclass
class ApiResponse:
    data: Any
    status: int
    request_id: str | None
    headers: httpx.Headers


def _parse_body(response: httpx.Response) -> Any:
    if response.status_code == 204 or not response.content:
        return None
    try:
        return response.json()
    except json.JSONDecodeError:
        return None


def _request_id(response: httpx.Response) -> str | None:
    value = response.headers.get("x-request-id")
    return value if isinstance(value, str) else None


def _connection_error(err: httpx.HTTPError, prepared: Prepared) -> APIConnectionError:
    message = str(err)
    token = prepared.headers.get("Authorization", "").removeprefix("Bearer ")
    if token:
        message = message.replace(token, "[redacted]")
    return APIConnectionError(message)


def execute_sync(
    client: httpx.Client,
    prepared: Prepared,
) -> ApiResponse:
    # Generate the idempotency key (if requested) before the first attempt and
    # reuse it across retries so the API can deduplicate when the first POST
    # succeeded server-side but the response was lost on the network.
    body = (
        inject_idempotency_key(prepared.json_body)
        if prepared.auto_idempotency
        else prepared.json_body
    )
    last_error: Exception | None = None
    for attempt in range(prepared.max_retries + 1):
        try:
            response = client.request(
                prepared.method,
                prepared.url,
                headers=prepared.headers,
                json=body if prepared.method != "GET" else None,
                timeout=prepared.timeout,
            )
        except httpx.TimeoutException:
            last_error = APITimeoutError(prepared.timeout)
            if attempt >= prepared.max_retries:
                raise last_error from None
            time.sleep(min(0.5 * (2 ** attempt), 30.0))
            continue
        except httpx.HTTPError as err:
            last_error = _connection_error(err, prepared)
            if attempt >= prepared.max_retries:
                raise last_error from None
            time.sleep(min(0.5 * (2 ** attempt), 30.0))
            continue

        if response.status_code < 400:
            return ApiResponse(
                data=_parse_body(response),
                status=response.status_code,
                request_id=_request_id(response),
                headers=response.headers,
            )

        delay = decide_retry(
            attempt=attempt,
            status=response.status_code,
            headers=response.headers,
        )
        if delay is not None and attempt < prepared.max_retries:
            time.sleep(delay)
            continue

        raise error_from_response(
            status=response.status_code,
            payload=_parse_body(response),
            headers=response.headers,
            request_id=_request_id(response),
        )

    if last_error is not None:
        raise last_error
    raise APIConnectionError("Request failed after retries")


async def execute_async(
    client: httpx.AsyncClient,
    prepared: Prepared,
) -> ApiResponse:
    import asyncio

    # See execute_sync — same rationale: generate the idempotency key once
    # before the loop so retries reuse it.
    body = (
        inject_idempotency_key(prepared.json_body)
        if prepared.auto_idempotency
        else prepared.json_body
    )
    last_error: Exception | None = None
    for attempt in range(prepared.max_retries + 1):
        try:
            response = await client.request(
                prepared.method,
                prepared.url,
                headers=prepared.headers,
                json=body if prepared.method != "GET" else None,
                timeout=prepared.timeout,
            )
        except httpx.TimeoutException:
            last_error = APITimeoutError(prepared.timeout)
            if attempt >= prepared.max_retries:
                raise last_error from None
            await asyncio.sleep(min(0.5 * (2 ** attempt), 30.0))
            continue
        except httpx.HTTPError as err:
            last_error = _connection_error(err, prepared)
            if attempt >= prepared.max_retries:
                raise last_error from None
            await asyncio.sleep(min(0.5 * (2 ** attempt), 30.0))
            continue

        if response.status_code < 400:
            return ApiResponse(
                data=_parse_body(response),
                status=response.status_code,
                request_id=_request_id(response),
                headers=response.headers,
            )

        delay = decide_retry(
            attempt=attempt,
            status=response.status_code,
            headers=response.headers,
        )
        if delay is not None and attempt < prepared.max_retries:
            await asyncio.sleep(delay)
            continue

        raise error_from_response(
            status=response.status_code,
            payload=_parse_body(response),
            headers=response.headers,
            request_id=_request_id(response),
        )

    if last_error is not None:
        raise last_error
    raise APIConnectionError("Request failed after retries")
