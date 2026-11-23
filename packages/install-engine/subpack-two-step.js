/*
 * Подпакет штатного пакета (`dlc<N>.rpf`, `carrier-targets.js: isSubpackCarrier`) собирается с нуля В ДВА ХОДА (21.11.2026, задание 9, замер `scripts/probe-subpack-big.mjs --mode two-step`):
 *   1. `create` ЗАТРАВКИ — по одной самой малой записи в КАЖДЫЙ вложенный контейнер: помощник создаёт корневой архив и все контейнеры сразу, в памяти лишь затравка;
 *   2. `compose` остальных записей с затравкой как основой, цель та же: контейнеры уже лежат в основе, поэтому писатель — Rust-движок (`rpf-composer.js: chooseComposeWriter`), а не помощник.
 * Зачем. Помощник в режиме `create` собирает каждый вложенный контейнер в `MemoryStream` (`tools/rpf-helper/Program.cs: PopulateCreatedArchiveAsync`): пик частной памяти ≈ 2,0–2,4 × размера результата
 * (замер на слабом ПК: 1,0 ГиБ — 2015–2376 МиБ), 4 ГиБ дали бы ≈ 8 ГиБ. Режим `compose` стримит вложенные контейнеры через временные файлы: на 1,0 ГиБ второй ход держит 11 МиБ (движок), на 2,0 ГиБ в `update2.rpf`
 * помощник — 104 МиБ. Поэтому потолок подпакета (`SUBPACK_LANE_BYTES`) ограничен только форматом, а не памятью писателя — когда сборка в два хода пройдёт сюжет, потолок поднимется отдельным решением.
 * Цена. Второй ход пишет ≈ 2 × объёма (вложенный контейнер во временный файл, потом в корневой: на 1 ГиБ результата движок записал 1986 МиБ, `writtenBytes` ответа 2 082 949 632; одноходовой `create` — 1004 МиБ);
 * затравка крошечная (на 4 контейнера 553 КБ вместе с хвостом), копия основы в стейдж лишних байт не добавляет. У движка есть запись вложенных сразу во внешний (`ASTRAL_ENGINE_NESTED_DIRECT=1`,
 * `docs/INSTALL-RUST-COMPOSE-FAST.md`), по умолчанию выключена; здесь не включается. Результат от одноходового `create` отличается: состав, порядок и размеры файлов в записях те же, вложенные контейнеры
 * компактнее на 3–5 МБ (на 1 ГиБ — на 1,1 %), побайтно файлы не равны; ключ шапки (по имени и длине) снаружи и во вложенных верен (`keyGuessed: false`).
 * Выбор затравки ДЕТЕРМИНИРОВАН (наименьший файл контейнера, при равенстве — меньшая запись), поэтому одни и те же операции дают одни и те же ходы.
 * Один путь для любого объёма: если в каждом контейнере по одному файлу, второй ход пуст и не выполняется (остаётся один `create`, как до этого) — отдельной «одноходовой» ветки нет.
 * Модуль без ввода-вывода в выборе затравки (чистые функции), сборка — через переданный `rpfComposer`.
 */
import fs from "node:fs/promises";
import { throwIfAborted } from "./runtime-guard.js";

/** Метка способа сборки в отпечатке сборки: подпакет в два хода не тот же файл, что одноходовой `create`. */
export const SEED_METHOD = "seed-smallest-then-compose-v1";

const isContainerName = (segment) => /\.rpf$/i.test(segment);
const byEntry = (a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0);

/** Самый глубокий вложенный архив записи (путь до него, строчными): `x64/levels/gta5/a.rpf/f.ytd` — `x64/levels/gta5/a.rpf`; записи вне вложенного архива — `null`. Последний сегмент (сам файл) контейнером не считается. */
export function deepestContainerOf(entry) {
  const parts = String(entry ?? "").replaceAll("\\", "/").split("/").filter(Boolean);
  let last = -1;
  for (let index = 0; index < parts.length - 1; index += 1) if (isContainerName(parts[index])) last = index;
  return last < 0 ? null : parts.slice(0, last + 1).join("/").toLowerCase();
}

