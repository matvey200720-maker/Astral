/*
 * Ролик эффекта на странице части (27.10.2026, владелец: «на странице такой части — небольшой проигрыватель: человек зажимает стрельбу из
 * карабина, и эффект редукса в кадре»).
 *
 * Те же кадры игры с глубиной и тот же движок сцены (`createFrameStage`), что у обложки (`fx-frame-cover.js`): очередь карабина по темпу ствола
 * (`rpm` сцены, магазин), эффект автора ложится на каждый выстрел. Рисованной сцены и модели персонажа нет — только кадр GTA V.
 *
 *   hit    — сцена «в тело, вблизи, от третьего лица»: очередь по цели, эффект зоны «тело» автора на каждом попадании;
 *   tracer — сцена «сбоку»: очередь, след автора (профиль мастерской или картинка слоя) летит от дула к веерной раскладке попаданий;
 *   kill   — серия кадров килла («до / смерть / падает / лежит»), экранный эффект автора по шкале времени проекта (`killEffectFrame`).
 *
 * Кодирует окно: WebCodecs (`VideoEncoder`, VP9, иначе VP8) и WebM-писатель `@modovik/gfx/webm`, кадр за кадром, не в реальном времени — как
 * ролик суток таймцикла (`sky-clip.js`). 960×540, 24 к/с, без звука: лёгкий файл (~1 МиБ), на карточке играет без звука по нажатию.
 */

import { createWebmWriter } from "@modovik/gfx/webm";
import { impactZoneSprites } from "../../../components/desktop/workshop/impact-sim.js";
import { createFrameStage } from "../../workshop/fx-frame/frame-stage.js";
import { debugDump, debugEnabled, emptySlot, loadBase, loadScene, profileSlot, settle, slotOf } from "./fx-frame-cover.js";
import { pickCodec } from "./sky-clip.js";

/** Размер, частота и длительность ролика (по виду). Потолок файла — `catalogV2Limits.clipBytes`. */
export const FX_CLIP = Object.freeze({
  width: 960,
  height: 540,
  fps: 24,
  seconds: Object.freeze({ hit: 4, tracer: 4, kill: 3.5 }),
  /* Ключевой кадр раз в две секунды: перемотка по ползунку не ждёт далёкого ключа. */
  keyEvery: 48,
  bitrate: 900_000,
});

/* Прогрев перед съёмкой: лист частицы грузится, только когда её впервые нарисовали. */
const WARM_SECONDS = 1.5;
const STEP = 1 / 60;

let recorded = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pngOf(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Кодирует `frames` кадров: `paint(index, context)` рисует кадр в холст ролика. Ответ — `{ bytes, width, height, duration, frames, codec,
 * poster }` (`poster` — PNG кадра `posterAt`) или `{ reason }`, если окно не умеет кодировать видео.
 */
export async function recordClip({ kind, paint, posterAt = 0.5, spec = FX_CLIP }) {
  const { width, height, fps, keyEvery, bitrate } = spec;
  const seconds = spec.seconds[kind];
  const picked = await pickCodec({ width, height, fps, bitrate });
  if (!picked) return { reason: "окно не умеет кодировать видео — ролика нет" };
  const frames = Math.round(fps * seconds);
  recorded += 1;
  const writer = createWebmWriter({ width, height, codec: picked.id, frameRate: fps });
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      writer.add({ data, timestampMs: chunk.timestamp / 1000, keyFrame: chunk.type === "key" });
    },
    error: (error) => {
      failure = error;
    },
  });
  encoder.configure(picked.config);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const posterFrame = Math.min(frames - 1, Math.max(0, Math.round(frames * posterAt)));
  let poster = null;
  /* Отладка (`ASTRAL_FX_COVER_DEBUG`): четыре кадра ролика в папку — посмотреть глазами, не открывая WebM. */
  const looks = (await debugEnabled()) ? new Set([0, 0.25, 0.5, 0.75, 0.95].map((share) => Math.min(frames - 1, Math.round(frames * share)))) : null;
  try {
    for (let index = 0; index < frames; index += 1) {
      if (failure) throw failure;
      await paint(index, context);
      if (index === posterFrame) poster = await pngOf(canvas);
      if (looks?.has(index)) await debugDump(`clip${recorded}-${kind}-${String(index).padStart(3, "0")}.png`, canvas);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((index * 1e6) / fps), duration: Math.round(1e6 / fps) });
      try {
        encoder.encode(frame, { keyFrame: index % keyEvery === 0 });
      } finally {
        frame.close();
      }
      /* Очередь кодировщика не растёт без предела: ждём, пока он разгребёт. */
      if (encoder.encodeQueueSize > 6) await new Promise((resolve) => encoder.addEventListener("dequeue", resolve, { once: true }));
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  const bytes = writer.finish({ durationMs: Math.round((frames * 1000) / fps) });
  return { bytes, width, height, duration: frames / fps, frames, codec: picked.id, poster };
}

