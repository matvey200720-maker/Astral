/*
 * Сверка слоя движка с живым update.rpf (14.11.2026, «Дороги» и фонари пропали после замены прежней версии у тестера beta.103).
 *
 * Состояние движка помнит, что он положил в update.rpf: контейнеры `x64/astral/*.rpf` (строки content.xml) и прямые регистрации своих DLC (строки dlclist.xml).
 * Перемотка к снимку «до» вернула архив, где этого нет, а быстрый путь подготовки слоя («ready») и «Astral ушёл» (`stock`) пересборку не делают. Здесь только сверка:
 * оглавление и два XML из живого архива, без разбора двух гигабайт, и ничего не пишется. Пересборку зовёт приложение (`prepareAstralLayer({ force: true })`).
 */

import path from "node:path";
import { ASTRAL_UPDATE_TARGET } from "./registry-composers.js";
import {
  inspectAstralRegistrations,
  ownedAstralRegistrations,
} from "./astral-layer.js";
import { resolveInside } from "./manifest.js";
import { readState } from "./engine-state.js";
import { checkedRecordKey, ownRecordValue } from "./state-record.js";
import { exists, statePaths, targetKeyFor } from "./storage-state.js";

/**
 * Чего из записанного движком нет в живом update.rpf.
 * @returns {Promise<null | { containers: string[], dlcs: string[], owned: { containers: string[], dlcs: string[] } }>}
 *   `null` — сверить нечем (нет провайдеров, цели, архива, чтение упало): поведение прежнее.
 */
export async function engineLayerGaps({
  gameRoot,
  targetId,
  edition = "Legacy",
  stateDir,
  contentXmlProvider,
  dlcListProvider,
}) {
  if (
    typeof contentXmlProvider !== "function" ||
    typeof dlcListProvider !== "function"
  )
    return null;
  try {
    const root = path.resolve(gameRoot);
    const state = await readState(stateDir);
    const targetKey = targetKeyFor(targetId, root);
    checkedRecordKey(targetKey, "Target ID");
    const target = ownRecordValue(state.targets, targetKey);
    if (!target) return null;
    const owned = ownedAstralRegistrations(target);
    if (!owned.containers.length && !owned.dlcs.length)
      return { containers: [], dlcs: [], owned };
    const livePath = resolveInside(root, ASTRAL_UPDATE_TARGET);
    if (!(await exists(livePath))) return null;
    const live = await inspectAstralRegistrations({
      archivePath: livePath,
      gameRoot: root,
      edition: target.edition || edition,
      paths: statePaths(stateDir),
      targetKey,
      contentXmlProvider,
      dlcListProvider,
    });
    if (!live) return null;
    return {
      containers: owned.containers.filter(
        (name) => !live.containers.includes(name),
      ),
      dlcs: owned.dlcs.filter((name) => !live.dlcs.includes(name)),
      owned,
    };
  } catch {
    return null;
  }
}
