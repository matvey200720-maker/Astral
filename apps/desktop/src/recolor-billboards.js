/*
 * «Билборды» в файлах (задача 4 ТЗ 10.10.2026, вечер).
 *
 * Основа — штатные файлы игры игрока (опись `billboards`): листы рекламы
 * лежат в моделях районов (`dt1_20_ground2.ydr`) и словарях районов
 * (`dt1_16_build.ytd`), у листа — копия высокой чёткости (`+hidr.ytd`,
 * `+hi.ytd`), вдали щит рисуют листы дальних моделей (`dt1_09_lod.ytd`,
 * атласы SLOD). Все они едут с правкой: щит один и тот же вблизи, в
 * полный рост и издалека.
 *
 *   • облик щита — картинка на месте щита на листе (своя, ровный цвет или
 *     градиент — `billboardPicture`, тем же расчётом, что у кадра окна) или
 *     яркость рекламы игры, и поверх — рисунок (его картинку присылает
 *     окно, ключ — `billboardDrawingKey`); тексели вне места щита остаются байт в байт
 *     (`texturePayload` с оригиналом — пережимаются только тронутые блоки);
 *   • свечение ночью — множитель `emissiveMultiplier` шейдера щита в его
 *     модели (`.ydr`): штатный × свечение облика;
 *   • щиты разных моделей на одном месте листа словаря района (казино
 *     Diamond, щиты у трассы 68…) — по одному: модели со своим обликом
 *     достаётся своя копия словаря (`astral_bb_<архетип>.ytd`) с её
 *     картинкой, а в типах района её архетип смотрит на копию
 *     (`patchTypesForPlace`). Остальные модели берут словарь игры как был.
 *
 * Чего правка не трогает: остальные листы и модели районов едут как в игре
 * (файл целиком нужен игре, но меняются в нём только листы щитов).
 *
 * Листы файлов красит пул тяжёлой работы (`recolor-billboards-paint.js`):
 * одна картинка на все щиты — это сотни файлов районов, и окно не должно
 * ждать их сборки.
 */

import { mapLimit } from "@modovik/install-engine/map-limit.js";
import { patchDrawable } from "@modovik/ypt/drawable";
import {
  BILLBOARD_GLOW,
  BILLBOARD_LIST,
  billboard,
  billboardCopyName,
  billboardDrawingKey,
  billboardGlowMultiplier,
  billboardLookOf,
  billboardLookPaints,
  billboardPaintKey,
  billboardSheet,
  changedBillboards,
  normalizeBillboardsProject,
} from "@modovik/climb-contract/recolor/billboards";
import { billboardsEngineEnabled, billboardsEngineThreads, buildBillboardsOnEngine } from "./billboards-engine-build.js";
import { heavyWork } from "./heavy-work.js";
import { engineLocationDefaults, nativeContextDefaultsOf } from "./native-engine.js";
import { resolveRustExecutable } from "./native-engine-rust.js";
import { joaatName, patchTypesForPlace } from "./place-isolation.js";
import { buildBillboardLive } from "./recolor-billboard-live.js";
import { paintBillboardFile } from "./recolor-billboards-paint.js";

/* Предел одного файла пакета мест (размер записи RPF — 24 бита). */
const FILE_LIMIT = 16 * 1024 * 1024 - 1;
/* Файлов в работе разом: потоков пула не больше четырёх, пятый файл читается с диска, пока они считают. */
const FILE_JOBS = 5;

/*
 * Своя картинка — общей памятью: потоки пула читают её без копии на каждый
 * файл (картинка до 2048 px — 16 МБ, файлов — сотни).
 */
function shareImage({ rgba, width, height }) {
  if (typeof SharedArrayBuffer !== "function") return { rgba, width, height };
  const view = new Uint8ClampedArray(new SharedArrayBuffer(rgba.byteLength));
  view.set(rgba);
  return { rgba: view, width, height };
}

const push = (map, key, value) => {
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
};
const overlaps = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1e-4 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1e-4;

/*
 * Копии словарей: на листе словаря района лица разных моделей с разным
 * обликом на одном месте. Словарь игры остаётся за обликом моделей, которых
 * развести нельзя (у них нет `split`), иначе — за «как в игре», иначе — за
 * первой моделью; каждая модель с другим обликом получает свою копию.
 * Ответ — `Map` архетип → `{ name, file, at, ytyp }` (файл — словарь игры).
 */
