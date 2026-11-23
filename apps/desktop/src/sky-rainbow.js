/*
 * Радуга неба: сборка модели и установка слоем Astral.
 *
 * Своей радуги у GTA V нет, и таймцикл её не нарисует. Поэтому выключатель
 * «Радуга» в редакторе неба ставит отдельный файл — модель Astral в
 * контейнере `x64/astral/astral_sky.rpf` (см. `SkyRainbowCommands.cs` и
 * `sky-rainbow-manifest-trust.js`). Это настоящий пакет движка установки:
 * резервная копия, контрольная точка, строка в `content.xml`, а в библиотеке
 * он виден и снимается отдельно от неба.
 *
 * Модель собирается нативным хостом на машине игрока и детерминирована:
 * одинаковая сборка — те же байты и тот же id пакета, поэтому повторное
 * «Применить» с включённой радугой не пересобирает архив игры.
 *
 * Яркость радуги идёт за небом игрока (`rainbow-light.js`): профиль неба по
 * часам (`skyStops`) присылает тот, кто знает небо, — установка неба или
 * `putSkyRainbow` (`timecycle-customizer.js`), прочитавший его из игры.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { discoverGames } from "@modovik/game-discovery";
import {
  PREVIEW_WEATHER,
  isRainbowSkyStops,
  normalizeRainbow,
  rainbowSkyStops,
  rainbowTiers,
  referenceKeyframeDocument,
} from "@modovik/timecycle";
import {
  SKY_RAINBOW_SCHEMA,
  buildSkyRainbowManifest,
  inspectProfile,
  installLocalSkyRainbowPackage,
  isLocalSkyRainbowManifest,
  isSkyRainbowCurrent,
  isSkyRainbowModId,
  engineInstallEnabled,
  planPackage,
  sha256File,
  skyRainbowFiles,
  uninstallPackage,
} from "@modovik/install-engine";
import {
  composeRpfArchive,
  installRpfPrebuilt,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { callNativeEngine } from "./native-engine.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";
import { compileWithGameDonor } from "./game-donor.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { appLog } from "./app-log.js";

const defaultTools = () => ({
  native: callNativeEngine,
  discover: discoverGames,
  plan: planPackage,
  install: installLocalSkyRainbowPackage,
  uninstall: uninstallPackage,
  readState: inspectProfile,
  composeRpf: composeRpfArchive,
  installPrebuilt: installRpfPrebuilt,
  probeRpf: probeRpfArchive,
  provideContentXml: provideUpdateContentXml,
  provideDlcList: provideLegacyDlcList,
});

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected))
    throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

/* Установка идёт только в копию игры, которую подтвердил поиск Astral:
   id цели движка — её id, а не произвольная строка из запроса. */
async function confirmedGame(gameRoot, discover) {
  const games = await discover();
  const game = (games || []).find(
    (item) =>
      item?.path &&
      path.resolve(item.path).toLowerCase() === gameRoot.toLowerCase(),
  );
  if (!game) throw new Error("Папка GTA V Legacy не подтверждена Astral.");
  if (String(game.edition || "Legacy").toLowerCase() !== "legacy")
    throw new Error("Радуга ставится только в GTA V Legacy.");
  return game;
}

/*
 * Заказ модели: часы и яркость радуги — из настроек редактора
 * (`@modovik/timecycle/rainbow.js`), разложенные по ступеням света неба
 * (`rainbowTiers`): у каждой ступени свои часы и своя доля яркости. Разные
 * часы — разные байты ytyp, а значит и разный id пакета: смена часов в игре —
 * это замена радуги в её слоте, а не вторая радуга рядом. Версия 4 — дуга
 * ступенями; прежние заказы хост больше не собирает. Без неба игрока —
 * ступени по небу ванили: ночью радуга всё равно не сияет.
 */
function compileRequest(settings, skyStops) {
  const rainbow = normalizeRainbow(settings);
  const stops = isRainbowSkyStops(skyStops)
    ? skyStops
    : rainbowSkyStops({ document: referenceKeyframeDocument(PREVIEW_WEATHER) });
  return {
    format: "astral.compile-sky-rainbow",
    version: 4,
    tiers: rainbowTiers(rainbow, stops).map((tier) => ({
      hours: tier.hours,
      brightness: rainbow.brightness * tier.light,
    })),
  };
}

