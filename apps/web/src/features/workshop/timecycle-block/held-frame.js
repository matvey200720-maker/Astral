export const HOLD_MS = 1500;

// Единственная ячейка: [копия кадра, момент записи] или пусто.
const slot = {
  entry: null,
  put(copy, at) {
    this.entry = [copy, at];
  },
  drain() {
    const old = this.entry;
    this.entry = null;
    return old;
  },
};

// Копия того же размера; без 2D-контекста копировать нечем.
function cloneCanvas(source) {
  try {
    const copy = Object.assign(document.createElement("canvas"), {
      width: source.width,
      height: source.height,
    });
    const context = copy.getContext("2d");
    context?.drawImage(source, 0, 0);
    return context ? copy : null;
  } catch {
    return null;
  }
}

const isFresh = (at, now) => !(now - at > HOLD_MS); // NaN и отрицательная разность свежие

export function holdFrame(canvas, now = performance.now()) {
  slot.drain();
  const copy = canvas?.width && canvas?.height && typeof document !== "undefined" ? cloneCanvas(canvas) : null;
  if (copy) slot.put(copy, now);
  return copy;
}

export const takeHeldFrame = (now = performance.now()) => {
  const entry = slot.drain();
  return entry && isFresh(entry[1], now) ? entry[0] : null;
};
