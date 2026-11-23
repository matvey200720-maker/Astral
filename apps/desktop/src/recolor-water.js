/*
 * Вода: пакет из файлов игры игрока.
 *
 * Своих файлов у воды нет — всё берётся у игрока и правится на месте
 * (устройство воды — `@modovik/climb-contract/recolor/water`):
 *
 *  • плитки тумана `waterfog_txds.rpf` и их упрощённые копии
 *    `waterfog_txds_dx.rpf` — из ОСНОВЫ update.rpf: чистой копии движка без
 *    записей Astral (иначе второе «Применить» красило бы уже перекрашенное);
 *    нет основы — из живого архива, Astral туда ещё не писал. Каждый уровень
 *    mip разбирается, красится той же арифметикой, что и кадр редактора, и
 *    сжимается обратно в свой формат (BC7 режима 6 / DXT1) — длина та же;
 *  • `water.xml` (основа update.rpf, иначе common.rpf) и
 *    `water_heistisland.xml` — альфа квадов под прозрачность моря и озёр;
 *  • реки — файлы из описи `inventory/water`: туман рек красится обликом
 *    воды по месту реки на карте;
 *  • под водой — подводные модификаторы `timecycle_mods_1.xml` (основа
 *    update.rpf, иначе common.rpf): три общих и местные виды берега, порта,
 *    каналов, рек и озёр (`WATER_UNDERWATER_LAYER`, задача 7 ТЗ 11.10.2026),
 *    пересчитанные под облик работы (`waterUnderwaterModifier`), —
 *    отдельным документом слоя объединения таймцикла: движок кладёт их
 *    поверх файла игрока по имени;
 *  • подводная дымка — `underwater_render_mist.xml` (основа update.rpf,
 *    иначе common.rpf) с альфой частиц под чистоту — копией поверх.
 *
 * Файл, который правка не меняет, в пакет не едет: плитка суши, группа
 * «как в игре», прозрачность Rockstar. Работа идёт в главном процессе с
 * передышкой между плитками — окно не замирает на десяток секунд.
 */

import { ensureStoredFile } from "@modovik/install-engine/chunk-store.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import WATER_INVENTORY from "@modovik/climb-contract/recolor/inventory/water";
import {
  WATER_FOG_GRIDS,
  compileWaterLooks,
  WATER_UNDERWATER_ENTRY,
  WATER_UNDERWATER_LAYER,
  WATER_UNDERWATER_MIST_ENTRY,
  WATER_UNDERWATER_MODIFIERS,
  normalizeWaterProject,
  waterFogEngineLook,
  waterFogTileEntries,
  waterFogTileRect,
  waterProjectIsVanilla,
  waterQuadAlpha,
  waterUnderLook,
  waterUnderwaterMist,
  waterUnderwaterModifier,
} from "@modovik/climb-contract/recolor/water";
import { parseTimecycleModifierXml, serializeTimecycleModifierXml } from "@modovik/install-engine/timecycle-merge.js";
import { buildWaterManifest, isLocalWaterManifest } from "@modovik/install-engine/water-manifest-trust.js";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { createGameReader } from "./optimization-layers.js";
import { heavyWork } from "./heavy-work.js";
import { mapLimit } from "@modovik/install-engine/map-limit.js";
import { writePackageFiles } from "./package-files.js";
import { buildWaterTilesOnEngine, waterEngineEnabled } from "./water-engine-build.js";

const UPDATE_ARCHIVE = "update/update.rpf";
const WATER_XML = "common/data/levels/gta5/water.xml";
const WATER_XML_COMMON = "data/levels/gta5/water.xml";
const ISLAND_XML = "common/data/levels/gta5/water_heistisland.xml";
const UNDERWATER_COMMON = "data/timecycle/timecycle_mods_1.xml";
const MIST_COMMON = "data/levels/gta5/weather/underwater_render_mist.xml";
/* Озеро по квадам — с запасом: туман у кромки берётся с соседних точек. */
const LAKE_MARGIN = 30;
const KEEP_PACKAGES = 3;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const samePath = (left, right) => Boolean(left && right) && path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

/* ------------------------------------------------------------------ *
 * Квады воды
 * ------------------------------------------------------------------ */

