import { useState } from "react";
import TileThumbImg from "../../components/ui/TileThumbImg.jsx";
import WorkCover from "../workshop/works/WorkCover.jsx";

/*
 * Картинка мода человека — одна на сборки, окно новой сборки и полку
 * (задачи 2–4 ТЗ 08.10, вечер).
 *
 * Мод каталога — его настоящая обложка (`modPicture` в `my-mods.js`: своя,
 * кадр галереи или запомненная). Работа мастерской — та же обложка, что на
 * полке мастерской и в «Моих работах»: сама работа, нарисованная из снимка
 * поставленного (`WorkCover`). Картинки нет вовсе — плашка с названием мода:
 * честнее, чем чужой кадр, выданный за этот мод.
 */
export default function MyModPicture({ item, index = 0, tile = null }) {
  const [failed, setFailed] = useState(false);
  /* Фото проявляется, когда доехало (лента новой сборки), — без рывка. */
  const [loaded, setLoaded] = useState(false);
  if (!item) return null;
  if (item.kind === "work")
    return <WorkCover work={item.work} index={index} />;
  if (item.picture && !failed)
    return (
      <TileThumbImg
        className={loaded ? "is-loaded" : undefined}
        src={item.picture}
        tile={tile}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    );
  return (
    <span className="my-mod-plate" aria-hidden="true">
      {initialsOf(item.name)}
    </span>
  );
}

/* Две первые буквы названия: «DRAGON Minimap» → «DM». */
export function initialsOf(name = "") {
  const words = String(name)
    .replace(/[«»"'()[\]]/g, " ")
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (!words.length) return "·";
  return words
    .slice(0, 2)
    .map((word) => [...word].find((char) => /[\p{L}\p{N}]/u.test(char)))
    .join("")
    .toUpperCase();
}
