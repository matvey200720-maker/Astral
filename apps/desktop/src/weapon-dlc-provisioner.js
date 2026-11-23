import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  engineInstallEnabled,
  FAST_WEAPON_DLC_TARGET,
  provisionFastWeaponDlc,
  sha256File,
} from "@modovik/install-engine";
import {
  composeRpfArchive,
  createRpfArchive,
  installRpfPrebuilt,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";
import { ENTRY_MATERIALIZERS } from "./entry-materializers.js";

/*
 * 4 — пакет запуска (`GROUP_STARTUP`, `EXTRACONTENT_COMPAT_PACK`), как у
 * Astral Audio. До 04.10.2026 хост объявлялся пакетом обновления
 * (`GROUP_UPDATE_STREAMING`, `EXTRACONTENT_LEVEL_PACK`): эту группу игра
 * выполняет только у своих patchday, и `astral_stream.rpf` не монтировался
 * вовсе — журнал OpenIV.asi на живой игре: `dlcpacks:/astral_weapons/dlc.rpf`
 * открыт, `dlc_ASTRAL_WEAPONS:/astral_stream.rpf` — ни разу. Скины оружия и
 * стволы каталога в игре не появлялись.
 */
const HOST_SCHEMA = 4;

function weaponHostMetadata() {
  const device = "ASTRAL_WEAPONS";
  const stream = `dlc_${device}:/astral_stream.rpf`;
  return {
    content: `<?xml version="1.0" encoding="utf-8"?>
<CDataFileMgr__ContentsOfDataFileXml>
  <disabledFiles />
  <includedXmlFiles />
  <dataFiles>
    <Item>
      <filename>${stream}</filename>
      <fileType>RPF_FILE</fileType>
      <overlay value="true" />
      <disabled value="true" />
      <persistent value="true" />
    </Item>
  </dataFiles>
  <contentChangeSets>
    <Item>
      <changeSetName>CCS_${device}_STREAMING</changeSetName>
      <filesToEnable><Item>${stream}</Item></filesToEnable>
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
  <order value="100" />
  <minorOrder value="0" />
  <isLevelPack value="false" />
  <dependencyPackHash />
  <requiredVersion />
  <subPackCount value="0" />
</SSetupData>
`,
  };
}

async function existingHostReady(host, metadataFile) {
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

async function prepareWeaponHost({ stateDir, gameRoot, edition }) {
  const directory = path.join(stateDir, "bootstrap", "fast-weapons-v1");
  const host = path.join(directory, "dlc.rpf");
  const metadataFile = path.join(directory, "host.json");
  if (await existingHostReady(host, metadataFile)) return host;
  await fs.mkdir(directory, { recursive: true });
  const stageDirectory = path.join(directory, `.stage-${randomUUID()}`);
  await fs.mkdir(stageDirectory, { recursive: false });
  try {
    const metadata = weaponHostMetadata();
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
      ["astral_stream.rpf/astral_host.json", marker],
    ];
    const operations = await Promise.all(
      sources.map(async ([entry, source]) => ({
        entry,
        source,
        sha256: await sha256File(source),
        modId: "@astral-fast-weapon-host",
        action: "import",
      })),
    );
    const result = await createRpfArchive({
      outputArchive: output,
      archiveTarget: FAST_WEAPON_DLC_TARGET,
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

export async function provisionFastWeaponInfrastructure({
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
  const baseDlc = await prepareWeaponHost({ stateDir, gameRoot, edition });
  /* Флаг `ASTRAL_ENGINE_INSTALL=provision-hosts`: подготовка хоста — точкой движка `kind=provision`. */
  const engineInstall = engineInstallEnabled("provision-hosts")
    ? { install: installRpfPrebuilt, pointsRoot: nativeRestorePointsRoot() }
    : null;
  return provisionFastWeaponDlc({
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
    ...(engineInstall ? { engineInstall } : {}),
  });
}
