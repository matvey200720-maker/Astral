// Замер ширины надписей карты шрифтом окна (холст 2d) и хук, который отдаёт
// новую функцию замера, когда шрифты изменили ширины.
import { useSyncExternalStore } from "react";

const PROBE_SIZE = 100;
const FONT_EVENT = "loadingdone";

// context: undefined — холст ещё не просили; null — просили, но нечем мерить.
const probe = { context: undefined };
// ключ -> { style, advance }: стиль нужен, чтобы перемерить при смене шрифтов
const remembered = new Map();
// подписчики хука, номер поколения и текущая функция замера
const hub = { watchers: [], epoch: 0, measurer: null };

const attempt = (job, otherwise) => {
  try {
    return job();
  } catch {
    return otherwise;
  }
};

const drawingContext = () => {
  if (probe.context === undefined) {
    probe.context = attempt(() => document.createElement("canvas").getContext("2d") || null, null);
  }
  return probe.context;
};

const advanceOf = (context, { value, family, weight, spacing }) => {
  context.font = `${weight} ${PROBE_SIZE}px ${family}`;
  if ("letterSpacing" in context) context.letterSpacing = `${spacing}px`;
  const { width } = context.measureText(value);
  return width > 0 ? width / PROBE_SIZE : null;
};

const record = (key, context, style) => {
  const entry = { style, advance: advanceOf(context, style) };
  remembered.set(key, entry);
  return entry;
};

const measureTextAdvance = ({ value, family, weight, spacing = 0 }) => {
  const context = drawingContext();
  if (!context || !value) return null;
  const key = [weight, family, spacing, value].map(String).join("|");
  const entry = remembered.get(key) ?? record(key, context, { value, family, weight, spacing });
  return entry.advance;
};

const makeMeasurer = () => (style) => measureTextAdvance(style);
hub.measurer = makeMeasurer();

const fontFaces = () => globalThis.document?.fonts;

// Перемер записи тем же холстом; true, если ширина изменилась.
const refresh = (context, entry) => {
  const fresh = advanceOf(context, entry.style);
  const changed = fresh !== entry.advance;
  entry.advance = fresh;
  return changed;
};

const onFontsLoaded = () => {
  const context = drawingContext();
  // Без холста изменением считается всё, даже при пустом кэше.
  const changes = context
    ? [...remembered.values()].filter((entry) => refresh(context, entry)).length
    : 1;
  if (changes === 0) return;
  hub.epoch += 1;
  hub.measurer = makeMeasurer();
  [...hub.watchers].forEach((notify) => notify());
};

const subscribe = (listener) => {
  hub.watchers.push(listener);
  if (hub.watchers.length === 1) fontFaces()?.addEventListener?.(FONT_EVENT, onFontsLoaded);
  return () => {
    const at = hub.watchers.indexOf(listener);
    if (at < 0) return;
    hub.watchers.splice(at, 1);
    if (hub.watchers.length === 0) fontFaces()?.removeEventListener?.(FONT_EVENT, onFontsLoaded);
  };
};

const currentMeasurer = () => hub.measurer;

const useTextAdvance = () => useSyncExternalStore(subscribe, currentMeasurer, currentMeasurer);

const textMeasureEpoch = () => hub.epoch;

export { measureTextAdvance, textMeasureEpoch, useTextAdvance };
