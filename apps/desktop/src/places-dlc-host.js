/*
 * Основа пакета мест Astral `astral_places` (фикс 1 ТЗ 06.10.2026) —
 * `content.xml`, `setup2.xml` и пустые архивы мест.
 *
 * Устройство — как у пакетов Rockstar, что правят карту (`patchday2ng`):
 *
 *   • у каждого места свой потоковый архив (`astral_megamall.rpf`…) — запись
 *     `RPF_FILE` с `overlay`: его модели и словари игра берёт вместо своих по
 *     имени, и пакет со старшим `order` перекрывает и пакеты Rockstar;
 *   • и свой архив данных карты (`astral_megamall_metadata.rpf`): карты,
 *     типы и манифест места — `overlay`, `loadCompletely` и
 *     `CONTENTS_DLC_MAP_DATA`, как `scentral_metadata.rpf` у patchday2ng
 *     (типы и карты городских районов Rockstar перевыпустила там — из
 *     update.rpf их было не перекрыть). С картой и манифестом в простом
 *     потоковом архиве игра падала на загрузке;
 *   • манифестов (`_manifest.ymf`) пакет не везёт: хранилище метаданных
 *     игры (`MetaDataStore`, 3200 мест) у игрока заполнено до конца, и
 *     манифест места в пакете ронял GTA на загрузке (06.10.2026, два дампа:
 *     запись по нулевому адресу при разборе архива места); свои карты,
 *     типы и манифест места живут в контейнере update.rpf;
 *   • постоянные типы копий мест (фикс 2, `PLACES_LOCAL_TYPES_SETS`):
 *     `astral_<место>_local.ytyp` в архиве данных карты и запрос
 *     `DLC_ITYP_REQUEST` на него — как свои пропы у пакетов Rockstar
 *     (`mpheist`: `dlcMPHeist:/%PLATFORM%/levels/gta5/props/hei_lev_des_mp_dlc.ityp`).
 *     Основа везёт пустые типы (их собирает нативный хост), место с копиями
 *     перекрывает их своими;
 *   • набор изменений — в `GROUP_STARTUP`, пакет — `EXTRACONTENT_COMPAT_PACK`
 *     (группу `GROUP_UPDATE_STREAMING` игра выполняет только у своих
 *     patchday — урок хоста оружия 04.10.2026);
 *   • файлы сетевой карты (`hei_…` аэропорта у ангара, `PLACES_MAP_SETS`) —
 *     своими архивами `astral_<место>_mp.rpf` / `_mp_metadata.rpf` во втором
 *     наборе изменений, в группе `GROUP_MAP`: mpheist включает свои архивы
 *     аэропорта только там, и правка поверх них должна идти после него, как
 *     у пакетов Rockstar mp2023…mp2026 (провал у ангара, ТЗ 12.10.2026);
 *   • `order` 107 — выше Rockstar и «Ухудшения текстур» (105), ниже
 *     растительности (110), которая собирается поверх файлов мест.
 *
 * Собирается помощником RPF и перепроверяется по отпечатку.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
/* Хост DLC сверяется на каждом «Применить»: отпечаток — из памяти, пока файл тот же (`file-fingerprint.js`, 02.11.2026). */
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import {
  PLACES_DLC_ORDER,
  PLACES_DLC_SETS,
  PLACES_DLC_TARGET,
  PLACES_LOCAL_TYPES_SETS,
  PLACES_MAP_SETS,
  placesLocalTypesOf,
  placesMapMetadataOf,
  placesMapStreamOf,
  placesMetadataOf,
  placesStreamOf,
} from "@modovik/install-engine/places-dlc.js";
import { createRpfArchive } from "./rpf-composer.js";

/* 1 — первая основа: архивы мест и пустые постоянные типы.
   2 — данные карты места своим архивом (`CONTENTS_DLC_MAP_DATA`).
   3 — без пустых постоянных типов (искали причину краша).
   4 — постоянные типы копий мест снова (фикс 2): причиной краша был
       манифест места в пакете, а не типы.
   5 — архивы сетевой карты мест в `GROUP_MAP` (провал у ангара, 12.10.2026). */
const HOST_SCHEMA = 5;
const DEVICE = "ASTRAL_PLACES";

/* Архив модели и архив данных карты одной записью content.xml. */
const streamItem = (filename) => `    <Item>
      <filename>${filename}</filename>
      <fileType>RPF_FILE</fileType>
      <overlay value="true" />
      <disabled value="true" />
      <persistent value="true" />
    </Item>`;
