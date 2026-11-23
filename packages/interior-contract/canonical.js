/*
 * Приведение к каноническому виду возвращает ИСХОДНЫЙ объект, когда менять в нём
 * нечего.
 *
 * Хэш макета — это подпись, по которой сходятся план установки и уже
 * установленный мод, поэтому строка на выходе обязана остаться байт в байт той
 * же. Она и остаётся: если ключи объекта уже идут по возрастанию и ни один
 * потомок не изменился, пересобранный объект дал бы тот же JSON — а значит
 * пересобирать его незачем.
 *
 * Цена была заметной: нормализация кладёт ключи литеральным порядком, то есть
 * пересборка почти всегда была работой вхолостую — по 28 аллокаций на сущность
 * (массив ключей, сортировка, массив пар, пары, результат), три с половиной
 * тысячи на макет в сто двадцать восемь предметов.
 *
 * Сравнение через `Object.is`, а не через `!==`: минус ноль равен нулю по `===`,
 * и подмена `-0` на `0` прошла бы незамеченной — а в JSON это разные строки и,
 * значит, разный хэш.
 */
function canonicalize(value, path = "value") {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError(`${path}: non-finite numbers are forbidden.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    let rebuilt = false;
    const items = value.map((item, index) => {
      const next = canonicalize(item, `${path}[${index}]`);
      if (!Object.is(next, item)) rebuilt = true;
      return next;
    });
    return rebuilt ? items : value;
  }
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${path}: expected a plain object.`);
  }
  const keys = Object.keys(value);
  let ordered = true;
  for (let index = 1; index < keys.length; index += 1)
    if (keys[index - 1].localeCompare(keys[index]) > 0) {
      ordered = false;
      break;
    }
  if (ordered) {
    /* Проход только ради проверки потомков: пока никто из них не изменился,
       объект уходит наружу как есть. */
    let rebuilt = false;
    for (const key of keys) {
      const next = canonicalize(value[key], `${path}.${key}`);
      if (!Object.is(next, value[key])) {
        rebuilt = true;
        break;
      }
    }
    if (!rebuilt) return value;
  }
  return Object.fromEntries(
    [...keys]
      .sort((a, b) => a.localeCompare(b))
      .map((key) => [key, canonicalize(value[key], `${path}.${key}`)]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

// Synchronous SHA-256 keeps the shared contract usable in Node, Electron and
// the browser without importing node:crypto or depending on WebCrypto state.
export function sha256Hex(input) {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input || 0);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(
    paddedLength - 8,
    Math.floor(bitLength / 0x100000000),
    false,
  );
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (value, bits) => (value >>> bits) | (value << (32 - bits));

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1)
      w[i] = paddedView.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + choice + k[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return [...h].map((value) => value.toString(16).padStart(8, "0")).join("");
}

export function canonicalSha256(value) {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}
