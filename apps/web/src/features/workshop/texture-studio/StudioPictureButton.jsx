/*
 * «Студия» рядом с загрузкой картинки (ТЗ 18.10.2026, Session 1, задача 6) —
 * для органов, что держат картинку в хранилище эмблем окна
 * (`saveHangarEmblem`, ключ `hangar-emblem:<sha256>`): баннер и щит здания,
 * полотна арены, флаги, дирижабли. Итог студии идёт тем же путём, что и
 * загруженный файл: приводится к безопасному виду (≤ 2048 px по длинной
 * стороне — о том, во что превратился холст, сказано человеку), кладётся в
 * хранилище и становится картинкой места (`onImage`).
 *
 * `getSurface()` — холст места (`TextureStudio.jsx`: `id`, `title`, `width`,
 * `height`, `base`, `baseColour`, `panels`, `view3d`, `placeLabel`);
 * `image` — что стоит на месте сейчас (студия берёт её слоем поверх основы).
 */

import { saveHangarEmblem, convertedImageText } from "../hangar-editor/hangar-emblem.js";
import StudioEntry from "./StudioEntry.jsx";

export default function StudioPictureButton({ getSurface, image = null, onImage, onNotice = null, save = saveHangarEmblem, slug = "studio", label = "", caption = "", disabled = false, variant = "secondary" }) {
  const name = String(slug).replace(/[^a-zA-Z0-9_-]+/g, "-");
  return (
    <StudioEntry
      label={label}
      caption={caption}
      variant={variant}
      disabled={disabled}
      onNotice={(text, tone) => onNotice?.(text, tone)}
      getSurface={async () => {
        const surface = await getSurface();
        return { slug: name, current: image?.asset ? { asset: image.asset } : null, ...surface };
      }}
      onPlace={async (blob) => {
        const type = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png";
        const file = typeof File === "function" ? new File([blob], `${name}.${type}`, { type: blob.type }) : Object.assign(blob, { name: `${name}.${type}` });
        const { converted, ...saved } = await save(file);
        onImage(saved);
        if (converted) onNotice?.(convertedImageText(converted), "info");
        return { asset: saved.asset };
      }}
    />
  );
}
