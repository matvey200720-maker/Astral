/*
 * Инструменты мастерской: что у человека уже есть и чего ещё нет.
 *
 * Правка архивов GTA V невозможна без ArchiveFix и набора ключей — без них
 * зашифрованная запись не читается и не пересобирается. Astral их скачивает
 * сам, с закреплённого адреса и с побайтовой сверкой, и никогда не отправляет
 * человека «в интернет за OpenIV».
 *
 * ПОЧЕМУ ЭТОГО МОДУЛЯ НЕ ХВАТАЛО
 *
 * Поставка была, но была немой и ленивой: она случалась внутри первой же
 * установки. Человек нажимал «Применить в игру» и получал полсотни мегабайт
 * скачивания вместо ожидаемой правки — без строки состояния, без объяснения и
 * без возможности сделать это заранее, на быстрой сети. А если файлы уже
 * лежали, узнать об этом было неоткуда.
 *
 * Здесь та же поставка, но названная вслух: сколько файлов, сколько весят,
 * какие уже готовы, куда легли. Раздел настроек показывает это списком и
 * позволяет собрать набор до первой правки.
 *
 * Проверка честная и дорогая ровно настолько, насколько нужно: имя и размер
 * читаются из файловой системы, а хеш считается только у того, чей размер
 * сошёлся, — считать SHA-256 у пятидесятимегабайтной таблицы, размер которой
 * уже не тот, незачем.
 */

import fs from "node:fs/promises";
import {
  ARCHIVE_SUPPORT_FILES,
  archiveSupportDirectory,
  provisionArchiveSupport,
} from "./loader-provisioner.js";
import { sha256File } from "@modovik/install-engine";

/* Что это за файл человеческими словами. Имя файла говорит машине, а не
   человеку: `gtav_ng_encrypt_luts.dat` не объясняет, почему он весит 51 МБ. */
const TOOL_COPY = {
  "ArchiveFix.exe": {
    title: "ArchiveFix",
    detail: "Пересобирает архив игры после правки — без него патч не встанет",
  },
  "gtav_aes_key.dat": {
    title: "Ключ AES",
    detail: "Открывает служебные записи архивов",
  },
  "gtav_ng_key.dat": {
    title: "Ключ NG",
    detail: "Открывает записи новых сборок игры",
  },
  "gtav_ng_decrypt_tables.dat": {
    title: "Таблицы расшифровки",
    detail: "Нужны, чтобы прочитать файл из архива",
  },
  "gtav_ng_encrypt_tables.dat": {
    title: "Таблицы шифрования",
    detail: "Нужны, чтобы положить файл обратно",
  },
  "gtav_ng_encrypt_luts.dat": {
    title: "Справочник шифрования",
    detail: "Самый большой файл набора и самый долгий в скачивании",
  },
  "gtav_hash_lut.dat": {
    title: "Таблица имён",
    detail: "По ней имя файла в архиве превращается в его хеш",
  },
};

const describe = (name) =>
  TOOL_COPY[name] || { title: name, detail: "Часть набора ArchiveFix" };

/**
 * Состояние одного файла набора: лежит ли он на месте и сходится ли байт в
 * байт с тем, что закреплено в коде.
 */
async function inspectTool(directory, source) {
  const file = `${directory}/${source.name}`;
  const base = {
    name: source.name,
    ...describe(source.name),
    size: source.size,
  };
  try {
    const stat = await fs.stat(file);
    if (stat.size !== source.size)
      return { ...base, ready: false, state: "stale" };
    if ((await sha256File(file)) !== source.sha256)
      return { ...base, ready: false, state: "stale" };
    return { ...base, ready: true, state: "ready" };
  } catch {
    return { ...base, ready: false, state: "missing" };
  }
}

/**
 * Состояние набора целиком. Ничего не скачивает и не создаёт: раздел настроек
 * открывают чаще, чем ставят моды, и открытие не должно уносить сеть.
 */
export async function readWorkshopToolsStatus({ stateDir } = {}) {
  const directory = archiveSupportDirectory();
  const tools = [];
  for (const source of ARCHIVE_SUPPORT_FILES)
    tools.push(await inspectTool(directory, source));
  const totalBytes = tools.reduce((sum, tool) => sum + tool.size, 0);
  const missingBytes = tools
    .filter((tool) => !tool.ready)
    .reduce((sum, tool) => sum + tool.size, 0);
  return {
    directory,
    stateDir: stateDir || "",
    tools,
    ready: tools.every((tool) => tool.ready),
    totalBytes,
    missingBytes,
  };
}

/**
 * Досаливает набор до полного и отдаёт состояние заново.
 *
 * Поставка та же, что у установки мода, — второй способ добыть те же файлы
 * разошёлся бы с первым в первый же день. Отсюда и отсутствие «докачать
 * только этот файл»: `provisionArchiveSupport` сверяет набор целиком и сам
 * решает, что тянуть.
 */
export async function provisionWorkshopTools(
  { stateDir } = {},
  { provision = provisionArchiveSupport } = {},
) {
  const provisioned = await provision({ stateDir });
  const status = await readWorkshopToolsStatus({ stateDir });
  return { ...status, cached: Boolean(provisioned?.cached) };
}
