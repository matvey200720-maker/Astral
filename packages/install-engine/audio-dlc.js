/*
 * Пакет дополнения Astral со звуком стволов: `astral_audio`.
 *
 * Свой звук ствола ставится так же, как Rockstar правит оружие после выпуска:
 * более поздний пакет дополнения переопределяет объект звука ствола объектом
 * с тем же именем. Пакет Astral регистрируется в dlclist.xml последним и
 * несёт:
 *
 *   • `x64/audio/astral_audio_game.dat151.rel` — предметы звука стволов
 *     (`ItemAudioSettings`, строка игрока — на копию) и копии их настроек;
 *   • `x64/audio/astral_audio_sounds.dat54.rel` — копии ветвей и имена банков;
 *   • `x64/audio/sfx/dlc_astral_audio/<ствол>.awc` — личные банки стволов;
 *   • `content.xml` и `setup2.xml` — как у пакетов Rockstar со звуком.
 *
 * Файлов игры установка не трогает, кроме строки регистрации в
 * dlclist.xml update.rpf. Пакет включён, пока в нём стоит хоть один ствол:
 * со снятием последнего регистрация уходит, и игра звучит как до Astral.
 *
 * Основу архива (`content.xml`, `setup2.xml` и пустые файлы метаданных)
 * собирает приложение — движок RPF не пишет — и передаёт путём `audioDlcHost`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  foreignAstralTraces,
  inspectModsShadow,
  MODS_SHADOW_ARCHIVE,
  settleForeignAstralTraces,
} from "./astral-layer.js";
import { rebaseDirectUpdateIfNeeded } from "./direct-update-rebase.js";
import { resolveInside, sha256File } from "./manifest.js";
import {
  ASTRAL_UPDATE_TARGET,
  composeDirectDlcRegistry,
} from "./registry-composers.js";
import { ensureArchiveResource } from "./resource-composition.js";
import { exists, missingBaseline } from "./storage-state.js";
import { copyFileCancellable } from "./transaction.js";

export const AUDIO_DLC_NAME = "astral_audio";
export const AUDIO_DLC_TARGET = "update/x64/dlcpacks/astral_audio/dlc.rpf";
export const AUDIO_DLC_CAPABILITY = "direct-audio-dlc-v1";
const AUDIO_DLC_OWNER = "@astral-audio-host";

/**
 * Подготовка к установке звука в пакет: ресурсы update.rpf (в нём
 * регистрация пакета) и самого пакета. Что ещё пакет может нести рядом
 * (слои дорожек банка collision у звука попадания), решает правило
 * манифеста (`manifest.js`).
 *
 * Первая установка включает пакет строкой в dlclist.xml update.rpf — те же
 * проверки, что у прямых записей в update.rpf: игра должна читать свой
 * архив, а сменённый в обход движка архив (небо, мини-карта, прицел) —
 * стать основой, а не пропасть.
 */
export async function prepareAudioDlc({
  parsed,
  target,
  targetKey,
  paths,
  root,
  host,
  contentXmlProvider,
  dlcListProvider,
  rpfProbe,
  signal,
  onProgress,
}) {
  if (!parsed.files.some((file) => file.target === AUDIO_DLC_TARGET))
    throw new Error("Пакету звука Astral нечего писать в свой архив.");
  /* Следы прежней установки Astral в архиве (задача 1 ТЗ 10.10.2026). */
  let traces = null;
  if (!target.directDlcRegistrations?.[AUDIO_DLC_NAME]) {
    const shadow = await inspectModsShadow(root, exists);
    if (shadow.shadowed)
      throw new Error(
        `Игра читает ${MODS_SHADOW_ARCHIVE}, а не свой update.rpf: рядом стоит загрузчик (${[
          ...shadow.hooks,
          ...shadow.plugins,
        ].join(", ")}). Уберите копию архива из папки mods или отключите загрузчик — иначе звук в игре не появится.`,
      );
    const hadUpdateResource = Boolean(target.resources?.[ASTRAL_UPDATE_TARGET]);
    await rebaseDirectUpdateIfNeeded({
      target,
      root,
      paths,
      targetKey,
      contentXmlProvider,
      dlcListProvider,
      signal,
    });
    if (!hadUpdateResource)
      traces = await foreignAstralTraces({
        target,
        root,
        paths,
        targetKey,
        contentXmlProvider,
        dlcListProvider,
        rpfProbe,
        resolveInside,
      });
  }
  await ensureArchiveResource({
    target,
    archiveTarget: ASTRAL_UPDATE_TARGET,
    root,
    paths,
    targetKey,
    signal,
    onProgress,
  });
  await settleForeignAstralTraces({ target, traces, paths, targetKey, dlcListProvider, signal });
  return ensureAudioDlcResource({ target, targetKey, paths, root, host, signal });
}