/* Квады раздела `<WaterQuads>`: тело элемента и его место в тексте. */
function waterQuadItems(xml) {
  const section = /<WaterQuads>([\s\S]*?)<\/WaterQuads>/.exec(xml);
  if (!section) return { items: [], start: 0, body: "" };
  const start = section.index + section[0].indexOf(section[1]);
  const items = [];
  const pattern = /<Item>[\s\S]*?<\/Item>/g;
  for (let match = pattern.exec(section[1]); match; match = pattern.exec(section[1]))
    items.push({ at: start + match.index, text: match[0] });
  return { items, start, body: section[1] };
}

const fieldOf = (text, name) => {
  const match = new RegExp(`<${name}\\s+value="([^"]*)"`).exec(text);
  return match ? Number(match[1]) : NaN;
};

/** Озёра — квады воды выше нуля: `[запад, юг, восток, север]` с запасом. */
export function waterLakes(xml) {
  return waterQuadItems(String(xml || ""))
    .items.filter((item) => Math.abs(fieldOf(item.text, "z")) > 0.01)
    .map((item) => [
      fieldOf(item.text, "minX") - LAKE_MARGIN,
      fieldOf(item.text, "minY") - LAKE_MARGIN,
      fieldOf(item.text, "maxX") + LAKE_MARGIN,
      fieldOf(item.text, "maxY") + LAKE_MARGIN,
    ])
    .filter((rect) => rect.every(Number.isFinite));
}

/**
 * `water.xml` с альфой квадов под прозрачность: море (высота 0) — облик
 * моря, озёра — облик озёр и рек. Остальной текст — байт в байт.
 * Возвращает `{ xml, changed }`.
 */
export function patchWaterQuads(xml, looks) {
  const text = String(xml || "");
  const { items } = waterQuadItems(text);
  let out = "";
  let cursor = 0;
  let changed = 0;
  for (const item of items) {
    const inland = Math.abs(fieldOf(item.text, "z")) > 0.01;
    const transparency = (inland ? looks.inland : looks.sea).transparency;
    const next = item.text.replace(/<(a[1-4])(\s+value=")(\d+)(")/g, (match, name, before, value, after) => {
      const alpha = waterQuadAlpha(Number(value), transparency);
      if (alpha === Number(value)) return match;
      changed += 1;
      return `<${name}${before}${alpha}${after}`;
    });
    out += text.slice(cursor, item.at) + next;
    cursor = item.at + item.text.length;
  }
  out += text.slice(cursor);
  return { xml: out, changed };
}

/* ------------------------------------------------------------------ *
 * Текстуры
 * ------------------------------------------------------------------ */

/* Перекраска плиток и рек — `water-tiles.js` (считает пул потоков). */
export { recolourFogTile, recolourRiverFile } from "./water-tiles.js";

/* ------------------------------------------------------------------ *
 * Игра
 * ------------------------------------------------------------------ */

/**
 * Основа update.rpf: чистая копия движка (`compositionBase`), если Astral
 * уже собирал этот архив, иначе — живой архив.
 */
export async function waterBaseArchive({ gameRoot, stateDir, readState }) {
  const state = readState ? await readState({ stateDir }).catch(() => null) : null;
  const targets = state?.targets && typeof state.targets === "object" ? Object.values(state.targets) : [];
  const target = targets.find((item) => samePath(item?.gameRoot, gameRoot));
  const base = target?.resources?.[UPDATE_ARCHIVE]?.compositionBase;
  if (base?.exists && base.path && (await ensureStoredFile(base.path))) return { path: base.path, source: "base" };
  return { path: path.join(gameRoot, "update", "update.rpf"), source: "live" };
}

/**
 * Чтение воды из игры: `{ update(запись), common(запись), river(адрес), close }`.
 * `updatePath`, `gameRoot` и `keysDirectory` — для движка сборки: плитки тумана он читает из того же архива сам.
 * `tools` в тестах подменяют архивы.
 */
