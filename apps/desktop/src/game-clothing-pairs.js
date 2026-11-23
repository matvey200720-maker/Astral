/*
 * Пары «мужская вещь → женская вещь» из игры игрока (ТЗ владельца 29.10.2026, «скин одежды на женского персонажа», п. 2).
 *
 * Оглавление игры (`game-clothing-index.js`) знает, какие вещи есть у обоих полов, как они названы и под какими ярлыками магазина;
 * `@modovik/clothing/pairs` превращает это в таблицу пар. Здесь она привязана к вещам «Моделей» мастерской — к их числам (мужские — как в
 * игре, женские — со смещением `FEMALE_VARIANT`) — и дополняется кроем по моделям там, где ярлыка и названия нет (базовая игра, патчи):
 * номер сам по себе ничего не доказывает, а рукав, капюшон и длина вещи — доказывают.
 *
 * Только чтение: ничего не пишется ни в игру, ни в данные приложения. Пары кэшируются по отпечатку игры — пока `update.rpf` и набор
 * дополнений те же, таблица не пересобирается.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { inflateRawNode } from "@modovik/rpf7/node";
import { clothingDrawable } from "@modovik/clothing/model";
import { garmentShape } from "@modovik/clothing/garment-shape";
import { folderOfGender } from "@modovik/clothing/gender";
import { MAX_PAIR_CANDIDATES, PAIR_CONFIDENT, buildGamePairs, pairItemKey, rankByShape, shapeCloseness } from "@modovik/clothing/pairs";
import { clothingArchiveTools, clothingGameRoot, clothingSource, listGameClothing, placeOfItem } from "./clothing-models.js";
import { readGameClothingIndex } from "./game-clothing-index.js";

const EMPTY = Object.freeze({ pairs: {}, stats: { males: 0, paired: 0, confident: 0 } });
const memo = new Map();

/**
 * Таблица пар игры: `{ status, table }`. Нет игры или оглавление не прочлось — `status` говорит об этом, таблица пустая. Таблица
 * пересобирается, только когда у оглавления другой отпечаток (обновилась игра).
 */
export async function readGamePairs({ gameRoot, stateDir, keysDirectory, readIndex = readGameClothingIndex }) {
  const root = String(gameRoot || "");
  if (!root) return { status: "no-game", table: EMPTY };
  try {
    const index = await readIndex({ gameRoot: root, stateDir, keysDirectory });
    const cached = memo.get(root);
    if (cached && index.fingerprint && cached.fingerprint === index.fingerprint) return { status: "ready", table: cached.table };
    const table = buildGamePairs(index);
    memo.set(root, { fingerprint: index.fingerprint || "", table });
    return { status: "ready", table };
  } catch (error) {
    return { status: "unreadable", reason: String(error?.message || error).slice(0, 200), table: EMPTY };
  }
}

/** Забыть таблицы и снятый крой (тесты, смена игры). */
export function forgetGamePairs() {
  memo.clear();
  shapes.clear();
}

/** Место вещи «Моделей» в игре: вид, папка и номер игры. Базовая вещь — папка персонажа и её номер, вещь дополнения — её `replaces`. */
export function pairRefOf(source, item) {
  const own = item.replaces?.find((entry) => entry && !entry.server) || null;
  const drawable = own ? own.drawable : Number(/_(\d{3})(?:_[ur])?\.ydd$/i.exec(item.model || "")?.[1]);
  const folder = own ? own.folder : path.posix.basename(placeOfItem(source, item).folder);
  if (!Number.isInteger(drawable) || !folder) return null;
  return { component: source.component, folder: folder.toLowerCase(), drawable, key: pairItemKey({ component: source.component, folder, drawable }) };
}

/* Крой модели — один раз за запуск: читать и разбирать модели по десятку на вещь незачем дважды. */
const shapes = new Map();

