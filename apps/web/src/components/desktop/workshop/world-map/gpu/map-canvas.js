// Общий холст GPU-пути карты: один контекст WebGL на всё окно.
const slot = { element: null };

function ensureElement() {
  slot.element = slot.element || document.createElement("canvas");
  return slot.element;
}

// Присваивание размера сбрасывает буфер: рисовать и снимать кадр нужно до следующего вызова.
export const sharedMapCanvas = (width, height) =>
  Object.assign(ensureElement(), { width, height });
