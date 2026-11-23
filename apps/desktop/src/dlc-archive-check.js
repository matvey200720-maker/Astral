/*
 * «Игра увидит пакет?» — проверка своих пакетов дополнения Astral тем же строгим читателем, каким их читает игра
 * (`@modovik/rpf7`; Хелпер 16 и Хелпер 15, 26.10.2026 — две проверки сведены в одну).
 *
 * Установка считалась удавшейся, когда сборка вернула файл: ни строку пакета в dlclist.xml, ни вложенные архивы, ни content.xml
 * со setup2.xml никто не перечитывал, а основа пакета жила в кэше вечно по одному отпечатку. Жалоба владельца — дороги и растительность
 * «установлены» в библиотеке, а в игре их нет. Основа, которую с 19.10 по 25.10 создавал движок, держала потоковые архивы с корнем
 * не на нуле (`RPF_KEY_MISMATCH`); движок при установке заново пишет корень только тех потоков, куда что-то легло.
 *
 * Здесь это проверяется на собранных архивах ДО подмены файлов в игре: отказ оставляет игру как была, а в библиотеку работа не
 * попадает (`OWN_DLC_UNREADABLE`, семейство `own-dlc-unreadable` в `installFailure.js`). Установщик зовёт проверку хуком `dlcVerifier`
 * (`own-dlcs.js`, `verifyOwnDlcPacks`); набор подключает её флагом `verifyOwnDlc` в `GAME_SETS` (`recolor-customizer.js`).
 *
 * Что смотрит (звенья, по которым игра подключает пакет):
 *   • dlc.rpf раскрывается, КАЖДЫЙ потоковый архив раскрывается, имена в пакете строчными;
 *   • content.xml объявляет ровно те потоки, что лежат внутри; архив, который он не подключает, игра не увидит;
 *   • каждый объявленный поток включён набором изменений группы, которую игра выполняет (`GROUP_STARTUP`, у сетевой карты —
 *     `GROUP_MAP`), и объявлен с overlay (`astral-dlc-host-startup-group`; `GROUP_UPDATE_STREAMING` поток не монтирует);
 *   • setup2.xml — `EXTRACONTENT_COMPAT_PACK`, устройство совпадает с content.xml и `nameHash`, а для известных пакетов
 *     (`OWN_PACK_EXPECTATIONS`) — ещё и их устройство, порядок и потоки;
 *   • записи, которые состояние установки числит в пакете, лежат в нём;
 *   • dlclist.xml обновления называет пакет.
 *
 * Отказывает только по доказанному изъяну. Нет ключей ArchiveFix, не читается сам update.rpf — проверка пропускается с записью в
 * журнал: то, чего нельзя прочесть, не причина считать пакет битым.
 */

import fs from "node:fs/promises";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import { governedReadWrapper } from "@modovik/install-engine/governed-read.js";
import { ROADS_DLC_PACKS, roadsArchivesOf } from "@modovik/install-engine/roads-dlc.js";
import { VEGETATION_DLC_ALL_PACKS, vegetationArchivesOf } from "@modovik/install-engine/vegetation-dlc.js";
import { setOwnDlcHealNotice } from "@modovik/install-engine/own-dlcs.js";
import { appLog } from "./app-log.js";
import { archiveSupportDirectory } from "./loader-provisioner.js";
import { ensureArchiveTail, tailProblemOf } from "./rpf-tail.js";

export const OWN_DLC_UNREADABLE = "OWN_DLC_UNREADABLE";

/* Самопочинка регистрации своих пакетов (`own-dlcs.js`) пишет в журнал установки тем же журналом, что и самопроверка. */
setOwnDlcHealNotice((entry) => appLog.record({ source: "install", ...entry }));

/*
 * Известные пакеты: архив пакета в игре → что про него известно заранее (устройство, порядок, потоки). Пакет, которого здесь нет,
 * проверяется по собственным файлам (content.xml ↔ setup2.xml ↔ потоки). Новый пакет добавляет сюда строку.
 */
export const OWN_PACK_EXPECTATIONS = new Map([
  ...ROADS_DLC_PACKS.map((pack) => [pack.target.toLowerCase(), { name: pack.name, device: pack.device, order: pack.order, streams: roadsArchivesOf(pack) }]),
  ...VEGETATION_DLC_ALL_PACKS.map((pack) => [pack.target.toLowerCase(), { name: pack.name, device: pack.device, order: pack.order, streams: vegetationArchivesOf(pack) }]),
]);

