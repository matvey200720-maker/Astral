/*
 * Звук студии: откуда он берётся, как звучит в очереди и что уезжает в игру.
 *
 * Один и тот же замысел (`sound-kit-model.js`) превращается здесь в три вещи:
 *
 *   • звук предпросмотра — выстрел, первый выстрел и хвост очереди в тех
 *     длинах, которые даст игра: у карабина выстрел очереди — 0,14 с, и
 *     слушать свой звук целиком значило бы услышать не то, что будет в игре;
 *   • дорожки для игры — каждая дорожка голоса ствола в своей частоте, своём
 *     канале и своей длине (`renderWeaponWaves`);
 *   • звуки попадания — голова и тело в частоте банка collision и в пределах
 *     его бюджета (`renderHitWaves`).
 *
 * Все три — один рендер `sound-fx.js`: ▶ и игра слышат одни сэмплы.
 *
 * Звук самой игры (без своего замысла) — не одна дорожка голоса, а выстрел,
 * как его собирает игра: дерево ствола из её метаданных, все слои, варианты,
 * огибающие и категории (`renderGameShot`, сведение в потоке).
 */

import { weaponVoiceSeconds } from "@modovik/sound-studio";
import { getWorkshopAsset } from "../workshop-assets.js";
import { channelFor, renderFx } from "./sound-fx.js";
import { synthesize } from "./sound-synth.js";
import { decodeAudioBytes } from "./WaveformPlayer.jsx";
import { base64ToBuffer, encodeWavPcm16 } from "./sound-model.js";
import { createLruCache } from "../lru-cache.js";
import { renderShotParts } from "./shot-render-client.js";
import { tr } from "../../../../locales/ui.js";

export const soundKitAssetKey = (hash) => `sound-studio/${hash}`;

/* Частота предпросмотра своего файла: 48 кГц, как у самого браузера. */
const PREVIEW_RATE = 48000;

const originals = createLruCache(96);
const gameShots = createLruCache(4);
const assets = createLruCache(24);

/** Свой файл человека — из хранилища ассетов мастерской. */
export async function loadAssetBuffer(hash) {
  const cached = assets.get(hash);
  if (cached) return cached;
  const blob = await getWorkshopAsset(soundKitAssetKey(hash));
  if (!blob) throw new Error(tr("Файл звука не найден — выберите его заново."));
  const buffer = await decodeAudioBytes(await blob.arrayBuffer());
  assets.set(hash, buffer);
  return buffer;
}

/** Уже прочитанный файл — сразу в запас, чтобы ▶ не ждал хранилища. */
export const rememberAssetBuffer = (hash, buffer) => assets.set(hash, buffer);

/**
 * Дорожка игры — из банка игрока через главный процесс. Один раз на
 * дорожку: запас держит последние сто.
 */
export async function loadGameWave(host, gameRoot, wave) {
  const key = `${wave.archive}:${wave.bank}:${wave.stream}`;
  const cached = originals.get(key);
  if (cached) return cached;
  if (!host?.readSoundStream)
    throw new Error(
      tr("Голос ствола читается из вашей игры — в браузере его нет."),
    );
  const preview = await host.readSoundStream({
    gameRoot,
    archive: wave.archive,
    bank: wave.bank,
    stream: wave.stream,
  });
  const buffer = await decodeAudioBytes(base64ToBuffer(preview.wav));
  originals.set(key, buffer);
  return buffer;
}

/**
 * Выстрел ствола из игры: программа дерева и дорожки — один раз на ствол
 * (главный процесс читает банки игры при первом вызове, дальше — с диска).
 */
export function loadWeaponShot(host, gameRoot, weaponId) {
  const key = `${gameRoot}|${weaponId}`;
  const cached = gameShots.get(key);
  if (cached) return cached;
  const pending = host.readWeaponShot({ gameRoot, weapon: weaponId });
  gameShots.set(key, pending);
  pending.catch(() => {
    if (gameShots.get(key) === pending) gameShots.delete(key);
  });
  return pending;
}

/* Сколько вариантов следующего выстрела слышно в стрельбе по кругу. */
const GAME_SHOT_VARIANTS = 4;

/**
 * Выстрел игры для живой стрельбы: первый выстрел, варианты следующего и
 * хвост очереди — как их сложит игра, сведённые в потоке. `cadence` — такт
 * очереди автомата из дерева игры (у карабина 86 мс), он и задаёт темп.
 */