function dictionaryCopies(project) {
  const byFile = new Map();
  for (const board of BILLBOARD_LIST) {
    const key = billboardPaintKey(billboardLookOf(project, board.id));
    for (const entry of board.faces) {
      const sheet = billboardSheet(entry.sheet);
      if (!sheet || sheet.big || !/\.ytd$/.test(sheet.file)) continue;
      push(byFile, sheet.file, { board, entry, key, sheet });
    }
  }
  const copies = new Map();
  for (const [file, items] of byFile) {
    /* Конфликт — одно место листа, разные модели, разный облик. */
    const conflicting = new Set();
    for (let a = 0; a < items.length; a += 1)
      for (let b = a + 1; b < items.length; b += 1) {
        const [one, two] = [items[a], items[b]];
        if (one.entry.sheet !== two.entry.sheet || one.entry.arch === two.entry.arch || one.key === two.key || !overlaps(one.entry.clip, two.entry.clip)) continue;
        conflicting.add(one.entry.arch);
        conflicting.add(two.entry.arch);
      }
    if (!conflicting.size) continue;
    const archKey = new Map();
    const splittable = new Map();
    for (const item of items) {
      if (!conflicting.has(item.entry.arch)) continue;
      if (!archKey.has(item.entry.arch)) archKey.set(item.entry.arch, item.key);
      if (item.entry.split) splittable.set(item.entry.arch, item.entry.split);
    }
    const fixed = [...archKey.keys()].filter((arch) => !splittable.has(arch));
    const keep = fixed.length ? archKey.get(fixed[0]) : [...archKey.values()].includes("stock") ? "stock" : archKey.get([...archKey.keys()][0]);
    for (const [arch, key] of archKey) {
      if (key === keep || !splittable.has(arch)) continue;
      copies.set(arch, { name: billboardCopyName(arch), file, at: items.find((item) => item.entry.arch === arch).sheet.at, ytyp: splittable.get(arch) });
    }
  }
  return copies;
}

/**
 * Что куда ложится: файлы игры с листами щитов работы и свои копии
 * словарей. `{ files: [{ file, at, sheets: [{ sheet, width, height, items:
 * [{ board, look, entry }] }] }], types: Map(адрес типов → Map(архетип →
 * хеш копии)) }` — копии высокой чёткости — отдельными файлами с теми же
 * местами.
 */
export function billboardPlan(input) {
  const project = normalizeBillboardsProject(input);
  const copies = dictionaryCopies(project);
  const bySheet = new Map();
  const byCopy = new Map();
  for (const id of changedBillboards(project)) {
    const board = billboard(id);
    const look = billboardLookOf(project, id);
    /* Только свечение (реклама игры той же яркости) — листы не меняются, едет одна модель. */
    if (!billboardLookPaints(look)) continue;
    for (const entry of [...board.faces, ...board.far]) {
      const copy = entry.arch !== undefined && board.faces.includes(entry) ? copies.get(entry.arch) : null;
      if (copy && billboardSheet(entry.sheet)?.file === copy.file) push(byCopy, copy.name, { sheet: entry.sheet, item: { board, look, entry } });
      else push(bySheet, entry.sheet, { board, look, entry });
    }
  }
  const files = new Map();
  const add = (file, at, sheet, width, height, items) => {
    if (!files.has(file)) files.set(file, { file, at, sheets: [] });
    files.get(file).sheets.push({ sheet, width, height, items });
  };
  for (const [sheetId, items] of bySheet) {
    const sheet = billboardSheet(sheetId);
    if (!sheet) continue;
    /* Файл крупнее предела записи пакета (опись помечает его `big`) не едет: щит там остаётся как в игре. */
    if (!sheet.big) add(sheet.file, sheet.at, sheet, sheet.width, sheet.height, items);
    if (sheet.hd && !sheet.hd.big) add(sheet.hd.file, sheet.hd.at, sheet, sheet.hd.width, sheet.hd.height, items);
  }
  /* Своя копия словаря: словарь игры с картинками щитов только этой модели. */
  const types = new Map();
  for (const [arch, copy] of copies) {
    const entries = byCopy.get(copy.name);
    if (!entries?.length) continue;
    const perSheet = new Map();
    for (const { sheet, item } of entries) push(perSheet, sheet, item);
    for (const [sheetId, items] of perSheet) {
      const sheet = billboardSheet(sheetId);
      add(`${copy.name}.ytd`, copy.at, sheet, sheet.width, sheet.height, items);
    }
    if (!types.has(copy.ytyp)) types.set(copy.ytyp, new Map());
    types.get(copy.ytyp).set(arch >>> 0, joaatName(copy.name));
  }
  return { files: [...files.values()].sort((a, b) => (a.file < b.file ? -1 : 1)), types };
}

/** Файлы игры и копии словарей с листами щитов работы — `billboardPlan(…).files`. */
export const billboardFilePlan = (input) => billboardPlan(input).files;

