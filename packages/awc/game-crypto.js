// Расшифровка штатных банков AWC игры на чистом Node: ключ банка выводится из ключа AES набора ArchiveFix, как это делает CodeWalker
// (`GTA5Keys.UseMagicData`), сам банк шифруется целиком RSXXTEA. Нужна одному сценарию — снять таблицу отпечатков штатных дорожек
// (`scripts/build-stock-awc-hashes.mjs`); установка в игру этим не пользуется (там помощник RPF).
//
// Откуда что взято (проверено на живых `melee.awc` и `vehicles.awc` игры 13.11.2026: после расшифровки заголовок «ADAT», 98 и 553 дорожки):
//   • `native/CodeWalker.Core/GameFiles/Utils/GTAKeys.cs: UseMagicData` — зерно `System.Random` = Дженкинс-хеш ключа AES, четыре потока
//     случайных байт вычитаются из вшитого блоба `magic.dat`, затем AES-256-ECB и deflate; ключ AWC — четыре слова после NG-данных;
//   • `native/CodeWalker.Core/GameFiles/FileTypes/AwcFile.cs: Decrypt_RSXXTEA` — XXTEA со своей константой `0x7B3A207F`.

import { createDecipheriv } from "node:crypto";
import { inflateRawSync } from "node:zlib";

const NG_KEYS_BYTES = 27472;
const NG_TABLES_BYTES = 278528;
const LUT_BYTES = 256;
const AWC_KEY_WORDS = 4;
const DELTA = 0x9e3779b9;
const MIX = 0x7b3a207f;

/** Хеш Дженкинса по байтам (`JenkHash.GenHash(byte[])`). */
export function jenkinsHash(bytes) {
  let hash = 0;
  for (let at = 0; at < bytes.length; at += 1) {
    hash = (hash + bytes[at]) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  return (hash + (hash << 15)) >>> 0;
}

/**
 * `System.Random(seed)` с явным зерном (алгоритм Кнута, как в .NET): `next()` — `Next()`, `fill(buffer)` — `NextBytes`.
 * Зерно — целое со знаком, как `(int)JenkHash.GenHash(...)` в CodeWalker.
 */
export function dotnetRandom(seed) {
  const big = 2147483647;
  const table = new Int32Array(56);
  const start = seed === -2147483648 ? big : Math.abs(seed);
  let high = 161803398 - start;
  table[55] = high;
  let low = 1;
  for (let at = 1; at < 55; at += 1) {
    const place = (21 * at) % 55;
    table[place] = low;
    low = high - low;
    if (low < 0) low += big;
    high = table[place];
  }
  for (let pass = 1; pass < 5; pass += 1) {
    for (let at = 1; at < 56; at += 1) {
      table[at] -= table[1 + ((at + 30) % 55)];
      if (table[at] < 0) table[at] += big;
    }
  }
  let first = 0;
  let second = 21;
  const next = () => {
    first = first + 1 >= 56 ? 1 : first + 1;
    second = second + 1 >= 56 ? 1 : second + 1;
    let value = table[first] - table[second];
    if (value === big) value -= 1;
    if (value < 0) value += big;
    table[first] = value;
    return value;
  };
  return {
    next,
    fill(buffer) {
      for (let at = 0; at < buffer.length; at += 1) buffer[at] = next() & 0xff;
      return buffer;
    },
  };
}

/** AES-256-ECB без дополнения, один проход, хвост короче блока остаётся как есть (`GTACrypto.DecryptAESData`). */
function decryptAesBlocks(data, key) {
  const whole = data.length - (data.length % 16);
  const decipher = createDecipheriv("aes-256-ecb", key, null);
  decipher.setAutoPadding(false);
  const head = Buffer.concat([
    decipher.update(data.subarray(0, whole)),
    decipher.final(),
  ]);
  return Buffer.concat([head, Buffer.from(data.subarray(whole))]);
}

/**
 * Ключ банков AWC (четыре слова) из ключа AES набора ArchiveFix (`gtav_aes_key.dat`, 32 байта) и блоба `magic.dat`
 * (`native/CodeWalker.Core/Resources/magic.dat`).
 */
export function deriveAwcKey({ aesKey, magic }) {
  if (!aesKey || aesKey.length !== 32)
    throw new Error(
      "Ключ AES — 32 байта (gtav_aes_key.dat из набора ArchiveFix).",
    );
  const random = dotnetRandom(jenkinsHash(aesKey) | 0);
  const noise = [0, 1, 2, 3].map(() =>
    random.fill(new Uint8Array(magic.length)),
  );
  const sealed = new Uint8Array(magic.length);
  for (let at = 0; at < magic.length; at += 1) {
    sealed[at] =
      (magic[at] - noise[0][at] - noise[1][at] - noise[2][at] - noise[3][at]) &
      0xff;
  }
  const packed = decryptAesBlocks(sealed, aesKey);
  const data = inflateRawSync(packed, { finishFlush: 2 });
  const place = NG_KEYS_BYTES + NG_TABLES_BYTES + LUT_BYTES;
  if (data.length < place + AWC_KEY_WORDS * 4)
    throw new Error("Блоб magic.dat короче ожидаемого: ключ AWC не найден.");
  const key = new Uint32Array(AWC_KEY_WORDS);
  for (let word = 0; word < AWC_KEY_WORDS; word += 1)
    key[word] = data.readUInt32LE(place + word * 4);
  return key;
}

const wordsOf = (data) => {
  if (data.length % 4 !== 0)
    throw new Error(
      "Длина банка не кратна четырём байтам — так игра его не шифрует.",
    );
  return new Uint32Array(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.length),
  );
};

