/*
 * Петля «смена суток» для карточки таймцикла (25.10.2026, владелец: «таймцикл:
 * видео на превью»).
 *
 * На карточке части редукса «Таймцикл» сразу крутится видео — сутки неба мода
 * от утра до утра: рассвет, день, закат, ночь. Видео всегда грузится вместе с
 * карточкой (`media.video`, см. `@modovik/publishing`, `media.js`), поэтому оно
 * короткое и лёгкое: 8 секунд, 960×640, VP9 в WebM, без звука.
 *
 * Кадры рисует тот же шейдер неба, что обложка и редактор
 * (`skyHourFrames`, `SkyCover.jsx`): небо мода над нарисованным городом
 * мастерской. Это не кадр из игры, и подпись видео говорит об этом прямо
 * (`SERVER_CAPTIONS["part-sky-clip"]`). Квартал из игры (Davis Mega Mall,
 * `timecycle-block/`) сюда не берётся: его читают из установленной GTA V через
 * мост Astral Desktop, а выпуск каталога снимает окно без игры.
 *
 * Кодирует сам браузер — WebCodecs (`VideoEncoder`), а контейнер WebM пишет
 * `@modovik/gfx/webm`: ffmpeg на машине выпуска не нужен. Кадр за кадром, не
 * в реальном времени: скрытое окно без `requestAnimationFrame` кодирует
 * так же, как открытое. Сам кодек — VP9, а если окно его не умеет — VP8.
 *
 * Время идёт неравномерно (`clipHours`): рассвет и закат — медленно, там небо
 * меняется быстрее всего, глухая ночь и полдень — быстро. Сутки замкнуты, и
 * последний кадр переходит в первый: петля шва не имеет.
 */

import { createWebmWriter } from "@modovik/gfx/webm";
import { skyHourFrames } from "../../workshop/covers/SkyCover.jsx";
import { DAY_CLIP, SKY_CLIP, SKY_STILLS, clipHours } from "./sky-clip-plan.js";

export { DAY_CLIP, SKY_CLIP, SKY_STILLS, clipHours };

/** Кодек, который окно умеет, или `null`: VP9, иначе VP8. */
export async function pickCodec({ width, height, fps, bitrate }) {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined")
    return null;
  for (const [codec, id] of [
    ["vp09.00.10.08", "V_VP9"],
    ["vp8", "V_VP8"],
  ]) {
    const config = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      bitrateMode: "variable",
      latencyMode: "quality",
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support?.supported) return { config: support.config || config, id };
    } catch {
      /* этот кодек окно не знает — следующий */
    }
  }
  return null;
}

/**
 * Петля неба мода. `project` — проект неба (`cover.state` разбора) или `null`
 * (штатное небо). Возвращает `{ bytes, width, height, duration, frames, codec }`
 * или `null`, если окно не умеет кодировать видео. На кадре ничего не нарисовано:
 * ни часов, ни подписей (владелец, 28.10.2026, «без подписей на превью»).
 */
export async function skyClip(project, options = {}) {
  const spec = { ...SKY_CLIP, ...options };
  const { width, height, fps, seconds } = spec;
  const picked = await pickCodec(spec);
  if (!picked) return null;
  const frames = Math.round(fps * seconds);
  const writer = createWebmWriter({ width, height, codec: picked.id, frameRate: fps });
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      writer.add({
        data,
        timestampMs: chunk.timestamp / 1000,
        keyFrame: chunk.type === "key",
      });
    },
    error: (error) => {
      failure = error;
    },
  });
  encoder.configure(picked.config);
  try {
    await skyHourFrames(
      project,
      { hours: clipHours(frames, spec.startHour), size: { width, height }, weather: options.weather },
      async (canvas, _hour, index) => {
        if (failure) throw failure;
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((index * 1e6) / fps),
          duration: Math.round(1e6 / fps),
        });
        try {
          encoder.encode(frame, { keyFrame: index % spec.keyEvery === 0 });
        } finally {
          frame.close();
        }
        /* Очередь кодировщика не растёт без предела: ждём, пока он разгребёт. */
        if (encoder.encodeQueueSize > 6)
          await new Promise((resolve) =>
            encoder.addEventListener("dequeue", resolve, { once: true }),
          );
      },
    );
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  const bytes = writer.finish({ durationMs: Math.round((frames * 1000) / fps) });
  return {
    bytes,
    width,
    height,
    duration: frames / fps,
    frames,
    codec: picked.id,
  };
}

/**
 * Три кадра галереи — утро, день, вечер — тем же шейдером, `size` — как у
 * обложки. WebP: небо — плавные градиенты, и он втрое легче PNG.
 * @returns {Promise<{ id: string, hour: number, caption: string, bytes: Uint8Array }[]>}
 */
export async function skyStills(project, size, quality = 0.9, weather = null) {
  const out = [];
  await skyHourFrames(
    project,
    { hours: SKY_STILLS.map((still) => still.hour), size, weather },
    async (canvas, _hour, index) => {
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      if (!blob?.size) throw new Error("Кадр неба не снялся.");
      out.push({
        ...SKY_STILLS[index],
        bytes: new Uint8Array(await blob.arrayBuffer()),
      });
    },
  );
  return out;
}

/**
 * Ролик суток таймцикла: 12:00 → 12:00, 24 с, 20 к/с, без часов и подписей (`DAY_CLIP`). Тот же ракурс, город и длительность у всех таймциклов;
 * погода — основная погода проекта автора (`skySpec`). `null` — окно не умеет кодировать видео.
 */
export function dayClip(project, options = {}) {
  return skyClip(project, { ...DAY_CLIP, ...options });
}
