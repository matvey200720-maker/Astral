import * as crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as awc from "@modovik/awc";
import * as soundStudio from "@modovik/sound-studio";
import * as packVoice from "@modovik/sound-studio/pack-voice";
import * as weaponPack from "@modovik/weapon-sound-pack";

// Переопределения стволов из звукового пака: поток пака -> сессия студии -> связь «пак, ствол, мод, слот».

export const PACK_WEAPON_VOICE_SWITCH = "ASTRAL_RUST_PACK_WEAPON_VOICE";

const OFF_WORDS = ["off", "0", "false", "no"];
const STREAM_SLOT = /^sound-.+-0x[0-9a-f]{8}$/;

// Всё после последней косой (любой); значение приводится к строке.
function leafName(value) {
  return String(value).split(/[\\/]/).pop();
}

// Ключ записи архива в таблице потоков: «архив|запись».
function entryKey(archive, entry) {
  return `${leafName(archive)}|${leafName(entry)}`;
}

// Номер потока из строки вида 0X1178999F.
function streamNumber(wave) {
  return parseInt(wave.stream.slice(2), 16);
}

// Причина отказа: текст ошибки, а если его нет, то само брошенное значение строкой.
function failureOf(weaponId, error) {
  const message = error?.message || String(error);
  return { weaponId, message };
}

// Молчаливая попытка: сбой — просто undefined.
function quietly(job) {
  try {
    return job();
  } catch {
    return undefined;
  }
}

// Включён во всех каналах (22.11.2026): без слова в окружении шаг идёт, как у выключателей движка «вкл. по умолчанию»
// (`makeSwitch(…, true)` в `native-engine-rust.js`, строки `11` таблицы `rust-switches.js`). Выключает только явное
// `off`, `0`, `false`, `no`; незнакомое слово умолчания не меняет.
export function packWeaponVoiceEnabled(env = process.env) {
  const raw = env?.[PACK_WEAPON_VOICE_SWITCH];
  const word = String(raw ?? "").trim().toLowerCase();
  return !OFF_WORDS.includes(word);
}

export function isSoundPackRecord(record) {
  const slots = record?.slots || [];
  return slots.some((slot) => STREAM_SLOT.test(slot));
}

function toLayer(target, entry, layer) {
  return { archive: leafName(target), entry: leafName(entry), file: layer.cachePath, sha256: layer.sha256 || null };
}

// Слои мода по записям архивов установки: объекты (archive, entry, file, sha256).
export function packEntryLayers(profile, targetId, record) {
  const archiveEntries = [...(record?.archiveEntries || [])];
  return archiveEntries.flatMap((item) => {
    const { target, entry } = item;
    const layers = profile?.targets?.[targetId]?.resources?.[target]?.entries?.[entry]?.layers;
    const matching = [...(layers || [])].filter((layer) => layer.modId === record.modId && layer.cachePath);
    return matching.map((layer) => toLayer(target, entry, layer));
  });
}

export function packSourceSha(profile, targetId, record) {
  const layers = packEntryLayers(profile, targetId, record);
  const digests = [];
  for (const layer of layers) {
    if (layer.sha256) digests.push(layer.sha256);
  }
  if (!digests.length) return null;
  digests.sort();
  const hash = crypto.createHash("sha256").update(digests.join("\n"));
  return hash.digest("hex");
}

// Потоки одного банка пака; запись потока — ответ соседа плюс запас дорожки.
async function collectStreams(into, file) {
  const bank = await fs.readFile(file);
  const streamsList = awc.readAwc(bank).streams;
  for (const stream of streamsList) {
    const { id, format } = stream;
    if (into.has(id)) continue;
    const headroom = Number.isInteger(format?.headroom) ? format.headroom : 0;
    quietly(() => into.set(id, { ...awc.awcStreamPcm(bank, id), headroom }));
  }
}

