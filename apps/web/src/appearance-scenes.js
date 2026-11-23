/*
 * Фон приложения — один: «Матовая поверхность».
 *
 * «Живой космос», «Звёздное поле» и «Градиентная сетка» убраны (владелец: 24.09.2026 — два, 23.10.2026 — «Космос» и
 * декор матовой сцены с героями), а с ними ушла и цветная подсветка сцены: палитру читали только они. Что видно за
 * окнами — решает «Внешний вид» в настройках (свет, волны, линии: `features/appearance`), а не сцена. Состояние
 * оформления сводится к одной сцене, остальное в нём постоянно. Атрибуты и переменные, которые из него строит
 * оболочка (`DesktopShellSurface.jsx`), остались прежними: на них держатся правила листов.
 */
export const APPEARANCE_SCENE_IDS = Object.freeze(["matte"]);
export const DEFAULT_APPEARANCE_SCENE = "matte";

export function isAppearanceScene(scene) {
  return APPEARANCE_SCENE_IDS.includes(scene);
}

export function resolveAppearanceState({ scene }) {
  const resolvedScene = isAppearanceScene(scene)
    ? scene
    : DEFAULT_APPEARANCE_SCENE;
  return Object.freeze({
    theme: "dark",
    scene: resolvedScene,
    gradient: "neutral",
    gradientEnabled: "off",
    gradientNeutral: "on",
    gradientStrength: 0,
    gradientFactor: 0,
    gradientStrengthLeft: 0,
    gradientStrengthRight: 0,
    gradientFactorLeft: 0,
    gradientFactorRight: 0,
    sceneGlow: "off",
  });
}
