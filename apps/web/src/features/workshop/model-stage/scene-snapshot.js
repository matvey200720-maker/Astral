/*
 * Снимки 3D-сцен наборов для плиток готовых видов и обложек полки.
 *
 * Плиток на экране десятки, а контекстов WebGL браузер держит около
 * шестнадцати. Поэтому кадр для снимков один на окно: невидимый холст с тем
 * же кадром (`createOrbitStage`, без мыши), тем же светом, тенью и листами,
 * что у редактора. Снимки идут очередью по одному.
 *
 * Готовый снимок хранится между запусками (ТЗ 06.10.2026, вечер, задача 1):
 * прежде кэш жил только в памяти окна, и при каждом запуске полка заново
 * разжимала сцены, разбирала вершины, ждала текстуры игры (до шести секунд на
 * снимок) и снимала кадры по одному — «каждый раз грузится по 5 секунд».
 * Теперь снимок ложится в хранилище обложек (`covers/cover-frames.js`, WebP в
 * IndexedDB) под ключом, который называет всё, от чего зависит картинка:
 * сцену (с её отпечатком на сервере окна), облик, размер и версию
 * рисовальщика. Второй запуск рисует плитку из хранилища за миллисекунды и
 * саму сцену не грузит вовсе.
 *
 * В памяти окна — готовые адреса картинок (десятки килобайт), а не битмапы:
 * девяносто шесть битмапов снимков занимали сотни мегабайт.
 */

import { motionLeft, motionQuiet } from "../../../components/ui/motion-quiet.js";
import { readCoverFrame, writeCoverFrame } from "../covers/cover-frames.js";
import { claimWindowRenderer, releaseWindowRenderer } from "../engine/window-renderer.js";
import { createOrbitStage } from "./orbit-stage.js";
import { QUALITY_PROFILES } from "./quality-profile.js";
import { loadSceneAsset } from "./scene-asset.js";
import { daylightFor } from "./scene-daylight.js";
import { sheetsExpected } from "./scene-textures.js";
import { encodeBitmapWebp } from "./snapshot-encode.js";

/* Версия рисовальщика снимков. Поменялся свет, тень, материалы или рамка
   кадра (`orbit-stage.js`, `recolor-material.js`, `scene-textures.js`) — число
   растёт, и старые кадры из хранилища просто не находятся.
   2 (13.10.2026): прежний рисовальщик клал в хранилище и кадры, снятые без
   листов игры, — они держались до вытеснения; такие кадры не находятся.
   3 (18.10.2026): кадр садится по восьми углам коробки (`fittedFrame`), а размер
   снимка держит пропорцию плитки — старые, обрезанные по краям, переснимаются. */
export const SCENE_THUMB_VERSION = 3;

const URL_LIMIT = 160;
/* Сколько держать кадр снимков после последнего снимка: его сцена и листы —
   сотня мегабайт видеопамяти, а снимки идут пачкой при открытии полки. Минута,
   а не 15 с (оптимизация ночи 12.10.2026): со снятым кадром уходят и собранные
   программы шейдеров, и следующая полка (редактор → назад в мастерскую)
   собирала их заново. */
const STAGE_IDLE_MS = 60_000;
/* Сколько ждать один снимок (ТЗ 12.10.2026, задача 1: «пофиксить прогруз во
   вкладке дирижаблей»). Снимки шли одной цепочкой обещаний на окно: зависла
   одна сцена (разбор в потоке, лист от Astral Desktop) — и ни одна плитка
   окна больше не снималась до перезапуска. Теперь снимок, не уложившийся в
   срок, бросается (его поздние шаги кадр не трогают), очередь идёт дальше. */
const JOB_LIMIT_MS = 30_000;
/* Запросы, пришедшие в пределах этого окна, — одна пачка (одна открытая полка
   или один редактор): между пачками первой идёт новая, внутри — по порядку. */
const BATCH_GAP_MS = 250;
const urls = new Map();
const pending = new Map();
const stamps = new Map();
const queue = [];
let shared = null;
/* Кадр снимков — на рендерере окна (фаза 5, шаг 5.2), когда тот свободен: на полке редакторы закрыты,
   и снимки идут тем же контекстом и теми же программами, что потом возьмёт редактор. Редактор главнее:
   его вход забирает рендерер и посреди снимка — снимок встаёт в очередь заново и снимается своим
   контекстом, как прежде. */
