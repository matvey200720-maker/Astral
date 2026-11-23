/*
 * Формат FX-сцен: кадры GTA V с глубиной для предпросмотра эффектов (`docs/fx-scenes.md`).
 * Подключайте частями (`@modovik/fx-scenes/format.js`, `depth.js`, `camera.js`) там, где важен размер: `synthetic.js` — только для тестов и QA.
 */
export * from "./format.js";
export * from "./depth.js";
export * from "./camera.js";