/**
 * Сцена очереди: холст WebGL сцены копируется в холст ролика сразу после рисования (WebGL-буфер не хранится). `zones` — зоны автора
 * (попадания), `slot` — слот следа (трассер).
 */
async function openClipStage({ frame, base, zones = null, slot = null, target, window = null }) {
  const canvas = document.createElement("canvas");
  let copy = null;
  const stage = createFrameStage({
    canvas,
    share: false,
    deterministic: true,
    single: false,
    sprites: (zoneId, settings) => impactZoneSprites(zoneId, settings, null),
    onDraw: (gl) => {
      if (!copy) return;
      if (window) copy.drawImage(gl, window.left, window.top, window.width, window.height, 0, 0, target.width, target.height);
      else copy.drawImage(gl, 0, 0, target.width, target.height);
    },
  });
  const { width, height } = frame.scene.resolution;
  stage.resize(width, height, 1);
  stage.setBase(base);
  if (zones) stage.setZones(zones, Object.keys(zones));
  if (slot) stage.setSlot(slot);
  stage.setFrame(frame);
  await settle(stage);
  /* Прогрев: очередь играется вхолостую дважды, листы частиц дожидаются. */
  for (let pass = 0; pass < 2; pass += 1) {
    stage.shoot();
    stage.drawNow();
    for (let k = 1; k <= Math.round(WARM_SECONDS / STEP); k += 1) stage.advance(STEP);
    await settle(stage);
  }
  return {
    get ready() {
      return stage.ready;
    },
    get failures() {
      return stage.zoneFailures;
    },
    /** Очередь с начала: `index`-й кадр ролика — время `index / fps`. */
    play({ fps }) {
      stage.shoot();
      return (index, context) => {
        copy = context;
        if (index > 0) stage.advance(1 / fps);
        stage.drawNow();
        copy = null;
      };
    },
    dispose: () => stage.dispose(),
  };
}

const frameSize = (spec) => ({ width: spec.width, height: spec.height });

/**
 * Окно сцены трассера: кадр сцены 1920 × 1080, а след — пять сантиметров толщиной, на ролике 960 × 540 целиком он не виден. Берётся половина кадра
 * один к одному (без сжатия): стрелок слева, дуло на четверти окна, след летит вправо вдоль пути пули.
 */
export function tracerWindow(resolution, muzzle, target = null, view = "side", spec = FX_CLIP) {
  if (view === "third" && target) {
    /* От третьего лица камера за спиной стрелка, след уходит вглубь к цели: окно по середине пути, ужато (след короткий на экране). */
    const width = Math.min(resolution.width, Math.round(spec.width * 0.7));
    const height = Math.round((width * spec.height) / spec.width);
    const cx = ((muzzle[0] + target[0]) / 2) * resolution.width;
    const cy = ((muzzle[1] + target[1]) / 2) * resolution.height;
    return { left: Math.min(Math.max(Math.round(cx - width / 2), 0), resolution.width - width), top: Math.min(Math.max(Math.round(cy - height / 2), 0), resolution.height - height), width, height };
  }
  const width = Math.min(resolution.width, spec.width);
  const height = Math.min(resolution.height, spec.height);
  const left = Math.min(Math.max(Math.round(muzzle[0] * resolution.width - width * 0.22), 0), resolution.width - width);
  const top = Math.min(Math.max(Math.round(muzzle[1] * resolution.height - height * 0.5), 0), resolution.height - height);
  return { left, top, width, height };
}