const PACK_PATH = /^update\/x64\/dlcpacks\/([a-z0-9_]+)\/dlc\.rpf$/i;
const UPDATE_TARGET = "update/update.rpf";
const DLC_LIST_ENTRY = "common/data/dlclist.xml";
/* Группы, которые игра выполняет: запуск и вход в сетевую карту (`astral-dlc-host-startup-group`, `mp-map-hei-files-group-map`). */
const MOUNTING_GROUPS = Object.freeze(["GROUP_STARTUP", "GROUP_MAP"]);
const SHOWN = 3;

const lower = (value) => String(value || "").replaceAll("\\", "/").toLowerCase();
const text = async (archive, name) => Buffer.from(await archive.read(name)).toString("utf8");

/* ---------------- разбор content.xml и setup2.xml ---------------- */

/** Все значения тега по порядку: `<filename>x</filename>` → `["x"]`. */
const tagValues = (xml, name) => [...String(xml).matchAll(new RegExp(`<${name}\\b[^>]*>\\s*([^<]*?)\\s*</${name}>`, "gi"))].map((match) => match[1]);
const attributeValue = (xml, name) => (new RegExp(`<${name}\\b[^>]*\\bvalue="([^"]*)"`, "i").exec(String(xml)) || [])[1] ?? "";
/** Блок `<tag>…</tag>` целиком (первый). */
const block = (xml, name) => (new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(String(xml)) || [])[1] ?? "";

/** Потоковые архивы, что называет `content.xml`: `{ device, stream, overlay }` (только записи `RPF_FILE`; запросы типов не в счёт). */
export function declaredStreams(content) {
  const found = [];
  /* Кусок на запись dataFiles: внутри `filesToEnable` свои `Item`, поэтому по `</Item>` не режем. */
  for (const item of block(content, "dataFiles").split(/(?=<Item>\s*<filename>)/i)) {
    if (!/<fileType>\s*RPF_FILE\s*<\/fileType>/i.test(item)) continue;
    const name = /<filename>\s*dlc_([A-Za-z0-9_]+):\/([^<\s]+)\s*<\/filename>/.exec(item);
    if (name) found.push({ device: name[1], stream: name[2], overlay: /<overlay\s+value="true"/i.test(item) });
  }
  return found;
}

/** Наборы изменений content.xml: имя → файлы, что набор включает (`dlc_<устройство>:/…`). */
export function changeSetsOf(content) {
  const sets = new Map();
  /* Кусок на набор: от `changeSetName` до следующего. */
  for (const chunk of String(block(content, "contentChangeSets")).split(/(?=<changeSetName>)/i)) {
    const name = (/<changeSetName>\s*([^<]*?)\s*<\/changeSetName>/i.exec(chunk) || [])[1];
    if (name) sets.set(name, tagValues(block(chunk, "filesToEnable"), "Item"));
  }
  return sets;
}

/** Группы setup2.xml: имя группы → наборы изменений, что она включает. */
export function groupsOf(setup) {
  const groups = new Map();
  /* Только внутри `contentChangeSetGroups`: у пакета есть и свой `nameHash` — другой тег, регистр которого различает XML игры. */
  for (const chunk of block(setup, "contentChangeSetGroups").split(/(?=<NameHash>)/)) {
    const name = (/<NameHash>\s*([^<]*?)\s*<\/NameHash>/.exec(chunk) || [])[1];
    if (name) groups.set(name, [...(groups.get(name) || []), ...tagValues(block(chunk, "ContentChangeSets"), "Item")]);
  }
  return groups;
}

/* ---------------- что игра увидит в одном пакете ---------------- */

/**
 * `{ problems, streams, entries }`: `problems` пуст — игра пакет увидит. `expected` — записи работы (`<поток>/<имя>`, строчными),
 * которые состояние числит в пакете; `expect` — что известно о пакете (`{ device, order, streams }`, `OWN_PACK_EXPECTATIONS`).
 */
