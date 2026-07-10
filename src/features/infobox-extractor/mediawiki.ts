const DEFAULT_RETRY_ATTEMPTS = 5;
const DEFAULT_RETRY_DELAY = 500;
const CATEGORY_PAGE_DELAY = 200;

type Fetcher = typeof globalThis.fetch;

interface MediaWikiClientOptions {
  fetcher?: Fetcher;
  retryAttempts?: number;
  retryDelayMs?: number;
  categoryPageDelayMs?: number;
}

interface ApiError {
  code?: string;
  info?: string;
}

interface ApiResponse {
  error?: ApiError;
  query?: {
    categorymembers?: Array<{ title: string }>;
    general?: unknown;
    normalized?: Array<{ from: string; to: string }>;
    redirects?: Array<{ from: string; to: string }>;
    pages?: ApiPage[];
  };
  continue?: {
    cmcontinue?: string;
  };
}

interface ApiPage {
  title: string;
  missing?: boolean;
  invalid?: boolean;
  categoryinfo?: {
    size?: number;
  };
  revisions?: Array<{
    slots?: {
      main?: {
        content?: string;
      };
    };
  }>;
}

export interface RequestedPage {
  requestedTitle: string;
  title: string;
  missing: boolean;
  wikitext: string;
}

export class MediaWikiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaWikiError';
  }
}

