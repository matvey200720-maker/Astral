import { coverFor, hasOwnCover, isEffectMod, isTimecycleMod } from "../../../../utils/catalogMedia.js";

/*
 * Кадры мода на сцене варианта В («Просмотр», ТЗ 29.10.2026-b): только то, что у мода настоящее — своя обложка, его кадры и галерея, ролик. Придуманных
 * картинок нет: у мода без своей обложки (`hasOwnCover`) кадров нет вовсе, и сцена говорит об этом словами (`CLAUDE.md`: нечего честно показать — не ставить кадр).
 *
 * Порядок: обложка первой (на сцене до нажатия — она), потом кадры, потом ролик. Ролик играет только на сцене выбранного мода и по нажатию (`docs/3D.md`, п. 31);
 * в списке — постеры.
 *
 * Кадр: `{ key, type: "image" | "clip" | "video", src, poster, bytes, loop, silent, effect, name }`; у «clip» и «video» `poster` — картинка для ленты и до нажатия.
 */

/** Адрес картинки записи медиа: строка или `{ src | url }`. */
const srcOf = (item) => (typeof item === "string" ? item : item?.src || item?.url || "");

export function sceneFrames(mod) {
  const frames = [];
  const seen = new Set();
  const add = (frame) => {
    if (!frame.src || seen.has(frame.src)) return;
    seen.add(frame.src);
    frames.push(frame);
  };
  const cover = hasOwnCover(mod) ? coverFor(mod) : "";
  /* Постер ролика: его собственный, иначе обложка — но обложка не повторяется вторым кадром ленты. */
  const posterOf = (item) => item?.poster || cover || "";

  if (cover) add({ key: `cover:${cover}`, type: "image", src: cover, poster: cover });
  for (const item of mod.media || []) {
    const src = srcOf(item);
    if (!src) continue;
    if ((item?.type || "image") === "video") continue;
    add({ key: `media:${src}`, type: "image", src, poster: src });
  }
  /* Лист «суток» таймцикла (`domain.timecycle.cycle`) — не кадр, а кадры для проигрывателя суток: на сцену он не встаёт. */
  const cycleHash = mod.domain?.timecycle?.cycle?.sha256 || "";
  for (const item of mod.gallery || []) {
    const src = srcOf(item);
    if (cycleHash && src.includes(cycleHash)) continue;
    add({ key: `gallery:${src}`, type: "image", src, poster: src });
  }
  /* Ролик со звуком, сутки таймцикла, очередь эффекта — `mod.clip`; петля и ролики поста — `mod.video(s)`. */
  if (mod.clip?.src) {
    add({
      key: `clip:${mod.clip.src}`,
      type: "clip",
      src: mod.clip.src,
      poster: posterOf(mod.clip),
      bytes: Number(mod.clip.bytes) || 0,
      silent: isTimecycleMod(mod) || isEffectMod(mod),
      effect: isEffectMod(mod),
    });
  }
  const videos = [...(mod.videos || []), ...(mod.video ? [mod.video] : [])];
  for (const item of videos) {
    const src = srcOf(item);
    add({
      key: `video:${src}`,
      type: "video",
      src,
      poster: posterOf(item),
      bytes: Number(item?.bytes) || 0,
      loop: Boolean(item?.loop),
    });
  }
  return frames;
}

/** Номер первого ролика в кадрах — на него встаёт сцена по нажатию ▶ на обложке; −1, если роликов нет. */
export const firstClipIndex = (frames) => frames.findIndex((frame) => frame.type === "clip" || frame.type === "video");
