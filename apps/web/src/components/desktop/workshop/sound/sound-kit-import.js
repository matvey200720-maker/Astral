/*
 * Свой файл человека — в студию: проверить, прочитать, сохранить.
 *
 * Файл ложится в хранилище ассетов мастерской под своим SHA-256 — тем же
 * ключом, что у прежней студии (`sound-studio/<hash>`), поэтому один и тот
 * же звук, брошенный на ствол и на попадание, хранится один раз.
 *
 * Два решения принимаются сразу, а не оставляются человеку:
 *
 *   • тишина в начале файла срезается — выстрел, который звучит через
 *     десятую секунды после курка, ощущается как задержка, а записи из
 *     библиотек звуков почти всегда начинаются с паузы;
 *   • у попадания файл длиннее того, что примет банк, обрезается по его
 *     пределу сразу — и ручки обрезки это показывают.
 */

import { sanitizeDesktopErrorMessage } from "../../../../api.js";
import {
  SOUND_ASSET_EXTENSIONS,
  prepareWorkshopAsset,
  putWorkshopAsset,
} from "../workshop-assets.js";
import { decodeAudioBytes } from "./WaveformPlayer.jsx";
import { soundFileProblem } from "./sound-drop.js";
import { SoundImportError } from "./sound-import.js";
import { rememberAssetBuffer, soundKitAssetKey } from "./sound-kit-audio.js";
import { leadingSilenceSeconds } from "./sound-model.js";
import { tr } from "../../../../locales/ui.js";
import { soundDecimal } from "./sound-copy.js";

export { SoundImportError };

/**
 * @param {File[]|FileList} files брошенное или выбранное; берётся первый звук
 * @param {{maxSeconds?: number}} [options] предел длины, если он есть
 * @returns {Promise<{source: object, trimStart: number, trimEnd: number,
 *   buffer: AudioBuffer, notes: string[]}>}
 */
export async function importKitSound(files, { maxSeconds = 0 } = {}) {
  const list = [...(files || [])];
  const file = list.find((item) => !soundFileProblem(item)) || list[0];
  const problem = soundFileProblem(file);
  if (problem) throw new SoundImportError(problem);

  let prepared;
  try {
    prepared = await prepareWorkshopAsset(file, {
      extensions: SOUND_ASSET_EXTENSIONS,
    });
  } catch (error) {
    throw new SoundImportError(
      sanitizeDesktopErrorMessage(error) || tr("Файл не подошёл."),
    );
  }
  const { blob, metadata } = prepared;
  let buffer;
  try {
    buffer = await decodeAudioBytes(await blob.arrayBuffer());
  } catch {
    /* Декодер отвечает по-английски («Unable to decode audio data»). */
    throw new SoundImportError(
      tr("«{name}» не читается как звук — сохраните его заново как wav или mp3.").replace("{name}", metadata.name),
    );
  }
  try {
    await putWorkshopAsset(soundKitAssetKey(metadata.hash), blob);
  } catch (error) {
    throw new SoundImportError(
      sanitizeDesktopErrorMessage(error) || tr("Файл не удалось сохранить."),
    );
  }
  rememberAssetBuffer(metadata.hash, buffer);

  const trimStart = leadingSilenceSeconds(buffer);
  const trimEnd =
    maxSeconds > 0 && buffer.duration - trimStart > maxSeconds
      ? Math.round((trimStart + maxSeconds) * 1000) / 1000
      : 0;
  const notes = [
    list.length > 1
      ? tr("Взят «{name}»: на один звук встаёт один файл").replace("{name}", metadata.name)
      : "",
    trimEnd
      ? tr("В игру уйдут первые {seconds} с — подвиньте обрезку").replace("{seconds}", soundDecimal(String(maxSeconds)))
      : "",
  ].filter(Boolean);
  return {
    source: { kind: "file", assetHash: metadata.hash, assetName: metadata.name },
    trimStart,
    trimEnd,
    buffer,
    notes,
  };
}
