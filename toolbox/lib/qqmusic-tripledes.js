// Translated from: https://github.com/WXRIW/QQMusicDecoder/blob/0837a3a1281e58f6db3e3e1dcb1d5441fb0ac268/QQMusicDecoder/DESHelper.cs

const DESHelper = {
  // Constants
  ENCRYPT: 1,
  DECRYPT: 0,

  // Private helper: BITNUM(byte[] a, int b, int c)
  BITNUM: function(a, b, c) {
    // (uint)((a[(b) / 32 * 4 + 3 - (b) % 32 / 8] >> (7 - (b % 8))) & 0x01) << (c)
    const index = Math.floor(b / 32) * 4 + 3 - Math.floor((b % 32) / 8);
    const bit  = ( (a[index] >> (7 - (b % 8))) & 0x01 );
    return (bit << c) >>> 0;
  },

  // Private helper: BITNUMINTR(uint a, int b, int c)
  BITNUMINTR: function(a, b, c) {
    // (byte)((((a) >> (31 - (b))) & 0x00000001) << (c))
    const bit = ((a >>> (31 - b)) & 0x00000001) << c;
    return bit & 0xFF;
  },

  // Private helper: BITNUMINTL(uint a, int b, int c)
  BITNUMINTL: function(a, b, c) {
    // ((((a) << (b)) & 0x80000000) >> (c))
    const shifted = ((a << b) & 0x80000000) >>> c;
    return shifted >>> 0;
  },

  // Private helper: SBOXBIT(byte a)
  SBOXBIT: function(a) {
    // (uint)(((a) & 0x20) | (((a) & 0x1f) >> 1) | (((a) & 0x01) << 4))
    return ( ((a & 0x20) | ((a & 0x1f) >> 1) | ((a & 0x01) << 4)) >>> 0 );
  },

  // S-box tables (readonly byte[] in C#)
  sbox1: [
    14,  4,  13,  1,   2, 15,  11,  8,   3, 10,   6, 12,   5,  9,   0,  7,
     0, 15,   7,  4,  14,  2,  13,  1,  10,  6,  12, 11,   9,  5,   3,  8,
     4,  1,  14,  8,  13,  6,   2, 11,  15, 12,   9,  7,   3, 10,   5,  0,
    15, 12,   8,  2,   4,  9,   1,  7,   5, 11,   3, 14,  10,  0,   6, 13
  ],

  sbox2: [
    15,  1,   8, 14,   6, 11,   3,  4,   9,  7,   2, 13,  12,  0,   5, 10,
     3, 13,   4,  7,  15,  2,   8, 15,  12,  0,   1, 10,   6,  9,  11,  5,
     0, 14,   7, 11,  10,  4,  13,  1,   5,  8,  12,  6,   9,  3,   2, 15,
    13,  8,  10,  1,   3, 15,   4,  2,  11,  6,   7, 12,   0,  5,  14,  9
  ],

  sbox3: [
    10,  0,   9, 14,   6,  3,  15,  5,   1, 13,  12,  7,  11,  4,   2,  8,
    13,  7,   0,  9,   3,  4,   6, 10,   2,  8,   5, 14,  12, 11,  15,  1,
    13,  6,   4,  9,   8, 15,   3,  0,  11,  1,   2, 12,   5, 10,  14,  7,
     1, 10,  13,  0,   6,  9,   8,  7,   4, 15,  14,  3,  11,  5,   2, 12
  ],

  sbox4: [
     7, 13,  14,  3,   0,  6,   9, 10,   1,  2,   8,  5,  11, 12,   4, 15,
    13,  8,  11,  5,   6, 15,   0,  3,   4,  7,   2, 12,   1, 10,  14,  9,
    10,  6,   9,  0,  12, 11,   7, 13,  15,  1,   3, 14,   5,  2,   8,  4,
     3, 15,   0,  6,  10, 10,  13,  8,   9,  4,   5, 11,  12,  7,   2, 14
  ],

  sbox5: [
     2, 12,   4,  1,   7, 10,  11,  6,   8,  5,   3, 15,  13,  0,  14,  9,
    14, 11,   2, 12,   4,  7,  13,  1,   5,  0,  15, 10,   3,  9,   8,  6,
     4,  2,   1, 11,  10, 13,   7,  8,  15,  9,  12,  5,   6,  3,   0, 14,
    11,  8,  12,  7,   1, 14,   2, 13,   6, 15,   0,  9,  10,  4,   5,  3
  ],

  sbox6: [
    12,  1,  10, 15,   9,  2,   6,  8,   0, 13,   3,  4,  14,  7,   5, 11,
    10, 15,   4,  2,   7, 12,   9,  5,   6,  1,  13, 14,   0, 11,   3,  8,
     9, 14,  15,  5,   2,  8,  12,  3,   7,  0,   4, 10,   1, 13,  11,  6,
     4,  3,   2, 12,   9,  5,  15, 10,  11, 14,   1,  7,   6,  0,   8, 13
  ],

  sbox7: [
     4, 11,   2, 14,  15,  0,   8, 13,   3, 12,   9,  7,   5, 10,   6,  1,
    13,  0,  11,  7,   4,  9,   1, 10,  14,  3,   5, 12,   2, 15,   8,  6,
     1,  4,  11, 13,  12,  3,   7, 14,  10, 15,   6,  8,   0,  5,   9,  2,
     6, 11,  13,  8,   1,  4,  10,  7,   9,  5,   0, 15,  14,  2,   3, 12
  ],

  sbox8: [
    13,  2,   8,  4,   6, 15,  11,  1,  10,  9,   3, 14,   5,  0,  12,  7,
     1, 15,  13,  8,  10,  3,   7,  4,  12,  5,   6, 11,   0, 14,   9,  2,
     7, 11,   4,  1,   9, 12,  14,  2,   0,  6,  10, 13,  15,  3,   5,  8,
     2,  1,  14,  7,   4, 10,   8, 13,  15, 12,   9,  0,   3,  5,   6, 11
  ],

  // Public method: KeySchedule(byte[] key, byte[][] schedule, uint mode)
  KeySchedule: function(key, schedule, mode) {
    // uint i, j, toGen, C, D;
    // uint[] key_rnd_shift = { 1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1 };
    // uint[] key_perm_c = { 56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17,
    //   9,1,58,50,42,34,26,18,10,2,59,51,43,35 };
    // uint[] key_perm_d = { 62,54,46,38,30,22,14,6,61,53,45,37,29,21,
    //   13,5,60,52,44,36,28,20,12,4,27,19,11,3 };
    // uint[] key_compression = { 13,16,10,23,0,4,2,27,14,5,20,9,
    //   22,18,11,3,25,7,15,6,26,19,12,1,
    //   40,51,30,36,46,54,29,39,50,44,32,47,
    //   43,48,38,55,33,52,45,41,49,35,28,31 };

    const key_rnd_shift = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
    const key_perm_c    = [56,48,40,32,24,16,8,0,57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35];
    const key_perm_d    = [62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,60,52,44,36,28,20,12,4,27,19,11,3];
    const key_compression = [
      13,16,10,23,0,4,2,27,14,5,20,9,
      22,18,11,3,25,7,15,6,26,19,12,1,
      40,51,30,36,46,54,29,39,50,44,32,47,
      43,48,38,55,33,52,45,41,49,35,28,31
    ];

    let C = 0 >>> 0;
    let D = 0 >>> 0;

    // for (i = 0, j = 31, C = 0; i < 28; ++i, --j)
    //   C |= BITNUM(key, (int)key_perm_c[i], (int)j);
    for (let i = 0, j = 31; i < 28; i++, j--) {
      C = (C | DESHelper.BITNUM(key, key_perm_c[i], j)) >>> 0;
    }

    // for (i = 0, j = 31, D = 0; i < 28; ++i, --j)
    //   D |= BITNUM(key, (int)key_perm_d[i], (int)j);
    for (let i = 0, j = 31; i < 28; i++, j--) {
      D = (D | DESHelper.BITNUM(key, key_perm_d[i], j)) >>> 0;
    }

    // for (i = 0; i < 16; ++i)
    for (let i = 0; i < 16; i++) {
      // C = ((C << (int)key_rnd_shift[i]) | (C >> (28 - (int)key_rnd_shift[i]))) & 0xfffffff0;
      C = ( ((C << key_rnd_shift[i]) | (C >>> (28 - key_rnd_shift[i]))) & 0xfffffff0 ) >>> 0;
      // D = ((D << (int)key_rnd_shift[i]) | (D >> (28 - (int)key_rnd_shift[i]))) & 0xfffffff0;
      D = ( ((D << key_rnd_shift[i]) | (D >>> (28 - key_rnd_shift[i]))) & 0xfffffff0 ) >>> 0;

      // if (mode == DECRYPT)
      //   toGen = 15 - i;
      // else
      //   toGen = i;
      let toGen;
      if (mode === DESHelper.DECRYPT) {
        toGen = 15 - i;
      } else {
        toGen = i;
      }

      // for (j = 0; j < 6; ++j)
      //   schedule[toGen][j] = 0;
      for (let j = 0; j < 6; j++) {
        schedule[toGen][j] = 0;
      }

      // for (j = 0; j < 24; ++j)
      //   schedule[toGen][j / 8] |= BITNUMINTR(C, (int)key_compression[j], (int)(7 - (j % 8)));
      let j = 0;
      for (; j < 24; j++) {
        const byteIndex = Math.floor(j / 8);
        schedule[toGen][byteIndex] = ( schedule[toGen][byteIndex] |
          DESHelper.BITNUMINTR(C, key_compression[j], (7 - (j % 8))) ) & 0xFF;
      }

      // for (; j < 48; ++j)
      //   schedule[toGen][j / 8] |= BITNUMINTR(D, (int)key_compression[j] - 27, (int)(7 - (j % 8)));
      for (; j < 48; j++) {
        const byteIndex = Math.floor(j / 8);
        schedule[toGen][byteIndex] = ( schedule[toGen][byteIndex] |
          DESHelper.BITNUMINTR(D, key_compression[j] - 27, (7 - (j % 8))) ) & 0xFF;
      }
    }
  },

  // Private method: IP(uint[] state, byte[] input)
  IP: function(state, input) {
    // state[0] = BITNUM(input, 57, 31) | BITNUM(input, 49, 30) | ... | BITNUM(input, 7, 0);
    state[0] =
      DESHelper.BITNUM(input, 57, 31) | DESHelper.BITNUM(input, 49, 30) |
      DESHelper.BITNUM(input, 41, 29) | DESHelper.BITNUM(input, 33, 28) |
      DESHelper.BITNUM(input, 25, 27) | DESHelper.BITNUM(input, 17, 26) |
      DESHelper.BITNUM(input, 9, 25)  | DESHelper.BITNUM(input, 1, 24)  |
      DESHelper.BITNUM(input, 59, 23) | DESHelper.BITNUM(input, 51, 22) |
      DESHelper.BITNUM(input, 43, 21) | DESHelper.BITNUM(input, 35, 20) |
      DESHelper.BITNUM(input, 27, 19) | DESHelper.BITNUM(input, 19, 18) |
      DESHelper.BITNUM(input, 11, 17) | DESHelper.BITNUM(input, 3, 16)  |
      DESHelper.BITNUM(input, 61, 15) | DESHelper.BITNUM(input, 53, 14) |
      DESHelper.BITNUM(input, 45, 13) | DESHelper.BITNUM(input, 37, 12) |
      DESHelper.BITNUM(input, 29, 11) | DESHelper.BITNUM(input, 21, 10) |
      DESHelper.BITNUM(input, 13, 9)  | DESHelper.BITNUM(input, 5, 8)   |
      DESHelper.BITNUM(input, 63, 7)  | DESHelper.BITNUM(input, 55, 6)  |
      DESHelper.BITNUM(input, 47, 5)  | DESHelper.BITNUM(input, 39, 4)  |
      DESHelper.BITNUM(input, 31, 3)  | DESHelper.BITNUM(input, 23, 2)  |
      DESHelper.BITNUM(input, 15, 1)  | DESHelper.BITNUM(input, 7, 0);

    // state[1] = BITNUM(input, 56, 31) | BITNUM(input, 48, 30) | ... | BITNUM(input, 6, 0);
    state[1] =
      DESHelper.BITNUM(input, 56, 31) | DESHelper.BITNUM(input, 48, 30) |
      DESHelper.BITNUM(input, 40, 29) | DESHelper.BITNUM(input, 32, 28) |
      DESHelper.BITNUM(input, 24, 27) | DESHelper.BITNUM(input, 16, 26) |
      DESHelper.BITNUM(input, 8, 25)  | DESHelper.BITNUM(input, 0, 24)  |
      DESHelper.BITNUM(input, 58, 23) | DESHelper.BITNUM(input, 50, 22) |
      DESHelper.BITNUM(input, 42, 21) | DESHelper.BITNUM(input, 34, 20) |
      DESHelper.BITNUM(input, 26, 19) | DESHelper.BITNUM(input, 18, 18) |
      DESHelper.BITNUM(input, 10, 17) | DESHelper.BITNUM(input, 2, 16)  |
      DESHelper.BITNUM(input, 60, 15) | DESHelper.BITNUM(input, 52, 14) |
      DESHelper.BITNUM(input, 44, 13) | DESHelper.BITNUM(input, 36, 12) |
      DESHelper.BITNUM(input, 28, 11) | DESHelper.BITNUM(input, 20, 10) |
      DESHelper.BITNUM(input, 12, 9)  | DESHelper.BITNUM(input, 4, 8)   |
      DESHelper.BITNUM(input, 62, 7)  | DESHelper.BITNUM(input, 54, 6)  |
      DESHelper.BITNUM(input, 46, 5)  | DESHelper.BITNUM(input, 38, 4)  |
      DESHelper.BITNUM(input, 30, 3)  | DESHelper.BITNUM(input, 22, 2)  |
      DESHelper.BITNUM(input, 14, 1)  | DESHelper.BITNUM(input, 6, 0);
  },

  // Private method: InvIP(uint[] state, byte[] input)
  InvIP: function(state, input) {
    // input[3] = (byte)(BITNUMINTR(state[1], 7, 7) | BITNUMINTR(state[0], 7, 6) | ... | BITNUMINTR(state[0], 31, 0));
    input[3] = (
      DESHelper.BITNUMINTR(state[1], 7, 7) | DESHelper.BITNUMINTR(state[0], 7, 6) |
      DESHelper.BITNUMINTR(state[1], 15, 5) | DESHelper.BITNUMINTR(state[0], 15, 4) |
      DESHelper.BITNUMINTR(state[1], 23, 3) | DESHelper.BITNUMINTR(state[0], 23, 2) |
      DESHelper.BITNUMINTR(state[1], 31, 1) | DESHelper.BITNUMINTR(state[0], 31, 0)
    ) & 0xFF;

    // input[2] = (byte)(BITNUMINTR(state[1], 6, 7) | BITNUMINTR(state[0], 6, 6) | ... | BITNUMINTR(state[0], 30, 0));
    input[2] = (
      DESHelper.BITNUMINTR(state[1], 6, 7) | DESHelper.BITNUMINTR(state[0], 6, 6) |
      DESHelper.BITNUMINTR(state[1], 14, 5) | DESHelper.BITNUMINTR(state[0], 14, 4) |
      DESHelper.BITNUMINTR(state[1], 22, 3) | DESHelper.BITNUMINTR(state[0], 22, 2) |
      DESHelper.BITNUMINTR(state[1], 30, 1) | DESHelper.BITNUMINTR(state[0], 30, 0)
    ) & 0xFF;

    // input[1] = (byte)(BITNUMINTR(state[1], 5, 7) | BITNUMINTR(state[0], 5, 6) | ... | BITNUMINTR(state[0], 29, 0));
    input[1] = (
      DESHelper.BITNUMINTR(state[1], 5, 7) | DESHelper.BITNUMINTR(state[0], 5, 6) |
      DESHelper.BITNUMINTR(state[1], 13, 5) | DESHelper.BITNUMINTR(state[0], 13, 4) |
      DESHelper.BITNUMINTR(state[1], 21, 3) | DESHelper.BITNUMINTR(state[0], 21, 2) |
      DESHelper.BITNUMINTR(state[1], 29, 1) | DESHelper.BITNUMINTR(state[0], 29, 0)
    ) & 0xFF;

    // input[0] = (byte)(BITNUMINTR(state[1], 4, 7) | BITNUMINTR(state[0], 4, 6) | ... | BITNUMINTR(state[0], 28, 0));
    input[0] = (
      DESHelper.BITNUMINTR(state[1], 4, 7) | DESHelper.BITNUMINTR(state[0], 4, 6) |
      DESHelper.BITNUMINTR(state[1], 12, 5) | DESHelper.BITNUMINTR(state[0], 12, 4) |
      DESHelper.BITNUMINTR(state[1], 20, 3) | DESHelper.BITNUMINTR(state[0], 20, 2) |
      DESHelper.BITNUMINTR(state[1], 28, 1) | DESHelper.BITNUMINTR(state[0], 28, 0)
    ) & 0xFF;

    // input[7] = (byte)(BITNUMINTR(state[1], 3, 7) | BITNUMINTR(state[0], 3, 6) | ... | BITNUMINTR(state[0], 27, 0));
    input[7] = (
      DESHelper.BITNUMINTR(state[1], 3, 7) | DESHelper.BITNUMINTR(state[0], 3, 6) |
      DESHelper.BITNUMINTR(state[1], 11, 5) | DESHelper.BITNUMINTR(state[0], 11, 4) |
      DESHelper.BITNUMINTR(state[1], 19, 3) | DESHelper.BITNUMINTR(state[0], 19, 2) |
      DESHelper.BITNUMINTR(state[1], 27, 1) | DESHelper.BITNUMINTR(state[0], 27, 0)
    ) & 0xFF;

    // input[6] = (byte)(BITNUMINTR(state[1], 2, 7) | BITNUMINTR(state[0], 2, 6) | ... | BITNUMINTR(state[0], 26, 0));
    input[6] = (
      DESHelper.BITNUMINTR(state[1], 2, 7) | DESHelper.BITNUMINTR(state[0], 2, 6) |
      DESHelper.BITNUMINTR(state[1], 10, 5) | DESHelper.BITNUMINTR(state[0], 10, 4) |
      DESHelper.BITNUMINTR(state[1], 18, 3) | DESHelper.BITNUMINTR(state[0], 18, 2) |
      DESHelper.BITNUMINTR(state[1], 26, 1) | DESHelper.BITNUMINTR(state[0], 26, 0)
    ) & 0xFF;

    // input[5] = (byte)(BITNUMINTR(state[1], 1, 7) | BITNUMINTR(state[0], 1, 6) | ... | BITNUMINTR(state[0], 25, 0));
    input[5] = (
      DESHelper.BITNUMINTR(state[1], 1, 7) | DESHelper.BITNUMINTR(state[0], 1, 6) |
      DESHelper.BITNUMINTR(state[1], 9, 5) | DESHelper.BITNUMINTR(state[0], 9, 4) |
      DESHelper.BITNUMINTR(state[1], 17, 3) | DESHelper.BITNUMINTR(state[0], 17, 2) |
      DESHelper.BITNUMINTR(state[1], 25, 1) | DESHelper.BITNUMINTR(state[0], 25, 0)
    ) & 0xFF;

    // input[4] = (byte)(BITNUMINTR(state[1], 0, 7) | BITNUMINTR(state[0], 0, 6) | ... | BITNUMINTR(state[0], 24, 0));
    input[4] = (
      DESHelper.BITNUMINTR(state[1], 0, 7) | DESHelper.BITNUMINTR(state[0], 0, 6) |
      DESHelper.BITNUMINTR(state[1], 8, 5) | DESHelper.BITNUMINTR(state[0], 8, 4) |
      DESHelper.BITNUMINTR(state[1], 16, 3) | DESHelper.BITNUMINTR(state[0], 16, 2) |
      DESHelper.BITNUMINTR(state[1], 24, 1) | DESHelper.BITNUMINTR(state[0], 24, 0)
    ) & 0xFF;
  },

  // Private method: F(uint state, byte[] key)
  F: function(state, key) {
    // byte[] lrgstate = new byte[6];
    const lrgstate = new Uint8Array(6);
    let t1 = 0 >>> 0;
    let t2 = 0 >>> 0;

    // t1 = BITNUMINTL(state, 31, 0) | ((state & 0xf0000000) >> 1) | BITNUMINTL(state, 4, 5) |
    //   BITNUMINTL(state, 3, 6) | ((state & 0x0f000000) >> 3) | BITNUMINTL(state, 8, 11) |
    //   BITNUMINTL(state, 7, 12) | ((state & 0x00f00000) >> 5) | BITNUMINTL(state, 12, 17) |
    //   BITNUMINTL(state, 11, 18) | ((state & 0x000f0000) >> 7) | BITNUMINTL(state, 16, 23);
    t1 =
      DESHelper.BITNUMINTL(state, 31, 0) |
      ((state & 0xf0000000) >>> 1) |
      DESHelper.BITNUMINTL(state, 4, 5) |
      DESHelper.BITNUMINTL(state, 3, 6) |
      ((state & 0x0f000000) >>> 3) |
      DESHelper.BITNUMINTL(state, 8, 11) |
      DESHelper.BITNUMINTL(state, 7, 12) |
      ((state & 0x00f00000) >>> 5) |
      DESHelper.BITNUMINTL(state, 12, 17) |
      DESHelper.BITNUMINTL(state, 11, 18) |
      ((state & 0x000f0000) >>> 7) |
      DESHelper.BITNUMINTL(state, 16, 23);

    // t2 = BITNUMINTL(state, 15, 0) | ((state & 0x0000f000) << 15) | BITNUMINTL(state, 20, 5) |
    //   BITNUMINTL(state, 19, 6) | ((state & 0x00000f00) << 13) | BITNUMINTL(state, 24, 11) |
    //   BITNUMINTL(state, 23, 12) | ((state & 0x000000f0) << 11) | BITNUMINTL(state, 28, 17) |
    //   BITNUMINTL(state, 27, 18) | ((state & 0x0000000f) << 9) | BITNUMINTL(state, 0, 23);
    t2 =
      DESHelper.BITNUMINTL(state, 15, 0) |
      ((state & 0x0000f000) << 15) |
      DESHelper.BITNUMINTL(state, 20, 5) |
      DESHelper.BITNUMINTL(state, 19, 6) |
      ((state & 0x00000f00) << 13) |
      DESHelper.BITNUMINTL(state, 24, 11) |
      DESHelper.BITNUMINTL(state, 23, 12) |
      ((state & 0x000000f0) << 11) |
      DESHelper.BITNUMINTL(state, 28, 17) |
      DESHelper.BITNUMINTL(state, 27, 18) |
      ((state & 0x0000000f) << 9) |
      DESHelper.BITNUMINTL(state, 0, 23);

    // lrgstate[0] = (byte)((t1 >> 24) & 0x000000ff);
    // lrgstate[1] = (byte)((t1 >> 16) & 0x000000ff);
    // lrgstate[2] = (byte)((t1 >> 8) & 0x000000ff);
    // lrgstate[3] = (byte)((t2 >> 24) & 0x000000ff);
    // lrgstate[4] = (byte)((t2 >> 16) & 0x000000ff);
    // lrgstate[5] = (byte)((t2 >> 8) & 0x000000ff);
    lrgstate[0] = ( (t1 >>> 24) & 0x000000ff );
    lrgstate[1] = ( (t1 >>> 16) & 0x000000ff );
    lrgstate[2] = ( (t1 >>> 8)  & 0x000000ff );
    lrgstate[3] = ( (t2 >>> 24) & 0x000000ff );
    lrgstate[4] = ( (t2 >>> 16) & 0x000000ff );
    lrgstate[5] = ( (t2 >>> 8)  & 0x000000ff );

    // XOR with key
    // lrgstate[0] ^= key[0]; ... lrgstate[5] ^= key[5];
    lrgstate[0] = (lrgstate[0] ^ key[0]) & 0xFF;
    lrgstate[1] = (lrgstate[1] ^ key[1]) & 0xFF;
    lrgstate[2] = (lrgstate[2] ^ key[2]) & 0xFF;
    lrgstate[3] = (lrgstate[3] ^ key[3]) & 0xFF;
    lrgstate[4] = (lrgstate[4] ^ key[4]) & 0xFF;
    lrgstate[5] = (lrgstate[5] ^ key[5]) & 0xFF;

    // state = (uint)((sbox1[SBOXBIT((byte)(lrgstate[0] >> 2))] << 28) |
    //   (sbox2[SBOXBIT((byte)(((lrgstate[0] & 0x03) << 4) | (lrgstate[1] >> 4)))] << 24) |
    //   (sbox3[SBOXBIT((byte)(((lrgstate[1] & 0x0f) << 2) | (lrgstate[2] >> 6)))] << 20) |
    //   (sbox4[SBOXBIT((byte)(lrgstate[2] & 0x3f))] << 16) |
    //   (sbox5[SBOXBIT((byte)(lrgstate[3] >> 2))] << 12) |
    //   (sbox6[SBOXBIT((byte)(((lrgstate[3] & 0x03) << 4) | (lrgstate[4] >> 4)))] << 8) |
    //   (sbox7[SBOXBIT((byte)(((lrgstate[4] & 0x0f) << 2) | (lrgstate[5] >> 6)))] << 4) |
    //   sbox8[SBOXBIT((byte)(lrgstate[5] & 0x3f))]);
    state = (
      (DESHelper.sbox1[DESHelper.SBOXBIT((lrgstate[0] >>> 2) & 0xFF)] << 28) |
      (DESHelper.sbox2[DESHelper.SBOXBIT((( (lrgstate[0] & 0x03) << 4 ) | (lrgstate[1] >>> 4)) & 0xFF)] << 24) |
      (DESHelper.sbox3[DESHelper.SBOXBIT((( (lrgstate[1] & 0x0f) << 2 ) | (lrgstate[2] >>> 6)) & 0xFF)] << 20) |
      (DESHelper.sbox4[DESHelper.SBOXBIT((lrgstate[2] & 0x3f) & 0xFF)] << 16) |
      (DESHelper.sbox5[DESHelper.SBOXBIT((lrgstate[3] >>> 2) & 0xFF)] << 12) |
      (DESHelper.sbox6[DESHelper.SBOXBIT((( (lrgstate[3] & 0x03) << 4 ) | (lrgstate[4] >>> 4)) & 0xFF)] << 8) |
      (DESHelper.sbox7[DESHelper.SBOXBIT((( (lrgstate[4] & 0x0f) << 2 ) | (lrgstate[5] >>> 6)) & 0xFF)] << 4) |
      DESHelper.sbox8[DESHelper.SBOXBIT((lrgstate[5] & 0x3f) & 0xFF)]
    ) >>> 0;

    // state = BITNUMINTL(state, 15, 0) | BITNUMINTL(state, 6, 1) | ... | BITNUMINTL(state, 24, 31);
    state =
      DESHelper.BITNUMINTL(state, 15, 0) | DESHelper.BITNUMINTL(state, 6, 1)  |
      DESHelper.BITNUMINTL(state, 19, 2) | DESHelper.BITNUMINTL(state, 20, 3) |
      DESHelper.BITNUMINTL(state, 28, 4) | DESHelper.BITNUMINTL(state, 11, 5) |
      DESHelper.BITNUMINTL(state, 27, 6) | DESHelper.BITNUMINTL(state, 16, 7) |
      DESHelper.BITNUMINTL(state, 0, 8)  | DESHelper.BITNUMINTL(state, 14, 9) |
      DESHelper.BITNUMINTL(state, 22, 10) | DESHelper.BITNUMINTL(state, 25, 11) |
      DESHelper.BITNUMINTL(state, 4, 12)  | DESHelper.BITNUMINTL(state, 17, 13) |
      DESHelper.BITNUMINTL(state, 30, 14) | DESHelper.BITNUMINTL(state, 9, 15)  |
      DESHelper.BITNUMINTL(state, 1, 16)  | DESHelper.BITNUMINTL(state, 7, 17)  |
      DESHelper.BITNUMINTL(state, 23, 18) | DESHelper.BITNUMINTL(state, 13, 19) |
      DESHelper.BITNUMINTL(state, 31, 20) | DESHelper.BITNUMINTL(state, 26, 21) |
      DESHelper.BITNUMINTL(state, 2, 22)  | DESHelper.BITNUMINTL(state, 8, 23)  |
      DESHelper.BITNUMINTL(state, 18, 24) | DESHelper.BITNUMINTL(state, 12, 25) |
      DESHelper.BITNUMINTL(state, 29, 26) | DESHelper.BITNUMINTL(state, 5, 27)  |
      DESHelper.BITNUMINTL(state, 21, 28) | DESHelper.BITNUMINTL(state, 10, 29) |
      DESHelper.BITNUMINTL(state, 3, 30)  | DESHelper.BITNUMINTL(state, 24, 31);

    return state >>> 0;
  },

  // Public method: Crypt(byte[] input, byte[] output, byte[][] key)
  Crypt: function(input, output, key) {
    // uint[] state = new uint[2];
    const state = [0 >>> 0, 0 >>> 0];
    let idx = 0 >>> 0;
    let t   = 0 >>> 0;

    // IP(state, input);
    DESHelper.IP(state, input);

    // for (idx = 0; idx < 15; ++idx)
    for (idx = 0; idx < 15; idx++) {
      // t = state[1];
      // state[1] = F(state[1], key[idx]) ^ state[0];
      // state[0] = t;
      t = state[1] >>> 0;
      state[1] = (DESHelper.F(state[1], key[idx]) ^ state[0]) >>> 0;
      state[0] = t >>> 0;
    }

    // state[0] = F(state[1], key[15]) ^ state[0];
    state[0] = (DESHelper.F(state[1], key[15]) ^ state[0]) >>> 0;

    // InvIP(state, output);
    DESHelper.InvIP(state, output);
  },

  // Public method: TripleDESKeySetup(byte[] key, byte[][][] schedule, uint mode)
  TripleDESKeySetup: function(key, schedule, mode) {
    // if (mode == ENCRYPT)
    // {
    //   KeySchedule(key[0..], schedule[0], mode);
    //   KeySchedule(key[8..], schedule[1], DECRYPT);
    //   KeySchedule(key[16..], schedule[2], mode);
    // }
    // else /*if (mode == DES_DECRYPT*/
    // {
    //   KeySchedule(key[0..], schedule[2], mode);
    //   KeySchedule(key[8..], schedule[1], ENCRYPT);
    //   KeySchedule(key[16..], schedule[0], mode);
    // }
    if (mode === DESHelper.ENCRYPT) {
      DESHelper.KeySchedule(key.slice(0),    schedule[0], mode);
      DESHelper.KeySchedule(key.slice(8),    schedule[1], DESHelper.DECRYPT);
      DESHelper.KeySchedule(key.slice(16),   schedule[2], mode);
    } else {
      DESHelper.KeySchedule(key.slice(0),    schedule[2], mode);
      DESHelper.KeySchedule(key.slice(8),    schedule[1], DESHelper.ENCRYPT);
      DESHelper.KeySchedule(key.slice(16),   schedule[0], mode);
    }
  },

  // Public method: TripleDESCrypt(byte[] input, byte[] output, byte[][][] key)
  TripleDESCrypt: function(input, output, key) {
    // Crypt(input, output, key[0]);
    // Crypt(output, output, key[1]);
    // Crypt(output, output, key[2]);
    DESHelper.Crypt(input,  output, key[0]);
    DESHelper.Crypt(output, output, key[1]);
    DESHelper.Crypt(output, output, key[2]);
  }
};

// Export as a module
module.exports = DESHelper;