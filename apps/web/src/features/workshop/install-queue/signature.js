// Подпись состояния редактора: «длина.хеш» в системе по основанию 36.
// Защиты нет, подпись нужна лишь чтобы отличать две правки одного человека в этом окне.
const RADIX = 36;
const FNV = { seed: 0x811c9dc5, prime: 0x01000193 };

// Как значение превращается в текст: по типу. Строка идёт как есть, остальное - JSON-записью.
const TEXT_BY_TYPE = new Map([["string", (value) => value]]);
const asJson = (value) => JSON.stringify(value ?? null);
const textOf = (value) => (TEXT_BY_TYPE.get(typeof value) ?? asJson)(value);

// FNV-1a по единицам UTF-16, без промежуточных массивов: текст может весить мегабайты.
const makeFnv1a = ({ seed, prime }) => (text) => {
  let hash = seed;
  let at = 0;
  const end = text.length;
  while (at < end) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, prime);
    at += 1;
  }
  return hash >>> 0;
};
const hash32 = makeFnv1a(FNV);

export function workSignature(value) {
  const text = textOf(value);
  return `${text.length.toString(RADIX)}.${hash32(text).toString(RADIX)}`;
}
