/*
 * Щелчок по детали здания (18.10.2026, Session 2, задача 2): что правится под
 * курсором, что подсвечивать и какой элемент открыть в колонке. Без React и
 * three — тесты идут на чистых данных.
 *
 * Деталь здания узнаётся тремя способами:
 *   — плашка кадра (`hit.pick`): свой баннер стороны, фото на щите, эмблема,
 *     надпись, плашка поверх объёмных букв — её редактор нарисовал сам;
 *   — запись материала сцены (`hit.info.group`): часть здания (стены, крыша,
 *     отделка, навесы, земля, фирменные стены), грязь поверх части, надпись или
 *     табличка (`title`, `sign:<id>`);
 *   — место в кадре (точка попадания): щит на крыше — штатная панель в листе
 *     отделки, её узнают по рамке щита из описи.
 * Всё остальное (стекло, соседние дома, лестницы, декали дороги) остаётся как в
 * игре — править нечего.
 */

import {
  BUILDING_PART_IDS,
  buildingBillboards,
  buildingPlaceParts,
  buildingSheetPart,
  buildingSigns,
  buildingTextTargets,
  buildingTitle,
  buildingTitleRetired,
  grimePartOf,
} from "@modovik/climb-contract/recolor/buildings";
import { decalBasis } from "@modovik/climb-contract/recolor/decal";

/*
 * Таблички инструмента «Таблички» — по местам (05.10.2026): у Мегамолла один
 * остров листа рисует и буквы на стене здания, и пилон у дороги, поэтому
 * «табличка» — цель (`buildingTextTargets`): пилон у дороги, таблички над
 * входами, надпись Carson на стенах. Объёмные буквы названия (`tool: "title"`)
 * — в «Надписи», не здесь.
 */
export function buildingSignEntries(place) {
  const signs = buildingSigns(place);
  const targets = buildingTextTargets(place).filter((target) => target.tool === "signs");
  const entries = [];
  /* Пилон надписи (MEGA MALL у дороги) — первым: его ищут как «табличку». */
  for (const target of targets.filter((item) => item.source === "title")) entries.push({ id: target.id, label: target.label, target, sign: null });
  for (const sign of signs) {
    /* Буквы названия (DAVIS MEGA MALL) — в «Надписи», не здесь. */
    if (sign.tool === "title") continue;
    const own = targets.filter((item) => item.source === `sign:${sign.id}`);
    if (own.length) for (const target of own) entries.push({ id: target.id, label: target.label, target, sign });
    else if (sign.covers?.length) entries.push({ id: sign.id, label: sign.label, target: null, sign });
  }
  return entries;
}

/* Группа сцены, которую рисует табличка: остров надписи или остров таблички. */
function entryGroup(entry) {
  return entry.target?.source || (entry.sign ? `sign:${entry.sign.id}` : "");
}

/* Объёмные буквы названия, что заменяются своими: свои разделы «Надписи» (`sign-<id>`). */
const letterSigns = (place) => buildingSigns(place).filter((sign) => sign.tool === "title" && sign.covers?.length);

/* Часть здания у записи материала (грязь идёт за частью, на которой лежит) или `null`. */
export function buildingAimPart(place, info) {
  if (!info) return null;
  const part = info.group === "grime" ? grimePartOf(info.name) : BUILDING_PART_IDS.includes(info.group) ? buildingSheetPart(place, info.name, info.group) : null;
  return part && buildingPlaceParts(place).some((item) => item.id === part) ? part : null;
}

const distance2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/* Цель, чьё место ближе всего к точке попадания (у острова листа их несколько). */
function nearestTarget(targets, point) {
  let best = null;
  let bestDistance = Infinity;
  for (const target of targets)
    for (const spot of target.places || []) {
      const away = point && spot.point ? distance2(spot.point, point) : 0;
      if (away < bestDistance) {
        best = target;
        bestDistance = away;
      }
    }
  return best || targets[0] || null;
}

/* Надпись или табличка по группе сцены (`title`, `sign:<id>`): `{ tool, … }` или `null`. */
function textTargetOfGroup(place, group, point) {
  if (group === "title") {
    if (!buildingTitle(place)) return null;
    /* Пилон надписи у дороги — табличка; остальное — «Надпись», если у неё есть что править. */
    const near = nearestTarget(buildingTextTargets(place).filter((target) => target.source === "title"), point);
    if (near?.tool === "signs") return { tool: "signs", sign: near.id, element: `sign-${near.id}` };
    return buildingTitleRetired(place) ? null : { tool: "title", element: "title" };
  }
  const id = String(group).startsWith("sign:") ? group.slice(5) : "";
  const sign = buildingSigns(place).find((item) => item.id === id);
  if (!sign) return null;
  if (sign.tool === "title" && sign.covers?.length) return { tool: "title", element: `sign-${sign.id}` };
  const entries = buildingSignEntries(place).filter((entry) => entry.sign?.id === id);
  if (!entries.length) return null;
  const near = nearestTarget(entries.map((entry) => entry.target).filter(Boolean), point);
  const entry = (near && entries.find((item) => item.target === near)) || entries[0];
  return { tool: "signs", sign: entry.id, element: `sign-${entry.id}` };
}