const SNAPSHOT_OWNER = {};
const YIELDED = Symbol("yielded");
/* Шаг очереди, что идёт сейчас: `{ state, cut }` — бросить его и отпустить очередь сразу. */
let current = null;
let inFlight = 0;
let releaseTimer = null;
let pumping = false;
let batch = 0;
let lastAsk = -Infinity;

/*
 * Снимок — не во время прокрутки (задача 1 ТЗ 06.10.2026, вечер: «фризы при
 * прокрутке»). При первом заходе на полку снимков в хранилище ещё нет, и
 * обложки, подъезжая к экрану, снимались прямо посреди прокрутки: кадр
 * WebGL и чтение холста в главном потоке давали рывки по 60–130 мс. Теперь
 * каждый снимок ждёт, пока колесо и полоса прокрутки затихнут, и свободной
 * минуты окна; кодирование в WebP — вне главного потока (`toBlob`).
 */
const QUIET_MS = 220;
let lastScroll = -Infinity;
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  const mark = () => {
    lastScroll = performance.now();
  };
  for (const type of ["wheel", "scroll", "touchmove"])
    window.addEventListener(type, mark, { passive: true, capture: true });
  /* И не посреди протяжки ползунка, палитры или вращения кадра (19.10.2026, лаг правки): снимок с
     сборкой шейдеров посреди протяжки отнимал у неё по 100–300 мс. */
  window.addEventListener("pointermove", (event) => event.buttons && mark(), { passive: true, capture: true });
}
/* И не посреди большого движения — рейки, волны карточек (задача 6 ТЗ
   10.10.2026: снимок ронял кадры выхода из редактора). Движение могло
   начаться, пока ждали свободной минуты, — тогда ждём снова. */
async function quietMoment() {
  for (;;) {
    const since = performance.now() - lastScroll;
    if (since < QUIET_MS) {
      await new Promise((resolve) => setTimeout(resolve, QUIET_MS - since + 10));
      continue;
    }
    if (motionLeft()) {
      await motionQuiet();
      continue;
    }
    await new Promise((resolve) =>
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(() => resolve(), { timeout: 800 })
        : setTimeout(resolve, 0),
    );
    if (performance.now() - lastScroll >= QUIET_MS && !motionLeft()) return;
  }
}

function dropStage() {
  if (!shared) return;
  shared.stage.dispose();
  if (shared.windowed) releaseWindowRenderer(SNAPSHOT_OWNER);
  shared = null;
}

function scheduleRelease() {
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    if (inFlight || !shared) return;
    dropStage();
  }, STAGE_IDLE_MS);
}

/* Редактору нужен рендерер окна: кадр снимков уходит сразу, идущий снимок — в очередь заново. */
function yieldWindowRenderer() {
  clearTimeout(releaseTimer);
  if (current) {
    current.state.abandoned = true;
    current.cut(YIELDED);
  }
  dropStage();
  return true;
}

function sharedStage() {
  clearTimeout(releaseTimer);
  if (!shared) {
    /* Снимки — всегда на «высоком»: у рендерера окна с другим сглаживанием кадр заводит свой контекст. */
    const windowed = claimWindowRenderer(SNAPSHOT_OWNER, { antialias: QUALITY_PROFILES.high.antialias, strict: false, onYield: yieldWindowRenderer });
    /* Свой холст снимка в обоих случаях: у рендерера окна кадр подаётся в него (`present`). */
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 300;
    let stage;
    try {
      stage = createOrbitStage({ canvas, interactive: false, shared: windowed });
    } catch (error) {
      if (windowed) releaseWindowRenderer(SNAPSHOT_OWNER);
      throw error;
    }
    shared = { stage, canvas, asset: null, windowed: Boolean(windowed) };
  }
  return shared;
}

function remember(key, value) {
  urls.delete(key);
  urls.set(key, value);
  while (urls.size > URL_LIMIT) urls.delete(urls.keys().next().value);
}

