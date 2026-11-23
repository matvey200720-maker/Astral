import fs from "node:fs/promises";
import path from "node:path";
import { characterWritten, readClothingCharacter, warmClothingItem } from "./clothing-character.js";
import { clothingArchiveTools, clothingGameRoot, gameHash, listGameClothing, requestGender } from "./clothing-models.js";

/*
 * Соседние варианты наперёд (31.10.2026, ТЗ владельца: «выбрал другую модель — быстро отобразилась на персонаже»).
 *
 * Человек листает полку: после варианта N чаще всего берёт соседний. Пока он смотрит на персонажа, поток чтения тихо собирает персонажей с вещью N+1, N−1, N+2, N−2 из
 * того же списка слота (порядок списка — порядок плиток) и тем же комплектом: готовые GLB лежат в обычном кэше персонажей, выбор соседа — чтение файла (2 мс), а не сборка
 * (замер `wear-read.mjs`: 70–120 мс при 1×, у слабого ПК втрое).
 *
 * Предзагрузка — только на простое и только пока никто не просит нового:
 *  - начинается через `AHEAD_DELAY_MS` после ответа и ждёт `AHEAD_GAP_MS` перед каждым соседом; любой новый запрос (вариант, слот, комплект) поднимает `turn` — и
 *    всё запланированное прежним запросом отменяется (то, что уже собирается, дособирается: движок посреди чтения не остановить, но следующий сосед не берётся);
 *  - берутся вещи игры (комплект без вещей каталога: им нужна подпись пакета) — вещь категории стоит либо в `others` (режим «одеть», `bare`), либо в самом запросе;
 *  - файлов не больше `AHEAD_KEEP` сверх тех, что просили: предзагруженные не выбранные человеком вытесняются (кэш персонажей сам по себе не чистится, и четыре лишних
 *    GLB по 3–4 МБ на каждый щелчок росли бы без предела).
 * Ошибка соседа предзагрузку не ломает: вещи нет в игре, поток закрыли — просто стоп.
 */

export const AHEAD_STEPS = Object.freeze([1, -1, 2, -2]);
export const AHEAD_TIMING = { delayMs: 350, gapMs: 200, keep: 8 };

let turn = 0;
/** Файлы персонажей, собранные предзагрузкой и ещё не вытесненные (старые — первыми). */
const aheadFiles = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Какую вещь листает человек: запись комплекта этой категории или сама вещь запроса; вещь каталога или без номера — нет. */
export function browsedItem(request) {
  const slot = String(request?.slot || "");
  if (!slot || slot === "tattoos" || request?.manifest) return null;
  const others = Array.isArray(request?.others) ? request.others : [];
  if (others.some((item) => item?.manifest)) return null;
  const index = others.findIndex((item) => item?.slot === slot && Number.isInteger(Number(item?.variant)));
  if (index >= 0) return { slot, variant: Number(others[index].variant), at: index };
  if (!request?.bare && Number.isInteger(Number(request?.variant))) return { slot, variant: Number(request.variant), at: -1 };
  return null;
}

/** Тот же запрос с соседней вещью; расцветка прежней вещи к соседу не относится. */
export function requestWith(request, item, variant) {
  if (item.at >= 0) {
    const others = request.others.map((entry, index) => {
      if (index !== item.at) return entry;
      const { texture: _texture, ...rest } = entry;
      return { ...rest, variant };
    });
    return { ...request, others };
  }
  const { texture: _texture, ...rest } = request;
  return { ...rest, variant };
}

/** Соседи по списку слота в порядке предзагрузки; вещей, которых в списке нет, — нет. */
export function neighboursOf(variants, current, steps = AHEAD_STEPS) {
  const at = variants.findIndex((entry) => entry.variant === current);
  if (at < 0) return [];
  return steps.map((step) => variants[at + step]?.variant).filter((variant) => Number.isInteger(variant));
}

const characterFiles = async (folder) =>
  (await fs.readdir(folder).catch(() => [])).filter((name) => name.startsWith("character-") && name.endsWith(".glb"));

async function evictAhead(folder) {
  while (aheadFiles.length > AHEAD_TIMING.keep) await fs.rm(path.join(folder, aheadFiles.shift()), { force: true }).catch(() => {});
}

async function buildAhead(request, context, deps, mine) {
  const item = browsedItem(request);
  if (!item) return;
  const gameRoot = clothingGameRoot(request);
  const resolved = { ...clothingArchiveTools(deps.stateDir), ...(deps.tools || {}) };
  /* Пол — по вещи (02.11.2026): у женской вещи число со смещением, и в мужском списке её соседей не было — женские вещи наперёд не собирались вовсе. */
  const { variants } = await listGameClothing({ gameRoot, slot: item.slot, gender: requestGender({ variant: item.variant }) }, context, deps.stateDir, resolved);
  const folder = path.join(deps.stateDir, "clothing-models", gameHash(gameRoot));
  for (const variant of neighboursOf(variants, item.variant)) {
    if (mine !== turn) return;
    await sleep(AHEAD_TIMING.gapMs);
    if (mine !== turn) return;
    const before = new Set(await characterFiles(folder));
    await readClothingCharacter(requestWith(request, item, variant), context, deps);
    await characterWritten();
    for (const name of await characterFiles(folder)) if (!before.has(name)) aheadFiles.push(name);
    await evictAhead(folder);
  }
}

/**
 * Мост читателя: ответ как у `readClothingCharacter`, а после него — соседи на простое. Каждый новый запрос отменяет прежнюю предзагрузку. `ahead: false` в запросе — соседей не нужно: так персонажа берёт окно «Анимации»
 * (3.11.2026, у него та же сборка и тот же кэш, но вещи он не листает).
 */
export async function readClothingCharacterAhead(request, context, deps) {
  turn += 1;
  const mine = turn;
  const answer = await readClothingCharacter(request, context, deps);
  if (request?.ahead === false) return answer;
  const timer = setTimeout(() => {
    if (mine === turn) void buildAhead(request, context, deps, mine).catch(() => {});
  }, AHEAD_TIMING.delayMs);
  timer.unref?.();
  return answer;
}

/** Вещь заранее: плитка под мышью (`warmClothingItem`). Предзагрузку соседей не отменяет: новый персонаж ещё не просили. */
export const warmWearItem = (request, context, deps) => warmClothingItem(request, context, deps);

/**
 * Поднять поток читателя заранее (1.11.2026): первый запрос после простоя платит за новый поток и разбор модулей читателя (≈ 0,27 с), а окно знает, что в «Одежду» скоро войдут, — наведение на плитку
 * редактора. Пустой вызов поднимает поток и больше ничего не делает; поток живёт `CLOTHING_READER_IDLE_MS` (`game-read-host.js`).
 */
export const warmReader = () => true;

/** Для тестов: отменить всё запланированное и забыть список предзагруженных файлов. */
export function cancelAhead() {
  turn += 1;
  aheadFiles.length = 0;
}

/** Для тестов: что сейчас числится предзагруженным. */
export const aheadCached = () => [...aheadFiles];
