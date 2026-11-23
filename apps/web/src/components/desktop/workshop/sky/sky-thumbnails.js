/*
 * Плитки неба — кадры того же шейдера, что и большой кадр.
 *
 * Готовый вид и вид облаков выбирают глазами, и нарисованная от руки картинка
 * на плитке врала бы про то, что встанет в игру. Поэтому плитка — настоящий
 * кадр: готовый вид — днём слева и ночью справа, сутки на одной картинке;
 * вид облаков — полдень с этой шапкой игры над горизонтом.
 *
 * Контекст WebGL на все плитки один: двадцать живых холстов ради неподвижных
 * картинок — это двадцать программ в видеопамяти. Кадры снимаются по одному
 * с уступкой окну между ними и помнятся до конца работы приложения: повторный
 * вход в редактор плитки не перерисовывает.
 */

import { useEffect, useState } from "react";
import {
  CLOUD_HAT_TYPES,
  CLOUD_TEMPLATES,
  createAtmosphere,
  createLook,
  normalizeLook,
  saveOwnCloudTemplate,
  setAtmosphere,
  setCloudTemplate,
  setCloudTypes,
} from "@modovik/timecycle";
import { tr } from "../../../../locales/ui.js";
import { readTile, tileStoreKey, writeTile } from "../../../../features/workshop/covers/tile-store.js";
import { loadCloudHatSheet, sheetsForLayers } from "./cloud-hat-data.js";
import { previewClouds, previewProject, previewState } from "./sky-preview.js";

const WIDTH = 320;
const HEIGHT = 180;
/* Где стоит камера на плитке: днём — на юг, против высокого солнца, ночью —
   на восток, где в эти часы луна. Горизонт чуть ниже середины. */
const DAY_CAMERA = Object.freeze({ yaw: Math.PI * 0.92, pitch: 0.16, fov: 1.25, time: 12 });
const NIGHT_CAMERA = Object.freeze({ yaw: Math.PI * 0.5, pitch: 0.2, fov: 1.25, time: 12 });
/* Плитка облаков: час дня, горизонт по нижнему краю — на плитке одно небо,
   город не заслоняет башни у горизонта. Взгляд на восток: там у «башен»
   стоят облака, а солнце в 13:00 сбоку и не слепит кадр. */
const CLOUD_HOUR = 13;
const CLOUD_CAMERA = Object.freeze({ yaw: Math.PI / 2, pitch: 0.62, fov: 1.25, time: 0 });
/* Шапка снегопада — гряда у самого горизонта: при взгляде вверх плитка
   была чистым небом, и казалось, что облака не включаются. Взгляд — на
   горизонт, и без города: на плитке только небо, гряду дома не заслоняют. */
const CLOUD_CAMERAS = Object.freeze({
  snowy: Object.freeze({ ...CLOUD_CAMERA, pitch: 0.1, showGround: false }),
});

const frames = new Map();
const waiting = new Map();
const queue = [];
let runner = null;
let context = null;
let texturesKey = null;

/*
 * Между кадрами — уступка окну, а не ожидание простоя.
 *
 * Пока открыт редактор, главный поток почти не бывает свободен: кадр неба
 * идёт тридцать раз в секунду, и `requestIdleCallback` срабатывал только по
 * своему таймауту — по 0,8 с на плитку, двадцать секунд на полку. Кадр плитки
 * стоит единицы миллисекунд, поэтому хватает отдать окну один кадр между
 * снимками: ползунок и камера не ждут, а полка собирается за полсекунды.
 */
const yieldFrame = () =>
  new Promise((resolve) => {
    window.setTimeout(resolve, 16);
  });

/* Шейдер неба собирается мимо главного потока (`createSkyRendererAsync`, 13.10.2026):
   синхронная сборка стояла окно на секунду-две при первой плитке. Пока он собирается,
   второй вызов ждёт тот же заказ, а не заводит второй контекст. */
let contextJob = null;