/**
 * Делит операции на затравку и остальное: в затравку идёт самая малая по размеру запись КАЖДОГО самого глубокого контейнера (при равных размерах — меньшая по имени записи), поэтому после первого хода в
 * основе есть все нужные контейнеры (каждый — префикс какого-то самого глубокого). Удаления и записи вне вложенных архивов затравкой не бывают. `sizeOf(operation)` — размер источника, байт.
 * Ответ: `{ seed, rest }`; `seed` отсортирован по записи, `rest` сохраняет порядок входа.
 */
export function splitSeedOperations(operations, sizeOf) {
  const best = new Map();
  for (const operation of operations || []) {
    if (operation?.action === "delete") continue;
    const key = deepestContainerOf(operation?.entry);
    if (key === null) continue;
    const size = Number(sizeOf?.(operation)) || 0;
    const current = best.get(key);
    if (!current || size < current.size || (size === current.size && operation.entry < current.operation.entry)) best.set(key, { operation, size });
  }
  const chosen = new Set([...best.values()].map((item) => item.operation));
  return { seed: [...chosen].sort(byEntry), rest: (operations || []).filter((operation) => !chosen.has(operation)) };
}

/** Размер самого большого контейнера по операциям (сумма источников его записей): столько временного места нужно второму ходу под вложенный контейнер. */
export function largestContainerBytes(operations, sizeOf) {
  const sums = new Map();
  for (const operation of operations || []) {
    if (operation?.action === "delete") continue;
    const key = deepestContainerOf(operation?.entry);
    if (key === null) continue;
    sums.set(key, (sums.get(key) || 0) + (Number(sizeOf?.(operation)) || 0));
  }
  return Math.max(0, ...sums.values());
}

/**
 * Собирает подпакет с нуля в два хода и возвращает `{ composed, stage }`: ответ последнего хода и путь готового стейджа (его переименует вызывающий). Имена стейджей — от `stageBase`: затравка
 * `<stageBase>.seed.stage.rpf` (помощник в режиме `create` требует `.rpf` на выходе, уборка кэша знает `.stage.rpf`), результат второго хода `<stageBase>.stage`; без второго хода результат — сам
 * `<stageBase>.stage.rpf`. Затравка убирается всегда, недописанный стейдж — при любом отказе и отмене между ходами: на месте цели недописанного файла не остаётся.
 * Если операций вне вложенных архивов только они (затравки брать неоткуда), всё идёт одним `create`, как было.
 */
export async function composeSubpackInTwoSteps({ rpfComposer, operations, sizeOf, stageBase, stagingDirectory, archiveTarget, edition, gameRoot, allowDeletes = false, signal = null, note = () => {} }) {
  const split = splitSeedOperations(operations, sizeOf);
  const first = split.seed.length ? split.seed : operations;
  const rest = split.seed.length ? split.rest : [];
  const single = rest.length === 0;
  const seedStage = single ? `${stageBase}.stage.rpf` : `${stageBase}.seed.stage.rpf`;
  const finalStage = single ? seedStage : `${stageBase}.stage`;
  try {
    throwIfAborted(signal);
    note(single ? "подпакет: create (второй ход пуст)" : "подпакет: ход 1, create затравки", `${first.length} записей`);
    const created = await rpfComposer({ baseArchive: null, outputArchive: seedStage, stagingDirectory, archiveTarget, edition, gameRoot, operations: first, allowDeletes: false, signal });
    if (single) return { composed: created, stage: finalStage };
    throwIfAborted(signal);
    const stat = await fs.lstat(seedStage);
    if (!stat.isFile() || stat.size < 16) throw new Error(`Затравка подпакета создана некорректно: ${archiveTarget}`);
    note("подпакет: ход 2, compose остального с затравкой как основой", `${rest.length} записей`);
    const composed = await rpfComposer({ baseArchive: seedStage, outputArchive: finalStage, stagingDirectory, archiveTarget, edition, gameRoot, operations: rest, allowDeletes, signal });
    return { composed, stage: finalStage };
  } catch (error) {
    await fs.rm(finalStage, { force: true }).catch(() => {});
    throw error;
  } finally {
    if (!single) await fs.rm(seedStage, { force: true }).catch(() => {});
  }
}
