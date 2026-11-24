/*
 * Слой слотов памяти звука в `audioconfig.dat4.rel` (20.11.2026): запись `update.rpf/x64/audio/config/audioconfig.dat4.rel`, в которой
 * Astral поднимает слот под банк `weapons.awc` пака звуков (`apps/desktop/src/audio-slots.js`).
 *
 * Слой производный, как реестры content.xml и dlclist.xml: он не принадлежит моду и пересчитывается из состояния при каждой
 * установке и снятии. Для остальной установки он невидим — не «владелец записи» и не конфликт: пакет, который кладёт свой
 * `audioconfig.dat4.rel` (редукс), ложится как обычно, а слой после установки пересчитывается поверх его файла.
 */

import { resolveEntryMaterializers } from "./entry-materializers.js";

export const AUDIO_CONFIG_ARCHIVE = "update/update.rpf";
export const AUDIO_CONFIG_ENTRY = "x64/audio/config/audioconfig.dat4.rel";
export const AUDIO_SLOTS_LAYER = "@astral-audio-slots";

/** Запись без слоя слотов: так её видят проверки владельца и конфликтов. */
export function withoutAudioSlotsLayer(entryState) {
  if (!entryState?.layers?.some((layer) => layer?.modId === AUDIO_SLOTS_LAYER))
    return entryState;
  return {
    ...entryState,
    layers: entryState.layers.filter(
      (layer) => layer?.modId !== AUDIO_SLOTS_LAYER,
    ),
  };
}

/* Снятый слой помнится до пересчёта: иначе пересчёт не отличил бы «тот же слой» от «слоя не было» и собирал бы update.rpf при каждой установке. */
const stripped = new WeakMap();

/** Снимает слой слотов из состояния цели на месте (до установки: её проверки его не видят; после неё слой пересчитывается). */
export function stripAudioSlotsLayer(target) {
  const entry =
    target?.archives?.[AUDIO_CONFIG_ARCHIVE]?.entries?.[AUDIO_CONFIG_ENTRY];
  const own = (entry?.layers || []).filter(
    (layer) => layer?.modId === AUDIO_SLOTS_LAYER,
  );
  if (!own.length) return;
  entry.layers = entry.layers.filter(
    (layer) => layer?.modId !== AUDIO_SLOTS_LAYER,
  );
  stripped.set(target, own);
}

const AWC_LAYER = "awc-stream-layer-v1";

/** Слой слотов стоит в update.rpf (в состоянии): пересчёт может его убрать или изменить, даже когда подъём слота сейчас выключен. */
export const audioSlotsLayerStands = (target) =>
  (target?.archives?.[AUDIO_CONFIG_ARCHIVE]?.entries?.[AUDIO_CONFIG_ENTRY]?.layers || []).some((layer) => layer?.modId === AUDIO_SLOTS_LAYER);

/**
 * Включён ли подъём слота: копия `slotRaiseEnabled` из `@modovik/sound-studio/slot-fit.js` (движок установки пакет звука не импортирует; равенство двух разборов слова держит `tests/sound-slot-raise-word-engine.test.js`).
 * Умолчание в коде — выкл; в альфе, бете и релизе (с 23.11.2026) канал ставит `ASTRAL_SOUND_SLOT_RAISE=1` на старте (`sound-slot-raise-channel.js`).
 */
export function soundSlotRaiseOn(env = typeof process !== "undefined" ? process.env : {}) {
  const raw = String(env?.ASTRAL_SOUND_SLOT_RAISE ?? "").trim().toLowerCase();
  return ["on", "вкл", "1", "true", "yes"].includes(raw);
}

/**
 * Может ли пересчёт слоя слотов (`settleAudioSlotLayer`) собрать update.rpf: подъём слота включён (слой может появиться) или слой уже стоит (его могло не стать). Выключен подъём и слоя нет — пересчёт ничего не меняет,
 * update.rpf из-за пака не пересобирается, и перебазирования на этой операции не должно быть (оно появилось бы на обычной установке, где его не было, и могло бы запарковать работы — `parkIfAstralLeft`).
 */
export const mayRebuildForAudioSlots = (target, env) => soundSlotRaiseOn(env) || audioSlotsLayerStands(target);

/**
 * Двигает ли ПАКЕТ слой слотов: среди его файлов есть слой звукового банка (`merge.strategy: awc-stream-layer-v1`, пак звуков оружия). Слой слотов `@astral-audio-slots` растёт вместе с банком, и
 * `settleAudioSlotLayer` после установки собирает update.rpf заново, хотя у пака нет ни `direct-update-entries-v1`, ни своего DLC. Считается по разобранному манифесту ДО изменения состояния.
 */
export const packMovesAudioSlotLayer = (parsed, target = null, env = undefined) =>
  (parsed?.files || []).some((file) => file?.merge?.strategy === AWC_LAYER) && mayRebuildForAudioSlots(target, env);

/**
 * Двигает ли слой слотов УСТАНОВЛЕННАЯ работа (снятие, «Установить снова»): среди её слоёв в состоянии есть слой звукового банка. Считается ДО изменения состояния — после `removeModLayers` слоёв работы уже нет.
 * Слой слотов, стоящий в update.rpf без таких работ, пересчитывать нечем, и перебазирование не нужно.
 */
export function movesAudioSlotLayer(target, installed, env = undefined) {
  const modId = installed?.modId;
  return (
    mayRebuildForAudioSlots(target, env) &&
    (installed?.archiveEntries || []).some((item) =>
      (target?.archives?.[item?.target]?.entries?.[item?.entry]?.layers || []).some((layer) => layer?.modId === modId && layer?.merge?.strategy === AWC_LAYER),
    )
  );
}

/** Слой, снятый `stripAudioSlotsLayer` и ещё не пересчитанный (забирается один раз). */
export function takeStrippedAudioSlotsLayers(target) {
  const own = stripped.get(target) || [];
  stripped.delete(target);
  return own;
}

/**
 * Пересчёт слоя слотов после изменения слоёв звуковых банков: зовёт сборщик `audioSlotSettler` (явный или зарегистрированный приложением).
 * `true` — слой в update.rpf появился, исчез или изменился: архив надо собрать заново. Без сборщика (тесты движка) — `false`.
 */
export async function settleAudioSlotLayer({
  audioSlotSettler = null,
  target,
  targetKey,
  paths,
  signal = null,
  onProgress = null,
}) {
  const settle = resolveEntryMaterializers({
    audioSlotSettler,
  }).audioSlotSettler;
  if (!settle) return false;
  const settled = await settle({
    target,
    targetKey,
    paths,
    edition: target.edition,
    gameRoot: target.gameRoot,
    signal,
    onProgress,
  });
  return Boolean(settled?.changed);
}
