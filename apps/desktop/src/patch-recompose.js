/*
 * Пересборка патча мастерской перед тем, как поставить его обратно.
 *
 * Библиотека вынимает работу из середины стопки так: перематывает update.rpf
 * к состоянию до неё и ставит обратно то, что лежало сверху
 * (`library-removal.js`). Прежде «обратно» значило «тот же патч, байт в
 * байт». Это верно, пока работы правят разные файлы, и неверно, когда файл
 * у них общий: патч хранит файл целиком таким, каким его собрали, — вместе с
 * чужой правкой, которая тогда в нём лежала.
 *
 *   килл-эффект → прицел → удалить килл-эффект:
 *     прицел ставится обратно своим патчем, а в его hud_reticle.gfx лежит
 *     знак на килле — знак «удалён», но в игре остался;
 *   оптимизация → килл-эффект → удалить оптимизацию:
 *     visualsettings.dat килл-эффекта несёт ключи оптимизации — они
 *     остались в игре после её удаления.
 *
 * Поэтому работа, которой есть что пересобрать, кладёт рядом с патчем
 * `recompose.json` — то, из чего она собрана, — и перед возвратом в игру
 * собирается заново поверх того архива, который получился после перемотки.
 * Работа сама правит только своё (свой модификатор, свой ключ, своё
 * семейство символов) и читает файлы из игры каждый раз заново, так что
 * пересобранный патч несёт ровно то, что лежит в игре сейчас, плюс её часть.
 *
 * Работа без `recompose.json` или без зарегистрированной пересборки
 * возвращается прежним патчем — как было до этого модуля.
 */

import fs from "node:fs/promises";
import path from "node:path";

export const RECOMPOSE_FILE = "recompose.json";
export const RECOMPOSE_VERSION = 1;

const recomposers = new Map();

/**
 * Регистрирует пересборку вида работы. `recompose({ sidecar, directory,
 * gameRoot, stateDir, context, tools })` возвращает `{ patch }` — папку
 * нового патча — и не пишет в игру. `tools` — подмена распаковки и движка
 * для тестов, в бою пусто.
 */
export function registerPatchRecomposer(kind, recompose) {
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(String(kind || "")))
    throw new TypeError("Вид пересборки патча назван не по правилам.");
  if (typeof recompose !== "function")
    throw new TypeError("Пересборка патча должна быть функцией.");
  recomposers.set(kind, recompose);
}

/** Записка пересборки рядом с патчем. */
export async function writeRecomposeSidecar(directory, { kind, ...data }) {
  await fs.writeFile(
    path.join(directory, RECOMPOSE_FILE),
    `${JSON.stringify({ version: RECOMPOSE_VERSION, kind, ...data }, null, 2)}\n`,
    { flag: "wx" },
  );
}

export async function readRecomposeSidecar(directory) {
  try {
    const sidecar = JSON.parse(
      await fs.readFile(path.join(directory, RECOMPOSE_FILE), "utf8"),
    );
    return sidecar?.version === RECOMPOSE_VERSION &&
      typeof sidecar.kind === "string"
      ? sidecar
      : null;
  } catch {
    return null;
  }
}

/**
 * Свежий патч той же работы поверх нынешнего архива или `null`, если
 * пересобирать нечего: записки нет, вид не зарегистрирован. Ошибка
 * пересборки не глушится — вызывающий решает, ставить ли прежний патч.
 */
export async function recomposePatch(
  directory,
  { gameRoot, stateDir, context = {}, tools = {} },
) {
  const sidecar = await readRecomposeSidecar(directory);
  if (!sidecar) return null;
  const recompose = recomposers.get(sidecar.kind);
  if (!recompose) return null;
  const result = await recompose({
    sidecar,
    directory,
    gameRoot,
    stateDir,
    context,
    tools,
  });
  if (!result?.patch) return null;
  return { patch: result.patch, kind: sidecar.kind };
}
