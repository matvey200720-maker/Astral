/*
 * Разметка выделения: модель в памяти, проверка и работа с диапазонами (ТЗ владельца 26.10.2026, раздел D).
 *
 * Разметка — список элементов сцены; элемент называет, ЧТО выделяется по щелчку и «кем» оно называется:
 *
 *   { id, type, kind, room?, label?, note?, entities?, sheet?, group?, runs? }
 *
 *   label — подпись для человека (в файл `.selmap` едет); note — пометка в XML для того, кто его правит (имя модели), в файл не едет.
 *
 *   entities — номера сущностей (`mesh.entity` сцены); sheet — имя материала строчными (`info.name`); group — группа материала (`info.group`:
 *              у арены floor, walls, ceiling, screens, logos, seats, lights, details); runs — явные диапазоны треугольников `{ mesh, from, to }`
 *              (`mesh` — индекс сетки в сцене, `from`–`to` включительно), для сцен без номеров сущностей и для вещи внутри одной сетки.
 *   Что подходит попаданию: сущность из `entities` и, если заданы, тот же `sheet` и `group`; либо треугольник из `runs`. Побеждает самый
 *   конкретный элемент: диапазоны > сущность и лист > сущность и группа > сущность (см. `selmap.js`).
 *
 * surface — класс (стены, пол, потолок: материал × закрытая комната), у него сколько угодно сущностей; content и prop — одна вещь
 * («планшеты, экраны, картины — только один»). `room` — номер комнаты из таблицы `rooms` разметки, `kind` — род для «Выбрать все такие».
 *
 * Чистый модуль без DOM и Node: проверку зовут генератор, компилятор и окно.
 */

import { SELECTION_TYPES, selectionKindType } from "./vocab.js";

export const SELECTION_MARKUP_VERSION = 1;

export class SelectionMarkupError extends Error {
  constructor(message) {
    super(message);
    this.name = "SelectionMarkupError";
  }
}

const SCENE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ELEMENT_ID = /^[a-z0-9][a-z0-9._:-]{0,95}$/;
/* Комната: «интерьер|комната» как у панели «Предметы» (`arenaRoomOf`, «3|room2») или просто имя. */
const ROOM_ID = /^[a-z0-9][a-z0-9._|-]{0,47}$/;
const KIND = /^[a-z][a-z0-9-]{0,31}$/;
/* Лист и группа — имена материала как их отдаёт сцена (`info.name`, `info.group`): `sign:storage-blue`, `mj_ma_marble_tiles_a1-diffuse`, с пробелами и
   скобками. Требуем только печатное, непустое и недлинное: сравнивает их сам файл, а не регулярка. */
const printable = (text, limit) => text.length >= 1 && text.length <= limit && ![...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const SHEET = { test: (text) => printable(text, 128) };
const GROUP = { test: (text) => printable(text, 64) };
const SHA256 = /^[0-9a-f]{64}$/;
/* Пределы: сцена арены — сотни сущностей, большая — десятки тысяч. Файл с миллионом номеров разметкой уже не является. */
export const ENTITIES_PER_ELEMENT_LIMIT = 200_000;
export const ENTITIES_TOTAL_LIMIT = 1_000_000;
export const ELEMENTS_LIMIT = 100_000;

/** Диапазоны `"1,3-5,9"` → отсортированный список целых без повторов. Бросает на мусоре и на слишком широком диапазоне. */
export function parseRanges(text) {
  const out = new Set();
  const source = String(text ?? "").trim();
  if (!source) return [];
  for (const part of source.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const match = /^(-?\d+)(?:\s*-\s*(-?\d+))?$/.exec(piece);
    if (!match) throw new SelectionMarkupError(`Диапазон «${piece}» не по форме: ждём числа через запятую и «от-до».`);
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to < from) throw new SelectionMarkupError(`Диапазон «${piece}» не по форме: «до» меньше «от».`);
    if (to - from >= ENTITIES_PER_ELEMENT_LIMIT) throw new SelectionMarkupError(`Диапазон «${piece}» шире ${ENTITIES_PER_ELEMENT_LIMIT} номеров.`);
    for (let value = from; value <= to; value += 1) out.add(value);
    if (out.size > ENTITIES_PER_ELEMENT_LIMIT) throw new SelectionMarkupError(`В одном списке больше ${ENTITIES_PER_ELEMENT_LIMIT} номеров.`);
  }
  return [...out].sort((a, b) => a - b);
}

