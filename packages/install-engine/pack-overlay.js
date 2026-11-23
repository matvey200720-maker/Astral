/*
 * Свой overlay-RPF в штатном паке: реестр в `content.xml` пака.
 *
 * Файл владельца (изменённый `patchday16ng/dlc.rpf`, 01.11.2026) включает
 * чужой `x64/levels/gta5/kitana.rpf` двумя правками `content.xml`: строка в
 * `dataFiles` и строка в `filesToEnable` набора `CCS_PATCHDAY16_NG_STREAMING`.
 * `setup2.xml` у него штатный. Свой архив включается теми же строками: это
 * гипотеза по файлу владельца, в игре и на Majestic не проверено.
 *
 * Как реестры update.rpf (`registry-composers.js`): слой `content.xml`
 * принадлежит движку, пересобирается при каждой сборке архива и живёт, пока в
 * overlay-RPF что-то стоит. Сняли последнюю вещь — слоя нет, и архив, если
 * других правок нет, возвращается к основе байт в байт. Основа — живой файл
 * человека на момент первого касания: чужой `kitana.rpf` и его строки остаются
 * в ней нетронутыми, наши строки идут после них.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  isPackOverlayEntry,
  PACK_OVERLAY_INNER,
  PACK_OVERLAY_PACK,
  PACK_OVERLAY_TARGET,
} from "./astral-paths.js";
import { exists } from "./storage-state.js";
import { ownRecordValue, setRecordValue } from "./state-record.js";

export const PACK_OVERLAY_LAYER = "@astral-pack-overlay-registry";
const CONTENT_ENTRY = "content.xml";
const CHANGESET = "CCS_PATCHDAY16_NG_STREAMING";
const OVERLAY_FILE = PACK_OVERLAY_INNER.slice("x64/".length);
/* Написание — как у `kitana.rpf` в файле владельца: в `dataFiles` и в `filesToEnable` устройство пака там названо по-разному. */
export const PACK_OVERLAY_DATA_FILE = `dlc_patchDay16NG:/%PLATFORM%/${OVERLAY_FILE}`;
export const PACK_OVERLAY_ENABLE_FILE = `dlc_PATCHDAY16NG:/%PLATFORM%/${OVERLAY_FILE}`;

const OVERLAY_DATA_ITEM =
  /[ \t]*<Item>\s*<filename>\s*dlc_patchday16ng:\/%PLATFORM%\/levels\/gta5\/astral_pack\.rpf\s*<\/filename>[\s\S]*?<\/Item>[ \t]*(?:\r?\n)?/gi;
const OVERLAY_ENABLE_ITEM =
  /[ \t]*<Item>\s*dlc_patchday16ng:\/%PLATFORM%\/levels\/gta5\/astral_pack\.rpf\s*<\/Item>[ \t]*(?:\r?\n)?/gi;

/** `content.xml` пака без наших строк: снимает ровно то, что вставляет `mergePackOverlayContentXml`. */
export const stripPackOverlayContentXml = (xml) =>
  String(xml || "").replace(OVERLAY_DATA_ITEM, "").replace(OVERLAY_ENABLE_ITEM, "");

/**
 * `content.xml` пака с нашим overlay-RPF. Остальное в тексте не меняется ни на
 * байт: чужие строки и их порядок остаются. Повторный вызов ничего не добавит.
 */
export function mergePackOverlayContentXml(xml) {
  const source = String(xml || "");
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(source))
    throw new Error("content.xml пака содержит запрещённые объявления DTD.");
  if (!/<CDataFileMgr__ContentsOfDataFileXml\b[^>]*>/i.test(source) || !/<dataFiles\b[^>]*>[\s\S]*<\/dataFiles>/i.test(source))
    throw new Error(`content.xml пака ${PACK_OVERLAY_PACK} не похож на файл игры: нет раздела dataFiles.`);
  /* `\s*<` после имени: набор `…_STREAMING_MAP` сюда не подходит. */
  const changeset = new RegExp(
    `(<changeSetName>\\s*${CHANGESET}\\s*</changeSetName>\\s*<filesToEnable\\b[^>/]*>[\\s\\S]*?)([ \\t]*)</filesToEnable>`,
    "i",
  );
  if (!changeset.test(source))
    throw new Error(`В content.xml пака ${PACK_OVERLAY_PACK} нет набора ${CHANGESET}: включить архив негде.`);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  let result = source;
  if (!result.toLowerCase().includes(`<filename>${PACK_OVERLAY_DATA_FILE.toLowerCase()}</filename>`)) {
    const item = [
      "\t\t<Item>",
      `\t\t\t<filename>${PACK_OVERLAY_DATA_FILE}</filename>`,
      "\t\t\t<fileType>RPF_FILE</fileType>",
      '\t\t\t<disabled value="true"/>',
      '\t\t\t<persistent value="true"/>',
      '\t\t\t<overlay value="true"/>',
      "\t\t</Item>",
    ].join(newline);
    result = result.replace(/([ \t]*)<\/dataFiles>/i, (_, indent) => `${item}${newline}${indent}</dataFiles>`);
  }
  if (!result.toLowerCase().includes(`<item>${PACK_OVERLAY_ENABLE_FILE.toLowerCase()}</item>`))
    result = result.replace(
      changeset,
      (_, head, indent) => `${head}\t\t\t\t<Item>${PACK_OVERLAY_ENABLE_FILE}</Item>${newline}${indent}</filesToEnable>`,
    );
  return result;
}

