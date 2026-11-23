/*
 * Слова и числа редактора зон каптов — отдельно от компонентов: их берут
 * кадр, колонка правок, готовые виды и обложка (горячая замена в разработке
 * тогда не перезагружает компоненты целиком).
 */

import { COLOUR_EFFECT_LABELS } from "@modovik/climb-contract/recolor/colour-effects";
import {
  CAPT_ZONES,
  CAPT_ZONES_MOD,
  CAPT_ZONES_MOD_DISTANCE,
  captZoneLodDist,
  captZoneLook,
  captZoneTop,
  findCaptZone,
} from "@modovik/climb-contract/recolor/capt-zones";
import { currentUiLanguage, ownUiText, tr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import { pluralWord } from "../../../plural.js";
import { captZonesCopyFor, captZonesUnits } from "./capt-zones-copy.js";

const number = (value, digits = 1) => String(Math.round(value * 10 ** digits) / 10 ** digits).replace(".", ",");

/* Проценты — целыми и с неразрывным пробелом: «75 %», а не «74,9 %» (п. 3 `design-qa.md`). */
export const percentText = (value) => `${Math.round(value)}\u00a0%`;
export const metresText = (value) => `${number(value, value < 10 ? 1 : 0)} м`;
export const distanceText = (value) => (value >= 1000 ? `${number(value / 1000, 2)} км` : `${Math.round(value)} м`);
export const glowText = (value) => `×${number(value, 1)}`;

/* Над кадром: все зоны разом или одна. */
export const ALL_ZONES = "all";
export const TARGET_OPTIONS = Object.freeze([[ALL_ZONES, "Все зоны"], ...CAPT_ZONES.map((zone) => [zone.id, zone.kind === "arena" ? tr("Арена (ангар)") : zone.label])]);
export const targetZone = (target) => (target === ALL_ZONES ? null : findCaptZone(target));

/* Быстрые цвета: от оранжевого мода до жёлтого, различимого при дальтонизме. */
export const CAPT_ZONES_SWATCHES = Object.freeze([
  CAPT_ZONES_MOD.colour,
  "#ff8e4a",
  "#ff2f2f",
  "#ffd400",
  "#a6ff00",
  "#22d36b",
  "#00ffd5",
  "#2f6bff",
  "#9b5cff",
  "#ff2bd6",
  "#f4f7ff",
]);

/* Прозрачность в колонке — обратная сторона плотности: 100 % — зону не видно. */
export const transparencyOf = (opacity) => Math.round((100 - opacity) * 10) / 10;
export const opacityOf = (transparency) => Math.round((100 - transparency) * 10) / 10;

export function transparencyHint(transparency) {
  if (transparency >= 100) return { text: tr("Зону не видно совсем — в игру она не поедет. Вернуть цвет можно в любой момент.") };
  if (transparency >= 85) return { text: tr("Лёгкий отлив: край зоны видно вблизи, издалека он почти теряется.") };
  if (transparency >= 60) return { text: tr("Полупрозрачно, как в моде: и цвет виден, и всё, что за стенкой.") };
  if (transparency >= 25) return { text: tr("Плотная дымка: границу видно издалека, но за стенкой хуже видно противника.") };
  return { text: tr("Почти сплошной цвет: сквозь стенку и крышу зоны не разглядеть ни людей, ни машин."), warning: true };
}

/* «1 зона», «3 зоны», «14 зон». */
export function zonesCountText(count) {
  /* Форма — по правилу языка окна (`plural.js`): у польского после 21 «stref», у английского «zones», у французского 0 — «zone». */
  return `${count} ${pluralWord(count, [tr("зона"), tr("зоны"), tr("зон")])}`;
}

/* Имя зоны в подписи — как на серверах, в кавычках; склоняется слово «зона». */
export const zoneName = (zone) => `«${zone.label}»`;

/* Поперечник и стенка: «520 м в поперечнике, стенка на 105 м над серединой». */
export function zoneSizeText(zone, project = {}) {
  return `${metresText(zone.radius * 2)} в поперечнике, верх стенки — ${metresText(captZoneTop(zone, project))} над серединой`;
}

/** Строка зоны в списке: образец, имя и что с её обликом; `state` — только у зоны со своим обликом (у остальных «как у всех» не печатаем). */
export function zoneRow(project, zone) {
  const look = captZoneLook(project, zone);
  const parts = [];
  if (look.own.look) parts.push(look.effect.mode === "solid" ? tr("свой цвет") : tr(COLOUR_EFFECT_LABELS[look.effect.mode].toLowerCase()));
  if (look.own.opacity) parts.push(look.alpha === 0 && project.enabled !== false ? tr("не видно") : trFill("прозрачность {0}", percentText(transparencyOf(look.opacity))));
  return { swatch: look.colour, state: parts.length ? parts.join(", ") : null };
}

/** Зоны со своим обликом или прозрачностью — для подсказки «ляжет на все». */
export const zonesWithOwn = (project, key) => CAPT_ZONES.filter((zone) => captZoneLook(project, zone).own[key]);

/* Быстрые дальности. */
export const DISTANCE_STOPS = Object.freeze([
  /* Дальность мода — числом (п. 15 `design-qa.md`: «Как в моде» не употребляется). */
  Object.freeze({ value: CAPT_ZONES_MOD_DISTANCE, label: "200 м от середины" }),
  Object.freeze({ value: 0, label: "С края" }),
  Object.freeze({ value: 150, label: "150 м" }),
  Object.freeze({ value: 500, label: "500 м" }),
  Object.freeze({ value: 1500, label: "1,5 км" }),
]);

/** Подсказка к дальности: когда зона появится в игре (`zone` — в кадре). */
export function distanceHint(project, zone) {
  /* Слова и порядок — по языку окна (`capt-zones-copy.js`): строка с вставками, разобранная по кускам, оставалась с русским хвостом. */
  const language = currentUiLanguage();
  const copy = captZonesCopyFor(language);
  const { metres, distance } = captZonesUnits(language);
  const sample = zone || findCaptZone("farm");
  const lod = captZoneLodDist(sample, project);
  const name = `«${tr(sample.label)}»`;
  if (project.distance === CAPT_ZONES_MOD_DISTANCE) {
    const inside = Math.round(sample.radius - CAPT_ZONES_MOD.lodDist);
    const lead = copy.lead({ from: distance(CAPT_ZONES_MOD.lodDist), zone: name, radius: metres(sample.radius) });
    if (inside > 0) return ownUiText(copy.inside({ lead, depth: metres(inside) }));
    if (inside === 0) return ownUiText(copy.edge({ lead }));
    return ownUiText(copy.before({ lead, gap: distance(-inside) }));
  }
  return ownUiText(copy.custom({ gap: distance(project.distance), zone: name, lod: distance(lod) }));
}