async function buildContext() {
  const { createSkyRendererAsync } = await import("../sky-renderer.js");
  const canvas = document.createElement("canvas");
  const renderer = await createSkyRendererAsync(canvas);
  renderer.resize(WIDTH, HEIGHT, 1);
  const board = document.createElement("canvas");
  board.width = WIDTH;
  board.height = HEIGHT;
  context = { canvas, renderer, board, paint: board.getContext("2d") };
  return context;
}

function ensureContext() {
  if (context) return Promise.resolve(context);
  contextJob ||= buildContext().finally(() => {
    contextJob = null;
  });
  return contextJob;
}

/*
 * Шапки для кадра плитки: модели ставятся один раз на установку, листы —
 * те, что нужны этой плитке. Без шапок кадр остаётся с облаками купола.
 */
async function prepareClouds(spec) {
  const scene = spec.cloudScene;
  if (!scene?.hats) return;
  const { renderer } = context;
  renderer.setCloudHats(scene.hats);
  for (const name of spec.sheets || []) {
    if (renderer.hasCloudHatSheet(name)) continue;
    const image = await loadCloudHatSheet(scene.gameRoot, name);
    if (image) renderer.setCloudHatSheet(name, image);
  }
}

function capture(spec) {
  const { canvas, renderer, board, paint } = context;
  const { document, project, textures } = spec;
  const key = textures ? `${Boolean(textures.moon)}:${Boolean(textures.starfield)}` : "none";
  if (key !== texturesKey) {
    renderer.setSkyTextures({
      moon: textures?.moon || null,
      starfield: textures?.starfield || null,
    });
    texturesKey = key;
  }
  const cloudsAt = (hour) => spec.cloudsAt?.(hour) || null;
  if (spec.hour !== undefined) {
    renderer.render(
      previewState(document, project, spec.hour),
      spec.camera || CLOUD_CAMERA,
      null,
      cloudsAt(spec.hour),
    );
    paint.drawImage(canvas, 0, 0);
    return board.toDataURL("image/webp", 0.82);
  }
  const halves = [
    [spec.hours.day, DAY_CAMERA],
    [spec.hours.night, NIGHT_CAMERA],
  ];
  halves.forEach(([hour, camera], index) => {
    renderer.render(previewState(document, project, hour), camera, null, cloudsAt(hour));
    const half = WIDTH / 2;
    /* Каждая половина — середина своего кадра, а не его левый край: там и
       горизонт, и солнце, ради которых кадр снят. */
    paint.drawImage(canvas, half / 2, 0, half, HEIGHT, index * half, 0, half, HEIGHT);
  });
  return board.toDataURL("image/webp", 0.82);
}

async function drain() {
  try {
    await ensureContext();
  } catch {
    for (const job of queue.splice(0)) job.reject(new Error(tr("WebGL2 недоступен")));
    runner = null;
    return;
  }
  while (queue.length) {
    await yieldFrame();
    const job = queue.shift();
    try {
      await prepareClouds(job.spec);
      const url = capture(job.spec);
      frames.set(job.key, url);
      writeTile(skyTileKey(job.key), url);
      job.resolve(url);
    } catch (error) {
      job.reject(error);
    } finally {
      waiting.delete(job.key);
    }
  }
  runner = null;
}

/* Постоянный ключ плитки (`tile-store.js`): `key` уже называет вид, основу, текстуры и шапки. */
const skyTileKey = (key) => tileStoreKey("sky", key);

function request(key, makeSpec) {
  if (frames.has(key)) return Promise.resolve(frames.get(key));
  if (waiting.has(key)) return waiting.get(key);
  /* Сначала хранилище: готовая плитка не поднимает контекст WebGL и не собирает программу неба. */
  const job = readTile(skyTileKey(key)).then((kept) => {
    if (kept) {
      frames.set(key, kept);
      return kept;
    }
    return new Promise((resolve, reject) => {
      queue.push({ key, spec: makeSpec(), resolve, reject });
      runner ??= drain();
    });
  });
  waiting.set(key, job);
  job.then(
    () => waiting.delete(key),
    () => waiting.delete(key),
  );
  return job;
}