export async function inspectOwnDlcPack(file, { keys, open = openRpfFile, expected = null, expect = {} } = {}) {
  const problems = [];
  const entries = new Set();
  let archive;
  try {
    archive = await open(file, { keys, readWrapper: governedReadWrapper(file) });
  } catch (error) {
    return { problems: [`dlc.rpf не открывается (${error?.code || "ошибка"}: ${String(error?.message || error).slice(0, 160)})`], streams: [], entries };
  }
  try {
    const list = archive.entries || [];
    const byPath = new Map(list.map((item) => [lower(item.path), item]));
    for (const item of list) {
      const path = lower(item.path);
      if (item.kind !== "directory" && path.includes("/") && !path.endsWith("/astral_host.json")) entries.add(path);
      /* Имена в RPF — строчными (`gta-archive-names-lowercase`): игра ищет по хэшу строчного имени. */
      if (item.kind !== "directory" && String(item.path) !== String(item.path).toLowerCase()) problems.push(`имя «${item.path}» не строчными — игра не найдёт запись`);
    }
    let content = "";
    let setup = "";
    if (!byPath.has("content.xml")) problems.push("в пакете нет content.xml");
    else
      try {
        content = await text(archive, "content.xml");
      } catch (error) {
        problems.push(`content.xml не читается (${String(error?.message || error).slice(0, 120)})`);
      }
    if (!byPath.has("setup2.xml")) problems.push("в пакете нет setup2.xml");
    else
      try {
        setup = await text(archive, "setup2.xml");
      } catch (error) {
        problems.push(`setup2.xml не читается (${String(error?.message || error).slice(0, 120)})`);
      }
    const streams = declaredStreams(content);
    if (content && !streams.length) problems.push("content.xml не называет ни одного потокового архива");
    const groups = groupsOf(setup);
    const sets = changeSetsOf(content);
    const device = (/<deviceName>\s*dlc_([A-Za-z0-9_]+)\s*<\/deviceName>/.exec(setup) || [])[1] || "";
    const mounted = new Set(MOUNTING_GROUPS.flatMap((group) => groups.get(group) || []).flatMap((name) => sets.get(name) || []));
    for (const { device: streamDevice, stream, overlay } of streams) {
      if (device && streamDevice !== device) problems.push(`content.xml держит устройство ${streamDevice}, а setup2.xml — ${device}`);
      const record = byPath.get(lower(stream));
      if (!record) {
        problems.push(`${stream} объявлен в content.xml, а в пакете его нет`);
        continue;
      }
      if (record.problem) problems.push(`${stream} не раскрывается (${record.problem.code})`);
      else if (!list.some((item) => lower(item.path).startsWith(`${lower(stream)}/`))) problems.push(`${stream} пуст — читатель не видит в нём ни одной записи`);
      if (!overlay) problems.push(`${stream} объявлен без overlay: игра не подставит его файлы вместо своих`);
      if (!mounted.has(`dlc_${streamDevice}:/${stream}`)) problems.push(`${stream} не включён набором изменений групп GROUP_STARTUP или GROUP_MAP — игра его не смонтирует`);
    }
    /* Архив, который лежит в пакете, а content.xml его не называет, игра не увидит; поток, которого пакет ждёт, но нет вовсе, — тоже. */
    const declared = new Set(streams.map((item) => lower(item.stream)));
    for (const item of list)
      if (item.kind !== "directory" && !item.path.includes("/") && /\.rpf$/i.test(item.path) && !declared.has(lower(item.path))) problems.push(`архив ${item.path} лежит в пакете, но content.xml его не подключает — игра его не увидит`);
    for (const stream of expect.streams || []) if (!byPath.has(lower(stream)) && !declared.has(lower(stream))) problems.push(`в пакете нет архива ${stream}`);
    /* Набор, что включает файл, которого content.xml не объявил, и группа, с которой потоковый архив не монтируется. */
    const files = new Set(tagValues(block(content, "dataFiles"), "filename"));
    for (const [set, enabled] of sets) for (const file of enabled) if (!files.has(file)) problems.push(`content.xml: набор ${set} включает ${file}, которого нет среди dataFiles`);
    for (const [group, wanted] of groups) {
      if (group === "GROUP_UPDATE_STREAMING") problems.push("setup2.xml: набор в GROUP_UPDATE_STREAMING — потоковый архив пакета с ней не монтируется (нужен GROUP_STARTUP или GROUP_MAP)");
      for (const set of wanted) if (content && !sets.has(set)) problems.push(`setup2.xml: группа ${group} включает набор ${set}, а в content.xml его нет`);
    }
    /* setup2.xml. */
    if (setup) {
      const type = (/<type>\s*([^<]*?)\s*<\/type>/i.exec(setup) || [])[1] || "";
      if (type !== "EXTRACONTENT_COMPAT_PACK") problems.push(`setup2.xml: тип пакета ${type || "не указан"}, нужен EXTRACONTENT_COMPAT_PACK`);
      if (attributeValue(setup, "isLevelPack") === "true") problems.push("setup2.xml: isLevelPack true — потоковый архив пакета с ним не монтируется");
      const nameHash = (/<nameHash>\s*([^<]*?)\s*<\/nameHash>/i.exec(setup) || [])[1] || "";
      if (device && lower(device) !== lower(nameHash)) problems.push(`setup2.xml: deviceName dlc_${device} не совпадает с nameHash «${nameHash}»`);
      if (expect.device && lower(device) !== lower(expect.device)) problems.push(`setup2.xml: устройство dlc_${device}, ожидали dlc_${expect.device}`);
      if (expect.order != null && Number(attributeValue(setup, "order")) !== Number(expect.order)) problems.push(`setup2.xml: порядок ${attributeValue(setup, "order")}, ожидали ${expect.order}`);
    }
    for (const entry of expected || []) if (!entries.has(lower(entry))) problems.push(`запись ${entry} стоит в состоянии установки, а в пакете её нет`);
    return { problems, streams: streams.map((item) => item.stream), entries };
  } finally {
    await archive.close?.();
  }
}

