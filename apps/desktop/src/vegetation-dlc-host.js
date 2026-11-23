/*
 * Основы пакетов растительности Astral `astral_vegetation` (задача 10,
 * 05.10.2026) и `astral_vegetation_b` (задача 4 ТЗ 06.10.2026) —
 * `content.xml`, `setup2.xml` и пустые потоковые архивы.
 *
 * Устройство — как у мода владельца «зеленый сенди шортс» и у хоста оружия
 * Astral, который в игре работает с 04.10.2026:
 *
 *   • потоковые архивы `astral_vegetation.rpf`, `astral_vegetation_2.rpf`…
 *     — записи `RPF_FILE` с `overlay`: их словари, модели и карты игра берёт
 *     вместо своих по имени (так мод ставит свои `hls_sandy.rpf` и
 *     `hls_tress.rpf`); файлы работы делятся между ними по имени
 *     (`vegetationStreamOf`), чтобы ни один не вырос за гигабайт;
 *   • второй пакет — свои четыре части (`astral_vegetation_5.rpf`…): трава
 *     обеих зон «Травы по миру» не помещается в один архив пакета (меньше
 *     4 ГиБ), файл ложится в пакет своей части;
 *   • набор изменений — в `GROUP_STARTUP`, пакет — `EXTRACONTENT_COMPAT_PACK`:
 *     группу `GROUP_UPDATE_STREAMING` игра выполняет только у своих
 *     patchday, и потоковый архив с ней не монтируется вовсе;
 *   • `order` — выше всех пакетов Rockstar и выше оружия Astral: пакеты
 *     грузятся последними и перекрывают и траву из пакетов дополнений;
 *   • «В разнобой» (задача 7 ТЗ 17.10.2026) — своя основа первого пакета:
 *     запросы `DLC_ITYP_REQUEST` на постоянные типы копий деревьев и кустов
 *     (`astral_vegmix*.ytyp`, как у пакетов Rockstar — свои пропы:
 *     `dlc_mpHeist:/…/hei_lev_des_mp_dlc.ityp`, и как у копий мест) и
 *     пустые типы в тех частях, куда эти файлы ложатся по имени: запрос не
 *     смотрит в пустоту, пока работа не положит свои. Работа без разнобоя
 *     ставится на прежнюю основу — запросов у неё нет.

 *   • файлы сетевой карты (`hei_…` районов mpheist) — архивом
 *     `<пакет>_mp.rpf` во втором наборе изменений, в группе `GROUP_MAP`:
 *     mpheist включает свои архивы районов только там, и правка поверх них
 *     должна идти после него — как у пакета мест (`places-dlc-host.js`) и
 *     сетевых правок Rockstar (`navmeshes.rpf` mp2023…mp2026), 12.10.2026.
 *
 * Собирается один раз помощником RPF и перепроверяется по отпечатку.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sha256File } from "@modovik/install-engine";
import { tracedStep } from "@modovik/install-engine/install-trace.js";
import { fingerprintSha256 } from "@modovik/install-engine/file-fingerprint.js";
import { VEGETATION_DLC_PACKS, VEGETATION_DLC_PACK_C, vegetationArchivesOf, vegetationMapStreamOf, vegetationPackOf, vegetationStreamOf } from "@modovik/install-engine/vegetation-dlc.js";
import { VARIETY_TYPES } from "@modovik/climb-contract/recolor/vegetation-variety";
import { createRpfArchive } from "./rpf-composer.js";
import { assertBaseReadable, baseIsReadable } from "./dlc-archive-check.js";

/* 2 — четыре потоковых архива вместо одного (05.10.2026, `VEGETATION_DLC_STREAMS`).
   У второго пакета (06.10.2026) — своя схема с первой версии.
   3 / 2 — архив сетевой карты в `GROUP_MAP` (12.10.2026). */
