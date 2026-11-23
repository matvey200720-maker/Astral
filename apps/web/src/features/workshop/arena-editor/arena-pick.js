/*
 * Что открывает щелчок по кадру арены (слово владельца 30.10.2026: «выбрал звезду — открылся редактор именно с ней; выделение по одному»).
 *
 * Щелчок и наведение берут одно решение — `arenaPickRoute`: подсвечивается ровно то, что откроет щелчок. Решение три:
 *   — `item`: предмет зала по номеру сущности — страница «Предметы зала» (один предмет: охват «Только этот»);
 *   — `tool`: у вещи свой инструмент в колонке (кресла, звезда, автоматы, знаки выхода, экраны, таблички, эмблемы, плакаты, подсветка) —
 *     открывается он, а у места по одному — и сам элемент (полотно, экран, табличка);
 *   — `null`: здесь править нечего.
 * Предмет без своего инструмента открывает «Предметы зала». Оболочка (стена, пол, потолок) красится своим инструментом — «Пол», «Стены», «Потолок»;
 * в «Предметах зала» она выбирается по материалу, как была.
 *
 * Чистая функция без DOM и сцены: её берут кадр (подсветка щелчка и наведения), студия (что открыть) и тест.
 */

import { arenaObjectModel, arenaObjectOf } from "@modovik/climb-contract/recolor/arena-objects";
import { arenaAimTarget } from "./arena-aim.js";
import { itemPartOf } from "./arena-items.js";

/*
 * Инструменты, что правят вещь сами: щелчок по ней открывает их, а не страницу предмета. Пол, стены и потолок — оболочка, у предмета в них свои листы
 * (киоск на белой стене) — поэтому их здесь нет; «Замена моделей» и «Слои» — это страницы предмета, не отдельная вещь.
 */
export const ARENA_OWN_TOOLS = Object.freeze(["star", "seats", "objects", "exits", "screens", "signs", "logos", "posters", "lights"]);
const OWN = new Set(ARENA_OWN_TOOLS);

/*
 * Инструменты, что правят только все вещи разом: щелчок по вещи открывает её страницу (одну вещь), а инструмент остаётся в колонке. «Кресла»
 * Majestic — один цвет всем креслам и диванам зала; владелец 01.11.2026: «нельзя выделить один диван и загрузить картинку, как у столиков рядом».
 */
const WHOLE_ONLY = Object.freeze({ majestic: new Set(["seats"]) });

/**
 * Решение по попаданию кадра `hit`: `{ kind: "item", entity, material, part, target }`, `{ kind: "tool", tool, target }` или `null`.
 * `tool` — инструмент, что открыт сейчас: оболочка в «Предметах зала» выбирается как предмет, в остальных — открывает свой инструмент.
 */
export function arenaPickRoute(server, asset, hit, { tool = "" } = {}) {
  if (!hit) return null;
  const pick = hit.pick;
  /* Предмет со своим обликом (модель, цвет, картинка) стоит плашкой кадра: она — тот же предмет, его облик правится на его странице. */
  if (pick?.kind === "item" && Number.isInteger(pick.key) && arenaObjectOf(server, pick.key)) return { kind: "item", entity: pick.key, material: null, part: null, target: null };
  /* Своя звезда на подставке — плашка кадра: открывает «Звезду». */
  if (pick?.kind === "star") return { kind: "tool", tool: "star", target: { tool: "star" } };
  const target = arenaAimTarget(server, asset, hit);
  const entity = !pick && Number.isInteger(hit.entity) && arenaObjectOf(server, hit.entity) ? hit.entity : undefined;
  if (entity === undefined) return target ? { kind: "tool", tool: target.tool, target } : null;
  const structure = arenaObjectModel(server, entity)?.kind === "structure";
  const part = itemPartOf(hit.info);
  if (structure) {
    /* Полотно на листе оболочки (табло турнира Majestic — семь полотен на одном листе `standings_en`): щелчок берёт само полотно в его
       инструменте, а не материал оболочки — иначе штрихами горели все полотна листа (снимок владельца 31.10.2026). */
    if (tool === "items" && !(target?.key && OWN.has(target.tool))) return { kind: "item", entity, material: hit.info?.name || null, part, target };
    return target ? { kind: "tool", tool: target.tool, target } : null;
  }
  if (target && OWN.has(target.tool) && !WHOLE_ONLY[server]?.has(target.tool)) return { kind: "tool", tool: target.tool, target };
  return { kind: "item", entity, material: null, part, target };
}