export async function openWaterGame({ gameRoot, stateDir, readState }, tools = {}) {
  if (tools.openWaterGame) return tools.openWaterGame({ gameRoot, stateDir });
  const keysDirectory = await archiveKeysDirectory({ stateDir, provision: provisionArchiveSupport });
  const keys = await keysFromDirectory(keysDirectory || "");
  const base = await waterBaseArchive({ gameRoot, stateDir, readState });
  const update = await openRpfFile(base.path, { keys });
  const common = await openRpfFile(path.join(gameRoot, "common.rpf"), { keys }).catch(() => null);
  const game = createGameReader(gameRoot, keys);
  const index = (archive) => new Map(archive.entries.map((entry) => [entry.path.toLowerCase(), entry]));
  const updateIndex = index(update);
  const commonIndex = common ? index(common) : new Map();
  const readFrom = async (archive, map, entry) => {
    const found = map.get(entry.toLowerCase());
    return found ? Buffer.from(await archive.read(found.path)) : null;
  };
  return {
    source: base.source,
    updatePath: base.path,
    gameRoot,
    keysDirectory: keysDirectory || "",
    update: (entry) => readFrom(update, updateIndex, entry),
    common: (entry) => (common ? readFrom(common, commonIndex, entry) : null),
    river: (at) => game.read(at),
    async close() {
      await update.close?.().catch(() => {});
      await common?.close?.().catch(() => {});
      await game.close().catch(() => {});
    },
  };
}

/* ------------------------------------------------------------------ *
 * Сборка
 * ------------------------------------------------------------------ */

/**
 * Файлы пакета под работу: `[{ kind, name, bytes }]` и отчёт. `game` —
 * `openWaterGame`. `engine` — движок сборки (`{ executable, threads?, onSpawn? }`): плитки тумана красит он, а что он не взял — прежний
 * код в пуле потоков; `null` — всё красит пул.
 */
