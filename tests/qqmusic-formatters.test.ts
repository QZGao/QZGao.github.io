import { describe, expect, it } from 'vitest';
import {
  escapeTsvCell,
  extractLyric,
  formatAlbum,
  formatSearchResults,
  formatSingerAlbums,
} from '../src/features/qqmusic/formatters';

describe('QQ Music output formatters', () => {
  it('formats search results for all three output modes', () => {
    const result = formatSearchResults('meteor', [{
      name: 'A Song',
      mid: 'song-mid',
      album: { name: 'An Album', mid: 'album-mid' },
      singer: [{ name: 'A Singer', mid: 'singer-mid' }],
    }]);

    expect(result.formatted).toContain('1. A Song (song-mid), An Album (album-mid), A Singer (singer-mid)');
    expect(result.tsv).toContain('A Song\tsong-mid\tAn Album\talbum-mid\tA Singer');
  });

  it('sorts singer albums newest first', () => {
    const result = formatSingerAlbums('singer-mid', [
      { name: 'Older', mid: 'older', publishDate: '2020-01-01' },
      { name: 'Newer', mid: 'newer', publishDate: '2024-01-01' },
    ]);

    expect(result.formatted.indexOf('Newer')).toBeLessThan(result.formatted.indexOf('Older'));
  });

  it('sorts album tracks and tolerates missing duration data', () => {
    const result = formatAlbum(
      { basicInfo: { albumName: 'Album', albumMid: 'album-mid' } },
      [
        { name: 'Second', mid: 'two', index_cd: 0, index_album: 2 },
        { name: 'First', mid: 'one', index_cd: 0, index_album: 1, interval: 61 },
      ],
    );

    expect(result.formatted.indexOf('First')).toBeLessThan(result.formatted.indexOf('Second'));
    expect(result.formatted).toContain('duration: 1:01');
    expect(result.formatted).not.toContain('NaN');
  });

  it('reads both supported lyric response shapes and escapes TSV control characters', () => {
    expect(extractLyric({ data: { lyric: 'nested lyric' } })).toBe('nested lyric');
    expect(escapeTsvCell('line 1\nline\t2')).toBe('line 1\\nline\\t2');
  });
});