/** Стоит ли в архиве хоть что-то внутри overlay-RPF. */
export function packOverlayInUse(archive) {
  return Object.entries(archive?.entries || {}).some(([entry, record]) => {
    const top = record?.layers?.at(-1);
    return top && top.action !== "delete" && isPackOverlayEntry(PACK_OVERLAY_TARGET, entry);
  });
}

/**
 * Держит слой `content.xml` в согласии с overlay-RPF. Зовётся перед каждой
 * сборкой архива (`composeArchiveResource`), поэтому установка, снятие, возврат
 * снятых и перебазирование ничего об этом знать не обязаны.
 *
 * Основа очищается от наших строк: человек поправил `content.xml` после Astral
 * (OpenIV), и перебазирование оставило его файл с ними, а зарегистрированный
 * пустой архив игра может не пережить (ERR_SYS_FILELOAD у контейнеров слоя).
 * Если в основе наших строк нет и архив не занят, слоя нет: снятие — байт в байт.
 *
 * `reader({ baseArchive, archiveTarget, gameRoot, edition, output, signal })`
 * кладёт `content.xml` основы в `output` (`packContentMaterializer`).
 */
export async function composePackOverlayRegistry({
  target,
  archiveTarget,
  targetKey,
  gameRoot,
  edition,
  paths,
  compositionBase,
  reader,
  signal = null,
}) {
  if (String(archiveTarget || "").toLowerCase() !== PACK_OVERLAY_TARGET) return false;
  const archive = target?.archives?.[archiveTarget];
  if (!archive?.entries) return false;
  const existing = ownRecordValue(archive.entries, CONTENT_ENTRY);
  if (existing) {
    existing.layers = (existing.layers || []).filter((layer) => layer?.modId !== PACK_OVERLAY_LAYER);
    if (!existing.layers.length) delete archive.entries[CONTENT_ENTRY];
  }
  const inUse = packOverlayInUse(archive);
  if (typeof reader !== "function") {
    if (!inUse) return false;
    throw new Error("Компонент чтения content.xml пака не установлен. Обновите Astral или выполните Setup Doctor.");
  }
  /* Чужой слой на `content.xml` (мод каталога) — основа для наших строк: снимется он, снимется и его текст. */
  const under = existing?.layers?.at(-1);
  const underFile = under?.cachePath && under.action !== "delete" ? under.cachePath : null;
  const directory = path.join(paths.payloads, "_pack-overlay-content", targetKey);
  await fs.mkdir(directory, { recursive: true });
  const stage = path.join(directory, `${randomUUID()}.stage`);
  let output;
  let sha256;
  try {
    try {
      if (underFile) await fs.copyFile(underFile, stage);
      else await reader({ baseArchive: compositionBase.path, archiveTarget, gameRoot, edition, output: stage, signal });
    } catch (error) {
      /* Снятие не держится за чтение: архив не занят, и наших строк в основе почти наверняка нет. */
      if (!inUse) return false;
      throw error;
    }
    const source = await fs.readFile(stage, "utf8");
    const clean = stripPackOverlayContentXml(source);
    const text = inUse ? mergePackOverlayContentXml(clean) : clean;
    if (text === source) return false;
    sha256 = createHash("sha256").update(text, "utf8").digest("hex");
    output = path.join(directory, `${sha256}.xml`);
    if (!(await exists(output))) {
      await fs.writeFile(stage, text, "utf8");
      await fs.rename(stage, output);
    }
  } finally {
    await fs.rm(stage, { force: true }).catch(() => {});
  }
  const record = ownRecordValue(archive.entries, CONTENT_ENTRY) || setRecordValue(archive.entries, CONTENT_ENTRY, { layers: [] });
  record.layers.push({
    modId: PACK_OVERLAY_LAYER,
    version: sha256.slice(0, 12),
    action: "replace",
    cachePath: output,
    sha256,
  });
  return true;
}
