// Чем рисовать куски векторной подложки: видеокартой (gpu) или растром на процессоре (svg).
// Цепочка: параметр адреса, затем выбор человека в localStorage, затем умолчание по системе.

export const MAP_RENDERER_KEY = "modovik-map-renderer";

const URL_PARAM = "map-renderer";
const MAC_PLATFORM = /mac/i;

function knownMode(value) {
  return value === "gpu" || value === "svg";
}

// Платформа окна читается в момент вызова, а не при загрузке модуля.
export function defaultMapRenderer(
  platform = globalThis.navigator ? globalThis.navigator.platform : "",
) {
  return MAC_PLATFORM.test(String(platform)) ? "gpu" : "svg";
}

export function mapRendererMode({
  search = globalThis.location?.search,
  storage = globalThis.localStorage,
  platform,
} = {}) {
  let fromUrl = null;
  try {
    fromUrl = new URLSearchParams(search).get(URL_PARAM);
  } catch {
    // Адрес не разобрался: идём дальше по цепочке.
  }
  if (knownMode(fromUrl)) return fromUrl;

  let saved = null;
  try {
    saved = storage.getItem(MAP_RENDERER_KEY);
  } catch {
    // Хранилища нет или оно бросает: идём к умолчанию.
  }
  if (knownMode(saved)) return saved;

  return defaultMapRenderer(platform);
}