export async function renderGameShot(
  weapon,
  { host, gameRoot, suppressed = false, seed = 1 },
) {
  const shot = await loadWeaponShot(host, gameRoot, weapon.id);
  return renderShotParts(`${gameRoot}|${weapon.id}`, shot, {
    suppressed,
    seed,
    variants: GAME_SHOT_VARIANTS,
    sampleRate: PREVIEW_RATE,
  });
}

/* Два моно-буфера в один стерео — голос ствола, как его собирает игра. */
function stereoOf(left, right) {
  const Context =
    globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const rate = left.sampleRate;
  const length = Math.max(left.length, right.length);
  const context = new Context(2, length, rate);
  const buffer = context.createBuffer(2, length, rate);
  buffer.copyToChannel(left.getChannelData(0), 0);
  buffer.copyToChannel(
    right.sampleRate === rate
      ? right.getChannelData(0)
      : left.getChannelData(0),
    1,
  );
  return buffer;
}

/*
 * Голос ствола для предпросмотра: пара дорожек выстрела (левая и правая) и
 * самая длинная дорожка хвоста. Пары может не быть — тогда выстрел звучит
 * одной дорожкой на оба уха, как у игры в «запасном» виде.
 */
export function voiceSample(weapon) {
  /* Слушаем то, что слышит игрок: дорожки «запасного» вида (так ствол
     звучит у других игроков) — только если своих нет. */
  const heard = weapon.voice.some((wave) => !wave.npc)
    ? weapon.voice.filter((wave) => !wave.npc)
    : weapon.voice;
  const shots = heard.filter((wave) => wave.role === "shot");
  const left = shots.find((wave) => wave.channel === "left");
  const right = shots.find(
    (wave) =>
      wave.channel === "right" &&
      (!left ||
        (wave.samples === left.samples && wave.sampleRate === left.sampleRate)),
  );
  const tails = heard
    .filter((wave) => wave.role === "tail")
    .sort((a, b) => b.samples - a.samples);
  return {
    left: left || right || shots[0] || null,
    right: right || left || shots[0] || null,
    tail: tails[0] || null,
  };
}

/**
 * Исходный звук замысла: свой файл, готовый синтез или голос ствола из игры.
 * Для голоса ствола — стерео-пара выстрела; хвост отдаётся отдельно.
 */
export async function designSource(design, { host, gameRoot, weapon }) {
  const source = design?.source;
  if (source?.kind === "file")
    return { shot: await loadAssetBuffer(source.assetHash) };
  if (source?.kind === "synth")
    return { shot: await synthesize(source.recipe) };
  if (!weapon) throw new Error(tr("Выберите свой звук или готовый."));
  const sample = voiceSample(weapon);
  if (!sample.left)
    throw new Error(
      tr("У «{title}» нет своего голоса в игре.").replace(
        "{title}",
        weapon.title,
      ),
    );
  const [left, right, tail] = await Promise.all([
    loadGameWave(host, gameRoot, sample.left),
    sample.right === sample.left
      ? null
      : loadGameWave(host, gameRoot, sample.right),
    sample.tail ? loadGameWave(host, gameRoot, sample.tail) : null,
  ]);
  return { shot: right ? stereoOf(left, right) : left, tail, original: true };
}

const identity = { gain: 0, normalize: false };

/**
 * Предпросмотр очереди ствола: первый выстрел, выстрел очереди и хвост — в
 * длинах игры. Свой файл режется так же, как его разрежет игра по длине
 * дорожек; голос игры с ручками — в своих длинах.
 *
 * @returns {Promise<{first: object, shot: object, tail: object|null}>}
 *   рендеры `renderFx` (каналы, частота)
 */
