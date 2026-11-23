/*
 * Отражение зала на материале кадра (`orbit-stage.js`, `apply`): берёт ли материал снимок зала как `envMap` и какой силы.
 *
 * Тяжёлая сцена (от `ADAPTIVE_SCENE_MIN` треугольников) идёт на «Ламберте» вместо PBR (`createRecolourMaterial({ lambert })`,
 * `material.userData.lambert`). У «Ламберта» envMap не отражение, а умножение цвета на окружение: закрытый интерьер даёт тёмный
 * снимок, и стена с блеском «глянец» или «зеркало» рисуется чёрной. Такому материалу зал не ставится — он остаётся с цветом
 * облика, а сцена из-за него снимок зала не просит (`wants`).
 */

/** `look` — облик материала (`room`, `roomIntensity`), `material` — материал кадра, `environment` — снимок зала или `null`, пока не готов. */
export function roomReflection(look, material, environment) {
  const wants = Boolean(look?.room) && !material?.userData?.lambert;
  const envMap = wants ? environment || null : null;
  return { wants, envMap, intensity: envMap ? (look.roomIntensity ?? 1) : 1 };
}
