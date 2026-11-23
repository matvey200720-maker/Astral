// Единственный выключатель движения — явный `?motion=off` в адресе окна: main.js
// ставит data-motion="off" на <html>. Системную настройку уменьшения движения
// не читаем намеренно (решение владельца 14.10.2026): в Windows её снимают у
// многих игроков, и окно стояло мёртвым. Значение читаем заново на каждый вызов.

const ATTRIBUTE_PATH = ["documentElement", "dataset", "motion"];

export function motionOff(doc = globalThis.document) {
  return ATTRIBUTE_PATH.reduce((node, key) => node?.[key], doc) === "off";
}
