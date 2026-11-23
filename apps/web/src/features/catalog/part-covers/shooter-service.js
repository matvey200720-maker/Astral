// Сервис снимков частей: скрытое окно рисует то, что не умеет Node (шейдеры, холст, вёрстка).
import { createRoot } from "react-dom/client";
import { createElement, Suspense } from "react";
import { importPart } from "./part-import.js";
import { BIG_MAP_COVER } from "@modovik/vector-map";
import { paintWorkshopMatte, WORKSHOP_MATTE_LIGHT_BASE } from "@modovik/gfx/workshop-matte";
import { fillCoverWith, pngBytes, rasterizeLayout } from "./rasterize-cover.js";
import {
  blankedArenaProject,
  blankMaterials,
  blankSet,
} from "../../workshop/arena-editor/arena-blank.js";

export const PART_SHOT = Object.freeze({ width: 1200, height: 800 });

const SHOT_W = PART_SHOT.width;
const SHOT_H = PART_SHOT.height;
const WAIT = Object.freeze({ tries: 50, stepMs: 100, afterLayoutMs: 300 });
const MARGIN = Object.freeze({ minimap: 0.17, work: 0.06 });
const RADAR_FILE = "radar.apg1";
const TRACER_CODE = "tracer-work.code";
const RICH_FRAME = 2;
const MARK_SPAN = 14;

// Русские причины идут в журнал печи, в интерфейсе не показываются.
const SAY = Object.freeze({
  noGame: "море из игры не снять: печь запущена без игры (нужны --game и --keys)",
  seaFailed: "кадр моря не вышел: ",
  seaNoReason: "причина не названа",
  noFxFrame:
    "кадр игры не снять: печь запущена без набора сцен FX или без игры (нужны --fx-scenes, --game и --keys)",
  crash: "сбой: ",
  noFrame: "кадр игры не получился",
  noFxClip:
    "ролик не снять: печь запущена без набора сцен FX или без игры (нужны --fx-scenes, --game и --keys)",
  clipCrash: "сбой ролика: ",
  noClip: "ролик не вышел",
  clipNoKind: "у этого вида ролика эффекта нет",
  tracerEmpty: "в файлах нет ни профиля, ни картинки следа",
  tracerNoProfile: "в коде работы нет профиля трассера",
  coreNoCard: "в файлах карточки нет правки ядра",
  skyNoProject: "в коде нет проекта неба: ",
  blank: "пусто",
  noEncoder: "окно не умеет кодировать видео",
  loopCrash: "сбой петли: ",
  nothing: "nothing",
  imageLost: "Кадр неба не прочитался.",
});

// Развороты изнутри: курс и наклон прибавляются к глазу штатной сцены.
const turnList = (...pairs) => Object.freeze(pairs.map(([yaw, pitch]) => ({ yaw, pitch })));
const INSIDE_TURNS = new Map([
  ["majestic", turnList([-0.8, 0.12], [0.5, 0.25])],
  ["gta5rp", turnList([Math.PI, 0.1], [0.5, 0.25])],
]);
const HALL_TURNS = new Map([
  ["gta5rp", turnList([1.2, 0.1], [Math.PI, 0.1], [2.54, 0.1], [3.74, 0.1])],
]);
const OUTSIDE_VIEWS = Object.freeze(
  [
    [0, 0.36, 0.62],
    [1.3, 0.22, 0.7],
    [-1.1, 0.5, 0.85],
  ].map(([yaw, pitch, zoom]) => ({ yaw, pitch, zoom })),
);
const NO_TURN = Object.freeze({ yaw: 0, pitch: 0 });
const DEFAULT_EYE = Object.freeze({ eye: [0, 0, 1.7], yaw: 0, pitch: 0 });
const SURFACES = Object.freeze(["facade", "floor", "walls", "ceiling"]);
const HALL_FILES = Object.freeze([
  ["hall", "hall.bin"],
  ["hallOutside", "hall-outside.bin"],
]);
const TRACER_FIELDS = Object.freeze([
  "style",
  "colours",
  "colourMode",
  "coreColour",
  "glow",
  "thickness",
  "length",
]);

// Соседи грузятся по требованию; пути записаны ровно так, как их ждёт сборка.
const NEIGHBOURS = {
  skyCover: () => import("../../workshop/covers/SkyCover.jsx"),
  killEffects: () => import("@modovik/kill-effects"),
  killPainter: () => import("../../../components/desktop/workshop/kill-effect-painter.js"),
  fxFrames: () => import("./fx-frame-cover.js"),
  fxClips: () => import("./fx-clip.js"),
  coreCover: () => import("./core-cover.js"),
  seaBridge: () => import("./sea-kit-bridge.js"),
  seaCapture: () => import("../../workshop/water-editor/water-sea-capture.js"),
  impact: () => import("../../workshop/covers/ImpactCover.jsx"),
  minimapCover: () => import("../../workshop/covers/MinimapCover.jsx"),
  radarField: () => import("./minimap-radar-field.js"),
  minimapClip: () => import("./minimap-clip.js"),
  minimapScreen: () => import("./minimap-screen-cover.js"),
  mslZones: () => import("./msl-zones-cover.js"),
  skyClip: () => import("./sky-clip.js"),
  skyQuarter: () => import("./sky-quarter-cover.js"),
  workTransfer: () => import("../../workshop/works/work-transfer.js"),
  work: () => import("./part-work.js"),
  oven: () => import("../../workshop/covers/cover-oven.jsx"),
  loaders: () => import("../../workshop/covers/cover-loaders.js"),
  vectorMapCover: () => import("./vector-map-cover.js"),
  worldPlaces: () => import("./world-places-cover.js"),
  sceneShots: () => import("./scene-cover-shots.js"),
  sceneTextures: () => import("../../workshop/model-stage/scene-textures.js"),
  sceneSnapshot: () => import("../../workshop/model-stage/scene-snapshot.js"),
  sceneAsset: () => import("../../workshop/model-stage/scene-asset.js"),
  arenasContract: () => import("@modovik/climb-contract/recolor/arenas"),
  arenaText: () => import("../../workshop/arena-editor/arena-text.js"),
  finishTextures: () => import("../../workshop/finish/finish-textures.js"),
  starFrames: () => import("./arena-star-frames.js"),
  hallLight: () => import("./arena-hall-light.js"),
  frameScore: () => import("./arena-frame-score.js"),
  vectorMap: () => import("@modovik/vector-map"),
  mapTemplates: () => import("../../../components/desktop/workshop/world-map-templates.js"),
  mapRender: () => import("../../../components/desktop/workshop/world-map-vector-render.js"),
  zonesIsland: () => import("./zones-island-cover.js"),
  lampNight: () => import("./lamp-night-shot.js"),
  cloudSky: () => import("./cloud-sky-cover.js"),
};

// Все названные модули стартуют вместе; ответ - объект «имя -> модуль».
const gather = (...names) =>
  Promise.all(names.map((name) => NEIGHBOURS[name]())).then((loaded) =>
    Object.fromEntries(names.map((name, at) => [name, loaded[at]])),
  );

// ---------- мелкие помощники ----------

