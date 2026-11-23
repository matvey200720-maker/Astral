/*
 * «Применить» студии звука: стволы и попадания — в игру через общую очередь.
 *
 * Что уезжает, решается по отпечаткам (`sound-kit-model.js`): у каждого
 * ствола — отпечаток его замысла и голоса (какие дорожки меняются и каким
 * способом), у попаданий — отпечаток пары «голова + тело». Запись установки
 * (`astral.sound-kit.install.v1`) помнит отпечаток того, что стоит в игре, и
 * снимок самого замысла. Отсюда три состояния у каждой вещи:
 *
 *   • «ждёт применения» — замысел есть, а в игре его нет или стоит другой;
 *   • «в игре» — отпечатки совпадают;
 *   • «уйдёт из игры» — в игре стоит звук, а замысла больше нет: человек
 *     вернул ствол «как в игре». «Применить» делает игру такой, как в
 *     студии, и значит снимает его.
 *
 * Ставится то, что было в студии в миг нажатия: пока работа ждёт очереди,
 * человек правит дальше, а в игру уезжает применённая версия. Её отпечаток и
 * записывается как «в игре» — правка после нажатия снова делает вещь
 * «ждущей».
 *
 * Окружение (ТЗ 17.10.2026, задача 5) — третья вещь: один мод на все
 * ползунки громкости, с тем же «ждёт / в игре / уйдёт из игры».
 *
 * Установка — движком, как у готовых модов и залазов, в цель той игры, что
 * найдена Astral (`targetId`): по нему же библиотека находит и снимает эти
 * моды. Главный процесс получает только звук — какие дорожки, в каком банке
 * и какая правка метаданных, решает он сам (`apps/desktop/src/sound-studio.js`).
 */

import { useSyncExternalStore } from "react";
import {
  HIT_SOUND_FORMAT,
  HIT_SOUND_PART_IDS,
  WEAPON_SOUNDS,
  WEAPON_SOUND_FORMAT,
  WEAPON_SOUND_MAP,
  weaponHasVoice,
  weaponVoiceKey,
} from "@modovik/sound-studio";
import {
  SOUND_MIX_FORMAT,
  normalizeSoundMix,
  soundMixIsNeutral,
} from "@modovik/sound-studio/sound-mix";
import { applyWorkshopWork } from "../../../../features/workshop/install-queue/index.js";
import { locateLegacyTarget } from "../../../../features/workshop/install-queue/game-root.js";
import { SOUND_INSTALL_STEPS } from "./sound-apply.js";
import { renderHitWaves, renderWeaponWaves } from "./sound-kit-audio.js";
import {
  SOUND_KIT_INSTALL_KEY,
  designIsSilent,
  designSignature,
  designTitle,
  hitsSignature,
  mixSignature,
  readSoundKitInstalls,
  writeSoundKitInstalls,
} from "./sound-kit-model.js";
import { splitWavParts } from "./sound-model.js";
import { tr } from "../../../../locales/ui.js";

/* Ключи работ в очереди: у каждого ствола свой, у попаданий один. */
export const soundKitWeaponKey = (weaponId) =>
  `${SOUND_KIT_INSTALL_KEY}:weapon:${weaponId}`;
export const SOUND_KIT_HITS_KEY = `${SOUND_KIT_INSTALL_KEY}:hits`;
export const SOUND_KIT_MIX_KEY = `${SOUND_KIT_INSTALL_KEY}:mix`;

/* Отпечаток снятия: «в игре ничего», чтобы очередь отличала его от установки. */
const REMOVAL = "removed";

/* ------------------------------------------------------------------------ */
/* Записи установки — одно хранилище на студию, библиотеку и очередь.       */
/* ------------------------------------------------------------------------ */

const listeners = new Set();
let cachedRaw;
let cached = { weapons: {}, hits: null, mix: null };

