import { showcaseEnabled } from "./enabled.js";

const FEED_MAX = 3;
const FEED_EVERY = 12;

export const SHOWCASE_SCREENS = Object.freeze({
  home: "home",
  feed: "catalog",
  mod: "mod-detail",
  builds: "builds",
});

// Ворота идут по порядку: первое «нет» закрывает место.
const GATES = [
  () => showcaseEnabled(),
  (place, screen) => SHOWCASE_SCREENS[place] === screen,
  (place, screen, mod) => !mod?.risk,
];

export const showcaseAllowed = ({ place, mod = null, screen } = {}) => GATES.every((gate) => gate(place, screen, mod));

// Сколько рядов нужно, чтобы между двумя местами лежал хотя бы экран
const rowsBelow = (viewport, step) => (step > 0 && viewport > 0 ? 1 + Math.ceil(viewport / step) : 0);
const fillCount = (columns) => Math.ceil(FEED_EVERY / columns);

export function feedEvery(grid = {}) {
  const columns = grid.columns;
  if (columns > 0) return columns * Math.max(fillCount(columns), rowsBelow(grid.viewport, grid.step));
  return FEED_EVERY;
}

export function withFeedSlots(items, options = {}) {
  const { every = FEED_EVERY, max = FEED_MAX } = options;
  const leaveAlone = [() => !showcaseEnabled(), () => !Array.isArray(items), () => items.length <= every].some((test) => test());
  return leaveAlone ? items : interleave(items, every, max);
}

const makeSlot = (no) => ({ id: `showcase-slot-${no}`, showcaseSlot: no });

// Пустые ячейки пропускаются; номер карточки считается по её месту в исходном списке.
function interleave(items, every, max) {
  const total = items.length;
  const out = [];
  let made = 0;
  // NaN в max или every даёт «нет места»: сравнения истинны только на нормальных числах
  const slotFollows = (at) => at + 1 < total && made < max && (at + 1) % every === 0;
  for (let at = 0; at < total; at += 1) {
    if (!(at in items)) continue;
    out[out.length] = items[at];
    if (slotFollows(at)) out[out.length] = makeSlot(++made);
  }
  return out;
}

export { FEED_EVERY, FEED_MAX };