/** Крой модели вещи «Моделей» (`garmentShape`) или `null`, если модель не прочлась. */
export async function readItemShape({ gameRoot, source, item, stateDir = "" }, resolved, context) {
  /* Тесты и песочница подставляют свой крой: `resolved.itemShape({ source, item })`. */
  if (resolved.itemShape) return resolved.itemShape({ source, item });
  const place = placeOfItem(source, item);
  const key = `${gameRoot.toLowerCase()}|${place.archive}|${place.folder}|${item.model}|${item.modelSize || ""}`;
  if (shapes.has(key)) return shapes.get(key);
  const work = path.join(stateDir || os.tmpdir(), "clothing-models", "work", `pair-${randomUUID()}`);
  let shape = null;
  try {
    await fs.mkdir(work, { recursive: true });
    const file = path.join(work, "item.ydd");
    await resolved.read({ gameRoot, entry: `${place.archive.replace(/\.rpf$/i, "")}:/${place.folder}/${item.model}`, output: file }, context);
    shape = garmentShape(clothingDrawable(await fs.readFile(file), { inflateRaw: inflateRawNode }), source.component);
  } catch {
    /* модель не прочлась — крой неизвестен, пара остаётся по ярлыку или номеру */
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
  shapes.set(key, shape);
  return shape;
}

/** Сколько женских вещей того же вида проверяется по крою, когда ярлыка и названия нет: ближние по номеру первыми. */
const SHAPE_POOL = 36;
/** Сколько женских вещей читается, когда мужская вещь не из игры (мод со своей моделью): ближние по размеру файла модели первыми. */
const SUGGEST_POOL = 60;
/** Сколько похожих женских вещей предлагается человеку. */
const SUGGEST_LIMIT = 5;

/**
 * Похожие женские вещи игры для мужской вещи НЕ из игры — мода каталога со своей моделью (ТЗ 29.10.2026, п. 5: мужскую модель на женское тело не поставить, но
 * картинку можно перенести на «похожую» женскую вещь). Сравнивается крой моделей (`shapeCloseness`): рукав, капюшон, длина, ширина. Читаются модели
 * ближайших по размеру файла кандидатов категории; подходящие по крою — первыми. Ответ: `[{ variant, name, closeness, fits, shape }]`.
 */
export async function suggestFemaleByShape({ gameRoot, slot, maleShape, maleSize = 0, stateDir }, resolved, context) {
  if (!maleShape || maleShape.placeholder) return [];
  const female = clothingSource(slot, "female");
  const her = (await listGameClothing({ gameRoot, slot, gender: "female" }, context, stateDir, resolved)).variants;
  const near = (item) => (maleSize > 0 && item.modelSize > 0 ? Math.abs(Math.log(item.modelSize / maleSize)) : 0);
  const pool = [...her].sort((left, right) => near(left) - near(right)).slice(0, SUGGEST_POOL);
  const rows = [];
  for (const item of pool) {
    const shape = await readItemShape({ gameRoot, source: female, item, stateDir }, resolved, context);
    const verdict = shapeCloseness(maleShape, shape);
    if (verdict) rows.push({ variant: item.variant, ...(item.name ? { name: item.name } : {}), closeness: verdict.closeness, fits: verdict.fits, shape: verdict });
  }
  rows.sort((left, right) => Number(right.fits) - Number(left.fits) || right.closeness - left.closeness);
  return rows.slice(0, SUGGEST_LIMIT);
}

/** Строка ответа: число женской вещи «Моделей», её имя, счёт, чем подтверждена, уверенная ли пара, крой (если снимался). */
const answerOf = (candidate, names = new Map()) => ({
  variant: candidate.variant,
  ...(names.get(candidate.variant) ? { name: names.get(candidate.variant) } : {}),
  score: candidate.score,
  why: candidate.why,
  confident: candidate.score >= PAIR_CONFIDENT,
  ...(candidate.shape ? { shape: candidate.shape } : {}),
});

/**
 * Пары категории: для каждой мужской вещи «Моделей» — женские кандидаты, лучший первым. Без `variant` — только то, что говорит оглавление
 * (ярлык, название, номер): мгновенно и на весь список. С `variant` — одна вещь, и если уверенной пары нет, женские вещи этого вида
 * проверяются по крою (`rankByShape`): читаются модели ближних кандидатов.
 *
 * Ответ: `{ slot, status, pairs: { <число мужской вещи>: [{ variant, score, why, confident, shape? }] } }`.
 */
export async function listGamePairs(input, context, stateDir, tools = {}) {
  const slot = String(input?.slot || "");
  const source = clothingSource(slot);
  if (source.fixed) return { slot, status: "ready", pairs: {} };
  const gameRoot = clothingGameRoot(input);
  const resolved = { ...clothingArchiveTools(stateDir), ...tools };
  const female = clothingSource(slot, "female");
  const him = (await listGameClothing({ gameRoot, slot }, context, stateDir, resolved)).variants;
  const her = (await listGameClothing({ gameRoot, slot, gender: "female" }, context, stateDir, resolved)).variants;
  const { status, reason, table } = await readGamePairs({
    gameRoot,
    stateDir,
    keysDirectory: input?.keysDirectory || null,
    readIndex: tools.readIndex || (resolved.index ? ({ gameRoot: root, stateDir: state }) => resolved.index({ gameRoot: root, stateDir: state }) : undefined),
  });
  const herNames = new Map(her.filter((item) => item.name).map((item) => [item.variant, item.name]));
  const herByKey = new Map();
  for (const item of her) {
    const ref = pairRefOf(female, item);
    if (ref && !herByKey.has(ref.key)) herByKey.set(ref.key, item);
  }
  const wanted = Number.isInteger(Number(input?.variant)) && input?.variant !== null && input?.variant !== undefined ? Number(input.variant) : null;
  const pairs = {};
  for (const item of him) {
    if (wanted !== null && item.variant !== wanted) continue;
    const ref = pairRefOf(source, item);
    if (!ref) continue;
    const found = [];
    for (const candidate of table.pairs[ref.key] || []) {
      const herItem = herByKey.get(pairItemKey({ component: source.component, folder: candidate.folder, drawable: candidate.drawable }));
      if (herItem) found.push({ ...candidate, variant: herItem.variant });
    }
    const list =
      wanted !== null && !(found[0]?.score >= PAIR_CONFIDENT)
        ? (await refineByShape({ gameRoot, stateDir, source, female, item, ref, found, her, resolved, context })).map((row) => ({ ...row, ...(herNames.get(row.variant) ? { name: herNames.get(row.variant) } : {}) }))
        : found.map((candidate) => answerOf(candidate, herNames));
    if (list.length) pairs[item.variant] = list.slice(0, MAX_PAIR_CANDIDATES);
  }
  return { slot, status, ...(reason ? { reason } : {}), pairs };
}

/*
 * Крой вместо ярлыка: кандидаты по оглавлению плюс женские вещи того же дополнения (ближние по номеру первыми) — их модели читаются,
 * рукав, капюшон и длина сверяются с мужской. Берутся те, что по крою сходятся (или сошлись по названию); номер без подтверждения
 * не выдаётся за пару.
 */
async function refineByShape({ gameRoot, stateDir, source, female, item, ref, found, her, resolved, context }) {
  const maleShape = await readItemShape({ gameRoot, source, item, stateDir }, resolved, context);
  const pool = new Map(found.map((candidate) => [candidate.variant, candidate]));
  const family = folderOfGender(ref.folder, "female").toLowerCase();
  const sameFamily = her
    .map((herItem) => ({ herItem, ref: pairRefOf(female, herItem) }))
    .filter((entry) => entry.ref && entry.ref.folder === family && !pool.has(entry.herItem.variant))
    .sort((left, right) => Math.abs(left.ref.drawable - ref.drawable) - Math.abs(right.ref.drawable - ref.drawable))
    .slice(0, SHAPE_POOL);
  for (const { herItem, ref: herRef } of sameFamily)
    pool.set(herItem.variant, { score: 0, why: "shape", folder: herRef.folder, drawable: herRef.drawable, variant: herItem.variant });
  const known = {};
  const herByVariant = new Map(her.map((herItem) => [herItem.variant, herItem]));
  for (const candidate of pool.values()) {
    const shape = await readItemShape({ gameRoot, source: female, item: herByVariant.get(candidate.variant), stateDir }, resolved, context);
    if (shape) known[pairItemKey({ component: source.component, folder: candidate.folder, drawable: candidate.drawable })] = shape;
  }
  return rankByShape([...pool.values()], maleShape, known, source.component)
    .filter((candidate) => candidate.score >= PAIR_CONFIDENT || (candidate.shape ? candidate.shape.fits : candidate.score > 0))
    .map((candidate) => answerOf(candidate));
}