export async function buildWaterFiles(input, game, { onProgress = null, pool = heavyWork, engine = null } = {}) {
  const project = normalizeWaterProject(input);
  const looks = compileWaterLooks(project);
  const files = [];
  const report = { tiles: 0, dxTiles: 0, unchangedTiles: 0, missingTiles: 0, rivers: 0, missingRivers: [], quads: 0 };

  const baseXml = (await game.update(WATER_XML)) || (await game.common(WATER_XML_COMMON));
  if (!baseXml) throw new Error("В архивах игры не нашлось water.xml — вода без основы не собирается.");
  const xml = baseXml.toString("utf8");
  const lakes = waterLakes(xml);

  /* Прозрачность — квады моря, озёр и Кайо-Перико. */
  for (const [name, text] of [
    ["water.xml", xml],
    ["water_heistisland.xml", (await game.update(ISLAND_XML))?.toString("utf8") || null],
  ]) {
    if (!text) continue;
    const patched = patchWaterQuads(text, looks);
    if (!patched.changed) continue;
    report.quads += patched.changed;
    files.push({ kind: "xml", name, bytes: Buffer.from(patched.xml, "utf8") });
  }

  /* Цвет — плитки тумана штата и Кайо, полные и упрощённые. */
  if (looks.sea.tint || looks.inland.tint) {
    const tiles = Object.entries(WATER_FOG_GRIDS).flatMap(([grid, { cols, rows }]) =>
      Array.from({ length: cols * rows }, (_, index) => ({ grid, index })),
    );
    /* Плитки красит движок (`water-engine-build.js`, 14.11.2026): это 96 % сборки воды — разбор и сжатие BC7 на каждом уровне mip.
       Файлы выходят те же байт в байт. Плитку, которую движок не взял (нет движка, отказ, незнакомый формат), красит пул потоков
       (`water-tiles.js`) прежним кодом; файлы пакета — в прежнем порядке плиток. */
    const KINDS = ["fog", "dx"];
    const engineLook = engine?.executable && game.updatePath && waterEngineEnabled() ? waterFogEngineLook(looks, lakes) : null;
    let fromEngine = null;
    if (engineLook) {
      const engineFrom = Date.now();
      fromEngine = await buildWaterTilesOnEngine({
        executable: engine.executable,
        gameRoot: game.gameRoot || path.dirname(path.dirname(game.updatePath)),
        keysDirectory: game.keysDirectory || "",
        archive: game.updatePath,
        look: engineLook,
        jobs: tiles.flatMap(({ grid, index }) => {
          const entries = waterFogTileEntries(grid, index);
          const rect = waterFogTileRect(grid, index);
          return [entries.full, entries.dx].map((entry) => ({ name: entry.split("/").pop(), entry, rect }));
        }),
        threads: engine.threads,
        onSpawn: engine.onSpawn,
        onProgress: (progress) => onProgress?.({ step: "water-tiles", done: Math.floor(progress.done / KINDS.length), total: tiles.length }),
        onTimings: (stages) => {
          report.engineTimings = stages;
        },
      }).catch((error) => {
        report.engineError = String(error?.message || error).slice(0, 200);
        return null;
      });
      report.engineMs = Date.now() - engineFrom;
    }
    if (fromEngine) report.engineTiles = 0;
    let done = 0;
    const results = await mapLimit(tiles, 8, async ({ grid, index }, order) => {
      const rect = waterFogTileRect(grid, index);
      const entries = waterFogTileEntries(grid, index);
      const out = [];
      for (const [kind, entry] of [
        ["fog", entries.full],
        ["dx", entries.dx],
      ]) {
        const name = entry.split("/").pop();
        /* Готовое от движка: собранная плитка или «не меняется». Остальное (нет записи, отказ) — прежним путём. */
        const taken = fromEngine?.[order * KINDS.length + KINDS.indexOf(kind)];
        if (taken?.status === "built" || taken?.status === "unchanged") {
          report.engineTiles += 1;
          out.push(taken.status === "built" ? { kind, name, bytes: taken.bytes } : { kind, unchanged: true });
          continue;
        }
        const bytes = await game.update(entry);
        if (!bytes) {
          out.push({ kind, missing: true });
          continue;
        }
        const patched = await pool.run("water-fog-tile", { bytes, name, rect, project, lakes });
        out.push(patched ? { kind, name, bytes: Buffer.from(patched.buffer, patched.byteOffset, patched.byteLength) } : { kind, unchanged: true });
      }
      done += 1;
      if (done % 8 === 0) onProgress?.({ step: "water-tiles", done, total: tiles.length });
      return out;
    });
    for (const item of results.flat()) {
      if (item.missing) report.missingTiles += 1;
      else if (item.unchanged) report.unchangedTiles += 1;
      else {
        files.push({ kind: item.kind, name: item.name, bytes: item.bytes });
        report[item.kind === "fog" ? "tiles" : "dxTiles"] += 1;
      }
    }
  }

  /* Реки — облик «Озёра и реки». */
  if (looks.inland.tint) {
    const rivers = await mapLimit(WATER_INVENTORY.rivers, 8, async (river) => {
      const bytes = await game.river(river.at);
      if (!bytes) return { river, missing: true };
      const patched = await pool.run("water-river", { bytes, river, project });
      return { river, patched };
    });
    for (const { river, missing, patched } of rivers) {
      if (missing) {
        report.missingRivers.push(river.name);
        continue;
      }
      if (patched) {
        files.push({ kind: "river", name: river.name, bytes: Buffer.from(patched.buffer, patched.byteOffset, patched.byteLength) });
        report.rivers += 1;
      }
    }
  }

  /* Под водой — подводные модификаторы таймцикла слоем объединения и
     подводная дымка копией поверх. */
  const under = waterUnderLook(project);
  report.underwater = under.vanilla ? "game" : "missing";
  report.underwaterRegions = 0;
  report.mist = false;
  if (!under.vanilla) {
    const base = (await game.update(WATER_UNDERWATER_ENTRY)) || (await game.common(UNDERWATER_COMMON));
    const layer = base ? underwaterTimecycleLayer(base.toString("utf8"), under) : null;
    if (layer) {
      files.push({ kind: "timecycle", name: "timecycle_mods_1.xml", names: layer.names, bytes: Buffer.from(layer.xml, "utf8") });
      report.underwater = "changed";
      report.underwaterRegions = layer.names.length - WATER_UNDERWATER_MODIFIERS.length;
    }
    const mistBase = (await game.update(WATER_UNDERWATER_MIST_ENTRY)) || (await game.common(MIST_COMMON));
    const mist = mistBase ? waterUnderwaterMist(mistBase.toString("utf8"), under) : null;
    if (mist?.changed) {
      files.push({ kind: "mist", name: "underwater_render_mist.xml", bytes: Buffer.from(mist.xml, "utf8") });
      report.mist = true;
    }
  }
  return { files, report };
}

/*
 * Слой «под водой»: из файла таймцикла игрока — только подводные
 * модификаторы (`WATER_UNDERWATER_LAYER`: три общих обязательны, местные —
 * какие есть), пересчитанные под облик (`look` — `waterUnderLook`).
 * Возвращает `{ xml, names }` — документ и имена договора в его порядке
 * (для манифеста). Нет хоть одного общего — `null`: слой без них движок не
 * примет, а наполовину пересчитанная вода хуже штатной.
 */
