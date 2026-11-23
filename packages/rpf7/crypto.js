// Шифры оглавлений и файлов RPF7: NG (17 раундов по таблицам), AES-256 ECB и хеш имени для выбора ключа NG.
// Ключей игры здесь нет: набор приходит от вызывающего (prepareKeys).

const SBOX = Uint8Array.from([
  99, 124, 119, 123, 242, 107, 111, 197, 48, 1, 103, 43, 254, 215, 171, 118,
  202, 130, 201, 125, 250, 89, 71, 240, 173, 212, 162, 175, 156, 164, 114, 192,
  183, 253, 147, 38, 54, 63, 247, 204, 52, 165, 229, 241, 113, 216, 49, 21,
  4, 199, 35, 195, 24, 150, 5, 154, 7, 18, 128, 226, 235, 39, 178, 117,
  9, 131, 44, 26, 27, 110, 90, 160, 82, 59, 214, 179, 41, 227, 47, 132,
  83, 209, 0, 237, 32, 252, 177, 91, 106, 203, 190, 57, 74, 76, 88, 207,
  208, 239, 170, 251, 67, 77, 51, 133, 69, 249, 2, 127, 80, 60, 159, 168,
  81, 163, 64, 143, 146, 157, 56, 245, 188, 182, 218, 33, 16, 255, 243, 210,
  205, 12, 19, 236, 95, 151, 68, 23, 196, 167, 126, 61, 100, 93, 25, 115,
  96, 129, 79, 220, 34, 42, 144, 136, 70, 238, 184, 20, 222, 94, 11, 219,
  224, 50, 58, 10, 73, 6, 36, 92, 194, 211, 172, 98, 145, 149, 228, 121,
  231, 200, 55, 109, 141, 213, 78, 169, 108, 86, 244, 234, 101, 122, 174, 8,
  186, 120, 37, 46, 28, 166, 180, 198, 232, 221, 116, 31, 75, 189, 139, 138,
  112, 62, 181, 102, 72, 3, 246, 14, 97, 53, 87, 185, 134, 193, 29, 158,
  225, 248, 152, 17, 105, 217, 142, 148, 155, 30, 135, 233, 206, 85, 40, 223,
  140, 161, 137, 13, 191, 230, 66, 104, 65, 153, 45, 15, 176, 84, 187, 22,
]);

const INV_SBOX = Uint8Array.from([
  82, 9, 106, 213, 48, 54, 165, 56, 191, 64, 163, 158, 129, 243, 215, 251,
  124, 227, 57, 130, 155, 47, 255, 135, 52, 142, 67, 68, 196, 222, 233, 203,
  84, 123, 148, 50, 166, 194, 35, 61, 238, 76, 149, 11, 66, 250, 195, 78,
  8, 46, 161, 102, 40, 217, 36, 178, 118, 91, 162, 73, 109, 139, 209, 37,
  114, 248, 246, 100, 134, 104, 152, 22, 212, 164, 92, 204, 93, 101, 182, 146,
  108, 112, 72, 80, 253, 237, 185, 218, 94, 21, 70, 87, 167, 141, 157, 132,
  144, 216, 171, 0, 140, 188, 211, 10, 247, 228, 88, 5, 184, 179, 69, 6,
  208, 44, 30, 143, 202, 63, 15, 2, 193, 175, 189, 3, 1, 19, 138, 107,
  58, 145, 17, 65, 79, 103, 220, 234, 151, 242, 207, 206, 240, 180, 230, 115,
  150, 172, 116, 34, 231, 173, 53, 133, 226, 249, 55, 232, 28, 117, 223, 110,
  71, 241, 26, 113, 29, 41, 197, 137, 111, 183, 98, 14, 170, 24, 190, 27,
  252, 86, 62, 75, 198, 210, 121, 32, 154, 219, 192, 254, 120, 205, 90, 244,
  31, 221, 168, 51, 136, 7, 199, 49, 177, 18, 16, 89, 39, 128, 236, 95,
  96, 81, 127, 169, 25, 181, 74, 13, 45, 229, 122, 159, 147, 201, 156, 239,
  160, 224, 59, 77, 174, 42, 245, 176, 200, 235, 187, 60, 131, 83, 153, 97,
  23, 43, 4, 126, 186, 119, 214, 38, 225, 105, 20, 99, 85, 33, 12, 125,
]);

const KEYS_REQUIRED = "RPF_KEYS_REQUIRED";
const keysRequired = (message) => Object.assign(new Error(message), { code: KEYS_REQUIRED });

const NG_KEY_COUNT = 101;
const NG_KEY_WORDS = 68;
const NG_ROUNDS = 17;
const NG_TABLE_STRIDE = 4096;

