import { describe, expect, it, vi } from 'vitest';
import { handleQQMusicRequest } from '../workers/qqmusic-api/src/router';
import type { QQMusicService } from '../workers/qqmusic-api/src/types';

function createService(): QQMusicService {
  return {
    getAlbumInfo: vi.fn(async () => ({ basicInfo: {} })),
    getAlbumSong: vi.fn(async () => []),
    getLyricByMid: vi.fn(async () => ({ lyric: '' })),
    getSearchByKey: vi.fn(async () => []),
    getSingerAlbum: vi.fn(async () => []),
  };
}

function post(endpoint: string, params: Record<string, unknown>, origin = 'https://supergrey.uk'): Request {
  return new Request(`https://worker.example/api/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': origin,
    },
    body: JSON.stringify({ params }),
  });
}

describe('QQ Music Worker router', () => {
  it('maps named parameters without relying on object value order', async () => {
    const service = createService();
    const response = await handleQQMusicRequest(
      post('getSearchByKey', { limit: 3, key: 'meteor' }),
      service,
    );

    expect(response.status).toBe(200);
    expect(service.getSearchByKey).toHaveBeenCalledWith('meteor', 3);
    expect(await response.json()).toEqual({ response: [] });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://supergrey.uk');
  });

  it('rejects APIs outside the five-route whitelist', async () => {
    const response = await handleQQMusicRequest(
      post('ApiRequest', { module: 'arbitrary', method: 'arbitrary' }),
      createService(),
    );

    expect(response.status).toBe(404);
  });

  it('validates identifiers and numeric limits', async () => {
    const invalidMid = await handleQQMusicRequest(
      post('getAlbumInfo', { albumMid: '../not-a-mid' }),
      createService(),
    );
    const invalidLimit = await handleQQMusicRequest(
      post('getSearchByKey', { key: 'valid', limit: 10_000 }),
      createService(),
    );

    expect(invalidMid.status).toBe(400);
    expect(invalidLimit.status).toBe(400);
  });

  it('enforces the request-body limit without relying on content-length', async () => {
    const response = await handleQQMusicRequest(
      post('getSearchByKey', { key: 'x'.repeat(17_000), limit: 3 }),
      createService(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Request body is too large.' });
  });

  it('allows local development but rejects unrelated browser origins', async () => {
    const local = await handleQQMusicRequest(
      post('getLyricByMid', { songMid: 'valid-mid' }, 'http://localhost:4321'),
      createService(),
    );
    const unrelated = await handleQQMusicRequest(
      post('getLyricByMid', { songMid: 'valid-mid' }, 'https://example.com'),
      createService(),
    );

    expect(local.status).toBe(200);
    expect(local.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4321');
    expect(unrelated.status).toBe(403);
    expect(unrelated.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('returns 404 for non-API requests', async () => {
    const response = await handleQQMusicRequest(
      new Request('https://worker.example/'),
      createService(),
    );

    expect(response.status).toBe(404);
  });
});