const metadataItem = (filename) => `    <Item>
      <filename>${filename}</filename>
      <fileType>RPF_FILE</fileType>
      <overlay value="true" />
      <disabled value="true" />
      <persistent value="true" />
      <loadCompletely value="true" />
      <contents>CONTENTS_DLC_MAP_DATA</contents>
    </Item>`;

/** `content.xml` и `setup2.xml` пакета: что монтировать и когда. */
export function placesHostMetadata(sets = PLACES_DLC_SETS, localTypes = PLACES_LOCAL_TYPES_SETS, mapSets = PLACES_MAP_SETS) {
  const streams = sets.map((set) => `dlc_${DEVICE}:/${placesStreamOf(set)}`);
  const metadata = sets.map((set) => `dlc_${DEVICE}:/${placesMetadataOf(set)}`);
  /* Сетевая карта: архивы мест, что правят файлы mpheist, — в `GROUP_MAP`. */
  const onMap = sets.filter((set) => mapSets.includes(set));
  const mapArchives = onMap.flatMap((set) => [`dlc_${DEVICE}:/${placesMapStreamOf(set)}`, `dlc_${DEVICE}:/${placesMapMetadataOf(set)}`]);
  /* Запрос постоянных типов — по имени, как у Rockstar: папка архива и
     имя типов с расширением `.ityp`. */
  const types = new Map(sets.filter((set) => localTypes.includes(set)).map((set) => [set, `dlc_${DEVICE}:/${placesLocalTypesOf(set)}.ityp`]));
  const dataFiles = [
    ...streams.map(streamItem),
    /* Данные карты — как `…_metadata.rpf` пакетов Rockstar (patchday2ng). */
    ...metadata.map(metadataItem),
    ...onMap.flatMap((set) => [streamItem(`dlc_${DEVICE}:/${placesMapStreamOf(set)}`), metadataItem(`dlc_${DEVICE}:/${placesMapMetadataOf(set)}`)]),
    ...[...types.values()].map(
      (request) => `    <Item>
      <filename>${request}</filename>
      <fileType>DLC_ITYP_REQUEST</fileType>
      <overlay value="false" />
      <disabled value="true" />
      <persistent value="false" />
      <contents>CONTENTS_PROPS</contents>
    </Item>`,
    ),
  ].join("\n");
  /* Как у Rockstar: архив моделей, затем архив данных карты, затем запрос
     постоянных типов. */
  const enable = sets.flatMap((set, index) => [streams[index], metadata[index], ...(types.has(set) ? [types.get(set)] : [])]);
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
      <changeSetName>CCS_${DEVICE}_STREAMING</changeSetName>
      <filesToEnable>${enable.map((item) => `<Item>${item}</Item>`).join("")}</filesToEnable>
    </Item>${
      mapArchives.length
        ? `
    <Item>
      <changeSetName>CCS_${DEVICE}_MAP</changeSetName>
      <filesToEnable>${mapArchives.map((item) => `<Item>${item}</Item>`).join("")}</filesToEnable>
    </Item>`
        : ""
    }
  </contentChangeSets>
  <patchFiles />
</CDataFileMgr__ContentsOfDataFileXml>
`,
    setup: `<?xml version="1.0" encoding="utf-8"?>
<SSetupData>
  <deviceName>dlc_${DEVICE}</deviceName>
  <datFile>content.xml</datFile>
  <timeStamp>01/01/2026 00:00:00</timeStamp>
  <nameHash>${DEVICE}</nameHash>
  <contentChangeSets />
  <contentChangeSetGroups>
    <Item>
      <NameHash>GROUP_STARTUP</NameHash>
      <ContentChangeSets><Item>CCS_${DEVICE}_STREAMING</Item></ContentChangeSets>
    </Item>${
      mapArchives.length
        ? `
    <Item>
      <NameHash>GROUP_MAP</NameHash>
      <ContentChangeSets><Item>CCS_${DEVICE}_MAP</Item></ContentChangeSets>
    </Item>`
        : ""
    }
  </contentChangeSetGroups>
  <startupScript />
  <scriptCallstackSize value="0" />
  <type>EXTRACONTENT_COMPAT_PACK</type>
  <order value="${PLACES_DLC_ORDER}" />
  <minorOrder value="0" />
  <isLevelPack value="false" />
  <dependencyPackHash />
  <requiredVersion />
  <subPackCount value="0" />
</SSetupData>
`,
  };
}

async function hostReady(host, metadataFile) {
  try {
    const metadata = JSON.parse(await fs.readFile(metadataFile, "utf8"));
    const stat = await fs.lstat(host);
    return Boolean(
      metadata.schema === HOST_SCHEMA &&
        JSON.stringify(metadata.sets) === JSON.stringify(PLACES_DLC_SETS) &&
        /* Новое место с постоянными типами («Интерьеры», задача 3 ТЗ 10.10.2026) — тоже новая основа. */
        JSON.stringify(metadata.localTypes || []) === JSON.stringify(PLACES_LOCAL_TYPES_SETS) &&
        JSON.stringify(metadata.mapSets || []) === JSON.stringify(PLACES_MAP_SETS) &&
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size > 16 &&
        metadata.sha256 === (await sha256File(host)),
    );
  } catch {
    return false;
  }
}

/* Пустые типы нативным хостом (`compile-place-types` без копий). */
async function compileEmptyTypes({ name, output, stage, compile }) {
  if (typeof compile !== "function") throw new Error("Сборщик типов мест не подключён — обновите Astral.");
  const request = path.join(stage, `${name}.request.json`);
  await fs.writeFile(request, JSON.stringify({ format: "astral.compile-place-types", version: 1, typesName: name, sources: [], clones: [] }));
  await compile("compile-place-types", { input: request, output });
}

/** Основа пакета в кэше приложения — одна на машину. Путь к `dlc.rpf`. */
export async function preparePlacesDlcHost({ stateDir, gameRoot, edition = "Legacy", create = createRpfArchive, compile = null, emptyTypes = null }) {
  const directory = path.join(stateDir, "bootstrap", `places-dlc-v${HOST_SCHEMA}`);
  const host = path.join(directory, "dlc.rpf");
  const metadataFile = path.join(directory, "host.json");
  if (await hostReady(host, metadataFile)) return host;
  /* Основы прежних схем не нужны: движок держит свою копию основы. */
  for (let schema = 1; schema < HOST_SCHEMA; schema += 1)
    await fs.rm(path.join(stateDir, "bootstrap", `places-dlc-v${schema}`), { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(directory, { recursive: true });
  const stage = path.join(directory, `.stage-${randomUUID()}`);
  await fs.mkdir(stage);
  try {
    const metadata = placesHostMetadata();
    /* Пустых архивов в RPF не бывает: каждый архив места держит метка. */
    const marker = Buffer.from(JSON.stringify({ product: "Astral", schema: HOST_SCHEMA }), "utf8");
    const markerFile = path.join(stage, "marker.json");
    await fs.writeFile(markerFile, marker);
    const markerSha = await sha256File(markerFile);
    const operations = [];
    for (const [entry, bytes] of [
      ["content.xml", Buffer.from(metadata.content, "utf8")],
      ["setup2.xml", Buffer.from(metadata.setup, "utf8")],
    ]) {
      const file = path.join(stage, entry);
      await fs.writeFile(file, bytes);
      operations.push({ entry, source: file, sha256: await sha256File(file), modId: "@astral-places-host", action: "import" });
    }
    for (const set of PLACES_DLC_SETS)
      for (const archive of [
        placesStreamOf(set),
        placesMetadataOf(set),
        ...(PLACES_MAP_SETS.includes(set) ? [placesMapStreamOf(set), placesMapMetadataOf(set)] : []),
      ])
        operations.push({ entry: `${archive}/astral_host.json`, source: markerFile, sha256: markerSha, modId: "@astral-places-host", action: "import" });
    /* Пустые постоянные типы мест с копиями: запрос типов не смотрит в пустоту. */
    for (const set of PLACES_LOCAL_TYPES_SETS) {
      if (!PLACES_DLC_SETS.includes(set)) continue;
      const file = path.join(stage, `${placesLocalTypesOf(set)}.ytyp`);
      await (emptyTypes || compileEmptyTypes)({ name: placesLocalTypesOf(set), output: file, stage, compile });
      operations.push({
        entry: `${placesMetadataOf(set)}/${placesLocalTypesOf(set)}.ytyp`,
        source: file,
        sha256: await sha256File(file),
        modId: "@astral-places-host",
        action: "import",
      });
    }
    const output = path.join(stage, "dlc.rpf");
    const result = await create({ outputArchive: output, archiveTarget: PLACES_DLC_TARGET, edition, gameRoot, operations });
    await fs.rm(host, { force: true });
    await fs.rename(output, host);
    await fs.writeFile(
      metadataFile,
      `${JSON.stringify({ schema: HOST_SCHEMA, sets: PLACES_DLC_SETS, localTypes: PLACES_LOCAL_TYPES_SETS, mapSets: PLACES_MAP_SETS, sha256: result?.outputSha256 || (await sha256File(host)) }, null, 2)}\n`,
    );
    return host;
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}
