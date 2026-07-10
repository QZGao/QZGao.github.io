import TripleDES from './triple-des';

const QRC_KEY = new TextEncoder().encode('!@#)(*$%123ZXC!@!@#)(NHL');

function decodeHex(value: string): Uint8Array {
  const hex = value.replace(/\s+/g, '');
  if (!hex) return new Uint8Array();
  if (hex.length % 2 !== 0 || !/^[\da-f]+$/i.test(hex)) {
    throw new Error('Invalid encrypted QRC payload.');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return bytes;
}

function decryptTripleDes(bytes: Uint8Array): Uint8Array {
  if (bytes.length % 8 !== 0) throw new Error('Invalid encrypted QRC block length.');

  const schedule = [
    Array.from({ length: 16 }, () => new Uint8Array(6)),
    Array.from({ length: 16 }, () => new Uint8Array(6)),
    Array.from({ length: 16 }, () => new Uint8Array(6)),
  ];
  TripleDES.TripleDESKeySetup(QRC_KEY, schedule, TripleDES.DECRYPT);

  const decrypted = new Uint8Array(bytes.length);
  for (let offset = 0; offset < bytes.length; offset += 8) {
    const output = new Uint8Array(8);
    TripleDES.TripleDESCrypt(bytes.subarray(offset, offset + 8), output, schedule);
    decrypted.set(output, offset);
  }
  return decrypted;
}

async function decompressDeflate(bytes: Uint8Array): Promise<string> {
  let lastError: unknown;

  // QRC's TripleDES payload can contain up to seven trailing padding bytes.
  // DecompressionStream rejects trailing data, so try each legal block padding length.
  for (let trim = 0; trim <= 7 && trim < bytes.length; trim += 1) {
    try {
      const candidate = bytes.slice(0, bytes.length - trim);
      const stream = new Response(candidate).body;
      if (!stream) throw new Error('Unable to create a QRC decompression stream.');
      const decompressed = stream.pipeThrough(new DecompressionStream('deflate'));
      return await new Response(decompressed).text();
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Unable to inflate QRC lyrics: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
}

export async function decryptQrc(encryptedQrc: unknown): Promise<string> {
  if (typeof encryptedQrc !== 'string' || !encryptedQrc) return '';
  return decompressDeflate(decryptTripleDes(decodeHex(encryptedQrc)));
}

export const qrcInternals = { decodeHex, decompressDeflate };
