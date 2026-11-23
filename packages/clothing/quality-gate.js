/*
 * Ворота качества одежды (ТЗ владельца 11.11.2026): вещь в каталог идёт только целой — своими расцветками на своей модели. Один признак на всех: разбор нового поста
 * (`worker.js`), перекладка уже выложенных карточек (`scripts/clothing-rebuild-plan.mjs`) и список «Из каталога» в мастерской.
 *
 * Что не идёт в каталог:
 *   • штатная расцветка игры (`stock-copy`) — копия файла GTA V, а не работа автора («Лонгслив №23: заменёнка одна, остальное — дефолтные варианты GTA»);
 *   • пустая расцветка (`empty-texture`) — прозрачный лист или 4×4 вместо ткани;
 *   • лист не от этой модели (`texture-layout`) — дыры под закрашенной развёрткой или другая раскладка, чем у остальных расцветок вещи: на обложке и в 3D «рваная» вещь;
 *   • вещь вообще: плоская модель-заглушка (`flat-model`), и вещь, у которой после этого не осталось ни одной своей расцветки (`no-own-texture`).
 *
 * Модуль чистый: меры расцветок (`texture-fit.js`, `stock-textures.js`) приходят параметрами.
 */

import { HOLES_MAX } from "./texture-fit.js";

/** Номер правил ворот (в отчётах перекладки). */
export const GATE_VERSION = 1;

export const GATE_CODES = Object.freeze(["stock-copy", "empty-texture", "texture-layout", "flat-model", "no-own-texture"]);

/** Подозрение, а не отказ: расцветка идёт дальше, в отчёте — «проверьте глазами». */
export const SUSPECT_CODES = Object.freeze(["layout-outlier", "texture-holes"]);

/**
 * Решение по одной расцветке.
 * @param {{ stock?: boolean, empty?: boolean, holes?: number, outlier?: boolean, confirmed?: boolean }} measure
 *   `holes` (дыры под развёрткой) и `outlier` (лист выбился из раскладки вещи) сами по себе отказом не бывают, только вместе с `confirmed` (человек посмотрел глазами и подтвердил)
 * @returns {{ keep: true, suspect?: string } | { keep: false, code: string, detail?: string }}
 */
export function textureVerdict(measure = {}, { holesMax = HOLES_MAX } = {}) {
  if (measure.stock) return { keep: false, code: "stock-copy" };
  if (measure.empty) return { keep: false, code: "empty-texture" };
  const holes = Number(measure.holes) > holesMax;
  /* Дыры и выбившаяся раскладка — только подозрение: отказом они бывают с подтверждением человека (глазами по кадру). */
  if ((holes || measure.outlier) && measure.confirmed) return { keep: false, code: "texture-layout", detail: holes ? "holes" : "outlier" };
  if (holes) return { keep: true, suspect: "texture-holes" };
  return measure.outlier ? { keep: true, suspect: "layout-outlier" } : { keep: true };
}

const percent = (value) => `${Math.round(Number(value) * 100)} %`;

/** Причина словами для отчёта разбора и переписи. */
export function verdictMessage(label, verdict, measure = {}) {
  switch (verdict.code) {
    case "stock-copy":
      return `Расцветка ${label} — штатная текстура игры (те же файлы GTA V), а не работа автора: в карточку и пакет не идёт.`;
    case "empty-texture":
      return `Расцветка ${label} пустая (прозрачный лист или картинка 4×4 вместо ткани): в карточку и пакет не идёт.`;
    case "texture-layout":
      return verdict.detail === "holes"
        ? `Расцветка ${label} не ложится на модель: лист прозрачен на ${percent(measure.holes)} закрашенной развёртки — это лист от другой модели. В карточку и пакет не идёт.`
        : `Расцветка ${label} нарисована под другую раскладку, чем остальные расцветки вещи (лист от другой модели): в карточку и пакет не идёт.`;
    case "texture-holes":
      return `Расцветка ${label}: лист прозрачен на ${percent(measure.holes)} закрашенной развёртки — возможно, лист от другой модели; проверьте глазами.`;
    case "layout-outlier":
      return `Расцветка ${label} нарисована под другую раскладку, чем остальные расцветки вещи: возможно, лист от другой модели — проверьте глазами.`;
    case "flat-model":
      return "Модель плоская (заглушка вместо вещи): рисовать нечем, карточки нет.";
    case "no-own-texture":
      return "Своей расцветки у вещи не осталось: всё, что лежало в архиве, — штатное, пустое или не от этой модели. В каталог не идёт.";
    default:
      return `Расцветка ${label}: ${verdict.code}.`;
  }
}

/**
 * Вещь целиком по решениям о расцветках.
 *
 * @param {object} input
 * @param {string|null} [input.flatReason] причина, по которой модель плоская (`flatModelReason`), или `null`
 * @param {Array<{ keep: boolean }>} input.verdicts решения по расцветкам вещи
 * @returns {{ pass: boolean, code?: string, message?: string, kept: number, dropped: number }}
 *   У вещи без единой расцветки в архиве (одна форма модели) ворота не мешают: её разбор решает отдельно (`bare`).
 */
export function itemVerdict({ flatReason = null, verdicts = [] } = {}) {
  const kept = verdicts.filter((verdict) => verdict.keep).length;
  const dropped = verdicts.length - kept;
  if (flatReason) return { pass: false, code: "flat-model", message: verdictMessage("", { code: "flat-model" }), kept, dropped };
  if (verdicts.length && !kept) return { pass: false, code: "no-own-texture", message: verdictMessage("", { code: "no-own-texture" }), kept, dropped };
  return { pass: true, kept, dropped };
}

/**
 * Годится ли карточка каталога для списка «Из каталога» мастерской. Вещь, не прошедшая ворота, с выдачи снимается перекладкой (`scripts/clothing-rebuild-plan.mjs`) — в каталоге её уже нет;
 * здесь — защита на случай кэша лаунчера и вещи, выложенной по старым правилам: блок одежды без единой расцветки (всё штатное ушло) и отказ с пометкой (`gate.fail`) в список не идут.
 * Карточка без блока одежды (старая, тату, перчатки-наборы) проходит как есть.
 */
export function cardPassesGate(card) {
  const clothing = card?.domain?.clothing ?? card?.clothing ?? null;
  if (!clothing || typeof clothing !== "object") return true;
  if (clothing.gate && typeof clothing.gate === "object" && clothing.gate.fail) return false;
  return !(Array.isArray(clothing.sets) && clothing.sets.length === 0 && !clothing.ownPlaces && clothing.category !== "tattoos");
}
