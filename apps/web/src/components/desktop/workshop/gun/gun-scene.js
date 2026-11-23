// Сцена мастерской оружия: единственный вход. Состояние сцены — один объект ctx,
// зоны Z1…Z7 живут в соседних модулях gun-scene-*.js и подключаются к нему по очереди.
// Имена полей ctx и реестр ctx.ops — в gun-scene-frame.js, createFrame.

import { createFrame } from "./gun-scene-frame.js";
import { attachModelZone } from "./gun-scene-model.js";
import { attachLoadZone } from "./gun-scene-load.js";
import { attachShapeZone } from "./gun-scene-shape.js";
import { attachIslandZone } from "./gun-scene-islands.js";
import { attachDetachZone } from "./gun-scene-detach.js";
import { attachPickZone } from "./gun-scene-pick.js";
import { attachViewZone } from "./gun-scene-view.js";
import { attachDecalZone } from "./gun-scene-decals.js";
import { attachLifecycleZone, buildApi } from "./gun-scene-lifecycle.js";

export { createPoseTempo, sceneFrameWait } from "./pose-tempo.js";
export { materialName, opaqueColour, opaqueColourAsync } from "./gun-scene-pure.js";

// Подключения после Z1 независимы друг от друга: чужие операции берутся из ctx.ops при вызове.
const zoneAttachments = [
  attachModelZone,
  attachLoadZone,
  attachShapeZone,
  attachIslandZone,
  attachDetachZone,
  attachPickZone,
  attachViewZone,
  attachDecalZone,
  attachLifecycleZone,
];

export function createGunScene(canvas, { share = true } = {}) {
  const ctx = createFrame(canvas, share);
  for (const attach of zoneAttachments) attach(ctx);
  return buildApi(ctx);
}