/** Собрать модель и сложить пакет в кэш под хэшем содержимого. */
export async function buildSkyRainbowPackage(
  stateDir,
  context,
  tools = {},
  settings = null,
  skyStops = null,
) {
  const { native } = { ...defaultTools(), ...tools };
  const root = path.join(stateDir || os.tmpdir(), "sky-rainbow");
  const staging = path.join(root, "staging");
  const request = path.join(staging, `${randomUUID()}.json`);
  const output = path.join(staging, randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    const order = compileRequest(settings, skyStops);
    await fs.writeFile(request, JSON.stringify(order));
    /* Донор радуги — `v_16_barglow` из игры игрока (`game-donor.js`); без выключателя или донора — как было: хост. */
    await compileWithGameDonor("compile-sky-rainbow", { input: request, output }, {
      stateDir: stateDir || os.tmpdir(),
      context,
      call: native,
      provision: provisionArchiveSupport,
      log: (entry) => appLog.record(entry),
    });
    const files = [];
    for (const name of skyRainbowFiles(order.tiers.length)) {
      const file = path.join(output, name);
      const stat = await fs.stat(file);
      if (!stat.isFile()) throw new Error(`Радуга собралась без ${name}.`);
      files.push({ name, size: stat.size, sha256: await sha256File(file) });
    }
    const manifest = buildSkyRainbowManifest(files);
    // Самопроверка до установки: иначе расхождение с трастом всплыло бы уже
    // посреди пересборки архива.
    if (!isLocalSkyRainbowManifest(manifest, "Legacy"))
      throw new Error("Собранная радуга не прошла строгую проверку доверия.");
    const packageRoot = path.join(
      root,
      "packages",
      manifest.skyRainbow.sourceDigest.slice("sha256:".length),
    );
    const payload = path.join(packageRoot, "payload");
    await fs.mkdir(payload, { recursive: true });
    for (const file of files) {
      const destination = path.join(payload, file.name);
      await fs.copyFile(path.join(output, file.name), destination);
      // Облачные папки и антивирусы умеют подменять файлы на лету: ставится
      // ровно то, что посчитано.
      if ((await sha256File(destination)) !== file.sha256)
        throw new Error(`Файл радуги ${file.name} изменился при копировании.`);
    }
    return { manifest, packageRoot, order };
  } finally {
    await fs.rm(output, { recursive: true, force: true }).catch(() => {});
    await fs.rm(request, { force: true }).catch(() => {});
  }
}

/*
 * Переигрываемая часть точки группы 2 (`replay.json`, правило фазы 7): модуль, работа, версия,
 * отпечаток пакета и скомпилированный запрос. Сами байты ставятся из постоянного пакета в `stateDir`.
 */
export function skyRainbowReplayRecord(built) {
  return {
    module: "sky-rainbow",
    workId: built.manifest.id,
    version: built.manifest.version,
    sourceDigest: built.manifest.skyRainbow.sourceDigest,
    order: built.order,
  };
}

/*
 * Пакет для переигрывания. Нет файла или файлы не сходятся с отпечатком в записи — отказ, который
 * называет работу: игра при этом не трогается (вызывается до любой записи в архив).
 */
