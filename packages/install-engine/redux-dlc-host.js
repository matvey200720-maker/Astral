/*
 * Основа dlc редукса `astral_redux_<id>` (R6, проект `docs/INSTALL-RUST-REDUX.md`, разделы 3.1–3.2).
 *
 * Устройство — как у пакета мест (`apps/desktop/src/places-dlc-host.js`) и пакетов Rockstar, что правят карту:
 *
 *   • каждый контейнер редукса (`astral_r<NNN>_<хэш>_<kk>.rpf`) — вложенный архив dlc, строка `content.xml` с `RPF_FILE` и
 *     `overlay`: его записи игра берёт вместо штатных по имени, а пакет со старшим `order` перекрывает и пакеты Rockstar;
 *   • данные карты (`.ymap`, `.ytyp`) — своим архивом `<контейнер>_metadata.rpf` с `loadCompletely` и
 *     `CONTENTS_DLC_MAP_DATA`: с картой в простом потоковом архиве пакет дополнения ронял игру на загрузке (06.10.2026);
 *     слово `mapData: "whole"` оставляет контейнер одним архивом, как в `update.rpf`;
 *   • манифестов (`_manifest.ymf`) и запросов типов основа не везёт: хранилище метаданных игры заполнено до конца, и манифест
 *     в пакете ронял игру. Контейнер с манифестом остаётся в `update.rpf` (`redux-routes.js`);
 *   • набор изменений — в `GROUP_STARTUP`, пакет — `EXTRACONTENT_COMPAT_PACK`;
 *   • `order` 58–104: выше Rockstar (до 57), ниже «Ухудшения текстур» (105), мест (107) и растительности (110), то есть работа
 *     мастерской остаётся сверху. Второй dlc того же редукса — тот же `order` и `minorOrder` 1, 2…
 *
 * Модуль не зовёт движок и не знает состояния: тексты и две записи основы (`content.xml`, `setup2.xml`) на диске.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { mergeDlcListXml, stripAstralDlcListXml } from "./manifest.js";

/** Префикс имени dlc редукса: `astral_` нужен правилам приложения (`isOwnDlcPath`, строки `dlcpacks:/astral_…/`). */
export const REDUX_PACK_PREFIX = "astral_redux_";
export const REDUX_LAYER_PREFIX = "redux-";
export const REDUX_ORDER_MIN = 58;
export const REDUX_ORDER_MAX = 104;
export const REDUX_HOST_SCHEMA = 1;

const DEVICE_NAME = /^[A-Z0-9_]{1,64}$/;
const ARCHIVE_NAME = /^[a-z0-9][a-z0-9._-]{0,127}\.rpf$/i;
const MAP_DATA = /\.(?:ymap|ytyp|ymf)$/i;
const MAP_DATA_MODES = new Set(["split", "whole"]);

function argumentError(message) {
  const error = new Error(`Redux host: ${message}`);
  error.code = "ARGUMENTS";
  return error;
}

/**
 * Имена редукса по id его карточки: слой `redux-<8 знаков>`, dlc `astral_redux_<8 знаков>` (второй — с `_2`) и устройство
 * `ASTRAL_REDUX_<8 ЗНАКОВ>` в `content.xml` и `setup2.xml`. Восемь знаков — начало SHA-256 id: стабильно и коротко.
 */
export function reduxIdentity(cardId) {
  if (typeof cardId !== "string" || !cardId.trim()) throw argumentError("the card id is a non-empty string.");
  const hash = createHash("sha256").update(cardId).digest("hex").slice(0, 8);
  const at = (index) => {
    if (!Number.isInteger(index) || index < 0 || index > 98) throw argumentError("the dlc index is a number from 0 to 98.");
    return index;
  };
  return {
    cardId,
    hash,
    layerId: `${REDUX_LAYER_PREFIX}${hash}`,
    packName: (index = 0) => `${REDUX_PACK_PREFIX}${hash}${at(index) === 0 ? "" : `_${index + 1}`}`,
    device: (index = 0) => `ASTRAL_REDUX_${hash.toUpperCase()}${at(index) === 0 ? "" : `_${index + 1}`}`,
  };
}

/** Следующий свободный `order` редукса (58–104) или `null`, когда все заняты. Чужие порядки вне диапазона не мешают. */
export function nextReduxOrder(used = []) {
  const taken = new Set((used ?? []).filter((value) => Number.isInteger(value) && value >= REDUX_ORDER_MIN && value <= REDUX_ORDER_MAX));
  for (let order = REDUX_ORDER_MIN; order <= REDUX_ORDER_MAX; order += 1) if (!taken.has(order)) return order;
  return null;
}

/** Данные карты контейнера: `<имя>_metadata.rpf`. */
export const reduxMetadataOf = (container) => String(container).replace(/\.rpf$/i, "_metadata.rpf");

/** В каком архиве dlc лежит запись контейнера: данные карты — в `_metadata`, остальное — в потоковом (`mapData: "whole"` — в одном). */
export function reduxArchiveOf(container, inner, { mapData = "split" } = {}) {
  if (!MAP_DATA_MODES.has(mapData)) throw argumentError("mapData is split or whole.");
  return mapData === "split" && MAP_DATA.test(String(inner)) ? reduxMetadataOf(container) : String(container);
}

/* Архив модели и архив данных карты одной записью content.xml (как у пакета мест). */
const streamItem = (device, name) => `    <Item>
      <filename>dlc_${device}:/${name}</filename>
      <fileType>RPF_FILE</fileType>
      <overlay value="true" />
      <disabled value="true" />
      <persistent value="true" />
    </Item>`;
