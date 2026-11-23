/*
 * Готовый набор звуков из папки мода.
 *
 * Звуковые моды раздают файлами `.awc` — банками звуковых архивов игры.
 * Инструкция автора всегда одна и та же: сделайте резервную копию, откройте
 * OpenIV, зайдите в `x64/audio/sfx/RESIDENT.rpf` и `WEAPONS_PLAYER.rpf`,
 * включите режим правки и перетащите файлы внутрь. Это ровно та работа, от
 * которой приложение избавляет: здесь папку читают, банки узнают, каждый
 * проверяют настоящим разбором AWC и ставят одной операцией — с резервной
 * копией, точкой отката и снятием в один клик.
 *
 * Папку принимают в трёх видах, потому что раздают во всех трёх:
 *
 *   1. Как устроен архив:  x64/audio/sfx/RESIDENT.rpf/weapons.awc
 *   2. Только архивом:     RESIDENT.rpf/weapons.awc
 *   3. Плоско:             weapons.awc, ptl_pistol.awc, sht_pump.awc
 *
 * Третий вид — самый частый и самый неудобный для программы: в имени файла
 * нет архива. Он разбирается тем, что имена банков RESIDENT.rpf и
 * WEAPONS_PLAYER.rpf не пересекаются, и по имени банка архив определяется
 * однозначно. Банк окружения плоским именем не разобрать (их 263, имена
 * держит игра) — такой файл честно откладывается с объяснением, а не
 * угадывается.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  canonicalManifest,
  engineInstallEnabled,
  getProfile,
  installLocalSoundPackPackage,
  isSoundPackEntry,
  planLocalSoundPackPackage,
  SOUND_PACK_ARCHIVES,
  soundPackArchiveOfBank,
  soundPackBankOfEntry,
  soundPackSourceDigest,
  uninstallPackage,
} from "@modovik/install-engine";
import { describeBank } from "@modovik/sound-studio";
import {
  composeRpfArchive,
  inspectAwc,
  installRpfPrebuilt,
  probeRpfArchive,
  searchRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";
import { soundPackReplayRecord } from "./sound-pack-replay.js";

const MOD_ID_PATTERN = /^local-sound-pack-[a-f0-9]{12}$/;
const MAX_WALK_DEPTH = 12;
const MAX_FILES = 64;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_FILE_BYTES = 96 * 1024 * 1024;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function refusal(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: "wx" });
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

const ARCHIVE_BY_NAME = new Map(
  SOUND_PACK_ARCHIVES.map((archive) => [
    archive.split("/").pop().toLowerCase(),
    archive,
  ]),
);

/**
 * Куда в игре ложится этот файл.
 *
 * Сначала пробуем прочитать путь как есть — если в нём уже назван звуковой
 * архив, спорить не о чем. Иначе решает имя банка, и только для тех архивов,
 * где имена перечислены. Возврат `null` — это «не знаю», и такой файл идёт в
 * отложенные с причиной, а не в игру наугад.
 */
export function soundPackEntryOf(relativePath) {
  const parts = String(relativePath || "")
    .split("/")
    .filter(Boolean);
  const file = parts.at(-1) || "";
  if (!file.toLowerCase().endsWith(".awc")) return null;
  const bank = file.slice(0, -4).toLowerCase();
  const parent = parts.at(-2)?.toLowerCase() || "";
  const archive = ARCHIVE_BY_NAME.get(parent) || soundPackArchiveOfBank(bank);
  if (!archive) return null;
  const entry = `${archive}/${bank}.awc`;
  return isSoundPackEntry(entry) ? { entry, archive, bank } : null;
}

