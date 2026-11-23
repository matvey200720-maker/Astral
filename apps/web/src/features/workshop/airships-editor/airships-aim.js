/*
 * Щелчок по кадру «Дирижаблей» (18.10.2026, Session 2, задача 2): что под
 * курсором и какой инструмент открыть.
 *
 * В кадре одна вещь — выбранный вид, и правят её не по частям, а по
 * инструментам, поэтому щелчок открывает тот, что подходит по смыслу:
 *   — оболочка дирижабля игры (лист надписи, `info.id === "sign"`) — «Дирижабль»:
 *     надпись, цвета оболочки и полос. Гондола и стёкла не правятся — по ним
 *     ничего не выбирается;
 *   — своя модель вида — «Цвет» (цвета и своя текстура), а её лист картинки
 *     (часть `skin`) — «Лого», когда на нём только лого: своя текстура уходит
 *     в «Цвет».
 * Какой именно цвет модели лежит под курсором, кадр не знает: цвета вида
 * запечены в один лист модели, и часть (`role`) — самое мелкое, что видно.
 *
 * Чистые функции, без React и three.
 */

import { airshipDecalReady, airshipKind, airshipSkinReady, normalizeAirshipsProject } from "@modovik/climb-contract/recolor/airships";

export const AIRSHIP_PICK = "airship";

/** Оболочка дирижабля игры — материал с листом надписи. */
export const BLIMP_SHELL = "sign";
export const isBlimpShell = (info) => info?.id === BLIMP_SHELL;

/** Что своя модель называет своим: `{ kind, id: вид, role }` — в `userData.pick` корня и частей. */
export const airshipPick = (kindId, role = "") => ({ kind: AIRSHIP_PICK, id: kindId, role });

/** Инструмент для своей модели: лист картинки только с лого — «Лого», остальное — «Цвет». */
export function airshipModelTool(item, role) {
  if (role === "skin" && airshipDecalReady(item) && !airshipSkinReady(item)) return "logo";
  return "look";
}

/**
 * Что открыть по попаданию кадра: `{ kind, tool, role? }` или `null` — править
 * нечего. `kind` — вид (`"blimp"` у дирижабля игры), `project` — работа.
 */
export function airshipAimTarget(hit, project) {
  if (!hit) return null;
  if (isBlimpShell(hit.info)) return { kind: "blimp", tool: "blimp" };
  const pick = hit.pick;
  if (pick?.kind !== AIRSHIP_PICK || !airshipKind(pick.id) || pick.id === "blimp") return null;
  const item = normalizeAirshipsProject(project).fleet[pick.id];
  const role = String(pick.role || "");
  return { kind: pick.id, tool: airshipModelTool(item, role), role };
}

/**
 * Описание для кадра (`aimTarget`): оболочка дирижабля подсвечивается своими
 * сетками, своя модель — только вещью (штрихи на ней рисует сама модель).
 */
export function airshipAimSpec(hit) {
  if (isBlimpShell(hit?.info)) return { where: isBlimpShell };
  return hit?.pick?.kind === AIRSHIP_PICK ? { none: true } : null;
}

/** Подсветка оболочки в кадре с дирижаблем игры: пока открыт «Дирижабль». */
export const airshipShellHighlight = (kindId, tool) => (kindId === "blimp" && tool === "blimp" ? { where: isBlimpShell } : null);

/**
 * Части своей модели, что подсвечиваются штрихами по состоянию редактора:
 * «Лого» — лист картинки (там лого ложится), «Цвет» — то, во что щёлкнули
 * (`aimed` — `{ kind, role }` последнего щелчка по этому виду). Остальное — ничего.
 */
export function airshipHighlightRoles(tool, aimed, kindId) {
  if (kindId === "blimp") return [];
  if (tool === "logo") return ["skin"];
  if (tool === "look" && aimed?.kind === kindId && aimed.role) return [aimed.role];
  return [];
}
