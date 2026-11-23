/*
 * Набор тату каталога с выбором (круг 7, 30.10.2026; владелец о «Blackwork»: «они накладываются полностью на тело … человек ставил какую-то татуировку, грубо говоря, на спину, у него забивалась рука или
 * корпус, ставил на ногу какую-то дешёвую татуировку — у него забивалась нога … сделать просто как пак, чтобы человек, когда установил, как и в мастерской, … ему предлагалось, на какие татуировки он хочет
 * каждое поставить»).
 *
 * Как устроен такой набор. Автор кладёт в архив картинки `.ytd` под именами штатных тату игры (`mp_hip_tat_036.ytd`): игра берёт картинку по имени, и каждое из этих тату, где бы оно ни стояло, рисуется
 * чужой картинкой. У «Blackwork» их семь — по живот слева, по руке, по две ноги: тату салона, чьи рамки совпали с рукой или ногой, у человека закрашиваются целиком, даже если он купил их ради рисунка. Прямой
 * установкой выбрать нечего: имена зашиты в файлы.
 *
 * Здесь выбор: окно называет, какая часть набора (файл) на какое тату игры ляжет — по умолчанию на то, чьё имя у неё в архиве, но можно на любое тату той же части тела, а часть можно не ставить совсем. Картинка
 * части печётся в исходный `.ytd` выбранного тату (формат, mip и имя текстуры внутри — игры, а не автора) и ставится тем же пакетом `local-tattoo-paint-*`, что покраска из мастерской (`tattoo-paint.js`): слот
 * `tattoo-<txd>` общий с прямой установкой набора, так что новая установка сменяет прежнюю — выбор один.
 *
 * Только это: рамка выбранного тату не меняется, картинка части растягивается на неё. Поэтому у набора сохранена зона: часть для руки не предлагается на ногу.
 */

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { colourPicture } from "@modovik/clothing/model";
import { TATTOO_PAINT_LIMIT, tattooPaintTxd } from "@modovik/install-engine";
import { inflateRawNode } from "@modovik/rpf7/node";
import { clothingArchiveTools, clothingGameRoot } from "./clothing-models.js";
import { defaultTools, installTattooPaintBuilt, writeTattooPaintPackage } from "./tattoo-paint.js";

const refusal = (code, message) => Object.assign(new Error(message), { code });

/* Картинка тату — до 1024 по стороне: крупнее у игры не бывает (как в `tattoo-paint.js`). */
const MAX_SIDE = 1024;
const MOD_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/i;
const FILE = /^[a-z0-9][a-z0-9_.-]{0,80}\.ytd$/i;
const baseName = (source) => path.basename(String(source || "")).toLowerCase();

/** Проверяет запрос окна: манифест набора, выбор «часть → тату игры», папка игры. */
export function normalizeTattooSetRequest(input) {
  const manifest = input?.manifest;
  const id = String(manifest?.id || "");
  if (!MOD_ID.test(id) || !String(manifest?.version || "") || !Array.isArray(manifest?.files))
    throw refusal("TATTOO_SET_PACKAGE", "У набора тату каталога нет пакета.");
  const inPackage = new Set(manifest.files.filter((file) => file?.source && file.action !== "delete").map((file) => baseName(file.source)));
  const picks = Array.isArray(input?.picks) ? input.picks : [];
  if (!picks.length) throw refusal("TATTOO_SET_PICKS", "Не выбрано, какие части набора куда ставить.");
  if (picks.length > TATTOO_PAINT_LIMIT) throw refusal("TATTOO_SET_PICKS", `За раз — не больше ${TATTOO_PAINT_LIMIT} тату.`);
  const files = new Set();
  const targets = new Set();
  const clean = picks.map((pick) => {
    const file = String(pick?.file || "").toLowerCase();
    const target = String(pick?.target || "").toLowerCase();
    if (!FILE.test(file) || !inPackage.has(file)) throw refusal("TATTOO_SET_PICKS", "Такой части в наборе нет — список устарел, откройте набор заново.");
    if (!target) throw refusal("TATTOO_SET_PICKS", "Для части набора не выбрано тату.");
    if (files.has(file)) throw refusal("TATTOO_SET_PICKS", "Одна часть набора выбрана дважды.");
    if (targets.has(target)) throw refusal("TATTOO_SET_PICKS", "Одно и то же тату выбрано для двух частей: оно может нести только одну.");
    files.add(file);
    targets.add(target);
    return { file, target };
  });
  return {
    manifest,
    baseUrl: String(input?.baseUrl || ""),
    picks: clean,
    name: String(input?.name || manifest.id).slice(0, 80),
    gameRoot: clothingGameRoot(input),
    targetId: String(input?.targetId || "default"),
    gender: input?.gender === "female" ? "female" : "male",
  };
}

/**
 * Собирает пакет: картинка каждой выбранной части — в исходный `.ytd` выбранного тату. `deps.tools` подменяет чтение игры, запекание, скачивание пакета и чтение картинки части (тесты);
 * `deps.publicKey`, `allowedHosts`, `downloadsDir` — как у скачивания вещи каталога.
 */
