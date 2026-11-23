/*
 * Кадр обложки «Фонарей» (доделка к задаче 19 ТЗ 18.10.2026, поздний вечер; Хелпер 19, 27.10.2026 — вид «cover»):
 * кадр ночью из того же куска карты, что в редакторе, — улица Davis со столбом, на котором горит лампа работы человека:
 * столб справа, рука с лампой слева, дорога и дома в её свете (`STREET_VIEWS.cover`, снимок владельца `ref/7`).
 *
 * Снимается один раз тем же кадром квартала, что обложка «Таймциклов»
 * (`timecycle-block/block-capture.js`), но с лампами: цвет, сила, дальность и
 * мягкость края — результат `compileLampLight` по работе, те же числа, что уедут
 * в игру (`lamp-street.js`). Опись ламп игрока читается тем же каналом, что в
 * редакторе (`readLampStudio`); столбы и экземпляры — из секции карты (`pieceMatrices`).
 * Нет игры, нет описи, нет секции — обложка не выдумывает кадр: возвращается
 * причина, а обложка остаётся пустой (`LampCover.jsx`), без нарисованного столба.
 */

import { readLampStudio } from "../../../api.js";
import { blockLighting } from "../timecycle-block/block-light.js";
import { STREET_SLOTS, lampHeads, lampSlots, lampStyle, streetLights } from "./lamp-street.js";
import { DAVIS_SECTION, extrasOfSection, streetPose, volumesOfSection } from "./lamp-street-views.js";

/* Час кадра: после заката лампы горят, а небо ещё светлое — видно и свет, и улицу. */
export const LAMP_COVER_HOUR = 21;
/* Столбы улицы приезжают отдельным бандлом: ждём их, пока не появятся (мс). */
const HEADS_WAIT_MS = 30_000;
const HEADS_POLL_MS = 250;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Кадр обложки ночью (вид «cover») — `{ url }` или `{ reason }`, когда снять нельзя.
 *
 * @param {object} input
 * @param {string} input.gameRoot — папка игры
 * @param {object} input.project — работа фонарей (`normalizeLampProject`)
 */
export async function captureLampCoverFrame({ gameRoot, project }) {
  if (!gameRoot) return { reason: "no-game" };
  const base = await Promise.resolve(readLampStudio({ gameRoot })).catch(() => null);
  const models = Array.isArray(base?.models) ? base.models : null;
  if (!models?.length) return { reason: "no-lamps" };
  const { captureBlockFrame } = await import("../timecycle-block/block-capture.js");
  const lights = streetLights(models);
  const style = lampStyle(models, project);
  const view = streetPose("cover");
  let missing = false;

  const result = await captureBlockFrame({
    gameRoot,
    hour: LAMP_COVER_HOUR,
    pose: view.pose,
    frame: { target: view.frame.target, radius: view.frame.radius, floor: view.frame.floor },
    lampSlots: STREET_SLOTS,
    extraPlacements: extrasOfSection(DAVIS_SECTION),
    /* Объём улицы и полная детализация — как в кадре редактора: за краями чёрная пустота, а не небо над городом (снимок ref/7). */
    volume: volumesOfSection(DAVIS_SECTION).visible,
    fixedDetail: true,
    prepare: async (scene) => {
      /* Столбы — в бандле пропов: квартал уже «готов», а они ещё едут. */
      let heads = [];
      for (let waited = 0; waited < HEADS_WAIT_MS; waited += HEADS_POLL_MS) {
        heads = lampHeads(lights, (model) => scene.pieceMatrices(model));
        if (heads.length) break;
        await pause(HEADS_POLL_MS);
      }
      if (!heads.length) {
        missing = true;
        return;
      }
      scene.setLampSource((camera, state) => lampSlots({ heads, style, eye: camera.position, night: blockLighting(state).night }));
    },
  });
  /* Без ламп кадр — просто тёмная улица: это не обложка «Фонарей», а заглушка честнее. */
  if (missing) return { reason: "no-poles" };
  return result;
}
