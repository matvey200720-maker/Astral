/*
 * Значки карты игры — замена картинки у каждого номера спрайта (задача 05.11.2026, «Иконки» большой карты).
 *
 * Сервер игры ставит метку на карту номером спрайта (73 — магазин одежды, 110 — оружейный магазин…), а рисует её
 * символ `radar_*` из `scaleform_minimap.rpf/minimap.gfx`. Картинка значка — клетка листа
 * `blips_texturesheet_*` в `minimap.ytd`; тот же фильм рисует и мини-карту, и карту паузы, поэтому замена видна и там,
 * и там. Здесь — договор работы, общий для окна и для главного процесса: что человек выбрал для каждого номера.
 *
 * Работа — `{ version: 1, icons: { "<номер спрайта>": правка } }`; правка — один из трёх видов:
 *   { mode: "set", from: <номер> }    — вместо значка встаёт значок другого номера (картинка из листа игры);
 *   { mode: "picture", assetId }      — своя картинка (PNG: белое станет цветом метки, цветное смешается с ним);
 *   { mode: "hidden" }                — значок не рисуется.
 * Нет записи — значок такой, как в игре. В работе лежат только отличия: пустая работа — «как в игре».
 */

export const BLIP_ICONS_VERSION = 1;
export const BLIP_ICON_MODES = Object.freeze(["set", "picture", "hidden"]);
/* Номеров спрайтов в игре около тысячи (таблица `Blips.getListOfBlips` — 973 записи); запас на новые обновления. */
export const BLIP_SPRITE_LIMIT = 1100;
/* Своя картинка — квадрат 64×64 точки листа; окно присылает PNG не крупнее этого. */
export const BLIP_PICTURE_EDGE = 64;

const ASSET_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

const spriteNumber = (value) => {
  const text = String(value ?? "").trim();
  if (!/^\d{1,4}$/.test(text)) return null;
  const number = Number(text);
  return number >= 0 && number < BLIP_SPRITE_LIMIT ? number : null;
};

function normalizeEdit(own, edit) {
  if (!edit || typeof edit !== "object" || Array.isArray(edit)) return null;
  if (edit.mode === "hidden") return { mode: "hidden" };
  if (edit.mode === "set") {
    const from = spriteNumber(edit.from);
    /* Значок, поставленный сам на себя, — не правка. */
    return from === null || from === own ? null : { mode: "set", from };
  }
  if (edit.mode === "picture") {
    const assetId = String(edit.assetId ?? "").trim();
    return ASSET_ID.test(assetId) ? { mode: "picture", assetId } : null;
  }
  return null;
}

/** Работа в каноническом виде: неизвестное отбрасывается, ключи — по возрастанию номера. */
export function normalizeBlipIcons(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value.icons : null;
  const icons = {};
  if (source && typeof source === "object" && !Array.isArray(source)) {
    const numbers = Object.keys(source)
      .map(spriteNumber)
      .filter((number) => number !== null)
      .sort((a, b) => a - b)
      .slice(0, BLIP_SPRITE_LIMIT);
    for (const number of numbers) {
      const edit = normalizeEdit(number, source[number] ?? source[String(number)]);
      if (edit) icons[number] = edit;
    }
  }
  return { version: BLIP_ICONS_VERSION, icons };
}

/** Нет ни одной правки — значки такие, как в игре. */
export const blipIconsWorkIsStock = (work) => Object.keys(normalizeBlipIcons(work).icons).length === 0;

/** Номера, у которых в работе есть правка, по возрастанию. */
export const blipIconNumbers = (work) =>
  Object.keys(normalizeBlipIcons(work).icons)
    .map(Number)
    .sort((a, b) => a - b);

/** Отпечаток для кнопки «Применить»: то, что уходит в игру (картинки — по их ключам). */
export const blipIconsSignature = (work) => JSON.stringify(normalizeBlipIcons(work));

/** Ключи своих картинок работы — окно присылает их байты рядом. */
export const blipIconAssets = (work) => [
  ...new Set(
    Object.values(normalizeBlipIcons(work).icons)
      .filter((edit) => edit.mode === "picture")
      .map((edit) => edit.assetId),
  ),
];

/** Сколько значков заменено, скрыто и подменено своей картинкой. */
export function describeBlipIcons(work) {
  const counts = { set: 0, picture: 0, hidden: 0 };
  for (const edit of Object.values(normalizeBlipIcons(work).icons)) counts[edit.mode] += 1;
  return { ...counts, total: counts.set + counts.picture + counts.hidden };
}

/** Правка одного номера: `null`, если значок как в игре. */
export const blipIconEdit = (work, sprite) => normalizeBlipIcons(work).icons[sprite] ?? null;

/** Работа с правкой номера (`null` — вернуть значок игре); остальное не трогается. */
export function withBlipIconEdit(work, sprite, edit) {
  const current = normalizeBlipIcons(work);
  const icons = { ...current.icons };
  const next = edit ? normalizeEdit(sprite, edit) : null;
  if (next) icons[sprite] = next;
  else delete icons[sprite];
  return normalizeBlipIcons({ icons });
}
