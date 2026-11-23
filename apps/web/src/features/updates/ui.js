/*
 * Ленивый кусок обновлений: всё, что рисуется, вместе с листом стилей.
 *
 * Стартовому куску окна нужны только состояние и решение «показывать ли»
 * (`store.js`, `model.js`, `UpdatesHost.jsx`); экраны и их стили подгружаются
 * по `import()`, когда есть что показать (замок, подсказка, «Что нового») или
 * человек открыл «Настройки → О программе». Поэтому `updates.css` не лежит в
 * `styles/index.css` и в `main.css` обновления не весят ни байта; правила в нём
 * обёрнуты в `@layer overrides`, чтобы лист, пришедший позже, не оказался
 * вне слоёв и не перебил слоистое молча (`scripts/verify-web-architecture.js`
 * проверяет и это).
 */
import "./updates.css";

export { default as UpdatesCard } from "./UpdatesCard.jsx";
/* Знак «найдено» первого запуска (окно «GTA V найдена») — та же орбита. */
export { default as UpdateOrbit } from "./UpdateOrbit.jsx";
export { default as UpdatesLayers } from "./UpdatesLayers.jsx";
export { default as BranchesCard } from "./BranchesCard.jsx";
export { default as BranchesLayers } from "./BranchesLayers.jsx";