function rawInstalls() {
  try {
    return globalThis.localStorage?.getItem(SOUND_KIT_INSTALL_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Что стоит в игре — по записи; один объект, пока запись не изменилась. */
export function soundKitInstalls() {
  const raw = rawInstalls();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = readSoundKitInstalls();
  }
  return cached;
}

export function subscribeSoundKitInstalls(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function updateInstalls(change) {
  writeSoundKitInstalls(change(readSoundKitInstalls()));
  for (const listener of [...listeners]) listener();
}

/** Записи установки для компонента: перерисовка, когда они меняются. */
export function useSoundKitInstalls() {
  return useSyncExternalStore(subscribeSoundKitInstalls, soundKitInstalls);
}

/**
 * Сверка записи с тем, что движок действительно держит в игре.
 *
 * Мод снимают и мимо студии — корзиной библиотеки или прежней студией, — и
 * запись, которая об этом не знает, показывала бы «в игре» то, чего там нет.
 * Работа, которой в записи нет (поставлена до записи или запись потеряна),
 * тоже становится видна — без снимка замысла: студия говорит «в игре стоит
 * звук», но не выдумывает, какой.
 *
 * Звук, поставленный до «звука на ствол» (`legacy` у работы), менял дорожки,
 * общие с соседними стволами: запись помечается, и он ждёт «Применить»,
 * которое поставит его только на свой ствол.
 *
 * @param {Array<{modId: string, kind?: string, weapon?: string, legacy?: boolean, parts?: string[]}>} works
 */
export function reconcileSoundKitInstalls(works) {
  const list = Array.isArray(works) ? works : [];
  const live = new Map(list.map((work) => [String(work?.modId || ""), work]));
  updateInstalls((installs) => {
    const weapons = {};
    for (const [id, record] of Object.entries(installs.weapons)) {
      const work = live.get(String(record?.modId || ""));
      if (!work) continue;
      weapons[id] = work.legacy ? { ...record, legacy: true } : record;
    }
    const known = new Set(
      Object.values(weapons).map((record) => record?.modId),
    );
    let hits = installs.hits && live.has(installs.hits.modId) ? installs.hits : null;
    if (hits && live.get(hits.modId)?.legacy) hits = { ...hits, legacy: true };
    let mix = installs.mix && live.has(installs.mix.modId) ? installs.mix : null;
    for (const work of list) {
      const weapon = work.kind === "weapon" ? WEAPON_SOUND_MAP[work.weapon] : null;
      if (weapon) {
        if (!known.has(work.modId) && !weapons[weapon.id])
          weapons[weapon.id] = {
            modId: work.modId,
            title: weapon.title,
            signature: "",
            design: null,
            ...(work.legacy ? { legacy: true } : {}),
            ...(work.mute ? { mute: true } : {}),
            installedAt: String(work.installedAt || ""),
          };
      } else if (work.kind === "mix" && mix?.modId !== work.modId) {
        /* Окружение, поставленное мимо этой записи: в игре оно есть, а
           каким ползункам оно отвечает — неизвестно. */
        mix = {
          modId: work.modId,
          signature: "",
          levels: null,
          installedAt: String(work.installedAt || ""),
        };
      } else if (work.kind === "hits" && hits?.modId !== work.modId) {
        const parts = HIT_SOUND_PART_IDS.filter((part) =>
          (work.parts || []).includes(part),
        );
        hits = {
          modId: work.modId,
          parts,
          signature: "",
          designs: {},
          ...(work.legacy ? { legacy: true } : {}),
          installedAt: String(work.installedAt || ""),
        };
      }
    }
    return { weapons, hits, mix };
  });
}

/* ------------------------------------------------------------------------ */
/* Что ждёт применения.                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Звук ствола стоит нынешним способом: голос по нынешней таблице, формат
 * пакета — тот, что называет главный процесс этой версии Astral, и не на
 * семью стволов.
 */
export const weaponInstallCurrent = (weaponId, record) =>
  Boolean(record) &&
  !record.legacy &&
  /* Тишина голоса не имеет: её способ — только формат главного процесса. */
  (record.mute === true || record.voice === weaponVoiceKey(WEAPON_SOUND_MAP[weaponId])) &&
  record.format === WEAPON_SOUND_FORMAT;

/** Звук попадания стоит нынешним способом (не правкой update.rpf). */
export const hitsInstallCurrent = (record) =>
  Boolean(record) && !record.legacy && record.format === HIT_SOUND_FORMAT;

/**
 * Состояние ствола: `original` (как в игре), `pending`, `installed`,
 * `leaving` (в игре стоит, замысла нет) или `foreign` (в игре стоит звук,
 * собранный не этой записью: снять можно, заменить — «Применить»).
 *
 * «В игре» — это тот же замысел тем же способом: звук, поставленный прежней
 * версией Astral или ещё на всю семью стволов, ждёт «Применить».
 */
export function weaponInstallState(weaponId, design, installs) {
  const record = installs?.weapons?.[weaponId] || null;
  if (!design) {
    if (!record) return "original";
    return record.signature ? "leaving" : "foreign";
  }
  if (!record) return "pending";
  return weaponInstallCurrent(weaponId, record) &&
    record.signature === designSignature(design)
    ? "installed"
    : "pending";
}

/**
 * Состояние части попадания: `off`, `pending`, `installed`, `leaving`.
 * Части ставятся одним модом, поэтому «в игре» у части — это отпечаток всей
 * пары: другая часть поменялась — переставятся обе. Звук, поставленный
 * прежним способом (правкой update.rpf, в которой он тонул в штатном
 * ударе), ждёт «Применить».
 */
export function hitPartInstallState(part, hits, installs) {
  const record = installs?.hits || null;
  const design = hits?.[part] || null;
  const inGame = Boolean(record?.parts?.includes(part));
  if (!design) return inGame ? "leaving" : "off";
  if (!inGame) return "pending";
  return hitsInstallCurrent(record) && record.signature === hitsSignature(hits)
    ? "installed"
    : "pending";
}

/** Окружение стоит нынешним способом. */
export const mixInstallCurrent = (record) =>
  Boolean(record) && record.format === SOUND_MIX_FORMAT;

/**
 * Состояние окружения: `original` (как в игре), `pending`, `installed`,
 * `leaving` (в игре стоит, а ползунки вернули к игре) или `foreign` (в игре
 * стоит окружение, поставленное мимо этой записи).
 */
export function mixInstallState(mix, installs) {
  const record = installs?.mix || null;
  if (soundMixIsNeutral(mix)) {
    if (!record?.modId) return "original";
    return record.signature ? "leaving" : "foreign";
  }
  if (!record?.modId) return "pending";
  return mixInstallCurrent(record) && record.signature === mixSignature(mix)
    ? "installed"
    : "pending";
}

/**
 * Всё, что изменит «Применить»: стволы к установке и к снятию, попадания,
 * окружение.
 *
 * @returns {{ weapons: string[], removals: string[], hits: "install"|"remove"|null, mix: "install"|"remove"|null }}
 */
export function soundKitPending(kit, installs) {
  const weapons = [];
  const removals = [];
  /* Ствол без своего голоса своего звука не получает: в игре ему нечего заменить. Выключить его выстрелы можно — тишине голос не нужен. */
  for (const weapon of WEAPON_SOUNDS) {
    const { id } = weapon;
    if (!weaponHasVoice(weapon) && !designIsSilent(kit.weapons[id]) && !installs?.weapons?.[id]) continue;
    const state = weaponInstallState(id, kit.weapons[id] || null, installs);
    if (state === "pending") weapons.push(id);
    else if (state === "leaving") removals.push(id);
  }
  const anyHit = HIT_SOUND_PART_IDS.some((part) => kit.hits[part]);
  const record = installs?.hits || null;
  let hits = null;
  if (anyHit) {
    if (!hitsInstallCurrent(record) || record.signature !== hitsSignature(kit.hits))
      hits = "install";
  } else if (record?.signature) hits = "remove";
  const mixState = mixInstallState(kit?.mix, installs);
  const mix =
    mixState === "pending" ? "install" : mixState === "leaving" ? "remove" : null;
  return { weapons, removals, hits, mix };
}

export const soundKitPendingCount = (pending) =>
  pending.weapons.length +
  pending.removals.length +
  (pending.hits ? 1 : 0) +
  (pending.mix ? 1 : 0);

/* ------------------------------------------------------------------------ */
/* Путь в игру.                                                              */
/* ------------------------------------------------------------------------ */

/*
 * Дорожки — в сессию главного процесса. Большой WAV идёт частями: канал IPC
 * ограничен. Дорожки ствола лежат по папкам банков: у разных банков бывают
 * дорожки с одним хешем.
 */
async function stageWaves(host, waves, { byBank }) {
  const { session } = await host.beginSoundSession({});
  try {
    for (const wave of waves) {
      const parts = splitWavParts(wave.wav);
      for (const [part, wav] of parts.entries())
        await host.stageSoundWav({
          session,
          ...(byBank ? { bank: wave.bank } : {}),
          stream: wave.stream,
          sampleRate: wave.sampleRate,
          wav,
          part,
          parts: parts.length,
        });
    }
    return session;
  } catch (error) {
    await host.endSoundSession({ session }).catch(() => {});
    throw error;
  }
}

function requireHost(host, method) {
  if (!host?.[method])
    throw new Error(tr("Звук ставится в игру из приложения Astral — в браузере его некуда писать."));
}

/* Где стоит звук — для карточки библиотеки: звуковой пакет Astral и
   update.rpf, где пакет записан в список дополнений игры. Звук попадания
   держит ещё и свои дорожки в банке collision резидентного архива. */
const WEAPON_SOUND_ARCHIVES = Object.freeze(["astral_audio/dlc.rpf", "update.rpf"]);
const HIT_SOUND_ARCHIVES = Object.freeze(["RESIDENT.rpf", "astral_audio/dlc.rpf"]);

/**
 * Свой звук ствола — в игру: рендер всех дорожек голоса, сессия, план и
 * установка. Отпечаток, голос и снимок замысла уходят в запись.
 */
export async function installWeaponSound({ host, weaponId, design, report }) {
  requireHost(host, "applyWeaponSound");
  if (designIsSilent(design)) return installWeaponMute({ host, weaponId, design, report });
  const weapon = WEAPON_SOUND_MAP[weaponId];
  if (!weaponHasVoice(weapon)) throw new Error(tr("Ствол не найден."));
  report?.({ step: "stage", note: tr("Готовим звук") });
  const game = await locateLegacyTarget();
  const place = { gameRoot: game.path, targetId: game.id };
  const waves = await renderWeaponWaves(weapon, design, { host, gameRoot: game.path });
  const session = await stageWaves(host, waves, { byBank: true });
  try {
    report?.({ step: "build", note: tr("Проверяем собранное") });
    const plan = await host.planWeaponSound({ session, weapon: weapon.id, ...place });
    const result = await host.applyWeaponSound({
      session,
      weapon: weapon.id,
      ...place,
      expectedManifestHash: plan.manifestHash,
    });
    updateInstalls((installs) => {
      const weapons = { ...installs.weapons };
      /* Установка заменила прежние моды этого ствола — звук, поставленный
         ещё на всю семью, — и записи о них больше не про игру. */
      for (const [id, record] of Object.entries(weapons))
        if ((plan.replaceModIds || []).includes(record?.modId)) delete weapons[id];
      weapons[weapon.id] = {
        modId: plan.modId,
        title: weapon.title,
        /* Модель ствола в каталоге — ею «Мои работы» рисуют обложку работы;
           архивы — куда встал звук, карточка библиотеки называет их. */
        model: weapon.model || "",
        archives: [...WEAPON_SOUND_ARCHIVES],
        signature: designSignature(design),
        voice: weaponVoiceKey(weapon),
        /* Способ — тот, что назвал главный процесс: он мог остаться
           прежним, если окно обновилось без перезапуска приложения. */
        format: Number(result?.format ?? plan.format) || 0,
        design,
        installedAt: new Date().toISOString(),
      };
      return { ...installs, weapons };
    });
    return { ...result, plan };
  } finally {
    await host.endSoundSession({ session }).catch(() => {});
  }
}

/**
 * «Без своих выстрелов» — в игру (30.10.2026): дорожек нет, сессия не нужна — главный процесс сам читает настройки игрока ствола из файлов игры и собирает копию с тишиной. Тот же слот,
 * что у своего звука: установка заменяет прежний мод ствола. Прежний главный процесс (окно обновилось на лету) тишину не знает — отказ словами, ничего не ставится.
 */
async function installWeaponMute({ host, weaponId, design, report }) {
  const weapon = WEAPON_SOUND_MAP[weaponId];
  if (!weapon) throw new Error(tr("Ствол не найден."));
  report?.({ step: "build", note: tr("Проверяем собранное") });
  const game = await locateLegacyTarget();
  const place = { gameRoot: game.path, targetId: game.id };
  const known = await host.listSoundWorks?.(place).catch(() => null);
  if (!known?.formats?.weaponMute)
    throw new Error(tr("Звуки стволов обновились: перезапустите Astral и нажмите «Применить» ещё раз."));
  const plan = await host.planWeaponSound({ weapon: weapon.id, mute: true, ...place });
  const result = await host.applyWeaponSound({
    weapon: weapon.id,
    mute: true,
    ...place,
    expectedManifestHash: plan.manifestHash,
  });
  updateInstalls((installs) => {
    const weapons = { ...installs.weapons };
    for (const [id, record] of Object.entries(weapons))
      if ((plan.replaceModIds || []).includes(record?.modId)) delete weapons[id];
    weapons[weapon.id] = {
      modId: plan.modId,
      title: weapon.title,
      model: weapon.model || "",
      archives: [...WEAPON_SOUND_ARCHIVES],
      signature: designSignature(design),
      voice: "",
      mute: true,
      format: Number(result?.format ?? plan.format) || 0,
      design,
      installedAt: new Date().toISOString(),
    };
    return { ...installs, weapons };
  });
  return { ...result, plan };
}

/** Звук ствола — из игры: мод снимается, запись уходит. */
export async function removeWeaponSound({ host, weaponId, report }) {
  requireHost(host, "removeSound");
  const record = readSoundKitInstalls().weapons[weaponId];
  if (!record?.modId) return { status: "absent" };
  report?.({ step: "build", note: tr("Снимаем звук") });
  const game = await locateLegacyTarget();
  const result = await host.removeSound({
    gameRoot: game.path,
    targetId: game.id,
    modId: record.modId,
  });
  updateInstalls((installs) => {
    const weapons = { ...installs.weapons };
    if (weapons[weaponId]?.modId === record.modId) delete weapons[weaponId];
    return { ...installs, weapons };
  });
  return result;
}

/**
 * Звуки попадания — в игру: обе части одним модом. Часть без замысла в мод
 * не входит, и её место в игре остаётся штатным.
 *
 * `game` — игра, в которую ставить (`{path, id}`); без неё — найденная
 * Legacy. Библиотека передаёт свою: снимает часть там, где её показывает.
 */
export async function installHitSounds({ host, hits, report, game = null }) {
  requireHost(host, "applyHitSounds");
  const parts = HIT_SOUND_PART_IDS.filter((part) => hits[part]);
  if (!parts.length) throw new Error(tr("Выберите звук головы или тела."));
  report?.({ step: "stage", note: tr("Готовим звук") });
  const target = game || (await locateLegacyTarget());
  const place = { gameRoot: target.path, targetId: target.id };
  const budget = await host.readHitSoundBudget({ gameRoot: target.path });
  const chosen = Object.fromEntries(parts.map((part) => [part, hits[part]]));
  const waves = await renderHitWaves(chosen, budget);
  const session = await stageWaves(host, waves, { byBank: false });
  try {
    report?.({ step: "build", note: tr("Проверяем собранное") });
    const plan = await host.planHitSounds({ session, parts, ...place });
    const result = await host.applyHitSounds({
      session,
      parts,
      ...place,
      expectedManifestHash: plan.manifestHash,
    });
    updateInstalls((installs) => ({
      ...installs,
      hits: {
        modId: plan.modId,
        parts,
        archives: [...HIT_SOUND_ARCHIVES],
        signature: hitsSignature(hits),
        format: Number(result?.format ?? plan.format) || 0,
        designs: chosen,
        titles: Object.fromEntries(
          parts.map((part) => [part, designTitle(chosen[part])]),
        ),
        installedAt: new Date().toISOString(),
      },
    }));
    return { ...result, plan };
  } finally {
    await host.endSoundSession({ session }).catch(() => {});
  }
}

/** Звуки попадания — из игры целиком. */
export async function removeHitSounds({ host, report, game = null }) {
  requireHost(host, "removeSound");
  const record = readSoundKitInstalls().hits;
  if (!record?.modId) return { status: "absent" };
  report?.({ step: "build", note: tr("Снимаем звук") });
  const target = game || (await locateLegacyTarget());
  const result = await host.removeSound({
    gameRoot: target.path,
    targetId: target.id,
    modId: record.modId,
  });
  updateInstalls((installs) =>
    installs.hits?.modId === record.modId ? { ...installs, hits: null } : installs,
  );
  return result;
}

/**
 * Окружение — в игру: ползунки уходят главному процессу, а какие категории
 * звука игры они двигают, решает он (`planSoundMix`). Прежнее окружение
 * сменяется этим же модом (слот один).
 */
export async function installSoundMix({ host, mix, report, game = null }) {
  requireHost(host, "removeSound");
  if (!host.applySoundMix)
    throw new Error(
      tr("Astral обновился — перезапустите приложение, чтобы поставить окружение в игру."),
    );
  const levels = normalizeSoundMix(mix).levels;
  if (!Object.keys(levels).length)
    throw new Error(tr("Окружение как в игре — ставить нечего."));
  report?.({ step: "build", note: tr("Проверяем собранное") });
  const target = game || (await locateLegacyTarget());
  const place = { gameRoot: target.path, targetId: target.id };
  const plan = await host.planSoundMix({ ...place, mix: { levels } });
  const result = await host.applySoundMix({
    ...place,
    mix: { levels },
    expectedManifestHash: plan.manifestHash,
  });
  updateInstalls((installs) => ({
    ...installs,
    mix: {
      modId: plan.modId,
      signature: mixSignature({ levels }),
      levels,
      format: Number(result?.format ?? plan.format) || 0,
      installedAt: new Date().toISOString(),
    },
  }));
  return { ...result, plan };
}

/** Окружение — из игры: категории звука снова как у игры. */
export async function removeSoundMix({ host, report, game = null }) {
  requireHost(host, "removeSound");
  const record = readSoundKitInstalls().mix;
  if (!record?.modId) return { status: "absent" };
  report?.({ step: "build", note: tr("Снимаем звук") });
  const target = game || (await locateLegacyTarget());
  const result = await host.removeSound({
    gameRoot: target.path,
    targetId: target.id,
    modId: record.modId,
  });
  updateInstalls((installs) =>
    installs.mix?.modId === record.modId ? { ...installs, mix: null } : installs,
  );
  return result;
}

const weaponTitle = (id) =>
  WEAPON_SOUND_MAP[id]?.title ||
  readSoundKitInstalls().weapons[id]?.title ||
  tr("Ствол");

/**
 * Поставить в очередь всё, что ждёт: по работе на ствол и одну на
 * попадания. Снимок замысла берётся сейчас — в игру уедет нажатое.
 */
export function queueSoundKit({ host, kit, pending, notify }) {
  const names = [
    ...pending.weapons.map(weaponTitle),
    ...pending.removals.map((id) => tr("{name} — как в игре").replace("{name}", weaponTitle(id))),
    ...(pending.hits === "install" ? [tr("Звуки попадания")] : []),
    ...(pending.hits === "remove" ? [tr("Звуки попадания — как в игре")] : []),
    ...(pending.mix === "install" ? [tr("Звуки окружения")] : []),
    ...(pending.mix === "remove" ? [tr("Звуки окружения — как в игре")] : []),
  ];
  const savedText =
    names.length > 1
      ? tr("Ставим в игру: {names}").replace("{names}", names.join(", "))
      : tr("«{name}» — ставим в игру").replace("{name}", names[0]);
  for (const id of pending.weapons) {
    const design = kit.weapons[id];
    const title = tr("Звук: {name}").replace("{name}", weaponTitle(id));
    void applyWorkshopWork({
      key: soundKitWeaponKey(id),
      signature: designSignature(design),
      title,
      editor: tr("Звуки"),
      coverSlotId: "weapon-sounds",
      steps: SOUND_INSTALL_STEPS,
      notify,
      savedText,
      run: ({ report }) =>
        installWeaponSound({ host, weaponId: id, design, report }),
      doneText: () =>
        (designIsSilent(design)
          ? tr("«{title}»: выстрелы выключены в игре")
          : tr("«{title}»: свой звук в игре")
        ).replace("{title}", weaponTitle(id)),
    });
  }
  for (const id of pending.removals) {
    void applyWorkshopWork({
      key: soundKitWeaponKey(id),
      signature: REMOVAL,
      title: tr("Звук: {name}").replace("{name}", weaponTitle(id)),
      editor: tr("Звуки"),
      coverSlotId: "weapon-sounds",
      steps: SOUND_INSTALL_STEPS,
      notify,
      savedText,
      run: ({ report }) => removeWeaponSound({ host, weaponId: id, report }),
      doneText: () => tr("«{title}»: снова звук игры").replace("{title}", weaponTitle(id)),
    });
  }
  if (pending.hits === "install") {
    const hits = { ...kit.hits };
    void applyWorkshopWork({
      key: SOUND_KIT_HITS_KEY,
      signature: hitsSignature(hits),
      title: tr("Звуки попадания"),
      editor: tr("Звуки"),
      coverSlotId: "hit-sounds",
      steps: SOUND_INSTALL_STEPS,
      notify,
      savedText,
      run: ({ report }) => installHitSounds({ host, hits, report }),
      doneText: () => tr("Звуки попадания в игре"),
    });
  } else if (pending.hits === "remove") {
    void applyWorkshopWork({
      key: SOUND_KIT_HITS_KEY,
      signature: REMOVAL,
      title: tr("Звуки попадания"),
      editor: tr("Звуки"),
      coverSlotId: "hit-sounds",
      steps: SOUND_INSTALL_STEPS,
      notify,
      savedText,
      run: ({ report }) => removeHitSounds({ host, report }),
      doneText: () => tr("Звуки попадания сняты"),
    });
  }
  if (pending.mix === "install") {
    const mix = normalizeSoundMix(kit.mix);
    void applyWorkshopWork({
      key: SOUND_KIT_MIX_KEY,
      signature: mixSignature(mix),
      title: tr("Звуки окружения"),
      editor: tr("Звуки"),
      coverSlotId: "ambient-noise",
      steps: SOUND_INSTALL_STEPS,
      notify,
      savedText,
      run: ({ report }) => installSoundMix({ host, mix, report }),
      doneText: () => tr("Звуки окружения в игре"),
    });
  } else if (pending.mix === "remove") {
    void applyWorkshopWork({
      key: SOUND_KIT_MIX_KEY,
      signature: REMOVAL,
      title: tr("Звуки окружения"),
      editor: tr("Звуки"),
      coverSlotId: "ambient-noise",
      steps: SOUND_INSTALL_STEPS,
      notify,
      savedText,
      run: ({ report }) => removeSoundMix({ host, report }),
      doneText: () => tr("Звуки окружения как в игре"),
    });
  }
}

/** Снять окружение прямо сейчас — пунктом «⋯» студии. */
export function queueMixRemoval({ host, notify }) {
  return applyWorkshopWork({
    key: SOUND_KIT_MIX_KEY,
    signature: REMOVAL,
    title: tr("Звуки окружения"),
    editor: tr("Звуки"),
    coverSlotId: "ambient-noise",
    steps: SOUND_INSTALL_STEPS,
    notify,
    savedText: tr("Снимаем звуки окружения"),
    run: ({ report }) => removeSoundMix({ host, report }),
    doneText: () => tr("Звуки окружения как в игре"),
  });
}

/* ------------------------------------------------------------------------ */
/* Поставленное прежней версией — заново тем же замыслом.                    */
/* ------------------------------------------------------------------------ */

/**
 * Что стоит в игре прежним способом и может встать заново тем же замыслом:
 * звук ствола с другим отпечатком голоса (прежний план — слои игры поверх
 * своего звука) или поставленный на семью, звук попадания прежней формы
 * (правка update.rpf). Нужен снимок замысла: без него переставлять нечего, и
 * такой звук ждёт «Применить».
 *
 * @returns {{ weapons: Array<{id: string, design: object}>, hits: object|null }}
 */
export function soundKitOutdated(installs) {
  const weapons = [];
  for (const [id, record] of Object.entries(installs?.weapons || {})) {
    const weapon = WEAPON_SOUND_MAP[id];
    if (!record?.design || (!weaponHasVoice(weapon) && !record.mute)) continue;
    if (!weaponInstallCurrent(id, record)) weapons.push({ id, design: record.design });
  }
  const record = installs?.hits || null;
  const parts = HIT_SOUND_PART_IDS.filter((part) => record?.parts?.includes(part));
  const complete =
    Boolean(record) &&
    !hitsInstallCurrent(record) &&
    parts.length > 0 &&
    parts.every((part) => record.designs?.[part]);
  return {
    weapons,
    hits: complete
      ? Object.fromEntries(
          HIT_SOUND_PART_IDS.map((part) => [
            part,
            parts.includes(part) ? record.designs[part] : null,
          ]),
        )
      : null,
  };
}

/* Обновление идёт раз за жизнь окна на каждый замысел: если установка
   отказала (игра запущена), повтор — «Применить», а не круг за кругом. */
const refreshedVersions = new Set();

/**
 * Главный процесс ставит звук теми же способами, что знает окно. Нет — окно
 * обновилось без перезапуска приложения, и «Применить» поставило бы звук
 * прежним способом.
 */
export const soundKitServiceCurrent = (formats) =>
  formats?.weapon === WEAPON_SOUND_FORMAT && formats?.hits === HIT_SOUND_FORMAT;

/**
 * Звуки, поставленные прежней версией Astral, — в игру заново тем же
 * замыслом, как только студия увидела их в игре. Выбор человека не
 * меняется, меняется способ установки: после обновления Astral звук в игре
 * становится правильным без «Применить» (27.09.2026: прежний звук остался в
 * игре, потому что его не переставили).
 *
 * `formats` — способы главного процесса (`listSoundWorks`). Окно обновляется
 * на лету, а главный процесс — только с перезапуском приложения: пока его
 * способы прежние, переставлять нечем — звук встал бы тем же прежним
 * способом, — и обновление ждёт перезапуска.
 *
 * @returns {number} сколько работ поставлено в очередь
 */
export function refreshOutdatedSoundKit({ host, notify, formats }) {
  if (!host?.applyWeaponSound || !host?.applyHitSounds) return 0;
  if (!soundKitServiceCurrent(formats)) return 0;
  const { weapons, hits } = soundKitOutdated(readSoundKitInstalls());
  const savedText = tr("Обновляем звуки в игре до новой версии Astral");
  let queued = 0;
  for (const { id, design } of weapons) {
    const version = `${soundKitWeaponKey(id)}|${designSignature(design)}`;
    if (refreshedVersions.has(version)) continue;
    refreshedVersions.add(version);
    queued += 1;
    void applyWorkshopWork({
      key: soundKitWeaponKey(id),
      signature: designSignature(design),
      title: tr("Звук: {name}").replace("{name}", weaponTitle(id)),
      editor: tr("Звуки"),
      coverSlotId: "weapon-sounds",
      steps: SOUND_INSTALL_STEPS,
      notify,
      savedText,
      run: ({ report }) => installWeaponSound({ host, weaponId: id, design, report }),
      doneText: () => tr("«{title}»: звук обновлён в игре").replace("{title}", weaponTitle(id)),
    });
  }
  if (hits) {
    const version = `${SOUND_KIT_HITS_KEY}|${hitsSignature(hits)}`;
    if (!refreshedVersions.has(version)) {
      refreshedVersions.add(version);
      queued += 1;
      void applyWorkshopWork({
        key: SOUND_KIT_HITS_KEY,
        signature: hitsSignature(hits),
        title: tr("Звуки попадания"),
        editor: tr("Звуки"),
        coverSlotId: "hit-sounds",
        steps: SOUND_INSTALL_STEPS,
        notify,
        savedText,
        run: ({ report }) => installHitSounds({ host, hits, report }),
        doneText: () => tr("Звуки попадания обновлены в игре"),
      });
    }
  }
  return queued;
}

/** Снять звук одного ствола прямо сейчас — кнопкой в колонке правок. */
export function queueWeaponRemoval({ host, weaponId, notify }) {
  return applyWorkshopWork({
    key: soundKitWeaponKey(weaponId),
    signature: REMOVAL,
    title: tr("Звук: {name}").replace("{name}", weaponTitle(weaponId)),
    editor: tr("Звуки"),
    coverSlotId: "weapon-sounds",
    steps: SOUND_INSTALL_STEPS,
    notify,
    savedText: tr("«{name}» — снимаем свой звук").replace("{name}", weaponTitle(weaponId)),
    run: ({ report }) => removeWeaponSound({ host, weaponId, report }),
    doneText: () => tr("«{title}»: снова звук игры").replace("{title}", weaponTitle(weaponId)),
  });
}
