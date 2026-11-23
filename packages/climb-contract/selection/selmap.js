/*
 * Разметка выделения: компактный двоичный файл `.selmap` и то, что окно из него читает (ТЗ владельца 26.10.2026, раздел D: «XML компилируется в компактный
 * файл, версия и sha256 в манифесте сцены; клиент качает один раз на версию сцены; рантайм дешёвый: поиск по попаданию быстрый, парсинг в потоке, память —
 * только таблица»).
 *
 * Тело (после снятия сжатия):
 *   "SELM" · u8 версия · u8 флаги · u16 0 · u32 длина заголовка · заголовок JSON (добор пробелами до четырёх байт) · таблицы Int32 LE:
 *     диапазоны сущностей «от, до» (включительно) всех элементов подряд, затем диапазоны треугольников «сетка, от, конец» (конец не входит).
 *   Заголовок — по столбцам, а не по элементам: имена строк в таблицах `kinds`, `sheets`, `groups`, у элемента — номера (`k`, `s`, `g`, `r`, `t`),
 *   где у элемента лежат его диапазоны — `e` и `u` (пары «смещение, число»).
 * Файл на проводе — тело, сжатое brotli или deflate, с кодом сжатия первым байтом (1 — deflate, 2 — brotli, 0 — тело как есть: оно начинается с «S»).
 * Сжимает компилятор (`scripts/lib/selection-markup.mjs`), снимает загрузчик (`apps/desktop/src/selection-markup/`): это модуль без сжатия, чтобы
 * его брали и окно, и поток, и тест.
 *
 * Диапазоны треугольников: в XML для человека «0-340» включительно, в файле и в окне — полуоткрытые [от, конец), отсортированные по (сетка, от).
 *
 * Разбор можно вести в потоке: `decodeSelmapParts(bytes)` отдаёт плоские Int32Array (всё уже построено), `transferList(parts)` — их буферы для
 * передачи без копии; в окне `SelectionMap.fromParts(parts)` ничего не пересчитывает.
 *
 * Что окно получает — `SelectionMap`:
 *   elementOfHit({ entity?, sheet?, group?, mesh?, face? }) → номер элемента или -1 (mesh — номер сетки в сцене, face — треугольник в ней);
 *   ofKind(kind) → Int32Array номеров («Выбрать все такие»); kinds() → [{ kind, type, count }];
 *   targetOf(i) → { entities, sheet, group, runs } и targetOfMany(список) → { sets, runs } — что подсвечивать; element(i), byId(id);
 *   fits(scene), exact(scene) — подходит ли разметка этой сборке сцены.
 * Побеждает самый конкретный: диапазоны треугольников > сущность и лист > сущность и группа > сущность; при равных — элемент раньше в файле.
 */

import { SelectionMarkupError, normalizeMarkup } from "./markup.js";
import { SELECTION_KINDS, SELECTION_TYPES } from "./vocab.js";

export const SELMAP_VERSION = 1;
const MAGIC = "SELM";
export const SELMAP_CODEC = Object.freeze({ raw: 0, deflate: 1, brotli: 2 });

/* ------------------------------------------------------------------ *
 * Запись
 * ------------------------------------------------------------------ */

/** Отсортированный список целых → пары «от, до» подряд идущих. */
function toRanges(list) {
  const out = [];
  for (let at = 0; at < list.length; ) {
    let end = at;
    while (end + 1 < list.length && list[end + 1] === list[end] + 1) end += 1;
    out.push(list[at], list[end]);
    at = end + 1;
  }
  return out;
}

