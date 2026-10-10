/**
 * One page of an offset-paginated list, plus the means to fetch the rest.
 *
 * The API's list endpoints return `{ data, has_more, limit, offset, total }`.
 * Iterating a `Page` with `for await` walks every page: when `has_more` is
 * true it requests the next one at `offset + data.length`, so callers never
 * stop silently at the first page. `all()` collects every item the same way.
 *
 * Use `data` (or `length`) when you only want the page you asked for.
 */
export interface PageInfo {
  hasMore: boolean;
  total?: number | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export type FetchPage<T> = (offset: number) => Promise<Page<T>>;

export class Page<T> implements AsyncIterable<T> {
  /** Items on this page only. */
  readonly data: T[];
  /** True when the API reported more items after this page. */
  readonly hasMore: boolean;
  /** Total matching items, when the API reports it. */
  readonly total: number | undefined;
  readonly limit: number | undefined;
  readonly offset: number | undefined;

  private readonly fetchPage: FetchPage<T> | undefined;

  constructor(items: T[], info?: PageInfo, fetchPage?: FetchPage<T>) {
    this.data = items;
    this.hasMore = info?.hasMore ?? false;
    this.total = info?.total;
    this.limit = info?.limit;
    this.offset = info?.offset;
    this.fetchPage = fetchPage;
  }

  /**
   * Build a page from an API list response. Accepts the standard envelope or
   * a bare array (treated as a single, complete page).
   */
  static fromResponse<T>(
    body: Partial<{
      data: T[];
      has_more: boolean;
      total: number;
      limit: number;
      offset: number;
    }> | T[] | null | undefined,
    fetchPage?: FetchPage<T>,
  ): Page<T> {
    if (Array.isArray(body)) return new Page(body);
    const items = Array.isArray(body?.data) ? body.data : [];
    return new Page(
      items,
      {
        hasMore: body?.has_more === true,
        total: body?.total,
        limit: body?.limit,
        offset: body?.offset,
      },
      fetchPage,
    );
  }

  /** Whether `nextPage()` will return another page. */
  hasNextPage(): boolean {
    // An empty page that claims more would loop forever; treat it as the end.
    return this.hasMore && this.fetchPage !== undefined && this.data.length > 0;
  }

  /** Fetch the page after this one, or null when this is the last page. */
  async nextPage(): Promise<Page<T> | null> {
    if (!this.hasNextPage() || !this.fetchPage) return null;
    return this.fetchPage((this.offset ?? 0) + this.data.length);
  }

  /** Iterate every item across every page. */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    yield* this.data;
    let page = await this.nextPage();
    while (page) {
      yield* page.data;
      page = await page.nextPage();
    }
  }

  /** Collect every item across every page into an array. */
  async all(): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this) out.push(item);
    return out;
  }

  /** Number of items on this page. */
  get length(): number {
    return this.data.length;
  }
}
