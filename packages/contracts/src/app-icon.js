/*
 * Значок приложения (ТЗ владельца 29.10.2026, п. 7 и 29.10-c): «Настройки → Внешний вид → Значок приложения».
 *
 * Знак у Astral один — звезда. Значок — это звезда выбранного цвета на плашке (штатной тёмной, одного цвета или
 * градиента из двух) либо звезда без плашки, крупнее: «Без фона». Готовые раскраски (`APP_ICONS`) — это тёмная плашка и
 * звезда в цветах акцентов интерфейса (`features/appearance/look.js`); всё остальное — «свой» значок (`custom`).
 *
 * Значок меняется только на этом ПК: окно и панель задач (`BrowserWindow.setIcon`), ярлыки на рабочем столе и в «Пуске»
 * (`shell.writeShortcutLink`, значок лежит в папке данных, права администратора не нужны). «Штатный» — значок самой
 * программы, без подмены.
 *
 * Один SVG (`appIconSvg`) на всё: окно рисует по нему живое превью, главный процесс — png и ico
 * (`apps/desktop/src/app-icon-render.js`, в отдельном потоке), сборка готовых раскрасок (`scripts/build-app-icons.js`).
 * Поэтому превью в окне и значок в панели задач — одно и то же изображение, а не два похожих.
 *
 * Выбор приходит из окна строкой: id готовой раскраски или JSON `{ star, back, from, to, transparent }`; цвета проходят
 * проверку `#rrggbb`, и в SVG, и в имя файла попадает только она.
 */

import { APP_ICON_MARK } from "./app-icon-mark.js";

export const DEFAULT_APP_ICON = "default";
/** Выбор, у которого нет готовой раскраски: любой свой цвет звезды, фон или «Без фона». */
export const CUSTOM_APP_ICON = "custom";

/** `id` — имя файла готовой раскраски в `apps/desktop/src/app-icons/` и `apps/web/public/assets/app-icons/`, `hex` — цвет звезды. */
export const APP_ICONS = Object.freeze([
  Object.freeze({ id: "default", hex: "#ffffff" }),
  Object.freeze({ id: "sand", hex: "#dccaa5" }),
  Object.freeze({ id: "peach", hex: "#e8b48f" }),
  Object.freeze({ id: "rose", hex: "#e6a9c2" }),
  Object.freeze({ id: "lavender", hex: "#b9a9ec" }),
  Object.freeze({ id: "sky", hex: "#9fc0ea" }),
  Object.freeze({ id: "sage", hex: "#a9cba1" }),
]);

export const APP_ICON_IDS = Object.freeze(APP_ICONS.map((icon) => icon.id));

/** Плашка: штатная тёмная со свечением цвета звезды, один цвет или градиент из двух. */
export const APP_ICON_BACKS = Object.freeze(["plate", "solid", "gradient"]);

export const APP_ICON_PLATE = Object.freeze({ from: "#171b31", middle: "#090b19", to: "#02030b" });

export const DEFAULT_APP_ICON_LOOK = Object.freeze({
  star: "#ffffff",
  back: "plate",
  from: APP_ICON_PLATE.from,
  to: APP_ICON_PLATE.to,
  transparent: false,
});

/** Что угодно → id значка из списка; незнакомое — штатный. */
export function normalizeAppIcon(value) {
  return APP_ICON_IDS.includes(value) ? value : DEFAULT_APP_ICON;
}

