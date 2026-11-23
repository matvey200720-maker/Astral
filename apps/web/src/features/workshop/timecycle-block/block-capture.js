/*
 * Кадр квартала для обложки таймцикла (задача 5 ТЗ 18.10.2026): тот же
 * настоящий квартал из игры игрока, что в кадре редактора (`SkyBlockStage`),
 * но один раз — в картинку, без окна и без цикла кадров.
 *
 * Обложка таймцикла на полке мастерской (и в «Моих работах») — этот квартал под
 * небом и светом таймцикла: ясный день игрока (его `timecycle`, а не эталон) с
 * правками работы, облачные шапки игры, свет и туман квартала. Строится теми же
 * функциями, что и кадр редактора (`sky-preview.js`, `block-scene.js`), — обложка
 * не может разойтись с кадром.
 *
 * Квартал читается из игры игрока: в поставке Astral текстур и моделей Rockstar
 * нет. Нет игры, нет секции карты, видеокарта не рисует в буфер с плавающей
 * точкой — обложка не выдумывает кадр: возвращается причина, а обложка остаётся
 * нарисованным городом с подписью (`SkyCover.jsx`).
 */

import { PREVIEW_WEATHER, normalizeLook, parseKeyframeXml, referenceKeyframeDocument } from "@modovik/timecycle";
import { readSkyBases } from "../../../api.js";
import {
  parseCloudBases,
  previewClouds,
  previewDocument,
  previewProject,
  previewState,
} from "../../../components/desktop/workshop/sky/sky-preview.js";
import { loadCloudHatSheet, loadCloudHatSheetOrThrow, loadCloudHats, loadCloudHatsOrThrow, sheetsForLayers } from "../../../components/desktop/workshop/sky/cloud-hat-data.js";
import { createSkyRendererAsync } from "../../../components/desktop/workshop/sky-renderer.js";
import { createBlockScene } from "./block-scene.js";

/* Размер кадра обложки: 5 : 3 — между плиткой полки (≈1,6) и широкой карточкой «Моих работ»; вписывается `object-fit: cover`. */
export const BLOCK_COVER_SIZE = Object.freeze({ width: 640, height: 384 });
/* Час кадра: яркий день — по нему видно и небо, и здания. */
export const BLOCK_COVER_HOUR = 14;
/* Глаз — в осях сцены (Y вверх), рыскание и тангаж — в осях игры: 0 — на север (`block-scene.js`). */
export const BLOCK_COVER_POSE = Object.freeze({ eye: [-60, 10, 120], yaw: 0.25, pitch: 0, fov: 50 });
/* Рамка орбиты кадра обложки: цель посреди квартала и пол полёта; глаз — `pose`. */
export const BLOCK_COVER_FRAME = Object.freeze({ target: [0, 6, 0], radius: 220, floor: 0.8 });
/* Квартал едет из игры и собирает программы: первый раз — десятки секунд на слабой машине. */
const READY_LIMIT_MS = 90_000;
/* Кадров подряд перед снимком: облачные шапки и туман ложатся со второго-третьего прохода. */
const SETTLE_FRAMES = 3;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Причина отказа печи: что не прочиталось и текст хозяина чтения (в нём имя архива игры). */
const sourceReason = (what, error) => `источник игры не прочитан (${what}): ${String(error?.message || error).slice(0, 300)}`;

/**
 * Небо игрока, прочитанное один раз: ясный день его `timecycle` и облака
 * (`null`-основы нет — эталон). Кадры суток (таймцикл, фонари и светофоры) берут
 * из него состояние на любой час (`blockSkyAt`), не читая игру заново.
 */
export async function readBlockSkyBase(gameRoot, { strict = false } = {}) {
  const reading = Promise.resolve(readSkyBases({ gameRoot }));
  /* `strict` — печь обложек: небо игры не прочиталось — это отказ с текстом хозяина чтения (в нём имя архива), а не эталонное небо вместо игрового. */
  const bases = strict ? await reading : await reading.catch(() => null);
  if (strict && !bases?.timecycles?.[PREVIEW_WEATHER]?.xml) throw new Error("небо игры не прочитано: в ответе нет таймцикла ясной погоды");
  const gameBase = bases?.timecycles?.[PREVIEW_WEATHER]?.xml || "";
  let baseDocument = null;
  if (gameBase) {
    try {
      baseDocument = parseKeyframeXml(gameBase);
    } catch {
      baseDocument = null;
    }
  }
  return { bases, baseDocument, fromGame: Boolean(baseDocument) && baseDocument.source !== "reference" };
}

/** Небо на час по прочитанной основе: ясный день игрока с правками работы, его облака. Без WebGL. */
export function blockSkyAt({ bases, baseDocument, fromGame }, { project = null, hour = BLOCK_COVER_HOUR } = {}) {
  const document = previewDocument(baseDocument || referenceKeyframeDocument(PREVIEW_WEATHER), project);
  const look = normalizeLook(project?.look);
  const preview = previewProject(document, look);
  return {
    state: previewState(document, preview, hour),
    clouds: previewClouds(parseCloudBases(bases), look, null, hour),
    fromGame,
  };
}

