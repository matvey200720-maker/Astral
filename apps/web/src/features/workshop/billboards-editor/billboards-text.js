/*
 * Слова редактора «Билборды» — отдельно от компонентов: их берут кадр,
 * колонка правок, шаблоны, «Где стоят» и обложка.
 */

import {
  BILLBOARD_DISTRICTS,
  BILLBOARD_GLOWING,
  BILLBOARD_KIND_LABELS,
  BILLBOARD_LIST,
  BILLBOARD_MODES,
  BILLBOARD_MODE_LABELS,
  BILLBOARD_SHIELD_IDS,
  BILLBOARD_SHIELD_KINDS,
  BILLBOARDS_INVENTORY,
  billboard,
  billboardDirection,
  billboardIsOwn,
  billboardIsShield,
  billboardKind,
  billboardLiveState,
  billboardLookIsStock,
  billboardLookOf,
  linkedBillboards,
} from "@modovik/climb-contract/recolor/billboards";
import { tr, trAny } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import { BOARD_WORDS, countedIn } from "../counted-words.js";

export { trFill };

export const BILLBOARD_SWATCHES = Object.freeze([
  "#f4f2ec",
  "#e9e5dc",
  "#c9ccd1",
  "#6b7078",
  "#121317",
  "#2f80ed",
  "#22d3ee",
  "#27ae60",
  "#f2c94c",
  "#e8590c",
  "#e30613",
  "#ff2bd6",
]);

/* Режим щита — списком: четыре подписи в сегменты панели не влезают. */
export const MODE_OPTIONS = Object.freeze(BILLBOARD_MODES.map((mode) => [mode, BILLBOARD_MODE_LABELS[mode]]));
export const DIRECTION_OPTIONS = Object.freeze([
  { value: "right", label: "Слева направо" },
  { value: "down", label: "Сверху вниз" },
]);

const decimal = (value, digits = 1) => String(Math.round(Number(value) * 10 ** digits) / 10 ** digits).replace(".", ",");

/** «14,4 × 6,7 м». */
export const sizeText = (board) => `${decimal(board.size[0])} × ${decimal(board.size[1])} ${tr("м")}`;
/** «1024 × 480 px». */
export const pixelsText = ([width, height]) => `${width} × ${height} px`;
/** «2,1 : 1». */
export const aspectText = (width, height) => `${decimal(width / Math.max(0.01, height), 2)} : 1`;
/* «100 %» — с неразрывным пробелом: число и знак не расходятся по строкам (`design-qa.md`, п. 18). */
export const percentText = (value) => `${Math.round(value)}\u00a0%`;

/** «3 щита» — на языке окна, по его правилу числа (`counted-words.js`). */
export const boardsText = (count) => countedIn(count, BOARD_WORDS);

/* Вид полотна одним словом — в строке щита. */
const KIND_WORDS = Object.freeze({ board: "щит", roof: "щит на крыше", banner: "баннер", vertical: "вертикальное полотно", giant: "во всю стену" });

/** Строка щита: «щит на крыше · смотрит на юг · 14,4 × 6,7 м · светится ночью». */
export function boardLine(board) {
  return [tr(KIND_WORDS[billboardKind(board)]), trFill("смотрит на {0}", tr(billboardDirection(board))), sizeText(board), board.glow ? tr("светится ночью") : ""].filter(Boolean).join(" · ");
}

/* Виды щитов в фильтре — коротко, в одну строку колонки («Щиты на крышах» переносило фильтр на вторую). */
const KIND_CHIPS = Object.freeze({ board: "Щиты", roof: "На крышах" });

/** Виды полотен — фильтром «Где стоят»: `[{ value, label, count }]` (подписи — в месте отрисовки). */
export function kindOptions(counts) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return [{ value: "all", label: tr("Все"), count: total }, ...BILLBOARD_SHIELD_KINDS.map((kind) => ({ value: kind, label: tr(KIND_CHIPS[kind] || BILLBOARD_KIND_LABELS[kind]), count: counts[kind] || 0 }))];
}

