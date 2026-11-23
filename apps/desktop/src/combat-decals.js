/*
 * Раны и кровь в 3D-предпросмотрах боя (ТЗ 18.10.2026, задача 4А, декали) — данные
 * из игры игрока, только чтение.
 *
 * Что читается:
 *   • `common/data/effects/peds/peddamage.xml` (update.rpf, иначе common.rpf) —
 *     система повреждений педа: для каждого вида (`BulletSmall`, `BulletLarge`,
 *     `ShotgunSmall`, …) листы раны, подтёка и брызг, размеры, интенсивность
 *     «мокро» и «сухо», время высыхания и исчезновения;
 *   • `textures/peddamagedecals.ytd` (x64a.rpf) — листы раны (`pd_wound_sheet`,
 *     2 × 8 кадров) и подтёка (`pd_soak_splat`, 4 × 4);
 *   • `common/data/effects/decals.dat` — какие клетки листа брызг у каких номеров
 *     декалей, которые называет bloodfx.dat (1010 — брызги, 1015 — направленные,
 *     1017 — взвесь);
 *   • `fxdecal_splatter_mist` из `x64/textures/fxdecal.ytd` — лист брызг 3 × 3.
 *
 * Листы игры — не картинки, а маски в каналах: у раны синий — тело, красный —
 * ободок; у подтёка зелёный — пятно, синий — брызги; у брызг на земле — альфа.
 * Окно получает каналы как есть, сырыми байтами, и само решает, чем их красить:
 * шейдер игры (`damage_blits`) Astral не разбирал. 11,9 МБ листа `fxdecal` в окно
 * не едут — только нужная текстура, одной альфой.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { decodeNamedTexture, readTextureDictionary } from "@modovik/rage-drawable";
import { inflateRawNode } from "@modovik/rpf7/node";
import { clothingArchiveTools } from "./clothing-models.js";

const refusal = (code, message) => Object.assign(new Error(message), { code });

/* Верхние пределы на чтение: файлы настоящие, но чужой архив не должен раздуть окно. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_TEXTURE_PIXELS = 2048 * 2048;

const ENTRIES = Object.freeze({
  pedDamage: ["update:/common/data/effects/peds/peddamage.xml", "common:/data/effects/peds/peddamage.xml"],
  decals: ["update:/common/data/effects/decals.dat", "common:/data/effects/decals.dat"],
  pedDecals: ["x64a:/textures/peddamagedecals.ytd"],
  fxDecal: ["update:/x64/textures/fxdecal.ytd", "x64a:/textures/fxdecal.ytd"],
});

/* Что берём из словарей: имя листа → каналы, которые нужны окну. */
const PED_SHEETS = Object.freeze({ pd_wound_sheet: "rgb", pd_soak_splat: "rgb" });
const FX_SHEETS = Object.freeze({ fxdecal_splatter_mist: "a" });

const cache = new Map();

async function readEntry(tools, { gameRoot, candidates, directory, name, context }) {
  let failure = null;
  for (const entry of candidates) {
    const output = path.join(directory, name);
    try {
      await tools.read({ gameRoot, entry, output }, context);
      return { entry, bytes: await fs.readFile(output) };
    } catch (error) {
      failure = error;
    }
  }
  throw failure || refusal("COMBAT_DECALS_ENTRY", "Файла нет в архивах игры.");
}

/** Каналы текстуры сырыми байтами подряд по пикселям: `rgb` — три, `a` — один. */
export function channelsOf(texture, channels) {
  const { width, height, rgba } = texture;
  if (!width || !height || width * height > MAX_TEXTURE_PIXELS) throw refusal("COMBAT_DECALS_TEXTURE", "Лист декалей слишком велик.");
  const per = channels === "a" ? 1 : 3;
  const out = new Uint8Array(width * height * per);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (channels === "a") out[pixel] = rgba[pixel * 4 + 3];
    else {
      out[pixel * 3] = rgba[pixel * 4];
      out[pixel * 3 + 1] = rgba[pixel * 4 + 1];
      out[pixel * 3 + 2] = rgba[pixel * 4 + 2];
    }
  }
  return { width, height, channels, data: out.buffer };
}

export function sheetsFrom(bytes, wanted) {
  const dictionary = readTextureDictionary(bytes, { inflateRaw: inflateRawNode });
  const sheets = {};
  for (const [name, channels] of Object.entries(wanted)) {
    const texture = decodeNamedTexture(name, [dictionary]);
    if (texture) sheets[name] = channelsOf(texture, channels);
  }
  return sheets;
}

/**
 * Данные раны и крови: `{ pedDamage, decals, sheets }` — тексты файлов игры и листы
 * каналами. Читается один раз на игру и запоминается на запуск Desktop.
 */
export async function readCombatDecals(input, context, stateDir, tools = {}) {
  const gameRoot = String(input?.gameRoot || "");
  if (!gameRoot || !path.isAbsolute(gameRoot)) throw refusal("COMBAT_DECALS_GAME", "Выберите папку GTA V Legacy.");
  const key = gameRoot.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const resolved = { ...clothingArchiveTools(stateDir), ...tools };
  /* Разбор словарей текстур подменяется в тесте: настоящих `.ytd` игры в репозитории нет. */
  const decode = tools.sheets || sheetsFrom;
  const pending = (async () => {
    const directory = path.join(stateDir, "combat-decals", `read-${randomUUID()}`);
    await fs.mkdir(directory, { recursive: true });
    try {
      const read = (name, candidates) => readEntry(resolved, { gameRoot, candidates, directory, name, context });
      const [pedDamage, decals, pedDecals, fxDecal] = await Promise.all([
        read("peddamage.xml", ENTRIES.pedDamage),
        read("decals.dat", ENTRIES.decals),
        read("peddamagedecals.ytd", ENTRIES.pedDecals),
        read("fxdecal.ytd", ENTRIES.fxDecal),
      ]);
      for (const file of [pedDamage, decals]) if (file.bytes.length > MAX_TEXT_BYTES) throw refusal("COMBAT_DECALS_LARGE", "Файл данных повреждений слишком велик.");
      return {
        pedDamage: pedDamage.bytes.toString("utf8"),
        decals: decals.bytes.toString("latin1"),
        sheets: { ...decode(pedDecals.bytes, PED_SHEETS), ...decode(fxDecal.bytes, FX_SHEETS) },
        from: { pedDamage: pedDamage.entry, decals: decals.entry, pedDecals: pedDecals.entry, fxDecal: fxDecal.entry },
      };
    } finally {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  })();
  cache.set(key, pending);
  /* Отказ не запоминается: следующий заход попробует снова. */
  pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key);
  });
  return pending;
}

/** Для тестов: забыть прочитанное. */
export function forgetCombatDecals() {
  cache.clear();
}