// Какие четыре входных байта блока берёт каждое выходное слово: простой и смешанный раунд.
const PLAIN_INPUTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const MIXED_INPUTS = [0, 7, 10, 13, 1, 4, 11, 14, 2, 5, 8, 15, 3, 6, 9, 12];
const PLAIN_ROUNDS = new Set([0, 1, 16]);
const ROUND_INPUTS = Array.from({ length: NG_ROUNDS }, (_, r) =>
  Uint8Array.from(PLAIN_ROUNDS.has(r) ? PLAIN_INPUTS : MIXED_INPUTS),
);

const readWords = (view, at, count) => Uint32Array.from({ length: count }, (_, i) => view.getUint32(at + i * 4, true));

// AES-256: расширение ключа и «эквивалентный обратный шифр» (FIPS-197, 5.3.5) на таблицах Td.
const xtime = (b) => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff;
const gfMul = (a, b) => {
  let product = 0;
  for (let x = a, y = b; y; y >>= 1, x = xtime(x)) if (y & 1) product ^= x;
  return product;
};
const rotr = (w, n) => ((w >>> n) | (w << (32 - n))) >>> 0;

// Td0[x] — колонка InvMixColumns для байта InvSBox[x]; Td1…Td3 — её сдвиги на байт.
const TD = (() => {
  const column = (s) => [14, 9, 13, 11].reduce((word, factor) => (word << 8) | gfMul(s, factor), 0) >>> 0;
  const base = Array.from(INV_SBOX, column);
  return [0, 8, 16, 24].map((n) => Uint32Array.from(base, (w) => rotr(w, n)));
})();

const AES_ROUNDS = 14;
const BYTE_SHIFTS = [24, 16, 8, 0];
const byteAt = (w, shift) => (w >>> shift) & 0xff;
const wordBE = (bytes, at) => (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
const subWord = (t) => BYTE_SHIFTS.reduce((word, shift) => word | (SBOX[byteAt(t, shift)] << shift), 0) >>> 0;
const invMixWord = (v) => BYTE_SHIFTS.reduce((word, shift, j) => word ^ TD[j][SBOX[byteAt(v, shift)]], 0);

const expandAesKey = (key) => {
  const w = new Uint32Array(4 * (AES_ROUNDS + 1));
  for (let i = 0; i < 8; i++) w[i] = wordBE(key, 4 * i);
  let rcon = 1;
  for (let i = 8; i < w.length; i++) {
    let t = w[i - 1];
    if (i % 8 === 0) {
      t = subWord(rotr(t, 24)) ^ (rcon << 24);
      rcon = xtime(rcon);
    } else if (i % 8 === 4) {
      t = subWord(t);
    }
    w[i] = w[i - 8] ^ t;
  }
  return w;
};

const aesDecryptSchedule = (key) => {
  const w = expandAesKey(key);
  return Uint32Array.from(w, (_, i) => {
    const [round, column] = [i >> 2, i & 3];
    const v = w[(AES_ROUNDS - round) * 4 + column];
    return round === 0 || round === AES_ROUNDS ? v : invMixWord(v);
  });
};

// Байт j колонки c после InvShiftRows берётся из колонки (c − j) mod 4.
const shiftedByte = (state, c, j) => byteAt(state[(c - j) & 3], BYTE_SHIFTS[j]);

const decryptAesBlock = (buf, at, dw, scratch) => {
  let [cur, next] = scratch;
  for (let c = 0; c < 4; c++) cur[c] = wordBE(buf, at + 4 * c) ^ dw[c];
  for (let round = 1; round < AES_ROUNDS; round++) {
    for (let c = 0; c < 4; c++) {
      next[c] = BYTE_SHIFTS.reduce((word, _, j) => word ^ TD[j][shiftedByte(cur, c, j)], dw[round * 4 + c]);
    }
    [cur, next] = [next, cur];
  }
  for (let c = 0; c < 4; c++) {
    const last = BYTE_SHIFTS.reduce((word, shift, j) => word | (INV_SBOX[shiftedByte(cur, c, j)] << shift), 0);
    const w = last ^ dw[AES_ROUNDS * 4 + c];
    for (let j = 0; j < 4; j++) buf[at + 4 * c + j] = w >>> BYTE_SHIFTS[j];
  }
};

export const decryptAes = (data, keys) => {
  if (!keys?.aes) throw keysRequired("Архив зашифрован AES: нужен ключ ArchiveFix gtav_aes_key.dat.");
  const out = Uint8Array.from(data);
  const scratch = [new Uint32Array(4), new Uint32Array(4)];
  for (let at = 0; at + 16 <= out.length; at += 16) decryptAesBlock(out, at, keys.aes.decrypt, scratch);
  return out;
};

// Набор ключей: каждое поле проверяется по размеру, потом собирается в рабочий вид.
const KEY_FIELDS = [
  ["aes", 32, "Ключ AES — 32 байта.", (key) => ({ rounds: AES_ROUNDS, decrypt: aesDecryptSchedule(key) })],
  [
    "ngKeys",
    NG_KEY_COUNT * NG_KEY_WORDS * 4,
    "Набор ключей NG — 101 ключ по 272 байта.",
    (bytes) => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return Array.from({ length: NG_KEY_COUNT }, (_, k) => readWords(view, k * NG_KEY_WORDS * 4, NG_KEY_WORDS));
    },
  ],
  [
    "ngTables",
    NG_ROUNDS * NG_TABLE_STRIDE * 4,
    "Таблицы NG — 17×16×256 слов.",
    (bytes) => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return readWords(view, 0, NG_ROUNDS * NG_TABLE_STRIDE);
    },
  ],
  ["hashLut", 256, "Таблица хеша — 256 байт.", (lut) => Uint8Array.from(lut)],
];

