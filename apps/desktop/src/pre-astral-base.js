/*
 * Игра человека «до Astral» (задача 1 ТЗ 07.10.2026).
 *
 * «Стандарт» редактора, который кладёт файл, а не снимает работу (капля
 * следа на экране), возвращал файл Rockstar — даже если до Astral у
 * человека стоял свой мод. Теперь он берёт файл из сборки человека до
 * Astral: основы движка (`pristine` — игра до первой записи Astral, а после
 * правки снаружи — `original`, живой архив без записей Astral). Своего мода
 * не было — это и есть файл Rockstar.
 */

import { ensureStoredFile } from "@modovik/install-engine/chunk-store.js";
import fs from "node:fs/promises";
import path from "node:path";

const UPDATE_TARGET = "update/update.rpf";


const samePath = (left, right) =>
  path.resolve(String(left || "")).toLowerCase() === path.resolve(String(right || "")).toLowerCase();

/**
 * Путь к update.rpf «до Astral» для папки игры или `null` (движок игру ещё
 * не готовил, копии нет). Состояние читается один раз — без опроса: чтение
 * во время записи мешает переименованию файла состояния.
 */
export async function preAstralUpdateArchive({ stateDir, gameRoot }) {
  if (!stateDir || !gameRoot) return null;
  try {
    const state = JSON.parse(await fs.readFile(path.join(stateDir, "install-state.json"), "utf8"));
    for (const target of Object.values(state?.targets || {})) {
      if (!samePath(target?.gameRoot, gameRoot)) continue;
      const resource = target.resources?.[UPDATE_TARGET];
      const baseline = resource?.pristine?.exists ? resource.pristine : resource?.original;
      if (baseline?.exists && baseline.path && (await ensureStoredFile(baseline.path))) return baseline.path;
    }
  } catch {
    /* состояния нет или оно занято — «до Astral» не узнать */
  }
  return null;
}
