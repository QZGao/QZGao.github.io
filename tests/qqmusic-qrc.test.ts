import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { qrcInternals } from '../workers/qqmusic-api/src/qrc';

describe('QQ Music QRC helpers', () => {
  it('inflates zlib data with TripleDES block padding after it', async () => {
    const compressed = deflateSync(Buffer.from('test lyric', 'utf8'));
    const padded = new Uint8Array(compressed.length + 5);
    padded.set(compressed);
    padded.fill(5, compressed.length);

    await expect(qrcInternals.decompressDeflate(padded)).resolves.toBe('test lyric');
  });

  it('rejects malformed hexadecimal ciphertext', () => {
    expect(() => qrcInternals.decodeHex('not-hex')).toThrow('Invalid encrypted QRC payload');
  });
});
