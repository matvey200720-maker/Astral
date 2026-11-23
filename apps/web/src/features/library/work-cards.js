import { installNamesLine } from "../../workshop-library.js";
import { WORK_KINDS } from "../workshop/works/work-kinds.js";

/*
 * Одна вещь — одна карточка: мера библиотеки и в сборках (31.10.2026, владелец: в библиотеке «Грустный v3 Big Map, Halloween 2026» одной карточкой, а
 * в окне сборки — две отдельные).
 *
 * Библиотека держит по карточке на плитку полки: уточняющие плитки карт ведут в ту же карточку, а две установки на одной плитке называются обе
 * (`marksFromUnits`). Сборка раньше показывала запись на установку и на каждую плитку, которую установка занимает. Теперь и работы кода сборки, и
 * установки мастерской сводятся той же мерой; ставятся они все, как и прежде: карточка — это показ, а не состав.
 *
 * Вид «по стволу» (скин, покраска) — на каждый ствол своя карточка, как на полке. Звуки — по плиткам: стволы и попадания в голову и тело на полке
 * стоят порознь.
 */

/* Плитка карточки: уточняющие плитки ведут в ту же (`reduxDetailSlotIdsFor`). */
const CARD_SLOT = Object.freeze({
  "minimap-zoom": "minimap",
  "minimap-position": "minimap",
  "large-map-zoom": "large-map",
});

const SLOT_CARDS = new Set(["sound"]);

/** По чему работы сводятся в одну карточку. */
export function workCardKey({ workKind = "", slotId = "" } = {}) {
  const slot = CARD_SLOT[slotId] || slotId;
  return WORK_KINDS[workKind]?.perSlot || SLOT_CARDS.has(workKind) || !WORK_KINDS[workKind] ? `${workKind}:${slot}` : workKind;
}

/**
 * Карточки из работ (`[{ workKind, slotId, name, … }]`: записи кода сборки или установки мастерской): первая из сведённых работ и есть карточка, её
 * картинка — её снимок; имя — обе работы, как у библиотеки; `parts` — все сведённые. `order` — имена в порядке установок: кто стоит первым,
 * тот и на картинке библиотеки.
 */
export function mergeWorkCards(list = [], { order = [] } = {}) {
  const groups = new Map();
  for (const entry of list) {
    const key = workCardKey(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const rank = (entry) => {
    const place = order.indexOf(entry.name);
    return place < 0 ? order.length : place;
  };
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const parts = [...group].sort((left, right) => rank(left) - rank(right));
    return { ...parts[0], name: installNamesLine(parts.map((part) => part.name)), parts };
  });
}