/**
 * Основа обложки: ясный день игрока (или эталон, если базу не прочитали) с
 * правками работы, облака игрока и признак «небо из игры». Без WebGL —
 * годится для тестов и для ключа кадра.
 */
export async function blockCoverSky({ gameRoot, project = null, hour = BLOCK_COVER_HOUR }) {
  return blockSkyAt(await readBlockSkyBase(gameRoot), { project, hour });
}

/**
 * Кадр квартала — `{ url, fromGame }` или `{ reason }`, когда снять нельзя.
 * `project` — работа таймцикла (разобранная) или `null` для штатного неба.
 */
export async function captureBlockFrame({
  gameRoot,
  project = null,
  hour = BLOCK_COVER_HOUR,
  size = BLOCK_COVER_SIZE,
  pose = BLOCK_COVER_POSE,
  frame = BLOCK_COVER_FRAME,
  /* Секция карты вместо квартала Davis (обложка «Воды» — море у Венис-Бич). */
  sectionId = "",
  /* Прожекторы уличных ламп (обложка «Фонарей»): число постоянное — оно входит в шейдер квартала. */
  lampSlots = 0,
  /* Детали, которых в игре на этом месте нет (мачта светофора у дороги): `{ piece, at, yaw }`. */
  extraPlacements = [],
  /* Подготовка сцены, когда квартал приехал и программы собраны: `async (scene) => void` (ставит лампы). */
  prepare = null,
  /* Объём кадра (`makeVolume`, `block-void.js`): за его краями чёрная пустота, как в кадре редактора «Фонарей» (Хелпер 19, 27.10.2026). */
  volume = null,
  /* Детали секции всегда в полной детализации, без подмен издалека (кадры «Фонарей»). */
  fixedDetail = false,
  /* Печь обложек: источник игры не прочитался (нет архива неба или облаков) — отказ с причиной, а не кадр с эталонным небом и облаками купола. */
  strictSources = false,
}) {
  if (!gameRoot) return { reason: "no-game" };
  let sky;
  try {
    sky = strictSources ? blockSkyAt(await readBlockSkyBase(gameRoot, { strict: true }), { project, hour }) : await blockCoverSky({ gameRoot, project, hour });
  } catch (error) {
    return { reason: sourceReason("небо", error) };
  }
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  let renderer = null;
  let scene = null;
  try {
    renderer = await createSkyRendererAsync(canvas);
    /* Облачные шапки игры и их листы — до первого кадра: без них купол рисует свои облака. */
    let hats = null;
    try {
      hats = strictSources ? await loadCloudHatsOrThrow(gameRoot) : await loadCloudHats(gameRoot).catch(() => null);
    } catch (error) {
      return { reason: sourceReason("облачные шапки", error) };
    }
    if (hats) {
      renderer.setCloudHats(hats);
      for (const name of sheetsForLayers(hats, sky.clouds?.layerFiles)) {
        let image = null;
        try {
          image = strictSources ? await loadCloudHatSheetOrThrow(gameRoot, name) : await loadCloudHatSheet(gameRoot, name).catch(() => null);
        } catch (error) {
          return { reason: sourceReason(`лист облаков «${name}»`, error) };
        }
        if (image) renderer.setCloudHatSheet(name, image);
      }
    }
    const outcome = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ status: "unavailable", reason: "slow" }), READY_LIMIT_MS);
      const settle = (next) => {
        if (next.status !== "ready" && next.status !== "unavailable") return;
        clearTimeout(timer);
        resolve(next);
      };
      scene = createBlockScene({ canvas, sky: renderer, quality: "medium", lampSlots, sectionId, extraPlacements, ...(volume ? { volume } : {}), ...(fixedDetail ? { fixedDetail } : {}), onStatus: settle });
      scene.resize(size.width, size.height, 1);
      /* Вид обложки — шире и ниже вида редактора: плитка вытянута, и ей нужны здания, а не пустая земля. */
      scene.camera.setFrame({ target: frame.target, radius: frame.radius, inside: pose, fly: false, floor: frame.floor });
      scene.set({ state: sky.state, weather: null, clouds: sky.clouds });
      settle(scene.status);
    });
    if (outcome.status !== "ready") return { reason: outcome.reason || "unavailable" };
    if (prepare) await prepare(scene);
    for (let pass = 0; pass < SETTLE_FRAMES; pass += 1) {
      scene.renderOnce();
      await pause(60);
    }
    /* Снимок — в той же задаче, что и последний кадр: буфер холста ещё не сброшен. */
    scene.renderOnce();
    return { url: canvas.toDataURL("image/webp", 0.9), fromGame: sky.fromGame };
  } finally {
    scene?.dispose();
    renderer?.dispose();
  }
}