/** Ключи читателя; `null` — набора ArchiveFix нет или он неполный (проверить нечем). */
async function readerKeys(keysProvider) {
  try {
    const keys = await keysProvider();
    return keys?.ngKeys && keys?.ngTables ? keys : null;
  } catch {
    return null;
  }
}

const defaultKeys = () => keysFromDirectory(archiveSupportDirectory());

/**
 * Основа пакета (`dlc.rpf` из кэша приложения) читается строго? `false` — только по доказанному изъяну: раскрылся `dlc.rpf`, прочитан
 * `content.xml`, а потоковый архив не раскрывается или пакет собран не по правилам. Нечем проверить (нет ключей, пакет вовсе не RPF) —
 * `true`: основу решает отпечаток, как прежде. Одна функция на все хосты: `hostReady` зовёт её третьим условием.
 */
export async function baseIsReadable(file, { keysProvider = defaultKeys, open = openRpfFile, expect = {} } = {}) {
  const keys = await readerKeys(keysProvider);
  if (!keys) return true;
  const result = await inspectOwnDlcPack(file, { keys, open, expect });
  return result.streams.length === 0 || result.problems.length === 0;
}

const unreadable = (name, problems) => {
  const shown = problems.slice(0, SHOWN).join("; ");
  const error = new Error(`Игра не откроет собранный пакет Astral «${name}»: ${shown}${problems.length > SHOWN ? ` (и ещё ${problems.length - SHOWN})` : ""}. В игру ничего не записано.`);
  error.code = OWN_DLC_UNREADABLE;
  error.pack = name;
  error.problems = problems;
  return error;
};

/**
 * Свежесобранная основа читается строго? Нет — отказ словами, в кэш она не ложится (`OWN_DLC_UNREADABLE`). Нечем проверить — пропуск.
 */
export async function assertBaseReadable(file, { name, expect = {}, keysProvider = defaultKeys, open = openRpfFile } = {}) {
  const keys = await readerKeys(keysProvider);
  if (!keys) return { status: "skipped" };
  const result = await inspectOwnDlcPack(file, { keys, open, expect });
  if (result.problems.length && result.streams.length) throw unreadable(name, result.problems);
  return { status: "ready" };
}