/*
 * Временные кадры: снятые без листов игры, что ещё могут приехать. Плитке они
 * годятся, пока листы едут, но ни хранилищу, ни печи обложек (запекает кадр на
 * трое суток) их отдавать нельзя — «урезанная» плитка оставалась бы после
 * подключения игры (13.10.2026, владелец: «не надо урезанную, как в GTA 5»).
 * Признак — сам адрес картинки: ответ `sceneThumbUrl` остаётся строкой.
 */
const PROVISIONAL_LIMIT = 48;
const provisional = new Set();

function markProvisional(url) {
  provisional.delete(url);
  provisional.add(url);
  while (provisional.size > PROVISIONAL_LIMIT) provisional.delete(provisional.values().next().value);
}

/** Кадр — временный: листы игры ещё едут, окончательным он не станет. */
export const thumbIsProvisional = (url) => Boolean(url) && provisional.has(url);

/* Свои объекты снимка освобождаются, как только снимок снят. */
const release = (objects) => {
  for (const item of objects || []) item.dispose?.();
};

/*
 * Отпечаток файла сцены на сервере окна: перевыпустили сцену — ключ другой.
 * Один короткий запрос заголовков на адрес за жизнь окна.
 */
function sceneStamp(url) {
  if (!stamps.has(url))
    stamps.set(
      url,
      fetch(url, { method: "HEAD" })
        .then((response) => response.headers.get("etag") || response.headers.get("last-modified") || response.headers.get("content-length") || "")
        .catch(() => ""),
    );
  return stamps.get(url);
}

/* Снимок брошен по сроку — его поздние шаги не трогают общий кадр. */
class Abandoned extends Error {}

/*
 * Очередь снимков: по одному на общем кадре. Прежде — цепочка в порядке
 * запросов, и открытый редактор ждал, пока доснимутся все обложки полки, с
 * которой в него пришли, — десятки сцен (ТЗ 12.10.2026, задача 1). Теперь
 * первой идёт последняя пачка запросов — то, что сейчас на экране; снимок,
 * который больше никому не нужен (плитка ушла с экрана, полку закрыли), не
 * снимается вовсе.
 */
function nextJob() {
  let best = 0;
  for (let index = 1; index < queue.length; index += 1) if (queue[index].batch > queue[best].batch) best = index;
  return queue.splice(best, 1)[0];
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const job = nextJob();
      if (!job.wanted()) {
        job.resolve(null);
        continue;
      }
      let timer = null;
      const state = { abandoned: false };
      let cut = null;
      const limit = new Promise((resolve) => {
        cut = resolve;
        timer = setTimeout(() => {
          state.abandoned = true;
          resolve(null);
        }, JOB_LIMIT_MS);
      });
      const live = () => {
        if (state.abandoned) throw new Abandoned();
      };
      current = { state, cut };
      const result = await Promise.race([job.run(live).catch(() => null), limit]);
      current = null;
      clearTimeout(timer);
      /* Рендерер окна ушёл редактору посреди снимка — снимок заново, своим контекстом. */
      if (result === YIELDED) queue.unshift(job);
      else job.resolve(result);
    }
  } finally {
    pumping = false;
  }
}

/* Поставить снимок в очередь; `wanted()` — нужен ли он ещё, когда подойдёт черёд. */
function enqueue(run, wanted = () => true) {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - lastAsk > BATCH_GAP_MS) batch += 1;
  lastAsk = now;
  inFlight += 1;
  return new Promise((resolve) => {
    queue.push({ run, wanted, batch, resolve });
    void pump();
  }).finally(() => {
    inFlight -= 1;
    if (!inFlight) scheduleRelease();
  });
}

/* Кадр снимков с живым контекстом WebGL: потерянный кадр рисует пустоту (или
   прошлый снимок) — такой убирается, следующий снимок поднимает новый. */
function liveStage() {
  if (shared?.stage.lost) dropStage();
  return sharedStage();
}