const HOST_SCHEMAS = Object.freeze({ astral_vegetation: 3, astral_vegetation_b: 2, astral_vegetation_c: 1 });
/* Основа «В разнобой»: 1 — запросы постоянных типов копий и пустые типы (17.10.2026). */
const VARIETY_HOST_SCHEMA = 1;
const [PACK_A, PACK_B] = VEGETATION_DLC_PACKS;
/* Третий пакет (19.11.2026) — только у работ на три пакета: его основа собирается, когда работа в него пишет. */
const PACK_C = VEGETATION_DLC_PACK_C;

/** Работа пишет в третий пакет — ей нужна и его основа. */
export const vegetationNeedsThirdPack = (manifest) => (manifest?.files || []).some((file) => String(file?.target || "").toLowerCase() === PACK_C.target);

/** Постоянные типы копий «В разнобой», что ложатся в этот пакет (по имени файла). */
export const varietyTypesOfPack = (pack) => VARIETY_TYPES.filter((name) => vegetationPackOf(`${name}.ytyp`) === pack);

/** Работа везёт постоянные типы копий «В разнобой» — ей нужна своя основа. */
export const vegetationNeedsVarietyHost = (manifest) =>
  (manifest?.files || []).some((file) => VARIETY_TYPES.some((name) => String(file?.entry || "").toLowerCase().endsWith(`/${name}.ytyp`)));

/**
 * `content.xml` и `setup2.xml` пакета. `types` — постоянные типы копий
 * «В разнобой» (имена без расширения): запрос на каждый, как у Rockstar —
 * папка устройства и `.ityp`.
 */