/** Что в папке годится для установки, а что нет. */
export async function collectSoundPack(sourceRoot) {
  const raw = String(sourceRoot || "");
  if (!raw || !path.isAbsolute(raw))
    throw refusal(
      "SOUND_PACK_SOURCE_MISSING",
      "Нужен абсолютный путь к папке со звуками.",
    );
  const root = path.resolve(raw);
  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    throw refusal("SOUND_PACK_SOURCE_MISSING", "Папка со звуками не найдена.");
  }
  if (!stat.isDirectory())
    throw refusal(
      "SOUND_PACK_SOURCE_MISSING",
      "Путь к звукам не является папкой.",
    );

  const files = [];
  const skipped = [];
  const claimed = new Map();
  const walk = async (directory, depth) => {
    if (depth > MAX_WALK_DEPTH)
      throw refusal(
        "SOUND_PACK_TOO_DEEP",
        "Папка со звуками вложена слишком глубоко.",
      );
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const item of entries) {
      const absolutePath = path.join(directory, item.name);
      if (item.isSymbolicLink()) {
        skipped.push({ name: item.name, reason: "symlink" });
        continue;
      }
      if (item.isDirectory()) {
        await walk(absolutePath, depth + 1);
        continue;
      }
      if (!item.isFile()) continue;
      const relative = path
        .relative(root, absolutePath)
        .split(path.sep)
        .join("/");
      const resolved = soundPackEntryOf(relative);
      if (!resolved) {
        skipped.push({
          name: relative,
          reason: relative.toLowerCase().endsWith(".awc")
            ? "unknown-bank"
            : "not-a-sound-bank",
        });
        continue;
      }
      /*
       * Один банк — один файл. Наборы часто несут и `RESIDENT.rpf/weapons.awc`,
       * и его копию рядом; молча взять последнюю значило бы поставить не то,
       * что человек видел в списке.
       */
      const seen = claimed.get(resolved.entry);
      if (seen) {
        skipped.push({ name: relative, reason: "duplicate-bank" });
        continue;
      }
      const info = await fs.stat(absolutePath);
      if (info.size > MAX_FILE_BYTES) {
        skipped.push({ name: relative, reason: "too-big" });
        continue;
      }
      claimed.set(resolved.entry, relative);
      files.push({
        ...resolved,
        absolutePath,
        source: relative,
        size: info.size,
      });
    }
  };
  await walk(root, 0);

  if (!files.length)
    throw refusal(
      "SOUND_PACK_EMPTY",
      "В папке нет банков игры: нужны файлы .awc — например weapons.awc, ptl_pistol.awc или папка RESIDENT.rpf с ними внутри.",
    );
  if (files.length > MAX_FILES)
    throw refusal(
      "SOUND_PACK_TOO_MANY",
      "В папке слишком много звуковых банков.",
    );
  const bytes = files.reduce((total, file) => total + file.size, 0);
  if (bytes > MAX_TOTAL_BYTES)
    throw refusal(
      "SOUND_PACK_TOO_BIG",
      "Набор звуков больше допустимого размера.",
    );
  return { root, files, skipped, bytes };
}

/**
 * Разбор банка настоящим парсером AWC.
 *
 * Расширение `.awc` ничего не гарантирует: в наборах попадаются обрезанные
 * файлы, чужие форматы и переименованные архивы. Игра на таком банке не
 * падает красиво — она замолкает или вылетает, и разбираться человеку придётся
 * уже в игре. Поэтому каждый банк открывается тем же разбором, что и банк из
 * архива, до того как что-то будет записано.
 */
async function verifyBank({ file, gameRoot, inspect }) {
  try {
    const result = await inspect({
      input: file.absolutePath,
      gameRoot,
      edition: "Legacy",
    });
    const resource = result?.resource || {};
    const streams = Number(resource.streamCount ?? resource.streams?.length);
    if (!Number.isFinite(streams) || streams < 1)
      throw new Error("в банке нет ни одной дорожки");
    return {
      streams,
      multiChannel: resource.multiChannelFlag === true,
    };
  } catch (error) {
    throw refusal(
      "SOUND_PACK_BAD_BANK",
      `Файл ${file.source} не читается как звуковой банк игры: ${
        error?.message || error
      }`,
    );
  }
}

/*
 * Есть ли такой банк в архиве игры.
 *
 * Действие у набора одно — `replace`, то есть занять существующую запись. В
 * архивах, где имена банков держит сама игра (двигатели, боль, рация, фон —
 * под семьсот имён), опечатка в имени файла превратилась бы в замену записи,
 * которой нет, и человек узнал бы об этом отказом из глубины установки.
 * Поэтому оглавление архива читается один раз на архив, и незнакомый банк
 * откладывается по имени — там же, где откладывается всё остальное.
 */
async function archiveBanks({ gameRoot, archive, listBanks }) {
  const result = await listBanks({
    archivePath: path.join(gameRoot, ...archive.split("/")),
    gameRoot,
    edition: "Legacy",
    query: ".awc",
    maxMatches: 2000,
  });
  return new Set(
    (result?.matches || [])
      .map((item) => String(item.name || "").toLowerCase())
      .filter((name) => name.endsWith(".awc"))
      .map((name) => name.slice(0, -4)),
  );
}