/**
 * Рамка снимка (обложка, плитка): всё, что нарисуется внутри коробки рамки,
 * влезает в кадр. Расстояние считает камера по вершинам видимых сеток (запас —
 * восемь углов коробки) в настоящей пропорции плитки (`stage-camera.js`, `fit`),
 * поле — 6 % кадра с каждой стороны. Прежде расстояние вписывало сферу только
 * по высоте, а края обрезало число `zoom` обложки (0,5–0,62 «чтоб крупнее»):
 * ближний банкомат, остановки и зоны вылезали за плитку. `zoom` у снимка —
 * теперь только отъезд от посаженного вида: меньше 1 — это обрезка, и кадр её
 * не допускает. Кадр с видом изнутри или с `fit: false` — как задан. Исключение —
 * кадр с `crop: true` (здания из игры, ТЗ 41-А): плотнее посадки, края площадки
 * вокруг здания могут уйти за плитку — главное крупно.
 */
export function fittedFrame(spec) {
  if (!spec || spec.fit === false || spec.inside) return spec;
  if (spec.crop === true) return { ...spec, fit: spec.fit || true, view: { ...spec.view, zoom: Math.max(0.3, spec.view?.zoom ?? 1) } };
  return { ...spec, fit: spec.fit || true, view: { ...spec.view, zoom: Math.max(1, spec.view?.zoom ?? 1) } };
}

/* Сам снимок — шаг очереди: кадр, облик, свои объекты, ожидание листов. */
async function shoot({ url, look, frame, parts = null, objects = null, daylight = null, lamps = null, width = 480, height = 300 }, live) {
  /* Кадр снимков заводится в тихую минуту: новый контекст WebGL и отражения
     студии — ~150 мс главного потока, и посреди прокрутки полки это рывок
     (стенд, ночь 12.10.2026). */
  if (!shared || shared.stage.lost) {
    await quietMoment();
    live();
  }
  const state = liveStage();
  const asset = await loadSceneAsset(url);
  live();
  const { stage, canvas } = state;
  if (state.asset !== asset) {
    stage.setScene(asset);
    state.asset = asset;
  }
  if (canvas.width !== width || canvas.height !== height) stage.resize(width, height, 1);
  const spec = fittedFrame(frame(asset));
  stage.setFrame(spec);
  /* Фон кадра — светлый для прозрачных и тёмных объёмов (`backdrop: "light"` в рамке плана обложки); у остальных снимков — тёмный пол, как всегда. */
  stage.setBackdrop?.(spec?.backdrop);
  /* Свой свет кадра (зал арены: экспозиция по яркости, холодный фон) — после рамки: расстановка света берёт её центр и размах. */
  if (daylight) stage.setDaylight(daylightFor(asset, daylight));
  /* Лампы кадра (ночной кадр фонаря: свет из записей модели) — слоты ближних к камере, `lamp-slots.js`; снимаются вместе со снимком. */
  if (lamps?.length) stage.setLamps?.(lamps);
  stage.setParts(parts);
  stage.setLook(look);
  const made = typeof objects === "function" ? objects() : null;
  if (made || stage.hasObjects) stage.setObjects(made || []);
  try {
    await stage.texturesSettled(6000);
    live();
    stage.setLook(look);
    /* Программы материалов — параллельным компилятором видеочипа, пока окно
       живёт своей жизнью (оптимизация ночи 12.10.2026): прежде их собирал
       сам снимок в главном потоке — до секунды стоящего окна на обложку. */
    await stage.compile?.();
    live();
    await quietMoment();
    live();
    stage.setLook(look);
    /* Лист, пришедший за время ожидания, мог сменить программу материала. */
    await stage.compile?.();
    live();
    stage.render();
    /* Контекст потерян — снимка нет (и в хранилище не ляжет пустая плитка). */
    if (stage.lost) return null;
    /* Листы игры, что не дошли и могут дойти, — кадр неполный (поверхности
       средним цветом): его нельзя ни хранить, ни запекать как окончательный. */
    const missing = sheetsExpected() ? stage.texturesMissing?.() ?? 0 : 0;
    return { bitmap: await createImageBitmap(canvas), complete: missing === 0 };
  } finally {
    /* Брошенный по сроку снимок кадр не трогает: на нём уже следующий. */
    if (made && shared?.stage === stage && !shared.stage.lost) {
      try {
        live();
        stage.setObjects([]);
      } catch {
        /* кадр уже у следующего снимка */
      }
    }
    if (lamps?.length && shared?.stage === stage && !shared.stage.lost) {
      try {
        live();
        stage.setLamps?.([]);
      } catch {
        /* кадр уже у следующего снимка */
      }
    }
    /* Свет кадра — только на этот снимок: следующий (плитка полки, редактор) светит студией. */
    if (daylight && shared?.stage === stage && !shared.stage.lost) {
      try {
        stage.setDaylight(null);
      } catch {
        /* кадр уже у следующего снимка */
      }
    }
    if (made) release(made);
  }
}

