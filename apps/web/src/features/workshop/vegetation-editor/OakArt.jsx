/*
 * Дуб в облике работы — 3D-снимок той же сцены, что в кадре редактора
 * (`oak-art.js`): обложка полки и плитки готовых видов.
 */

import { useCallback } from "react";
import { useCoverPending } from "../covers/cover-bake-context.js";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { oakLook, oakSceneUrl, oakThumbFrame, useOakLeaf } from "./oak-art.js";

export default function OakArt({ project }) {
  const leaf = useOakLeaf(project);
  /* Печь обложек ждёт лист игры, а не снимает дуб с нарисованным листом. */
  useCoverPending(!leaf.settled);
  const look = useCallback((index, info) => oakLook(leaf.texture)(index, info), [leaf.texture]);
  return <SceneThumb scene={oakSceneUrl(project)} look={look} lookKey={leaf.key} frame={oakThumbFrame} />;
}