const metadataItem = (device, name) => `    <Item>
      <filename>dlc_${device}:/${name}</filename>
      <fileType>RPF_FILE</fileType>
      <overlay value="true" />
      <disabled value="true" />
      <persistent value="true" />
      <loadCompletely value="true" />
      <contents>CONTENTS_DLC_MAP_DATA</contents>
    </Item>`;

/**
 * `content.xml` и `setup2.xml` dlc.
 *
 * @param {object} options
 * @param {string} options.device         устройство: `ASTRAL_REDUX_<ХЭШ>[_N]`
 * @param {{ stream?: string, metadata?: string }[]} options.archives  архивы по контейнерам в порядке автора
 * @param {number} options.order          58–104
 * @param {number} [options.minorOrder=0]
 */
export function reduxHostMetadata({ device, archives, order, minorOrder = 0 } = {}) {
  if (!DEVICE_NAME.test(String(device ?? ""))) throw argumentError("the device is capital letters, digits and underscores.");
  if (!Number.isInteger(order) || order < REDUX_ORDER_MIN || order > REDUX_ORDER_MAX) throw argumentError(`order is a number from ${REDUX_ORDER_MIN} to ${REDUX_ORDER_MAX}.`);
  if (!Number.isInteger(minorOrder) || minorOrder < 0) throw argumentError("minorOrder is a non-negative number.");
  if (!Array.isArray(archives) || archives.length === 0) throw argumentError("a dlc needs at least one archive.");
  for (const archive of archives) {
    if (!archive || (!archive.stream && !archive.metadata)) throw argumentError("an archive item needs a stream or a metadata name.");
    for (const name of [archive.stream, archive.metadata]) if (name !== undefined && !ARCHIVE_NAME.test(String(name))) throw argumentError("an archive name ends with .rpf.");
  }
  const streams = archives.filter((archive) => archive.stream).map((archive) => archive.stream);
  const metadata = archives.filter((archive) => archive.metadata).map((archive) => archive.metadata);
  const dataFiles = [...streams.map((name) => streamItem(device, name)), ...metadata.map((name) => metadataItem(device, name))].join("\n");
  /* Как у Rockstar: архив моделей, затем архив данных карты. */
  const enable = archives.flatMap((archive) => [archive.stream, archive.metadata].filter(Boolean)).map((name) => `<Item>dlc_${device}:/${name}</Item>`);
  return {
    content: `<?xml version="1.0" encoding="utf-8"?>
<CDataFileMgr__ContentsOfDataFileXml>
  <disabledFiles />
  <includedXmlFiles />
  <dataFiles>
${dataFiles}
  </dataFiles>
  <contentChangeSets>
    <Item>
      <changeSetName>CCS_${device}_STREAMING</changeSetName>
      <filesToEnable>${enable.join("")}</filesToEnable>
    </Item>
  </contentChangeSets>
  <patchFiles />
</CDataFileMgr__ContentsOfDataFileXml>
`,
    setup: `<?xml version="1.0" encoding="utf-8"?>
<SSetupData>
  <deviceName>dlc_${device}</deviceName>
  <datFile>content.xml</datFile>
  <timeStamp>01/01/2026 00:00:00</timeStamp>
  <nameHash>${device}</nameHash>
  <contentChangeSets />
  <contentChangeSetGroups>
    <Item>
      <NameHash>GROUP_STARTUP</NameHash>
      <ContentChangeSets><Item>CCS_${device}_STREAMING</Item></ContentChangeSets>
    </Item>
  </contentChangeSetGroups>
  <startupScript />
  <scriptCallstackSize value="0" />
  <type>EXTRACONTENT_COMPAT_PACK</type>
  <order value="${order}" />
  <minorOrder value="${minorOrder}" />
  <isLevelPack value="false" />
  <dependencyPackHash />
  <requiredVersion />
  <subPackCount value="0" />
</SSetupData>
`,
  };
}

/**
 * Записать две записи основы dlc (`content.xml`, `setup2.xml`) в `<stageDir>/<packName>/` и вернуть их записями списка
 * `build-rpf-dlc` (двоичные, с длиной и SHA-256). `cleanup()` убирает папку; повторный вызов безвреден.
 */
export async function stageReduxHost({ stageDir, packName, ...metadataOptions } = {}) {
  if (!stageDir || !packName || !/^[a-z0-9_]{1,64}$/.test(packName)) throw argumentError("stageDir and packName are required.");
  const { content, setup } = reduxHostMetadata(metadataOptions);
  const dir = path.join(String(stageDir), packName);
  await fs.mkdir(dir, { recursive: true });
  const entries = [];
  for (const [name, text] of [
    ["content.xml", content],
    ["setup2.xml", setup],
  ]) {
    const source = path.join(dir, name);
    const bytes = Buffer.from(text, "utf8");
    await fs.writeFile(source, bytes);
    entries.push({ path: name, kind: "binary", size: bytes.length, source, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return { dir, entries, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

/**
 * `dlclist.xml` по основе: строки Astral снимаются и ставятся ровно те, что названы. `reduxPacks` — dlc включённых редуксов,
 * `otherAstral` — остальные свои пакеты (растительность, места…), которые должны остаться. Переводы строк основы сохраняются.
 */
export function composeReduxDlcList(baseXml, { reduxPacks = [], otherAstral = [] } = {}) {
  return mergeDlcListXml(stripAstralDlcListXml(baseXml).xml, [...otherAstral, ...reduxPacks]);
}
