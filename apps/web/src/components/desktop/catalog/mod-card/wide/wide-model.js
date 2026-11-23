import { isCatalogBundle } from "../../../../../catalog-utils.js";
import { isReduxPack } from "../../../../../features/catalog/redux-gallery.js";

/*
 * Модель новой карточки ганпака и редукса (Каталог 2.0, часть 2, 13.11.2026): чистые решения без разметки — какой вид карточки, что с галочками стволов,
 * какой сервер у варианта, что открывает «Предпросмотр». Разметка — `WideCard.jsx`, слова — `features/catalog/card-wide-copy.js`.
 */

/** Виды новой карточки. */
export const WIDE_GUN = "gun";
export const WIDE_REDUX = "redux";
/** Пак звуков: справа список звуков с ▶ и карандашом. */
export const WIDE_SOUND = "sound";
/** Остальное (таймцикл, эффекты, одежда, карта…): справа панель «О моде». */
export const WIDE_PLAIN = "plain";

/** Строки состава, что являются стволами (обвесы — отдельной строкой пака, стволом не считаются). */
export const weaponTiles = (contents = []) =>
  contents.filter((tile) => tile?.weapon?.kind === "weapon");

/**
 * Какой вид у карточки: «redux» — сборка-редукс, «gun» — ганпак со стволами в составе, пусто — остальное (старая карточка).
 * Ствол из пака (`domain.weapon` без своего состава) и звуки сюда не входят.
 */
export function wideKindOf(view) {
  const mod = view?.mod;
  if (!mod) return "";
  if (isReduxPack(mod)) return WIDE_REDUX;
  if (isCatalogBundle(mod) || mod.domain?.sound) return "";
  return weaponTiles(view.contents).length > 0 ? WIDE_GUN : "";
}

/**
 * Вид карточки «Пульт» для любого мода: у каждой карточки теперь одна раскладка (сцена сверху, справа панель), поэтому пусто не бывает. Ганпак и редукс — как
 * `wideKindOf`; пак звуков — когда в составе есть звуки; всё остальное — «plain».
 */
export function pultKindOf(view) {
  const wide = wideKindOf(view);
  if (wide) return wide;
  const sounds = (view?.contents ?? []).some((tile) => tile?.sound);
  return sounds ? WIDE_SOUND : WIDE_PLAIN;
}

/**
 * Кадры ганпака: первым стоит обложка пака (баннер, доска `CardGun`), дальше кадры стволов (`stageItems`: у каждого ствола со своей обложкой — кадр с моделью). Фото из поста,
 * YouTube и ролики в сцену не идут (решение владельца 28.10.2026, `ref/23`: у ганпака «только модели стволов»). `cover` — адрес обложки шапки; без него берётся первая картинка
 * полки. Повторы по адресу убираются.
 */
export function gunScene({ shelf = [], stageItems = [], cover = "" }) {
  const images = shelf.filter(
    (frame) =>
      frame?.src &&
      !["video", "youtube", "clip", "placeholder"].includes(frame.type),
  );
  const head = images.find((frame) => frame.src === cover) ?? images[0];
  const own = head ? [{ key: head.src, item: head, name: "", model: "" }] : [];
  const met = new Set();
  return [...own, ...stageItems].filter(
    (entry) =>
      entry.item?.src && !met.has(entry.item.src) && met.add(entry.item.src),
  );
}

/** Кадры, которые можно открыть во весь экран: не заглушка, не ролик YouTube, не наш проигрыватель. */
export const viewableOf = (items) =>
  items
    .map((entry) => entry.item)
    .filter((item) => !["placeholder", "youtube", "clip"].includes(item.type));

/* ---------- галочки стволов ---------- */

/**
 * Состояние галочек ганпака. `canInstall(мод)` — можно ли поставить ствол отдельной записью; ствол без такой записи (нет в каталоге пакетом, скрыт)
 * снять нельзя: тумблер включён и закрыт («Ставится только с паком»). Если таких стволов больше половины, галочек у пака нет вовсе
 * (ТЗ ведущей 13.11.2026). `off` — множество id снятых стволов.
 */