/** Пакеты, названные в `dlclist.xml` обновления, строчными; `null` — список не прочитан (проверка пропускается). */
async function registeredPacks(updateFile, { keys, open, log }) {
  let archive;
  try {
    archive = await open(updateFile, { keys, nested: false, readWrapper: governedReadWrapper(updateFile) });
    const xml = await text(archive, DLC_LIST_ENTRY);
    return new Set([...xml.matchAll(/<Item>\s*dlcpacks:\/([^/<\s]+)\/\s*<\/Item>/gi)].map((item) => item[1].toLowerCase()));
  } catch (error) {
    log({ level: "warn", source: "own-dlc", message: "Самопроверка: dlclist.xml обновления не прочитан — регистрацию пакета не проверяю.", detail: String(error?.message || error) });
    return null;
  } finally {
    await archive?.close?.();
  }
}

/**
 * Проверка собранных пакетов перед подменой файлов в игре. `affected` — то, что установка собирается подменить
 * (`{ relativePath, livePath, sourcePath }`); `ownTargets` — архивы своих пакетов, которые проверяются; `expectedEntries` —
 * архив пакета → записи работы (`<поток>/<имя>`), что состояние числит в нём.
 * Отказ — ошибка с кодом `OWN_DLC_UNREADABLE`, текст по-русски: окно называет его семейством (`installFailure.js`).
 */
export async function verifyOwnDlcsReadable({
  affected = [],
  ownTargets = [],
  expectedEntries = new Map(),
  root = "",
  keysProvider = defaultKeys,
  open = openRpfFile,
  log = (entry) => appLog.record(entry),
} = {}) {
  const wanted = new Set(ownTargets.map(lower));
  const packs = affected.filter((item) => wanted.has(lower(item.relativePath)) && PACK_PATH.test(lower(item.relativePath)));
  if (!packs.length) return { status: "nothing", checked: [] };
  let keys = null;
  try {
    keys = await keysProvider();
  } catch (error) {
    log({ level: "warn", source: "own-dlc", message: "Самопроверка пакетов пропущена: ключи ArchiveFix не прочитались.", detail: String(error?.message || error) });
    return { status: "skipped", checked: [] };
  }
  if (!keys?.ngKeys || !keys?.ngTables) {
    log({ level: "warn", source: "own-dlc", message: "Самопроверка пакетов пропущена: набор ключей ArchiveFix неполный." });
    return { status: "skipped", checked: [] };
  }
  const checked = [];
  for (const item of packs) {
    const name = PACK_PATH.exec(lower(item.relativePath))[1];
    const file = item.sourcePath || item.livePath;
    const known = OWN_PACK_EXPECTATIONS.get(lower(item.relativePath));
    const result = await inspectOwnDlcPack(file, { keys, open, expected: expectedEntries.get(lower(item.relativePath)) || null, expect: known || {} });
    checked.push({ name, streams: result.streams.length, entries: result.entries.size, problems: result.problems.length });
    if (result.problems.length) {
      log({ level: "error", source: "own-dlc", message: `Самопроверка: игра не откроет пакет «${name}» — установка остановлена до записи в игру.`, detail: result.problems.join("\n").slice(0, 4000) });
      throw unreadable(name, result.problems);
    }
  }
  /* Регистрация: пакет назван в `dlclist.xml` обновления — собранного этой установкой или стоящего в игре. */
  const update = affected.find((item) => lower(item.relativePath) === UPDATE_TARGET);
  const updateFile = update?.sourcePath || (root ? `${String(root).replace(/[\\/]+$/, "")}/${UPDATE_TARGET}` : "");
  if (updateFile && (await fs.stat(updateFile).then(() => true, () => false))) {
    const names = await registeredPacks(updateFile, { keys, open, log });
    if (names)
      for (const { name } of checked)
        if (!names.has(name)) {
          log({ level: "error", source: "own-dlc", message: `Самопроверка: пакет «${name}» не назван в dlclist.xml — игра его не загрузит.` });
          throw unreadable(name, ["в dlclist.xml обновления его нет — игра его не загрузит"]);
        }
  }
  log({ level: "info", source: "own-dlc", message: `Самопроверка: игра увидит ${checked.map((item) => `${item.name} (${item.streams} потоков, ${item.entries} записей)`).join(", ")}.` });
  return { status: "ready", checked };
}

/** Хук установщика `dlcVerifier` с общими настройками (ключи, читатель, журнал). */
export const ownDlcVerifier = (options = {}) => (context) => verifyOwnDlcsReadable({ ...options, ...context });

