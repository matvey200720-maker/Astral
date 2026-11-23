/*
 * Опись камер обложек компонентов: залы и экраны (Р6, `REDUX-SYSTEM-1011.md` §8; Хелпер 29, 11.11.2026).
 *
 * `component-cover-plan.js` называет вид (`arena-hall`, `minimap`…) и способ съёмки (`hall`, `screen`, `card`), а какой камерой и какой сценой он снимается на деле, знают существующие
 * места: камера арены (`ARENA_LOBBY_COVER`), глаз ангара (`HANGAR_COVER_EYE`), роуты частей (`part-covers.js`). Здесь это записано одной таблицей данных: вид → части редукса (`partKinds`), которых он касается,
 * и где живёт камера (`source`: файл и имя). Тест (`tests/component-cover-cameras.test.js`) сверяет опись с планировщиком и с исходниками: переименовали камеру или добавили вид — красный, а не молчаливый дрейф.
 *
 * Объекты (`building-front`, `model-front`) в описи нет: их камера считается планом по модели (`planComponentCover`), а не лежит готовой.
 */

/**
 * @typedef {{ file: string, symbol: string }} CameraSource  файл (от корня `launcher_app`) и слово, которое в нём обязано быть
 * @typedef {{ camera: string, shot: "hall"|"screen"|"card", editor: string, view?: string, partKinds: string[], source: CameraSource, note: string }} CameraEntry
 */

/** @type {readonly CameraEntry[]} */
export const COMPONENT_CAMERAS = Object.freeze(
  [
    {
      camera: "arena-hall",
      shot: "hall",
      editor: "arenas",
      view: "lobby",
      partKinds: ["arenas"],
      source: { file: "apps/desktop/src/arena-hall-cover.js", symbol: "ARENA_LOBBY_COVER" },
      note: "зал арены от входа (`ref/2`, `ref/3`), второй кадр — снаружи (`ARENA_OUTSIDE_VENUE`); у Majestic пул поз `arena-majestic-frames.js`",
    },
    {
      camera: "hangar-entrance",
      shot: "hall",
      editor: "hangar",
      view: "entrance",
      partKinds: ["hangar"],
      source: { file: "apps/web/src/features/workshop/hangar-editor/hangar-text.js", symbol: "HANGAR_COVER_EYE" },
      note: "ангар изнутри от входа (`ref/7`): глаз `HANGAR_COVER_EYE`, взгляд `HANGAR_COVER_LOOK`, камера одной записью",
    },
    {
      camera: "interior-entrance",
      shot: "hall",
      editor: "interior",
      view: "entrance",
      partKinds: ["interiors"],
      source: { file: "apps/desktop/src/part-covers.js", symbol: "interiors" },
      note: "интерьер, ганшоп изнутри от входа (`ref/6`): маршрут вида `interiors` в `part-covers.js` (карта мест компонента)",
    },
    {
      camera: "minimap",
      shot: "screen",
      editor: "minimap",
      partKinds: ["minimap"],
      source: { file: "apps/desktop/src/part-covers.js", symbol: "WINDOW_KINDS" },
      note: "мини-карта на матовом поле мастерской, анимированная — петлёй (`keepMinimapLoop`)",
    },
    {
      camera: "large-map",
      shot: "screen",
      editor: "large-map",
      partKinds: ["large-map", "large-map-vector", "large-map-zoom"],
      source: { file: "apps/desktop/src/part-covers.js", symbol: "large-map" },
      note: "большая карта: растровая, векторная или ступень отдаления — своя сцена, чёрный фон",
    },
    {
      camera: "crosshair",
      shot: "screen",
      editor: "crosshair",
      partKinds: ["reticle"],
      source: { file: "apps/desktop/src/part-covers.js", symbol: "reticleRoute" },
      note: "прицел на матовом поле (`reticleRoute`)",
    },
    {
      camera: "timecycle",
      shot: "screen",
      editor: "timecycle",
      partKinds: ["timecycle", "kill-effects"],
      source: { file: "apps/desktop/src/part-covers.js", symbol: "WINDOW_KINDS" },
      note: "небо и квартал из игры под светом таймцикла: окно-съёмщик, обложка плюс петля суток",
    },
    {
      camera: "effects",
      shot: "screen",
      editor: "effects",
      partKinds: ["tracers", "core-effects", "blood-routing"],
      source: { file: "apps/desktop/src/part-covers.js", symbol: "tracerRoute" },
      note: "трассеры, ядро эффектов и кровь: кадр GTA V с картой глубины (`tracerRoute`) или окно (`WINDOW_KINDS`)",
    },
    {
      camera: "sounds",
      shot: "screen",
      editor: "sounds",
      partKinds: ["sounds"],
      source: { file: "apps/desktop/src/part-cover-painters.js", symbol: "paintSounds" },
      note: "звук: рисованная обложка без окна (`PAINTED_KINDS.sounds`)",
    },
    {
      camera: "card",
      shot: "card",
      editor: "card",
      partKinds: ["water"],
      source: { file: "apps/desktop/src/part-covers.js", symbol: "WINDOW_KINDS" },
      note: "вода — окно-съёмщик; цвета интерфейса и переключатели оптимизации своей картинки не имеют: обложка-карточка вида",
    },
  ].map((entry) => Object.freeze({ ...entry, partKinds: Object.freeze([...entry.partKinds]), source: Object.freeze({ ...entry.source }) })),
);

/** Запись описи по виду, или `null`. */
export const cameraEntry = (camera) => COMPONENT_CAMERAS.find((entry) => entry.camera === camera) || null;
