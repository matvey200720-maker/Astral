import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CLOTHING_DLC_TARGET,
  provisionClothingDlc,
  sha256File,
} from "@modovik/install-engine";
import {
  composeRpfArchive,
  createRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { ENTRY_MATERIALIZERS } from "./entry-materializers.js";

/* 3 — пакет запуска (`GROUP_STARTUP`, `EXTRACONTENT_COMPAT_PACK`), как у
   Astral Audio и Astral Weapons: с `GROUP_UPDATE_STREAMING` игра потоки
   хоста не монтировала (`weapon-dlc-provisioner.js`, 04.10.2026). */
const HOST_SCHEMA = 3;
const CLOTHING_STREAMS = Object.freeze([
  "astral_stream_00.rpf",
  "astral_stream_01.rpf",
]);

function clothingHostMetadata() {
  const device = "ASTRAL_CLOTHING";
  const streams = CLOTHING_STREAMS.map((name) => `dlc_${device}:/${name}`);
  const dataFiles = streams
    .map(
      (stream) =>
        `    <Item><filename>${stream}</filename><fileType>RPF_FILE</fileType><overlay value="true" /><disabled value="true" /><persistent value="true" /></Item>`,
    )
    .join("\n");
  const filesToEnable = streams
    .map((stream) => `<Item>${stream}</Item>`)
    .join("");
  return {
    content: `<?xml version="1.0" encoding="utf-8"?>
<CDataFileMgr__ContentsOfDataFileXml>
  <disabledFiles />
  <includedXmlFiles />
  <dataFiles>
${dataFiles}
  </dataFiles>
  <contentChangeSets>
    <Item><changeSetName>CCS_${device}_STREAMING</changeSetName><filesToEnable>${filesToEnable}</filesToEnable></Item>
  </contentChangeSets>
  <patchFiles />
</CDataFileMgr__ContentsOfDataFileXml>
`,
    setup: `<?xml version="1.0" encoding="utf-8"?>
<SSetupData>
  <deviceName>dlc_${device}</deviceName><datFile>content.xml</datFile><timeStamp>01/01/2026 00:00:00</timeStamp><nameHash>${device}</nameHash><contentChangeSets />
  <contentChangeSetGroups><Item><NameHash>GROUP_STARTUP</NameHash><ContentChangeSets><Item>CCS_${device}_STREAMING</Item></ContentChangeSets></Item></contentChangeSetGroups>
  <startupScript /><scriptCallstackSize value="0" /><type>EXTRACONTENT_COMPAT_PACK</type><order value="101" /><minorOrder value="0" /><isLevelPack value="false" /><dependencyPackHash /><requiredVersion /><subPackCount value="0" />
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
      metadata.sha256 === (await sha256File(host)),
    );
  } catch {
    return false;
  }
}

async function prepareHost({ stateDir, gameRoot, edition }) {
  const directory = path.join(stateDir, "bootstrap", "clothing-dlc-v1");
  const host = path.join(directory, "dlc.rpf");
  const metadataFile = path.join(directory, "host.json");
  if (await hostReady(host, metadataFile)) return host;
  await fs.mkdir(directory, { recursive: true });
  const stageDirectory = path.join(directory, `.stage-${randomUUID()}`);
  await fs.mkdir(stageDirectory, { recursive: false });
  try {
    const metadata = clothingHostMetadata();
    const content = path.join(stageDirectory, "content.xml");
    const setup = path.join(stageDirectory, "setup2.xml");
    const marker = path.join(stageDirectory, "astral_host.json");
    await Promise.all([
      fs.writeFile(content, metadata.content, "utf8"),
      fs.writeFile(setup, metadata.setup, "utf8"),
      fs.writeFile(
        marker,
        JSON.stringify({ product: "Astral", schema: HOST_SCHEMA }),
        "utf8",
      ),
    ]);
    const output = path.join(stageDirectory, "dlc.rpf");
    const sources = [
      ["content.xml", content],
      ["setup2.xml", setup],
      ...CLOTHING_STREAMS.map((stream) => [
        `${stream}/astral_host.json`,
        marker,
      ]),
    ];
    const operations = await Promise.all(
      sources.map(async ([entry, source]) => ({
        entry,
        source,
        sha256: await sha256File(source),
        modId: "@astral-clothing-host",
        action: "import",
      })),
    );
    const result = await createRpfArchive({
      outputArchive: output,
      archiveTarget: CLOTHING_DLC_TARGET,
      edition,
      gameRoot,
      operations,
    });
    await fs.rm(host, { force: true });
    await fs.rename(output, host);
    await fs.writeFile(
      metadataFile,
      JSON.stringify(
        {
          schema: HOST_SCHEMA,
          sha256: result.outputSha256 || (await sha256File(host)),
          archiveFix: result.archiveFix || null,
        },
        null,
        2,
      ),
      "utf8",
    );
    return host;
  } finally {
    await fs
      .rm(stageDirectory, { recursive: true, force: true })
      .catch(() => {});
  }
}

export async function provisionClothingInfrastructure({
  gameRoot,
  targetId,
  edition,
  stateDir,
  assertRuntimeSafety,
  onProgress,
  activate = false,
}) {
  if (edition !== "Legacy") {
    return { ready: false, changed: false, reason: "unsupported-edition" };
  }
  const baseDlc = await prepareHost({ stateDir, gameRoot, edition });
  return provisionClothingDlc({
    gameRoot,
    targetId,
    edition,
    stateDir,
    baseDlc,
    rpfComposer: composeRpfArchive,
    dlcListProvider: provideLegacyDlcList,
    contentXmlProvider: provideUpdateContentXml,
    materializers: ENTRY_MATERIALIZERS,
    assertRuntimeSafety,
    onProgress,
    activate,
  });
}