/**
 * Снимок сцены `url` в облике `look(index, info)` — `ImageBitmap`. `frame(asset)`
 * — рамка кадра (как у `ModelStage`), `parts` — видимые части, `objects()` —
 * свои объекты кадра (`[{ object, dispose? }]`, плашки зданий): заводятся и
 * освобождаются только вокруг этого снимка; `width × height` — размер снимка
 * в пикселях. Хранилища здесь нет — его держит `sceneThumbUrl`.
 */
export function snapshotScene(options) {
  /* Без WebGL-снимков (тесты, старые окна) плитка остаётся матовой плашкой. */
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return Promise.resolve(null);
  try {
    liveStage();
  } catch {
    return Promise.resolve(null);
  }
  return enqueue((live) => shoot(options, live)).then((taken) => taken?.bitmap ?? null);
}

/*
 * Основа студии из самой модели игры (задача 6Б ТЗ 18.10.2026): стена строго «в
 * лоб» ортографической камерой, ровным светом — цвет листов игры, а не
 * освещённость редактора. Тот же общий кадр и та же очередь, что у снимков плиток.
 * Плитки не шире `WALL_TILE` px склеиваются в одну картинку.
 */
const WALL_TILE = 2048;

async function shootWall({ url, look, plate, window: view, pixels, parts }, live) {
  if (!shared || shared.stage.lost) {
    await quietMoment();
    live();
  }
  const state = liveStage();
  const asset = await loadSceneAsset(url);
  live();
  const { stage } = state;
  if (state.asset !== asset) {
    stage.setScene(asset);
    state.asset = asset;
  }
  if (stage.hasObjects) stage.setObjects([]);
  const shell = asset.parts.find((item) => item.id === "walls");
  stage.setFrame({ bounds: shell?.bounds || asset.bounds, ground: false, person: false });
  stage.setParts(parts);
  stage.setLook(look);
  await stage.texturesSettled(8000);
  live();
  stage.setLook(look);
  await stage.compile?.();
  live();
  await quietMoment();
  live();
  stage.setLook(look);
  await stage.compile?.();
  live();
  /* Без листов игры (браузер без Astral Desktop, лист не дошёл) стена — средние цвета:
     основой она не служит, студия начнёт с ровного тона. */
  if (!sheetsExpected() || (stage.texturesMissing?.() ?? 0) > 0) return null;
  const [width, height] = pixels;
  const tiles = Math.max(1, Math.ceil(width / WALL_TILE));
  const out = Object.assign(document.createElement("canvas"), { width, height });
  const context = out.getContext("2d");
  if (!context) return null;
  const [u0, v0, u1, v1] = view;
  for (let tile = 0; tile < tiles; tile += 1) {
    const x0 = Math.round((tile * width) / tiles);
    const x1 = Math.round(((tile + 1) * width) / tiles);
    const part = stage.renderOrtho({
      ...plate,
      window: [u0 + ((u1 - u0) * x0) / width, v0, u0 + ((u1 - u0) * x1) / width, v1],
      pixels: [x1 - x0, height],
    });
    if (!part) return null;
    context.drawImage(part, x0, 0);
    part.width = 0;
    part.height = 0;
    live();
  }
  if (stage.lost || shared?.stage !== stage) return null;
  return createImageBitmap(out).finally(() => {
    out.width = 0;
    out.height = 0;
  });
}

/**
 * Стена `plate` (`{ centre, normal, width, height }`, метры сцены `url`) строго «в
 * лоб»: `ImageBitmap` размера `pixels` или `null` — листов игры нет, кадр был бы
 * средними цветами. `window` — кусок стены (`[u0, v0, u1, v1]`, доли), `look` —
 * облик материалов (штатный: то, что стоит в игре), `parts` — видимые части.
 */
export function snapshotWall(options) {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return Promise.resolve(null);
  try {
    liveStage();
  } catch {
    return Promise.resolve(null);
  }
  return enqueue((live) => shootWall({ window: [0, 0, 1, 1], parts: null, ...options }, live));
}