export function buildSoundPackManifest({ name, files }) {
  const digest = soundPackSourceDigest(files);
  return {
    id: `local-sound-pack-${digest.slice(0, 12)}`,
    version: `1.0.0-${digest.slice(0, 12)}`,
    name: `Astral sound: ${name}`.slice(0, 120),
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    gameplayChanges: false,
    /* Только запись в существующий контейнер: набор занимает банки игры на
       их местах и не заводит своего архива. */
    capabilities: ["rpf-container-entry-v1"],
    slots: files
      .map(
        (file) =>
          `sound-bank-${soundPackBankOfEntry(file.entry).replace(/[^a-z0-9]+/g, "-")}`,
      )
      .sort(),
    soundPack: {
      schemaVersion: 1,
      sourceDigest: `sha256:${digest}`,
      bankCount: files.length,
    },
    /* Архив и банк порознь — так адаптер `rpf-entry` устроен у всего
       движка; слитный адрес остаётся путём в кэше пакета. */
    files: files.map((file) => ({
      source: `payload/${file.entry}`,
      target: file.archive,
      action: "replace",
      entry: `${file.bank}.awc`,
      size: file.size,
      sha256: file.sha256,
    })),
  };
}

/**
 * Пакет из папки: банки копируются в кэш под своими записями.
 *
 * Папка адресуется содержимым, поэтому один и тот же набор не пересобирается
 * при повторной установке, а другой набор — это другой пакет и другой мод в
 * тех же слотах.
 */
export async function buildSoundPackPackage({
  sourceRoot,
  name,
  stateDir,
  gameRoot,
  inspect = inspectAwc,
  listBanks = searchRpfArchive,
}) {
  const collected = await collectSoundPack(sourceRoot);
  const files = [];
  const skipped = [...collected.skipped];
  /* Оглавление читается по разу на архив, а не по разу на банк. */
  const known = new Map();
  for (const file of collected.files) {
    if (!known.has(file.archive))
      known.set(
        file.archive,
        await archiveBanks({ gameRoot, archive: file.archive, listBanks }),
      );
    if (!known.get(file.archive).has(file.bank)) {
      skipped.push({ name: file.source, reason: "not-in-game-archive" });
      continue;
    }
    const verified = await verifyBank({ file, gameRoot, inspect });
    const bytes = await fs.readFile(file.absolutePath);
    files.push({ ...file, ...verified, bytes, sha256: sha256(bytes) });
  }
  if (!files.length)
    throw refusal(
      "SOUND_PACK_EMPTY",
      "Ни один банк из папки не нашёлся в звуковых архивах игры.",
    );
  const manifest = buildSoundPackManifest({
    name: String(name || path.basename(collected.root) || "звуки"),
    files,
  });
  const digest = manifest.soundPack.sourceDigest.replace(/^sha256:/, "");
  const directory = path.join(
    stateDir,
    "sound-packs",
    "packages",
    digest.slice(0, 12),
  );
  for (const file of files) {
    const target = path.join(directory, "payload", ...file.entry.split("/"));
    const current = await fs.readFile(target).catch(() => null);
    if (!current || !current.equals(file.bytes))
      await atomicWrite(target, file.bytes);
  }
  return Object.freeze({
    directory,
    root: collected.root,
    skipped,
    manifest,
    manifestHash: `sha256:${sha256(Buffer.from(canonicalManifest(manifest)))}`,
    digest: manifest.soundPack.sourceDigest,
    banks: files.map((file) => ({
      entry: file.entry,
      archive: file.archive,
      bank: file.bank,
      title: describeBank(file.bank, file.archive).title,
      source: file.source,
      streams: file.streams,
      size: file.size,
      sha256: file.sha256,
    })),
    bytes: collected.bytes,
  });
}

function installOptions(built, input, stateDir, extra = {}) {
  return {
    manifest: built.manifest,
    packageRoot: built.directory,
    gameRoot: path.resolve(String(input.gameRoot || "")),
    targetId: String(input.targetId || "default"),
    edition: "Legacy",
    stateDir,
    // Набор пишется в настоящие звуковые архивы; право даёт строгая форма
    // манифеста, а не этот флаг сам по себе.
    allowGameRootWrites: true,
    requireSignature: false,
    rpfProbe: probeRpfArchive,
    ...extra,
  };
}

