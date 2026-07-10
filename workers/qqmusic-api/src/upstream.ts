import { decryptQrc } from './qrc';
import type { QQMusicService } from './types';

const MUSIC_API_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function getSearchId(): string {
  const multiplier = BigInt(Math.floor(Math.random() * 20) + 1);
  const high = multiplier * 18_014_398_509_481_984n;
  const low = BigInt(Math.floor(Math.random() * 4_194_305)) * 4_294_967_296n;
  const now = new Date();
  const milliseconds = (
    now.getHours() * 3_600_000
    + now.getMinutes() * 60_000
    + now.getSeconds() * 1_000
    + now.getMilliseconds()
  );
  return String(high + low + BigInt(milliseconds));
}

export class QQMusicUpstreamError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = 'QQMusicUpstreamError';
    this.code = code;
  }
}

export class QQMusicUpstream implements QQMusicService {
  readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  private async request(
    module: string,
    method: string,
    params: UnknownRecord,
    acceptedCodes: number[] = [],
  ): Promise<unknown> {
    const key = `${module}.${method}`;
    const fetcher = this.fetcher;
    const response = await fetcher(MUSIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 Chrome/116 Safari/537.36',
      },
      body: JSON.stringify({
        comm: {
          ct: '11',
          format: 'json',
          inCharset: 'utf-8',
          outCharset: 'utf-8',
          tmeAppID: 'qqmusic',
          uid: '3931641530',
        },
        [key]: { module, method, param: params },
      }),
    });

    if (!response.ok) {
      throw new QQMusicUpstreamError(`QQ Music returned HTTP ${response.status}.`);
    }

    const payload = asRecord(await response.json());
    const requestData = asRecord(payload[key] ?? payload);
    const parsedCode = Number(requestData.code ?? 0);
    const code = Number.isFinite(parsedCode) ? parsedCode : 0;
    if (code !== 0 && !acceptedCodes.includes(code)) {
      throw new QQMusicUpstreamError(`QQ Music returned API code ${code}.`, code);
    }
    return requestData.data || requestData;
  }

  async getSearchByKey(keyword: string, limit: number): Promise<unknown[]> {
    const result = asRecord(await this.request(
      'music.search.SearchCgiService',
      'DoSearchForQQMusicMobile',
      {
        grp: 1,
        highlight: true,
        num_per_page: limit,
        page_num: 1,
        query: keyword,
        search_type: 0,
        searchid: getSearchId(),
      },
      [104400],
    ));
    const body = asRecord(result.body);
    return Array.isArray(body.item_song) ? body.item_song : [];
  }

  private async getSingerAlbumPage(singerMid: string, number: number, begin: number): Promise<UnknownRecord> {
    return asRecord(await this.request(
      'music.musichallAlbum.AlbumListServer',
      'GetAlbumList',
      { singerMid, order: 1, number, begin },
    ));
  }

  async getSingerAlbum(singerMid: string, limit: number): Promise<unknown[]> {
    try {
      const albums: unknown[] = [];
      let total = limit;

      while (albums.length < Math.min(limit, total)) {
        const pageSize = Math.min(30, limit - albums.length);
        const page = await this.getSingerAlbumPage(singerMid, pageSize, albums.length);
        const pageAlbums = Array.isArray(page.albumList) ? page.albumList : [];
        total = typeof page.total === 'number' ? page.total : pageAlbums.length;
        albums.push(...pageAlbums);
        if (!pageAlbums.length) break;
      }

      return albums.slice(0, limit);
    } catch (error) {
      if (error instanceof QQMusicUpstreamError && error.code === 104400) return [];
      throw error;
    }
  }

  async getAlbumInfo(albumMid: string): Promise<unknown> {
    return this.request(
      'music.musichallAlbum.AlbumInfoServer',
      'GetAlbumDetail',
      { albumMId: albumMid },
    );
  }

  async getAlbumSong(albumMid: string, num: number, page: number): Promise<unknown[]> {
    const result = asRecord(await this.request(
      'music.musichallAlbum.AlbumSongList',
      'GetAlbumSongList',
      { albumMid, begin: num * (page - 1), num },
    ));
    if (!Array.isArray(result.songList)) return [];
    return result.songList.map((entry) => asRecord(entry).songInfo).filter(Boolean);
  }

  async getLyricByMid(songMid: string): Promise<unknown> {
    try {
      const result = asRecord(await this.request(
        'music.musichallSong.PlayLyricInfo',
        'GetPlayLyricInfo',
        {
          crypt: 1,
          ct: 11,
          cv: 13020508,
          lrc_t: 0,
          qrc: 0,
          qrc_t: 0,
          roma: 0,
          roma_t: 0,
          songMid,
          trans: 0,
          trans_t: 0,
          type: 1,
        },
      ));
      return {
        lyric: await decryptQrc(result.lyric),
        roma: await decryptQrc(result.roma),
        trans: await decryptQrc(result.trans),
      };
    } catch (error) {
      if (error instanceof QQMusicUpstreamError && error.code === 24001) return {};
      throw error;
    }
  }
}

export const qqMusicUpstream = new QQMusicUpstream();
