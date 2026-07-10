import type {
  AlbumDetail,
  AlbumSummary,
  Lyrics,
  SingerSummary,
  SongSummary,
} from './types';

export interface FormattedOutput {
  formatted: string;
  tsv: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function singersFor(song: SongSummary): SingerSummary[] {
  if (!song.singer) return [];
  return Array.isArray(song.singer) ? song.singer : [song.singer];
}

function singerLabel(singers: SingerSummary[]): string {
  return singers
    .map((singer) => `${text(singer.name)} (${text(singer.mid)})`)
    .join(' / ');
}

export function escapeTsvCell(value: unknown): string {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('\t', '\\t')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\r', '\\n')
    .replaceAll('\n', '\\n');
}

export function formatTrackNumber(song: SongSummary): string {
  if (song.index_cd != null && song.index_album != null) {
    return `${song.index_cd + 1}-${song.index_album}`;
  }
  return String(song.index_cd ?? song.index_album ?? '');
}

export function sortTracks(tracks: SongSummary[]): SongSummary[] {
  return [...tracks].sort((a, b) => {
    const discDifference = (a.index_cd ?? 0) - (b.index_cd ?? 0);
    return discDifference || (a.index_album ?? 0) - (b.index_album ?? 0);
  });
}

export function extractLyric(response: Lyrics | undefined): string {
  return response?.lyric ?? response?.data?.lyric ?? '';
}

export function formatSearchResults(keyword: string, songs: SongSummary[]): FormattedOutput {
  const formatted = [`Search results for "${keyword}":`];
  const tsv = ['name\tmid\talbum\talbumMid\tsingers'];

  songs.forEach((song, index) => {
    const singers = singersFor(song);
    let line = `${index + 1}. ${text(song.name)} (${text(song.mid)})`;
    if (song.album) {
      line += `, ${text(song.album.name)} (${text(song.album.mid)})`;
    }
    if (singers.length) line += `, ${singerLabel(singers)}`;
    formatted.push(line);
    tsv.push([
      song.name,
      song.mid,
      song.album?.name,
      song.album?.mid,
      singers.map((singer) => singer.name).join('/'),
    ].map(escapeTsvCell).join('\t'));
  });

  return { formatted: `${formatted.join('\n')}\n`, tsv: `${tsv.join('\n')}\n` };
}

export function formatSingerAlbums(singerMid: string, albums: AlbumSummary[]): FormattedOutput {
  const sorted = [...albums].sort((a, b) => {
    const dateA = a.time_public || a.publishDate || '';
    const dateB = b.time_public || b.publishDate || '';
    return dateB.localeCompare(dateA);
  });

  if (!sorted.length) {
    return {
      formatted: `No albums found for singer MID "${singerMid}".`,
      tsv: 'name\tmid\tsingerName\tpublishDate\n',
    };
  }

  const formatted = [`Albums of singer ${singerMid}:`];
  const tsv = ['name\tmid\tsingerName\tpublishDate'];

  sorted.forEach((album, index) => {
    const name = album.name || album.albumName || '';
    const mid = album.mid || album.albumMid || '';
    const singers = Array.isArray(album.singer) ? album.singer : [];
    const singerNames = singers.length
      ? singers.map((singer) => text(singer.name)).join('/')
      : text(album.singerName);
    const date = album.time_public || album.publishDate || '';
    let line = `${index + 1}. ${name} (${mid})`;
    if (singers.length) line += `, ${singerLabel(singers)}`;
    else if (album.singerName) line += `, ${album.singerName}`;
    if (date) line += `, ${date}`;
    formatted.push(line);
    tsv.push([name, mid, singerNames, date].map(escapeTsvCell).join('\t'));
  });

  return { formatted: `${formatted.join('\n')}\n`, tsv: `${tsv.join('\n')}\n` };
}

function durationLabel(seconds: number | undefined): string {
  if (!Number.isFinite(seconds)) return '';
  const value = Math.max(0, Math.floor(seconds ?? 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function formatAlbum(detail: AlbumDetail, songs: SongSummary[]): FormattedOutput {
  const info = detail.basicInfo ?? {};
  const company = detail.company ?? {};
  const albumSingers = detail.singer?.singerList ?? [];
  const formatted = [
    `Album: ${text(info.albumName)} (${text(info.albumMid)})`,
    ` - Release date: ${text(info.publishDate)}`,
    ` - Company: ${text(company.name)}`,
    ` - Description: ${text(info.desc)}`,
    ` - Genre: ${text(info.genreNew || info.genre)}`,
  ];

  if (albumSingers.length) formatted.push(` - Singer(s): ${singerLabel(albumSingers)}`);

  const sorted = sortTracks(songs);
  const tsv = ['trackNo\tname\tmid\tsingers\tduration'];
  if (sorted.length) formatted.push(` - Songs (${sorted.length}):`);

  sorted.forEach((song) => {
    const trackNumber = formatTrackNumber(song);
    const singers = singersFor(song);
    const duration = durationLabel(song.interval);
    let line = `   ${trackNumber}. ${text(song.name)} (${text(song.mid)})`;
    if (song.title && song.title !== song.name) line += `, original_title: ${song.title}`;
    if (song.subtitle) line += `, subtitle: ${song.subtitle}`;
    if (singers.length) line += `, singers: ${singerLabel(singers)}`;
    if (duration) line += `, duration: ${duration}`;
    formatted.push(line);
    tsv.push([
      trackNumber,
      song.original_title || song.name,
      song.mid,
      singers.map((singer) => singer.name).join('/'),
      duration,
    ].map(escapeTsvCell).join('\t'));
  });

  return { formatted: `${formatted.join('\n')}\n`, tsv: `${tsv.join('\n')}\n` };
}
