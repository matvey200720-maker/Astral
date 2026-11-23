/* global __ASTRAL_WEB_BUILD__ */
const STAMP_PREFIX = "build-";

// Номер сборки интерфейса: при `vite build` сборщик подставляет строку вместо имени,
// в разработке и в тестах имени нет.
function injectedBuild() {
  if (typeof __ASTRAL_WEB_BUILD__ !== "string") return null;
  return __ASTRAL_WEB_BUILD__ === "" ? null : __ASTRAL_WEB_BUILD__;
}

export const WEB_BUILD = injectedBuild();

// Метка для ключей готовых картинок; любое истинное значение приклеивается как есть.
export function webBuildStamp(number = WEB_BUILD) {
  if (!number) return null;
  return STAMP_PREFIX + number;
}
