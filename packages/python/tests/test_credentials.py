"""How the client handles the API key and the base URL."""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import httpx
import pytest

from vendorval_sdk import APIConnectionError, AsyncVendorval, Vendorval, VendorvalError
from vendorval_sdk._request import prepare, resolve_config

KEY = "vv_test_DUMMYKEY"
MALFORMED_KEYS = [
    "vv_test_DUMMY\nKEY",
    "vv_test_DUMMY\rKEY",
    "vv_test_DUMMY\x00KEY",
    "vv_test_DUMMYKEY\n",
    "vv_test_DUMMYKEY ",
]


class _Handler(BaseHTTPRequestHandler):
    seen_auth: list[str | None] = []

    def do_GET(self) -> None:
        type(self).seen_auth.append(self.headers.get("authorization"))
        body = json.dumps({"data": []}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        pass


@pytest.fixture
def local_server() -> Iterator[str]:
    """A loopback server, so requests go through the real httpx transport."""
    _Handler.seen_auth = []
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.parametrize("key", MALFORMED_KEYS)
def test_malformed_key_stays_out_of_errors(local_server: str, key: str) -> None:
    try:
        with Vendorval(api_key=key, base_url=local_server, max_retries=0) as client:
            client.certifications.list()
    except VendorvalError as err:
        assert "DUMMY" not in str(err)


@pytest.mark.parametrize("key", MALFORMED_KEYS)
async def test_malformed_key_stays_out_of_errors_async(local_server: str, key: str) -> None:
    try:
        async with AsyncVendorval(api_key=key, base_url=local_server, max_retries=0) as client:
            await client.certifications.list()
    except VendorvalError as err:
        assert "DUMMY" not in str(err)


def _failing_transport(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError(f"rejected header value {request.headers['authorization']}")


def test_transport_error_text_has_the_key_removed() -> None:
    http = httpx.Client(transport=httpx.MockTransport(_failing_transport))
    client = Vendorval(api_key=KEY, max_retries=0, http_client=http)
    with pytest.raises(APIConnectionError) as exc:
        client.certifications.list()
    assert KEY not in str(exc.value)
    assert "rejected header value" in str(exc.value)


async def test_transport_error_text_has_the_key_removed_async() -> None:
    http = httpx.AsyncClient(transport=httpx.MockTransport(_failing_transport))
    client = AsyncVendorval(api_key=KEY, max_retries=0, http_client=http)
    with pytest.raises(APIConnectionError) as exc:
        await client.certifications.list()
    assert KEY not in str(exc.value)
    assert "rejected header value" in str(exc.value)


@pytest.mark.parametrize("validate", [True, False])
def test_control_characters_in_a_key_are_rejected(validate: bool) -> None:
    with pytest.raises(VendorvalError) as exc:
        Vendorval(api_key="vv_test_DUMMY\nKEY", validate_api_key=validate)
    assert exc.value.code == "invalid_api_key_format"
    assert exc.value.type == "configuration_error"
    assert "DUMMY" not in str(exc.value)


def test_whitespace_around_a_key_is_ignored(local_server: str) -> None:
    with Vendorval(api_key=f" {KEY}\n", base_url=local_server, max_retries=0) as client:
        assert client.api_key == KEY
        client.certifications.list()
    assert _Handler.seen_auth == [f"Bearer {KEY}"]


def test_key_from_the_environment_is_trimmed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VENDORVAL_API_KEY", f"{KEY}\n")
    with Vendorval() as client:
        assert client.api_key == KEY


def test_blank_key_counts_as_missing() -> None:
    with pytest.raises(VendorvalError) as exc:
        Vendorval(api_key=" \n")
    assert exc.value.code == "missing_api_key"


def _config() -> Any:
    return resolve_config(
        api_key=KEY,
        base_url=None,
        timeout=None,
        max_retries=None,
        validate_api_key=True,
    )


def test_resolved_config_repr_hides_the_key() -> None:
    cfg = _config()
    assert cfg.api_key == KEY
    assert KEY not in repr(cfg)


def test_prepared_repr_hides_the_key_and_request_data() -> None:
    prepared = prepare(
        _config(),
        method="POST",
        path="/v1/example",
        query={"tin": "000000000"},
        body={"account_number": "111111111"},
    )
    assert prepared.headers["Authorization"] == f"Bearer {KEY}"
    text = repr(prepared)
    assert KEY not in text
    assert "000000000" not in text
    assert "111111111" not in text
    assert "POST" in text


def test_client_vars_do_not_print_the_key() -> None:
    with Vendorval(api_key=KEY) as client:
        assert KEY not in repr(vars(client))


@pytest.mark.parametrize(
    "base_url",
    [
        "http://example.invalid",
        "http://api.vendorval.com",
        "HTTP://example.invalid",
        "http://10.0.0.5:8080",
        "http://localhost.example.com",
        "http://127.0.0.1.example.com",
        "http://localhost@example.com",
    ],
)
def test_plain_http_is_refused_for_a_remote_host(base_url: str) -> None:
    with pytest.raises(VendorvalError) as exc:
        Vendorval(api_key=KEY, base_url=base_url)
    assert exc.value.code == "insecure_base_url"
    assert exc.value.type == "configuration_error"
    assert KEY not in str(exc.value)


def test_base_url_from_the_environment_is_checked(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VENDORVAL_BASE_URL", "http://example.invalid")
    with pytest.raises(VendorvalError) as exc:
        Vendorval(api_key=KEY)
    assert exc.value.code == "insecure_base_url"


def test_async_client_checks_the_base_url() -> None:
    with pytest.raises(VendorvalError) as exc:
        AsyncVendorval(api_key=KEY, base_url="http://example.invalid")
    assert exc.value.code == "insecure_base_url"


@pytest.mark.parametrize(
    "base_url",
    [
        "https://api.vendorval.com",
        "https://staging.example/",
        "http://localhost",
        "http://localhost:3000",
        "http://LOCALHOST:3000",
        "http://api.localhost:3000",
        "http://127.0.0.1:3000",
        "http://127.8.9.10",
        "http://[::1]:3000",
    ],
)
def test_https_and_loopback_are_accepted(base_url: str) -> None:
    Vendorval(api_key=KEY, base_url=base_url).close()


def test_private_network_opt_out() -> None:
    url = "http://gateway.internal:8080"
    with Vendorval(api_key=KEY, base_url=url, allow_insecure_base_url=True) as client:
        assert client.base_url == url


async def test_private_network_opt_out_async() -> None:
    url = "http://gateway.internal:8080"
    async with AsyncVendorval(api_key=KEY, base_url=url, allow_insecure_base_url=True) as client:
        assert client.base_url == url