/** Попадания: очередь карабина по цели, эффект зоны «тело» автора на каждом попадании. `zone` — настройки зоны (`coverBodyZone`). */
export async function fxHitClip({ zone }) {
  const [base, loaded] = await Promise.all([loadBase(), loadScene({ mode: "hit", bone: "chest", view: "third", distance: "close" })]);
  if (!base?.tracerScene?.exports?.length) return { reason: "правил эффектов из игры нет (--game, --keys)" };
  if (!loaded) return { reason: "в наборе нет сцены попадания «в тело, вблизи»" };
  const stage = await openClipStage({ frame: loaded.frame, base, zones: { body: zone }, target: frameSize(FX_CLIP) });
  try {
    if (!stage.ready) return { reason: "правила частиц игры не собрались" };
    if (stage.failures.length) return { reason: `слой эффекта не собрался: ${stage.failures[0]}` };
    const play = stage.play(FX_CLIP);
    const clip = await recordClip({ kind: "hit", paint: play, posterAt: 0.35 });
    return clip.bytes ? { ...clip, note: `${loaded.entry.id} · ролик ${clip.duration} с` } : clip;
  } finally {
    stage.dispose();
  }
}

/** Трассеры: очередь карабина сбоку, след автора (профиль мастерской — `tracer`, картинка слоя — `dds`) летит от дула к веерной раскладке попаданий. */
export async function fxTracerClip({ tracer = null, dds = null, off = false, view = "side" }) {
  const [base, loaded] = await Promise.all([loadBase(), loadScene({ mode: "tracer", view })]);
  if (!base?.tracerScene?.exports?.length) return { reason: "правил эффектов из игры нет (--game, --keys)" };
  if (!loaded) return { reason: "в наборе нет сцены трассера" };
  const slot = off ? emptySlot(base) : tracer ? profileSlot(tracer) : dds ? slotOf(dds, base) : null;
  if (!slot) return { reason: "в части нет ни профиля, ни картинки следа" };
  const { scene } = loaded.frame;
  const window = tracerWindow(scene.resolution, scene.muzzle.screen, scene.target?.screen, view);
  const stage = await openClipStage({ frame: loaded.frame, base, slot, target: frameSize(FX_CLIP), window });
  try {
    if (!stage.ready) return { reason: "правила следа игры не собрались" };
    const play = stage.play(FX_CLIP);
    const clip = await recordClip({ kind: "tracer", paint: play, posterAt: 0.3 });
    return clip.bytes ? { ...clip, note: `${loaded.entry.id} · ролик ${clip.duration} с${off ? " · вспышка без следа" : ""}` } : clip;
  } finally {
    stage.dispose();
  }
}

/**
 * Килл: серия кадров килла и экранный эффект автора по шкале проекта. `paint({ context, width, height, scene, elapsedMs })` рисует кадр эффекта
 * (`elapsedMs` — миллисекунды после убивающего выстрела); до выстрела (полсекунды) эффекта нет — чистый кадр «до».
 */
export async function fxKillClip({ paint }) {
  const loaded = await loadScene({ mode: "kill", view: "third" });
  if (!loaded?.frame.frames?.length) return { reason: "в наборе нет серии кадров килла" };
  const { frame, entry } = loaded;
  const series = frame.frames;
  const { width, height } = frameSize(FX_CLIP);
  const scene = document.createElement("canvas");
  scene.width = width;
  scene.height = height;
  const sceneContext = scene.getContext("2d");
  sceneContext.imageSmoothingQuality = "high";
  const effect = document.createElement("canvas");
  effect.width = width;
  effect.height = height;
  /* Убивающий выстрел — через полсекунды после начала: сначала кадр «до», потом серия идёт по `offsetMs`. */
  const SHOT_AT_MS = 500;
  const fps = FX_CLIP.fps;
  const clip = await recordClip({
    kind: "kill",
    posterAt: 0.55,
    paint: async (index, context) => {
      const elapsed = Math.max(0, (index * 1000) / fps - SHOT_AT_MS);
      let at = 0;
      series.forEach((item, i) => {
        if (item.offsetMs <= elapsed) at = i;
      });
      sceneContext.drawImage(series[at].image, 0, 0, width, height);
      if ((index * 1000) / fps < SHOT_AT_MS) context.drawImage(scene, 0, 0, width, height);
      else {
        paint({ context: effect.getContext("2d"), width, height, scene, elapsedMs: elapsed });
        context.drawImage(effect, 0, 0, width, height);
      }
      await sleep(0);
    },
  });
  return clip.bytes ? { ...clip, note: `${entry.id} · ролик ${clip.duration} с` } : clip;
}
