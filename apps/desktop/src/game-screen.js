/*
 * Экран игры игрока: форма, под которую GTA раскладывает HUD, и безопасная
 * зона (ТЗ 11.10.2026, день, задача 1).
 *
 * Кадр мини-карты игра ставит по frontend.xml в долях экрана своей формы и
 * от края своей безопасной зоны (`gameEntryRect` в @modovik/minimap-contract).
 * Обе величины — настройки игрока:
 *
 *   форма — `AspectRatio` в settings.xml (0 — «Авто», форма разрешения);
 *     растянутый 4:3 на мониторе 1920×1080 (2) игра считает как 4:3 —
 *     GET_ASPECT_RATIO 1,3333 на стенде;
 *   безопасная зона — настройка профиля 212 в Profiles/<id>/pc_settings.bin
 *     (пары «номер, значение» по 4 байта): 3 → размер 0,97, GET_SAFE_ZONE_SIZE
 *     на стенде тот же; размер = 1 − значение/100.
 *
 * Чего нет — того нет: без файла форма неизвестна, без профиля — отступ игры
 * по умолчанию. Экран отдаётся ВСЕГДА, с причиной (`known: false`, `reason`) и
 * сырьём (`raw`): журнал сверки с игрой (ТЗ H1, 14.11.2026) знает не только «что
 * считали», но и «из чего и откуда это взято».
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  GTA_ASPECT_RATIO_SETTING,
  MINIMAP_GAME_SAFE_INSET,
  gameScreenAspect,
  screenStretch,
} from "@modovik/minimap-contract/game-screen";

const SAFE_ZONE_SETTING = 212;

/* Число из `<ключ value="…"/>`; нет ключа, пусто или не число — `null`. */
function settingValue(xml, key) {
  const match = new RegExp(`<${key}\\s+value="([^"]*)"`, "i").exec(xml);
  if (!match || !match[1].trim()) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** Значение настройки профиля по номеру из pc_settings.bin (или `null`). */
export function profileSetting(buffer, id) {
  if (!Buffer.isBuffer(buffer)) return null;
  for (let offset = 0; offset + 8 <= buffer.length; offset += 8)
    if (buffer.readUInt32LE(offset) === id)
      return buffer.readUInt32LE(offset + 4);
  return null;
}

/* Профиль, в который игра писала последним, — его настройки сейчас в игре: `{ file, profile, mtimeMs }` или `null`. */
export async function latestProfileFile(settingsFile) {
  const root = path.join(path.dirname(settingsFile), "Profiles");
  let newest = null;
  for (const name of await fs.readdir(root).catch(() => [])) {
    const file = path.join(root, name, "pc_settings.bin");
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile() && (!newest || stat.mtimeMs > newest.mtimeMs))
      newest = { file, profile: name, mtimeMs: stat.mtimeMs };
  }
  return newest
    ? { file: newest.file, profile: newest.profile, mtimeMs: newest.mtimeMs }
    : null;
}

/* Экран, которого узнать не удалось: причина и честные «не узнать» вместо чисел. */
function unknownScreen(reason, sources) {
  return {
    known: false,
    reason,
    aspect: null,
    inset: MINIMAP_GAME_SAFE_INSET,
    aspectRatioSetting: null,
    width: null,
    height: null,
    safeZone: null,
    windowed: null,
    stretched: false,
    raw: null,
    sources,
  };
}

/** Неизвестный экран с названной причиной — когда сам разбор файла упал: тот же вид, что у `readGameScreen`. */
export function unknownGameScreen(reason = "unreadable") {
  return unknownScreen(
    reason,
    reason === "no-file"
      ? { aspect: "default", inset: "default" }
      : { aspect: "unknown", inset: "unknown" },
  );
}

