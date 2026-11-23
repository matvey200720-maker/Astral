import { startAttention } from "../../attention.js";
import { useEffect } from "react";
import { Suspense, lazy } from "react";

// Кусок со слоями сцены заказываем сразу при подключении модуля: к показу заставки он уже в пути.
function requestSceneLayers() {
  return import("./ShellSceneLayers.jsx");
}

const ignoreFailure = () => undefined;
requestSceneLayers().catch(ignoreFailure);

// Ленивый слой берёт ту же функцию, поэтому сбой загрузки всплывёт в границе ошибок при отрисовке.
const SceneLayers = lazy(requestSceneLayers);

// Подложка из настроек внешнего вида; пока она смонтирована, следим за вниманием окна.
export function ShellScene() {
  useEffect(() => startAttention(), []);

  const layers = <SceneLayers />;
  return <Suspense fallback={null}>{layers}</Suspense>;
}

// «Атрибут корня ← поле внешнего вида» для простых пар.
const GRADIENT_ATTRIBUTES = [
  ["data-gradient", "gradient"],
  ["data-gradient-enabled", "gradientEnabled"],
  ["data-gradient-neutral", "gradientNeutral"],
];

// «Переменная ← поле палитры сцены».
const PALETTE_VARIABLES = [
  ["--scene-a", "a"],
  ["--scene-b", "b"],
  ["--scene-c", "c"],
  ["--scene-edge", "edge"],
];

// «Переменная ← поле внешнего вида» для левой и правой половин силы градиента.
const STRENGTH_SIDES = [
  ["--gradient-strength-a", "gradientFactorLeft"],
  ["--gradient-strength-b", "gradientFactorRight"],
];

const pickFields = (pairs, source) =>
  Object.fromEntries(pairs.map(([name, field]) => [name, source[field]]));

// Атрибуты и CSS-переменные корня оболочки; один источник для заставки, входа и окна.
export function shellSurfaceProps(appearanceState, scenePalette, motionEnabled) {
  const style = {
    ...pickFields(PALETTE_VARIABLES, scenePalette),
    "--gradient-strength": appearanceState.gradientFactor,
    "--gradient-strength-percent": `${appearanceState.gradientStrength}%`,
    ...pickFields(STRENGTH_SIDES, appearanceState),
  };

  return {
    "data-theme": appearanceState.theme,
    "data-ambient": appearanceState.scene,
    ...pickFields(GRADIENT_ATTRIBUTES, appearanceState),
    "data-scene-glow": appearanceState.sceneGlow,
    "data-motion": motionEnabled ? "full" : "off",
    style,
  };
}