/** Разметка (проверяется `normalizeMarkup`) → тело `.selmap` без сжатия. */
export function encodeSelmap(source) {
  const markup = normalizeMarkup(source);
  const table = () => {
    const index = new Map();
    const list = [];
    return {
      list,
      of: (value) => {
        if (!value) return -1;
        if (!index.has(value)) {
          index.set(value, list.length);
          list.push(value);
        }
        return index.get(value);
      },
    };
  };
  const kinds = table();
  const sheets = table();
  const groups = table();
  const roomIndex = new Map(markup.rooms.map((room, index) => [room.id, index]));
  const header = {
    v: SELMAP_VERSION,
    scene: markup.scene,
    rooms: markup.rooms,
    n: markup.elements.length,
    id: [],
    t: "",
    k: [],
    r: [],
    s: [],
    g: [],
    e: [],
    u: [],
    labels: [],
  };
  const ranges = [];
  const runs = [];
  for (const [index, element] of markup.elements.entries()) {
    header.id.push(element.id);
    header.t += String(SELECTION_TYPES.indexOf(element.type));
    header.k.push(kinds.of(element.kind));
    header.r.push(element.room ? roomIndex.get(element.room) : -1);
    header.s.push(sheets.of(element.sheet));
    header.g.push(groups.of(element.group));
    if (element.label) header.labels.push([index, element.label]);
    const own = toRanges(element.entities || []);
    header.e.push(ranges.length / 2, own.length / 2);
    ranges.push(...own);
    const mine = element.runs || [];
    header.u.push(runs.length / 3, mine.length);
    for (const run of mine) runs.push(run.mesh, run.from, run.to + 1);
  }
  header.kinds = kinds.list;
  header.sheets = sheets.list;
  header.groups = groups.list;
  const json = new TextEncoder().encode(JSON.stringify(header));
  const headerBytes = Math.ceil(json.length / 4) * 4;
  const data = new Int32Array([...ranges, ...runs]);
  const out = new Uint8Array(12 + headerBytes + data.byteLength);
  out.fill(0x20, 12, 12 + headerBytes);
  out.set(new TextEncoder().encode(MAGIC), 0);
  out[4] = SELMAP_VERSION;
  const view = new DataView(out.buffer);
  view.setUint32(8, headerBytes, true);
  out.set(json, 12);
  for (let index = 0; index < data.length; index += 1) view.setInt32(12 + headerBytes + index * 4, data[index], true);
  return out;
}

/* ------------------------------------------------------------------ *
 * Файл на проводе
 * ------------------------------------------------------------------ */

/**
 * Файл `.selmap` → тело. `inflate` — `{ deflate(bytes), brotli(bytes) }`: чем снимать сжатие (окно умеет deflate через fflate, главный процесс — оба
 * через zlib). Тело без сжатия (начинается с «S») возвращается как есть.
 */
export function unpackSelmapFile(bytes, inflate = {}) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!input.length) throw new SelectionMarkupError("Файл разметки пуст.");
  if (input[0] === MAGIC.charCodeAt(0)) return input;
  const payload = input.subarray(1);
  if (input[0] === SELMAP_CODEC.deflate && typeof inflate.deflate === "function") return inflate.deflate(payload);
  if (input[0] === SELMAP_CODEC.brotli && typeof inflate.brotli === "function") return inflate.brotli(payload);
  throw new SelectionMarkupError(`Файл разметки: код сжатия ${input[0]} здесь не снять.`);
}

/* ------------------------------------------------------------------ *
 * Таблицы поиска
 * ------------------------------------------------------------------ */

const specificity = (sheet, group) => (sheet >= 0 ? 3 : group >= 0 ? 2 : 1);

/**
 * Сущность → элементы, что её называют, самые конкретные первыми. Отрезки без пересечений: память — число отрезков, а не сущностей, поиск —
 * деление пополам. Отрезок: «от, до, смещение списка кандидатов»; список: «число, номера элементов».
 */
function buildSegments(header, ranges) {
  const rank = (index) => specificity(header.s[index], header.g[index]);
  const opens = [];
  const closes = [];
  let entities = 0;
  for (let index = 0; index < header.n; index += 1) {
    const [offset, pairs] = [header.e[index * 2], header.e[index * 2 + 1]];
    for (let pair = 0; pair < pairs; pair += 1) {
      const from = ranges[(offset + pair) * 2];
      const to = ranges[(offset + pair) * 2 + 1];
      opens.push([from, index]);
      closes.push([to + 1, index]);
      entities += to - from + 1;
    }
  }
  opens.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  closes.sort((a, b) => a[0] - b[0]);
  const segments = [];
  const candidates = [];
  const active = new Set();
  let open = 0;
  let close = 0;
  let key = null;
  while (open < opens.length || close < closes.length) {
    const point = Math.min(open < opens.length ? opens[open][0] : Infinity, close < closes.length ? closes[close][0] : Infinity);
    while (close < closes.length && closes[close][0] === point) active.delete(closes[close++][1]);
    while (open < opens.length && opens[open][0] === point) active.add(opens[open++][1]);
    const upcoming = Math.min(open < opens.length ? opens[open][0] : Infinity, close < closes.length ? closes[close][0] : Infinity);
    if (!active.size) {
      key = null;
      continue;
    }
    const list = [...active].sort((a, b) => rank(b) - rank(a) || a - b);
    const text = list.join(",");
    const last = segments.length - 3;
    if (key === text && segments[last + 1] === point - 1) segments[last + 1] = upcoming - 1;
    else {
      segments.push(point, upcoming - 1, candidates.length);
      candidates.push(list.length, ...list);
      key = text;
    }
  }
  return { segments: Int32Array.from(segments), candidates: Int32Array.from(candidates), entities };
}

