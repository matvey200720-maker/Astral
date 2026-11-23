/*
 * Основы пакетов дорог Astral `astral_roads` и `astral_roads_b` (задача 6 ТЗ
 * 07.10.2026) — `content.xml`, `setup2.xml` и пустые потоковые архивы.
 *
 * Устройство — как у пакетов растительности (`vegetation-dlc-host.js`) и
 * текстур (`textures-dlc-host.js`), которые в игре работают:
 *
 *   • потоковые архивы `astral_roads.rpf`…`astral_roads_4.rpf` — записи
 *     `RPF_FILE` с `overlay`: их словари игра берёт вместо своих по имени;
 *     по две части в пакете, словарь — в части своего имени;
 *   • набор изменений — в `GROUP_STARTUP`, пакет — `EXTRACONTENT_COMPAT_PACK`
 *     (с `GROUP_UPDATE_STREAMING` потоковый архив не монтируется вовсе);
 *   • `order` 103 и 104 — выше всех пакетов Rockstar (их `globalroads`
 *     перекрывается тоже) и ниже ступени «Ухудшения текстур» (105);
 *   • словари сетевой карты (`hei_…` районов mpheist) — архивом
 *     `<пакет>_mp.rpf` во втором наборе изменений, в группе `GROUP_MAP`:
 *     после mpheist, как у пакетов мест и растительности (12.10.2026).
 *
 * Собирается один раз помощником RPF и перепроверяется по отпечатку.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
/* Хост DLC сверяется на каждом «Применить»: отпечаток — из памяти, пока файл тот же (`file-fingerprint.js`, 02.11.2026). */
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import { ROADS_DLC_PACKS, roadsArchivesOf, roadsMapStreamOf } from "@modovik/install-engine/roads-dlc.js";
import { createRpfArchive } from "./rpf-composer.js";
import { assertBaseReadable, baseIsReadable } from "./dlc-archive-check.js";

/* 2 — архив сетевой карты в `GROUP_MAP` (12.10.2026). */
const HOST_SCHEMA = 2;
const [PACK_A, PACK_B] = ROADS_DLC_PACKS;

export function roadsHostMetadata(pack = PACK_A) {
  const { device } = pack;
  const streams = pack.streams.map((name) => `dlc_${device}:/${name}`);
  /* Сетевая карта: `hei_` словари — в `GROUP_MAP`, после mpheist. */
  const mapStream = `dlc_${device}:/${roadsMapStreamOf(pack)}`;
  const dataFiles = [...streams, mapStream]
    .map(
      (stream) => `    <Item>
      <filename>${stream}</filename>
      <fileType>RPF_FILE</fileType>
      <overlay value="true" />
      <disabled value="true" />
      <persistent value="true" />
    </Item>`,
    )
    .join("\n");
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
      <filesToEnable>${streams.map((stream) => `<Item>${stream}</Item>`).join("")}</filesToEnable>
    </Item>
    <Item>
      <changeSetName>CCS_${device}_MAP</changeSetName>
      <filesToEnable><Item>${mapStream}</Item></filesToEnable>
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
    <Item>
      <NameHash>GROUP_MAP</NameHash>
      <ContentChangeSets><Item>CCS_${device}_MAP</Item></ContentChangeSets>
    </Item>
  </contentChangeSetGroups>
  <startupScript />
  <scriptCallstackSize value="0" />
  <type>EXTRACONTENT_COMPAT_PACK</type>
  <order value="${pack.order}" />
  <minorOrder value="0" />
  <isLevelPack value="false" />
  <dependencyPackHash />
  <requiredVersion />
  <subPackCount value="0" />
</SSetupData>
`,
  };
}

/* Основа готова, если она та же (схема, отпечаток) И читается строго: основа, которую до обхода 25.10 создавал движок, цела по отпечатку, но
   её потоки читатель игры не раскрывает (корень не на нуле, `rpf-composer.js`) — такая в кэше жила вечно и портила каждую установку, где
   поток остался без словарей. Три килобайта читаются заново — негодная основа пересоберётся помощником. */
async function hostReady(host, metadataFile, readable) {
  try {
    const metadata = JSON.parse(await fs.readFile(metadataFile, "utf8"));
    const stat = await fs.lstat(host);
    return Boolean(
      metadata.schema === HOST_SCHEMA &&
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size > 16 &&
        metadata.sha256 === (await sha256File(host)) &&
        (await readable(host)),
    );
  } catch {
    return false;
  }
}

/** Основа одного пакета в кэше приложения — одна на машину. Путь к `dlc.rpf`. */
async function preparePackHost(pack, { stateDir, gameRoot, edition = "Legacy", create = createRpfArchive, keysProvider = null }) {
  const expect = { device: pack.device, order: pack.order, streams: roadsArchivesOf(pack) };
  const readable = (file) => baseIsReadable(file, { expect, ...(keysProvider ? { keysProvider } : {}) });
  const directory = path.join(stateDir, "bootstrap", `${pack.bases}-v${HOST_SCHEMA}`);
  const host = path.join(directory, "dlc.rpf");
  const metadataFile = path.join(directory, "host.json");
  if (await hostReady(host, metadataFile, readable)) return host;
  await fs.mkdir(directory, { recursive: true });
  const stage = path.join(directory, `.stage-${randomUUID()}`);
  await fs.mkdir(stage);
  try {
    const metadata = roadsHostMetadata(pack);
    /* Пустых архивов в RPF не бывает: каждый потоковый архив держит метка. */
    const marker = Buffer.from(JSON.stringify({ product: "Astral", schema: HOST_SCHEMA }), "utf8");
    const sources = [
      ["content.xml", Buffer.from(metadata.content, "utf8")],
      ["setup2.xml", Buffer.from(metadata.setup, "utf8")],
      ...roadsArchivesOf(pack).map((stream) => [`${stream}/astral_host.json`, marker]),
    ];
    const operations = [];
    for (const [entry, bytes] of sources) {
      const file = path.join(stage, entry.replace(/[\\/]/g, "_"));
      await fs.writeFile(file, bytes);
      operations.push({ entry, source: file, sha256: await sha256File(file), modId: pack.owner, action: "import" });
    }
    const output = path.join(stage, "dlc.rpf");
    const result = await create({ outputArchive: output, archiveTarget: pack.target, edition, gameRoot, operations });
    /* Новая основа читается так же строго, как её прочтёт игра: нечитаемую в кэш не кладём (движок до обхода 25.10 писал такие). */
    await assertBaseReadable(output, { name: pack.name, expect, ...(keysProvider ? { keysProvider } : {}) });
    await fs.rm(host, { force: true });
    await fs.rename(output, host);
    await fs.writeFile(metadataFile, `${JSON.stringify({ schema: HOST_SCHEMA, sha256: result?.outputSha256 || (await sha256File(host)) }, null, 2)}\n`);
    return host;
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

/** Основы обоих пакетов — опции движка `{ roadsDlcHost, roadsDlcBHost }`. */
export async function prepareRoadsDlcHosts(options) {
  return {
    roadsDlcHost: await preparePackHost(PACK_A, options),
    roadsDlcBHost: await preparePackHost(PACK_B, options),
  };
}
