import {
  ARENA_ITEM_GROUP_LIMIT,
  arenaItemLooksNeeded,
  setArenaItemLook,
  setArenaItemLooks,
} from "@modovik/climb-contract/recolor/arena-item-looks";
import { withItemElement } from "@modovik/climb-contract/recolor/item-elements";
import { trFill } from "../../../locales/tr-fill.js";

const REFUSAL_TEXT =
  "Разных обликов вещей стало бы {0}, а в одном месте их может быть не больше {1}: выберите меньше разных вещей или верните часть вещей к игре.";

const isElementsLook = (look) => look?.kind === "elements";

// Пары «лист, ложится ли картинка вокруг вещи»: у вещи с обёрткой картинка идёт
// на все её листы, у остальных — только на главный.
function layersFor(main, lead, coverOf) {
  const sheets = main.wrap && typeof coverOf === "function" ? coverOf(lead) : null;
  if (Array.isArray(sheets) && sheets.length > 0) return sheets.map((texture) => [texture, true]);
  return [[main.texture, false]];
}

export function pictureOnMainElements({ picture, mainOf, canElements, fit = "cover", coverOf = null }) {
  const skipped = new Set();
  const mainFor = (lead) => (canElements(lead) ? mainOf(lead) : null);

  const look = (model, keys, current) => {
    const lead = keys[0];
    const main = mainFor(lead);
    if (main) {
      return layersFor(main, lead, coverOf).reduce(
        (acc, [texture, around]) =>
          withItemElement(acc, around ? { texture, picture, fit, around } : { texture, picture, fit }),
        isElementsLook(current) ? current : null,
      );
    }
    skipped.add(model);
    return undefined;
  };

  return { look, skipped };
}

const reasonOf = (error) => {
  const message = error?.message;
  return message ? message : String(error);
};

// Исход одной попытки: { value } или { reason }. Исключение сразу и отказ обещания равнозначны.
const outcomeOf = (run) =>
  new Promise((resolve) => resolve(run())).then(
    (value) => ({ value }),
    (error) => ({ reason: reasonOf(error) }),
  );

// Шаги идут по одному: следующий начинается, когда предыдущий завершился.
async function inTurn(items, step) {
  const results = [];
  for (const item of items) results.push(await step(item));
  return results;
}

export async function colourOnEach({ keys, modelOf, paint }) {
  // модель -> первая вещь набора; modelOf зовётся и для проверки, и для записи новой модели
  const leaders = [...keys].reduce(
    (seen, key) => (seen.has(modelOf(key)) ? seen : seen.set(modelOf(key), key)),
    new Map(),
  );

  const outcomes = new Map(
    await inTurn([...leaders], async ([model, key]) => [model, await outcomeOf(() => paint(key))]),
  );

  return {
    look: (model) => outcomes.get(model)?.value,
    failed: new Map(
      [...outcomes].filter(([, outcome]) => "reason" in outcome).map(([model, outcome]) => [model, outcome.reason]),
    ),
  };
}

export function itemSetRefusal(needed, limit) {
  return trFill(REFUSAL_TEXT, needed, limit);
}

export function applyItemLook(items, keys, look, modelOf, part = null) {
  // с частью набор не делится по модели, и число в отказе — длина списка плюс один
  const plan = part
    ? {
        place: () => setArenaItemLook(items, keys, look, modelOf, part),
        needed: () => (items?.length ?? 0) + 1,
      }
    : {
        place: () => setArenaItemLooks(items, keys, look, modelOf),
        needed: () => arenaItemLooksNeeded(items, keys, look, modelOf),
      };

  const groups = plan.place();
  if (groups) return { items: groups };
  return { refusal: itemSetRefusal(plan.needed(), ARENA_ITEM_GROUP_LIMIT) };
}