const when = (flag, fields) => (flag ? fields : {});
const whenDo = (flag, make) => (flag ? make() : {});
const attempt = (run, fail) => new Promise((resolve) => resolve(run())).catch(fail);
const settledWith = async (run, cleanup) => {
  try {
    return await run();
  } finally {
    cleanup();
  }
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const errorText = (error) => String(error?.message ?? error ?? "");
const textOf = (bytes) => new TextDecoder().decode(bytes);
const byName = (files, name) => files.find((file) => file.name === name);
const sheetTable = (files, keep) =>
  new Map(files.filter(keep).map((file) => [file.name, file.bytes]));
const toBuffer = (bytes) => new Uint8Array(bytes).buffer;
const failedShot = (fxReason) => ({ png: null, fxReason });
const withDefaults = (defaults, source) =>
  Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      source[key] === undefined ? fallback : source[key],
    ]),
  );
const extent = (values) =>
  values.reduce((span, v) => [Math.min(span[0], v), Math.max(span[1], v)], [Infinity, -Infinity]);
const spanOf = (values) => extent(values).reduce((low, high) => high - low);
const middleOf = (values) => extent(values).reduce((low, high) => (high + low) / 2);
const sequentially = (items, step) =>
  items.reduce(
    (chain, item, at) =>
      chain.then((done) => Promise.resolve(step(item, at)).then((out) => done.concat([out]))),
    Promise.resolve([]),
  );
// Код работы хранит состояние строкой JSON либо готовым объектом.
const projectOfRead = (read) => {
  const state = read?.templates?.[0]?.state;
  return typeof state === "string" ? JSON.parse(state) : state;
};
// Клип, который не удался, превращается в текст причины, а не в отказ запроса.
const guardedClip = (run, limit) =>
  attempt(
    async () => ({ clip: await run(), clipError: "" }),
    (error) => ({ clip: null, clipError: errorText(error).slice(0, limit) }),
  );

// ---------- холст и картинки ----------

const blankCanvas = (width, height) =>
  Object.assign(document.createElement("canvas"), { width, height });

const encodePng = (canvas) =>
  new Promise((done) => canvas.toBlob(done, "image/png"))
    .then((blob) => blob.arrayBuffer())
    .then((buffer) => new Uint8Array(buffer));

// `light` — светлая студия под прозрачные и тёмные объёмы (`backdrop: "light"` в плане обложки): край поля светлый, а не чёрный.
const matteCanvas = (width, height, light = false) => {
  const canvas = blankCanvas(width, height);
  const context = canvas.getContext("2d");
  paintWorkshopMatte(context, width, height, light ? { base: WORKSHOP_MATTE_LIGHT_BASE } : undefined);
  return { canvas, context };
};

// Снимок сцены ложится на матовое поле обложек; пустой снимок - пустой ответ.
/* Ночное небо под объектами в небе (`frame: "sky"`): тёмный градиент к горизонту и редкие звёзды (зерно фиксировано — кадр повторяем), поверх — снимок и его же размытая копия «лучше»: лента светится. */
const SKY_STARS = 90;
const paintSky = (context, width, height) => {
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#02040b");
  gradient.addColorStop(0.55, "#070d1f");
  gradient.addColorStop(1, "#13203a");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  let seed = 7;
  const next = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let star = 0; star < SKY_STARS; star += 1) {
    const x = next() * width;
    const y = next() * height * 0.8;
    context.fillStyle = `rgba(255,255,255,${0.15 + next() * 0.45})`;
    context.fillRect(x, y, 1.4, 1.4);
  }
};

const skyCanvas = (bitmap) => {
  const canvas = blankCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  paintSky(context, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0);
  context.globalCompositeOperation = "lighter";
  context.filter = "blur(16px) saturate(1.5)";
  context.globalAlpha = 0.45;
  context.drawImage(bitmap, 0, 0);
  return { canvas, context };
};

const snapshotPng = async (bitmap, light = false, sky = false) => {
  if (!bitmap) return null;
  const { canvas, context } = sky ? skyCanvas(bitmap) : matteCanvas(bitmap.width, bitmap.height, light);
  if (!sky) context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return encodePng(canvas);
};

const loadImage = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    Object.assign(image, {
      onload: () => resolve(image),
      onerror: () => reject(new Error(SAY.imageLost)),
    });
    image.src = url;
  });

const pngFromDataUrl = (url) =>
  loadImage(url).then((image) => {
    const canvas = blankCanvas(SHOT_W, SHOT_H);
    canvas.getContext("2d").drawImage(image, 0, 0, SHOT_W, SHOT_H);
    return encodePng(canvas);
  });

// Вёрстка на сцене окна: внешний span для снимка и внутренний «workshop-cover» под корень React.
const spanWith = (css, className) => {
  const span = document.createElement("span");
  if (className) span.className = className;
  span.style.cssText = css;
  return span;
};

const withMounted = async (stage, [width, height], shotClass, job, afterUnmount) => {
  const box = `position:absolute;inset:0;width:${width}px;height:${height}px`;
  const frame = spanWith(`${box};background:none`, "workshop-cover");
  const shot = spanWith(box, shotClass);
  shot.append(frame);
  stage.replaceChildren(shot);
  const root = createRoot(frame);
  return settledWith(
    () => job({ shot, frame, root }),
    () => {
      root.unmount();
      stage.replaceChildren();
      afterUnmount?.();
    },
  );
};

const settle = (ready, left = WAIT.tries) =>
  left > 0
    ? sleep(WAIT.stepMs).then(() => (ready() ? undefined : settle(ready, left - 1)))
    : Promise.resolve();

const picturesLoaded = (host) =>
  Array.from(host.querySelectorAll("img")).every((img) => img.complete && img.naturalWidth);

// Источник листов сцены: ищет байты по ключу записи и отдаёт готовую картинку либо пусто.
const imageOf = (bytes) => createImageBitmap(new Blob([bytes], { type: "image/webp" }));
const sheetSource = (keyOf, sheets, onAsk) => (entry) => {
  const key = keyOf(entry);
  onAsk?.(key, entry);
  return sheets.has(key) ? imageOf(sheets.get(key)) : null;
};

// Подготовка и уборка общей сцены снимков: листы мода живут только на время съёмки.
const withSheetSource = ({ sceneTextures, sceneSnapshot }, source, job, afterwards) => {
  sceneSnapshot.forgetSnapshots();
  sceneTextures.setSceneSheetSource(source);
  return settledWith(job, () => {
    sceneTextures.setSceneSheetSource(null);
    sceneSnapshot.forgetSnapshots();
    afterwards?.();
  });
};

// ---------- вода ----------

const seaShot = (sea, stateText) =>
  sea?.gameRoot
    ? gather("seaBridge", "seaCapture")
        .then(({ seaBridge, seaCapture }) => {
          seaBridge.installSeaKit();
          return seaCapture.captureSeaFrame({
            gameRoot: sea.gameRoot,
            project: JSON.parse(stateText),
            size: PART_SHOT,
          });
        })
        .then((frame) =>
          frame?.url
            ? pngFromDataUrl(frame.url).then((png) => ({ png }))
            : failedShot(SAY.seaFailed + (frame?.reason || SAY.seaNoReason)),
        )
    : Promise.resolve(failedShot(SAY.noGame));

// ---------- кадры и ролики эффектов ----------

const killPaint = (painter, frameAt) => (args) =>
  painter.paintKillEffect({
    context: args.context,
    width: args.width,
    height: args.height,
    frame: frameAt(args.elapsedMs),
    grain: false,
    scene: args.scene,
  });

