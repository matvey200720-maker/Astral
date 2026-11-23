import { distanceToShape } from "./climb-edt.js";
import { composeClimbPixels } from "./climb-pixels.js";

function sameBytes(left, right) {
  return left.length === right.length && left.every((byte, at) => byte === right[at]);
}

// Последнее поле расстояний каждой метки: [ширина, высота, покрытие, поле].
// Пока форма та же, ползунки цвета и свечения поле не пересчитывают.
// Число меток не ограничено, память живёт вместе с потоком.
const lastFields = new Map();

function fieldFor(slotId, width, height, coverage) {
  const known = lastFields.get(slotId);
  if (known) {
    const [knownWidth, knownHeight, knownCoverage, knownField] = known;
    const unchanged = knownWidth === width && knownHeight === height && sameBytes(knownCoverage, coverage);
    if (unchanged) return knownField;
  }
  const field = distanceToShape(coverage, width, height);
  lastFields.set(slotId, [width, height, coverage, field]);
  return field;
}

function composeMarker(data) {
  const { width, height, fillPixels, inkPixels } = data;
  const distance = data.needsDistance ? fieldFor(data.slotId, width, height, data.union) : null;
  const base = { width, height, fillPixels, inkPixels, distance };
  const rgba = composeClimbPixels(Object.assign(base, data.paint));
  return [{ id: data.id, rgba }, [rgba.buffer]];
}

const scope = self;

// Ответ уходит одним сообщением; даже сбой отправки превращается в ответ с ошибкой.
function answer(id, work) {
  try {
    const [message, transfer] = work();
    if (transfer) scope.postMessage(message, transfer);
    else scope.postMessage(message);
  } catch (thrown) {
    scope.postMessage({ id, error: String(thrown?.message || thrown) });
  }
}

scope.onmessage = (event) => {
  const data = event.data ?? {};
  answer(data.id, () => composeMarker(data));
};