/** Расшифровывает банк целиком (`AwcFile.Decrypt_RSXXTEA`); возвращает новые байты. */
export function decryptAwcBank(data, key) {
  const blocks = wordsOf(data);
  const count = blocks.length;
  if (count < 2) throw new Error("Банк слишком короткий для расшифровки.");
  let current = blocks[0];
  let sum = Math.imul(DELTA, 6 + Math.floor(52 / count)) >>> 0;
  do {
    for (let at = count - 1; at >= 0; at -= 1) {
      const before = blocks[at > 0 ? at - 1 : count - 1];
      const mixed =
        (((before >>> 5) ^ (current << 2)) +
          ((current >>> 3) ^ (before << 4))) >>>
        0;
      const other =
        (((sum ^ current) >>> 0) +
          ((key[(at & 3) ^ ((sum >>> 2) & 3)] ^ before ^ MIX) >>> 0)) >>>
        0;
      current = (blocks[at] - ((mixed ^ other) >>> 0)) >>> 0;
      blocks[at] = current;
    }
    sum = (sum - DELTA) >>> 0;
  } while (sum !== 0);
  return new Uint8Array(blocks.buffer);
}

/** Обратная операция (`AwcFile.Encrypt_RSXXTEA`): нужна тестам, чтобы проверить расшифровку на собранном банке. */
export function encryptAwcBank(data, key) {
  const blocks = wordsOf(data);
  const count = blocks.length;
  if (count < 2) throw new Error("Банк слишком короткий для шифрования.");
  let rounds = 6 + Math.floor(52 / count);
  let sum = 0;
  let behind = blocks[count - 1];
  do {
    sum = (sum + DELTA) >>> 0;
    const pick = (sum >>> 2) & 3;
    for (let at = 0; at < count; at += 1) {
      const ahead = blocks[(at + 1) % count];
      const mixed =
        (((behind >>> 5) ^ (ahead << 2)) + ((ahead >>> 3) ^ (behind << 4))) >>>
        0;
      const other =
        (((sum ^ ahead) >>> 0) +
          ((key[(at & 3) ^ pick] ^ behind ^ MIX) >>> 0)) >>>
        0;
      behind = (blocks[at] + ((mixed ^ other) >>> 0)) >>> 0;
      blocks[at] = behind;
    }
    rounds -= 1;
  } while (rounds !== 0);
  return new Uint8Array(blocks.buffer);
}
