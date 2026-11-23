/*
 * «Интерьеры Majestic RP» — часть казино: что окно знает о залах и листах (Хелпер 7, 25.10.2026).
 *
 * Опись казино (`inventory/majestic-casino.js`) — семь залов с хешем помещения, 27 покрытий и пять светящихся листов.
 * Кадр — помещение интерьера `p098b4592` проекта `majestic`, собранное Astral Desktop из файлов пака казино и игры игрока
 * (`useProjectCatalog` / `useProjectScene` из редактора «Интерьеры проектов»: тот же канал, те же листы).
 * Русские подписи описи — константы файла: на языке окна их показывают в месте отрисовки (`tr`).
 */

import INVENTORY from "@modovik/climb-contract/recolor/inventory/majestic-casino";
import { casinoFrameLook } from "@modovik/climb-contract/recolor/majestic-casino";

/** Проект и интерьер казино в паке: кадр спрашивает их у каталога проектов. */
export const CASINO_PROJECT = "majestic";
export const CASINO_INTERIOR = "p098b4592";

/** Залы казино по порядку клавиш 1–7: `{ id, mlo, label }` (`mlo` — хеш помещения, 8 знаков). */
export const CASINO_ZONES = Object.freeze(INVENTORY.zones.map((zone) => Object.freeze({ id: zone.id, mlo: zone.mlo, label: zone.label })));
export const CASINO_ZONE_KEYS = Object.freeze(CASINO_ZONES.map((_zone, index) => String(index + 1)));

/** Быстрые цвета правок: дерево, мрамор, бархат, золото и ночь казино. */
export const CASINO_SWATCHES = Object.freeze(["#f2efe8", "#b9a27a", "#6b4226", "#8a1c2b", "#1f3a8a", "#1f6f43", "#d4af37", "#15171b"]);

/** Покрытия описи: `{ tex, label, width, height }`. */
export const CASINO_COVERINGS = Object.freeze(INVENTORY.coverings.map(({ tex, label, width, height }) => Object.freeze({ tex, label, width, height })));
/** Светящиеся листы подсветки. */
export const CASINO_GLOW_SHEETS = Object.freeze(INVENTORY.glow.sheets.map(({ tex }) => tex));

const COVERINGS = new Set(CASINO_COVERINGS.map((item) => item.tex));
const GLOW = new Set(CASINO_GLOW_SHEETS);

export const isCasinoCovering = (tex) => COVERINGS.has(String(tex || "").toLowerCase());
export const isCasinoGlowSheet = (tex) => GLOW.has(String(tex || "").toLowerCase());

/** Зал по номеру: неизвестный — первый. */
export const casinoZone = (id) => CASINO_ZONES.find((zone) => zone.id === id) || CASINO_ZONES[0];

/** Интерьер казино среди интерьеров каталога проекта или `null`. */
export const casinoUnit = (units) => (Array.isArray(units) ? units.find((unit) => unit.id === CASINO_INTERIOR) || null : null);

/**
 * Облик материала зала в кадре: правка работы (покрытие, подсветка) тем же расчётом, что у установщика (`casinoFrameLook`);
 * остальное — как в кадре «Интерьеров проектов»: зеркала, грязь и свечение вещей зала. В сцене имя листа материала — `info.name`
 * (игровое имя строчными).
 */
export function casinoMaterialLook(casino, info) {
  if (info.mirror) return { colour: "#aeb6bc", map: false, roughness: 0.06, metalness: 0.92 };
  if (info.dirt) return { colour: info.colour, dirt: 1 };
  const emission = info.emissive ? (info.emission ?? 0.6) : 0;
  const own = casinoFrameLook(casino, { ...info, sheet: info.name });
  return own ? { emission, ...own } : { colour: info.colour, emission };
}

/** Что подсветить в кадре для выбранного листа: покрытие — свой лист, подсветка — все пять светящихся листов. `null` — править нечего. */
export function casinoAimSpec(name) {
  const key = String(name || "").toLowerCase();
  if (COVERINGS.has(key)) return { where: (info) => String(info?.name || "").toLowerCase() === key };
  if (GLOW.has(key)) return { where: (info) => GLOW.has(String(info?.name || "").toLowerCase()) };
  return null;
}
