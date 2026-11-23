// Устойчивый хвост идентификатора заявки: FNV-1a (32 бита) по единицам UTF-16 адреса поста.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function foldUnit(state, unit) {
  return Math.imul(state ^ unit, FNV_PRIME);
}

export function postKey(url) {
  const text = url ? String(url) : "";
  if (text === "") return "";
  let state = FNV_OFFSET;
  for (let at = 0; at < text.length; at += 1) {
    state = foldUnit(state, text.charCodeAt(at));
  }
  return (state >>> 0).toString(16).padStart(8, "0");
}
