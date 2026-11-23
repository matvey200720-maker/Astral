// Приём файла со звуком на цель студии: проверка, чтение, сохранение, срез тишины и предел длины.
import { SOUND_LIMITS } from "@modovik/sound-studio";
import { sanitizeDesktopErrorMessage } from "../../../../api.js";
import {
  SOUND_ASSET_EXTENSIONS,
  prepareWorkshopAsset,
  putWorkshopAsset,
} from "../workshop-assets.js";
import { decodeAudioBytes } from "./WaveformPlayer.jsx";
import { soundFileProblem } from "./sound-drop.js";
import { leadingSilenceSeconds } from "./sound-model.js";
import { targetMaxSeconds } from "./sound-targets.js";
import { soundAssetKey } from "./useSoundAudio.js";
import { tr } from "../../../../locales/ui.js";
import { soundDecimal, soundReason } from "./sound-copy.js";

export class SoundImportError extends Error {}

const refuse = (text) => new SoundImportError(text);

// Первый подходящий звук списка; если звуков нет — первый элемент как есть.
function pickFile(files) {
  const listed = [];
  for (const entry of files || []) listed.push(entry);
  const sound = listed.find((entry) => !soundFileProblem(entry));
  return { file: sound ?? listed[0], count: listed.length };
}

function requireUsableFile(file) {
  const problem = soundFileProblem(file);
  if (problem) throw refuse(problem);
}

function requireOpenTarget(target) {
  if (target.replaceable) return;
  throw refuse(soundReason(target.reason) || tr("Этот звук заменить нельзя."));
}

function requireRoom(options) {
  const used = options.assignedInBank ?? 0;
  const added = options.fresh ?? 0;
  if (used + added > SOUND_LIMITS.streamsPerSession) {
    throw refuse(
      tr("В одном банке можно заменить до {count} звуков за раз — верните оригинал на лишних.").replace(
        "{count}",
        SOUND_LIMITS.streamsPerSession,
      ),
    );
  }
}

async function vetFile(file) {
  try {
    return await prepareWorkshopAsset(file, { extensions: SOUND_ASSET_EXTENSIONS });
  } catch (failure) {
    throw refuse(sanitizeDesktopErrorMessage(failure) || tr("Файл не подошёл."));
  }
}

async function decodeStored(blob, name) {
  try {
    return await decodeAudioBytes(await blob.arrayBuffer());
  } catch {
    throw refuse(
      tr("«{name}» не читается как звук — сохраните его заново как wav или mp3.").replace("{name}", name),
    );
  }
}

async function shelve(hash, blob) {
  try {
    await putWorkshopAsset(soundAssetKey(hash), blob);
  } catch (failure) {
    throw refuse(sanitizeDesktopErrorMessage(failure) || tr("Файл не удалось сохранить."));
  }
}

// Начало и конец обрезки в секундах; предел длины — запас слота или обычный предел цели.
function planTrim(buffer, target, maxSeconds) {
  const ceiling = maxSeconds > 0 ? maxSeconds : targetMaxSeconds(target);
  const trimStart = target.kind === "bank" ? 0 : leadingSilenceSeconds(buffer);
  const overlong = buffer.duration - trimStart > ceiling;
  const trimEnd = overlong ? Math.floor((trimStart + ceiling) * 1000) / 1000 : 0;
  return { ceiling, trimStart, trimEnd };
}

function notesFor(name, count, plan) {
  const notes = [];
  if (count > 1) {
    notes.push(tr("Взят «{name}»: на один звук встаёт один файл").replace("{name}", name));
  }
  if (plan.trimEnd) {
    const seconds = soundDecimal(String(Math.round(plan.ceiling * 100) / 100));
    notes.push(tr("В игру уйдут первые {seconds} с — подвиньте обрезку").replace("{seconds}", seconds));
  }
  return notes;
}

export async function prepareSoundImport(files, target, options = {}) {
  const { file, count } = pickFile(files);
  requireUsableFile(file);
  requireOpenTarget(target);
  requireRoom(options);

  const { blob, metadata } = await vetFile(file);
  const buffer = await decodeStored(blob, metadata.name);
  await shelve(metadata.hash, blob);

  const plan = planTrim(buffer, target, options.maxSeconds ?? 0);
  return {
    metadata,
    buffer,
    patch: {
      assetHash: metadata.hash,
      assetName: metadata.name,
      trimStart: plan.trimStart,
      trimEnd: plan.trimEnd,
    },
    notes: notesFor(metadata.name, count, plan),
  };
}
