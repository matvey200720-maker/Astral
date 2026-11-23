// Имена текстурных листов растительности по имени файла и его байтам (словарь текстур или модель).
import * as rage from "@modovik/rage-drawable";
import * as rpf from "@modovik/rpf7/node";

// Каждому чтению — свой новый объект параметров.
const readerOptions = () => ({ inflateRaw: rpf.inflateRawNode });

const sheetName = (sheet) => sheet.name;

// Читатель словаря отдаёт сам список текстур.
function dictionaryNames(bytes) {
  const sheets = rage.readTextureDictionary(bytes, readerOptions());
  return sheets.map(sheetName);
}

// Листы, вшитые в каждую модель файла, подряд.
function modelNames(bytes) {
  const file = rage.readDrawable(bytes, readerOptions());
  const embeddedIn = (model) => (model.embeddedTextures || []).map(sheetName);
  return file.drawables.flatMap(embeddedIn);
}

export function vegetationTextureNames(name, bytes) {
  const lowered = String(name || "").toLowerCase();
  const ends = (...endings) => endings.some((ending) => lowered.endsWith(ending));
  if (ends(".ytd")) return dictionaryNames(bytes);
  if (ends(".ydr", ".ydd", ".yft")) return modelNames(bytes);
  return [];
}
