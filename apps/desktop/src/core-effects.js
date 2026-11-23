import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { diffCoreTextures } from "@modovik/rpf-inspector";
import { openResource, readYptTextures } from "@modovik/ypt";

const STOCK_CORE_FILE = "core.ypt";
// Пустой словарь частиц — одна системная страница без единой текстуры.
const EMPTY_DICTIONARY_BYTES = 8192;

const copyOf = (source) => new Uint8Array(source);
const parseTextures = (bytes) => readYptTextures(copyOf(bytes));
const exists = (target) => access(target).then(() => true, () => false);

// Лениво вычисленное значение: удача запоминается, отказ — нет (следующий вызов пробует снова).
function rememberOnSuccess(produce) {
  const kept = [];
  return async () => {
    if (kept.length === 0) kept.push(await produce());
    return kept[0];
  };
}

// Байты -> распакованный и полный ресурс, иначе null.
function openCompleteResource(bytes) {
  const resource = openResource(copyOf(bytes));
  return resource.complete && resource.data.length > 0 ? resource : null;
}

export async function coreInspector(effectsBaseline) {
  if (!effectsBaseline) return null;
  const stockPath = join(effectsBaseline, STOCK_CORE_FILE);
  if (!(await exists(stockPath))) return null;
  const stockTextures = rememberOnSuccess(async () => parseTextures(await readFile(stockPath)));
  return async function inspect(bytes) {
    try {
      const stock = await stockTextures();
      return diffCoreTextures(parseTextures(bytes), stock);
    } catch {
      return null;
    }
  };
}

export function inspectDictionary(bytes) {
  try {
    const resource = openCompleteResource(bytes);
    if (!resource) return null;
    const hasNoTextures = parseTextures(bytes).length === 0;
    const fitsOnePage = resource.data.length <= EMPTY_DICTIONARY_BYTES;
    return { empty: fitsOnePage && hasNoTextures };
  } catch {
    return null;
  }
}
