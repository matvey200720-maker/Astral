import { useEffect, useState } from "react";
import { WorkshopImage } from "../../../WorkshopMedia.jsx";

/*
 * Обложка установленного мода в плитке редактора (ТЗ 44А, п. 0, 20.10.2026): «Арены — Арена GTA 5 RP excellent» стояла
 * чёрным прямоугольником. Картинка мода из каталога может не приехать (CDN, обрыв) или оказаться чёрной пустышкой, и
 * плитка тогда ничего не показывала. Теперь такая картинка уступает место обложке самого редактора (`fallback`:
 * штатный кадр зала или снимок работы), а не чернильной плашке.
 */

/** Чёрная или прозрачная пустышка: все пиксели почти чёрные и непрозрачные, либо полностью прозрачные. Не читается — не пустышка. */
export function imageIsBlank(image) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || !image.naturalWidth) return false;
    context.drawImage(image, 0, 0, 16, 16);
    const { data } = context.getImageData(0, 0, 16, 16);
    let dark = true;
    let clear = true;
    for (let at = 0; at < data.length; at += 4) {
      if (data[at + 3] > 10) clear = false;
      if (data[at + 3] < 200 || data[at] > 14 || data[at + 1] > 14 || data[at + 2] > 14) dark = false;
      if (!dark && !clear) return false;
    }
    return dark || clear;
  } catch {
    /* Чужая картинка без CORS не читается — судить о ней нельзя. */
    return false;
  }
}

export default function InstalledPreview({ src, fallback, className = "", index = 0 }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (broken || !src) return fallback;
  return (
    <WorkshopImage
      className={className}
      src={src}
      alt=""
      index={index}
      onError={() => setBroken(true)}
      onLoad={(event) => {
        if (imageIsBlank(event.currentTarget)) setBroken(true);
      }}
    />
  );
}