export async function renderWeaponPreview(weapon, design, context) {
  /* Выстрелы выключены: в предпросмотре тишина — честно, а не голос игры «на всякий случай». Вспышка и гильзы сцены идут своим ходом. */
  if (design?.source?.kind === "silent") {
    const silence = {
      channels: [new Float32Array(PREVIEW_RATE / 10), new Float32Array(PREVIEW_RATE / 10)],
      sampleRate: PREVIEW_RATE,
    };
    return { first: silence, shot: silence, shots: [], tail: null };
  }
  if (!design && context?.host?.readWeaponShot) {
    const parts = await renderGameShot(weapon, context);
    return {
      first: parts.first,
      shot: parts.shots[0] || parts.first,
      shots: parts.shots,
      tail: parts.tail,
      cadence: parts.cadence,
    };
  }
  const source = await designSource(design, { ...context, weapon });
  const fx = design?.fx || identity;
  const shotSeconds = weaponVoiceSeconds(weapon, "shot") || 0.2;
  const tailSeconds = weaponVoiceSeconds(weapon, "tail");
  if (source.original) {
    const rate = source.shot.sampleRate;
    const shot = await renderFx(source.shot, fx, {
      sampleRate: rate,
      channels: 2,
      maxSamples: source.shot.length,
    });
    const tail = source.tail
      ? await renderFx(source.tail, fx, {
          sampleRate: source.tail.sampleRate,
          channels: 2,
          maxSamples: source.tail.length,
        })
      : null;
    return { first: shot, shot, tail };
  }
  const render = (seconds) =>
    renderFx(source.shot, fx, {
      sampleRate: PREVIEW_RATE,
      channels: 2,
      maxSamples: Math.max(1, Math.round(seconds * PREVIEW_RATE)),
    });
  const [shot, tail] = await Promise.all([
    render(shotSeconds),
    tailSeconds ? render(tailSeconds) : null,
  ]);
  /* Первый выстрел очереди у автомата звучит дорожками выстрела и хвоста
     сразу — длиннее следующих. */
  return { first: tail || shot, shot, tail };
}

/** Звук попадания для предпросмотра — в частоте и пределе банка игры. */
export async function renderHitPreview(design, budget) {
  const source = await designSource(design, {});
  const rate = budget?.sampleRate || 24000;
  return renderFx(source.shot, design.fx, {
    sampleRate: rate,
    channels: 1,
    maxSamples: budget?.maxSamples || Math.round(rate * 0.9),
  });
}

/**
 * Дорожки голоса ствола для игры: каждая — в своей частоте, канале и длине.
 *
 * Голос игры обрабатывается дорожка за дорожкой (у каждой свой оригинал);
 * свой файл и синтез рендерятся один раз на каждую пару «частота × длина» и
 * раздаются по каналам.
 *
 * @returns {Promise<Array<{bank: string, stream: string, sampleRate: number,
 *   samples: number, wav: ArrayBuffer}>>}
 */
export async function renderWeaponWaves(weapon, design, { host, gameRoot }) {
  const fx = design.fx;
  const out = [];
  if (design.source.kind === "original") {
    for (const wave of weapon.voice) {
      const original = await loadGameWave(host, gameRoot, wave);
      const rendered = await renderFx(original, fx, {
        sampleRate: wave.sampleRate,
        channels: 1,
        maxSamples: wave.samples,
      });
      out.push({
        bank: wave.bank,
        stream: wave.stream,
        sampleRate: wave.sampleRate,
        samples: rendered.samples,
        wav: encodeWavPcm16(rendered.channels[0], wave.sampleRate),
      });
    }
    return out;
  }
  const { shot } = await designSource(design, { host, gameRoot, weapon });
  const renders = new Map();
  for (const wave of weapon.voice) {
    const key = `${wave.sampleRate}|${wave.samples}`;
    if (!renders.has(key))
      renders.set(
        key,
        await renderFx(shot, fx, {
          sampleRate: wave.sampleRate,
          channels: 2,
          maxSamples: wave.samples,
        }),
      );
    const rendered = renders.get(key);
    out.push({
      bank: wave.bank,
      stream: wave.stream,
      sampleRate: wave.sampleRate,
      samples: rendered.samples,
      wav: encodeWavPcm16(channelFor(rendered, wave.channel), wave.sampleRate),
    });
  }
  return out;
}

/**
 * Звуки попадания для игры: голова и тело — в частоте своей дорожки банка
 * collision и не длиннее её бюджета.
 */
export async function renderHitWaves(hits, budget) {
  const out = [];
  for (const [part, design] of Object.entries(hits)) {
    if (!design) continue;
    const target = budget.parts[part];
    if (!target) throw new Error(tr("Бюджет банка попаданий не прочитан."));
    const rendered = await renderHitPreview(design, target);
    out.push({
      part,
      stream: target.stream,
      sampleRate: target.sampleRate,
      samples: rendered.samples,
      wav: encodeWavPcm16(rendered.channels[0], target.sampleRate),
    });
  }
  return out;
}
