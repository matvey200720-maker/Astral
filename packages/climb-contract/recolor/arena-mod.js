/*
 * Арена мода в мастерской (Хелпер 7, 25.10.2026): «Редактировать» у арены каталога открывает не штатную арену сервера, а
 * готовый зал самого мода — его модели и его листы, — и листы мода можно менять.
 *
 * Работа несёт `project.mod`: какой мод открыт и что человек сделал с его листами. Лист назван по игровому имени
 * текстуры (строчными): один лист ложится на все модели мода, где он стоит. Правка листа — свой цвет (тоном по светотени
 * листа, у плашки до 8 пикселей — ровным цветом, как у штатных поверхностей), своя картинка на весь лист (28.10.2026, «замена листа»: лист
 * целиком заменяется картинкой, растянутой по развёртке) или «Убрать» (лист прозрачный).
 *
 * Установка (`apps/desktop/src/recolor-arena-mod.js`) правит те же листы в файлах поставленного мода и кладёт их под тем же
 * именем поверх него; кадр редактора рисует то же самое (`arena-mod-stage.js`).
 */

import { normalizeRecolourHex } from "./colour.js";

export const ARENA_MOD_MODES = Object.freeze(["colour", "image", "hidden"]);
/* Своя картинка листа лежит в хранилище окна под отпечатком (как эмблемы ангара и картинки мест студии арены). */
const IMAGE_ASSET = /^hangar-emblem:[a-f0-9]{64}$/;
/* Зал мода — до пары сотен листов (у 314 — 250); с запасом, но работа не должна раздуваться до мегабайт. */
export const ARENA_MOD_SHEET_LIMIT = 600;
/* Имя листа в игре: то же правило, что у чтения листов (`workshop-textures.js`). */
export const ARENA_MOD_SHEET_NAME = /^[a-z0-9_.+-]{1,160}$/;
const ID_LIMIT = 96;
const NAME_LIMIT = 80;
/* Лист не больше 8 пикселей — «плашка»: цвет ей даётся ровной заливкой, а не тоном по светотени. */
export const ARENA_MOD_PLATE_SIDE = 8;

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

/**
 * Правка одного листа: `{ mode: "colour", colour }`, `{ mode: "image", image: { asset, name, width, height } }` (своя картинка на весь лист —
 * «растянуть», как у кадра и установщика) или `{ mode: "hidden" }`; иначе — `null` (лист как у мода). Режим «картинка» без картинки — `null`.
 */
export function normalizeArenaModSheet(input) {
  const source = plain(input);
  if (source.mode === "hidden") return { mode: "hidden" };
  if (source.mode === "colour") return { mode: "colour", colour: normalizeRecolourHex(source.colour, "#2f80ed") };
  if (source.mode === "image") {
    const picture = plain(source.image);
    if (!IMAGE_ASSET.test(String(picture.asset || ""))) return null;
    const side = (value) => Math.round(Math.min(8192, Math.max(1, Number(value) || 1)));
    return { mode: "image", image: { asset: picture.asset, name: String(picture.name || "").slice(0, 80), width: side(picture.width), height: side(picture.height) } };
  }
  return null;
}

/**
 * `project.mod`: `{ id, name, sheets: { имя листа → правка } }` или `null`, если работа не про мод.
 * Лишнее отбрасывается молча; листов больше предела — остаются первые по порядку записи.
 */
export function normalizeArenaMod(input) {
  const source = plain(input);
  const id = String(source.id ?? "").trim().slice(0, ID_LIMIT);
  if (!id) return null;
  const sheets = {};
  for (const [name, look] of Object.entries(plain(source.sheets))) {
    const key = String(name).trim().toLowerCase();
    if (!ARENA_MOD_SHEET_NAME.test(key) || Object.keys(sheets).length >= ARENA_MOD_SHEET_LIMIT) continue;
    const normal = normalizeArenaModSheet(look);
    if (normal) sheets[key] = normal;
  }
  return { id, name: String(source.name ?? "").trim().slice(0, NAME_LIMIT), sheets };
}

/** Есть ли у работы хоть одна правка листа мода: без неё «Применить» снимает файлы Astral. */
export const arenaModIsStock = (mod) => !mod || !Object.keys(mod.sheets || {}).length;

/** Отпечаток для очереди «Применить»: мод и его правки в стабильном порядке; без правок — `null`. */
export function arenaModSignature(mod) {
  if (arenaModIsStock(mod)) return null;
  return {
    id: mod.id,
    sheets: Object.keys(mod.sheets)
      .sort()
      .map((name) => [name, mod.sheets[name].mode, mod.sheets[name].colour || "", mod.sheets[name].image?.asset || ""]),
  };
}

/**
 * Ключ своей картинки листа у главного процесса: `mod:<лист>` (в окне и в установщике одни и те же, `arenaImageAssets`).
 */
export const arenaModImageKey = (sheet) => `mod:${sheet}`;

/** `{ лист → asset }` — листы мода со своей картинкой (для `arenaImageAssets`). */
export function arenaModSheetImages(mod) {
  const out = {};
  for (const [name, look] of Object.entries(mod?.sheets || {})) if (look.mode === "image" && look.image?.asset) out[name] = look.image.asset;
  return out;
}

/*
 * Остров «весь лист» для картинки: вся развёртка, без поворота; `aspect` — пропорция листа (от неё зависит «положить»).
 */
const WHOLE_SHEET = (aspect) => [{ rect: [0, 0, 1, 1], swap: false, flipU: false, flipV: false, aspect }];

/**
 * Что делать с листом мода при установке (формат `sheetPixels`): `{ tint }` — тон по светотени, `{ flat }` — ровный цвет
 * плашки (`rgb` — три числа), `{ transparent }` — убрано, `{ image, islands, transform }` — своя картинка на весь лист (`picture` —
 * `{ rgba, width, height }`, `aspect` — пропорция листа). `null` — лист как у мода. `plate` — лист не больше 8 пикселей: картинку плашка не несёт.
 */
export function arenaModOp(look, { plate = false, rgb = null, picture = null, aspect = 1 } = {}) {
  if (!look) return null;
  if (look.mode === "hidden") return { transparent: true };
  if (look.mode === "image") return picture && !plate ? { image: picture, islands: WHOLE_SHEET(aspect), transform: { fit: "stretch", background: "clear" } } : null;
  if (look.mode !== "colour") return null;
  return plate && rgb ? { flat: rgb } : { tint: look.colour };
}

/**
 * Облик материала зала мода в кадре (формат `ModelStage.look`): `info.sheet` — игровое имя листа материала, `info.colour` — его
 * средний цвет, `info.texture` — есть ли у материала картинка (без неё — плашка). Правки нет — `null`, кадр оставляет облик зала.
 */
export function arenaModFrameLook(mod, info) {
  const look = mod?.sheets?.[String(info?.sheet || "")];
  if (!look) return null;
  if (look.mode === "hidden") return { colour: info.colour, visible: false };
  return info.texture == null
    ? { colour: look.colour, map: false }
    : { colour: info.colour, tint: { colour: look.colour, ref: 0.5, brightness: 1 } };
}