/**
 * Регистрация пакета в dlclist.xml после первой установки ствола: пакет
 * записан один раз, строкой после всех пакетов игры. Возвращает архив,
 * который пересобран, или `null`, если пакет уже был записан.
 */
export async function registerAudioDlc({ target, targetKey, paths, dlcListProvider }) {
  target.directDlcRegistrations ||= {};
  if (target.directDlcRegistrations[AUDIO_DLC_NAME]) return null;
  target.directDlcRegistrations[AUDIO_DLC_NAME] = {
    owner: AUDIO_DLC_OWNER,
    registeredAt: new Date().toISOString(),
  };
  await composeDirectDlcRegistry({
    target,
    targetKey,
    paths,
    dlcListProvider,
    archiveTarget: ASTRAL_UPDATE_TARGET,
  });
  return ASTRAL_UPDATE_TARGET;
}

/**
 * Состояние архива пакета: основа — копия хоста в кэше движка. Хост сменился
 * (новая версия приложения) — основа обновляется, а слои стволов остаются и
 * лягут поверх новой при следующей сборке.
 */
export async function ensureAudioDlcResource({
  target,
  targetKey,
  paths,
  root,
  host,
  signal,
}) {
  if (!host) throw new Error("Основа звукового пакета Astral не подготовлена.");
  const hostStat = await fs.lstat(host);
  if (!hostStat.isFile() || hostStat.isSymbolicLink())
    throw new Error("Основа звукового пакета Astral небезопасна.");
  const hostHash = await sha256File(host);
  const directory = path.join(paths.bases, targetKey, "audio-dlc");
  const compositionPath = path.join(
    directory,
    `${AUDIO_DLC_NAME}.${hostHash.slice(0, 16)}.base.rpf`,
  );
  await fs.mkdir(directory, { recursive: true });
  if (!(await exists(compositionPath)))
    await copyFileCancellable(host, compositionPath, signal);
  const compositionBase = {
    exists: true,
    path: compositionPath,
    sha256: hostHash,
    verified: true,
  };
  target.resources ||= {};
  target.archives ||= {};
  const existing = target.resources[AUDIO_DLC_TARGET];
  if (existing) {
    if (existing.compositionBase?.sha256 !== hostHash) {
      existing.base = compositionBase;
      existing.compositionBase = compositionBase;
      delete target.archives[AUDIO_DLC_TARGET]?.lastBuilt;
    }
    target.archives[AUDIO_DLC_TARGET] ||= { entries: {} };
    target.archives[AUDIO_DLC_TARGET].entries ||= {};
    return existing;
  }
  /* Файла пакета в игре до Astral не было — откат к оригиналу его убирает.
     Если он уже лежит (прежняя установка без состояния), он и есть
     оригинал: чужое движок не удаляет. */
  const livePath = resolveInside(root, AUDIO_DLC_TARGET);
  let original = missingBaseline();
  if (await exists(livePath)) {
    const liveStat = await fs.lstat(livePath);
    if (!liveStat.isFile() || liveStat.isSymbolicLink())
      throw new Error("Существующий звуковой пакет Astral небезопасен.");
    const originalPath = path.join(directory, "pre-astral.original.rpf");
    await copyFileCancellable(livePath, originalPath, signal);
    original = {
      exists: true,
      path: originalPath,
      sha256: await sha256File(originalPath),
      verified: true,
    };
  }
  const resource = {
    base: compositionBase,
    compositionBase,
    original,
    clean: missingBaseline(),
    persistentManaged: true,
    layers: [],
  };
  target.resources[AUDIO_DLC_TARGET] = resource;
  target.archives[AUDIO_DLC_TARGET] = { entries: {} };
  return resource;
}
