/*
 * Слова и облик кадра «снаружи» редактора «Интерьеры» (второй заход задачи 3
 * ТЗ 10.10.2026; вернули 17.10.2026): заправки и фасады магазинов.
 *
 * Что правится над кадром — вид мест снаружи: `out:gas` (заправки) или
 * `out:<помещение>` (фасады этого вида магазинов). Облик листа в кадре — тем
 * же расчётом, что у стен помещения (`shopFrameLook`): часть листа — по
 * записи материала сцены (`part`, у колонок — `pump` и `pumpPart`), сцену
 * собирает `scripts/prepare-shop-outside.mjs` теми же листами, что правит
 * установщик.
 */

import {
  GAS_STATIONS,
  OUTSIDE_BRANDS,
  OUTSIDE_PARTS,
  PUMP_PARTS,
  changedOutsidePlaces,
  outsideEmblemDecals,
  outsideKindLabel,
  outsideLookOf,
  outsidePlacesOf,
  pumpLookOf,
  pumpsChanged,
  shopOutsidePlace,
} from "@modovik/climb-contract/recolor/shops-outside";
import { fill, plural, shopFrameLook } from "./shops-text.js";
import { tr } from "../../../locales/ui.js";

export const OUTSIDE_PREFIX = "out:";
export const isOutsideTarget = (value) => String(value || "").startsWith(OUTSIDE_PREFIX);
export const outsideKindOf = (value) => String(value || "").slice(OUTSIDE_PREFIX.length);
export const outsideTarget = (kind) => `${OUTSIDE_PREFIX}${kind}`;

export const outsidePartLabel = (id) => OUTSIDE_PARTS.find((part) => part.id === id)?.label || id;
export const pumpPartLabel = (id) => PUMP_PARTS.find((part) => part.id === id)?.label || id;

/** Имя вида мест над кадром: «Станции снаружи», «24/7 — снаружи». */
export const outsideTargetLabel = (kind) => (kind === "gas" ? tr("Станции снаружи") : fill(tr("{0} — снаружи"), tr(outsideKindLabel(kind))));

/** Подпись места: бренд и район — «Xero — Строберри». */
export function placeLabel(place) {
  if (!place) return tr("Место");
  const brand = OUTSIDE_BRANDS[place.brand];
  /* Бренд — имя собственное, район — название места на карте: переводом словаря (пусто в словаре — как в описи). */
  return brand ? `${brand} — ${tr(place.label)}` : tr(place.label);
}

/** Строка места: колонки и листы. */
export function placeLine(place) {
  if (!place) return "";
  const parts = new Set(place.sheets.map((sheet) => sheet.part)).size;
  const pumps = place.pumps?.length || 0;
  const bits = [];
  if (pumps) bits.push(`${pumps} ${plural(pumps, [tr("колонка"), tr("колонки"), tr("колонок")])}`);
  bits.push(parts ? `${place.sheets.length} ${plural(place.sheets.length, [tr("лист"), tr("листа"), tr("листов")])}` : tr("листов своих моделей нет"));
  return bits.join(" · ");
}

/** Места вида по порядку списка (с севера на юг, как в описи). */
export const placesOfKind = (kind) => outsidePlacesOf(kind);

/** Сколько мест вида — словами: «28 заправок», «6 мест». */
export function kindCountText(kind) {
  const count = outsidePlacesOf(kind).length;
  return kind === "gas" ? `${count} ${plural(count, [tr("заправка"), tr("заправки"), tr("заправок")])}` : `${count} ${plural(count, [tr("место"), tr("места"), tr("мест")])}`;
}

/*
 * Облик материала сцены места: часть места — облик места в игре, колонки —
 * облик колонок станции; прочее — как в игре. `finishes` — текстуры отделки
 * по ключу `part:<часть>` и `pump:<часть>`.
 */
export function outsideFrameLook({ placeLook, pumpLook, info, finishes = {} }) {
  if (info.part && placeLook?.parts?.[info.part]) {
    return shopFrameLook({ surfaces: { [info.part]: placeLook.parts[info.part] } }, { ...info, surface: info.part }, { finishes: { [info.part]: finishes[`part:${info.part}`] || null } });
  }
  if (info.pumpPart && pumpLook?.parts?.[info.pumpPart]) {
    const key = `pump:${info.pumpPart}`;
    return shopFrameLook({ surfaces: { [key]: pumpLook.parts[info.pumpPart] } }, { ...info, surface: key }, { finishes: { [key]: finishes[key] || null } });
  }
  return { colour: info.colour, emission: info.emissive ? 0.6 : 0 };
}

/** Облик места и колонок, что уедет в игру. */
export const placeLooks = (outside, placeId) => ({ placeLook: outsideLookOf(outside, placeId), pumpLook: pumpLookOf(outside, placeId) });

/** Строка состояния кадра «снаружи»: что ставится. */
export function outsidePlanText(outside) {
  const places = changedOutsidePlaces(outside);
  const bits = [];
  if (places.length) {
    const names = places.slice(0, 3).map((id) => placeLabel(shopOutsidePlace(id)));
    const more = places.length > 3 ? fill(tr(" и ещё {0}"), places.length - 3) : "";
    bits.push(fill(tr("снаружи — {0}"), `${names.join(", ")}${more}`));
  }
  if (pumpsChanged(outside)) bits.push(tr("колонки всех заправок"));
  const decals = outsideEmblemDecals(outside);
  const named = decals.filter((decal) => String(decal.id).startsWith("n:")).length;
  const emblems = decals.length - named;
  if (emblems) bits.push(fill(tr("эмблем и надписей на фасадах — {0}"), emblems));
  if (named) bits.push(fill(tr("названий заправок — {0}"), named));
  return bits.length ? fill(tr("В игру уедут: {0}."), bits.join("; ")) : tr("Снаружи всё как в игре — ставить нечего.");
}

/** Число станций — для подписи «Колонок»: сколько станций берёт общий облик. */
export const gasStationCount = () => GAS_STATIONS.length;
