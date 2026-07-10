import type { QQMusicService } from './types';

const MAX_BODY_BYTES = 16_384;
const API_PREFIX = '/api/';

class ValidationError extends Error {}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isAllowedOrigin(origin: string): boolean {
  if (origin === 'https://supergrey.uk') return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

function responseHeaders(origin: string | null): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  });
  if (origin && isAllowedOrigin(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return headers;
}

function json(payload: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(payload), { status, headers });
}

function readString(params: UnknownRecord, key: string, label: string): string {
  const value = params[key];
  if (typeof value !== 'string') throw new ValidationError(`${label} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) {
    throw new ValidationError(`${label} must contain between 1 and 200 characters.`);
  }
  return trimmed;
}

function readMid(params: UnknownRecord, key: string, label: string): string {
  const value = readString(params, key, label);
  if (!/^[\w-]{1,64}$/.test(value)) {
    throw new ValidationError(`${label} contains unsupported characters.`);
  }
  return value;
}

function readInteger(
  params: UnknownRecord,
  key: string,
  label: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const value = params[key] ?? fallback;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ValidationError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

async function readParams(request: Request): Promise<UnknownRecord> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new ValidationError('Content-Type must be application/json.');
  }
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
    throw new ValidationError('Request body is too large.');
  }
  const body: unknown = JSON.parse(bodyText);
  if (!isRecord(body) || !isRecord(body.params)) {
    throw new ValidationError('Request body must contain a params object.');
  }
  return body.params;
}

async function dispatch(endpoint: string, params: UnknownRecord, service: QQMusicService): Promise<unknown> {
  switch (endpoint) {
    case 'getSearchByKey':
      return service.getSearchByKey(
        readString(params, 'key', 'Search keyword'),
        readInteger(params, 'limit', 'Limit', 1, 100, 20),
      );
    case 'getSingerAlbum':
      return service.getSingerAlbum(
        readMid(params, 'singerMid', 'Singer MID'),
        readInteger(params, 'limit', 'Limit', 1, 100, 20),
      );
    case 'getAlbumInfo':
      return service.getAlbumInfo(readMid(params, 'albumMid', 'Album MID'));
    case 'getAlbumSong':
      return service.getAlbumSong(
        readMid(params, 'value', 'Album MID'),
        readInteger(params, 'num', 'Track count', 1, 1_000, 100),
        readInteger(params, 'page', 'Page', 1, 1_000, 1),
      );
    case 'getLyricByMid':
      return service.getLyricByMid(readMid(params, 'songMid', 'Song MID'));
    default:
      throw new ValidationError('Unknown endpoint.');
  }
}

const ENDPOINTS = new Set([
  'getAlbumInfo',
  'getAlbumSong',
  'getLyricByMid',
  'getSearchByKey',
  'getSingerAlbum',
]);

export async function handleQQMusicRequest(request: Request, service: QQMusicService): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const headers = responseHeaders(origin);

  if (!url.pathname.startsWith(API_PREFIX)) {
    return json({ error: 'Not found.' }, 404, headers);
  }
  if (origin && !isAllowedOrigin(origin)) {
    return json({ error: 'Origin is not allowed.' }, 403, headers);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, headers);
  }

  const endpoint = url.pathname.slice(API_PREFIX.length);
  if (!ENDPOINTS.has(endpoint)) {
    return json({ error: 'Not found.' }, 404, headers);
  }

  try {
    const params = await readParams(request);
    const response = await dispatch(endpoint, params, service);
    return json({ response }, 200, headers);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof SyntaxError) {
      return json({ error: error.message || 'Invalid JSON request.' }, 400, headers);
    }
    console.error('QQ Music worker request failed', error);
    return json({ error: 'QQ Music upstream request failed.' }, 502, headers);
  }
}
