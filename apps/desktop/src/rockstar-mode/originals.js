/*
 * Архивы подмены у игры (05.11.2026): откуда режим знает, какие файлы
 * подменять. Один источник для окна и агента.
 *
 *   — «игра до Astral» из состояния движка: что лаунчер Rockstar ждёт в каждом
 *     архиве, куда писал Astral (`путь в игре` → `{ path, sha256 }`). Только
 *     файлы, которые были в игре до Astral: свои новые архивы Astral лаунчер
 *     не сверяет. update.rpf — первым: игра открывает его раньше всех;
 *   — подмена, что уже лежит на диске (`swappedRels`): по ней ставятся и
 *     паркуются моды, даже если движок о них уже забыл.
 */

import path from "node:path";
import { readStateShared } from "@modovik/install-engine/engine-state.js";
import { originalRestoreBaseline } from "@modovik/install-engine/pristine-baseline.js";
import { UPDATE_RPF } from "@modovik/install-engine/rockstar-swap.js";
import { relsWithSwap } from "@modovik/install-engine/rockstar-mode/session.js";

const keyOf = (gameRoot) => path.resolve(String(gameRoot || "")).toLowerCase();

/** `[{ rel, path, sha256 }]`, update.rpf — первым. */
export async function engineOriginals(stateDir, gameRoot) {
  const state = await readStateShared(stateDir).catch(() => null);
  const found = new Map();
  for (const target of Object.values(state?.targets || {})) {
    if (!target?.gameRoot || keyOf(target.gameRoot) !== keyOf(gameRoot)) continue;
    for (const [rel, resource] of Object.entries(target.resources || {})) {
      const key = String(rel).replace(/\\/g, "/");
      if (!/\.rpf$/i.test(key) || /^mods\//i.test(key) || found.has(key.toLowerCase())) continue;
      const baseline = originalRestoreBaseline(resource);
      if (baseline?.exists && baseline.path) found.set(key.toLowerCase(), { rel: key, path: baseline.path, sha256: baseline.sha256 || null });
    }
  }
  return [...found.values()].sort((a, b) => (b.rel.toLowerCase() === UPDATE_RPF) - (a.rel.toLowerCase() === UPDATE_RPF));
}

/** Архивы подмены у игры: из движка и с диска (update.rpf — первым). */
export async function swapRelsOf(stateDir, gameRoot, originals = null) {
  const known = (originals || (await engineOriginals(stateDir, gameRoot))).map((item) => item.rel);
  return relsWithSwap(gameRoot, known);
}