/** Диапазоны треугольников всех элементов: «сетка, от, конец, элемент» по (сетка, от). Пересекаться они не могут — это проверяет `normalizeMarkup`. */
function buildRunIndex(header, runs) {
  const quads = [];
  for (let index = 0; index < header.n; index += 1) {
    const [offset, count] = [header.u[index * 2], header.u[index * 2 + 1]];
    for (let run = 0; run < count; run += 1) quads.push([runs[(offset + run) * 3], runs[(offset + run) * 3 + 1], runs[(offset + run) * 3 + 2], index]);
  }
  quads.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return Int32Array.from(quads.flat());
}

/** Тело `.selmap` → плоские таблицы (всё, что `SelectionMap` держит в памяти). Бросает на чужом файле, чужой версии и обрезанном теле. */
export function decodeSelmapParts(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== MAGIC) throw new SelectionMarkupError("Файл разметки: это не .selmap.");
  if (bytes[4] !== SELMAP_VERSION) throw new SelectionMarkupError(`Файл разметки: версия ${bytes[4]} не поддерживается (ждём ${SELMAP_VERSION}).`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerBytes = view.getUint32(8, true);
  if (12 + headerBytes > bytes.length) throw new SelectionMarkupError("Файл разметки обрезан: заголовок не помещается.");
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headerBytes)));
  } catch {
    throw new SelectionMarkupError("Файл разметки: заголовок не читается.");
  }
  if (header.v !== SELMAP_VERSION || !Number.isInteger(header.n) || !Array.isArray(header.id) || header.id.length !== header.n) throw new SelectionMarkupError("Файл разметки: заголовок не по форме.");
  const pairs = header.e.length ? header.e[header.e.length - 2] + header.e[header.e.length - 1] : 0;
  const triples = header.u.length ? header.u[header.u.length - 2] + header.u[header.u.length - 1] : 0;
  const start = 12 + headerBytes;
  if (start + (pairs * 2 + triples * 3) * 4 > bytes.length) throw new SelectionMarkupError("Файл разметки обрезан: таблицы короче заголовка.");
  const ranges = new Int32Array(pairs * 2);
  for (let index = 0; index < ranges.length; index += 1) ranges[index] = view.getInt32(start + index * 4, true);
  const runs = new Int32Array(triples * 3);
  for (let index = 0; index < runs.length; index += 1) runs[index] = view.getInt32(start + (pairs * 2 + index) * 4, true);
  const { segments, candidates, entities } = buildSegments(header, ranges);
  return { header, ranges, runs, runIndex: buildRunIndex(header, runs), segments, candidates, entities };
}

/** Буферы таблиц для передачи из потока без копии (`postMessage(parts, transferList(parts))`). */
export const transferList = (parts) => [parts.ranges, parts.runs, parts.runIndex, parts.segments, parts.candidates].map((table) => table.buffer);

/* ------------------------------------------------------------------ *
 * Чтение
 * ------------------------------------------------------------------ */

/** Таблица, которую окно держит в памяти и спрашивает по попаданию. */
export class SelectionMap {
  static fromParts(parts) {
    return new SelectionMap(parts);
  }

  constructor(parts) {
    const { header } = parts;
    this.header = header;
    this.scene = header.scene;
    this.rooms = header.rooms;
    this.count = header.n;
    this.ranges = parts.ranges;
    this.runs = parts.runs;
    this.runIndex = parts.runIndex;
    this.segments = parts.segments;
    this.candidates = parts.candidates;
    this.segmentCount = parts.segments.length / 3;
    this.runCount = parts.runIndex.length / 4;
    this.entityCount = parts.entities;
    this.labels = new Map(header.labels || []);
    /* Элементы, ключи и роды собираются по требованию: у большой сцены их десятки тысяч, а окно спрашивает единицы. */
    this.elements = new Array(header.n);
    this.byIdIndex = null;
    this.kindIndex = null;
    this.cache = new Map();
  }