export async function skyRainbowReplayPackage(stateDir, replay) {
  const workName = String(replay?.workId || "радуга");
  const digest = String(replay?.sourceDigest || "");
  const tiers = Array.isArray(replay?.order?.tiers) ? replay.order.tiers.length : 0;
  if (!/^sha256:[0-9a-f]{64}$/.test(digest) || !tiers)
    throw new Error(`Работа «${workName}»: запись переигрывания испорчена — поставьте радугу заново из мастерской.`);
  const packageRoot = path.join(
    stateDir || os.tmpdir(),
    "sky-rainbow",
    "packages",
    digest.slice("sha256:".length),
  );
  const files = [];
  for (const name of skyRainbowFiles(tiers)) {
    const file = path.join(packageRoot, "payload", name);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile())
      throw new Error(`Работа «${workName}»: пакет для переигрывания удалён — поставьте радугу заново из мастерской.`);
    files.push({ name, size: stat.size, sha256: await sha256File(file) });
  }
  if (buildSkyRainbowManifest(files).skyRainbow.sourceDigest !== digest)
    throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — поставьте радугу заново из мастерской.`);
  return { packageRoot, files };
}

/** Пакеты радуги, которые движок числит за этой игрой. */
async function installedRainbows(readState, stateDir, targetId) {
  const state = await readState({ stateDir });
  const target = state?.targets?.[targetId];
  return (target?.installed || []).filter((item) =>
    isSkyRainbowModId(item?.modId),
  );
}

/**
 * Радуги в игре и то, какой схемой каждая поставлена: `current: false` —
 * прежней версией Astral (две дуги или одна без ступеней света), такую окно
 * переставляет тем же замыслом. `schema` — схема этого главного процесса:
 * окно после обновления без перезапуска знает, что ставить ещё нечем.
 */
export async function inspectSkyRainbow(input, context, stateDir, tools = {}) {
  const t = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const game = await confirmedGame(gameRoot, t.discover);
  const current = await installedRainbows(
    t.readState,
    stateDir,
    String(game.id),
  );
  return {
    schema: SKY_RAINBOW_SCHEMA,
    installed: current.map((item) => ({
      modId: item.modId,
      current: isSkyRainbowCurrent(item.version),
    })),
  };
}

/**
 * Привести радугу в игре к выключателю: `enabled` — поставить (или оставить
 * уже стоящую), иначе — снять. `skyStops` — яркость неба игрока по часам
 * (`rainbowSkyStops`), без неё — эталон ванили. Возвращает, что сделано:
 * `installed` / `unchanged` / `removed` / `absent`.
 */
export async function setSkyRainbow(
  input,
  context,
  stateDir,
  { assertRuntimeSafety, ...tools } = {},
) {
  const t = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const enabled = input?.enabled === true;
  const game = await confirmedGame(gameRoot, t.discover);
  const targetId = String(game.id);
  const current = await installedRainbows(t.readState, stateDir, targetId);
  const guard = async () => assertRuntimeSafety?.(gameRoot);
  const engine = {
    rpfComposer: t.composeRpf,
    contentXmlProvider: t.provideContentXml,
    dlcListProvider: t.provideDlcList,
    assertRuntimeSafety: guard,
  };

  if (!enabled) {
    if (!current.length) return { status: "absent" };
    await guard();
    for (const item of current)
      await t.uninstall({ modId: item.modId, targetId, stateDir, ...engine });
    return { status: "removed", modIds: current.map((item) => item.modId) };
  }

  const built = await buildSkyRainbowPackage(
    stateDir,
    context,
    t,
    input?.rainbow ?? null,
    input?.skyStops ?? null,
  );
  /* Радуга в игре одна: всё, что стоит в её слоте, кроме неё самой, уходит. */
  const others = current.filter((item) => item.modId !== built.manifest.id);
  if (others.length < current.length) {
    if (!others.length)
      return { status: "unchanged", modId: built.manifest.id };
    await guard();
    for (const item of others)
      await t.uninstall({ modId: item.modId, targetId, stateDir, ...engine });
    return { status: "unchanged", modId: built.manifest.id };
  }

  await guard();
  const options = {
    manifest: built.manifest,
    packageRoot: built.packageRoot,
    gameRoot,
    targetId,
    edition: "Legacy",
    stateDir,
    allowGameRootWrites: true,
    requireSignature: false,
    ...(typeof t.probeRpf === "function" ? { rpfProbe: t.probeRpf } : {}),
  };
  const planned = await t.plan(options);
  /* Прежняя радуга сменяется новой в своём слоте, а не складывается: и та,
     чьи файлы новая перекрывает, и та, у которой файлы другие (две дуги схемы
     1 — `_am`/`_pm`, одна без ступеней — `_arc`). */
  const replaceModIds = [
    ...new Set([
      ...(planned?.conflicts || []).map((item) => item.modId),
      ...current.map((item) => item.modId),
    ]),
  ].sort();
  /* Флаг `ASTRAL_ENGINE_INSTALL=sky-rainbow`: подмену `update.rpf` ведёт движок, точка получает
     `replay.json`. Без флага — прежний путь, как был. */
  const engineInstall = engineInstallEnabled("sky-rainbow")
    ? {
        install: t.installPrebuilt,
        edition: "Legacy",
        gameRoot,
        pointsRoot: nativeRestorePointsRoot(),
        replay: skyRainbowReplayRecord(built),
      }
    : null;
  await t.install({ ...options, ...engine, replaceModIds, ...(engineInstall ? { engineInstall } : {}) });
  return { status: "installed", modId: built.manifest.id };
}