export function gunSelection(tiles, off, canInstall) {
  const base = tiles.map((tile) => ({
    id: tile.mod.id,
    mod: tile.mod,
    weapon: tile.weapon,
    locked: !canInstall(tile.mod),
  }));
  const toggles =
    base.length > 0 &&
    base.filter((row) => row.locked).length * 2 <= base.length;
  const rows = base.map((row) => ({
    ...row,
    on: !toggles || row.locked || !off.has(row.id),
  }));
  const marked = rows.filter((row) => row.on).length;
  return {
    rows,
    toggles,
    total: rows.length,
    marked,
    /* Всё отмечено — «Установить» ставит пак целиком, как раньше. */
    all: marked === rows.length,
    /* Что ставит неполный выбор: отмеченные стволы, у которых есть своя запись, по одному. */
    chosen: rows.filter((row) => row.on && !row.locked).map((row) => row.mod),
  };
}

/**
 * Состояние галочек пака звуков. `entries` — `[{ id, item, facts }]` по строкам пака (`soundWeaponRows`): карабин и карабин MK2 играют один банк и входят одной частью, поэтому
 * часть ставится, пока отмечена хотя бы одна её строка. Галочек нет, пока в паке одна часть. `off` — множество id снятых строк.
 */
export function soundSelection(entries, off) {
  const parts = new Set(entries.map((entry) => entry.item.part.id));
  const toggles = entries.length > 1 && parts.size > 1;
  const rows = entries.map((entry) => ({
    ...entry,
    on: !toggles || !off.has(entry.id),
  }));
  const marked = rows.filter((row) => row.on).length;
  const chosen = [];
  const met = new Set();
  for (const row of rows) {
    const part = row.item.part;
    if (row.on && !met.has(part.id)) {
      met.add(part.id);
      chosen.push(part);
    }
  }
  return {
    rows,
    toggles,
    total: rows.length,
    marked,
    all: marked === rows.length,
    chosen,
  };
}

/**
 * Имя ствола в строке. Если у модели нет записи в таблице игры, таблица называет ствол по голове имени мода («Bloodsnow»), то есть именем самого пака,
 * и все строки выходят одинаковыми: тогда берём хвост имени после « · » («Bloodsnow · револьвер» → «револьвер»).
 */
export function gunTitle(row, packName = "") {
  const name = String(row.weapon?.name ?? "").trim();
  const tail = String(row.mod?.name ?? "")
    .split(" · ")
    .slice(1)
    .join(" · ")
    .trim();
  if (tail && name.toLowerCase() === String(packName).trim().toLowerCase())
    return tail;
  return name || tail || String(row.mod?.name ?? "");
}

/** Новое множество снятых после щелчка по стволу (locked и чужие id не трогаются). */
export function toggledOff(off, id, on) {
  const next = new Set(off);
  if (on) next.delete(id);
  else next.add(id);
  return next;
}

/* ---------- версии и серверы ---------- */

/**
 * Версии карточки по серверам: каждая версия — ровно один из проектов, и проекты разные (GTA 5 RP и Majestic). Тогда в верхней строке стоят чипы серверов и
 * клик по чипу меняет версию. `projectsOf(мод)` — проекты версии (`cardProjectsOf`). Иначе — null: версии (серые таймциклы и т. п.) остаются обычным выбором.
 */
export function serverVariants(variants, projectsOf) {
  if (!Array.isArray(variants) || variants.length < 2) return null;
  const found = variants.map((variant) => {
    const projects = projectsOf(variant);
    return projects.length === 1
      ? { id: variant.id, project: projects[0] }
      : null;
  });
  if (found.some((entry) => !entry)) return null;
  const projects = new Set(found.map((entry) => entry.project.id));
  return projects.size === found.length ? found : null;
}

