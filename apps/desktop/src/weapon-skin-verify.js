/*
 * «Дошло ли до игры» (ТЗ 06.10.2026, вечер, задача 2) — проверка скина
 * ствола после «Применить».
 *
 * Установщик и так сверяет собранный архив (помощник RPF перечитывает его,
 * как игра) и копию в игре (SHA-256 файла целиком). Здесь — взгляд со
 * стороны игрока: открыть пакет `astral_weapons` в самой игре и посмотреть,
 * лежат ли в нём файлы этого ствола и те ли это байты, что поставил Astral;
 * подключён ли пакет в списке дополнений; не совпадает ли файл со штатным
 * (тогда в игре прежний вид). Ответ — по каждому файлу и общий итог словами.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  FAST_WEAPON_DLC_NAME,
  FAST_WEAPON_DLC_TARGET,
  inspectProfile,
} from "@modovik/install-engine";
import { gameWeaponFiles } from "@modovik/gunpack/game-weapon";
import { weaponByModel } from "@modovik/rpf-inspector/weapon-identity";
import { clothingArchiveTools } from "./clothing-models.js";

const refusal = (code, message) => Object.assign(new Error(message), { code });
const WEAPON_MODEL = /^w_[a-z0-9_]{2,60}$/;
const SHA256 = /^[0-9a-f]{64}$/;
/* Текст без имени файла — он в словаре окна на шести языках (`locales/ui-text/zone-skin-fingerprint-2011.js`); имя — в `error.file`. */
const FINGERPRINT_MESSAGE = "Чтение архива игры не вернуло отпечаток файла — сверить скин с поставленным нечем. Проверьте ещё раз; если повторится — перезапустите Astral.";
const STREAM = "astral_stream.rpf";
const DLC_LISTS = ["update:/common/data/dlclist.xml"];

const lower = (value) => String(value || "").toLowerCase();
const baseName = (entry) => lower(entry).split("/").pop();

/** Имена файлов ствола, которые может поставить скин. */
export function weaponSkinFileNames(model) {
  const names = gameWeaponFiles(model);
  return [
    names.textures,
    names.texturesHi,
    names.model,
    names.modelHi,
    names.magazine,
    names.magazineTextures,
    names.magazineTexturesHi,
  ]
    .filter(Boolean)
    .map(lower);
}

/*
 * Что Astral поставил в пакет стволов: верхний слой каждой записи пакета
 * (`resources` цели движка) — SHA-256 и id установки. Ищется по всему
 * состоянию: раскладка целей у движка менялась, а записи архива везде
 * выглядят одинаково (`entries` → `layers`).
 */
export function expectedWeaponEntries(state, names) {
  const wanted = new Set(names);
  const found = new Map();
  const visit = (node, depth, archive) => {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (node.entries && typeof node.entries === "object" && !Array.isArray(node.entries)) {
      const target = lower(node.target || node.archiveTarget || archive || "");
      for (const [entry, value] of Object.entries(node.entries)) {
        const name = baseName(entry);
        if (!wanted.has(name)) continue;
        if (target && !target.includes(FAST_WEAPON_DLC_NAME)) continue;
        const layers = Array.isArray(value?.layers) ? value.layers : [];
        const top = layers[layers.length - 1];
        if (!top) continue;
        found.set(name, {
          name,
          entry,
          action: top.action || "replace",
          sha256: top.sha256 ? String(top.sha256).toLowerCase() : null,
          modId: top.modId || null,
        });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "entries" || key === "layers") continue;
      visit(value, depth + 1, typeof key === "string" && key.endsWith(".rpf") ? key : archive);
    }
  };
  visit(state, 0, "");
  return [...found.values()];
}

/**
 * Проверка в игре. `input`: `{ gameRoot, model }`. Ответ:
 * `{ status: "ok"|"partial"|"missing"|"stock"|"not-installed", title, files: [...], registered }`.
 */
export async function verifyWeaponSkin(input, context, stateDir, tools = {}) {
  const model = lower(input?.model).trim();
  if (!WEAPON_MODEL.test(model) || !weaponByModel(model)) throw refusal("WEAPON_MODEL", "Этот ствол Astral не знает.");
  const gameRoot = String(input?.gameRoot || "");
  if (!gameRoot || !path.isAbsolute(gameRoot)) throw refusal("WEAPON_SKIN_GAME", "Выберите папку GTA V Legacy.");
  const resolved = { ...clothingArchiveTools(stateDir), ...tools };
  const state = await (tools.readState || (() => inspectProfile({ stateDir })))();
  const expected = expectedWeaponEntries(state, weaponSkinFileNames(model));
  const placed = expected.filter((item) => item.action !== "delete" && item.sha256);
  if (!placed.length)
    return {
      model,
      status: "not-installed",
      title: "Скина этого ствола Astral в игру не ставил.",
      files: [],
      registered: null,
    };

  const work = path.join(stateDir, "weapon-models", "verify", randomUUID());
  await fs.mkdir(work, { recursive: true });
  try {
    const dlc = FAST_WEAPON_DLC_TARGET.replace(/\.rpf$/i, "");
    const files = [];
    for (const item of placed) {
      const inner = item.entry.toLowerCase().startsWith(`${STREAM}/`) ? item.entry : `${STREAM}/${item.name}`;
      let read;
      try {
        read = await resolved.read(
          { gameRoot, entry: `${dlc}:/${inner}`, output: path.join(work, `${files.length}-${item.name}`) },
          context,
        );
      } catch (error) {
        files.push({ name: item.name, state: "missing", expected: item.sha256, actual: null, reason: String(error?.message || error) });
        continue;
      }
      const actual = lower(read?.sha256);
      /* Чтение прошло, а отпечатка файла в ответе нет — это ошибка чтения, а не «файл другой» и не «файла нет» (20.11.2026: кэш чтения отдавал ответ без sha256, и скин, который
         стоит, выходил «missing» — «игра покажет прежний вид»). Сверить файл нечем, так и говорим: проверка не выдаёт вердикт про то, чего не смогла сверить. */
      if (!SHA256.test(actual))
        throw Object.assign(refusal("WEAPON_SKIN_FINGERPRINT", FINGERPRINT_MESSAGE), { file: item.name });
      files.push({
        name: item.name,
        state: actual === item.sha256 ? "match" : "different",
        expected: item.sha256,
        actual,
      });
    }
    /* Пакет подключён? Список дополнений игры — в update.rpf. */
    let registered = null;
    for (const list of DLC_LISTS) {
      try {
        const output = path.join(work, "dlclist.xml");
        await resolved.read({ gameRoot, entry: list, output }, context);
        registered = lower(await fs.readFile(output, "utf8")).includes(`dlcpacks:/${FAST_WEAPON_DLC_NAME}/`);
        break;
      } catch {
        /* список не прочитался — итог скажет «не проверено» */
      }
    }
    const matched = files.filter((file) => file.state === "match").length;
    const status =
      registered === false
        ? "unregistered"
        : matched === files.length
          ? "ok"
          : matched
            ? "partial"
            : "missing";
    const titles = {
      ok: `В игре стоит скин: ${matched} из ${files.length} файлов совпали с поставленными Astral.`,
      partial: `В игре только часть скина: совпали ${matched} из ${files.length} файлов.`,
      missing: "Файлов скина в пакете игры нет — игра покажет прежний вид.",
      unregistered: `Файлы на месте, но пакет ${FAST_WEAPON_DLC_NAME} не подключён в списке дополнений игры.`,
    };
    return { model, status, title: titles[status], files, registered };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
