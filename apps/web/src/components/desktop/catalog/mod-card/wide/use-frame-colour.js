import { useEffect, useState } from "react";
import { colourOfImage } from "../../../../../features/clothing/colour-mapping.js";
import { coverColourOf } from "../../../../../features/clothing/cover-colour.js";

/*
 * Цвет кадра на сцене вещи (28.10.2026, перенесено в «Пульт» 15.11.2026): кадр раскраски мода — его главная картинка, и «На человеке · 3D» одевает человека этим цветом.
 * Обложка — тоже кадр цвета: на ней нарисована одна из расцветок, какая именно — `coverColourOf` (карточка называет её сама, иначе сличаются краски обложки и кадров;
 * считается в тихую минуту после открытия). Кадр не цвета (ролик, фото) цвет не меняет: помнится последний выбранный. Пусто — первая раскраска.
 */
export function useFrameColour({ mod, current, cover, enabled }) {
  const onCover = enabled && Boolean(cover) && current?.item?.src === cover;
  const [coverColour, setCoverColour] = useState("");
  useEffect(() => {
    if (!onCover) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      coverColourOf(mod, cover).then(
        (letter) => alive && setCoverColour(letter),
      );
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [onCover, cover, mod]);
  const frameColour = enabled
    ? colourOfImage(mod, current?.item?.src) || (onCover ? coverColour : "")
    : "";
  const [picked, setPicked] = useState("");
  useEffect(() => {
    if (frameColour) setPicked(frameColour);
  }, [frameColour]);
  return onCover ? frameColour : picked || frameColour;
}