/** Отсортированный список целых → `"1,3-5,9"` (подряд идущие свёрнуты в диапазон от трёх). */
export function formatRanges(list) {
  const sorted = [...new Set(list)].sort((a, b) => a - b);
  const parts = [];
  for (let at = 0; at < sorted.length; ) {
    let end = at;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    parts.push(end - at >= 2 ? `${sorted[at]}-${sorted[end]}` : sorted.slice(at, end + 1).join(","));
    at = end + 1;
  }
  return parts.join(",");
}

/** Диапазоны треугольников `[{ mesh, from, to }]` в виде пар «от, до» по возрастанию, подряд идущие склеены. */
export function mergeRuns(runs) {
  const byMesh = new Map();
  for (const run of runs) {
    if (!byMesh.has(run.mesh)) byMesh.set(run.mesh, []);
    byMesh.get(run.mesh).push([run.from, run.to]);
  }
  const out = [];
  for (const mesh of [...byMesh.keys()].sort((a, b) => a - b)) {
    const list = byMesh.get(mesh).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let current = null;
    for (const [from, to] of list) {
      if (current && from <= current.to + 1) current.to = Math.max(current.to, to);
      else {
        current = { mesh, from, to };
        out.push(current);
      }
    }
  }
  return out;
}

const fail = (where, text) => {
  throw new SelectionMarkupError(`${where}: ${text}`);
};
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * Проверка и приведение разметки к одной форме: `{ version, scene, rooms, elements }`. Лишних полей не оставляет. Бросает `SelectionMarkupError`
 * словами с номером элемента и полем.
 */