/* Битмап снимка → WebP — в потоке кодирования (`snapshot-encode.js`). */
const bitmapUrl = (bitmap) => encodeBitmapWebp(bitmap, { quality: 0.9 });

/** Битмап → WebP-адрес в потоке кодирования: снимки предметов панели «Предметы» (`items-panel/item-shots.js`). */
export const encodeSnapshotBitmap = bitmapUrl;

/**
 * Готовая картинка снимка (`data:`-адрес) — из памяти, из хранилища или
 * снятая заново (тогда она ложится в хранилище). `key` — отпечаток облика.
 *
 * Обложки «Билбордов», «Интерьеров» и «Летающего лого» (задача 3 ТЗ
 * 11.10.2026, утро): `prepare()` — дорогая подготовка снимка (листы щита,
 * сцена помещения от Astral Desktop, фигура лого), только когда снимка ещё
 * нет; отвечает частью опций снимка (`url`, `look`, `parts`, `objects`,
 * `frame`) и `release()` — освободить после снимка, или `null` — снимать
 * нечем; `cache: false` в ответе — снимок не ложится в хранилище (лист игры
 * не прочитан: подключат игру — снимется заново). `sceneKey` — имя сцены в
 * ключе хранилища вместо адреса: у сцены от Astral Desktop адрес — ссылка
 * `blob:`, своя в каждом сеансе окна. `signal` — плитка ушла с экрана: снимок,
 * который больше никто не ждёт, из очереди выпадает (не снимается).
 */
export async function sceneThumbUrl(options) {
  const { url, key, sceneKey = "", width = 480, height = 300, signal = null } = options;
  const sceneName = sceneKey || `${url}|${await sceneStamp(url)}`;
  const storeKey = `scene:${SCENE_THUMB_VERSION}:${sceneName}|${key}|${width}x${height}`;
  if (urls.has(storeKey)) return urls.get(storeKey);
  let entry = pending.get(storeKey);
  if (!entry) {
    /* Снимок нужен, пока его ждёт хоть одна плитка (`signal` — плитка ушла). */
    const asked = { askers: 0, gone: 0 };
    const wanted = () => asked.gone < asked.askers;
    const job = (async () => {
      const stored = await readCoverFrame(storeKey);
      if (stored) return stored;
      if (!wanted() || typeof document === "undefined" || typeof createImageBitmap !== "function") return null;
      /* Подготовка — в очереди, в свой черёд: не все плитки окна разом. */
      const shot = await enqueue(async (live) => {
        const ready = typeof options.prepare === "function" ? await options.prepare() : {};
        try {
          live();
          if (!ready) return null;
          const taken = await shoot({ ...options, ...ready }, live);
          if (!taken) return null;
          /* `cache: false` у подготовки — лист игры не прочитан; недошедшие
             листы — то же самое. И то и другое — кадр временный. */
          const complete = taken.complete && ready.cache !== false;
          return { bitmap: taken.bitmap, cache: complete, complete };
        } finally {
          ready?.release?.();
        }
      }, wanted);
      if (!shot) return null;
      const made = await bitmapUrl(shot.bitmap);
      if (made && shot.cache) void writeCoverFrame(storeKey, made);
      if (made && !shot.complete) markProvisional(made);
      return made;
    })()
      .catch(() => null)
      .then((value) => {
        /* Временный кадр не помнится и в окне: следующий запрос снимет заново,
           когда листы доедут. */
        if (value && !provisional.has(value)) remember(storeKey, value);
        return value;
      })
      .finally(() => pending.delete(storeKey));
    entry = { asked, job };
    pending.set(storeKey, entry);
  }
  entry.asked.askers += 1;
  if (signal?.aborted) entry.asked.gone += 1;
  else
    signal?.addEventListener(
      "abort",
      () => {
        entry.asked.gone += 1;
      },
      { once: true },
    );
  return entry.job;
}

/* Для тестов: память и кадр живут весь сеанс окна. */
export function forgetSnapshots() {
  urls.clear();
  provisional.clear();
  pending.clear();
  queue.splice(0).forEach((job) => job.resolve(null));
  stamps.clear();
  dropStage();
}
