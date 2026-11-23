/*
 * Запись `core.ypt`, которую собирает один сборщик текстур ядра.
 *
 * Трассер (роль core) и перерисованная текстура ядра — разные стратегии, но
 * одна запись: если сборщик выбирать по верхнему слою, трассер под слоем
 * текстуры (или наоборот) отказал бы на чужом слое. Поэтому запись ядра целиком
 * собирает `ptfxTextureMaterializer`, когда под ней системное ядро
 * (`ptfx-core-base-v1`) или слои пути «ядро игрока» (`isPlayerCoreLayer`):
 * он ставит и слоты следа, и текстуры одним проходом помощника.
 */
import { isPlayerCoreLayer } from "@modovik/tracer-contract";

export function isUnifiedPtfxEntry(layers) {
  const top = layers?.at(-1);
  const strategy = top?.merge?.strategy;
  const coreLayer =
    strategy === "ypt-texture-layer-v1" ||
    strategy === "ypt-rule-patch-v1" ||
    strategy === "ypt-own-rules-v1" ||
    (strategy === "astral-tracer-v1" && top.merge?.role === "core");
  if (!coreLayer) return false;
  return layers.some(
    (layer) =>
      layer?.merge?.strategy === "ptfx-core-base-v1" ||
      isPlayerCoreLayer(layer?.merge),
  );
}
