// Страница «Заменить картинку у всех»: роды экранов зала, отбор целей, вид экрана,
// правка раздела «Экраны» и снимок прежней правки для отмены.
import { arenaObjectScreens, arenaObjects } from "@modovik/climb-contract/recolor/arena-objects";
import { ARENA_SLOT_DEFAULTS, arenaSlotElements } from "@modovik/climb-contract/recolor/arenas";
import { normalizeSlotTransform } from "@modovik/climb-contract/recolor/arena-slots";
import { entityBounds } from "./arena-items.js";

const SLOT_KIND = "screens";
const SCREEN_FIELDS = ["key", "place", "label"];

// Обычные форматы полотна: пара «длинная : короткая» и её частное, посчитанное один раз.
const FORMATS = [[1, 1], [5, 4], [4, 3], [3, 2], [16, 9], [2, 1], [3, 1], [21, 9]].map((pair) => ({
  pair,
  span: pair[0] / pair[1],
}));
const FORMAT_TOLERANCE = 0.04;

// Ближайший обычный формат; если ни один не подошёл, длинная сторона с одним знаком после запятой.
function snapPair(quotient) {
  for (const { pair, span } of FORMATS) {
    if (Math.abs(quotient / span - 1) <= FORMAT_TOLERANCE) return pair;
  }
  return [Math.round(quotient * 10) / 10, 1];
}

const sized = (w, h) => ({ w, h, label: `${w}:${h}` });

export function massRatio(panel) {
  const { width, height } = panel ?? {};
  const across = Number(width);
  const down = Number(height);
  if (!(Math.min(across, down) > 0)) return null;

  const [major, minor] = snapPair(Math.max(across, down) / Math.min(across, down));
  return across < down ? sized(minor, major) : sized(major, minor);
}

// Имя рода: подпись без одного хвостового номера, который отделён хотя бы одним пробельным знаком.
function familyName(label) {
  const text = String(label || "");
  let cut = text.length;
  while (cut > 0 && text[cut - 1] >= "0" && text[cut - 1] <= "9") cut -= 1;
  if (cut === text.length) return text;
  const head = text.slice(0, cut);
  const bare = head.trimEnd();
  return bare.length < head.length ? bare : text;
}

// Комната экрана — комната первой вещи описи, на которой он стоит (null тоже занимает место).
function claimedRooms(server, asset) {
  const boxes = entityBounds(asset);
  const items = arenaObjects(server)?.items ?? [];
  const rooms = new Map();
  for (const item of items) {
    const box = boxes.get(item.key);
    if (!box) continue;
    for (const screen of arenaObjectScreens(server, box)) {
      if (!rooms.has(screen.key)) rooms.set(screen.key, item.room ?? null);
    }
  }
  return rooms;
}

function describeScreen(slot, rooms) {
  const copied = Object.fromEntries(SCREEN_FIELDS.map((name) => [name, slot[name]]));
  return { ...copied, room: rooms.get(slot.key) ?? null, panel: slot.panel || null };
}

function firstRatio(panels) {
  for (const panel of panels) {
    const ratio = massRatio(panel);
    if (ratio) return ratio;
  }
  return null;
}

const compareCodes = (a, b) => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

const byPopularity = (a, b) => b.elements.length - a.elements.length || compareCodes(a.id, b.id);

export function massScreenTypes(server, asset) {
  const slots = arenaSlotElements(server, SLOT_KIND);
  const { length } = slots;
  if (!length) return [];

  const rooms = claimedRooms(server, asset);
  const tagged = Array.from(slots, (slot) => ({ family: familyName(slot.label), slot }));
  const names = [...new Set(tagged.map((entry) => entry.family))];
  const families = names.map((id) => {
    const members = tagged.filter((entry) => entry.family === id).map((entry) => entry.slot);
    return {
      id,
      label: id,
      ratio: firstRatio(members.map((slot) => slot.panel)),
      elements: members.map((slot) => describeScreen(slot, rooms)),
    };
  });
  return families.sort(byPopularity);
}

export function massRoomCount(group) {
  const distinct = group.elements.reduce((rooms, element) => (element.room === null ? rooms : rooms.add(element.room)), new Set());
  return distinct.size;
}

export function massTargets(groups, chosen, excluded) {
  const screens = groups.reduce((all, group) => (chosen.has(group.id) ? all.concat(group.elements) : all), []);
  const kept = [];
  for (const screen of screens) {
    if (!excluded.has(screen.key)) kept.push(screen);
  }
  return kept;
}

export function massLook(image, fit) {
  const transform = normalizeSlotTransform({ fit }, ARENA_SLOT_DEFAULTS.screens);
  return { mode: "image", image, transform };
}

const copyMap = (map) => ({ ...map });

export function massSnapshot(settings) {
  return { elements: copyMap(settings?.elements), places: copyMap(settings?.places) };
}

// Ставит вид на одну цель; ложный вид оставляет экран нетронутым.
function stamp(draft, target, lookOf) {
  const look = lookOf(target);
  if (!look) return;
  draft.elements[target.key] = look;
  draft.places[target.place] = true;
}

// Цели перебираются по правилам перебора: подходит любой перебираемый объект.
export function massPatch(settings, targets, lookOf) {
  const draft = massSnapshot(settings);
  for (const target of targets) stamp(draft, target, lookOf);
  return draft;
}