/* Свечение: модели и шейдеры щитов, чьё свечение не штатное. `Map` файл → { at, shaders: Map номер → множитель }. */
export function billboardGlowPlan(input) {
  const project = normalizeBillboardsProject(input);
  const out = new Map();
  for (const id of changedBillboards(project)) {
    const look = billboardLookOf(project, id);
    if (look.glow === BILLBOARD_GLOW.standard) continue;
    for (const item of billboard(id).glowShaders || []) {
      if (!out.has(item.file)) out.set(item.file, { at: item.at, shaders: new Map() });
      out.get(item.file).shaders.set(item.shader, billboardGlowMultiplier(item.multiplier, look));
    }
  }
  return out;
}

/* Где игра и ключи у читателя (`game.root`, `game.keysDirectory`: их кладёт поток сборки, `recolor-build-host-worker.js`) и где движок. `game.engineHooks` — как снять работу: номер процесса и рабочая папка движка. */
function engineOf(game) {
  if (!game?.root) return null;
  /* `ASTRAL_BILLBOARDS_ENGINE_EXE` — свой движок разработчика (стенды замера, пока готовый ещё без команды `billboards-build`). */
  const executable = process.env.ASTRAL_BILLBOARDS_ENGINE_EXE || resolveRustExecutable({ ...engineLocationDefaults(), ...(nativeContextDefaultsOf() || {}) });
  return executable ? { executable, gameRoot: game.root, keysDirectory: game.keysDirectory || "", onSpawn: game.engineHooks?.onSpawn, scratch: game.engineHooks?.scratch } : null;
}

/**
 * Файлы щитов под работу: `{ files: [{ name, bytes }], patches, report }`.
 * `game` — читатель игры игрока, `images` — свои картинки (`Map` ключ →
 * `{ rgba, width, height }`), `pool` — пул тяжёлой работы (`null` — считать
 * здесь же), `compile` и `stateDir` — нативный хост и рабочая папка живых
 * плашек гифок (`recolor-billboard-live.js`). `engine` — движок сборки (`billboards-engine-build.js`, `ASTRAL_BILLBOARDS_ENGINE=1`): `{ executable, gameRoot,
 * keysDirectory, onSpawn?, scratch? }`; не задан — по переменной окружения и по месту игры у читателя (`game.root`), `null` — без движка (тесты).
 */
