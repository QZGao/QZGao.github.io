export interface QQMusicService {
  getAlbumInfo(albumMid: string): Promise<unknown>;
  getAlbumSong(albumMid: string, num: number, page: number): Promise<unknown[]>;
  getLyricByMid(songMid: string): Promise<unknown>;
  getSearchByKey(keyword: string, limit: number): Promise<unknown[]>;
  getSingerAlbum(singerMid: string, limit: number): Promise<unknown[]>;
}
