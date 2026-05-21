"""Asynchronous client."""

from __future__ import annotations

from types import TracebackType

import httpx

from ._request import resolve_config
from ._version import API_VERSION, VERSION
from ._webhooks import construct_event
from .resources._addresses import AsyncAddressesResource
from .resources._certifications import AsyncCertificationsResource
from .resources._entities import AsyncEntitiesResource
from .resources._meta import AsyncMetaResource
from .resources._monitors import AsyncMonitorsResource
from .resources._simple import AsyncJobsResource, AsyncProvidersResource, AsyncUsageResource
from .resources._verifications import AsyncVerificationsResource


class _Webhooks:
    construct_event = staticmethod(construct_event)


class AsyncVendorval:
    """Asynchronous VendorVal client.

    Use as an async context manager so the underlying httpx client is closed:

        async with AsyncVendorval() as client:
            await client.entities.lookup(identifiers={"uei": "ABCD12345678"})
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
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._cfg = resolve_config(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
            validate_api_key=validate_api_key,
        )
        self._owns_http = http_client is None
        self._http = http_client or httpx.AsyncClient(timeout=self._cfg.timeout)
        self.entities = AsyncEntitiesResource(self._cfg, self._http)
        self.verifications = AsyncVerificationsResource(self._cfg, self._http)
        self.certifications = AsyncCertificationsResource(self._cfg, self._http)
        self.monitors = AsyncMonitorsResource(self._cfg, self._http)
        self.providers = AsyncProvidersResource(self._cfg, self._http)
        self.meta = AsyncMetaResource(self._cfg, self._http)
        self.usage = AsyncUsageResource(self._cfg, self._http)
        self.jobs = AsyncJobsResource(self._cfg, self._http)
        self.addresses = AsyncAddressesResource(self._cfg, self._http)
        self.webhooks = _Webhooks()

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def __aenter__(self) -> AsyncVendorval:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.aclose()

    @property
    def api_key(self) -> str:
        return self._cfg.api_key

    @property
    def base_url(self) -> str:
        return self._cfg.base_url