/**
 * Облака вида для плитки: шапка и её свет в нужный час плюс листы, которые
 * придётся загрузить. `cloudScene` — { key, hats, gameRoot, parsed } или
 * `null`, тогда плитка без шапок.
 */
export function thumbnailClouds(cloudScene, look, hours) {
  if (!cloudScene?.hats || !cloudScene.parsed) return { cloudsAt: null, sheets: [] };
  const cloudsAt = (hour) => previewClouds(cloudScene.parsed, look, null, hour);
  const sheets = new Set();
  for (const hour of hours)
    for (const name of sheetsForLayers(cloudScene.hats, cloudsAt(hour)?.layerFiles))
      sheets.add(name);
  return { cloudsAt, sheets: [...sheets] };
}

/**
 * Кадр плитки. `key` называет всё, от чего кадр зависит: вид, основу,
 * текстуры и шапки. `makeSpec` зовётся, только если кадра ещё нет: сборка
 * неба для плитки стоит миллисекунду, и двадцать плиток на каждую
 * перерисовку полки — это заметно. Пока кадра нет — пустая строка, и плитка
 * стоит спокойным фоном. Сменился ключ (правка вида, другая основа), а новый
 * кадр ещё рисуется: прежний кадр этой плитки остаётся, а не уступает пустому
 * фону, и новый сменит его, когда придёт.
 */