export function normaliseWikiUrl(input: string): URL {
  let url: URL;

  try {
    url = new URL(input.trim());
  } catch {
    throw new MediaWikiError('Enter a complete wiki URL, such as https://en.wikipedia.org/wiki/.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new MediaWikiError('The wiki URL must use HTTP or HTTPS.');
  }

  if (url.username || url.password) {
    throw new MediaWikiError('The wiki URL cannot contain a username or password.');
  }

  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';

  return url;
}

export function normaliseCategoryName(input: string): string {
  return input
    .trim()
    .replace(/^category\s*:/i, '')
    .replaceAll('_', ' ')
    .trim();
}

export function candidateApiEndpoints(wikiUrl: URL): URL[] {
  const endpoints = new Map<string, URL>();
  const add = (url: URL) => endpoints.set(url.href, url);
  const base = new URL(wikiUrl.href);
  const pathSegments = base.pathname.split('/').filter(Boolean);
  const finalSegment = pathSegments.at(-1)?.toLowerCase();

  add(new URL('api.php', base));

  if (finalSegment === 'wiki') {
    const sibling = new URL(base.href);
    const prefix = pathSegments.slice(0, -1).join('/');
    sibling.pathname = prefix ? `/${prefix}/w/` : '/w/';
    add(new URL('api.php', sibling));
  }

  const parent = new URL(base.href);
  const parentPath = pathSegments.slice(0, -1).join('/');
  parent.pathname = parentPath ? `/${parentPath}/` : '/';
  add(new URL('api.php', parent));
  add(new URL('/w/api.php', base.origin));
  add(new URL('/api.php', base.origin));

  return [...endpoints.values()];
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function abortError(): DOMException {
  return new DOMException('The operation was stopped.', 'AbortError');
}

export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? abortError());

  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, milliseconds));

    const onAbort = () => {
      globalThis.clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason ?? abortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function retryAfterMilliseconds(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function responseError(response: Response): MediaWikiError {
  return new MediaWikiError(`The wiki returned HTTP ${response.status} ${response.statusText}.`);
}

function apiError(error: ApiError): MediaWikiError {
  const detail = error.info ? `: ${error.info}` : '';
  return new MediaWikiError(`MediaWiki API error ${error.code ?? 'unknown'}${detail}`);
}

export function mapRequestedPages(
  requestedTitles: readonly string[],
  response: ApiResponse,
): RequestedPage[] {
  const query = response.query;
  if (!query?.pages || !Array.isArray(query.pages)) {
    throw new MediaWikiError('The wiki returned an unexpected page response.');
  }

  const aliases = new Map<string, string>();
  for (const mapping of query.normalized ?? []) aliases.set(mapping.from, mapping.to);
  for (const mapping of query.redirects ?? []) aliases.set(mapping.from, mapping.to);

  const resolveTitle = (requestedTitle: string) => {
    let title = requestedTitle;
    const visited = new Set<string>();

    while (aliases.has(title) && !visited.has(title)) {
      visited.add(title);
      title = aliases.get(title) ?? title;
    }

    return title;
  };

  const pages = new Map(query.pages.map((page) => [page.title, page]));

  return requestedTitles.map((requestedTitle) => {
    const resolvedTitle = resolveTitle(requestedTitle);
    const page = pages.get(resolvedTitle);
    const missing = !page || page.missing === true || page.invalid === true;

    return {
      requestedTitle,
      title: page?.title ?? resolvedTitle,
      missing,
      wikitext: missing ? '' : (page.revisions?.[0]?.slots?.main?.content ?? ''),
    };
  });
}

export class MediaWikiClient {
  readonly wikiUrl: URL;

  private readonly fetcher: Fetcher;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly categoryPageDelayMs: number;
  private endpoint: URL | null = null;

  constructor(wikiUrl: string | URL, options: MediaWikiClientOptions = {}) {
    this.wikiUrl = normaliseWikiUrl(wikiUrl.toString());
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.retryAttempts = options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY;
    this.categoryPageDelayMs = options.categoryPageDelayMs ?? CATEGORY_PAGE_DELAY;
  }

  private async probeEndpoint(endpoint: URL, signal: AbortSignal): Promise<boolean> {
    const url = new URL(endpoint.href);
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      meta: 'siteinfo',
      origin: '*',
      siprop: 'general',
    }).toString();

    try {
      const response = await this.fetcher(url, { signal });
      if (!response.ok) return false;
      const data = (await response.json()) as ApiResponse;
      return Boolean(data.query?.general) && !data.error;
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw signal.reason ?? error;
      return false;
    }
  }

  private async getEndpoint(signal: AbortSignal): Promise<URL> {
    if (this.endpoint) return this.endpoint;

    for (const candidate of candidateApiEndpoints(this.wikiUrl)) {
      if (await this.probeEndpoint(candidate, signal)) {
        this.endpoint = candidate;
        return candidate;
      }
    }

    throw new MediaWikiError(
      'No MediaWiki API endpoint could be reached. The wiki may not permit browser requests from this site.',
    );
  }

  private async apiGet(
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<ApiResponse> {
    const endpoint = await this.getEndpoint(signal);
    const url = new URL(endpoint.href);
    url.search = new URLSearchParams({
      ...params,
      format: 'json',
      formatversion: '2',
      maxlag: '5',
      origin: '*',
    }).toString();

    for (let attempt = 0; attempt < this.retryAttempts; attempt += 1) {
      let response: Response;

      try {
        response = await this.fetcher(url, { signal });
      } catch (error) {
        if (isAbortError(error) || signal.aborted) throw signal.reason ?? error;
        if (attempt === this.retryAttempts - 1) {
          throw new MediaWikiError('The wiki could not be reached. Check its URL and CORS policy.');
        }
        await abortableDelay(this.retryDelayMs * 2 ** attempt, signal);
        continue;
      }

      const retryableStatus = response.status === 429 || response.status >= 500;
      if (retryableStatus) {
        if (attempt === this.retryAttempts - 1) throw responseError(response);
        const delay = retryAfterMilliseconds(response) ?? this.retryDelayMs * 2 ** attempt;
        await abortableDelay(delay, signal);
        continue;
      }

      if (!response.ok) throw responseError(response);

      let data: ApiResponse;
      try {
        data = (await response.json()) as ApiResponse;
      } catch {
        throw new MediaWikiError('The wiki returned a response that was not valid JSON.');
      }

      if (data.error) {
        const code = data.error.code;
        const retryableError = code === 'maxlag' || code === 'ratelimited';
        if (retryableError && attempt < this.retryAttempts - 1) {
          await abortableDelay(this.retryDelayMs * 2 ** attempt, signal);
          continue;
        }
        throw apiError(data.error);
      }

      return data;
    }

    throw new MediaWikiError('The wiki request exceeded its retry limit.');
  }

  async getCategorySize(category: string, signal: AbortSignal): Promise<number | null> {
    const data = await this.apiGet(
      {
        action: 'query',
        prop: 'categoryinfo',
        titles: `Category:${category}`,
      },
      signal,
    );

    const categoryPage = data.query?.pages?.[0];
    return categoryPage?.categoryinfo?.size ?? null;
  }

  async getCategoryMembers(
    category: string,
    signal: AbortSignal,
    onProgress?: (loaded: number) => void,
  ): Promise<string[]> {
    const titles: string[] = [];
    let continuation: string | undefined;

    do {
      const params: Record<string, string> = {
        action: 'query',
        cmlimit: 'max',
        cmtitle: `Category:${category}`,
        list: 'categorymembers',
      };
      if (continuation) params.cmcontinue = continuation;

      const data = await this.apiGet(params, signal);
      const members = data.query?.categorymembers;
      if (!Array.isArray(members)) {
        throw new MediaWikiError('The wiki returned an unexpected category response.');
      }

      titles.push(...members.map((member) => member.title));
      onProgress?.(titles.length);
      continuation = data.continue?.cmcontinue;

      if (continuation) await abortableDelay(this.categoryPageDelayMs, signal);
    } while (continuation);

    return titles;
  }

  async getPages(titles: readonly string[], signal: AbortSignal): Promise<RequestedPage[]> {
    if (titles.length === 0) return [];
    if (titles.length > 50) {
      throw new MediaWikiError('A single MediaWiki page request cannot contain more than 50 titles.');
    }

    const data = await this.apiGet(
      {
        action: 'query',
        prop: 'revisions',
        redirects: '1',
        rvprop: 'content',
        rvslots: 'main',
        titles: titles.join('|'),
      },
      signal,
    );

    return mapRequestedPages(titles, data);
  }
}