// Кадр килла берёт пик вспышки, ролик - момент по часам рисовальщика.
const KILL_VARIANT = {
  frame: {
    host: "fxFrames",
    entry: "fxKillCover",
    frameAt: (m, effect) => () => m.killPainter.killEffectPeakFrame(effect),
  },
  clip: {
    host: "fxClips",
    entry: "fxKillClip",
    frameAt: (m, effect) => (ms) => m.killEffects.killEffectFrame(effect, ms),
  },
};
const HIT_VARIANT = {
  frame: { host: "fxFrames", entry: "fxHitCover" },
  clip: { host: "fxClips", entry: "fxHitClip" },
};

const killShot = (variant) => (cover) =>
  gather("killEffects", "killPainter", variant.host).then((m) => {
    const effect = m.killEffects.createKillEffectProject(JSON.parse(cover.state));
    const paint = killPaint(m.killPainter, variant.frameAt(m, effect));
    return m[variant.host][variant.entry]({ paint });
  });

const hitShot = (variant) => (cover) =>
  gather("impact", variant.host).then((m) =>
    m[variant.host][variant.entry]({ zone: m.impact.coverBodyZone(cover.state) }),
  );

const CLIP_MAKERS = new Map([
  ["hit-effects", hitShot(HIT_VARIANT.clip)],
  ["kill-effects", killShot(KILL_VARIANT.clip)],
]);

const clipVerdict = (clip) =>
  clip?.bytes
    ? { png: clip.poster, clip, framed: true, note: clip.note || "" }
    : failedShot(clip?.reason || SAY.noClip);

const effectClip = (cover, fx) => {
  const make = CLIP_MAKERS.get(cover?.slotId);
  if (!fx) return Promise.resolve(failedShot(SAY.noFxClip));
  if (!make) return Promise.resolve(failedShot(SAY.clipNoKind));
  return attempt(
    () => make(cover).then(clipVerdict),
    (error) => failedShot(SAY.clipCrash + errorText(error)),
  );
};

// Кадр игры берётся только если печь дала набор сцен FX и игру.
const gameFrame = (enabled, shoot) =>
  enabled
    ? attempt(shoot, (error) => ({ reason: SAY.crash + errorText(error) })).then((reply) =>
        reply?.png ? { ...reply, framed: true } : failedShot(reply?.reason || SAY.noFrame),
      )
    : Promise.resolve(failedShot(SAY.noFxFrame));

// ---------- небо ----------

// Квартал из игры под небом и светом части — тот же кадр, что плитка таймцикла в мастерской (`sky-quarter-cover.js`); null — снять нельзя.
// Почему квартал не снялся — в папку отладки печи (`ASTRAL_FX_COVER_DEBUG`, `/fx-cover/debug`), если она заведена: кадр молча уходит на прежний вид, и без записи причины не найти.
const quarterNote = (text) => fetch(`/fx-cover/debug?name=sky-quarter-${Date.now()}.txt`, { method: "POST", body: String(text).slice(0, 4000) }).catch(() => {});

const skyQuarter = (sea, shoot) =>
  sea?.gameRoot
    ? attempt(
        () =>
          gather("seaBridge", "skyQuarter").then(async ({ seaBridge, skyQuarter: quarter }) => {
            seaBridge.installSeaKit();
            const frame = await shoot(quarter, sea.gameRoot);
            if (frame && !Array.isArray(frame) && !frame.url) quarterNote(`причина: ${frame.reason || "нет"}`);
            return frame;
          }),
        (error) => {
          quarterNote(`сбой: ${error?.stack || error}`);
          return null;
        },
      )
    : Promise.resolve(null);

const skyFrame = async (cover, env) => {
  const project = JSON.parse(cover.state);
  const frame = await skyQuarter(env?.sea, (quarter, gameRoot) => quarter.skyQuarterFrame({ gameRoot, project, size: PART_SHOT }));
  if (frame?.url) return pngFromDataUrl(frame.url);
  /* Игра дана, а квартал не снялся (движок не собран, секция не прочиталась): нарисованный город за кадр игры не выдаём — отказ с причиной,
     её видно в журнале печи. Без игры (плитки вне печи) — прежний кадр: день мода полосами над нарисованным городом. */
  if (env?.sea?.gameRoot) throw new Error(`квартал из игры под небом части не снят: ${frame?.reason || "сбой съёмки"}`);
  const { skyCover } = await gather("skyCover");
  return pngFromDataUrl(await skyCover.skyCoverDay(project, PART_SHOT));
};

const skyExtras = async (state, env) => {
  const { skyClip: sky } = await gather("skyClip");
  const project = JSON.parse(state);
  const onQuarter = await skyQuarter(env?.sea, (quarter, gameRoot) => quarter.skyQuarterStills({ gameRoot, project, size: PART_SHOT }));
  /* Игра дана, а кадры квартала не сняты (нет архива неба или облаков, квартал не собрался): галерея нарисованным городом не подменяется — отказ с причиной (как у обложки, `skyFrame`). */
  if (!Array.isArray(onQuarter) && env?.sea?.gameRoot) throw new Error(`кадры квартала из игры под небом части не сняты: ${onQuarter?.reason || "сбой съёмки"}`);
  const stills = Array.isArray(onQuarter) ? onQuarter : await sky.skyStills(project, PART_SHOT);
  const { clip, clipError } = await guardedClip(() => sky.skyClip(project), 200);
  return { stills, clip, ...when(clipError, { clipError }) };
};

/* Небо с облаками для части «Облака» (`cloud-sky-cover.js`): кадр шейдера неба под таймциклом соседней части, шапки облаков игры; день — обложка, утро и вечер — галерея. */
const cloudSkyShot = async ({ files, request }) => {
  const gameRoot = request?.sea?.gameRoot;
  if (!gameRoot) return failedShot("небо с облаками из игры не снять: печь запущена без игры (нужны --game и --keys)");
  const { seaBridge, cloudSky } = await gather("seaBridge", "cloudSky");
  seaBridge.installSeaKit();
  const shots = await attempt(
    () => cloudSky.cloudSkyFrames({ gameRoot, files, name: request?.name || "", size: PART_SHOT }),
    (error) => ({ reason: `сбой: ${errorText(error).slice(0, 160)}` }),
  );
  if (!shots?.frames?.length) return failedShot(`небо с облаками не снято: ${shots?.reason || "причина не названа"}`);
  const [day, ...rest] = [shots.frames.find((frame) => frame.id === "day"), ...shots.frames.filter((frame) => frame.id !== "day")];
  return { png: day.bytes, gallery: rest.map((frame) => frame.bytes), note: `cloud share ${Math.round(shots.share * 100)}%` };
};

const skyDayShot = async ({ request }) => {
  const { workTransfer } = await gather("workTransfer");
  const { skyClip: sky } = await gather("skyClip");
  const read = await attempt(
    () => workTransfer.readWorkCode(String(request.code || ""), { accept: ["sky"] }),
    (error) => ({ error }),
  );
  const project = projectOfRead(read);
  if (!project) {
    const why = (read?.error?.message || SAY.blank).slice(0, 120);
    return { png: null, work: null, clipError: SAY.skyNoProject + why };
  }
  const { clip, clipError } = await guardedClip(() => sky.dayClip(project), 200);
  return {
    png: null,
    work: null,
    ...(clip ? { clip } : { clipError: clipError || SAY.noEncoder }),
  };
};

// ---------- мини-карта ----------

const MINIMAP_SIZE = [SHOT_W * 2, SHOT_H * 2];