  /** Таблицы для передачи в окно из потока (`SelectionMap.fromParts(parts)`). */
  parts() {
    return { header: this.header, ranges: this.ranges, runs: this.runs, runIndex: this.runIndex, segments: this.segments, candidates: this.candidates, entities: this.entityCount };
  }

  element(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return null;
    let element = this.elements[index];
    if (!element) {
      const header = this.header;
      const room = header.r[index] >= 0 ? header.rooms[header.r[index]]?.id : "";
      element = Object.freeze({
        index,
        id: header.id[index],
        type: SELECTION_TYPES[Number(header.t[index])],
        kind: header.kinds[header.k[index]],
        room,
        ...(this.labels.has(index) ? { label: this.labels.get(index) } : {}),
      });
      this.elements[index] = element;
    }
    return element;
  }

  byId(id) {
    if (!this.byIdIndex) {
      this.byIdIndex = new Map();
      for (let index = 0; index < this.count; index += 1) this.byIdIndex.set(this.header.id[index], index);
    }
    return this.byIdIndex.has(id) ? this.byIdIndex.get(id) : -1;
  }

  /** Разметка подходит сцене: sha256 сборки (из описи) главный ключ, число сеток и треугольников запасной. С диапазонами треугольников чужая сборка не подходит. */
  fits(scene = {}) {
    const own = this.scene;
    if (own.sha256 && scene.sha256) return own.sha256 === String(scene.sha256).toLowerCase() || !this.runCount;
    if (!this.runCount) return true;
    if (own.meshes !== undefined && scene.meshes !== undefined && own.meshes !== scene.meshes) return false;
    if (own.triangles !== undefined && scene.triangles !== undefined && own.triangles !== scene.triangles) return false;
    return true;
  }

  /** Разметка снята именно с этой сборки сцены (иначе по сущностям она работает, но могла устареть). */
  exact(scene = {}) {
    return Boolean(this.scene.sha256 && scene.sha256 && this.scene.sha256 === String(scene.sha256).toLowerCase());
  }

