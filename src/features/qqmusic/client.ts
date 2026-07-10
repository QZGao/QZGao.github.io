import type {
  ApiEnvelope,
  QQMusicEndpoint,
  QQMusicEndpointMap,
} from './types';

export const DEFAULT_QQMUSIC_API_BASE = 'https://qqmusic-api-worker.gaoqz-cs.workers.dev';

const configuredApiBase = import.meta.env.PUBLIC_QQMUSIC_API_BASE?.trim();

export const QQMUSIC_API_BASE = (
  configuredApiBase || DEFAULT_QQMUSIC_API_BASE
).replace(/\/$/, '');

interface ErrorPayload {
  error?: string;
}

export class QQMusicApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'QQMusicApiError';
    this.status = status;
  }
}

export class QQMusicClient {
  readonly baseUrl: string;

  constructor(baseUrl = QQMUSIC_API_BASE) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async query<E extends QQMusicEndpoint>(
    endpoint: E,
    params: QQMusicEndpointMap[E]['params'],
    signal?: AbortSignal,
  ): Promise<ApiEnvelope<QQMusicEndpointMap[E]['response']>> {
    const response = await fetch(`${this.baseUrl}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params }),
      signal,
    });

    if (!response.ok) {
      let message = `QQ Music request failed (${response.status})`;
      try {
        const payload = (await response.json()) as ErrorPayload;
        if (payload.error) message = payload.error;
      } catch {
        // Keep the status-based fallback when the response is not JSON.
      }
      throw new QQMusicApiError(message, response.status);
    }

    return response.json() as Promise<ApiEnvelope<QQMusicEndpointMap[E]['response']>>;
  }
}