export async function buildBillboardFiles(input, { game = null, images = new Map(), pool = heavyWork, compile = null, stateDir = "", engine = undefined } = {}) {
  const project = normalizeBillboardsProject(input);
  const changed = changedBillboards(project);
  if (!changed.length) return { files: [], patches: [], report: { stock: true } };
  if (!game) throw new Error("Щиты собираются из файлов вашей игры — подключите GTA V.");
  for (const id of changed) {
    const look = billboardLookOf(project, id);
    if (look.mode === "image" && look.image.asset && !images.get(look.image.asset)) throw new Error("Своя картинка щита не пришла — выберите её ещё раз.");
    const drawing = billboardDrawingKey(look.drawing);
    if (drawing && !images.get(drawing)) throw new Error("Рисунок на щите не пришёл — откройте редактор билбордов и нажмите «Применить» ещё раз.");
  }
  const shared = new Map([...images].map(([key, image]) => [key, shareImage(image)]));

  const files = new Map();
  const patches = [];
  const report = { boards: changed.length, sheets: 0, files: 0, glow: 0, copies: 0, missing: [], oversize: [] };
  const plan = billboardPlan(project);
  /* Листы файла — в пуле потоков: файл игры, облик работы и только его свои картинки. */
  const paintViaJs = async (item) => {
    const base = await game.read(item.at).catch(() => null);
    if (!base) return { missing: [item.file] };
    const assets = new Set(item.sheets.flatMap(({ items }) => items.flatMap(({ look }) => [look.mode === "image" ? look.image.asset : "", billboardDrawingKey(look.drawing)]).filter(Boolean)));
    const payload = {
      bytes: base,
      file: item.file,
      project,
      sheets: item.sheets.map(({ sheet, items }) => ({ sheet: sheet.id, items: items.map(({ board, entry }) => ({ board: board.id, entry })) })),
      images: Object.fromEntries([...assets].filter((asset) => shared.has(asset)).map((asset) => [asset, shared.get(asset)])),
    };
    /* Байты файла — копией, не передачей: упади поток посреди файла, пул досчитает его здесь же из тех же байтов. */
    return pool ? pool.run("billboard-file", payload) : paintBillboardFile(payload);
  };
  /* Движок (`billboards-engine-build.js`): файлы щитов собирает он, потоки JS — запасной путь для всего, что он не взял или в чём отказал. */
  const engineRun = engine !== undefined ? engine : billboardsEngineEnabled() ? engineOf(game) : null;
  let onEngine = null;
  if (engineRun?.executable && engineRun.gameRoot) {
    try {
      onEngine = await buildBillboardsOnEngine({
        executable: engineRun.executable,
        gameRoot: engineRun.gameRoot,
        keysDirectory: engineRun.keysDirectory || "",
        project,
        plan,
        images,
        threads: billboardsEngineThreads(),
        onSpawn: engineRun.onSpawn,
        scratch: engineRun.scratch,
        onTimings: (timings) => {
          report.engineTimings = timings;
        },
      });
      if (!onEngine) report.engine = "работу движок не берёт (рисунок поверх щита или гифка): сборка потоками JS";
    } catch (error) {
      /* Отказ движка — не отказ сборки: прежний путь на месте. */
      report.engine = `движок отказал: ${String(error?.message || error)}`;
      onEngine = null;
    }
  }
  const painted = await mapLimit(plan.files, FILE_JOBS, async (item, index) => {
    const row = onEngine?.[index];
    if (!row || row.status === "fallback") return paintViaJs(item);
    if (row.status === "missing") return { missing: [item.file] };
    const missing = (row.missing || []).map((name) => `${item.file}: ${name}`);
    if (row.status === "unchanged") return { bytes: null, textures: [], sheets: 0, missing };
    return { bytes: row.bytes, textures: row.textures, sheets: row.sheets, missing };
  });
  if (onEngine) {
    const states = onEngine.map((row) => row.status);
    report.engine = { built: states.filter((state) => state === "built").length, fallback: states.filter((state) => state === "fallback").length, files: onEngine.length };
  }
  plan.files.forEach((item, index) => {
    const done = painted[index];
    report.missing.push(...(done.missing || []));
    report.sheets += done.sheets || 0;
    if (!done.bytes) return;
    /* Пережатый файл вырос за предел записи пакета — он не едет, щит в нём остаётся как в игре. */
    if (done.bytes.length > FILE_LIMIT) {
      report.oversize.push(item.file);
      return;
    }
    files.set(item.file, { name: item.file, bytes: Buffer.from(done.bytes.buffer, done.bytes.byteOffset, done.bytes.byteLength) });
    if (/^astral_bb_/.test(item.file)) report.copies += 1;
    patches.push({ file: item.file, textures: done.textures, boards: [...new Set(item.sheets.flatMap((sheet) => sheet.items.map((entry) => entry.board.id)))] });
  });

  /* Типы районов: архетипам щитов со своей копией — ссылка на копию. Копия не собралась — ссылки нет. */
  for (const [address, rebind] of plan.types) {
    for (const [arch, copy] of rebind) if (![...files.keys()].some((name) => joaatName(name.replace(/\.ytd$/, "")) === copy)) rebind.delete(arch);
    if (!rebind.size) continue;
    const bytes = await game.read(address).catch(() => null);
    const name = address.split("/").pop();
    if (!bytes) {
      report.missing.push(name);
      continue;
    }
    const patched = patchTypesForPlace(new Uint8Array(bytes), { rebind });
    if (!patched.bytes) {
      report.missing.push(`${name}: архетипов щитов нет`);
      continue;
    }
    files.set(name, { name, bytes: patched.bytes });
    patches.push({ file: name, rebind: patched.patched });
  }

  /* Свечение ночью — поверх уже правленых листов той же модели. */
  for (const [file, { at, shaders }] of billboardGlowPlan(project)) {
    const base = files.get(file)?.bytes || (await game.read(at).catch(() => null));
    if (!base) {
      report.missing.push(file);
      continue;
    }
    let bytes = base;
    /* Свой множитель у шейдера: правка по одному номеру. */
    for (const [shader, value] of shaders) bytes = patchDrawable(bytes, { vectors: { emissiveMultiplier: [value] }, shaders: [shader] }).bytes;
    files.set(file, { name: file, bytes });
    patches.push({ file, glow: [...shaders.keys()] });
    report.glow += shaders.size;
  }
  /* Гифки: живым щитам — плашка перед полотном (на листе у них первый кадр), клип и модель собирает нативный хост. */
  const live = await buildBillboardLive(project, { images, compile, stateDir });
  for (const file of live.files) files.set(file.name, { name: file.name, bytes: file.bytes });
  if (live.files.length) patches.push({ file: "models", live: live.report.live, boards: live.report.boards });
  report.live = live.report.live;
  report.liveBytes = live.report.bytes;
  report.liveClips = live.report.clips || [];
  report.files = files.size;
  return { files: [...files.values()], patches, report };
}