/* ---------------- контейнеры слоя Astral в update.rpf ---------------- */

const LAYER_ENTRY = /^x64\/astral\/([a-z0-9][a-z0-9._-]{0,119}\.rpf)\/(.+)$/;
const STREAMING_SET = "CCS_TITLE_UPDATE_STREAMING";
/* Так Astral объявляет контейнер в content.xml (`ASTRAL_REGISTRATION_ROOT`: `%PLATFORM%` игра подставляет сама — `x64`); прямой путь x64 игра читает так же. */
const registrationNames = (name) => new Set([`update:/%platform%/astral/${name}`, `update:/x64/astral/${name}`]);

/** Записи состояния установки в контейнерах слоя → `имя контейнера → записи внутри` (строчными). */
function layerContainersOf(entries) {
  const containers = new Map();
  for (const entry of entries) {
    const match = LAYER_ENTRY.exec(lower(entry));
    if (!match) continue;
    containers.set(match[1], [...(containers.get(match[1]) || []), lower(entry)]);
  }
  return containers;
}

/**
 * Игра увидит контейнеры слоя Astral (`x64/astral/<имя>.rpf` в update.rpf: мод каталога, арена, залазы, интерьеры)? Арена автора
 * Blink x Skye (26.10) ставилась бы двумя контейнерами, и «установлено» ничего не говорило о том, что игра их откроет. Проверка —
 * строгим читателем `rpf7`, на собранном update.rpf до подмены файлов: каждый контейнер лежит под строчным именем и раскрывается
 * (корень на нуле), записи, что состояние числит за ним, на месте, контейнер объявлен в content.xml (`RPF_FILE`, overlay) и включён
 * набором `CCS_TITLE_UPDATE_STREAMING` — ровно так, как автор регистрирует свою арену.
 *
 * `entries` — записи update.rpf, что состояние числит за слоем (`x64/astral/<контейнер>/<имя>`). `{ problems, containers }`.
 */
export async function inspectLayerContainers(file, { keys, open = openRpfFile, entries = [] } = {}) {
  const wanted = layerContainersOf(entries);
  const problems = [];
  if (!wanted.size) return { problems, containers: [] };
  let archive;
  try {
    archive = await open(file, { keys, nested: false, readWrapper: governedReadWrapper(file) });
  } catch (error) {
    return { problems: [`update.rpf не открывается (${error?.code || "ошибка"}: ${String(error?.message || error).slice(0, 160)})`], containers: [] };
  }
  try {
    const byPath = new Map((archive.entries || []).map((item) => [lower(item.path), item]));
    let content = "";
    try {
      content = await text(archive, "content.xml");
    } catch (error) {
      problems.push(`content.xml обновления не читается (${String(error?.message || error).slice(0, 120)})`);
    }
    const items = block(content, "dataFiles").split(/(?=<Item>\s*<filename>)/i);
    const streaming = new Set((changeSetsOf(content).get(STREAMING_SET) || []).map(lower));
    for (const [name, inside] of wanted) {
      const path = `x64/astral/${name}`;
      const record = byPath.get(path);
      if (!record) {
        problems.push(`${name} стоит в состоянии установки, а в update.rpf его нет`);
        continue;
      }
      /* Имя контейнера строчными: «x64/Astral» делал контейнеры невидимыми для игры (ERR_SYS_FILELOAD). */
      if (String(record.path) !== path) problems.push(`имя «${record.path}» не строчными — игра не найдёт контейнер`);
      let child = null;
      try {
        child = await archive.open(path);
      } catch (error) {
        problems.push(`${name} не раскрывается (${error?.code || String(error?.message || error).slice(0, 120)})`);
      }
      if (child) {
        const have = new Set((child.entries || []).filter((item) => item.kind !== "directory").map((item) => lower(item.path)));
        for (const entry of inside) if (!have.has(entry)) problems.push(`запись ${entry.slice(path.length + 1)} стоит в состоянии установки, а в ${name} её нет`);
        for (const item of child.entries || [])
          if (item.kind !== "directory" && String(item.path) !== String(item.path).toLowerCase()) problems.push(`имя «${String(item.path).slice(path.length + 1)}» в ${name} не строчными — игра не найдёт запись`);
      }
      const written = registrationNames(name);
      const registered = items.find((item) => tagValues(item, "filename").some((filename) => written.has(lower(filename))));
      if (!content) continue;
      if (!registered || !/<fileType>\s*RPF_FILE\s*<\/fileType>/i.test(registered)) problems.push(`${name} не объявлен в content.xml как RPF_FILE — игра его не подключит`);
      else if (!/<overlay\s+value="true"/i.test(registered)) problems.push(`${name} объявлен без overlay: игра не подставит его файлы вместо своих`);
      if (![...written].some((filename) => streaming.has(filename))) problems.push(`${name} не включён набором ${STREAMING_SET} — игра его не смонтирует`);
    }
    return { problems, containers: [...wanted.keys()] };
  } finally {
    await archive.close?.();
  }
}

