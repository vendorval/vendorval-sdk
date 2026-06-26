"""Shared request plumbing for both sync and async clients."""

from __future__ import annotations

import json
import os
import platform
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
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

_KEY_PREFIX = re.compile(r"^vv_(test|live)_")
_USER_AGENT = (
    f"vendorval-python/{VERSION} "
    f"(python/{platform.python_version()}; {platform.python_implementation().lower()})"
)


@dataclass
class ResolvedConfig:
    api_key: str
    base_url: str
    timeout: float
    max_retries: int


@dataclass
class Prepared:
    method: str
    url: str
    headers: dict[str, str]
    json_body: Any
    timeout: float
    auto_idempotency: bool
    max_retries: int


def resolve_config(
    *,
    api_key: str | None,
    base_url: str | None,
    timeout: float | None,
    max_retries: int | None,
    validate_api_key: bool,
) -> ResolvedConfig:
    key = api_key or os.environ.get("VENDORVAL_API_KEY") or ""
    if not key:
        raise VendorvalError(
            "Missing API key. Pass api_key= or set VENDORVAL_API_KEY in the environment.",
            type="configuration_error",
            code="missing_api_key",
        )
    if validate_api_key and not _KEY_PREFIX.match(key):
        raise VendorvalError(
            "API key has an unexpected prefix. Live keys start with 'vv_live_', "
            "test keys with 'vv_test_'.",
            type="configuration_error",
            code="invalid_api_key_prefix",
        )

    url = base_url or os.environ.get("VENDORVAL_BASE_URL") or DEFAULT_BASE_URL
    url = url.rstrip("/")

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
        "X-VendorVal-API-Version": API_VERSION,
        # Opt in to the widened per-result enum
        # (`clear` / `exact_match` / `probable_match`). The API aliases
        # these down to the legacy 4-value enum for callers without the
        # header. Sending the latest version on every install dogfoods
        # the new shape; old SDK installs keep working unchanged.
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
            last_error = APIConnectionError(str(err))
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
            last_error = APIConnectionError(str(err))
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
