import { describe, expect, it, vi } from 'vitest';
import {
  abortableDelay,
  candidateApiEndpoints,
  mapRequestedPages,
  MediaWikiClient,
  normaliseCategoryName,
  normaliseWikiUrl,
} from '../src/features/infobox-extractor/mediawiki';

describe('MediaWiki URL handling', () => {
  it('accepts only credential-free HTTP(S) URLs and normalises their path', () => {
    expect(normaliseWikiUrl('https://example.test/wiki?old=1#section').href).toBe(
      'https://example.test/wiki/',
    );
    expect(() => normaliseWikiUrl('ftp://example.test/wiki/')).toThrow(/HTTP or HTTPS/);
    expect(() => normaliseWikiUrl('https://name:secret@example.test/wiki/')).toThrow(
      /username or password/,
    );
  });

  it('builds correct candidates for a subdirectory MediaWiki install', () => {
    expect(candidateApiEndpoints(new URL('https://example.test/sub/wiki/')).map(String)).toEqual([
      'https://example.test/sub/wiki/api.php',
      'https://example.test/sub/w/api.php',
      'https://example.test/sub/api.php',
      'https://example.test/w/api.php',
      'https://example.test/api.php',
    ]);
  });

  it('normalises category labels', () => {
    expect(normaliseCategoryName(' Category:Women_in_science ')).toBe('Women in science');
  });
});

describe('MediaWiki page mapping', () => {
  it('follows normalisation and redirect chains while detecting missing pages', () => {
    const pages = mapRequestedPages(['Albert_Einstein', 'Missing_page', 'Absent'], {
      query: {
        normalized: [
          { from: 'Albert_Einstein', to: 'Albert Einstein' },
          { from: 'Missing_page', to: 'Missing page' },
        ],
        redirects: [{ from: 'Albert Einstein', to: 'Albert Einstein (physicist)' }],
        pages: [
          {
            title: 'Albert Einstein (physicist)',
            revisions: [{ slots: { main: { content: '{{Infobox scientist}}' } } }],
          },
          { title: 'Missing page', missing: true },
        ],
      },
    });

    expect(pages).toEqual([
      {
        requestedTitle: 'Albert_Einstein',
        title: 'Albert Einstein (physicist)',
        missing: false,
        wikitext: '{{Infobox scientist}}',
      },
      {
        requestedTitle: 'Missing_page',
        title: 'Missing page',
        missing: true,
        wikitext: '',
      },
      {
        requestedTitle: 'Absent',
        title: 'Absent',
        missing: true,
        wikitext: '',
      },
    ]);
  });

  it('uses the mapped response in the API client', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());

      if (url.searchParams.get('meta') === 'siteinfo') {
        return Response.json({ query: { general: { sitename: 'Example' } } });
      }

      return Response.json({
        query: {
          normalized: [{ from: 'Ada_Lovelace', to: 'Ada Lovelace' }],
          pages: [
            {
              title: 'Ada Lovelace',
              revisions: [{ slots: { main: { content: '{{Infobox person|name=Ada}}' } } }],
            },
          ],
        },
      });
    });
    const client = new MediaWikiClient('https://example.test/wiki/', {
      fetcher,
      retryDelayMs: 0,
    });

    await expect(client.getPages(['Ada_Lovelace'], new AbortController().signal)).resolves.toEqual([
      {
        requestedTitle: 'Ada_Lovelace',
        title: 'Ada Lovelace',
        missing: false,
        wikitext: '{{Infobox person|name=Ada}}',
      },
    ]);
  });

  it('makes retry and pacing delays abortable', async () => {
    const controller = new AbortController();
    const pending = abortableDelay(10_000, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
