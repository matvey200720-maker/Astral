const PART_GLUE = " · ";

const isEnumerable = (target, key) => Object.prototype.propertyIsEnumerable.call(target, key);

// Собственные перечислимые поля любого значения, в порядке объекта: так же, как
// их копирует распыление. Строка распадается на знаки, число и true пусты.
function ownFields(value) {
  const boxed = Object(value);
  return Reflect.ownKeys(boxed)
    .filter((key) => isEnumerable(boxed, key))
    .map((key) => [key, boxed[key]]);
}

export function labelled(spec, label) {
  if (!spec || !label) return spec;
  return Object.fromEntries([...ownFields(spec), ["label", label]]);
}

export function labelOf(...words) {
  let line = "";
  let started = false;
  for (const word of words) {
    if (!word) continue;
    line = started ? `${line}${PART_GLUE}${word}` : `${word}`;
    started = true;
  }
  return line;
}
