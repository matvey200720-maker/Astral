/*
 * Значки метки над животным (05.11.2026): простые силуэты на сетке 100×100, нарисованные для Astral (не из игры и не из чужих
 * наборов). Цвет подставляется при отрисовке. Окно показывает их в списке выбора и на кадре, главный процесс растеризует в
 * лист метки (`sharp` читает тот же SVG), поэтому в игре значок такой же, как в окне.
 *
 * Силуэты смотрят вправо. Отверстия (глаз рыбы, кольцо) — правило `evenodd`; линии рогов, хвоста и лап рисуются цветом
 * `currentColor` — тем же, что заливка.
 */

import { animalById } from "./catalog.js";

const leg = (x, y, h = 22, w = 6) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.5"/>`;

const LINE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

/* Фигуры значка — внутри одного <g fill=…>. */
const SHAPES = Object.freeze({
  boar:
    '<path d="M20 38 L26 33 L31 38 L37 32 L43 38 L49 32 L55 38 L61 33 L67 39 L67 66 L20 66 Z"/>' +
    '<ellipse cx="46" cy="52" rx="29" ry="17"/><ellipse cx="79" cy="54" rx="13" ry="11.5"/>' +
    '<rect x="86" y="52" width="12" height="9" rx="4"/><path d="M82 62 L88 74 L90 62 Z"/>' +
    '<path d="M70 41 L74 28 L82 44 Z"/>' +
    leg(24, 62, 24) + leg(35, 62, 24) + leg(58, 62, 24) + leg(69, 62, 24) +
    '<path d="M18 48 C8 46 6 36 12 32 C10 38 14 42 20 44 Z"/>',
  deer:
    '<ellipse cx="44" cy="58" rx="25" ry="13"/><path d="M60 54 L70 24 L80 26 L72 62 Z"/>' +
    '<ellipse cx="82" cy="24" rx="9" ry="6.5" transform="rotate(-18 82 24)"/>' +
    `<path ${LINE} stroke-width="3.4" d="M78 18 L73 4 M73 4 L66 7 M75 12 L68 12 M86 17 L91 3 M91 3 L98 6 M89 11 L96 11"/>` +
    leg(24, 62, 28, 5) + leg(34, 62, 28, 5) + leg(54, 62, 28, 5) + leg(63, 62, 28, 5) +
    '<path d="M20 52 L12 44 L22 46 Z"/>',
  rabbit:
    '<ellipse cx="46" cy="62" rx="27" ry="20"/><circle cx="76" cy="48" r="13"/>' +
    '<ellipse cx="71" cy="22" rx="5" ry="18" transform="rotate(-8 71 22)"/><ellipse cx="85" cy="25" rx="5" ry="16" transform="rotate(12 85 25)"/>' +
    '<circle cx="19" cy="62" r="8"/><ellipse cx="46" cy="80" rx="14" ry="6"/>',
  dog:
    '<rect x="20" y="42" width="52" height="24" rx="12"/><ellipse cx="80" cy="40" rx="12" ry="10.5"/>' +
    '<rect x="86" y="39" width="12" height="9" rx="4"/><path d="M72 34 L82 30 L78 52 Z"/>' +
    '<path d="M24 48 L10 30 L16 27 L30 44 Z"/>' +
    leg(24, 62, 24) + leg(34, 62, 24) + leg(56, 62, 24) + leg(66, 62, 24),
  cat:
    '<ellipse cx="44" cy="63" rx="26" ry="16"/><circle cx="76" cy="46" r="12.5"/>' +
    '<path d="M66 40 L68 22 L78 35 Z"/><path d="M78 35 L87 22 L89 41 Z"/>' +
    `<path ${LINE} stroke-width="7" d="M18 62 C2 58 2 30 14 27"/>` +
    leg(30, 68, 18) + leg(40, 68, 18) + leg(56, 68, 18) + leg(66, 68, 18),
  cow:
    '<rect x="18" y="32" width="62" height="32" rx="10"/><rect x="76" y="36" width="20" height="18" rx="6"/>' +
    `<path ${LINE} stroke-width="3.4" d="M80 36 L78 26 M92 36 L96 26"/>` +
    '<path d="M78 40 L70 46 L80 48 Z"/>' +
    leg(24, 60, 26, 7) + leg(36, 60, 26, 7) + leg(60, 60, 26, 7) + leg(70, 60, 26, 7) +
    '<path d="M18 38 L8 52 L14 54 L22 42 Z"/>',
  pig:
    '<ellipse cx="46" cy="56" rx="30" ry="21"/><circle cx="82" cy="54" r="13"/><ellipse cx="94" cy="57" rx="5" ry="6.5"/>' +
    '<path d="M76 44 L82 32 L90 46 Z"/>' +
    leg(26, 68, 16, 7) + leg(38, 68, 16, 7) + leg(56, 68, 16, 7) + leg(68, 68, 16, 7) +
    '<path d="M18 50 C8 48 6 38 12 36 C12 42 16 44 20 46 Z"/>',
  bird:
    '<path d="M4 44 L28 52 L26 62 L6 62 Z"/><ellipse cx="50" cy="56" rx="26" ry="17"/><circle cx="76" cy="40" r="11.5"/>' +
    '<path d="M86 36 L99 42 L86 47 Z"/>' +
    `<path ${LINE} stroke-width="3.4" d="M44 72 L44 88 M56 72 L56 88 M38 88 L50 88 M50 88 L62 88"/>`,
  fish:
    '<path fill-rule="evenodd" d="M10 50 a34 18 0 1 0 68 0 a34 18 0 1 0 -68 0 Z M24 44 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 Z"/>' +
    '<path d="M72 50 L98 30 L98 70 Z"/><path d="M36 34 L50 20 L56 34 Z"/>',
  whale:
    '<ellipse cx="44" cy="58" rx="38" ry="22"/>' +
    '<path d="M76 56 C84 52 88 44 86 32 C94 38 99 46 99 54 L92 58 L99 64 C98 70 94 76 86 82 C88 72 84 62 76 60 Z"/>' +
    '<path d="M44 38 C42 28 46 20 52 18 C50 24 52 30 54 38 Z"/>',
  paw:
    '<ellipse cx="50" cy="66" rx="23" ry="18"/><ellipse cx="22" cy="44" rx="8" ry="11" transform="rotate(-22 22 44)"/>' +
    '<ellipse cx="39" cy="28" rx="9" ry="12" transform="rotate(-8 39 28)"/><ellipse cx="61" cy="28" rx="9" ry="12" transform="rotate(8 61 28)"/>' +
    '<ellipse cx="78" cy="44" rx="8" ry="11" transform="rotate(22 78 44)"/>',
  arrow: '<path d="M50 94 L14 52 L38 52 L38 6 L62 6 L62 52 L86 52 Z"/>',
  diamond: '<path d="M50 4 L92 50 L50 96 L8 50 Z"/>',
  ring: '<path fill-rule="evenodd" d="M50 4 a46 46 0 1 0 0.01 0 Z M50 22 a28 28 0 1 1 -0.01 0 Z"/>',
  star: '<path d="M50 4 L62 36 L96 38 L69 59 L79 92 L50 73 L21 92 L31 59 L4 38 L38 36 Z"/>',
});

