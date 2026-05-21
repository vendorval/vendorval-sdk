"""Synchronous client."""

from __future__ import annotations

from types import TracebackType

import httpx

from ._request import resolve_config
from ._version import API_VERSION, VERSION
from ._webhooks import construct_event
from .resources._addresses import AddressesResource
from .resources._certifications import CertificationsResource
from .resources._entities import EntitiesResource
from .resources._meta import MetaResource
from .resources._monitors import MonitorsResource
from .resources._simple import JobsResource, ProvidersResource, UsageResource
from .resources._verifications import VerificationsResource


class _Webhooks:
    construct_event = staticmethod(construct_event)


class Vendorval:
    """Synchronous VendorVal client.

    Construct directly or use as a context manager:

        with Vendorval() as client:
            client.entities.lookup(identifiers={"uei": "ABCD12345678"})

    The constructor reads `VENDORVAL_API_KEY` and `VENDORVAL_BASE_URL` from
    the environment if not supplied.
    """

    VERSION = VERSION
    API_VERSION = API_VERSION

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float | None = None,
        max_retries: int | None = None,
        validate_api_key: bool = True,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._cfg = resolve_config(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
            validate_api_key=validate_api_key,
        )
        self._owns_http = http_client is None
        self._http = http_client or httpx.Client(timeout=self._cfg.timeout)
        self.entities = EntitiesResource(self._cfg, self._http)
        self.verifications = VerificationsResource(self._cfg, self._http)
        self.certifications = CertificationsResource(self._cfg, self._http)
        self.monitors = MonitorsResource(self._cfg, self._http)
        self.providers = ProvidersResource(self._cfg, self._http)
        self.meta = MetaResource(self._cfg, self._http)
        self.usage = UsageResource(self._cfg, self._http)
        self.jobs = JobsResource(self._cfg, self._http)
        self.addresses = AddressesResource(self._cfg, self._http)
        self.webhooks = _Webhooks()

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    def __enter__(self) -> Vendorval:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    @property
    def api_key(self) -> str:
        return self._cfg.api_key

    @property
    def base_url(self) -> str:
        return self._cfg.base_url
