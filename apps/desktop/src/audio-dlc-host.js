/*
 * Основа звукового пакета Astral (`update/x64/dlcpacks/astral_audio/dlc.rpf`).
 *
 * Пакет устроен как пакеты Rockstar со звуком (mpreplay — обновление звука
 * оружия): `setup2.xml` с группой GROUP_STARTUP и `content.xml` с тремя
 * файлами — настройки (AUDIO_GAMEDATA), звуки (AUDIO_SOUNDDATA) и папка
 * волн (AUDIO_WAVEPACK). В content.xml пути — `….dat`, игра дописывает
 * `151.rel`/`54.rel` сама, а в архиве лежат `….dat151.rel` и `….dat54.rel`:
 * так же, как у пакетов игры и у звуковых дополнений сообщества.
 *
 * Порядок 102 — после всех пакетов Rockstar (у последних 56) и после
 * оружия и одежды Astral: объект с тем же именем в более позднем пакете
 * заменяет прежний, и переопределение ствола должно грузиться последним.
 *
 * В основе файлы метаданных пустые: объекты стволов в них складывает
 * установка (`audio-chunk-composer.js`). Пустой пакет в dlclist.xml не
 * попадает — движок регистрирует его с первым стволом.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AUDIO_DLC_TARGET } from "@modovik/install-engine";
/* Хост DLC сверяется на каждой установке звука: отпечаток — из памяти, пока файл тот же (`file-fingerprint.js`, 02.11.2026). */
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import { buildRel } from "@modovik/sound-studio/rel-edit";
import { createRpfArchive } from "./rpf-composer.js";

/* Сменилась форма основы — основа собирается заново, и движок кладёт слои
   стволов поверх новой. */
const HOST_SCHEMA = 2;
const DEVICE = "dlc_ASTRAL_AUDIO";

const audioFiles = [
  ["astral_audio_game.dat", "AUDIO_GAMEDATA"],
  ["astral_audio_sounds.dat", "AUDIO_SOUNDDATA"],
];

export function audioHostMetadata() {
  const files = [
    ...audioFiles.map(([name, type]) => [
      `${DEVICE}:/%PLATFORM%/audio/${name}`,
      type,
    ]),
    [`${DEVICE}:/%PLATFORM%/audio/sfx/dlc_astral_audio`, "AUDIO_WAVEPACK"],
  ];
  const item = ([filename, type]) => `    <Item>
      <filename>${filename}</filename>
      <fileType>${type}</fileType>
      <overlay value="false" />
      <disabled value="true" />
      <persistent value="false" />
    </Item>`;
  return {
    content: `<?xml version="1.0" encoding="UTF-8"?>
<CDataFileMgr__ContentsOfDataFileXml>
  <disabledFiles />
  <includedXmlFiles />
  <dataFiles>
${files.map(item).join("\n")}
  </dataFiles>
  <contentChangeSets>
    <Item>
      <changeSetName>ASTRAL_AUDIO_AUTOGEN</changeSetName>
      <filesToEnable>
${files.map(([filename]) => `        <Item>${filename}</Item>`).join("\n")}
      </filesToEnable>
    </Item>
  </contentChangeSets>
  <patchFiles />
</CDataFileMgr__ContentsOfDataFileXml>
`,
    setup: `<?xml version="1.0" encoding="UTF-8"?>
<SSetupData>
  <deviceName>${DEVICE}</deviceName>
  <datFile>content.xml</datFile>
  <timeStamp>26/09/2026 00:00:00</timeStamp>
  <nameHash>ASTRAL_AUDIO</nameHash>
  <contentChangeSets />
  <contentChangeSetGroups>
    <Item>
      <NameHash>GROUP_STARTUP</NameHash>
      <ContentChangeSets>
        <Item>ASTRAL_AUDIO_AUTOGEN</Item>
      </ContentChangeSets>
    </Item>
  </contentChangeSetGroups>
  <startupScript />
  <scriptCallstackSize value="0" />
  <type>EXTRACONTENT_COMPAT_PACK</type>
  <order value="102" />
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

/**
 * Основа пакета в кэше приложения — одна на машину; собирается один раз
 * помощником RPF и перепроверяется по отпечатку.
 */
export async function prepareAudioDlcHost({
  stateDir,
  gameRoot,
  edition = "Legacy",
  create = createRpfArchive,
}) {
  const directory = path.join(stateDir, "bootstrap", `audio-dlc-v${HOST_SCHEMA}`);
  const host = path.join(directory, "dlc.rpf");
  const metadataFile = path.join(directory, "host.json");
  if (await hostReady(host, metadataFile)) return host;
  await fs.mkdir(directory, { recursive: true });
  const stage = path.join(directory, `.stage-${randomUUID()}`);
  await fs.mkdir(stage);
  try {
    const metadata = audioHostMetadata();
    const sources = [
      ["content.xml", Buffer.from(metadata.content, "utf8")],
      ["setup2.xml", Buffer.from(metadata.setup, "utf8")],
      ["x64/audio/astral_audio_game.dat151.rel", buildRel({ type: 151 })],
      ["x64/audio/astral_audio_sounds.dat54.rel", buildRel({ type: 54 })],
    ];
    const operations = [];
    for (const [entry, bytes] of sources) {
      const file = path.join(stage, entry.replace(/[\\/]/g, "_"));
      await fs.writeFile(file, bytes);
      operations.push({
        entry,
        source: file,
        sha256: await sha256File(file),
        modId: "@astral-audio-host",
        action: "import",
      });
    }
    const output = path.join(stage, "dlc.rpf");
    const result = await create({
      outputArchive: output,
      archiveTarget: AUDIO_DLC_TARGET,
      edition,
      gameRoot,
      operations,
    });
    await fs.rm(host, { force: true });
    await fs.rename(output, host);
    await fs.writeFile(
      metadataFile,
      `${JSON.stringify(
        {
          schema: HOST_SCHEMA,
          sha256: result?.outputSha256 || (await sha256File(host)),
        },
        null,
        2,
      )}\n`,
    );
    return host;
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}
