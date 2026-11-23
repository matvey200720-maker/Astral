/*
 * Что ещё автор поставил в зал Majestic своего — витрина для галереи (12.11.2026, ALLIANCE V3: «превью изнутри, со звездой и всем визуалом»).
 *
 * Свои модели автора — те, чьих имён нет среди файлов и расстановки стандартной арены сервера, — не лежат у круга, на который смотрят общие ракурсы: у ALLIANCE
 * статуи участников и трон стоят на сцене третьей комнаты (31 м севернее круга), стена стволов занимает четвёртую, флаг висит на стене круга. Здесь они сводятся в
 * несколько групп по близости их границ (`arena-bounds.js`): сцена, стена, флаг — каждая группа получает свои кадры (`arena-view-plan.js`).
 */

import path from "node:path";

import { boundsCentre, boundsGap, boundsSize, mergeBounds, placedBounds } from "./arena-bounds.js";

/* Модели ближе друг к другу этого (м) — одна группа: статуи и трон на сцене — одна, стена стволов — другая. */
const GROUP_GAP = 5;
/* Меньше этого (м) — мелочь (кнопка, табличка), своей группы не получает. */
const MIN_SIZE = 0.3;
/* Сколько групп идёт в галерею: по два кадра на группу, а в галерее не больше двенадцати. */
const LIMIT = 3;

const stemOf = (name) => String(name || "").toLowerCase().replace(/\.[a-z0-9]{2,5}$/, "");

/**
 * Группы своих моделей автора.
 *
 * @param {{ pieces?: object[], placements?: object[] }} manifest расстановка зала; у деталей `overlay` (файл мода), `stub` (пустышка), `bounds` (границы модели)
 * @param {{ stock?: { has: (stem: string) => boolean }, hidden?: string[], skip?: string[], gap?: number, limit?: number }} [options] `stock` — штатные имена сервера,
 *   `hidden` — пустые модели мода, `skip` — модели, что уже заняты (звезда)
 * @returns {{ id: string, stems: string[], min: number[], max: number[], at: number[], size: number, count: number }[]} крупные группы первыми: больше размещений, больше размер
 */
export function showcaseGroups(manifest, { stock = { has: () => false }, hidden = [], skip = [], gap = GROUP_GAP, limit = LIMIT } = {}) {
  const pieces = manifest?.pieces || [];
  const gone = new Set([...hidden, ...skip].map(stemOf));
  const items = [];
  for (const placement of manifest?.placements || []) {
    const piece = pieces[placement.piece];
    if (!piece?.overlay || piece.stub || !piece.bounds || stock.has(piece.stem) || gone.has(piece.stem)) continue;
    const box = placedBounds(piece.bounds, placement);
    if (box && boundsSize(box) >= MIN_SIZE) items.push({ stem: piece.stem, box });
  }
  /* Связность по близости: объединяем коробки, пока между ними меньше `gap`. */
  const parent = items.map((_, index) => index);
  const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let left = 0; left < items.length; left += 1)
    for (let right = left + 1; right < items.length; right += 1)
      if (boundsGap(items[left].box, items[right].box) <= gap) parent[find(right)] = find(left);
  const clusters = new Map();
  items.forEach((item, index) => {
    const root = find(index);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(item);
  });
  return [...clusters.values()]
    .map((members) => {
      const box = mergeBounds(members.map((member) => member.box));
      return { stems: [...new Set(members.map((member) => member.stem))].sort(), min: box.min, max: box.max, at: boundsCentre(box), size: Math.round(boundsSize(box) * 100) / 100, count: members.length };
    })
    .sort((left, right) => right.count - left.count || right.size - left.size || (left.stems[0] < right.stems[0] ? -1 : 1))
    .slice(0, Math.max(0, limit))
    .map((group, index) => ({ id: `showcase-${index + 1}`, ...group }));
}

/**
 * Опись своих моделей автора: что из его файлов есть в кадрах и чего нет, и почему (13.11.2026, ALLIANCE V3: «все модели автора внутри»).
 *
 * Берутся все модели (`.ydr`, `.yft`), что мод принёс, и каждой ставится одно из состояний:
 *   • `inScene` — стоит в расстановке зала и её сетки в сцене;
 *   • `missing` — стоит в расстановке, но конвертер сеток не отдал (в кадре её нет);
 *   • `stub` — пустышка: файл без геометрии прячет штатную модель сервера (так задумал автор);
 *   • `notDrawn` — стоит в расстановке, сетки отданы, но кадр их не рисует (одни тени и грязь, «не цвет»);
 *   • `unplaced` — в расстановке зала нет вовсе: модель из другого MLO (`mazearena_int_1/2.ytyp`) или в расстановке по хэшу, которого зал не разрешил.
 *
 * @param {{ manifest?: { pieces?: object[], unresolved?: number }, files?: { name: string }[], sceneStems?: Iterable<string>, stats?: { ownMissing?: string[] }, uvClips?: string[] }} input
 *   `sceneStems` — модели, чьи сетки попали в сцену (`hallScene({ keepSolids })`); `stats` — её опись; `uvClips` — модели, у которых взят первый кадр клипа развёртки (экраны-раскладки)
 * @returns {{ inScene: string[], missing: string[], stub: string[], notDrawn: string[], unplaced: string[], unresolved: number, uvClips: string[] }}
 */
export function ownModelInventory({ manifest = null, files = [], sceneStems = [], stats = null, uvClips = [] } = {}) {
  const pieces = new Map((manifest?.pieces || []).map((piece) => [String(piece.stem).toLowerCase(), piece]));
  const inScene = new Set([...sceneStems].map((stem) => String(stem).toLowerCase()));
  const absent = new Set((stats?.ownMissing || []).map((stem) => String(stem).toLowerCase()));
  const out = { inScene: [], missing: [], stub: [], notDrawn: [], unplaced: [], unresolved: manifest?.unresolved ?? 0, uvClips: [...uvClips].sort() };
  const models = files.filter((file) => /\.(ydr|yft)$/i.test(String(file?.name || ""))).map((file) => stemOf(path.basename(String(file.name))));
  for (const stem of [...new Set(models)].sort()) {
    const piece = pieces.get(stem);
    if (!piece) out.unplaced.push(stem);
    else if (piece.stub) out.stub.push(stem);
    else if (absent.has(stem)) out.missing.push(stem);
    else if (inScene.has(stem)) out.inScene.push(stem);
    else out.notDrawn.push(stem);
  }
  return out;
}
