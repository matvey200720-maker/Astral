/*
 * Слова «Травы по миру» и «Реалистичных деревьев» по описи складов
 * поставки (вес зон, сколько словарей уйдёт в игру). Отдельно от
 * `vegetation-text.js`: опись складов нужна только колонке и подписи
 * кадра, а не обложке мастерской.
 */

import VEGETATION_PACKS from "@modovik/climb-contract/recolor/inventory/vegetation-packs";
import { GRASS_ZONES, VEGETATION_WORLD, bushStyleOf, grassZoneOf, treesChange } from "@modovik/climb-contract/recolor/vegetation";
/* Посадка: засаженность в словах. */
import { plantingText } from "./planting-text.js";
import { currentUiLanguage, tr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

const MiB = 1048576;

/*
 * Что уйдёт в игру для зоны: у «как в моде» — земля мода (и дальние планы
 * загорода), у своего цвета — ещё штатная трава зоны, её дальние планы и
 * карты травы.
 */
function zoneParts(zone, mod) {
  const part = VEGETATION_PACKS.sandy?.zones?.[zone] || {};
  const distant = zone === "country" || !mod;
  /* Покраска: у своего цвета — ещё модели с палитрами тинта травы (гольф-клуб вблизи и вдали). */
  return {
    files: (part.files || 0) + (mod ? 0 : (part.lawns || 0) + (part.palettes || 0)),
    distant: distant ? part.distant || 0 : 0,
    grass: mod ? 0 : part.grass || 0,
    bytes:
      (part.bytes || 0) +
      (distant ? part.distantBytes || 0 : 0) +
      (mod ? 0 : (part.lawnBytes || 0) + (part.grassBytes || 0) + (part.paletteBytes || 0)),
  };
}

/** Вес зоны в игре словами: «≈ 631 МБ». `zone` — зона или `both` («Обе сразу»: обе зоны), `mod` — трава как в моде. */
export function zoneWeightText(zone, mod) {
  const ids = zone === "both" ? GRASS_ZONES.map((item) => item.id) : [zone];
  const bytes = ids.reduce((sum, id) => sum + zoneParts(id, mod).bytes, 0);
  return bytes ? `≈ ${Math.max(1, Math.round(bytes / MiB))} МБ` : "";
}

/** Сколько файлов травы уйдёт в игру у работы: словари земли, дальние планы, карты травы. */
export function sandyFilesText(project) {
  let files = 0;
  let distant = 0;
  let grass = 0;
  let bytes = 0;
  for (const zone of GRASS_ZONES) {
    const part = grassZoneOf(project, zone.id);
    if (!part) continue;
    const sum = zoneParts(zone.id, part.mod);
    files += sum.files;
    distant += sum.distant;
    grass += sum.grass;
    bytes += sum.bytes;
  }
  return { files, distant, grass, megabytes: Math.round(bytes / MiB) };
}

/* Сколько чего в районах работы — по описи мира. */
const inAreas = (areas, key) => areas.reduce((sum, id) => sum + (VEGETATION_WORLD.areas?.[id]?.[key] || 0), 0);
const thousands = (value) => Math.round(value).toLocaleString("ru-RU");
/* Слово в середине фразы с маленькой буквы; у немецкого существительные остаются с большой. */
const lowerWord = (text) => (currentUiLanguage() === "de" ? text : text.toLocaleLowerCase(currentUiLanguage()));

/** Что уедет в игру — одной фразой в панели редактора. */
export function vegetationPlanText(project) {
  const parts = [];
  if (treesChange(project)) parts.push(tr("листва деревьев и растений рядом и их карточки вдали (около 700 файлов)"));
  const bush = bushStyleOf(project);
  if (bush) {
    const hedges = bush.hedges && (bush.look || project.trees.tint) ? trFill(" и живые изгороди города ({0} файлов)", VEGETATION_WORLD.hedges?.files || 0) : "";
    parts.push(`${bush.follow ? tr("кусты — с листвой") : tr("кусты своим цветом")}${hedges}`);
  }
  if (project.forest.enabled)
    parts.push(trFill("деревья видами из смеси — ≈ {0} деревьев в картах районов", thousands((inAreas(project.forest.areas, "trees") * project.forest.share) / 100)));
  /* Посадка: ряды вдоль дорог, полосы, клумбы и рощи — по плану посадки. */
  if (project.density.value && plantingText(project.density)) parts.push(plantingText(project.density));
  if (project.flowers.mode === "add")
    parts.push(trFill("цветы на месте ≈ {0} пачек травы", thousands((inAreas(project.flowers.areas, "small") * project.flowers.share) / 100)));
  if (project.flowers.mode === "none") parts.push(trFill("без цветов — {0} пачек цветов станут травой", thousands(inAreas(project.flowers.areas, "flowers"))));
  if (project.improved.enabled) parts.push(trFill("«Реалистичные деревья» — {0} моделей из поставки Astral", VEGETATION_PACKS.improved?.files?.length || 204));
  const zones = GRASS_ZONES.filter((zone) => grassZoneOf(project, zone.id)).map((zone) =>
    `${lowerWord(tr(zone.label))} — ${grassZoneOf(project, zone.id).mod ? tr("как в моде") : tr("свой цвет")}`,
  );
  if (zones.length) {
    const { files, distant, grass, megabytes } = sandyFilesText(project);
    parts.push(
      trFill("{0}: {1} словарей земли, {2} дальних планов{3} (≈ {4} МБ, своим пакетом дополнения)", zones.join(", "), files, distant, grass ? trFill(", {0} карт травы", grass) : "", megabytes),
    );
  }
  if (!parts.length) return tr("Растительность как в игре: ставить нечего.");
  return trFill("В игру уйдут: {0}. Чем больше включено, тем дольше «Применить» — до нескольких минут.", parts.join("; "));
}
