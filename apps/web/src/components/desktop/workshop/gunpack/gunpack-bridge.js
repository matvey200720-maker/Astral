import { tr } from "../../../../locales/ui.js";
import { qaDesktopBridge } from "../../../../qa-desktop-bridge.js";

// Мост студии ищется при каждом вызове: сначала окно, потом песочница стенда.
function currentStudio() {
  return window.modovik?.gunpackStudio || qaDesktopBridge?.gunpackStudio;
}

function needStudio() {
  const studio = currentStudio();
  if (studio) return studio;
  throw new Error(tr("Разбор ганпаков работает в приложении Astral: откройте мастерскую в нём."));
}

// Метод зовётся как метод самого моста; ответ (и обещание тоже) возвращается как есть.
function invoke(method, ...args) {
  return needStudio()[method](...args);
}

// Экспорт без аргументов: всё, что передал вызывающий, отбрасывается.
function bare(method) {
  return () => invoke(method);
}

// Запрос уходит мосту тем же объектом, без чтения полей.
function forward(method) {
  return (request) => invoke(method, request);
}

// Запрос собирается из позиционных аргументов: все ключи на месте, даже если значение undefined.
// Поле можно задать парой [имя, что подставить вместо undefined].
function packed(method, ...fields) {
  return (...values) => {
    const request = {};
    fields.forEach((field, at) => {
      const [name, makeFallback] = Array.isArray(field) ? field : [field];
      request[name] = values[at] === undefined && makeFallback ? makeFallback() : values[at];
    });
    return invoke(method, request);
  };
}

// Пути брошенных файлов отдаёт предзагрузчик окна, а не мост.
function droppedPaths(files) {
  const host = window.modovik;
  return host?.pathsForFiles ? host.pathsForFiles(files) : [];
}

// Выбор способа открыть пак: [метод моста, что ему отдать].
function planOpen(studio, paths, files) {
  if (!files.length) return ["open", { paths }];
  const found = droppedPaths(files);
  if (found?.length) return ["open", { paths: found }];
  if (studio.openFiles) return ["openFiles", files];
  throw new Error(tr("Бросить файл сюда можно только в приложении Astral."));
}

export function gunpackStudioAvailable() {
  return Boolean(currentStudio());
}

export async function openPack(input = {}) {
  const { paths = [], files = [] } = input;
  const studio = needStudio();
  const [method, payload] = planOpen(studio, paths, files);
  return studio[method](payload);
}

export const listPacks = bare("list");
export const choosePackFiles = bare("choose");
export const readPackFiles = packed("read", "packId", "paths");
export const savePackShot = packed("saveShot", "packId", "key", "bytes", ["meta", () => ({})]);
export const packShots = packed("shots", "packId");
export const setPackLook = packed("setLook", "packId", "key", "look");
export const removePack = packed("remove", "packId");
export const installPack = forward("install");
export const uninstallPack = forward("uninstall");
/** Один ствол из установленного пака: пакет пересобирается без него (`{ packId, model, gameRoot, targetId }`). */
export const uninstallPackModel = forward("uninstallModel");
export const installPackSkin = forward("installSkin");
export const uninstallPackSkin = forward("uninstallSkin");
export const sendPackToInbox = packed("toInbox", "packId", "variantKey");
export const composePack = forward("compose");
export const takeCatalogWeapon = forward("fromCatalog");
export const packWeaponModel = forward("model");