/*
 * Щит на крыше, в чьей рамке лежит точка: рамка из описи, глубина — до метра.
 * Щиты двусторонние — две грани в десятках сантиметров друг от друга, — поэтому
 * из нескольких подходящих берётся та, что смотрит туда же, куда нормаль попадания
 * (она развёрнута к глазу), а без нормали — ближняя к точке.
 */
function billboardAt(place, point, normal = null) {
  if (!point) return null;
  let best = null;
  for (const board of buildingBillboards(place)) {
    const basis = decalBasis(board.normal, 0);
    const d = [point[0] - board.point[0], point[1] - board.point[1], point[2] - board.point[2]];
    const dot = (axis, from = d) => from[0] * axis[0] + from[1] * axis[1] + from[2] * axis[2];
    const depth = Math.abs(dot(basis.normal));
    if (depth > 1 || Math.abs(dot(basis.right)) > board.width / 2 + 0.4 || Math.abs(dot(basis.up)) > board.height / 2 + 0.6) continue;
    const facing = normal ? dot(basis.normal, normal) : 0;
    /* Грань, повёрнутая спиной к глазу, проигрывает любой повёрнутой лицом. */
    const score = facing * 10 - depth;
    if (!best || score > best.score) best = { board, score };
  }
  return best?.board || null;
}

/**
 * Что открыть по щелчку: `{ tool, part?, side?, billboard?, sign?, emblem?,
 * element? }` или `null` — править нечего. `element` — раздел колонки
 * (`data-building-section`), к которому она подводит.
 */
export function buildingAimTarget(place, hit) {
  if (!hit) return null;
  const pick = hit.pick;
  if (pick) {
    if (pick.kind === "side") return { tool: "sides", side: pick.side, element: "side" };
    if (pick.kind === "billboard") return { tool: "billboards", billboard: pick.billboard, element: "billboard" };
    if (pick.kind === "title") return buildingTitle(place) ? { tool: "title", element: "title" } : null;
    if (pick.kind === "cover") {
      const found = textTargetOfGroup(place, pick.group, pick.point || hit.point);
      if (found) return found;
    }
    if (pick.kind === "mark") {
      const target = buildingTextTargets(place).find((item) => item.id === pick.target);
      if (target) return target.tool === "title" ? (buildingTitleRetired(place) ? null : { tool: "title", element: "title" }) : { tool: "signs", sign: target.id, element: `sign-${target.id}` };
    }
    /* Эмблема или надпись общей системы: её и выбирают в списке. */
    if (pick.id && (pick.kind === "image" || pick.kind === "text")) return { tool: pick.kind === "text" ? "text" : "emblem", emblem: pick.id };
  }
  /* Щит на крыше — штатная панель в листе отделки, сначала по рамке из описи. */
  const board = billboardAt(place, hit.point, hit.normal);
  if (board) return { tool: "billboards", billboard: board.id, element: "billboard" };
  const info = hit.info;
  if (!info) return null;
  const part = buildingAimPart(place, info);
  if (part) return { tool: "building", part, element: part };
  if (info.group === "title" || String(info.group).startsWith("sign:")) return textTargetOfGroup(place, info.group, hit.point);
  return null;
}

/**
 * Выбранное в студии по цели щелчка: `{ tool, key, sign }` — взятый инструмент,
 * раздел колонки (`data-building-section`: часть здания, `title`, `sign-<id>`) и
 * табличка. Одно и то же описание считает и подсветку наведения, и выбранного.
 */
export const buildingTargetSelection = (target) => ({ tool: target.tool, key: target.part || target.element || "", sign: target.sign || "" });

/**
 * Описание подсветки для общего кадра по `selection` (`buildingTargetSelection`).
 * Только то, что в кадре сеткой сцены: часть здания, надпись, табличка.
 * Стороны, щиты и эмблемы — плашки, их видно и так; для них и для инструментов
 * без деталей — `null`. «Здание» без выбранной части не светит ничем: подсветка
 * всего здания легла бы на цвет, который человек как раз подбирает.
 */
export function buildingAimSpec(place, selection) {
  const { tool, key = "", sign = "" } = selection || {};
  if (tool === "building") return key ? { where: (info) => buildingAimPart(place, info) === key } : null;
  if (tool === "title") {
    const letters = letterSigns(place).map((item) => `sign:${item.id}`);
    const own = buildingTitle(place) && !buildingTitleRetired(place) ? ["title"] : [];
    const groups = key === "title" ? ["title"] : key.startsWith("sign-") ? [`sign:${key.slice(5)}`] : [...own, ...letters];
    return groups.length ? { where: (info) => groups.includes(info?.group) } : null;
  }
  if (tool === "signs") {
    const entries = buildingSignEntries(place);
    const entry = entries.find((item) => item.id === sign) || entries[0];
    const group = entry ? entryGroup(entry) : "";
    return group ? { where: (info) => info?.group === group } : null;
  }
  return null;
}
