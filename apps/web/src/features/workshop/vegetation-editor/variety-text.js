/*
 * Слова и числа «В разнобой» (задача 7 ТЗ 17.10.2026): что уйдёт в игру,
 * сколько весит палитра, доли цветов. Строки — через словарь (`tr`), числа
 * подставляются в переведённый шаблон: подписи окна работают на всех пяти
 * языках.
 */

import VEGETATION_PACKS from "@modovik/climb-contract/recolor/inventory/vegetation-packs";
import {
  VARIETY_GAME,
  VARIETY_MAX_COLOURS,
  VARIETY_TEMPLATES,
  VEGETATION_VARIETY,
  normalizeVariety,
  varietyActive,
  varietySlots,
} from "@modovik/climb-contract/recolor/vegetation";
import { tr } from "../../../locales/ui.js";

const MiB = 1048576;
const thousands = (value) => Math.round(Number(value) || 0).toLocaleString("ru-RU");
const fill = (text, ...values) => values.reduce((out, value, index) => out.replace(`{${index}}`, String(value)), text);

/* Быстрые цвета палитры: слова владельца (жёлтый, розовый, белый) и осень, радуга, сирень. */
export const VARIETY_SWATCHES = Object.freeze(["#f2c94c", "#f2a7c3", "#f4f1ea", "#e67e22", "#c0392b", "#8e44ad", "#2f80ed", "#43a047"]);
/* Новый цвет палитры — первый быстрый, которого в ней ещё нет. */
export function nextVarietyColour(colours) {
  const used = new Set(colours.map((item) => item.colour));
  return VARIETY_SWATCHES.find((colour) => !used.has(colour)) || VARIETY_SWATCHES[0];
}

/** Доли палитры в процентах (сумма — 100), в порядке палитры. */
export function varietyShares(input) {
  const { colours } = normalizeVariety(input);
  const total = colours.reduce((sum, item) => sum + item.weight, 0);
  return colours.map((item) => Math.round((item.weight / total) * 100));
}

/* Счёт описи: на один цвет — карты районов и мира (группы). */
const group = (id) => VEGETATION_VARIETY[id === "bushes" ? "bushes" : "trees"] || {};

/*
 * Вес одного цвета на полной игре — сухой прогон 22.10: сжатый выход копий, как в пакете. Деревья — 71 файл
 * (58 моделей, 10 yft, 3 словаря), 158,8 МБ; опись (`slotBytes`) считала их вдвое меньше (91 файл, 71,8 МБ).
 * Кусты — 38 моделей, 21,3 МБ: совпало с описью.
 */
const COLOUR_COST = Object.freeze({
  trees: { copies: 71, bytes: 158.8 * MiB },
  bushes: { copies: 38, bytes: 21.3 * MiB },
});

/**
 * Во что обойдётся палитра: `{ copies, files, megabytes, maps }` — файлов
 * копий (на каждый цвет, кроме первого), всего файлов вместе с картами
 * районов и вес копий и карт в мегабайтах.
 */
export function varietyCost(input) {
  const variety = normalizeVariety(input);
  const extra = Math.max(0, varietySlots(variety).length - 1);
  const parts = [variety.trees && "trees", variety.bushes && "bushes"].filter(Boolean);
  let copies = 0;
  let bytes = 0;
  for (const id of parts) {
    const own = COLOUR_COST[id === "bushes" ? "bushes" : "trees"];
    copies += own.copies * extra;
    bytes += own.bytes * extra;
  }
  /* Карты районов: у кустов их больше всего, у деревьев они почти все — среди них. Трава — карты травы обеих зон. */
  const zones = Object.values(VEGETATION_PACKS.sandy?.zones || {});
  const maps =
    (variety.bushes ? VEGETATION_VARIETY.maps || 0 : variety.trees ? group("trees").maps || 0 : 0) +
    (variety.grass ? zones.reduce((sum, zone) => sum + (zone.grass || 0), 0) : 0);
  const mapBytes =
    (variety.bushes ? VEGETATION_VARIETY.mapBytes || 0 : variety.trees ? group("trees").mapBytes || 0 : 0) +
    (variety.grass ? zones.reduce((sum, zone) => sum + (zone.grassBytes || 0), 0) : 0);
  return { copies, files: copies + (copies ? 1 : 0) + maps, megabytes: Math.max(0, Math.round((bytes + mapBytes) / MiB)), maps };
}

/** Строка «что красится» у выключателя группы. */
export function varietyGroupText(id) {
  if (id === "grass") return tr("Травинки карт травы — пятнами по 6 м своим цветом палитры. Камни и бревна — как были.");
  const own = group(id);
  return fill(
    id === "bushes"
      ? tr("{0} видов кустов, ≈ {1} кустов по миру в {2} картах районов; живые изгороди — как в игре")
      : tr("{0} видов деревьев, ≈ {1} деревьев по миру в {2} картах районов"),
    own.archetypes || 0,
    thousands(own.entities),
    thousands(own.maps),
  );
}

/** Сколько уйдёт в игру — одной фразой. */
export function varietyCostText(input) {
  const variety = normalizeVariety(input);
  if (!varietyActive(variety)) return tr("Разнобой выключен — деревья одного вида одного цвета.");
  const { copies, files, megabytes } = varietyCost(variety);
  if (!copies && !variety.grass) return tr("Ни деревья, ни кусты, ни трава не выбраны — красить нечего.");
  const text = fill(tr("В пакет растительности уйдут {0} копий моделей и словарей и карты: ≈ {1} файлов, ≈ {2} МБ."), copies, thousands(files), thousands(megabytes));
  /* Первый цвет — сами модели игры: их листва и карточки вдали красятся, как у «Листвы». */
  const first = varietySlots(variety)[0];
  return variety.trees && first?.colour ? `${text} ${tr("Первым цветом — листва моделей игры и карточки деревьев вдали: ещё около 700 файлов, ≈ 0,5 ГБ.")}` : text;
}

/** Подпись цвета палитры: «Как в игре» или код цвета. */
export const varietyColourLabel = (colour) => (colour === VARIETY_GAME ? tr("Как в игре") : String(colour).toUpperCase());

/** Готовые палитры с переведёнными подписями — в месте отрисовки. */
export const varietyTemplates = () => VARIETY_TEMPLATES.map((item) => ({ ...item, title: tr(item.label), description: tr(item.note) }));

export { VARIETY_GAME, VARIETY_MAX_COLOURS };