export function useSkyThumbnail(key, makeSpec) {
  const [url, setUrl] = useState(() => frames.get(key) || "");
  useEffect(() => {
    let alive = true;
    if (frames.has(key)) {
      setUrl(frames.get(key));
      return undefined;
    }
    request(key, makeSpec)
      .then((value) => alive && setUrl(value))
      .catch(() => {
        /* Нет WebGL2 — плитка остаётся фоном, выбор работает. */
      });
    return () => {
      alive = false;
    };
    // Спецификация описана ключом целиком: новый объект с тем же ключом —
    // тот же кадр.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}

/**
 * Плитки облаков: у каждой — полдень ясного дня игрока с этими облаками.
 * `kind` — имя ряда в ключе кадра, `items` — что показать, `lookOf(id)` —
 * вид с этими облаками. Без шапок игры (браузер без игры) — пустой набор, и
 * плитка рисует знак.
 */
function useCloudThumbnails(kind, items, lookOf, cloudScene, document, baseKey) {
  const [urls, setUrls] = useState({});
  const sceneKey = cloudScene?.hats && cloudScene.parsed ? cloudScene.key : "";
  /* Список меняется (свои облака собирают, модели открывают) — кадры новых плиток рисуются, прежних не трогаются. */
  const itemsKey = items.map((item) => item.key || item.id).join("|");
  useEffect(() => {
    /* Нет шапок игры — набора нет, плитка рисует знак. Сменились сцена или основа, а новые кадры
       ещё рисуются: прежние кадры плиток остаются и заменяются по одному. */
    if (!sceneKey) {
      setUrls({});
      return undefined;
    }
    let alive = true;
    for (const type of items) {
      /* `key` у плитки — отпечаток того, от чего кадр зависит (свои облака: слои, свет, стиль). */
      const key = `${kind}:${type.key || type.id}:${sceneKey}:${baseKey}`;
      request(key, () => {
        const look = lookOf(type.id, type);
        const { cloudsAt, sheets } = thumbnailClouds(cloudScene, look, [CLOUD_HOUR]);
        return {
          document,
          project: previewProject(document, look),
          hour: CLOUD_HOUR,
          camera: (kind === "cloud-type" && CLOUD_CAMERAS[type.id]) || CLOUD_CAMERA,
          cloudScene,
          cloudsAt,
          sheets,
        };
      })
        .then((url) => {
          if (alive) setUrls((current) => ({ ...current, [type.id]: url }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // Сцена и основа названы ключами целиком, ряд — постоянный.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey, baseKey, itemsKey]);
  return urls;
}

/*
 * Плитки готовых атмосфер (22.11.2026): кадр того же предпросмотра, что у шаблонов, — день, горизонт и город, на всю плитку: туман виден днём, а ночная половина читалась бы чёрной. Рисуются, только пока открыт инструмент «Атмосфера» (`active`):
 * семь кадров не нужны, пока человек в другом инструменте. Пока кадра нет — плитка рисует градиент цвета атмосферы (`sky-preset-fog`), а не пустую подложку.
 */
const ATMOSPHERE_HOUR = 13;
export function useAtmosphereThumbnails(items, document, baseKey, textures, cloudScene, active) {
  const [urls, setUrls] = useState({});
  const sceneKey = cloudScene?.hats && cloudScene.parsed ? cloudScene.key : "noclouds";
  const texturesKey = textures ? `${Boolean(textures.moon)}:${Boolean(textures.starfield)}` : "none";
  const itemsKey = items.map((item) => item.id).join("|");
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    for (const item of items) {
      const key = `atmosphere:${item.id}:day${ATMOSPHERE_HOUR}:${baseKey}:${texturesKey}:${sceneKey}`;
      request(key, () => {
        const look = normalizeLook(setAtmosphere(createLook(), { ...createAtmosphere(), ...item.atmosphere }));
        return {
          document,
          project: previewProject(document, look),
          hour: ATMOSPHERE_HOUR,
          camera: DAY_CAMERA,
          textures,
          cloudScene,
          ...thumbnailClouds(cloudScene, look, [ATMOSPHERE_HOUR]),
        };
      })
        .then((url) => {
          if (alive) setUrls((current) => (current[item.id] === url ? current : { ...current, [item.id]: url }));
        })
        .catch(() => {
          /* Нет WebGL2 — плитка остаётся градиентом, выбор работает. */
        });
    }
    return () => {
      alive = false;
    };
    // Кадры названы ключами целиком: основа, текстуры, шапки и атмосфера.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, baseKey, texturesKey, sceneKey, itemsKey]);
  return urls;
}

/* Виды облаков — по одной шапке игры на плитку. */
const typeLook = (id) => normalizeLook(setCloudTypes(createLook(), [id]));
export const useCloudTypeThumbnails = (cloudScene, document, baseKey) =>
  useCloudThumbnails("cloud-type", CLOUD_HAT_TYPES, typeLook, cloudScene, document, baseKey);

/* Готовые облака — шапка шаблона целиком, в свете и стиле шаблона. */
const templateLook = (id) => normalizeLook(setCloudTemplate(createLook(), id));
export const useCloudTemplateThumbnails = (cloudScene, document, baseKey) =>
  useCloudThumbnails(
    "cloud-template",
    CLOUD_TEMPLATES,
    templateLook,
    cloudScene,
    document,
    baseKey,
  );

/*
 * Свои облака: плитка — шапка шаблона, собранного человеком, в его свете и стиле. `templates` — шаблоны с отпечатком
 * (`key`): изменился слой, свет или стиль — кадр рисуется заново, прежний остаётся, пока новый не пришёл.
 */
const ownLook = (_id, item) => normalizeLook(saveOwnCloudTemplate(createLook(), item.template));
export const useOwnCloudThumbnails = (items, cloudScene, document, baseKey) =>
  useCloudThumbnails("cloud-own", items, ownLook, cloudScene, document, baseKey);

/* Модели для выбора слоя: у каждой — шаблон из одного слоя. Рисуются, только пока конструктор открыт (`items` пуст). */
export const useCloudModelThumbnails = (items, cloudScene, document, baseKey) =>
  useCloudThumbnails("cloud-model", items, ownLook, cloudScene, document, baseKey);