/** Что сейчас на щите — коротко. */
export function lookText(look) {
  if (billboardLookIsStock(look)) return tr("как в игре");
  if (look.mode === "image") return look.image.asset ? (look.image.animation ? tr("гифка") : tr("своя картинка")) : tr("как в игре");
  if (look.mode === "colour") return tr("ровный цвет");
  if (look.mode === "gradient") return tr("градиент");
  const parts = [];
  if (look.brightness !== 100) parts.push(look.brightness < 100 ? tr("тусклее") : tr("ярче"));
  if (look.glow !== 100) parts.push(look.glow === 0 ? tr("без свечения") : look.glow > 100 ? tr("ярче ночью") : tr("тише ночью"));
  return parts.length ? trFill("реклама игры, {0}", parts.join(", ")) : tr("как в игре");
}

/** Гифка щита одним словом: живая плашка играет, остальное — первый кадр на листе. */
export const gifStateWord = (state) => (state === "live" ? tr("играет") : tr("первый кадр"));

/** Что на щите в работе: свой облик или как у всех (у гифки — играет она или стоит первым кадром). */
export function boardStateText(project, id) {
  const look = billboardLookOf(project, id);
  /* «свой облик: …» и «как у всех: как в игре» — жаргон и двойное «как»: своё — что именно, не своё — «как в игре» или «как у всех». */
  const text = billboardIsOwn(project, id) ? lookText(look) : billboardLookIsStock(look) ? tr("как в игре") : tr("как у всех");
  const state = billboardLiveState(project).states.get(id);
  return state ? `${text}, ${gifStateWord(state)}` : text;
}

/** Почему гифка щита играет или стоит первым кадром (состояние — `billboardLiveState`); `limit` — живых щитов на работу. */
export function gifStateNote(state, limit) {
  if (state === "live") return tr("Гифка играет: перед полотном встанет живая плашка, пока видна ближняя модель щита; вдали и на листе — первый кадр.");
  if (state === "limit") return trFill("Живых щитов уже {0} — предел. Этот щит покажет первый кадр на листе; чтобы он заиграл, снимите гифку с другого щита.", limit);
  if (state === "weight") return tr("Живые плашки уже весят предельно много — этот щит покажет первый кадр на листе.");
  if (state === "uneven") return tr("Полотно этого щита неровное (выступы или провисшая ткань): плашка легла бы со щелями или внутрь него. Гифка стоит первым кадром на листе.");
  if (state === "shared") return trFill("Гифка «Всех щитов» стоит первым кадром. Играет она на щитах со своей картинкой — положите её на щит в «Одном щите», не больше {0} на работу.", limit);
  return "";
}

/** Сколько щитов с гифкой играют из предела — одной строкой; пусто, пока гифок нет. */
export function gifCountText(project) {
  const { states, live, limit } = billboardLiveState(project);
  const own = [...states.values()].filter((state) => state !== "shared").length;
  return own ? trFill("Играют {0} из {1} щитов с гифкой; предел — {2} на работу.", live.length, own, limit) : "";
}

/* ------------------------------------------------------------------ *
 * Где стоят
 * ------------------------------------------------------------------ */

const normalizeSearch = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();

/**
 * Щиты по районам с поиском: `[{ district, boards }]`. Ищется по району,
 * подписи и коду района игры; пустой поиск — все. `kind` — только щиты
 * этого вида (`all` — все). Большие полотна зданий сюда не входят (ТЗ 24.10.2026):
 * они — в «Баннерах на зданиях».
 */
export function boardsByDistrict(query = "", kind = "all") {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  const match = (board) => {
    if (!billboardIsShield(board)) return false;
    if (kind !== "all" && billboardKind(board) !== kind) return false;
    if (!words.length) return true;
    const haystack = normalizeSearch(`${board.label} ${board.district} ${board.zone} ${board.model}`);
    return words.every((word) => haystack.includes(word));
  };
  return BILLBOARD_DISTRICTS.map(({ district, ids }) => ({ district, boards: ids.map(billboard).filter(match) })).filter((group) => group.boards.length);
}