// Слои по порядку вместе с таблицей потоков своей записи; запись заводится до чтения файла.
export async function readEntryStreams(layers) {
  const table = new Map();
  for (const layer of layers) {
    const key = entryKey(layer.archive, layer.entry);
    if (!table.has(key)) table.set(key, new Map());
    await collectStreams(table.get(key), layer.file).catch(() => {});
  }
  return table;
}

function hasStream(streams, wave) {
  return streams.get(entryKey(wave.archive, wave.entry))?.has(streamNumber(wave)) === true;
}

// Дорожка пака -> частота и длина дорожки игры -> WAV -> сессия студии.
function stageWave(job, session, wave) {
  const { studio, streams, context, stateDir } = job;
  const track = streams.get(entryKey(wave.archive, wave.entry)).get(streamNumber(wave));
  const fitted = packVoice.fitToWave(track.pcm, track.sampleRate, wave);
  const wav = packVoice.pcmToWav(fitted.pcm, fitted.sampleRate).toString("base64");
  const headroom = track.headroom || 0;
  const staged = { session, bank: wave.bank, stream: wave.stream, sampleRate: wave.sampleRate, wav, headroom };
  return studio.stageSoundWav(staged, context, stateDir);
}

// Одна сессия на ствол: дорожки по очереди -> план -> применение; закрывается всегда после begin.
async function placeWeapon(job, id, voice) {
  const { studio, context, stateDir, gameRoot, targetId } = job;
  const { session } = await studio.beginSoundSession({}, context, stateDir);
  try {
    for (const wave of voice) await stageWave(job, session, wave);
    const plan = await studio.planWeaponSound({ gameRoot, session, weapon: id, targetId }, context, stateDir);
    const applied = { gameRoot, session, weapon: id, targetId, expectedManifestHash: plan.manifestHash };
    const reply = await studio.applyWeaponSound(applied, context, stateDir);
    const slot = `sound-weapon-${soundStudio.weaponSlug(id)}`;
    return { modId: reply.modId, slot };
  } finally {
    await studio.endSoundSession({ session }, context, stateDir);
  }
}

// Один ствол: состояние на входе -> состояние на выходе (связи, поставленные, неполные, сбои).
async function settleWeapon(job, state, candidate) {
  const { id, voice } = candidate;
  const matched = voice.filter((wave) => hasStream(job.streams, wave));
  const present = new Set(matched.map((wave) => wave.stream));
  if (!present.size) return state;
  const coverage = packVoice.packVoiceCoverage(voice, present);
  if (!coverage.complete) return { ...state, partial: [...state.partial, id] };
  try {
    const { modId, slot } = await placeWeapon(job, id, voice);
    const request = { packId: job.packId, weaponId: id, modId, slot, sourceSha: job.sourceSha };
    const nextLinks = weaponPack.linkWeaponOverride(state.links, request).links;
    return { ...state, links: nextLinks, applied: [...state.applied, id] };
  } catch (error) {
    return { ...state, failed: [...state.failed, failureOf(id, error)] };
  }
}

export async function deriveWeaponOverrides(request) {
  const { packId, gameRoot, targetId, stateDir, studio } = request;
  const layers = request.layers === undefined ? [] : request.layers;
  const links = request.links === undefined ? {} : request.links;
  const installed = request.installed === undefined ? [] : request.installed;
  const sourceSha = request.sourceSha === undefined ? null : request.sourceSha;
  const context = request.context === undefined ? {} : request.context;
  const streamsOpt = request.streams;
  const streams = streamsOpt ?? (await readEntryStreams(layers));

  function voiceEntry(weapon) {
    if (!weapon.voice?.length) return [];
    const slot = `sound-weapon-${soundStudio.weaponSlug(weapon.id)}`;
    return [{ id: weapon.id, slot, weapon }];
  }
  const voiced = soundStudio.WEAPON_SOUNDS.flatMap(voiceEntry);
  const candidates = weaponPack.weaponsFreeForPack(voiced, { links, installed });

  const job = { packId, streams, studio, context, stateDir, gameRoot, targetId, sourceSha };
  let state = { links, applied: [], partial: [], failed: [] };
  for (const candidate of candidates) state = await settleWeapon(job, state, candidate.weapon);
  return state;
}