/**
 * Экран игры игрока — всё сырьё и источник каждого значения.
 *
 * `{ known: true, reason: null, aspect, inset, aspectRatioSetting, width, height,
 * safeZone, windowed, stretched, raw, sources }`:
 *
 *   raw.aspectRatio / screenWidth / screenHeight / windowed — как записаны в
 *     settings.xml (`null` — ключа нет или он пуст);
 *   raw.settingsFile / raw.profile — `{ path, mtimeMs }` и `{ name, file, mtimeMs }`
 *     файлов, из которых прочитано (профиль — последний, в который писала игра);
 *   raw.safeZoneStep — сырая настройка 212 профиля (`null` — профиля нет);
 *   sources.aspect — `"settings"`: форму задаёт код `AspectRatio` 1…8; `"auto-resolution"`:
 *     код 0 («Авто»), пустой или неизвестный — форма самого разрешения;
 *   sources.inset — `"profile"`: настройка 212 прочиталась (0…10); иначе `"default"`.
 *
 * Не узнать — тот же объект с `known: false`, причиной и без чисел:
 * `reason: "no-file"` (settings.xml нет), `"enhanced"` (у Enhanced свои настройки,
 * файл не читается), `"unreadable"` (файл есть, но ни кода, ни разрешения в нём нет).
 */
export async function readGameScreen(settingsFile, { edition = null } = {}) {
  if (
    typeof edition === "string" &&
    edition.trim().toLowerCase() === "enhanced"
  )
    return unknownScreen("enhanced", { aspect: "unknown", inset: "unknown" });
  if (!settingsFile)
    return unknownScreen("no-file", { aspect: "default", inset: "default" });
  const [xml, fileStat] = await Promise.all([
    fs.readFile(settingsFile, "utf8").catch(() => null),
    fs.stat(settingsFile).catch(() => null),
  ]);
  /* Файла нет вовсе — «нет файла»; файл есть, но пуст или не читается (игра закрылась на записи) — «не прочитался», с путём. */
  if (xml === null && !fileStat)
    return unknownScreen("no-file", { aspect: "default", inset: "default" });
  const width = settingValue(xml ?? "", "ScreenWidth");
  const height = settingValue(xml ?? "", "ScreenHeight");
  const aspectRatioSetting = settingValue(xml ?? "", "AspectRatio");
  const windowed = settingValue(xml ?? "", "Windowed");
  const aspect = gameScreenAspect({
    aspectRatio: aspectRatioSetting,
    width,
    height,
  });
  const settingsFacts = {
    path: settingsFile,
    mtimeMs: fileStat ? fileStat.mtimeMs : null,
  };
  if (!aspect)
    return {
      ...unknownScreen("unreadable", { aspect: "unknown", inset: "unknown" }),
      /* Файл есть, но ни кода, ни разрешения: журнал называет, какой файл не прочитался. */
      raw: {
        aspectRatio: aspectRatioSetting,
        screenWidth: width,
        screenHeight: height,
        windowed,
        settingsFile: settingsFacts,
        profile: null,
        safeZoneStep: null,
      },
    };
  const profile = await latestProfileFile(settingsFile);
  const step = profile
    ? profileSetting(
        await fs.readFile(profile.file).catch(() => null),
        SAFE_ZONE_SETTING,
      )
    : null;
  const safeZone =
    Number.isInteger(step) && step >= 0 && step <= 10 ? 1 - step / 100 : null;
  return {
    known: true,
    reason: null,
    aspect,
    inset: safeZone === null ? MINIMAP_GAME_SAFE_INSET : (1 - safeZone) / 2,
    aspectRatioSetting,
    width,
    height,
    safeZone,
    windowed,
    stretched: screenStretch({ aspect, width, height }).stretched,
    raw: {
      aspectRatio: aspectRatioSetting,
      screenWidth: width,
      screenHeight: height,
      windowed,
      settingsFile: settingsFacts,
      profile: profile
        ? {
            name: profile.profile,
            file: profile.file,
            mtimeMs: profile.mtimeMs,
          }
        : null,
      safeZoneStep: step,
    },
    sources: {
      aspect: GTA_ASPECT_RATIO_SETTING[aspectRatioSetting]
        ? "settings"
        : "auto-resolution",
      inset: safeZone === null ? "default" : "profile",
    },
  };
}
