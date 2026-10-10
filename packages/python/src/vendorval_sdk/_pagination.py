"""Offset pagination.

The API's list endpoints return ``{data, has_more, limit, offset, total}``.
Iterating a page walks every page: when ``has_more`` is true the next one is
requested at ``offset + len(data)``, so callers never stop silently at the
first page. ``all()`` collects every item the same way.

The sync client returns :class:`Page` (``for item in page``); the async client
returns :class:`AsyncPage` (``async for item in page``). Use ``page.data`` for
the items of the page you asked for only.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from typing import Any, Generic, TypeVar

T = TypeVar("T")


class _PageBase(Generic[T]):
    def __init__(
        self,
        items: list[T],
        *,
        has_more: bool = False,
        total: int | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> None:
        self.data: list[T] = list(items)
        self.has_more = has_more
        self.total = total
        self.limit = limit
        self.offset = offset

    def _next_offset(self) -> int:
        return (self.offset or 0) + len(self.data)

    def _can_advance(self) -> bool:
        # An empty page that claims more would loop forever; treat it as the end.
        return self.has_more and len(self.data) > 0

    def __len__(self) -> int:
        return len(self.data)

    def __getitem__(self, index: int) -> T:
        return self.data[index]


class Page(_PageBase[T]):
    """One page of results from the sync client, able to fetch the rest."""

    def __init__(
        self,
        items: list[T],
        *,
        has_more: bool = False,
        total: int | None = None,
        limit: int | None = None,
        offset: int | None = None,
        fetch_page: Callable[[int], Page[T]] | None = None,
    ) -> None:
        super().__init__(items, has_more=has_more, total=total, limit=limit, offset=offset)
        self._fetch_page = fetch_page

    def has_next_page(self) -> bool:
        return self._fetch_page is not None and self._can_advance()

    def next_page(self) -> Page[T] | None:
        """Fetch the page after this one, or ``None`` on the last page."""
        if self._fetch_page is None or not self._can_advance():
            return None
        return self._fetch_page(self._next_offset())

    def __iter__(self) -> Iterator[T]:
        page: Page[T] | None = self
        while page is not None:
            yield from page.data
            page = page.next_page()

    def all(self) -> list[T]:
        """Every item across every page."""
        return list(self)


class AsyncPage(_PageBase[T]):
    """One page of results from the async client, able to fetch the rest."""

    def __init__(
        self,
        items: list[T],
        *,
        has_more: bool = False,
        total: int | None = None,
        limit: int | None = None,
        offset: int | None = None,
        fetch_page: Callable[[int], Awaitable[AsyncPage[T]]] | None = None,
    ) -> None:
        super().__init__(items, has_more=has_more, total=total, limit=limit, offset=offset)
        self._fetch_page = fetch_page

    def has_next_page(self) -> bool:
        return self._fetch_page is not None and self._can_advance()

    async def next_page(self) -> AsyncPage[T] | None:
        """Fetch the page after this one, or ``None`` on the last page."""
        if self._fetch_page is None or not self._can_advance():
            return None
        return await self._fetch_page(self._next_offset())

    async def __aiter__(self) -> AsyncIterator[T]:
        page: AsyncPage[T] | None = self
        while page is not None:
            for item in page.data:
                yield item
            page = await page.next_page()

    async def all(self) -> list[T]:
        """Every item across every page."""
        return [item async for item in self]


def envelope_fields(body: Any) -> tuple[list[Any], dict[str, Any]]:
    """Split a list response into its items and the page metadata.

    A bare list is treated as one complete page.
    """
    if isinstance(body, list):
        return body, {}
    if not isinstance(body, dict):
        return [], {}
    items = body.get("data")
    meta: dict[str, Any] = {
        "has_more": body.get("has_more") is True,
        "total": body.get("total"),
        "limit": body.get("limit"),
        "offset": body.get("offset"),
    }
    return (items if isinstance(items, list) else []), meta
