/*
 * Вид кадра «Групповых меток»: улица из игры, откуда смотрит глаз и где висит метка, расстояния.
 *
 * Сцена улицы — `group-markers-scenes.js` (его пишет `scripts/prepare-group-markers-scene.mjs`): круг земли, дорог
 * и домов вокруг точки под меткой; начало сцены — эта точка на земле, Z вверх, метры, как у игры. Глаз стоит на
 * тротуаре на высоте человека, метка висит над улицей перед ним: на снимке владельца она над дорогой в нескольких
 * десятках метров. За кругом — чёрная пустота, край круга гаснет (`edge`: радиус и полоса, метры от точки под меткой).
 */

import SCENES from "./group-markers-scenes.js";
import { tr } from "../../../locales/ui.js";

const STREET = SCENES.streets[0];

/* Расстояния до метки, как над миром в игре: ближе — крупнее, дальше — мельче. */
export const GROUP_MARKER_DISTANCES = Object.freeze([25, 62, 150]);
export const GROUP_MARKER_DEFAULT_DISTANCE = 62;

/** «62 м» — подпись расстояния на своём языке. */
export const distanceLabel = (meters) => tr(`${meters} м`);
/** Во сколько раз метка крупнее или мельче, чем на 62 м: корень от отношения расстояний, чтобы не раздувалась и не пропадала. */
export const markScale = (meters) => Math.sqrt(GROUP_MARKER_DEFAULT_DISTANCE / Math.max(5, meters));

/* Глаз и взгляд — из описи улицы (`eye` — точка на земле плюс рост человека, `yaw` — куда смотрит, 0 — на север). */
const [EYE_X, EYE_Y, EYE_Z] = STREET.view.eye;
const YAW = STREET.view.yaw;
const AHEAD = 55;
const HEIGHT = 5;

export const GROUP_MARKER_STREET = Object.freeze({
  id: STREET.id,
  label: STREET.label,
  /* Круг сцены: за `radius` — пустота, полоса `width` внутри него гаснет к чёрному (`ModelStage.edgeFade`). */
  edge: Object.freeze({ shape: "disc", centre: Object.freeze([0, 0]), radius: STREET.reach, width: STREET.fade }),
  url: STREET.scene.url,
  eye: Object.freeze([EYE_X, EYE_Y, EYE_Z]),
  yaw: YAW,
  pitch: 0.03,
  fov: 62,
  /* Метка — перед глазом на расстоянии взгляда, чуть выше горизонта: направление взгляда в осях игры — (sin yaw, cos yaw). */
  markAt: Object.freeze([EYE_X + Math.sin(YAW) * AHEAD, EYE_Y + Math.cos(YAW) * AHEAD, EYE_Z + HEIGHT]),
});