const replacementIds = (plan) =>
  [...new Set((plan.conflicts || []).map((item) => item.modId))].sort();

const summary = (built) => ({
  modId: built.manifest.id,
  digest: built.digest,
  manifestHash: built.manifestHash,
  banks: built.banks,
  archives: [...new Set(built.banks.map((bank) => bank.archive))].sort(),
  skipped: built.skipped,
  bytes: built.bytes,
  edition: "Legacy",
  restartRequired: true,
});

export async function planSoundPack(input, stateDir, dependencies = {}) {
  const gameRoot = path.resolve(String(input?.gameRoot || ""));
  await dependencies.assertGameReady?.(gameRoot, { mutate: false });
  const built = await buildSoundPackPackage({ ...input, gameRoot, stateDir });
  const plan = await planLocalSoundPackPackage(
    installOptions(built, input, stateDir),
  );
  return {
    ...plan,
    ...summary(built),
    replaceModIds: replacementIds(plan),
    rollbackReady: true,
  };
}

export async function applySoundPack(input, stateDir, dependencies = {}) {
  const gameRoot = path.resolve(String(input?.gameRoot || ""));
  const game = await dependencies.assertGameReady?.(gameRoot, { mutate: true });
  const built = await buildSoundPackPackage({ ...input, gameRoot, stateDir });
  if (built.manifestHash !== input.expectedManifestHash)
    throw new Error("План установки набора звуков устарел.");
  const currentPlan = await planLocalSoundPackPackage(
    installOptions(built, input, stateDir),
  );
  /* Флаг `ASTRAL_ENGINE_INSTALL=sound-packs`: банки в архивах игры — одна точка на все архивы набора. */
  const engineInstall = engineInstallEnabled("sound-packs")
    ? {
        install: dependencies.installPrebuilt ?? installRpfPrebuilt,
        edition: "Legacy",
        gameRoot,
        pointsRoot: nativeRestorePointsRoot(),
        multi: true,
        replay: soundPackReplayRecord(built),
      }
    : null;
  const installed = await installLocalSoundPackPackage(
    installOptions(built, input, stateDir, {
      replaceModIds: replacementIds(currentPlan),
      rpfComposer: composeRpfArchive,
      dlcListProvider: provideLegacyDlcList,
      contentXmlProvider: provideUpdateContentXml,
      assertRuntimeSafety: () => dependencies.assertRuntimeSafety?.(game),
      /* Пересборка архива игры идёт десятки секунд. Без вестей окно
         выглядит зависшим, и человек закрывает его посреди работы. */
      onProgress: dependencies.onProgress,
      ...(engineInstall ? { engineInstall } : {}),
    }),
  );
  return {
    ...installed,
    ...summary(built),
    installId: built.manifest.id,
    kind: "local-sound-pack",
    status: "active",
    gameRoot,
    targetId: String(input.targetId || "default"),
    installedAt: new Date().toISOString(),
  };
}

export async function removeSoundPack(input, stateDir, dependencies = {}) {
  const gameRoot = path.resolve(String(input?.gameRoot || ""));
  const game = await dependencies.assertGameReady?.(gameRoot, { mutate: true });
  const modId = String(input?.modId || "");
  if (!MOD_ID_PATTERN.test(modId))
    throw new Error("Некорректный modId набора звуков.");
  const result = await uninstallPackage({
    modId,
    targetId: String(input?.targetId || "default"),
    stateDir,
    rpfComposer: composeRpfArchive,
    contentXmlProvider: provideUpdateContentXml,
    dlcListProvider: provideLegacyDlcList,
    assertRuntimeSafety: () => dependencies.assertRuntimeSafety?.(game),
    onProgress: dependencies.onProgress,
  });
  return {
    ...result,
    installId: modId,
    modId,
    kind: "local-sound-pack",
    status: "rolled-back",
    restartRequired: true,
    gameRoot,
    targetId: String(input?.targetId || "default"),
  };
}

export async function installedSoundPacks(stateDir, targetId) {
  const profile = await getProfile({ stateDir });
  const target = profile.targets?.[String(targetId || "default")];
  return (target?.installed || []).filter((item) =>
    MOD_ID_PATTERN.test(String(item.modId || "")),
  );
}