/* ---------- кадры и предпросмотр ---------- */

/** Какие виды частей умеют открываться в «Предпросмотре» (проверка: `partWorkshopKind` части); порядок — какой берётся первым у редукса, если на кадре не часть. */
export const PREVIEW_PRIORITY = Object.freeze([
  "minimap",
  "timecycle",
  "crosshair",
]);

/** Номер кадра сцены, на котором стоит компонент строки (кадр части редукса или ствола), либо -1. */
export function stageIndexOf(items, id) {
  return items.findIndex(
    (entry) => entry.key === `part:${id}` || entry.key === `weapon:${id}`,
  );
}

const IMAGE_TYPES = new Set(["image"]);

/**
 * Открывает ли нажатие на саму фотографию кадра живой предпросмотр (небо мода, мини-карта, прицел, 3D-модель), а не «фото на весь экран» (владелец, 16.11.2026: «вместо
 * фото — живой предпросмотр»). Только у фото: ролик, сутки листом и YouTube играют сами. `target` — то, что даёт `previewTargetOf` (или `{ type: "mod" }` у мода с
 * предпросмотром). Кадр ганпака без модели (`frame`) и кадр редукса вне частей (обложка, ролик) живого вида не имеют — их фото открывается как раньше. Возвращает
 * `target` или `null`.
 */
export function liveTargetOf({ current, target }) {
  if (!target || !IMAGE_TYPES.has(current?.item?.type)) return null;
  if (target.type === "mod" || target.type === "model") return target;
  if (target.type === "part" && current.key?.startsWith("part:")) return target;
  return null;
}

/** Картинка, что стоит на месте живого предпросмотра, пока он грузится: фото кадра, иначе обложка шапки; пусто — серая плита. */
export function posterOf(item, cover = "") {
  if (item?.src && IMAGE_TYPES.has(item.type)) return item.src;
  return item?.thumbnail || item?.poster || cover || "";
}

/**
 * Что открывает «Предпросмотр» на текущем кадре; null — кнопки нет (кадр — ролик, места нет или у редукса нечего смотреть).
 *   { type: "model", model, name }  — 3D ствола (ганпак, у кадра есть модель);
 *   { type: "frame" }               — кадр во весь экран (ганпак без модели);
 *   { type: "part", kind, part }    — предпросмотр части редукса: кадр части либо, на других кадрах, первая часть с видом из `PREVIEW_PRIORITY`.
 * `kindOfPart(часть)` — вид части для предпросмотра или пусто.
 */
export function previewTargetOf({ kind, current, contents = [], kindOfPart }) {
  if (!current) return null;
  /* Ствол мода (не пак) тоже крутится в 3D: у кадра с моделью «Предпросмотр» открывает её. */
  if (kind === WIDE_PLAIN)
    return current.model
      ? { type: "model", model: current.model, name: current.name || "" }
      : null;
  if (kind === WIDE_GUN) {
    if (current.model)
      return { type: "model", model: current.model, name: current.name || "" };
    return IMAGE_TYPES.has(current.item?.type) ? { type: "frame" } : null;
  }
  if (kind !== WIDE_REDUX) return null;
  const parts = contents
    .filter(
      (tile) => tile?.mod && !tile.separate && !tile.weapon && !tile.piece,
    )
    .map((tile) => tile.mod);
  const previewKind = (part) => {
    const found = kindOfPart(part);
    return PREVIEW_PRIORITY.includes(found) ? found : "";
  };
  if (current.key?.startsWith("part:")) {
    const own = parts.find((part) => `part:${part.id}` === current.key);
    return own && previewKind(own)
      ? { type: "part", kind: previewKind(own), part: own }
      : null;
  }
  /* Кадр не части (обложка, ролик): предпросмотр первой части, у которой он есть. */
  for (const wanted of PREVIEW_PRIORITY) {
    const part = parts.find((one) => previewKind(one) === wanted);
    if (part) return { type: "part", kind: wanted, part };
  }
  return null;
}