export async function removeWeaponOverrides(request) {
  const { packId, gameRoot, targetId, stateDir, studio } = request;
  const links = request.links === undefined ? {} : request.links;
  const installed = request.installed === undefined ? [] : request.installed;
  const context = request.context === undefined ? {} : request.context;
  const unlinked = weaponPack.unlinkPackWeaponOverrides(links, packId);
  const { links: remaining, entries } = unlinked;

  // Попытка снять один мод: null — снят, иначе запись об отказе.
  async function dropOne(entry) {
    try {
      await studio.removeSoundCustomization({ gameRoot, modId: entry.modId, targetId }, context, stateDir);
      return null;
    } catch (error) {
      return failureOf(entry.weaponId, error);
    }
  }

  // По очереди; мода уже нет среди установленных (или слот занят чужим) — запись молча теряется.
  const attempts = [];
  for (const entry of entries) {
    if (!weaponPack.isLinkedOverrideInstalled(entry, installed)) continue;
    const failure = await dropOne(entry);
    attempts.push([entry, failure]);
  }

  const refused = attempts.filter((attempt) => attempt[1]);
  const removed = attempts.filter((attempt) => !attempt[1]).map((attempt) => attempt[0].weaponId);
  const failed = refused.map((attempt) => attempt[1]);
  const survivorEntries = refused.map((attempt) => {
    const entry = attempt[0];
    return [entry.weaponId, { modId: entry.modId, slot: entry.slot }];
  });
  const survivors = Object.fromEntries(survivorEntries);
  const resultLinks = refused.length ? { ...remaining, [packId]: survivors } : remaining;
  return { links: resultLinks, removed, failed };
}

function linksFileOf(stateDir) {
  return path.join(stateDir, weaponPack.PACK_WEAPON_LINKS_FILE);
}

// Файл связей целиком; нет файла — пустой набор, остальные сбои идут наружу.
async function loadLinks(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

export async function readPackWeaponLinks(stateDir, targetId) {
  const file = linksFileOf(stateDir);
  const byTarget = await loadLinks(file);
  return byTarget[targetId] || {};
}

// Прочитать файл, изменить документ и записать атомарно через временный файл.
export async function writePackWeaponLinks(stateDir, targetId, links) {
  const file = linksFileOf(stateDir);
  const document = await loadLinks(file);
  const hasLinks = Object.keys(links).length > 0;
  if (hasLinks) document[targetId] = links;
  else delete document[targetId];
  const staging = `${file}.${process.pid}.tmp`;
  const body = JSON.stringify(document, null, 2);
  await fs.writeFile(staging, body, "utf8");
  await fs.rename(staging, file);
}

// Конвейер: прочитать связи -> решить и выполнить -> записать связи; ответ null файл не трогает.
async function relink(stateDir, targetId, compute) {
  const current = await readPackWeaponLinks(stateDir, targetId);
  const result = await compute(current);
  if (!result) return result;
  await writePackWeaponLinks(stateDir, targetId, result.links);
  return result;
}

export async function applyPackWeaponVoice(request) {
  const { record, profile, targetId, gameRoot, stateDir, studio } = request;
  const layers = isSoundPackRecord(record) ? packEntryLayers(profile, targetId, record) : [];
  if (!layers.length) return null;
  function compute(links) {
    const installed = profile?.targets?.[targetId]?.installed || [];
    const sourceSha = packSourceSha(profile, targetId, record);
    return deriveWeaponOverrides({
      packId: record.modId,
      layers,
      gameRoot,
      targetId,
      stateDir,
      links,
      installed,
      sourceSha,
      studio,
    });
  }
  return relink(stateDir, targetId, compute);
}

export async function removePackWeaponVoice(request) {
  const { packId, targetId, gameRoot, stateDir, installed, studio } = request;
  function compute(links) {
    return links[packId] ? removeWeaponOverrides({ packId, gameRoot, targetId, stateDir, links, installed, studio }) : null;
  }
  return relink(stateDir, targetId, compute);
}
