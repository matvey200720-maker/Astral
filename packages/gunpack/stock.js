// Штатные стволы ганпака: ствол — копия игры, только когда все его файлы модели
// и текстур по хэшу содержимого есть в базе чистой игры.
import { shotFiles } from "./roles.js";

const SHAPE_ROLES = new Set(["model", "model-hi", "texture", "texture-hi"]);

// Модели и текстуры игры — ресурсы RSC7: хэш снимается по распакованному телу.
// Каждому вызову hashEntry — свой объект настроек.
const resourceOptions = () => ({ resource: true });

// Что сверять: свои модели и текстуры, а без них — одна отделка (_luxe, _camoN).
function comparedFiles(weapon) {
  const list = weapon.files || [];
  if (!Array.isArray(list)) throw new TypeError("Файлы ствола должны быть списком.");
  const shape = list.filter((entry) => SHAPE_ROLES.has(entry.role));
  return shape.length > 0 ? shape : shotFiles(weapon);
}

// Ствол штатный? Файлы читаются по очереди; первый чужой хэш останавливает чтение.
async function isGameCopy(files, { read, hashEntry, stock }) {
  for (const entry of files) {
    const hash = hashEntry(await read(entry.path), resourceOptions());
    if (!stock.has(hash)) return false;
  }
  return true;
}

export async function stockModels(variant, { read, hashEntry, stock } = {}) {
  const models = new Set();
  const baseReady = Boolean(stock?.size) && typeof hashEntry === "function";
  if (!baseReady) return models;

  const base = { read, hashEntry, stock };
  for (const weapon of variant?.weapons || []) {
    const files = comparedFiles(weapon);
    if (files.length > 0 && (await isGameCopy(files, base))) models.add(weapon.model);
  }
  return models;
}