export function vegetationHostMetadata(pack = PACK_A, { types = [] } = {}) {
  const { device } = pack;
  const streams = pack.streams.map((name) => `dlc_${device}:/${name}`);
  const requests = types.map((name) => `dlc_${device}:/${name}.ityp`);
  /* Сетевая карта: `hei_` файлы — в `GROUP_MAP`, после mpheist. */
  const mapStream = `dlc_${device}:/${vegetationMapStreamOf(pack)}`;
  const dataFiles = [
    ...[...streams, mapStream].map(
      (stream) => `    <Item>
      <filename>${stream}</filename>
      <fileType>RPF_FILE</fileType>
      <overlay value="true" />
      <disabled value="true" />
      <persistent value="true" />
    </Item>`,
    ),
    ...requests.map(
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
      <filesToEnable>${[...streams, ...requests].map((item) => `<Item>${item}</Item>`).join("")}</filesToEnable>
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

/* Основа готова, если она та же (схема, разнобой, отпечаток) И читается строго: основа, собранная движком с 19.10 по 25.10.2026, держала
   потоковые архивы с корнем не на нуле (`RPF_KEY_MISMATCH`), и по одному отпечатку она переживала обновление приложения (26.10.2026). */
async function hostReady(host, metadataFile, schema, variety = null, readable = baseIsReadable) {
  try {
    const metadata = JSON.parse(await fs.readFile(metadataFile, "utf8"));
    const stat = await fs.lstat(host);
    return Boolean(
      metadata.schema === schema &&
        (metadata.variety ?? null) === variety &&
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size > 16 &&
        metadata.sha256 === (await fingerprintSha256(host)) &&
        (await readable(host)),
    );
  } catch {
    return false;
  }
}

/* Пустые постоянные типы нативным хостом (`compile-place-types` без копий), как у основы мест. */
async function compileEmptyTypes({ name, directory, compile }) {
  if (typeof compile !== "function") throw new Error("Сборщик типов копий «В разнобой» не подключён — обновите Astral.");
  const request = path.join(directory, `${name}.request.json`);
  const output = path.join(directory, `${name}.ytyp`);
  await fs.writeFile(request, JSON.stringify({ format: "astral.compile-place-types", version: 1, typesName: name, sources: [], clones: [] }));
  await compile("compile-place-types", { input: request, output });
  return output;
}

/**
 * Основа одного пакета в кэше приложения — одна на машину. Путь к `dlc.rpf`.
 * `variety` — основа «В разнобой» (запросы постоянных типов копий), если в
 * этот пакет ложатся их файлы; `compile` — нативный хост для пустых типов.
 */
async function preparePackHost(pack, { stateDir, gameRoot, edition = "Legacy", create = createRpfArchive, variety = false, compile = null, readable = baseIsReadable, keysProvider = null }) {
  const schema = HOST_SCHEMAS[pack.name];
  const types = variety ? varietyTypesOfPack(pack) : [];
  const mix = types.length ? VARIETY_HOST_SCHEMA : null;
  /* У первого пакета — прежняя папка: основа, собранная до 06.10.2026, годится. Основа разнобоя — рядом, своя. */
  const folder = mix ? `${pack.bases}-mix-v${schema}.${mix}` : pack === PACK_A ? `vegetation-dlc-v${schema}` : `${pack.bases}-v${schema}`;
  const directory = path.join(stateDir, "bootstrap", folder);
  const host = path.join(directory, "dlc.rpf");
  const metadataFile = path.join(directory, "host.json");
  if (await tracedStep("готовность основы", () => hostReady(host, metadataFile, schema, mix, readable))) return host;
  await fs.mkdir(directory, { recursive: true });
  const stage = path.join(directory, `.stage-${randomUUID()}`);
  await fs.mkdir(stage);
  try {
    const metadata = vegetationHostMetadata(pack, { types });
    /* Пустых архивов в RPF не бывает: каждый потоковый архив держит метка. */
    const marker = Buffer.from(JSON.stringify({ product: "Astral", schema }), "utf8");
    const sources = [
      ["content.xml", Buffer.from(metadata.content, "utf8")],
      ["setup2.xml", Buffer.from(metadata.setup, "utf8")],
      ...vegetationArchivesOf(pack).map((stream) => [`${stream}/astral_host.json`, marker]),
    ];
    /* «В разнобой»: пустые типы на своих местах — работа кладёт свои поверх. */
    for (const name of types) {
      const file = await compileEmptyTypes({ name, directory: stage, compile });
      sources.push([`${vegetationStreamOf(`${name}.ytyp`)}/${name}.ytyp`, await fs.readFile(file)]);
    }
    const operations = [];
    for (const [entry, bytes] of sources) {
      const file = path.join(stage, entry.replace(/[\\/]/g, "_"));
      await fs.writeFile(file, bytes);
      operations.push({ entry, source: file, sha256: await sha256File(file), modId: pack.owner, action: "import" });
    }
    const output = path.join(stage, "dlc.rpf");
    const result = await create({ outputArchive: output, archiveTarget: pack.target, edition, gameRoot, operations });
    /* Новая основа читается так же строго, как её прочтёт игра: нечитаемую в кэш не кладём (движок до обхода 25.10 писал такие). */
    await assertBaseReadable(output, { name: pack.name, expect: { device: pack.device, order: pack.order, streams: vegetationArchivesOf(pack) }, ...(keysProvider ? { keysProvider } : {}) });
    await fs.rm(host, { force: true });
    await fs.rename(output, host);
    await fs.writeFile(
      metadataFile,
      `${JSON.stringify({ schema, ...(mix ? { variety: mix } : {}), sha256: result?.outputSha256 || (await sha256File(host)) }, null, 2)}\n`,
    );
    return host;
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

/** Основа первого пакета (`astral_vegetation`). Путь к `dlc.rpf`. */
export const prepareVegetationDlcHost = (options) => preparePackHost(PACK_A, options);

/** Основы пакетов — опции движка `{ vegetationDlcHost, vegetationDlcBHost }`; с `thirdPack` — ещё `vegetationDlcCHost`. */
export async function prepareVegetationDlcHosts(options) {
  return {
    vegetationDlcHost: await preparePackHost(PACK_A, options),
    vegetationDlcBHost: await preparePackHost(PACK_B, options),
    ...(options?.thirdPack ? { vegetationDlcCHost: await preparePackHost(PACK_C, options) } : {}),
  };
}
