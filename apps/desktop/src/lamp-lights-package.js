/*
 * Фонари мастерской: правленые модели фонарей и описание пропов слоем Astral.
 *
 * Модели фонарей и `v_traffic_lights.ytyp` живут в `x64h.rpf`, а Astral пишет
 * только в update.rpf. Поэтому правленые копии ставятся настоящим пакетом
 * движка установки в свой контейнер `x64/astral/astral_lights.rpf`
 * (`lamp-lights-manifest-trust.js`): резервная копия, контрольная точка,
 * строка в content.xml с `overlay`, и игра берёт одноимённые модели оттуда.
 *
 * Пакет детерминирован: те же файлы — тот же id, и повторное «Применить» с
 * тем же видом фонарей архив игры не пересобирает.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverGames } from "@modovik/game-discovery";
import {
  engineInstallEnabled,
  inspectProfile,
  installLocalLampLightsPackage,
  planPackage,
  sha256File,
  uninstallPackage,
} from "@modovik/install-engine";
import {
  buildLampLightsManifest,
  isLampLightsFileName,
  isLampLightsModId,
  isLocalLampLightsManifest,
} from "@modovik/install-engine/lamp-lights-manifest-trust.js";
import {
  composeRpfArchive,
  installRpfPrebuilt,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";

const defaultTools = () => ({
  discover: discoverGames,
  plan: planPackage,
  install: installLocalLampLightsPackage,
  uninstall: uninstallPackage,
  readState: inspectProfile,
  composeRpf: composeRpfArchive,
  installPrebuilt: installRpfPrebuilt,
  probeRpf: probeRpfArchive,
  provideContentXml: provideUpdateContentXml,
  provideDlcList: provideLegacyDlcList,
});

/* Установка идёт только в копию игры, которую подтвердил поиск Astral. */
async function confirmedGame(gameRoot, discover) {
  const games = await discover();
  const game = (games || []).find(
    (item) =>
      item?.path &&
      path.resolve(item.path).toLowerCase() === gameRoot.toLowerCase(),
  );
  if (!game) throw new Error("Папка GTA V Legacy не подтверждена Astral.");
  if (String(game.edition || "Legacy").toLowerCase() !== "legacy")
    throw new Error("Фонари ставятся только в GTA V Legacy.");
  return game;
}

/** Пакеты фонарей, которые движок числит за этой игрой. */
export async function installedLampLights(readState, stateDir, targetId) {
  const state = await readState({ stateDir });
  const target = state?.targets?.[targetId];
  return (target?.installed || []).filter((item) => isLampLightsModId(item?.modId));
}

async function describeFiles(files) {
  const described = [];
  for (const file of files) {
    const name = String(file?.name || "");
    if (!isLampLightsFileName(name))
      throw new Error(`Файл ${name} не относится к фонарям — в пакет он не идёт.`);
    const stat = await fs.stat(file.source);
    described.push({ name, source: file.source, size: stat.size, sha256: await sha256File(file.source) });
  }
  const manifest = buildLampLightsManifest(described);
  if (!isLocalLampLightsManifest(manifest, "Legacy"))
    throw new Error("Собранные фонари не прошли строгую проверку доверия.");
  return { described, manifest };
}

/** Собрать пакет из готовых файлов и сложить его в кэш под хэшем. */
export async function buildLampLightsPackage(stateDir, files) {
  const { described, manifest } = await describeFiles(files);
  const packageRoot = path.join(
    stateDir || os.tmpdir(),
    "lamp-lights",
    "packages",
    manifest.lampLights.sourceDigest.slice("sha256:".length),
  );
  const payload = path.join(packageRoot, "payload");
  await fs.mkdir(payload, { recursive: true });
  for (const file of described) {
    const destination = path.join(payload, file.name);
    await fs.copyFile(file.source, destination);
    if ((await sha256File(destination)) !== file.sha256)
      throw new Error(`Файл фонарей ${file.name} изменился при копировании.`);
  }
  return { manifest, packageRoot, files: described.map(({ name, size, sha256 }) => ({ name, size, sha256 })) };
}

/*
 * Запись переигрывания фонарей (`engineReplay`, шаг 3 фазы 7, за флагом `ASTRAL_ENGINE_INSTALL=lamp-lights-package`):
 * имя пакета, отпечаток и список файлов. Сами файлы лежат в постоянной папке пакета в `stateDir`.
 */
export function lampLightsReplayRecord(built) {
  return {
    module: "lamp-lights-package",
    workId: built.manifest.id,
    version: built.manifest.version,
    sourceDigest: built.manifest.lampLights.sourceDigest,
    order: { files: built.files.map(({ name, size, sha256 }) => ({ name, size, sha256 })) },
  };
}

/*
 * Пакет фонарей для переигрывания: файлы на месте, их SHA-256 и размеры — те, что в записи, а
 * манифест, пересобранный из них, даёт тот же дайджест. Иначе — отказ, который называет работу.
 */