// Снимает вёрстку мини-карты; options (необязательно) несёт measure для рамок полос петли.
const minimapLayer = async (kit, env, state, options) => {
  const measure = typeof options === "function" ? options : options?.measure;
  const [width, height] = MINIMAP_SIZE;
  const radarSrc =
    (env.radar && (await kit.radarField.radarFieldUrl(env.radar.bytes))) || "";
  return withMounted(
    env.stage,
    MINIMAP_SIZE,
    undefined,
    async ({ shot, frame, root }) => {
      root.render(createElement(kit.minimapCover.default, { state, radarSrc }));
      await settle(() => frame.querySelector(".mmc-map") && picturesLoaded(frame));
      const rects = measure ? measure(shot) : null;
      return { layer: await rasterizeLayout(shot, { width, height }), rects };
    },
    () => radarSrc && URL.revokeObjectURL(radarSrc),
  );
};

const minimapFrame = async (cover, env) => {
  const kit = await gather("minimapCover", "radarField");
  const { layer } = await minimapLayer(kit, env, cover.state);
  /* Без поля: вокруг панели прозрачно, окно страницы мода показывает её целиком (`@modovik/gfx/map-card`). */
  return fillCoverWith(layer, PART_SHOT, { margin: MARGIN.minimap, bare: true });
};

// Положение мини-карты: экран игры 16:9 и карта на месте записи автора (владелец 12.11.2026).
const minimapScreenFrame = async (cover, env) => {
  const kit = await gather("minimapCover", "radarField", "minimapScreen");
  const { layer } = await minimapLayer(kit, env, cover.state);
  const canvas = kit.minimapScreen.minimapScreenCanvas(layer, cover.screen, PART_SHOT);
  return canvas ? pngBytes(canvas) : null;
};

const minimapLoop = async (cover, env) => {
  if (!cover.gfx) return null;
  const { minimapClip } = await gather("minimapClip");
  const kit = await gather("minimapCover", "radarField");
  return minimapClip.minimapMotion({
    state: cover.state,
    gfx: cover.gfx,
    margin: MARGIN.minimap,
    cover: PART_SHOT,
    layerOf: (state, options) => minimapLayer(kit, env, state, options),
  });
};

const guardedLoop = (cover, env) =>
  attempt(
    () => minimapLoop(cover, env),
    (error) => ({ reason: SAY.loopCrash + errorText(error).slice(0, 160) }),
  );

// ---------- обычные виды: обложка по слоту разбора ----------

const killFrameShot = killShot(KILL_VARIANT.frame);
const hitFrameShot = hitShot(HIT_VARIANT.frame);

// «МСЛ-зоны» редукса: готовая картинка зон из мастерской (`msl-zones-cover.js`); сцена описи не приехала — кадра нет.
const mslZonesFrame = async () => {
  const { mslZones } = await gather("mslZones");
  const layer = await mslZones.mslZonesLayer();
  return layer ? fillCoverWith(layer, PART_SHOT, { margin: MARGIN.work }) : null;
};

const COVER_PAINTERS = new Map([
  ["msl-zones", () => mslZonesFrame()],
  ["timecycle", (cover, env) => skyFrame(cover, env)],
  ["kill-effects", (cover, env) => gameFrame(env.fx, () => killFrameShot(cover))],
  ["hit-effects", (cover, env) => gameFrame(env.fx, () => hitFrameShot(cover))],
  ["minimap", (cover, env) => minimapFrame(cover, env)],
  ["water", (cover, env) => seaShot(env.sea, cover.state)],
]);

const paintCover = async (cover, env) => {
  if (!cover) return null;
  if (cover.image) return cover.image;
  /* Положение мини-карты: слот тот же, но кадр — экран игры с картой на месте. */
  if (cover.slotId === "minimap" && cover.screen) return minimapScreenFrame(cover, env);
  const paint = COVER_PAINTERS.get(cover.slotId);
  return paint ? paint(cover, env) : null;
};

// Ключи ответа идут в порядке: картинка, метки кадра, небо, петля, работа, отказ редактора.
const composeReply = ({ drawn, loop, sky, work, imported }) =>
  Object.assign(
    { png: loop?.poster || (drawn instanceof Uint8Array ? drawn : drawn?.png || null) },
    when(drawn?.framed === true, { framed: true, note: drawn?.note }),
    when(drawn?.fxReason, { fxReason: drawn?.fxReason }),
    sky,
    loop?.clip ? { clip: loop.clip } : when(loop?.reason, { clipError: loop?.reason }),
    work || { work: null },
    when(imported?.refused, { refused: imported?.refused, rules: imported?.rules || [] }),
  );

const ordinaryShot = async ({ request, files, radar, stage }) => {
  const { partKind, palette, fxClip, clip } = request || {};
  const name = request?.name || "";
  const imported = await importPart(partKind, files, { name, palette, still: request?.still === true });
  const cover = imported?.cover;
  const fx = request?.fx === true;
  if (fxClip) return { ...(await effectClip(cover, fx)), work: null };

  const env = { stage, radar, fx, sea: request?.sea || null };
  const drawn = await paintCover(cover, env);
  const slot = cover?.slotId;
  const loops = clip !== false;
  const loop = loops && slot === "minimap" ? await guardedLoop(cover, env) : null;
  const sky = loops && slot === "timecycle" ? await skyExtras(cover.state, env) : null;
  const { work: workPart } = await gather("work");
  const work = await workPart.partWork(partKind, files, imported, { name });
  return composeReply({ drawn, loop, sky, work, imported });
};

// ---------- места, векторная карта, зоны ----------

const PLACE_CANVAS = { grass: "grassCoverCanvas", mapping: "placesCoverCanvas" };

const placesShot =
  (kind) =>
  async ({ files }) => {
    const data = files.length ? JSON.parse(textOf(files[0].bytes)) : null;
    if (!data) return null;
    const { worldPlaces } = await gather("worldPlaces");
    const canvas = await worldPlaces[PLACE_CANVAS[kind]](data, PART_SHOT);
    return encodePng(canvas);
  };

const bigMapShot = async ({ request, files }) => {
  const { vectorMapCover } = await gather("vectorMapCover");
  const own = request.cover;
  const frame = own ? { width: Number(own.width), height: Number(own.height) } : BIG_MAP_COVER;
  /* Часть редукса (`request.exact`) — цвета автора как есть: чёрная карта остаётся чёрной. */
  const extras = own ? { gap: Number(own.gap) } : { exact: request.exact === true };
  const canvas = files.length
    ? vectorMapCover.vectorMapCoverCanvas(files[0].bytes, frame, extras)
    : null;
  if (!canvas) return null;
  // Обложки каталога (`request.cover`, `catalog-bigmap-covers`) остаются прозрачными: их проверяет `checkBigMapCover`.
  if (own) return encodePng(canvas);
  // Часть «Большая карта» редукса — на том же чёрном матовом поле, что прицел и мини-карта (ТЗ 10.11.2026, Б5).
  const field = matteCanvas(canvas.width, canvas.height);
  field.context.drawImage(canvas, 0, 0);
  return encodePng(field.canvas);
};

// Кадр по общему охвату зон: центр, половина высоты и ширины в метрах мира.
const zonesFrame = (zones) => {
  const corners = zones.flatMap((zone) => zone.points);
  const [xs, ys] = [0, 1].map((axis) => corners.map((point) => point[axis]));
  const aspect = SHOT_W / SHOT_H;
  const reserve = zones.length > 1 ? 1.15 : 1.8;
  const half = Math.max(80, spanOf(ys) / 2, spanOf(xs) / 2 / aspect) * reserve;
  return { centre: [middleOf(xs), middleOf(ys)], half, halfWide: half * aspect };
};

