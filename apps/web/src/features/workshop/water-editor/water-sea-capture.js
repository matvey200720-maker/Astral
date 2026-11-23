/*
 * Кадр моря из игры одним снимком (ТЗ 27.10.2026: карточка воды в каталоге и в «Моих работах» — настоящий кадр, а не голубая плита на сетке).
 *
 * Тот же квартал и то же сведение воды, что у кадра редактора («У берега», `WaterSeaStage`), но один раз, в картинку, без окна и без цикла
 * кадров: `captureBlockFrame` берёт секцию `venice-sea` с берегом и дном из установленной GTA V игрока, а вода ложится на неё по числам
 * работы (`waterFrameSpec`) на час и свет таймцикла. Нет игры, нет секции, видеокарта не рисует в буфер с плавающей точкой — вместо выдуманного
 * кадра возвращается причина, и обложка остаётся прежней.
 */

import { normalizeWaterProject } from "@modovik/climb-contract/recolor/water";
import { blockSkyAt, captureBlockFrame, readBlockSkyBase } from "../timecycle-block/block-capture.js";
import { waterFrameSpec } from "./water-frame.js";
import { SEA_SECTION, seaPose } from "./water-sea-views.js";
import { compileWaterLooks } from "./water-text.js";

/* Час кадра — как у редактора при открытии (`WaterStudio`): день, солнце на воде. */
export const SEA_COVER_HOUR = 15;

/**
 * Кадр моря — `{ url, fromGame }` или `{ reason }`, когда снять нельзя.
 *
 * @param {object} input
 * @param {string} input.gameRoot — папка игры (GTA V игрока)
 * @param {object} [input.project] — работа воды (сырая, как лежит в `water.xml` мода, или уже разобранная); без неё — штатная вода игры
 * @param {"close"|"under"} [input.view] — вид кадра (`water-sea-views.js`)
 * @param {number} [input.hour] — час суток
 * @param {{ width: number, height: number }} [input.size] — размер кадра
 */
export async function captureSeaFrame({ gameRoot, project = null, view = "close", hour = SEA_COVER_HOUR, size = undefined }) {
  if (!gameRoot) return { reason: "no-game" };
  const normalized = normalizeWaterProject(project || {});
  const looks = compileWaterLooks(normalized);
  /* Кадр моря снимает печь обложек и стенд плиток: небо или облака игры не прочитались — отказ с причиной, а не море под эталонным небом. */
  let sky;
  try {
    sky = blockSkyAt(await readBlockSkyBase(gameRoot, { strict: true }), { hour });
  } catch (error) {
    return { reason: `источник игры не прочитан (небо): ${String(error?.message || error).slice(0, 300)}` };
  }
  const spec = waterFrameSpec({ project: normalized, looks, state: sky.state });
  const { pose, frame } = seaPose(view);
  return captureBlockFrame({
    gameRoot,
    hour,
    strictSources: true,
    ...(size ? { size } : {}),
    pose,
    frame,
    sectionId: SEA_SECTION,
    prepare: async (scene) => {
      scene.setWater(spec);
    },
  });
}
