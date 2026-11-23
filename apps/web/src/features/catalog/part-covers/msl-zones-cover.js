/*
 * Обложка «МСЛ-зон» редукса — готовая картинка зон из мастерской (владелец, 12.11.2026: «пусть возьмёт просто превьюшку с мастерской зоны MCL…
 * они все одинаковые»). МСЛ-зоны у авторов — одни и те же линии районов: кадр моделей автора на тёмной сцене давал то красный цилиндр, то пустой
 * кадр с пунктиром, а кадр обзора ролика к зонам отношения не имеет. Плитка мастерской (`MslZonesCover.jsx`) рисует линии района «Центр» сверху из
 * сцены описи — её же, тем же рисовальщиком и в размере обложки каталога, берёт печь.
 */
import { MSL_ZONES_INVENTORY, createMslZonesProject } from "@modovik/climb-contract/recolor/msl-zones";
import { loadSceneAsset } from "../../workshop/model-stage/scene-asset.js";
import { mslZonesImage } from "../../workshop/msl-zones-editor/msl-zones-art.js";

/* Размер плитки мастерской: линии района рисуются в её толщине, а обложка каталога увеличивает готовый слой (в размере обложки линии выходили в точку). */
const TILE = Object.freeze({ width: 400, height: 170 });

/** Слой зон «как в моде» — холст плитки мастерской на прозрачном поле; `null`, если сцена описи не приехала. Фон обложки кладёт вызывающий. */
export async function mslZonesLayer() {
  const asset = await loadSceneAsset(MSL_ZONES_INVENTORY.scene.url);
  const url = mslZonesImage(asset, "city", createMslZonesProject(), TILE);
  if (!url) return null;
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d").drawImage(image, 0, 0);
  return canvas;
}