/** Сколько полотен каждого вида нашёл поиск (без фильтра вида). */
export function kindCounts(query = "") {
  const counts = {};
  for (const group of boardsByDistrict(query)) for (const board of group.boards) counts[billboardKind(board)] = (counts[billboardKind(board)] || 0) + 1;
  return counts;
}

/** Пункты меню над кадром: щиты района взятого щита и переход к поиску. */
export function boardMenuOptions(project, boardId) {
  const current = billboard(boardId);
  const district = BILLBOARD_DISTRICTS.find((item) => item.district === current?.district);
  const options = [{ heading: current?.district || tr("Район") }];
  for (const id of (district?.ids || []).filter((item) => billboardIsShield(billboard(item)))) {
    const board = billboard(id);
    options.push({ value: id, label: board.label, description: `${boardLine(board)} · ${boardStateText(project, id)}` });
  }
  options.push({ separator: true });
  options.push({ value: "__where", label: tr("Все районы — поиск по карте…") });
  return options;
}

/** Соседний щит по порядку описи (по районам): `step` — +1 или −1. Только щиты — полотна зданий правятся в «Баннерах». */
export function siblingBoard(boardId, step) {
  const at = BILLBOARD_SHIELD_IDS.indexOf(boardId);
  const next = (at + step + BILLBOARD_SHIELD_IDS.length) % BILLBOARD_SHIELD_IDS.length;
  return BILLBOARD_SHIELD_IDS[next] || boardId;
}

/** Связанные щиты (та же картинка на листе) — кроме самого. */
export function linkedOthers(boardId) {
  return linkedBillboards(boardId)
    .filter((id) => id !== boardId)
    .map(billboard)
    .filter(Boolean);
}

const overlapping = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1e-4 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1e-4;

/**
 * Щиты других моделей на том же месте листа словаря района, которых
 * установщик разводит своей копией словаря: `[board]`.
 */
export function splitPartners(boardId) {
  const board = billboard(boardId);
  const own = (board?.faces || []).filter((face) => face.split);
  if (!own.length) return [];
  return BILLBOARD_LIST.filter(
    (other) =>
      other.id !== boardId && other.faces.some((face) => own.some((mine) => mine.sheet === face.sheet && mine.arch !== face.arch && overlapping(mine.clip, face.clip))),
  );
}

/*
 * Почему щиты связаны: `sides` — это стороны одного щита (одна модель в
 * одном месте рисует обе стороны одним местом листа), `sheet` — разные щиты
 * берут один лист (модель стоит не раз или словарь района общий).
 */
export function linkKind(boardId) {
  const board = billboard(boardId);
  const others = linkedOthers(boardId);
  const sides = others.every((other) => other.model === board?.model && Math.hypot(other.position[0] - board.position[0], other.position[1] - board.position[1]) < 6);
  return sides ? "sides" : "sheet";
}

/** Сколько щитов в «Билбордах» — в строках окна (полотна зданий — в «Баннерах на зданиях»). */
export const BILLBOARD_TOTAL = BILLBOARD_SHIELD_IDS.length;
/** Сколько из них светится ночью. */
export const BILLBOARD_SHIELD_GLOWING = BILLBOARD_GLOWING.filter((id) => billboardIsShield(billboard(id))).length;
export const BILLBOARD_SCENE_URL = BILLBOARDS_INVENTORY.sceneUrl;
export const sceneUrlOf = (board) => (board?.scene ? `${BILLBOARD_SCENE_URL}/${board.scene.file}` : null);

/* Карта мира щитов (рамка «Где стоят»): игра — от −4000 до 4500 по X, от −4000 до 8000 по Y. */
export const WORLD_BOUNDS = Object.freeze({ minX: -4000, maxX: 4600, minY: -4100, maxY: 8100 });

/*
 * Подпись щита на языке окна — для `aria-label` полей ввода: слой перевода
 * разметки поля ввода не трогает, и «Альта, щит 3» там осталась бы русской.
 */
export const boardLabelText = (board) => (board?.label ? trAny(board.label) || board.label : "");