export const prepareKeys = ({ aes, ngKeys, ngTables, hashLut } = {}) => {
  const given = { aes, ngKeys, ngTables, hashLut };
  const present = KEY_FIELDS.filter(([name]) => given[name]);
  for (const [name, size, message] of present) if (given[name].length !== size) throw new Error(message);
  return Object.fromEntries(present.map(([name, , , build]) => [name, build(given[name])]));
};

// Хеш имени и номер ключа NG.
export const ngNameHash = (name, lut) => {
  let r = 0;
  for (let i = 0; i < name.length; i++) {
    const t = Math.imul((lut[name.charCodeAt(i) & 0xff] + r) >>> 0, 1025) >>> 0;
    r = ((t >>> 6) ^ t) >>> 0;
  }
  const n = Math.imul(r, 9) >>> 0;
  return Math.imul((n >>> 11) ^ n, 32769) >>> 0;
};

/*
 * Номер ключа NG по хешу имени и длине файла: `(хеш + длина + 61) % 101` в 32-битной БЕЗЗНАКОВОЙ арифметике игры — сумма берётся по модулю 2^32 ДО деления (у `uint` в C#/C++ сложение переносится;
 * `GTACrypto.cs: (hash + length + (101 - 40)) % 0x65`, движок `rage-rpf/src/keys.rs: ng_key_index`). Прежняя запись `(хеш + длина + 61) % 101` без переноса промахивалась, когда сумма достигала 2^32 (большие архивы: у пака
 * больше 2 ГиБ почти всегда), и читатель находил ключ перебором (`keyGuessed: true`). Сверено на настоящих архивах игры (`tests/rpf7.test.js`): `mpheist`, `mpchristmas2017`, `mpchristmas2018`, `mpheist4`, `mptuner`,
 * `mpbattle` (2,4–3,98 ГБ) и `patchday3ng` (2,25 ГБ, сумма меньше 2^32: знаковая длина дала бы здесь не тот ключ — это не «знаковая 32-битная длина», а перенос по модулю 2^32).
 */
export const ngKeyIndexOfHash = (hash, length) => ((hash + (length >>> 0) + 61) >>> 0) % NG_KEY_COUNT;

export const ngKeyIndex = (name, length, lut) => ngKeyIndexOfHash(ngNameHash(name, lut), length);

const asWords = (view) =>
  view instanceof Uint32Array ? view : new Uint32Array(view.buffer, view.byteOffset, view.length);

const decryptNgBlock = (buf, at, key, words, scratch) => {
  let [cur, next] = scratch;
  for (let i = 0; i < 16; i++) cur[i] = buf[at + i];
  for (let r = 0; r < NG_ROUNDS; r++) {
    const inputs = ROUND_INPUTS[r];
    const base = r * NG_TABLE_STRIDE;
    for (let k = 0; k < 4; k++) {
      let w = key[4 * r + k];
      for (let j = 0; j < 4; j++) {
        const s = inputs[4 * k + j];
        w ^= words[base + s * 256 + cur[s]];
      }
      for (let j = 0; j < 4; j++) next[4 * k + j] = w >>> (8 * j);
    }
    [cur, next] = [next, cur];
  }
  buf.set(cur, at);
};

export const decryptNgWithKey = (data, key, words) => {
  const out = Uint8Array.from(data);
  const [keyWords, tableWords] = [asWords(key), asWords(words)];
  const scratch = [new Uint8Array(16), new Uint8Array(16)];
  for (let at = 0; at + 16 <= out.length; at += 16) decryptNgBlock(out, at, keyWords, tableWords, scratch);
  return out;
};

export const decryptNg = (data, name, length, keys) => {
  if (!keys?.ngKeys || !keys.ngTables || !keys.hashLut) {
    throw keysRequired("Архив зашифрован NG: нужен набор ключей ArchiveFix (ключи NG, таблицы и таблица хеша).");
  }
  const key = keys.ngKeys[ngKeyIndex(name, length, keys.hashLut)];
  return keys.ngDecrypt ? keys.ngDecrypt(data, key, keys.ngTables) : decryptNgWithKey(data, key, keys.ngTables);
};
