// Выключатель рекламы (Т-165): пока его не включили явно, в лаунчере нет ни
// мест показа, ни запросов к витрине облака, ни учёта показов, ни подписи
// «Реклама». Включают: главный процесс (ASTRAL_ADS_ENABLED=1 → поле
// window.modovik.adsEnabled), для окна без настольного приложения — флаг
// сборки VITE_ADS_ENABLED=true. Код мест остаётся, выключен только показ.

// Метка для тестов: true/false решают сразу, null отдаёт решение окружению.
let forced = null;

export function setShowcaseEnabled(value) {
  forced = value === null ? null : Boolean(value);
}

// Мост настольного приложения решает, если в нём есть поле adsEnabled
// (даже со значением undefined); иначе слово за переменной сборки.
function bridgeVerdict() {
  const bridge = globalThis.window?.modovik;
  if (!bridge || !("adsEnabled" in bridge)) return undefined;
  return bridge.adsEnabled === true;
}

export function showcaseEnabled() {
  const decided = forced ?? bridgeVerdict();
  if (decided !== undefined) return decided;
  return import.meta.env?.VITE_ADS_ENABLED === "true";
}