  /** Отрезок таблицы, где лежит сущность, или -1: деление пополам по началам отрезков. */
  segmentOf(entity) {
    const segments = this.segments;
    let low = 0;
    let high = this.segmentCount - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (entity < segments[middle * 3]) high = middle - 1;
      else if (entity > segments[middle * 3 + 1]) low = middle + 1;
      else return middle;
    }
    return -1;
  }

  /** Элемент, чей диапазон треугольников накрывает `face` сетки `mesh`, или -1: деление пополам по (сетка, от). */
  runOf(mesh, face) {
    const table = this.runIndex;
    let low = 0;
    let high = this.runCount - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const at = middle * 4;
      if (mesh < table[at] || (mesh === table[at] && face < table[at + 1])) high = middle - 1;
      else if (mesh > table[at] || face >= table[at + 2]) low = middle + 1;
      else return table[at + 3];
    }
    return -1;
  }

  /** Номер элемента под попаданием кадра или -1. */
  elementOfHit(hit) {
    if (!hit) return -1;
    if (this.runCount && Number.isInteger(hit.mesh) && Number.isInteger(hit.face)) {
      const element = this.runOf(hit.mesh, hit.face);
      if (element >= 0) return element;
    }
    if (!Number.isInteger(hit.entity)) return -1;
    const at = this.segmentOf(hit.entity);
    if (at < 0) return -1;
    const sheet = hit.sheet === undefined ? undefined : String(hit.sheet).toLowerCase();
    const group = hit.group === undefined ? undefined : String(hit.group).toLowerCase();
    const header = this.header;
    const offset = this.segments[at * 3 + 2];
    const total = this.candidates[offset];
    for (let candidate = 1; candidate <= total; candidate += 1) {
      const index = this.candidates[offset + candidate];
      const wantedSheet = header.s[index];
      const wantedGroup = header.g[index];
      if ((wantedSheet < 0 || header.sheets[wantedSheet] === sheet) && (wantedGroup < 0 || header.groups[wantedGroup] === group)) return index;
    }
    return -1;
  }

  kindTable() {
    if (!this.kindIndex) {
      this.kindIndex = new Map();
      for (let index = 0; index < this.count; index += 1) {
        const kind = this.header.kinds[this.header.k[index]];
        if (!this.kindIndex.has(kind)) this.kindIndex.set(kind, []);
        this.kindIndex.get(kind).push(index);
      }
    }
    return this.kindIndex;
  }

  /** Номера всех элементов рода (кнопка «Выбрать все такие»); неизвестный род — пустой список. */
  ofKind(kind) {
    const list = this.kindTable().get(kind);
    return list ? Int32Array.from(list) : new Int32Array(0);
  }

  /** Роды разметки: `[{ kind, type, count }]` по типам и порядку словаря, прочие — после. */
  kinds() {
    const table = this.kindTable();
    const order = [];
    for (const type of SELECTION_TYPES) for (const [kind] of SELECTION_KINDS[type]) order.push(kind);
    const known = new Set(order);
    const all = [...order, ...[...table.keys()].filter((kind) => !known.has(kind))];
    return all.filter((kind) => table.has(kind)).map((kind) => ({ kind, type: this.element(table.get(kind)[0]).type, count: table.get(kind).length }));
  }

  entitiesOf(index) {
    const entities = [];
    const [offset, pairs] = [this.header.e[index * 2], this.header.e[index * 2 + 1]];
    for (let pair = 0; pair < pairs; pair += 1) for (let entity = this.ranges[(offset + pair) * 2]; entity <= this.ranges[(offset + pair) * 2 + 1]; entity += 1) entities.push(entity);
    return entities;
  }

  /** Что подсвечивать у элемента: сущности (отсортированный Int32Array), лист и группа (или null), диапазоны треугольников — тройки «сетка, от, конец». */
  targetOf(index) {
    if (this.cache.has(index)) return this.cache.get(index);
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return { entities: new Int32Array(0), sheet: null, group: null, runs: new Int32Array(0) };
    const header = this.header;
    const [from, count] = [header.u[index * 2], header.u[index * 2 + 1]];
    const target = {
      entities: Int32Array.from(this.entitiesOf(index)),
      sheet: header.s[index] >= 0 ? header.sheets[header.s[index]] : null,
      group: header.g[index] >= 0 ? header.groups[header.g[index]] : null,
      runs: this.runs.slice(from * 3, (from + count) * 3),
    };
    this.cache.set(index, target);
    return target;
  }

  /**
   * Что подсвечивать у многих элементов сразу («все такие»): `{ sets: [{ entities, sheet, group }], runs }`. Наборы слиты по паре «лист, группа»
   * (лист относится к своим сущностям, а не ко всем), сущности без повторов по возрастанию, диапазоны слиты и отсортированы.
   */
  targetOfMany(indices) {
    const header = this.header;
    const sets = new Map();
    const quads = [];
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0 || index >= this.count) continue;
      const sheet = header.s[index] >= 0 ? header.sheets[header.s[index]] : null;
      const group = header.g[index] >= 0 ? header.groups[header.g[index]] : null;
      const entities = this.entitiesOf(index);
      if (entities.length) {
        const key = `${sheet}\u0000${group}`;
        if (!sets.has(key)) sets.set(key, { sheet, group, all: [] });
        for (const entity of entities) sets.get(key).all.push(entity);
      }
      const [from, count] = [header.u[index * 2], header.u[index * 2 + 1]];
      for (let run = 0; run < count; run += 1) quads.push([this.runs[(from + run) * 3], this.runs[(from + run) * 3 + 1], this.runs[(from + run) * 3 + 2]]);
    }
    const out = [];
    for (const set of sets.values()) {
      const unique = Int32Array.from(new Set(set.all));
      unique.sort();
      out.push({ entities: unique, sheet: set.sheet, group: set.group });
    }
    quads.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const [mesh, from, end] of quads) {
      const last = merged.length - 3;
      if (last >= 0 && merged[last] === mesh && from <= merged[last + 2]) merged[last + 2] = Math.max(merged[last + 2], end);
      else merged.push(mesh, from, end);
    }
    return { sets: out, runs: Int32Array.from(merged) };
  }
}

/** Тело `.selmap` → `SelectionMap`. */
export const decodeSelmap = (input) => SelectionMap.fromParts(decodeSelmapParts(input));