const worldOf = ({ centre, half, halfWide }) => ({
  x0: centre[0] - halfWide,
  x1: centre[0] + halfWide,
  y0: centre[1] + half,
  y1: centre[1] - half,
});

const rectInAtlas = (world, atlas, size) => ({
  u: (world.x0 - atlas.originX) / size.width,
  v: (atlas.originY - world.y0) / size.height,
  width: (world.x1 - world.x0) / size.width,
  height: (world.y0 - world.y1) / size.height,
});

const setStyles = (context, pairs) => pairs.forEach(([key, value]) => (context[key] = value));

const tracePath = (context, pixels) => {
  context.beginPath();
  pixels.forEach(([x, y], at) => context[at ? "lineTo" : "moveTo"](x, y));
  context.closePath();
};

const paintZone = (context, zone, pixels, outline) => {
  tracePath(context, pixels);
  setStyles(context, [
    ["globalAlpha", Math.max(0.28, Math.min(0.85, zone.alpha / 255))],
    ["fillStyle", zone.colour],
  ]);
  context.fill();
  setStyles(context, [
    ["globalAlpha", 1],
    ["lineWidth", outline],
    ["strokeStyle", zone.colour],
  ]);
  context.stroke();
  const xs = pixels.map((pixel) => pixel[0]);
  const ys = pixels.map((pixel) => pixel[1]);
  if (!(spanOf(xs) < MARK_SPAN && spanOf(ys) < MARK_SPAN)) return;
  context.beginPath();
  context.arc(middleOf(xs), middleOf(ys), MARK_SPAN / 2, 0, Math.PI * 2);
  setStyles(context, [["fillStyle", zone.colour]]);
  context.fill();
  setStyles(context, [
    ["lineWidth", 2],
    ["strokeStyle", "rgba(0, 0, 0, 0.7)"],
  ]);
  context.stroke();
};

const zonesShot = async ({ files }) => {
  const source = byName(files, "zones.json");
  if (!source) return null;
  const { zones = [], whole = false } = JSON.parse(textOf(source.bytes));
  const drawable = zones.filter((zone) => zone?.points?.length >= 3);
  if (drawable.length === 0) return null;

  const mods = await gather("vectorMap", "mapTemplates", "mapRender");
  const geometry = await mods.mapTemplates.loadBundledRadarGeometry();
  if (!geometry) return null;

  /* Часть «Зоны» редукса — весь остров в рамке-карточке, у мелких зон врезки (`zones-island-cover.js`); виды «маппинг» с зонами остаются на охвате самих зон. */
  if (whole) {
    const { zonesIsland } = await gather("zonesIsland");
    const atlas = mods.vectorMap.normalizeAtlas(mods.vectorMap.DEFAULT_ATLAS);
    const canvas = zonesIsland.paintIslandZones({
      render: mods.mapRender,
      source: { geometry, atlas, atlasSize: mods.vectorMap.atlasSize(atlas) },
      zones: drawable,
      size: { width: SHOT_W, height: SHOT_H },
      makeCanvas: () => {
        const canvas = blankCanvas(SHOT_W, SHOT_H);
        return { canvas, context: canvas.getContext("2d") };
      },
    });
    return canvas ? encodePng(canvas) : null;
  }

  const world = worldOf(zonesFrame(drawable));
  const atlas = mods.vectorMap.normalizeAtlas(mods.vectorMap.DEFAULT_ATLAS);
  const rect = rectInAtlas(world, atlas, mods.vectorMap.atlasSize(atlas));
  const map = mods.mapRender.paintVectorCanvas({ geometry, atlas }, rect, SHOT_W, SHOT_H);
  if (!map) return null;

  const { canvas, context } = matteCanvas(SHOT_W, SHOT_H);
  context.drawImage(map, 0, 0);
  context.lineJoin = "round";
  const toPixels = ([x, y]) => [
    ((x - world.x0) / (world.x1 - world.x0)) * SHOT_W,
    ((world.y0 - y) / (world.y0 - world.y1)) * SHOT_H,
  ];
  const outline = drawable.length > 1 ? 2.5 : 4;
  drawable.forEach((zone) => paintZone(context, zone, zone.points.map(toPixels), outline));
  return encodePng(canvas);
};

// ---------- сцена мастерской ----------

/* Свет ночного неба: солнца почти нет, ровный холодный свет — лента сияния читается своей текстурой (форма как у `NIGHT_DAYLIGHT` фонарей, `lamp-night-shot.js`). */
const SKY_DAYLIGHT = Object.freeze({
  sun: 0.05,
  ambient: 0.55,
  environment: 0.25,
  exposure: 1.0,
  sunColour: "#bcd0ff",
  fillColour: "#7f9cff",
  skyColour: "#9fb4ff",
  groundColour: "#1c2748",
  sunDirection: [0, -0.3, 0.9],
});

/* `views` — все ракурсы плана (первый — обложка): остальные кадры той же сцены идут в галерею, сцена грузится один раз. */
const modSceneShot = async (frames, bytes, place, view, views = null, night = null) => {
  const makeFrame = frames[place];
  if (typeof makeFrame !== "function") return null;
  const url = URL.createObjectURL(new Blob([bytes]));
  const asked = Array.isArray(views) && views.length ? views : [view];
  const [lead, ...rest] = await Promise.all(asked.map((one) => makeFrame({ view: one })));
  /* Ночной кадр лампы (`lamp-night-shot.js`): лампы, пятно света и ореол — по записям света из файла модели, ночное время суток студии. */
  const lit = night?.lights?.length ? (await gather("lampNight")).lampNight : null;
  const dark = lit ? await lit.nightLook(night) : null;
  return {
    url,
    look: (_index, info) => ({ colour: info.colour }),
    frame: lead,
    more: rest,
    /* Светлая студия — у всей сцены сразу (кадр и галерея одним фоном): её просит первый ракурс плана. */
    light: asked[0]?.backdrop === "light",
    /* Объекты в небе: ночной свет студии (лента читается светом сама, без солнца), фон и свечение — `snapshotPng`. */
    sky: place === "sky",
    ...when(place === "sky" ? SKY_DAYLIGHT : null, { daylight: SKY_DAYLIGHT }),
    ...when(dark, { lamps: dark?.lamps, daylight: dark?.daylight, objects: dark?.objects }),
    release: () => {
      dark?.release();
      URL.revokeObjectURL(url);
    },
  };
};

const askedEntry = (entry) =>
  Object.assign(
    {},
    when(entry.game, { game: entry.game }),
    when(entry.set, { set: entry.set, resource: entry.resource }),
    { texture: entry.texture },
  );

// Ширина полосы: растительности нужна узкая рамка, остальным кадр целиком.
const stripWidth = (strip) =>
  strip > 0 ? Math.min(SHOT_W, Math.max(64, Math.round(strip))) : SHOT_W;

const SCENE_DEFAULTS = () => ({
  scene: undefined,
  probe: false,
  frame: "",
  width: 0,
  project: null,
  view: null,
  views: null,
  night: null,
});

