export interface SingerSummary {
  mid?: string;
  name?: string;
}

export interface AlbumReference {
  mid?: string;
  name?: string;
}

export interface SongSummary {
  album?: AlbumReference;
  index_album?: number;
  index_cd?: number;
  interval?: number;
  mid?: string;
  name?: string;
  original_title?: string;
  singer?: SingerSummary | SingerSummary[];
  songmid?: string;
  songname?: string;
  subtitle?: string;
  title?: string;
}

export interface AlbumSummary {
  albumMid?: string;
  albumName?: string;
  mid?: string;
  name?: string;
  publishDate?: string;
  singer?: SingerSummary[];
  singerName?: string;
  time_public?: string;
}

export interface AlbumDetail {
  basicInfo?: {
    albumMid?: string;
    albumName?: string;
    desc?: string;
    genre?: string;
    genreNew?: string;
    publishDate?: string;
  };
  company?: {
    name?: string;
  };
  list?: SongSummary[];
  singer?: {
    singerList?: SingerSummary[];
  };
}

export interface Lyrics {
  data?: Lyrics;
  lyric?: string;
  roma?: string;
  trans?: string;
}

export interface ApiEnvelope<T> {
  response: T;
}

export interface QQMusicEndpointMap {
  getAlbumInfo: {
    params: { albumMid: string };
    response: AlbumDetail;
  };
  getAlbumSong: {
    params: { value: string; num: number; page: number };
    response: SongSummary[];
  };
  getLyricByMid: {
    params: { songMid: string };
    response: Lyrics;
  };
  getSearchByKey: {
    params: { key: string; limit: number };
    response: SongSummary[];
  };
  getSingerAlbum: {
    params: { singerMid: string; limit: number };
    response: AlbumSummary[];
  };
}

export type QQMusicEndpoint = keyof QQMusicEndpointMap;
