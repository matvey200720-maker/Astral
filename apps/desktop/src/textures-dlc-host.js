/*
 * Основа пакета текстур Astral `astral_textures` (задача 1 ТЗ 05.10.2026) —
 * `content.xml`, `setup2.xml` и пустые потоковые архивы.
 *
 * Устройство — как у пакета растительности (`vegetation-dlc-host.js`) и у
 * мода `retexture.rpf`: потоковые архивы `astral_textures.rpf`,
 * `astral_textures_2.rpf`… — записи `RPF_FILE` с `overlay`, их словари игра
 * берёт вместо своих по имени; набор изменений — в `GROUP_STARTUP`, пакет —
 * `EXTRACONTENT_COMPAT_PACK`; `order` 105 — выше всех пакетов Rockstar (их
 * словари карты перекрываются тоже) и ниже растительности (110), которая
 * собирается поверх ухудшенных словарей.
 *
 * Собирается один раз помощником RPF и перепроверяется по отпечатку.
 *
 * Второй пакет `astral_textures_b` (модели ЧБ-мира сверх первого, ТЗ
 * 17.10.2026) — та же основа со своими частями, устройством и `order` 106:
 * `prepareTexturesDlcHost({ pack: "b" })`. Третий, `astral_textures_c`
 * (`order` 108, мир на 256 px), — `{ pack: "c" }`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
/* Хост DLC сверяется на каждом «Применить»: отпечаток — из памяти, пока файл тот же (`file-fingerprint.js`, 02.11.2026). */
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import { texturesPackOf } from "@modovik/install-engine/textures-dlc.js";
import { createRpfArchive } from "./rpf-composer.js";

/* 2 — сорок восемь потоковых архивов вместо шестнадцати (модели карты). */
const HOST_SCHEMA = 2;

export function texturesHostMetadata(packId = "a") {
  const pack = texturesPackOf(packId);
  const DEVICE = pack.device;
  const streams = pack.streams.map((name) => `dlc_${DEVICE}:/${name}`);
  const dataFiles = streams
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
      <changeSetName>CCS_${DEVICE}_STREAMING</changeSetName>
      <filesToEnable>${streams.map((stream) => `<Item>${stream}</Item>`).join("")}</filesToEnable>
    </Item>
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

async function hostReady(host, metadataFile) {
  try {
    const metadata = JSON.parse(await fs.readFile(metadataFile, "utf8"));
    const stat = await fs.lstat(host);
    return Boolean(
      metadata.schema === HOST_SCHEMA &&
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size > 16 &&
        metadata.sha256 === (await sha256File(host)),
    );
  } catch {
    return false;
  }
}

/** Основа пакета (`pack` — `a`, `b` или `c`) в кэше приложения — одна на машину. Путь к `dlc.rpf`. */
export async function prepareTexturesDlcHost({ stateDir, gameRoot, edition = "Legacy", create = createRpfArchive, pack: packId = "a" }) {
  const pack = texturesPackOf(packId);
  const directory = path.join(stateDir, "bootstrap", `${pack.id === "a" ? "textures-dlc" : `textures-dlc-${pack.id}`}-v${HOST_SCHEMA}`);
  const host = path.join(directory, "dlc.rpf");
  const metadataFile = path.join(directory, "host.json");
  if (await hostReady(host, metadataFile)) return host;
  /* Основы прежних схем не нужны: движок держит свою копию основы. */
  if (pack.id === "a")
    for (let schema = 1; schema < HOST_SCHEMA; schema += 1)
      await fs.rm(path.join(stateDir, "bootstrap", `textures-dlc-v${schema}`), { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(directory, { recursive: true });
  const stage = path.join(directory, `.stage-${randomUUID()}`);
  await fs.mkdir(stage);
  try {
    const metadata = texturesHostMetadata(pack.id);
    /* Пустых архивов в RPF не бывает: каждый потоковый архив держит метка. */
    const marker = Buffer.from(JSON.stringify({ product: "Astral", schema: HOST_SCHEMA }), "utf8");
    const sources = [
      ["content.xml", Buffer.from(metadata.content, "utf8")],
      ["setup2.xml", Buffer.from(metadata.setup, "utf8")],
      ...pack.streams.map((stream) => [`${stream}/astral_host.json`, marker]),
    ];
    const operations = [];
    for (const [entry, bytes] of sources) {
      const file = path.join(stage, entry.replace(/[\\/]/g, "_"));
      await fs.writeFile(file, bytes);
      operations.push({ entry, source: file, sha256: await sha256File(file), modId: pack.owner, action: "import" });
    }
    const output = path.join(stage, "dlc.rpf");
    const result = await create({ outputArchive: output, archiveTarget: pack.target, edition, gameRoot, operations });
    await fs.rm(host, { force: true });
    await fs.rename(output, host);
    await fs.writeFile(
      metadataFile,
      `${JSON.stringify({ schema: HOST_SCHEMA, sha256: result?.outputSha256 || (await sha256File(host)) }, null, 2)}\n`,
    );
    return host;
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}