const sceneShot = async ({ files }) => {
  const manifest = byName(files, "scene.json");
  if (!manifest) return null;
  const plan = withDefaults(SCENE_DEFAULTS(), JSON.parse(textOf(manifest.bytes)));
  const built = byName(files, "scene.bin");
  const sheets = sheetTable(files, (file) => !["scene.json", "scene.bin"].includes(file.name));
  const mods = await gather("sceneShots", "sceneTextures", "sceneSnapshot");
  const fromMod = plan.scene === "mod" && built;
  if (!fromMod && !mods.sceneShots.SCENE_SHOTS[plan.scene]) return null;

  const asked = new Map();
  const source = sheetSource(mods.sceneTextures.sheetSourceKey, sheets, (key, entry) => {
    if (key && !asked.has(key)) asked.set(key, askedEntry(entry));
  });
  return withSheetSource(mods, source, async () => {
    const shot = fromMod
      ? await modSceneShot(mods.sceneShots.MOD_SCENE_FRAMES, built.bytes, plan.frame, plan.view, plan.views, plan.night)
      : await mods.sceneShots.SCENE_SHOTS[plan.scene](
          Object.assign(
            {},
            when(plan.project, { project: plan.project }),
            when(plan.frame, { frame: plan.frame }),
          ),
        );
    if (!shot) return null;
    const shoot = (frame) =>
      mods.sceneSnapshot.snapshotScene(
        Object.assign(
          { url: shot.url, look: shot.look, frame },
          when(shot.objects, { objects: shot.objects }),
          when(shot.lamps, { lamps: shot.lamps }),
          when(shot.daylight, { daylight: shot.daylight }),
          { width: stripWidth(plan.width), height: SHOT_H },
        ),
      );
    return settledWith(
      async () => {
        const bitmap = await shoot(shot.frame);
        if (!plan.probe) {
          const png = await snapshotPng(bitmap, shot.light === true, shot.sky === true);
          /* Остальные ракурсы плана (стороны здания) — той же сценой, по одному: кадр снимков один на окно. */
          const gallery = [];
          if (png) for (const frame of shot.more || []) gallery.push(await snapshotPng(await shoot(frame), shot.light === true, shot.sky === true));
          return gallery.length ? { png, gallery } : png;
        }
        bitmap?.close?.();
        return { png: null, need: Array.from(asked.values()) };
      },
      () => shot.release?.(),
    );
  });
};

// ---------- обложка работы мастерской ----------

const layoutWorkCover = (stage, Cover, kind, state) =>
  withMounted(stage, [SHOT_W, SHOT_H], "desktop-app", async ({ shot, frame, root }) => {
    const cover = createElement(Cover, { kind, projectId: "", state });
    root.render(createElement(Suspense, { fallback: null }, cover));
    if (document.fonts) await document.fonts.ready;
    await settle(() => frame.firstElementChild && picturesLoaded(frame));
    await sleep(WAIT.afterLayoutMs);
    const layer = await rasterizeLayout(shot, { width: SHOT_W, height: SHOT_H });
    return fillCoverWith(layer, PART_SHOT, { margin: MARGIN.work });
  });

const bakedWorkCover = async (baked) => {
  const image = new Image();
  image.src = baked;
  await image.decode();
  const { canvas, context } = matteCanvas(SHOT_W, SHOT_H);
  context.drawImage(image, 0, 0, SHOT_W, SHOT_H);
  return encodePng(canvas);
};

const workPayload = (work) => {
  if (!work.state) return { modules: work.modules };
  return work.standIn ? { ...work.state, standIn: true } : work.state;
};

const workCoverShot = async ({ request, files, stage }) => {
  const work = files.length ? JSON.parse(textOf(files[0].bytes)) : null;
  const kind = String(work?.kind || "");
  if (!kind || !(work.state || work.modules)) return null;
  if (kind === "water") return seaShot(request?.sea || null, JSON.stringify(work.state || {}));

  const { oven, loaders } = await gather("oven", "loaders");
  const Cover = loaders.coverComponent(kind);
  if (!Cover) return null;
  const state = JSON.stringify(workPayload(work));
  const key = `catalog-work:${kind}:${state.length}:${state.slice(0, 64)}:${Date.now()}`;
  const baked = await oven.bakeCover(
    key,
    { kind, projectId: "", state },
    { width: SHOT_W, height: SHOT_H, ratio: 1 },
    { priority: 1 },
  );
  return baked ? bakedWorkCover(baked) : layoutWorkCover(stage, Cover, kind, state);
};

// ---------- трассеры и ядро эффектов ----------

const tracerMaker = async (request) => {
  const { fxClips, fxFrames } = await gather(...(request.fxClip ? ["fxClips"] : ["fxFrames"]));
  const draw = request.fxClip ? fxClips.fxTracerClip : fxFrames.fxTracerCover;
  return (args) => draw({ ...args, view: request.fxView || "side" });
};

const tracerOutcome = (request, files) =>
  attempt(
    async () => {
      const make = await tracerMaker(request);
      const [first] = files;
      if (!first) return { reason: SAY.tracerEmpty };
      if (first.name !== TRACER_CODE) return make({ dds: first.bytes });
      const { workTransfer } = await gather("workTransfer");
      const read = await workTransfer.readWorkCode(textOf(first.bytes), { accept: ["tracer"] });
      const profile = projectOfRead(read)?.tracer?.profiles?.[0];
      if (!profile) return { reason: SAY.tracerNoProfile };
      const tracer = Object.fromEntries(TRACER_FIELDS.map((field) => [field, profile[field]]));
      return make({ tracer, off: profile.off === true });
    },
    (error) => ({ reason: SAY.crash + errorText(error) }),
  );

const missFx = (out) => ({ png: null, fxReason: out.reason, work: null });

const TRACER_FINISH = {
  clip: (out) =>
    out.bytes
      ? { png: out.poster, clip: out, framed: true, note: out.note || "", work: null }
      : missFx(out),
  frame: (out) => (out.png ? { ...out, framed: out.framed || true, work: null } : missFx(out)),
};

const tracerShot = async ({ request, files }) => {
  if (request.fx !== true) return { png: null, work: null };
  return TRACER_FINISH[request.fxClip ? "clip" : "frame"](await tracerOutcome(request, files));
};

const coreShot = async ({ request, files }) => {
  if (request.fx !== true) return { png: null, work: null };
  const { coreCover } = await gather("coreCover");
  const card = coreCover.coreCardOf(files);
  const out = card
    ? await attempt(
        () => gather("fxFrames").then(({ fxFrames }) => fxFrames.fxCoreCover({ card })),
        (error) => ({ reason: SAY.crash + errorText(error) }),
      )
    : { reason: SAY.coreNoCard };
  return out.png ? { ...out, framed: out.framed || true, work: null } : missFx(out);
};

// ---------- арена ----------

// Часть проекта для сервера: проект арен хранит настройки по серверам.
const serverPart = (project, server) =>
  [project?.servers?.[server], project?.arenas?.[server], project?.[server], project].find(
    (part) => part && typeof part === "object",
  );

const ARENA_DEFAULTS = () => ({
  server: undefined,
  outside: false,
  hidden: [],
  hall: false,
  hallOutside: false,
  star: null,
  cover: null,
  coverPool: null,
  frames: null,
  candidates: null,
  take: 6,
});