/** `#rgb` и `#rrggbb` в любом регистре → `#rrggbb`; всё прочее — запасное значение. */
export function normalizeAppIconHex(value, fallback = "") {
  const text = String(value ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${[...text.slice(1)].map((char) => char + char).join("")}`;
  return fallback;
}

/** Готовая раскраска → её настройки. Незнакомый id — штатный значок. */
export function appIconLookOf(id) {
  const icon = APP_ICONS.find((item) => item.id === id) || APP_ICONS[0];
  return Object.freeze({ ...DEFAULT_APP_ICON_LOOK, star: icon.hex });
}

/**
 * Что угодно → настройки значка. Принимает id готовой раскраски, объект, строку с JSON и прежний вид `{ id }`
 * (файл выбора, записанный до «своего значка»). Лишнее и нечисловое отбрасывается, незнакомое — штатный.
 */
export function normalizeAppIconLook(value) {
  let source = value;
  if (typeof source === "string") {
    const text = source.trim();
    if (!text.startsWith("{")) return appIconLookOf(text);
    try {
      source = JSON.parse(text);
    } catch {
      return DEFAULT_APP_ICON_LOOK;
    }
  }
  if (!source || typeof source !== "object") return DEFAULT_APP_ICON_LOOK;
  if (typeof source.id === "string" && source.star === undefined) return appIconLookOf(source.id);
  return Object.freeze({
    star: normalizeAppIconHex(source.star, DEFAULT_APP_ICON_LOOK.star),
    back: APP_ICON_BACKS.includes(source.back) ? source.back : DEFAULT_APP_ICON_LOOK.back,
    from: normalizeAppIconHex(source.from, DEFAULT_APP_ICON_LOOK.from),
    to: normalizeAppIconHex(source.to, DEFAULT_APP_ICON_LOOK.to),
    transparent: source.transparent === true,
  });
}

/** Настройки → id готовой раскраски, если они ровно её, иначе `custom`. Цвет плашки без плашки не имеет значения. */
export function appIconId(value) {
  const look = normalizeAppIconLook(value);
  if (look.transparent || look.back !== "plate") return CUSTOM_APP_ICON;
  return APP_ICONS.find((icon) => icon.hex === look.star)?.id || CUSTOM_APP_ICON;
}

/**
 * Короткий ключ настроек: из него имя файла «своего» значка. Одинаковый вид — одинаковый ключ, новый вид — новое имя,
 * поэтому Проводник не показывает старую картинку из кэша значков. Ненужные поля (цвета плашки, когда плашки нет) не входят.
 */
export function appIconKey(value) {
  const look = normalizeAppIconLook(value);
  const hex = (color) => color.slice(1);
  if (look.transparent) return `t-${hex(look.star)}`;
  if (look.back === "solid") return `s-${hex(look.star)}-${hex(look.from)}`;
  if (look.back === "gradient") return `g-${hex(look.star)}-${hex(look.from)}-${hex(look.to)}`;
  return `p-${hex(look.star)}`;
}

/** Звезда: на плашке — как у штатного значка, без плашки — почти во весь значок (граница маски шире звезды на пару пикселей). */
const STAR_WIDTH = Object.freeze({ plate: 286, bare: 486 });

function starBox(transparent) {
  const width = transparent ? STAR_WIDTH.bare : STAR_WIDTH.plate;
  const height = (width * APP_ICON_MARK.height) / APP_ICON_MARK.width;
  return { x: (512 - width) / 2, y: (512 - height) / 2, width, height };
}

/** Плашка значка: фигура со скруглёнными углами, её заливка и тонкая кромка. Пустая строка — плашки нет. */
function plateSvg(look) {
  const rect = (extra) => `<rect x="14" y="14" width="484" height="484" rx="118" ${extra}/>`;
  const edge = (color, opacity) =>
    `<rect x="14.75" y="14.75" width="482.5" height="482.5" rx="117.25" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1.5"/>`;
  const diagonal = `x1="52" y1="34" x2="458" y2="488" gradientUnits="userSpaceOnUse"`;
  if (look.back === "solid") return { defs: "", body: `${rect(`fill="${look.from}"`)}${edge("#ffffff", ".18")}` };
  if (look.back === "gradient") {
    return {
      defs: `<linearGradient id="back" ${diagonal}><stop stop-color="${look.from}"/><stop offset="1" stop-color="${look.to}"/></linearGradient>`,
      body: `${rect('fill="url(#back)"')}${edge("#ffffff", ".18")}`,
    };
  }
  /* Штатная: свечение — цвета звезды, а у белой звезды — штатное синее (так выглядел значок до раскрасок). */
  const glow = look.star === DEFAULT_APP_ICON_LOOK.star ? "#7188ff" : look.star;
  return {
    defs:
      `<linearGradient id="back" ${diagonal}><stop stop-color="${APP_ICON_PLATE.from}"/><stop offset="0.52" stop-color="${APP_ICON_PLATE.middle}"/><stop offset="1" stop-color="${APP_ICON_PLATE.to}"/></linearGradient>` +
      `<radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(256 248) rotate(90) scale(258)"><stop stop-color="${glow}" stop-opacity=".24"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>`,
    body: `${rect('fill="url(#back)"')}${edge("#a8b6e8", ".28")}<rect x="15" y="15" width="482" height="482" rx="117" fill="url(#glow)"/>`,
  };
}

/** Значок целиком: SVG 512 × 512. Цвета не из списка проверки заменяются запасными, так что строка безопасна. */
export function appIconSvg(value, { size = 512 } = {}) {
  const look = normalizeAppIconLook(value);
  const plate = look.transparent ? { defs: "", body: "" } : plateSvg(look);
  const box = starBox(look.transparent);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">` +
    `<defs>${plate.defs}<mask id="star" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">` +
    `<image href="${APP_ICON_MARK.href}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="none"/></mask></defs>` +
    `${plate.body}<rect width="512" height="512" fill="${look.star}" mask="url(#star)"/></svg>`
  );
}

/** SVG значка адресом для `<img src>`: окно показывает превью без файлов и без запросов к приложению. */
export function appIconDataUri(value, options) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(appIconSvg(value, options))}`;
}