export function underwaterTimecycleLayer(xml, look) {
  const parsed = parseTimecycleModifierXml(xml);
  const modifiers = [];
  const names = [];
  for (const name of WATER_UNDERWATER_LAYER) {
    const required = WATER_UNDERWATER_MODIFIERS.includes(name);
    const modifier = parsed.modifiers.findLast((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!modifier) {
      if (required) return null;
      continue;
    }
    const fields = modifier.fields.map((field) => {
      const [first, second = first] = field.text.trim().split(/\s+/).map(Number);
      return [field.name, first, second];
    });
    if (fields.some(([, first, second]) => !Number.isFinite(first) || !Number.isFinite(second))) {
      if (required) return null;
      continue;
    }
    const changed = waterUnderwaterModifier(fields, look);
    modifiers.push({
      ...modifier,
      fields: modifier.fields.map((field, index) => ({ ...field, text: `${changed[index][1].toFixed(3)} ${changed[index][2].toFixed(3)}` })),
    });
    names.push(name);
  }
  return { xml: serializeTimecycleModifierXml({ rootAttributes: parsed.rootAttributes, modifiers }), names };
}

/** Документ слоя «под водой» (как `underwaterTimecycleLayer`) или `null`. */
export function underwaterTimecycleDocument(xml, look) {
  return underwaterTimecycleLayer(xml, look)?.xml ?? null;
}

const SUBFOLDER = Object.freeze({ fog: "fog", dx: "fog-dx", river: "rivers", xml: "", timecycle: "", mist: "weather" });

/**
 * Пакет воды под работу: `{ setId, manifest, packageRoot, project, summary }`.
 * Всё как у Rockstar — отказ: ставить нечего, снимается «Откатить».
 */
export async function buildWaterPackage(input, stateDir, { game, onProgress = null, engine = null } = {}) {
  const project = normalizeWaterProject(input);
  if (waterProjectIsVanilla(project)) throw new Error("Вода как в игре — ставить нечего: снимите свою воду «Откатить».");
  const { files, report } = await buildWaterFiles(project, game, { onProgress, engine });
  if (!files.length) throw new Error("Правка воды не меняет ни одного файла игры — ставить нечего.");
  const described = files.map((file) => ({
    kind: file.kind,
    name: file.name,
    size: file.bytes.length,
    sha256: sha256(file.bytes),
    ...(file.names ? { names: file.names } : {}),
  }));
  const manifest = buildWaterManifest(described);
  if (!isLocalWaterManifest(manifest, "Legacy")) throw new Error("Собранная вода не прошла строгую проверку доверия.");
  const packageRoot = path.join(stateDir || os.tmpdir(), "recolor", "water", "packages", manifest.water.sourceDigest.slice(7, 23));
  /* Разом и без переименования свежих файлов (`package-files.js`). */
  await writePackageFiles(
    files.map((file, index) => ({ target: path.join(packageRoot, "payload", SUBFOLDER[file.kind], file.name), bytes: file.bytes, sha256: described[index].sha256 })),
  );
  await pruneOldPackages(path.dirname(packageRoot), packageRoot);
  const looks = compileWaterLooks(project);
  return {
    setId: "water",
    manifest,
    packageRoot,
    project,
    summary: {
      base: game.source,
      sea: { tint: looks.sea.tint, transparency: looks.sea.transparency },
      inland: { tint: looks.inland.tint, transparency: looks.inland.transparency },
      tiles: report.tiles,
      dxTiles: report.dxTiles,
      rivers: report.rivers,
      quads: report.quads,
      underwater: report.underwater,
      underwaterRegions: report.underwaterRegions,
      mist: report.mist,
      missingRivers: report.missingRivers.slice(0, 8),
      changed: files.length,
    },
  };
}

async function pruneOldPackages(directory, current) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{16}$/.test(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (full === current) continue;
    const stat = await fs.stat(full).catch(() => null);
    if (stat) packages.push({ full, time: stat.mtimeMs });
  }
  packages.sort((a, b) => b.time - a.time);
  for (const stale of packages.slice(KEEP_PACKAGES - 1)) await fs.rm(stale.full, { recursive: true, force: true }).catch(() => {});
}