export async function buildTattooSet(input, stateDir, deps = {}) {
  const request = normalizeTattooSetRequest(input);
  const tools = { ...defaultTools, ...(deps.tools || {}) };
  const index = await tools.index({ gameRoot: request.gameRoot, stateDir, keysDirectory: deps.keysDirectory || null });
  const byKey = new Map((index.tattoos || []).map((tattoo) => [String(tattoo.key).toLowerCase(), tattoo]));
  const targets = request.picks.map((pick) => {
    const tattoo = byKey.get(pick.target);
    if (!tattoo) throw refusal("TATTOO_SET_TARGET", "Такого тату в игре нет — список устарел, откройте набор заново.");
    if (!tattooPaintTxd(tattoo.txd)) throw refusal("TATTOO_SET_TARGET", `У тату «${tattoo.title}» неподходящее имя картинки.`);
    if (tattoo.gender && tattoo.gender !== request.gender)
      throw refusal("TATTOO_SET_GENDER", request.gender === "female" ? `Тату «${tattoo.title}» мужское: набор для женского тела ставится на женские тату.` : `Тату «${tattoo.title}» женское: набор для мужского тела ставится на мужские тату.`);
    return tattoo;
  });
  /* Качаются только выбранные части: набор — сотни килобайт, но чужое ставить не нужно. */
  const wanted = new Set(request.picks.map((pick) => pick.file));
  const download = tools.download || clothingArchiveTools(stateDir).download;
  const downloaded = await download({
    manifest: request.manifest,
    baseUrl: request.baseUrl,
    only: (file) => wanted.has(baseName(file.source)),
    publicKey: deps.publicKey,
    stateDir,
    downloadsDir: deps.downloadsDir || null,
    allowInsecureLocalhost: Boolean(deps.allowInsecureLocalhost),
    allowedHosts: deps.allowedHosts ?? null,
    onProgress: deps.onProgress || null,
  });
  const root = path.resolve(downloaded.packageRoot);
  const sources = new Map((downloaded.manifest?.files || request.manifest.files).filter((file) => file?.source).map((file) => [baseName(file.source), file.source]));
  const decode = tools.partPicture || ((bytes) => colourPicture(bytes, { inflateRaw: inflateRawNode, maxSize: MAX_SIDE }));
  const files = [];
  const baked = [];
  const skipped = [];
  for (const [at, pick] of request.picks.entries()) {
    const tattoo = targets[at];
    const absolute = path.resolve(root, sources.get(pick.file) || "");
    if (!absolute.startsWith(root + path.sep)) throw refusal("TATTOO_SET_PACKAGE", "Файл набора вне пакета.");
    let part;
    try {
      part = decode(await fs.readFile(absolute));
    } catch {
      part = null;
    }
    if (!part?.rgba?.length) {
      skipped.push({ texture: tattoo.title, reason: `часть «${pick.file}» не читается` });
      continue;
    }
    const original = await tools.ytd({ gameRoot: request.gameRoot, keysDirectory: deps.keysDirectory || null, tattoo });
    const picture = tools.picture(original, tattoo.texture);
    const width = Math.min(MAX_SIDE, picture.full.width);
    const height = Math.min(MAX_SIDE, picture.full.height);
    const png = await sharp(Buffer.from(part.rgba.buffer, part.rgba.byteOffset, part.rgba.byteLength), { raw: { width: part.width, height: part.height, channels: 4 } })
      .resize(width, height, { fit: "fill" })
      .png()
      .toBuffer();
    const txd = tattooPaintTxd(tattoo.txd);
    /* Альфа тату — сам рисунок: часть несёт свою, а не прежнюю. */
    const result = await tools.paint([{ name: `${txd}.ytd`, bytes: original }], [{ texture: picture.name, png, opaque: false }]);
    if (!result.baked?.length) {
      skipped.push({ texture: tattoo.title, reason: result.skipped?.[0]?.reason || "картинку тату не перезаписать" });
      continue;
    }
    files.push({ txd, bytes: Buffer.from(result.files[0].bytes), title: tattoo.title });
    baked.push(tattoo.title);
  }
  if (!files.length)
    throw refusal("TATTOO_SET_NOTHING", skipped.length ? `Ни одна часть не легла: ${skipped.map((entry) => `${entry.texture} — ${entry.reason}`).join("; ")}.` : "Ни одна часть не легла.");
  const written = await writeTattooPaintPackage({ files, name: request.name, stateDir });
  return { ...written, gameRoot: path.resolve(request.gameRoot), targetId: request.targetId, baked, skipped, kept: [], moved: [] };
}

/** Ставит набор: пакет покраски, как у рисунка с тела (`installTattooPaintBuilt`). Прежний набор на тех же тату сменяется — слот общий. */
export async function applyTattooSet(input, stateDir, deps = {}) {
  return installTattooPaintBuilt(await buildTattooSet(input, stateDir, deps), stateDir, deps);
}