const prepareArena = async (files) => {
  const first = await gather("starFrames");
  const settingsFile = byName(files, "arena.json");
  if (!settingsFile) return null;
  const cfg = withDefaults(ARENA_DEFAULTS(), JSON.parse(textOf(settingsFile.bytes)));
  const taken = HALL_FILES.map(([flag, name]) => (cfg[flag] ? byName(files, name) : undefined));
  const blanks = blankSet(cfg.hidden);
  const sheets = sheetTable(files, (file) => file.name !== "arena.json" && !taken.includes(file));
  const kit = {
    ...first,
    ...(await gather(
      "sceneTextures",
      "sceneSnapshot",
      "sceneAsset",
      "arenasContract",
      "arenaText",
      "finishTextures",
    )),
    ...(await gather("hallLight", "frameScore")),
  };
  const { server } = cfg;
  const contract = kit.arenasContract;
  const inside = contract.arenaScene(server, "inside");
  if (!inside) return null;

  const project = blankedArenaProject(
    contract.normalizeArenasProject({ ...contract.createArenasProject(), server }),
    server,
    blanks,
  );
  const part = serverPart(project, server);
  const finishes = Object.fromEntries(
    SURFACES.map((surface) => [surface, kit.finishTextures.finishTextureNow(part?.[surface])]),
  );
  const inventory = contract.arenaServerInventory(server);
  const normal = inventory?.decal?.normal || [0, -1, 0];
  const [hall, facade] = taken.map((file) =>
    file ? URL.createObjectURL(new Blob([file.bytes])) : null,
  );
  return {
    cfg,
    kit,
    blanks,
    sheets,
    project,
    finishes,
    eyeView: inventory?.view?.inside || DEFAULT_EYE,
    course: Math.atan2(normal[0], -normal[1]) + 0.35,
    urls: { hall, facade, inside: hall || inside.url },
  };
};

// Камера и съёмка: общие шаги кадра изнутри, мелкого замера и отбора поз.
const cameraRig = (arena) => {
  const { kit, blanks, project, finishes, eyeView, course, urls } = arena;
  const { server } = arena.cfg;
  const { snapshotScene } = kit.sceneSnapshot;
  const { HALL_PASSES, hallDaylight, hallExposure, meanLuminance } = kit.hallLight;

  const insideFrame = (turn) => (asset) => ({
    bounds: asset.bounds,
    ground: false,
    inside: {
      ...eyeView,
      yaw: eyeView.yaw + turn.yaw,
      pitch: (eyeView.pitch || 0) + turn.pitch,
      fov: 72,
    },
    lighting: "interior",
  });
  const poseFrame = ({ eye, yaw, pitch, fov }) => (asset) => ({
    bounds: asset.bounds,
    ground: false,
    inside: { eye, yaw, pitch: pitch || 0, fov: fov || 72 },
    lighting: "interior",
  });
  const facadeFrame = (view) => (asset) => ({
    bounds: (asset.parts.find((part) => part.id === "facade") || asset).bounds,
    ground: true,
    view: { ...view, yaw: course + view.yaw },
  });

  const hallLook = (_index, info) => ({
    colour: info.colour,
    ...whenDo(info.emissive, () => ({
      emission: info.glow > 0 ? kit.arenaText.glowEmission(info.glow) : 0.75,
    })),
  });
  const sceneLook = async (url) => {
    const hidden = blankMaterials(await kit.sceneAsset.loadSceneAsset(url), blanks);
    return (index, info) =>
      hidden.has(index)
        ? { colour: info.colour, visible: false }
        : kit.arenaText.arenaFrameLook(project, server, info, { finishes });
  };

  const bigShot = async (url, frame, { look, daylight = null } = {}) =>
    snapshotPng(
      await snapshotScene({
        url,
        look: look || (await sceneLook(url)),
        frame,
        daylight,
        width: SHOT_W,
        height: SHOT_H,
      }),
    );

  const miniShot = async (pose, look, daylight) => {
    const bitmap = await snapshotScene({
      url: urls.inside,
      look,
      daylight,
      frame: poseFrame(pose),
      width: 240,
      height: 160,
    });
    if (!bitmap) return null;
    const { width, height } = bitmap;
    const context = blankCanvas(width, height).getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return { context, width, height };
  };
  const pixelsOf = (shot, area = [0, 0, shot.width, shot.height]) =>
    shot.context.getImageData(...area).data;

  // Замер позы: два мелких кадра подряд, второй уже при уточнённой экспозиции.
  const meter = async (pose, exposure = 1, pass = 0, last = null) => {
    if (pass >= HALL_PASSES) return { shot: last, exposure };
    const shot = await miniShot(pose, hallLook, hallDaylight(exposure));
    if (!shot) return null;
    return meter(pose, hallExposure(meanLuminance(pixelsOf(shot)), exposure), pass + 1, shot);
  };

  const insideShot = async (frameOf) => {
    if (!urls.hall) return bigShot(urls.inside, frameOf);
    const wanted = frameOf(await kit.sceneAsset.loadSceneAsset(urls.hall)).inside;
    const metered = wanted ? await meter(wanted) : null;
    const daylight = hallDaylight(metered ? metered.exposure : 1);
    return bigShot(urls.hall, frameOf, { look: hallLook, daylight });
  };

  const richness = ({ shot }) =>
    kit.frameScore.frameScore(pixelsOf(shot), shot.width, shot.height);
  const richOnes = (poses) =>
    sequentially(poses, async (pose) => {
      const metered = await meter(pose);
      return metered && richness(metered) > RICH_FRAME ? [pose] : [];
    }).then((parts) => parts.flat());

  // Звезда видна, если кадр со звездой заметно отличается от кадра без неё в середине.
  const starVisible = async (metered, pose, model) => {
    const wanted = String(model).toLowerCase();
    const withoutLook = (index, info) =>
      String(info?.name ?? "").toLowerCase() === wanted
        ? { colour: info.colour, visible: false }
        : hallLook(index, info);
    const without = await miniShot(pose, withoutLook, hallDaylight(metered.exposure));
    if (!without) return null;
    const { width, height } = metered.shot;
    const area = [0.3, 0.3, 0.4, 0.4].map((share, at) =>
      Math.round((at % 2 ? height : width) * share),
    );
    return kit.frameScore.starVisibility(pixelsOf(metered.shot, area), pixelsOf(without, area));
  };

  const pickFromPool = async (pool, count, model) => {
    if (!count) return [];
    const scored = await sequentially(pool, async (pose) => {
      const metered = await meter(pose);
      const base = metered && (model ? await starVisible(metered, pose, model) : richness(metered));
      return metered && base !== null ? [{ view: pose, score: base * (pose.weight || 1) }] : [];
    });
    const options = model ? { take: count, gap: 1.5, turn: 0.5, floor: 1.5 } : { take: count };
    return kit.frameScore.pickFrames(scored.flat(), options).map((item) => item.view);
  };

  return {
    insideFrame,
    poseFrame,
    facadeFrame,
    hallLook,
    bigShot,
    insideShot,
    richOnes,
    pickFromPool,
  };
};

