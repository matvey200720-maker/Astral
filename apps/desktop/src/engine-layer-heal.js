/*
 * Самопочинка слоя движка в update.rpf (14.11.2026, «Дороги» и фонари пропали после замены прежней версии у тестера beta.103).
 *
 * Перемотка, которой уборка в библиотеке снимает прежнюю точку, возвращает update.rpf к снимку «до неё»; всё, что движок положил позже (регистрации DLC в dlclist.xml,
 * контейнеры `x64/astral` в content.xml, пакет моделей фонарей), остаётся только в состоянии движка. Быстрый путь подготовки слоя такой архив считает «ready», а при
 * потере всего — «Astral ушёл». Здесь живой архив сверяется с состоянием (`engineLayerGaps` движка: оглавление и два XML, без разбора двух гигабайт), и при расхождении слой
 * собирается заново (`provisionAstralLayer({ force: true })`): правки мастерской, лёгшие в живой архив, основа вбирает сама, работы остаются на месте.
 * Нечем прочитать — ничего не делаем. Вызывают: конец уборки и удаления из библиотеки, начало применения фонарей.
 */

import { engineLayerGaps } from "@modovik/install-engine";
import { appLog } from "./app-log.js";
import { provisionAstralLayer } from "./astral-layer-provisioner.js";
import {
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";

const firstLine = (error) =>
  String(error?.message || error || "неизвестная ошибка")
    .split(/\r?\n/)[0]
    .slice(0, 200);

/** Что пропало, для журнала: «регистрации astral_roads_b; контейнеры x64/astral/astral_lights.rpf». */
export function gapsText(gaps) {
  return [
    gaps?.dlcs?.length ? `регистрации ${gaps.dlcs.join(", ")}` : "",
    gaps?.containers?.length ? `контейнеры ${gaps.containers.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * @param {object} input
 * @param {string} input.gameRoot папка игры
 * @param {string} input.targetId цель движка (id игры)
 * @param {string} input.stateDir
 * @param {string} input.reason после чего проверяем: «уборки», «удаления», «перед фонарями»
 * @param {() => Promise<void>=} input.assertRuntimeSafety
 * @returns {Promise<{outcome: "unreadable"|"intact"|"rebuilt"|"failed", gaps?: object, status?: string, changed?: boolean, reason?: string}>}
 */
export async function healEngineLayer({
  gameRoot,
  targetId,
  edition = "Legacy",
  stateDir,
  reason = "",
  assertRuntimeSafety = async () => {},
  contentXmlProvider = provideUpdateContentXml,
  dlcListProvider = provideLegacyDlcList,
  gapsOf = engineLayerGaps,
  provision = provisionAstralLayer,
  log = (entry) => appLog.record(entry),
}) {
  let gaps = null;
  try {
    gaps = await gapsOf({
      gameRoot,
      targetId,
      edition,
      stateDir,
      contentXmlProvider,
      dlcListProvider,
    });
  } catch {
    gaps = null;
  }
  if (!gaps) return { outcome: "unreadable" };
  if (!gaps.containers.length && !gaps.dlcs.length)
    return { outcome: "intact", gaps };
  const missing = gapsText(gaps);
  try {
    const result = await provision({
      gameRoot,
      targetId,
      edition,
      stateDir,
      assertRuntimeSafety,
      force: true,
    });
    log({
      level: "warn",
      source: "install",
      message: `после ${reason || "работы"} в update.rpf не было: ${missing}; слой движка пересобран (${result?.status || "?"}, изменён: ${result?.changed ? "да" : "нет"})`,
    });
    return {
      outcome: "rebuilt",
      gaps,
      status: result?.status,
      changed: Boolean(result?.changed),
    };
  } catch (error) {
    log({
      level: "warn",
      source: "install",
      message: `после ${reason || "работы"} в update.rpf не было: ${missing}; слой движка пересобрать не удалось: ${firstLine(error)}`,
    });
    return { outcome: "failed", gaps, reason: firstLine(error) };
  }
}