/* `archiveTarget` — носитель, чей хвост проверяется (`update/update2.rpf`); без него — `update/update.rpf`, как было. */
const defaultTailCheck = ({ file, archiveTarget = "update/update.rpf" }) => ensureArchiveTail({ file, archiveTarget, check: true });

/**
 * Проверка контейнеров слоя перед подменой update.rpf (хук `layerVerifier`, `own-dlcs.js: verifyAstralLayers`). Отказ — ошибка с
 * кодом `OWN_DLC_UNREADABLE`, как у пакетов дополнения. Нет ключей ArchiveFix — пропуск с записью в журнал.
 */
export async function verifyLayerContainers({
  file,
  entries = [],
  keysProvider = defaultKeys,
  open = openRpfFile,
  log = (entry) => appLog.record(entry),
  tailCheck = defaultTailCheck,
  archiveTarget = "",
} = {}) {
  /* Носитель без регистрации в content.xml (`update2.rpf`): проверяется только хвост (правило то же, ключ шапки — по имени носителя); контейнеры слоя и ключи не нужны. */
  if (archiveTarget && archiveTarget !== "update/update.rpf" && file) {
    const name = String(archiveTarget).split("/").pop();
    const carrierProblem = tailProblemOf(await tailCheck({ file, archiveTarget }).catch(() => null), name);
    if (carrierProblem) {
      log({ level: "error", source: "own-dlc", message: `Самопроверка: хвост ${name} короче запаса — установка остановлена, в игру ничего не записано.`, detail: carrierProblem });
      throw unreadable(name, [carrierProblem]);
    }
    return { status: "ready", containers: [] };
  }
  if (!layerContainersOf(entries).size || !file) return { status: "nothing", containers: [] };
  /* Хвост файла (20.11.2026, `rpf-tail.js`): маленький вложенный архив последним, конец файла сразу за ним — игра падает на входе в сюжет.
     Отказ до подмены файла в игре, тем же кодом; движок не ответил — пропуск, как без ключей. */
  const tailProblem = tailProblemOf(await tailCheck({ file }).catch(() => null));
  if (tailProblem) {
    log({ level: "error", source: "own-dlc", message: "Самопроверка: хвост update.rpf короче запаса — установка остановлена, в игру ничего не записано.", detail: tailProblem });
    throw unreadable([...layerContainersOf(entries).keys()].join(", ") || "update.rpf", [tailProblem]);
  }
  const keys = await readerKeys(keysProvider);
  if (!keys) {
    log({ level: "warn", source: "own-dlc", message: "Самопроверка контейнеров слоя пропущена: набор ключей ArchiveFix не прочитался или неполный." });
    return { status: "skipped", containers: [] };
  }
  const result = await inspectLayerContainers(file, { keys, open, entries });
  if (result.problems.length) {
    log({ level: "error", source: "own-dlc", message: "Самопроверка: игра не откроет контейнеры Astral — установка остановлена до записи в игру.", detail: result.problems.join("\n").slice(0, 4000) });
    throw unreadable(result.containers.join(", ") || "update.rpf", result.problems);
  }
  log({ level: "info", source: "own-dlc", message: `Самопроверка: игра увидит контейнеры Astral ${result.containers.join(", ")}.` });
  return { status: "ready", containers: result.containers };
}

/** Хук установщика `layerVerifier` с общими настройками. */
export const layerContainersVerifier = (options = {}) => (context) => verifyLayerContainers({ ...options, ...context });