const filmArena = async (arena) => {
  const { cfg, kit, eyeView, urls } = arena;
  const { star, cover, coverPool, frames, candidates, take, server } = cfg;
  const rig = cameraRig(arena);
  const hasHall = Boolean(urls.hall);
  const hallTurns = HALL_TURNS.get(server) ?? HALL_TURNS.get("gta5rp");
  const turns = hasHall ? hallTurns : (INSIDE_TURNS.get(server) ?? INSIDE_TURNS.get("gta5rp"));

  // Позы: готовые от главного процесса, затем отобранные из пула.
  const ready = hasHall && Array.isArray(frames) ? frames : [];
  const pooled =
    hasHall && Array.isArray(candidates) && candidates.length > 0
      ? await rig.pickFromPool(candidates, Math.max(0, take - ready.length))
      : [];
  const given = ready.concat(pooled);

  const { STAR_VIEWS, SMALL_STAR, distanceFor, starFrame, starRing } = kit.starFrames;
  const withStar = hasHall && given.length === 0 && star?.at && star.from !== "none";
  const smallStar = withStar && star.size && star.size < SMALL_STAR;
  const smallPoses = smallStar ? await rig.pickFromPool(starRing({ star }), 3, star.model) : [];
  const bigViews = () =>
    STAR_VIEWS.map((view) =>
      starFrame({ star, home: eyeView.eye, ...view, distance: distanceFor(view, star.size) }),
    );
  const bigPoses = withStar && !smallStar ? await rig.richOnes(bigViews()) : [];
  const allPoses = [given, smallPoses, bigPoses].flat();

  const coverPoolReady = hasHall && Array.isArray(coverPool) && coverPool.length > 0;
  const coverPose =
    hasHall && cover?.eye
      ? cover
      : coverPoolReady
        ? ((await rig.pickFromPool(coverPool, 1))[0] ?? null)
        : null;

  const lead = coverPose || allPoses[0];
  const png = await rig.insideShot(
    lead ? rig.poseFrame(lead) : rig.insideFrame(hasHall ? hallTurns[0] : NO_TURN),
  );
  if (!png) return null;

  const outsideShots = async () => {
    const wanted = cfg.outside || urls.facade;
    const scene = wanted ? kit.arenasContract.arenaScene(server, "outside") : null;
    if (!scene) return [];
    const own = urls.facade ? { look: rig.hallLook } : undefined;
    return sequentially(OUTSIDE_VIEWS, (view) =>
      rig.bigShot(urls.facade || scene.url, rig.facadeFrame(view), own),
    );
  };
  const inside = (frameOf) => () => rig.insideShot(frameOf);
  const noPoseTurns = hasHall && allPoses.length === 0 && !coverPose ? turns.slice(1) : turns;
  const jobs = [
    ...(coverPose ? allPoses : allPoses.slice(1)).map((pose) => inside(rig.poseFrame(pose))),
    ...(given.length ? [] : noPoseTurns.map((turn) => inside(rig.insideFrame(turn)))),
    outsideShots,
    ...(hasHall && !given.length ? [inside(rig.insideFrame(NO_TURN))] : []),
  ];
  const shots = await sequentially(jobs, (job) => job());
  return { png, gallery: shots.flat().filter(Boolean) };
};

const arenaShot = async ({ files }) => {
  const arena = await prepareArena(files);
  if (!arena) return null;
  const sheetsOnly = sheetSource(arena.kit.sceneTextures.sheetSourceKey, arena.sheets);
  return withSheetSource(
    arena.kit,
    sheetsOnly,
    () => filmArena(arena),
    () =>
      [arena.urls.hall, arena.urls.facade]
        .filter(Boolean)
        .forEach((url) => URL.revokeObjectURL(url)),
  );
};

// ---------- маршруты по виду части ----------

const framed = (draw) => async (ctx) => {
  const shot = await draw(ctx);
  return { ...(shot instanceof Uint8Array ? { png: shot } : shot || { png: null }), work: null };
};

const ROUTES = new Map(
  Object.entries({
    grass: framed(placesShot("grass")),
    mapping: framed(placesShot("mapping")),
    arenas: framed(arenaShot),
    scene: framed(sceneShot),
    zones: framed(zonesShot),
    "workshop-cover": framed(workCoverShot),
    tracers: tracerShot,
    "core-effects": coreShot,
    "sky-day": skyDayShot,
    "clouds-sky": framed(cloudSkyShot),
    "large-map-vector": framed(bigMapShot),
  }),
);

// Разбор запроса: байты копируются, радар отделяется от файлов части.
const parseRequest = (request) => {
  const sent = (request?.files || []).map(({ name, bytes }) => ({
    name,
    bytes: new Uint8Array(bytes),
  }));
  const radarAt = sent.findIndex((file) => file.name === RADAR_FILE);
  return { files: sent.filter((_, at) => at !== radarAt), radar: sent[radarAt] ?? null };
};

export const partShot = async (request, stage) => {
  const { files, radar } = parseRequest(request);
  const route = ROUTES.get(request?.partKind) || ordinaryShot;
  return route({ request, files, radar, stage });
};

export const renderPartShot = async (request, stage) => (await partShot(request, stage)).png;

// ---------- служба: очередь запросов окна ----------

const describeClip = (clip) => ({
  bytes: toBuffer(clip.bytes),
  width: clip.width,
  height: clip.height,
  duration: clip.duration,
  codec: clip.codec,
});

// Дополнения к ответу в том порядке, в каком их читает главный процесс.
const replyExtras = (shot) => {
  const { work, lossless, lost, refused, rules, need, stills } = shot;
  const { clipError, clip, framed: mark } = shot;
  return Object.assign(
    {},
    work?.code
      ? { work, lossless: lossless === true, lost: lost || [] }
      : when(lost?.length, { lossless: false, lost }),
    when(refused, { refused, rules: rules || [] }),
    when(need, { need }),
    whenDo(stills?.length, () => ({
      stills: stills.map(({ id, hour, caption, bytes }) => ({
        id,
        hour,
        caption,
        bytes: toBuffer(bytes),
      })),
    })),
    when(clipError, { clipError }),
    whenDo(clip, () => ({ clip: describeClip(clip) })),
    when(mark, {
      /* Признаки «автор выключил след» и «попадание автора ничего не рисует» доходят до печи как есть: по ним она подписывает обложку. */
      framed: mark === "tracer-off" || mark === "hit-off" ? mark : true,
      note: String(shot.note || ""),
    }),
    when(shot.fxReason, { fxReason: String(shot.fxReason) }),
  );
};

const replyFor = (shot) => {
  const extras = replyExtras(shot);
  const base = shot.png
    ? { png: toBuffer(shot.png), gallery: (shot.gallery || []).filter(Boolean).map(toBuffer) }
    : { png: null, reason: SAY.nothing, gallery: [] };
  return Object.assign(base, extras);
};

const makeStage = () => {
  const stage = document.createElement("div");
  stage.className = "desktop-app";
  stage.style.cssText = "position:fixed;left:0;top:0;width:1200px;height:800px;overflow:hidden";
  document.body.append(stage);
  return stage;
};

const shotCounter = () => {
  let done = 0;
  globalThis.__astralPartShooterInfo = () => ({ shots: done });
  return () => {
    done += 1;
  };
};

const serialQueue = () => {
  let tail = Promise.resolve();
  return (job) => {
    tail = tail.then(job).catch(() => {});
  };
};

export const servePartShots = (bridge) => {
  const stage = makeStage();
  const countShot = shotCounter();
  const enqueue = serialQueue();
  const answer = async (id, request) => {
    try {
      const reply = replyFor(await partShot(request, stage));
      countShot();
      bridge.reply(id, reply);
    } catch (error) {
      bridge.reply(id, { error: error?.message ?? String(error) });
    }
  };
  bridge.onShoot((id, request) => enqueue(() => answer(id, request)));
  bridge.ready();
};