export function normalizeMarkup(raw) {
  if (!raw || typeof raw !== "object") fail("Разметка", "это не разметка");
  if (raw.version !== SELECTION_MARKUP_VERSION) fail("Разметка", `версия ${raw.version} не поддерживается (ждём ${SELECTION_MARKUP_VERSION})`);
  const scene = raw.scene || {};
  if (!SCENE_ID.test(String(scene.id || ""))) fail("Сцена", "нужно имя сцены строчными (латиница, цифры, точка, дефис)");
  for (const key of ["meshes", "triangles"]) if (scene[key] !== undefined && !isCount(scene[key])) fail("Сцена", `${key} — целое неотрицательное число`);
  if (scene.sha256 !== undefined && !SHA256.test(String(scene.sha256))) fail("Сцена", "sha256 — 64 шестнадцатеричных знака");

  const rooms = [];
  const roomIds = new Set();
  for (const room of Array.isArray(raw.rooms) ? raw.rooms : []) {
    const id = String(room?.id || "");
    if (!ROOM_ID.test(id)) fail("Комната", `имя «${id}» не по форме`);
    if (roomIds.has(id)) fail("Комната", `«${id}» повторяется`);
    roomIds.add(id);
    rooms.push({ id, ...(room.label ? { label: String(room.label).slice(0, 120) } : {}) });
  }

  const elements = [];
  const ids = new Set();
  let entityTotal = 0;
  const source = Array.isArray(raw.elements) ? raw.elements : [];
  if (source.length > ELEMENTS_LIMIT) fail("Разметка", `элементов больше ${ELEMENTS_LIMIT}`);
  for (const [index, element] of source.entries()) {
    const where = `Элемент ${index + 1}${element?.id ? ` «${element.id}»` : ""}`;
    const id = String(element?.id || "");
    if (!ELEMENT_ID.test(id)) fail(where, "имя не по форме");
    if (ids.has(id)) fail(where, "имя повторяется");
    ids.add(id);
    if (!SELECTION_TYPES.includes(element.type)) fail(where, `тип «${element.type}»: ждём ${SELECTION_TYPES.join(", ")}`);
    const kind = String(element.kind || "");
    if (!KIND.test(kind)) fail(where, `род «${kind}» не по форме`);
    const known = selectionKindType(kind);
    if (known && known !== element.type) fail(where, `род «${kind}» — это ${known}, а не ${element.type}`);
    const room = element.room ? String(element.room) : "";
    if (room && !roomIds.has(room)) fail(where, `комнаты «${room}» нет в таблице комнат`);
    const entities = Array.isArray(element.entities) ? [...new Set(element.entities)].sort((a, b) => a - b) : [];
    for (const entity of entities) if (!Number.isSafeInteger(entity) || entity < 0) fail(where, `номер сущности «${entity}» не целое неотрицательное`);
    if (entities.length > ENTITIES_PER_ELEMENT_LIMIT) fail(where, `больше ${ENTITIES_PER_ELEMENT_LIMIT} сущностей`);
    entityTotal += entities.length;
    const sheet = element.sheet ? String(element.sheet).toLowerCase() : "";
    if (sheet && !SHEET.test(sheet)) fail(where, `лист «${sheet}» не по форме`);
    const group = element.group ? String(element.group).toLowerCase() : "";
    if (group && !GROUP.test(group)) fail(where, `группа «${group}» не по форме`);
    const runs = [];
    for (const run of Array.isArray(element.runs) ? element.runs : []) {
      if (![run?.mesh, run?.from, run?.to].every((value) => Number.isSafeInteger(value) && value >= 0) || run.to < run.from) fail(where, "диапазон треугольников не по форме (mesh, from ≤ to)");
      runs.push({ mesh: run.mesh, from: run.from, to: run.to });
    }
    if (!entities.length && !runs.length) fail(where, "нечего выделять: ни сущностей, ни диапазонов треугольников");
    if (element.type !== "surface" && entities.length > 1) fail(where, `${element.type} выделяется по одному: у него ${entities.length} сущностей (класс из многих — это surface)`);
    if (element.type !== "surface" && entities.length && runs.length) fail(where, "у одиночной вещи или сущность, или диапазоны, не оба");
    if (runs.length && (sheet || group)) fail(where, "у диапазонов лист и группа не нужны: они называют сетку номером");
    elements.push({
      id,
      type: element.type,
      kind,
      ...(room ? { room } : {}),
      ...(element.label ? { label: String(element.label).slice(0, 120) } : {}),
      ...(element.note ? { note: String(element.note).slice(0, 120) } : {}),
      ...(entities.length ? { entities } : {}),
      ...(sheet ? { sheet } : {}),
      ...(group ? { group } : {}),
      ...(runs.length ? { runs: mergeRuns(runs) } : {}),
    });
  }
  if (entityTotal > ENTITIES_TOTAL_LIMIT) fail("Разметка", `номеров сущностей больше ${ENTITIES_TOTAL_LIMIT}`);
  /* Диапазоны треугольников разных элементов не пересекаются: треугольник принадлежит одной вещи, по нему ищет деление пополам. */
  const claimed = [];
  for (const element of elements) for (const run of element.runs || []) claimed.push({ ...run, id: element.id });
  claimed.sort((a, b) => a.mesh - b.mesh || a.from - b.from);
  for (let index = 1; index < claimed.length; index += 1) {
    const [before, after] = [claimed[index - 1], claimed[index]];
    if (before.mesh === after.mesh && after.from <= before.to) fail("Разметка", `треугольники сетки ${after.mesh} ${after.from}–${Math.min(before.to, after.to)} взяты и «${before.id}», и «${after.id}»`);
  }
  return {
    version: SELECTION_MARKUP_VERSION,
    scene: {
      id: String(scene.id),
      ...(scene.meshes !== undefined ? { meshes: scene.meshes } : {}),
      ...(scene.triangles !== undefined ? { triangles: scene.triangles } : {}),
      ...(scene.sha256 ? { sha256: String(scene.sha256) } : {}),
    },
    rooms,
    elements,
  };
}