/** Значки по порядку списка выбора: звери, затем фигуры. */
export const ICON_IDS = Object.freeze(Object.keys(SHAPES));

/** Подпись значка — русский ключ словаря интерфейса. */
export const ICON_NAMES = Object.freeze({
  boar: "Кабан",
  deer: "Олень",
  rabbit: "Кролик",
  dog: "Собака",
  cat: "Кошка",
  cow: "Корова",
  pig: "Свинья",
  bird: "Птица",
  fish: "Рыба",
  whale: "Кит",
  paw: "Лапа",
  arrow: "Стрелка",
  diamond: "Ромб",
  ring: "Кольцо",
  star: "Звезда",
});

/** Значок животного по умолчанию — из его строки в каталоге. */
export const defaultIconFor = (animalId) => animalById(animalId)?.icon || "paw";

/**
 * SVG значка нужного цвета. `currentColor` внутри силуэтов (линии рогов, хвоста) берёт тот же цвет, что заливка.
 * Размер холста 100×100 — потребитель масштабирует сам.
 */
export function iconSvg(id, hex = "#ffffff") {
  const shape = SHAPES[id] || SHAPES.paw;
  const colour = /^#[0-9a-f]{6}$/i.test(String(hex)) ? hex : "#ffffff";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" color="${colour}"><g fill="${colour}">${shape}</g></svg>`;
}
