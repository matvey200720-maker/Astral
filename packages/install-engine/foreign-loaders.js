/*
 * Чужие загрузчики в папке игры (владелец, 02.11.2026: «чтобы Астрал сам
 * устанавливал или удалял, если ему что-то мешает»). Новичок с накачанным
 * OpenIV не должен ничего делать руками, а подготовка раньше отказывала.
 *
 * Мешают две вещи:
 *  - копия `mods/update/update.rpf`: с любым ASI-загрузчиком игра читает её, а
 *    не тот update.rpf, куда пишет Astral (`inspectModsShadow`);
 *  - чужой плагин архивов рядом с RageOpenV.asi: два перехватчика чтения в игре
 *    не проверены, а Astral ставит и проверяет один.
 *
 * Ничего не стирается: файл переименовывается там же, где лежит (мгновенно и
 * без места на диске, даже для архива в гигабайты), и больше не читается.
 * «Вернуть GTA V без модов» ставит его обратно (`returnParkedLoaders`).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { MODS_SHADOW_ARCHIVE } from "./astral-layer.js";
import { MODS_PLUGINS } from "./loader-policy.js";

export const PARKED_LOADER_SUFFIX = ".astral-parked";

const FOREIGN_PLUGINS = MODS_PLUGINS.filter((name) => name !== "RageOpenV.asi");

const there = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

const liveFile = (gameRoot, relative) =>
  path.join(path.resolve(gameRoot), ...relative.split("/"));

/* Уже отложенный файл не затирается: это может быть другая версия. */
async function freeParkedName(live) {
  for (let number = 1; ; number += 1) {
    const name = `${live}${PARKED_LOADER_SUFFIX}${number > 1 ? `.${number}` : ""}`;
    if (!(await there(name))) return name;
  }
}

async function parkAll(gameRoot, relatives) {
  const parked = [];
  for (const relative of relatives) {
    const live = liveFile(gameRoot, relative);
    if (!(await there(live))) continue;
    await fs.rename(live, await freeParkedName(live));
    parked.push(relative);
  }
  return parked;
}

/** Убирает копию архива из `mods`: после подготовки загрузчик есть всегда, и она стала бы тенью. */
export function parkModsShadowArchive(gameRoot) {
  return parkAll(gameRoot, [MODS_SHADOW_ARCHIVE]);
}

/** Убирает чужие плагины архивов: читать `mods` дальше будет RageOpenV.asi. */
export function parkForeignPlugins(gameRoot) {
  return parkAll(gameRoot, FOREIGN_PLUGINS);
}

/** Возвращает отложенное на место; файл, появившийся там за это время, остаётся. */
export async function returnParkedLoaders(gameRoot) {
  const returned = [];
  for (const relative of [...FOREIGN_PLUGINS, MODS_SHADOW_ARCHIVE]) {
    const live = liveFile(gameRoot, relative);
    const parked = `${live}${PARKED_LOADER_SUFFIX}`;
    if (!(await there(parked)) || (await there(live))) continue;
    await fs.rename(parked, live);
    returned.push(relative);
  }
  return returned;
}