export async function lampLightsReplayPackage(stateDir, replay) {
  const workName = String(replay?.workId || "фонари");
  const digest = String(replay?.sourceDigest || "");
  const listed = Array.isArray(replay?.order?.files) ? replay.order.files : [];
  if (!/^sha256:[0-9a-f]{64}$/.test(digest) || !listed.length)
    throw new Error(`Работа «${workName}»: запись переигрывания испорчена — поставьте работу заново из мастерской.`);
  const packageRoot = path.join(
    path.resolve(String(stateDir || "")),
    "lamp-lights",
    "packages",
    digest.slice("sha256:".length),
  );
  const files = [];
  for (const item of listed) {
    const name = String(item?.name || "");
    if (!isLampLightsFileName(name))
      throw new Error(`Работа «${workName}»: запись переигрывания испорчена — поставьте работу заново из мастерской.`);
    const file = path.join(packageRoot, "payload", name);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile())
      throw new Error(`Работа «${workName}»: пакет для переигрывания удалён — переустановите работу из мастерской.`);
    const sha256 = await sha256File(file);
    if (sha256 !== String(item.sha256 || "") || stat.size !== item.size)
      throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите работу из мастерской.`);
    files.push({ name, size: stat.size, sha256 });
  }
  const rebuilt = buildLampLightsManifest(files);
  if (rebuilt.lampLights.sourceDigest !== digest || rebuilt.id !== replay.workId)
    throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите работу из мастерской.`);
  return { packageRoot, files };
}

/**
 * Что станет с пакетом при этих файлах — без записи в игру. `changes` —
 * тронет ли установка архив: от этого зависит, в каком порядке сборка
 * фонарей ставит свои части (`lamp-studio.js`).
 */
export async function planLampLightsPackage(input, stateDir, tools = {}) {
  const t = { ...defaultTools(), ...tools };
  const gameRoot = path.resolve(String(input?.gameRoot || ""));
  const files = Array.isArray(input?.files) ? input.files : [];
  const game = await confirmedGame(gameRoot, t.discover);
  const current = (await installedLampLights(t.readState, stateDir, String(game.id))).map(
    (item) => item.modId,
  );
  if (!files.length)
    return current.length
      ? { status: "remove", modId: null, current, changes: true }
      : { status: "absent", modId: null, current, changes: false };
  const { manifest } = await describeFiles(files);
  const same = current.length === 1 && current[0] === manifest.id;
  return same
    ? { status: "unchanged", modId: manifest.id, current, changes: false }
    : { status: "install", modId: manifest.id, current, changes: true };
}

/**
 * Привести фонари в игре к заказу: `files` — поставить ровно эти файлы
 * (или оставить уже стоящий такой же пакет), пусто — снять. Возвращает
 * `installed` / `unchanged` / `removed` / `absent` и id пакета.
 */
export async function setLampLightsPackage(
  input,
  context,
  stateDir,
  { assertRuntimeSafety, ...tools } = {},
) {
  const t = { ...defaultTools(), ...tools };
  const gameRoot = path.resolve(String(input?.gameRoot || ""));
  const files = Array.isArray(input?.files) ? input.files : [];
  const game = await confirmedGame(gameRoot, t.discover);
  const targetId = String(game.id);
  const current = await installedLampLights(t.readState, stateDir, targetId);
  const guard = async () => assertRuntimeSafety?.(gameRoot);
  const engine = {
    rpfComposer: t.composeRpf,
    contentXmlProvider: t.provideContentXml,
    dlcListProvider: t.provideDlcList,
    assertRuntimeSafety: guard,
  };

  if (!files.length) {
    if (!current.length) return { status: "absent", modId: null };
    await guard();
    for (const item of current)
      await t.uninstall({ modId: item.modId, targetId, stateDir, ...engine });
    return { status: "removed", modId: null, removed: current.map((item) => item.modId) };
  }

  const built = await buildLampLightsPackage(stateDir, files);
  const others = current.filter((item) => item.modId !== built.manifest.id);
  if (others.length < current.length) {
    if (others.length) {
      await guard();
      for (const item of others)
        await t.uninstall({ modId: item.modId, targetId, stateDir, ...engine });
    }
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
  /* Фонари в игре одни: прежний пакет сменяется новым в своём слоте. */
  const replaceModIds = [
    ...new Set([
      ...(planned?.conflicts || []).map((item) => item.modId),
      ...current.map((item) => item.modId),
    ]),
  ].sort();
  /* Флаг `ASTRAL_ENGINE_INSTALL=lamp-lights-package`: подмену `update.rpf` ведёт движок, точка — с `replay.json`. */
  const engineInstall = engineInstallEnabled("lamp-lights-package")
    ? {
        install: t.installPrebuilt,
        edition: "Legacy",
        gameRoot,
        pointsRoot: nativeRestorePointsRoot(),
        replay: lampLightsReplayRecord(built),
      }
    : null;
  await t.install({ ...options, ...engine, replaceModIds, ...(engineInstall ? { engineInstall } : {}) });
  return { status: "installed", modId: built.manifest.id };
}
