/*
 * «Дальность прорисовки» в файлах (задача 7 ТЗ 06.10.2026).
 *
 * Пакет — два файла (`@modovik/optimizer/draw-distance.js`):
 *   • `timecycle_mods_2.xml` с одним модификатором `AstralDrawDistance`
 *     (дальность отсечения и туман-стена по ползунку и цвету) — движок
 *     кладёт его поверх файла игрока объединением по имени;
 *   • `astral_draw_distance.ymap` — карта с одной коробкой этого
 *     модификатора на всю карту. Карта от ползунка не зависит: собирается
 *     нативным хостом (`compile-timecycle-box`) один раз и лежит в кэше.
 *
 * Файлов игры сборка не читает: модификатор и коробка — свои.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  DRAW_DISTANCE_MAP,
  DRAW_DISTANCE_TIMECYCLE_FILE,
  drawDistanceBoxRequest,
  drawDistanceModifierXml,
  normalizeDrawDistance,
} from "@modovik/optimizer/draw-distance.js";
import { buildDrawDistanceManifest, isDrawDistanceModId, isLocalDrawDistanceManifest } from "@modovik/install-engine/draw-distance-manifest-trust.js";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: "wx" });
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/* Карта с коробкой: под отпечатком запроса — один раз, дальше из кэша. */
async function boxMap(stateDir, compile) {
  const request = drawDistanceBoxRequest();
  const key = sha256(Buffer.from(JSON.stringify(request), "utf8")).slice(0, 16);
  const cached = path.join(stateDir, "optimization", "draw-distance", "box", `${key}.ymap`);
  const existing = await fs.readFile(cached).catch(() => null);
  if (existing?.length) return existing;
  if (typeof compile !== "function") throw new Error("Сборщик карты дальности не подключён — обновите Astral.");
  const work = path.join(stateDir, "optimization", "draw-distance", "work", randomUUID());
  await fs.mkdir(work, { recursive: true });
  try {
    const input = path.join(work, "request.json");
    await fs.writeFile(input, JSON.stringify(request), { flag: "wx" });
    await compile("compile-timecycle-box", { input, output: work });
    const bytes = await fs.readFile(path.join(work, `${DRAW_DISTANCE_MAP}.ymap`)).catch(() => null);
    if (!bytes?.length) throw new Error("Карта дальности прорисовки не собралась.");
    await atomicWrite(cached, bytes);
    return bytes;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Пакет под настройки: `{ manifest, packageRoot, settings }`. «Как в игре»
 * (дальности нет) — отказ: такой пакет не собирается, его снимают.
 */
export async function buildDrawDistancePackage(input, stateDir, { compile = null } = {}) {
  const settings = normalizeDrawDistance(input);
  if (settings.distance === null) throw new Error("«Как в игре» — ставить нечего.");
  const files = [
    { name: DRAW_DISTANCE_TIMECYCLE_FILE, bytes: Buffer.from(drawDistanceModifierXml(settings), "utf8") },
    { name: `${DRAW_DISTANCE_MAP}.ymap`, bytes: await boxMap(stateDir, compile) },
  ];
  const described = files.map((file) => ({ name: file.name, size: file.bytes.length, sha256: sha256(file.bytes) }));
  const manifest = buildDrawDistanceManifest(settings.distance, described);
  if (!isLocalDrawDistanceManifest(manifest, "Legacy")) throw new Error("Собранная дальность прорисовки не прошла строгую проверку доверия.");
  const packageRoot = path.join(stateDir, "optimization", "draw-distance", "packages", manifest.drawDistance.sourceDigest.slice(7, 23));
  for (const file of files) {
    const target = path.join(packageRoot, "payload", file.name);
    const current = await fs.readFile(target).catch(() => null);
    if (!current || !current.equals(file.bytes)) await atomicWrite(target, file.bytes);
  }
  return { manifest, packageRoot, settings };
}

/** Пакеты дальности, которые движок числит за этой игрой. */
export async function installedDrawDistance(readState, stateDir, targetId) {
  const state = await readState({ stateDir });
  return (state?.targets?.[targetId]?.installed || []).filter((item) => isDrawDistanceModId(item?.modId));
}
