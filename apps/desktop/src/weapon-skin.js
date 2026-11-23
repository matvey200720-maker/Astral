import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  MODEL_XRAY_GLOW,
  normalizeMaterialTint,
  normalizeModelMaterial,
  normalizeModelOpacity,
  normalizeModelScale,
  readDrawable,
} from "@modovik/rage-drawable";
import {
  composeTintPalette,
  gameWeaponFiles,
} from "@modovik/gunpack/game-weapon";
import { clearPaintedInscriptions, paintedInscriptionsOf } from "@modovik/gunpack/inscriptions";
import { WEAPON_OUTLINE_VERSION } from "@modovik/gunpack/weapon-outline";
import {
  WEAPON_SKIN_CAPABILITIES,
  WEAPON_SKIN_MASK_CAPABILITIES,
  WEAPON_SKIN_DLC_TARGET,
  WEAPON_SKIN_MODEL,
  canonicalManifest,
  conflictsReplacedWhole,
  engineInstallEnabled,
  installLocalWeaponSkinPackage,
  planPackage,
  sha256File,
  uninstallPackage,
  weaponSkinEntries,
  weaponSkinMaskEntries,
  weaponSkinSourceDigest,
} from "@modovik/install-engine";
import { weaponByModel } from "@modovik/rpf-inspector/weapon-identity";
import { appWeaponUpdateRoute } from "./weapon-update-install.js";
import {
  componentFiles,
  defaultAttachments,
  modelAttachments,
  normalizeAttachments,
  resolveAttachments,
  weaponAttachPoints,
  weaponHomePack,
} from "@modovik/rpf-inspector/weapon-attachments";
import { embeddedAttachments, replacementBody } from "./weapon-attachments.js";
import { attachLooks, looksSignature } from "./attachment-looks.js";
import { tracerWeaponSource } from "@modovik/tracer-contract";
import { callNativeEngine } from "./native-engine.js";
import { runOffThread } from "./off-thread.js";
import {
  composeRpfArchive,
  extractRpfEntries,
  inspectYtd,
  installRpfPrebuilt,
  patchYtdTextures,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
  searchRpfArchive,
} from "./rpf-composer.js";
import { provisionAstralLayer } from "./astral-layer-provisioner.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";
import { archiveWeaponEntries } from "./weapon-file-index.js";
import { warmBlockedBy } from "./weapon-warm-guard.js";
import { provisionFastWeaponInfrastructure } from "./weapon-dlc-provisioner.js";
import {
  atomicWrite,
  bakeTexture,
  bakeYtd,
  normalizePaintedTextures,
} from "./ytd-bake.js";

import { adjustWeaponModel, normalizeGlowRequest } from "./weapon-glow.js";
import {
  decorateWeaponModel,
  normalizeDecorationImages,
  requestDecorations,
} from "./weapon-decorations.js";
import { inscriptionTextureItems, weaponInscriptionModels } from "./weapon-inscriptions.js";
import { normalizePaintPieces } from "./weapon-paint-pieces.js";
import { buildOwnModelBody, hideMagazineModel, normalizeOwnModelRequest } from "./weapon-own-model.js";

/* Прежнее имя: так запекание называют тесты и заметки. */
export const bakeWeaponTexture = bakeTexture;

/*
 * Скин оружия из мастерской — в игру.
 *
 * Окно присылает покраску развёртками PNG: по одной на материал, с именем
 * текстуры цвета (`W_PI_Revolver`). Здесь она превращается в то, что игра
 * читает:
 *
 *  1. текстуры ствола берутся из игры самого игрока — `w_pi_revolver.ytd` и
 *     `w_pi_revolver+hi.ytd` из самого свежего пакета, где они есть
 *     (обновления «patchday» перекрывают исходный пакет оружия). Своих
 *     текстур Rockstar в Astral нет и не будет;
 *  2. в словаре заменяются только пиксели текстур, которые человек красил, —
 *     тем же размером, форматом и числом mip, что у заводских
 *     (`ytd-texture-patch` иначе откажет, а игра показала бы серый ствол без
 *     единой ошибки);
 *  3. альфа заводской текстуры сохраняется: у оружия в ней не прозрачность, а
 *     маска блеска, и покраска, стёршая её, сделала бы ствол матовым или
 *     зеркальным там, где Rockstar задумали иначе;
 *  4. готовые словари ложатся в подготовленный Astral Weapons DLC строгим
 *     локальным пакетом (`weapon-skin-manifest-trust.js`), слотом ствола;
 *  5. заводские надписи (клеймо, калибр, номер, логотип) — прочь, как в
 *     студии: модели ствола и магазина из игры игрока едут в пакете с
 *     треугольниками надписей, сведёнными в точку (`weapon-inscriptions.js`,
 *     «Надписи оружия», ТЗ 12.10.2026, ночь).
 */

const MOD_ID_PATTERN = /^local-weapon-skin-[a-f0-9]{12}$/;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function refusal(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const defaultTools = () => ({
  search: searchRpfArchive,
  extract: extractRpfEntries,
  inspectYtd,
  patchYtd: patchYtdTextures,
  readTextures: (input, output, context) =>
    callNativeEngine("extract-textures", { input, output }, context),
  readdir: (directory) => fs.readdir(directory, { withFileTypes: true }),
  exists: (file) =>
    fs
      .stat(file)
      .then((info) => info.isFile())
      .catch(() => false),
});

/** Проверяет запрос окна: модель, имена текстур, размеры PNG. */
export function normalizeWeaponSkinRequest(input) {
  const model = String(input?.model || "")
    .trim()
    .toLowerCase();
  if (!WEAPON_SKIN_MODEL.test(model) || !weaponByModel(model))
    throw refusal("WEAPON_SKIN_MODEL", "Этот ствол Astral не знает.");
  const gameRoot = String(input?.gameRoot || "");
  if (!gameRoot || !path.isAbsolute(gameRoot))
    throw refusal("WEAPON_SKIN_GAME", "Выберите папку GTA V Legacy.");
  /* Размер и прозрачность ствола (задача 2 ТЗ 05.10.2026) — в самой модели;
     с ними в игру едет и некрашеный ствол. */
  const scale = normalizeModelScale(input?.scale);
  const opacity = normalizeModelOpacity(input?.opacity);
  /* Материал ствола (задача 1 ТЗ 06.10.2026): стекло или рентген — шейдером
     игры в модели; цвет материала и сила свечения рентгена. */
  const material = normalizeModelMaterial(input?.material);
  const tint = normalizeMaterialTint(material, input?.tint);
  const glowNumber = Number(input?.materialGlow);
  const materialGlow = Number.isFinite(glowNumber)
    ? Math.min(MODEL_XRAY_GLOW.max, Math.max(MODEL_XRAY_GLOW.min, glowNumber))
    : MODEL_XRAY_GLOW.standard;
  /* Украшения на модели (задача 13 ТЗ 10.10.2026): с ними тоже едет и
     некрашеный ствол. Картинки логотипов — PNG от окна. */
  const rawDecorations = Array.isArray(input?.decorations) ? input.decorations : [];
  const decorationImages = normalizeDecorationImages(input?.decorationImages, rawDecorations);
  const decorations = requestDecorations(rawDecorations, decorationImages);
  /* Своя модель ствола из .glb (задача 6 ТЗ 17.10.2026): встаёт в модель
     этого ствола вместо его геометрий. */
  const ownModel = normalizeOwnModelRequest(input?.ownModel);
  /* Обвесы на стволе (задача 6 ТЗ 17.10.2026, вторая половина): кость →
     обвес, только этого ствола; с ними тоже едет и некрашеный ствол. */
  const attachments = normalizeAttachments(weaponByModel(model).id, input?.attachments);
  const textures = normalizePaintedTextures(input?.textures, "WEAPON_SKIN", {
    allowEmpty:
      scale !== 1 ||
      opacity < 1 ||
      material !== "standard" ||
      decorations.length > 0 ||
      Boolean(ownModel) ||
      Object.keys(attachments).length > 0,
  });
  return {
    model,
    gameRoot: path.resolve(gameRoot),
    targetId: String(input?.targetId || "default"),
    name: String(input?.name || "Скин").slice(0, 80),
    textures,
    /* Отделённые куски развёртки (владелец 18.10.2026: мушка красилась
       вместе с целиком) — копиями поверх ствола (`weapon-paint-pieces.js`). */
    paintPieces: normalizePaintPieces(input?.paintPieces, textures),
    /* Детали, которые в игре светятся (Т-59): их шейдер перешивается в
       модели ствола из игры игрока. */
    glow: normalizeGlowRequest(input?.glow, textures),
    scale,
    opacity,
    material,
    tint,
    materialGlow,
    decorations,
    decorationImages,
    ownModel,
    attachments,
    /* «Вид из каталога»: готовые виды обвесов, их собрал `resolveLooks` в этом процессе. */
    ...(input?.looks ? { looks: input.looks } : {}),
  };
}

/*
 * Где искать текстуры ствола: сначала самые свежие обновления, потом пакет,
 * с которым ствол пришёл в игру, потом базовый архив. Пакеты Astral не в
 * счёт: там может лежать чужой мод этого ствола, а красить надо заводской.
 */
export async function weaponTextureArchives(gameRoot, model, tools = {}) {
  const { readdir, exists } = { ...defaultTools(), ...tools };
  const dlcRoot = path.join(gameRoot, "update", "x64", "dlcpacks");
  const packs = (await readdir(dlcRoot).catch(() => []))
    .filter((item) => item.isDirectory?.() && !/^astral/i.test(item.name))
    .map((item) => item.name);
  const patchNumber = (name) => {
    const match = /^patchday(\d+)/i.exec(name);
    return match ? Number(match[1]) : -1;
  };
  const weapon = weaponByModel(model);
  /* Пакет ствола: из таблицы трассеров, иначе — из таблицы оружия игры
     (ближний бой, метательное, все MK2 — задача 6 ТЗ 17.10.2026). Обвес
     (`w_at_*`) говорит свой пакет сам (`homePack`). */
  const home =
    tools.homePack ||
    (weapon ? tracerWeaponSource(weapon.id)?.pack || weaponHomePack(weapon.id) : null);
  /* Пакеты обвесов ствола (`homePacks`) — следом за пакетом самого ствола. */
  const homes = [...new Set([home, ...(tools.homePacks || [])].filter(Boolean).map((name) => String(name).toLowerCase()))];
  const byName = new Map(packs.map((name) => [name.toLowerCase(), name]));
  const homeFolders = homes.map((name) => byName.get(name)).filter(Boolean);
  const ordered = [
    ...packs
      .filter((name) => patchNumber(name) >= 0)
      .sort((left, right) => patchNumber(right) - patchNumber(left)),
    ...homeFolders.filter((name) => patchNumber(name) < 0),
  ];
  const archives = [];
  for (const pack of ordered) {
    const file = path.join(dlcRoot, pack, "dlc.rpf");
    if (await exists(file)) archives.push(file);
  }
  for (const base of ["x64e.rpf", path.join("update", "update.rpf")]) {
    const file = path.join(gameRoot, base);
    if (await exists(file)) archives.push(file);
  }
  /* Пакеты первого года лежат внутри x64w.rpf (`dlcpacks/<пакет>/dlc.rpf`):
     туда — последним, если ствол оттуда, а обновления его не перекрыли. */
  if (homes.some((name) => !byName.has(name))) {
    const file = path.join(gameRoot, "x64w.rpf");
    if (await exists(file)) archives.push(file);
  }
  return archives;
}

const baseName = (entry) =>
  String(entry || "")
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    .toLowerCase();

/**
 * Находит словари текстур ствола в игре: архив и записи внутри него.
 * Обычная и «+hi» берутся из одного архива — они всегда выходят парой.
 */
export async function locateWeaponTextures(
  { gameRoot, model, context = null },
  tools = {},
) {
  return locateWeaponFiles(
    {
      gameRoot,
      model,
      context,
      primary: `${model}.ytd`,
      extra: [`${model}+hi.ytd`],
    },
    tools,
  );
}

/**
 * Находит файлы ствола в игре: главный (`primary`) и сопутствующие из того
 * же архива. Главный задаёт архив — сопутствующие без него не ищутся.
 */
export async function locateWeaponFiles(
  { gameRoot, model, context = null, primary, extra = [] },
  tools = {},
) {
  const resolved = { ...defaultTools(), ...tools };
  const wanted = new Set([primary, ...extra]);
  for (const archivePath of await weaponTextureArchives(
    gameRoot,
    model,
    tools,
  )) {
    context?.onProgress?.({
      phase: "search",
      archive: path.basename(path.dirname(archivePath)),
    });
    let result;
    try {
      result = await resolved.search({
        archivePath,
        query: `${model}`,
        gameRoot,
        edition: "Legacy",
        maxMatches: 16,
        maxNestedDepth: 3,
      });
    } catch {
      continue;
    }
    const entries = (result?.matches || [])
      .map((match) => String(match?.entry || ""))
      .filter((entry) => wanted.has(baseName(entry)));
    const main = entries.find((entry) => baseName(entry) === primary);
    if (!main) continue;
    return {
      archivePath,
      entries: [
        main,
        ...extra
          .map((name) => entries.find((entry) => baseName(entry) === name))
          .filter(Boolean),
      ],
    };
  }
  throw refusal(
    "WEAPON_SKIN_NOT_FOUND",
    "Текстур этого ствола нет в архивах игры: игра неполная или ствол из другой версии.",
  );
}

export function buildWeaponSkinManifest({ model, name, files }) {
  const digest = weaponSkinSourceDigest(files);
  /* Маски (Т-107b): поверх модели каталога скин прячет её модель и копию
     высокой детализации, пока лежит сверху; записи нет — ничего. */
  const masks = weaponSkinMaskEntries(
    model,
    files.map((file) => file.entry),
  ).map((entry) => ({
    target: WEAPON_SKIN_DLC_TARGET,
    action: "delete",
    entry,
    allowMissing: true,
  }));
  return {
    id: `local-weapon-skin-${digest.slice(0, 12)}`,
    version: `1.0.0-${digest.slice(0, 12)}`,
    name: `Astral skin: ${name}`.slice(0, 120),
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    gameplayChanges: false,
    /* `astral_stream.rpf` — архив внутри DLC: запись в него движок
       пускает только с `rpf-container-entry-v1`, как у моделей каталога. */
    capabilities: masks.length
      ? WEAPON_SKIN_MASK_CAPABILITIES
      : WEAPON_SKIN_CAPABILITIES,
    slots: [`weapon-${model}`],
    weaponSkin: {
      schemaVersion: 1,
      model,
      sourceDigest: `sha256:${digest}`,
    },
    files: [
      ...files.map((file) => ({
        source: `payload/${file.entry.split("/").pop()}`,
        target: WEAPON_SKIN_DLC_TARGET,
        action: "import",
        entry: file.entry,
        size: file.size,
        sha256: file.sha256,
      })),
      ...masks,
    ],
  };
}

/* Файлы игры для скина: словари ствола и магазина — то, что запекается, и
   модели — чтобы узнать, какие детали на палитре оттенков. */
const SKIN_SOURCE_ROLES = new Set([
  "model",
  "model-hi",
  "texture",
  "texture-hi",
  "magazine",
  "magazine-texture",
  "magazine-texture-hi",
]);

/** Достаёт найденные файлы игры: каждый архив — одним вызовом. */
async function extractLocatedFiles(located, outputDirectory, gameRoot, resolved) {
  const byArchive = new Map();
  const files = [];
  let part = 0;
  for (const item of located) {
    /* Файл «вида из каталога» (`attachment-looks.js`) лежит у нас: копия в рабочую папку, правки — на ней. */
    if (item.loose) {
      const output = path.join(outputDirectory, "loose", String((part += 1)), item.name);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.copyFile(item.loose, output);
      files.push({ role: item.role, name: item.name, output });
      continue;
    }
    const list = byArchive.get(item.archivePath) || [];
    list.push(item);
    byArchive.set(item.archivePath, list);
  }
  for (const [archivePath, items] of byArchive) {
    /* Один файл — одна выгрузка, даже если его просят две роли (штатный магазин
       ствола и он же — обвес-картинка, 21.10.2026): движок отказывает в повторе. */
    const extracted = await resolved.extract({
      archivePath,
      entries: [...new Set(items.map((item) => item.entry))],
      outputDirectory: path.join(outputDirectory, String((part += 1))),
      gameRoot,
      edition: "Legacy",
    });
    for (const item of extracted?.extracted || []) {
      for (const source of items.filter(
        (candidate) => baseName(candidate.entry) === baseName(item.entry),
      ))
        files.push({ ...source, output: item.output });
    }
  }
  return files;
}

/*
 * Детали на палитре оттенков: текстура цвета → её палитра (имена
 * строчными). У стволов на `weapon_*_palette` альфа диффуза — номер
 * столбца палитры `<ствол>_dpal`, а игра умножает краску на цвет оттенка
 * (`@modovik/gunpack/game-weapon`). Модель не разобралась — палитра не
 * известна, и краска ложится как раньше.
 */
async function weaponPaletteUsage(sources) {
  const usage = new Map();
  for (const source of sources) {
    if (!/\.ydr$/i.test(source.name)) continue;
    try {
      const model = readDrawable(new Uint8Array(await fs.readFile(source.output)), {
        inflateRaw,
      });
      for (const drawable of model.drawables)
        for (const material of drawable.materials || []) {
          const diffuse = material?.textures?.diffuse;
          const palette = material?.textures?.palette;
          if (diffuse && palette)
            usage.set(String(diffuse).toLowerCase(), String(palette).toLowerCase());
        }
    } catch {
      /* см. выше: без модели палитры не знаем */
    }
  }
  return usage;
}

async function rgbaOf(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    rgba: new Uint8Array(data.buffer, data.byteOffset, data.length),
  };
}

const pngOfRgba = (rgba, width, height) =>
  sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();

/*
 * Палитра оттенков в пакете скина (04.10.2026, задача 3).
 *
 * Покраска студии — это цвет, который человек видит в кадре: штатный
 * оттенок в нём уже есть (`composeTintPalette` при сборке модели). Игра же
 * умножает диффуз ещё раз на палитру — и красный в игре выходил почти
 * чёрным. Поэтому, когда красится деталь на палитре, пакет везёт:
 *  • палитру белой (альфа — заводская): оттенок больше не перекрашивает
 *    скин, в игре ровно тот цвет, что в кадре;
 *  • остальные детали на той же палитре, которых человек не трогал, — с
 *    заводским оттенком, запечённым в цвет: они выглядят как раньше.
 * Отсюда и честная оговорка: оттенки оружия из магазина (золото, LSPD…) на
 * скин не действуют.
 */
export async function prepareTintPalettes(
  { dictionaries, palettes, repainted, painted, work, request },
  resolved,
  context,
) {
  const result = {
    extra: new Map(),
    inspected: new Map(),
    decoded: new Map(),
    skipped: [],
    whitened: [],
    composed: [],
  };
  if (!repainted.size) return result;
  const pictures = new Map();
  for (const dictionary of dictionaries) {
    const info = await resolved.inspectYtd({
      input: dictionary.output,
      gameRoot: request.gameRoot,
      edition: "Legacy",
    });
    const directory = path.join(work, "decoded", dictionary.name);
    await resolved.readTextures(dictionary.output, directory, context);
    result.inspected.set(dictionary.name, info);
    result.decoded.set(dictionary.name, directory);
    for (const texture of info?.resource?.textures || []) {
      const name = String(texture?.name || "").toLowerCase();
      if (!pictures.has(name))
        pictures.set(name, path.join(directory, `${texture.name}.png`));
    }
  }
  const paletteImages = new Map();
  for (const palette of repainted) {
    const image = pictures.has(palette)
      ? await rgbaOf(pictures.get(palette)).catch(() => null)
      : null;
    if (image) paletteImages.set(palette, image);
    else
      result.skipped.push({
        texture: palette,
        reason: "палитры оттенков нет в словаре — в игре краска выйдет темнее",
      });
  }
  for (const dictionary of dictionaries) {
    const list = [];
    for (const texture of result.inspected.get(dictionary.name)?.resource
      ?.textures || []) {
      const name = String(texture?.name || "").toLowerCase();
      const own = paletteImages.get(name);
      if (own) {
        const white = new Uint8Array(own.rgba.length);
        for (let at = 0; at < white.length; at += 4) {
          white[at] = 255;
          white[at + 1] = 255;
          white[at + 2] = 255;
          white[at + 3] = own.rgba[at + 3];
        }
        list.push({
          texture: texture.name,
          png: await pngOfRgba(white, own.width, own.height),
          opaque: false,
        });
        if (!result.whitened.includes(name)) result.whitened.push(name);
        continue;
      }
      const palette = palettes.get(name);
      const image = palette ? paletteImages.get(palette) : null;
      if (!image || painted.has(name)) continue;
      const stock = await rgbaOf(
        path.join(result.decoded.get(dictionary.name), `${texture.name}.png`),
      ).catch(() => null);
      if (!stock) continue;
      /* Надписи оружия (ТЗ 12.10.2026, ночь): нарисованная надпись стирается
         до оттенка — как в студии. */
      const boxes = paintedInscriptionsOf(texture.name);
      const diffuse = boxes ? clearPaintedInscriptions(stock, boxes) : stock;
      const tinted = composeTintPalette(diffuse, image);
      list.push({
        texture: texture.name,
        png: await pngOfRgba(tinted.rgba, tinted.width, tinted.height),
        opaque: true,
      });
      result.composed.push(`${dictionary.name}:${texture.name}`);
    }
    if (list.length) result.extra.set(dictionary.name, list);
  }
  return result;
}

/**
 * Что запекается в словарь ствола: покраска, детали палитры (`extra` —
 * белая палитра и заводской оттенок, запечённый в цвет) и прозрачные
 * детали без покраски. Прозрачной детали альфа ложится на её цвет —
 * у детали на палитре на цвет с запечённым оттенком, а не на светлую
 * заготовку: прозрачный шейдер палитры не знает (задача 2 ТЗ 05.10.2026).
 * `transparent` и `painted` — имена текстур строчными. `keep` — то, что не
 * очищается и едет как в игре (`keptAsGameOf`): палитры и несжатые текстуры.
 */
export function skinTextureList({ textures, extra = [], transparent, painted, opacity, material = null, keep = new Set() }) {
  const alphaOf = (name) => (transparent.has(String(name).toLowerCase()) ? opacity : null);
  /* Материал (стекло, рентген) — пиксели детали пишет запекание
     (`materialPixels`): цвет материала и альфа по нему. */
  const look = (name) => (material && transparent.has(String(name).toLowerCase()) ? { material } : {});
  const shaped = extra.map((item) =>
    alphaOf(item.texture) === null ? item : { ...item, alpha: alphaOf(item.texture), ...look(item.texture) },
  );
  const composed = new Set(shaped.map((item) => String(item.texture).toLowerCase()));
  const clearOnly = [...transparent]
    .filter((name) => !painted.has(name) && !composed.has(name) && !keep.has(name))
    .map((texture) => ({ texture, png: null, opaque: true, alpha: opacity, ...look(texture) }));
  return [
    ...textures.map((item) => ({ ...item, alpha: alphaOf(item.texture), ...look(item.texture) })),
    ...shaped,
    ...clearOnly,
  ];
}

/*
 * Что в словаре ствола едет как в игре, без очистки и заготовок: палитры
 * оттенков (`_dpal`, их альфа — номера столбцов) и несжатые текстуры (игра
 * пишет в словарь только сжатые блоки и эти — заводскими байтами). Очистка
 * такой текстуры давала чёрный или пропавший оттенок (21.10.2026).
 */
export function keptAsGameOf(textures, palettes) {
  const keep = new Set(palettes ? [...palettes.values()] : []);
  for (const texture of textures || [])
    if (!/DXT|ATI|BC/i.test(String(texture?.format || "")))
      keep.add(String(texture.name).toLowerCase());
  return keep;
}

/**
 * Собирает пакет скина: запечённые словари и манифест. Возвращает папку
 * пакета, манифест и отчёт — что запеклось, а что нет и почему.
 */
export async function buildWeaponSkin(
  input,
  stateDir,
  tools = {},
  context = null,
) {
  const resolved = { ...defaultTools(), ...tools };
  const request = normalizeWeaponSkinRequest(input);
  const work = path.join(stateDir, "weapon-skins", "work", randomUUID());
  await fs.mkdir(work, { recursive: true });
  try {
    /* Словари ствола (обычный и «+hi») и его штатного магазина — у обоймы
       свой словарь (`w_pi_pistol_mag1.ytd`), и без него покраска магазина
       в игру не доезжала. Модели — только чтобы узнать палитру оттенков. */
    /*
     * Обвесы (задача 6 ТЗ 17.10.2026): выбранные — модели игры, из которых
     * собираются куски (`part:<кость>:…`); штатные других костей (ствол
     * MK2, прицел снайперки) — их словари красятся, как словарь магазина, а
     * модель штатного несёт выбранный той же кости (`part:std-<кость>:…`).
     */
    const weaponId = weaponByModel(request.model).id;
    const chosenParts = resolveAttachments(weaponId, request.attachments);
    const magazineModel = gameWeaponFiles(request.model).magazine?.replace(/\.ydr$/, "") || null;
    const standardParts = defaultAttachments(weaponId)
      .filter((item) => item.component.model !== magazineModel)
      .map((item) => ({ ...item, key: `std-${item.bone}` }));
    const located = await locateGameWeaponModelFiles(
      {
        gameRoot: request.gameRoot,
        model: request.model,
        context,
        parts: [...attachLooks(chosenParts, request.looks).map((item) => ({ ...item, key: item.bone })), ...standardParts],
      },
      { indexDir: path.join(stateDir, "weapon-models", "index"), ...tools },
    );
    const sources = await extractLocatedFiles(
      located.filter((item) => SKIN_SOURCE_ROLES.has(item.role) || item.role.startsWith("part:")),
      path.join(work, "source"),
      request.gameRoot,
      resolved,
    );
    /* Словари выбранных обвесов не красятся: их файлы общие у многих
       стволов — покраска такого обвеса едет в его кусках внутри модели. */
    const chosenRole = (role) => chosenParts.some((item) => role.startsWith(`part:${item.bone}:`));
    const dictionaries = sources.filter((item) => /\.ytd$/i.test(item.name) && !chosenRole(item.role));
    const palettes = await weaponPaletteUsage(sources);
    /* Надписи оружия (ТЗ 12.10.2026, ночь): модели игрока — без заводских
       надписей, по тому же правилу, что модель студии. Чистая модель ложится
       на место исходной в рабочей папке: украшения, свечение и размер правят
       уже её. */
    const inscriptionFiles = [];
    for (const item of sources)
      inscriptionFiles.push({ name: item.name, role: item.role, bytes: new Uint8Array(await fs.readFile(item.output)) });
    const cleaned = new Map();
    for (const model of weaponInscriptionModels(inscriptionFiles)) {
      const item = sources.find((source) => source.name === model.name);
      if (!item) continue;
      await fs.writeFile(item.output, model.bytes);
      cleaned.set(model.name, { bytes: model.bytes, removed: model.removed });
    }
    const painted = new Set(
      request.textures.map((item) => item.texture.toLowerCase()),
    );

    const baked = [];
    const skipped = [];
    const outputs = [];
    /*
     * Украшения — геометриями в модели ствола и в «_hi» (в руках — она),
     * раньше размера и свечения: размер растит и их, а свечение их не
     * трогает (своих текстур у ствола у них нет). Модель с украшениями
     * ложится на место исходной в рабочей папке — дальше её правят, как
     * штатную.
     */
    const decorated = new Map();
    const decorationReport = { models: [], bones: [], geometries: 0 };
    /* Своя модель ствола (задача 6 ТЗ 17.10.2026): её куски встают в те же
       модели вместо геометрий ствола — тем же вызовом хоста, что украшения. */
    const ownReport = request.ownModel ? { models: [], lods: [], bones: [], skeleton: [], magazine: request.ownModel.magazine } : null;
    /* Покраска по имени текстуры цвета — для кусков обвесов. */
    const paintedPng = new Map(request.textures.map((item) => [item.texture.toLowerCase(), item.png]));
    const usedPaint = new Set();
    const embedParts = chosenParts.filter((item) => item.mode === "embed");
    const attachmentReport = chosenParts.length ? { embedded: [], replaced: [], skipped: [], models: [] } : null;
    if (request.decorations.length || request.ownModel || embedParts.length || request.paintPieces.length) {
      const models = sources.filter((item) => item.role === "model" || item.role === "model-hi");
      if (!models.length)
        throw refusal(
          "WEAPON_SKIN_MODEL",
          request.ownModel ? "Модели ствола нет в архивах игры — своей модели не во что встать." : "Модели ствола нет в архивах игры — украшения не поставить.",
        );
      /* В руках — `_hi` с полными сетками; обычная модель (ствол вдали) —
         облегчёнными. Без `_hi` в руках обычная — ей полные. */
      const handHeld = models.some((item) => item.role === "model-hi");
      for (const item of models) {
        const lod = item.role === "model" && handHeld ? "low" : "high";
        const own = request.ownModel
          ? await buildOwnModelBody({ own: request.ownModel, lod, staging: path.join(work, "own", item.name) }, tools.ownModel || {})
          : null;
        /* Обвесы — на свои кости этой модели: в руках `_hi` обвеса, вдали —
           обычная модель обвеса. */
        const embedded = embedParts.length
          ? await embeddedAttachments(
              { weaponFile: item, parts: embedParts, sources, painted: paintedPng, staging: path.join(work, "attachments", item.name), lod },
              tools.attachments || {},
            )
          : null;
        if (embedded?.report) attachmentReport.models.push({ model: item.name, ...embedded.report });
        for (const name of embedded?.painted || []) usedPaint.add(name);
        const result = await decorateWeaponModel(
          {
            input: item.output,
            output: path.join(work, "decorated", item.name),
            decorations: request.decorations,
            images: request.decorationImages,
            staging: path.join(work, "decorations", item.name),
            lod,
            body: own?.body || null,
            attachments: embedded?.attachments || null,
            pieces: request.paintPieces,
          },
          context,
          resolved.native || undefined,
        );
        if (!result) continue;
        await fs.writeFile(item.output, result.bytes);
        decorated.set(item.name, result.bytes);
        const semantic = result.report?.result?.semantic || result.report?.semantic || {};
        if (request.decorations.length) {
          decorationReport.models.push(item.name);
          decorationReport.geometries += (Number(semantic.geometries) || 0) - (Number(semantic.body?.geometries) || 0);
          for (const bone of semantic.bones || []) if (!decorationReport.bones.includes(bone)) decorationReport.bones.push(bone);
        }
        if (attachmentReport && embedded) {
          /* Встал ли обвес — по его кусков в модели: кости нет в стволе или
             модель обвеса не читается — сказать, а не молчать. */
          for (const placed of embedded.report?.parts || []) {
            const known = (list) => list.some((entry) => entry.bone === placed.bone);
            if (!placed.skipped && embedded.attachments) {
              if (!known(attachmentReport.embedded))
                attachmentReport.embedded.push({ bone: placed.bone, component: placed.component, model: placed.model });
            } else if (placed.skipped && !known(attachmentReport.skipped))
              attachmentReport.skipped.push({
                bone: placed.bone,
                component: placed.component,
                reason: placed.skipped === "bone" ? "такой кости нет в модели ствола" : "модель обвеса не читается",
              });
          }
          for (const bone of semantic.attachments?.bones || [])
            if (!attachmentReport.bones?.includes(bone)) (attachmentReport.bones ||= []).push(bone);
        }
        if (ownReport) {
          ownReport.models.push(item.name);
          ownReport.lods.push({ model: item.name, ...own.report, replaced: Number(semantic.replaced) || 0 });
          for (const bone of semantic.bones || []) if (!ownReport.bones.includes(bone)) ownReport.bones.push(bone);
          for (const bone of semantic.skeleton?.kept || []) if (!ownReport.skeleton.includes(bone)) ownReport.skeleton.push(bone);
        }
      }
      /* Штатный магазин — прочь, если у своей модели свой (по умолчанию). */
      if (request.ownModel?.magazine === "hide")
        for (const item of sources.filter((source) => source.role === "magazine")) {
          const hidden = hideMagazineModel(new Uint8Array(await fs.readFile(item.output)));
          if (!hidden) continue;
          await fs.writeFile(item.output, hidden.bytes);
          decorated.set(item.name, hidden.bytes);
          ownReport.magazineModel = item.name;
        }
    }
    /*
     * Выбранный обвес кости со штатным (магазин, ствол MK2, прицел
     * снайперки) — в модель штатного: игра вешает штатный всегда, и он
     * выглядит выбранным. Модели штатного магазина — роль `magazine`,
     * остальных — `part:std-<кость>:model(-hi)`.
     */
    for (const part of chosenParts.filter((item) => item.mode === "replace")) {
      const standard = /^wapclip/i.test(part.bone)
        ? sources.filter((item) => item.role === "magazine")
        : sources.filter(
            (item) => item.role === `part:std-${part.bone}:model` || item.role === `part:std-${part.bone}:model-hi`,
          );
      if (!standard.length) {
        attachmentReport.skipped.push({ bone: part.bone, component: part.component.id, reason: "модели штатного обвеса нет в архивах игры" });
        continue;
      }
      for (const item of standard) {
        const lod = /_hi\.ydr$/i.test(item.name) ? "high" : "low";
        const made = await replacementBody(
          { standardFile: item, part, sources, painted: paintedPng, staging: path.join(work, "replace", item.name), lod },
          tools.attachments || {},
        );
        for (const name of made?.painted || []) usedPaint.add(name);
        if (!made) {
          attachmentReport.skipped.push({ bone: part.bone, component: part.component.id, reason: "модели выбранного обвеса нет в архивах игры" });
          continue;
        }
        const result = await decorateWeaponModel(
          {
            input: item.output,
            output: path.join(work, "replaced", item.name),
            decorations: [],
            staging: path.join(work, "replace-request", item.name),
            lod,
            body: made.body,
          },
          context,
          resolved.native || undefined,
        );
        if (!result) continue;
        await fs.writeFile(item.output, result.bytes);
        decorated.set(item.name, result.bytes);
        attachmentReport.replaced.push({ bone: part.bone, component: part.component.id, model: part.component.model, file: item.name });
      }
    }
    /* Модели ствола и магазина — свечение (только ствол), прозрачность и
       размер. Модели — раньше словарей: прозрачность называет текстуры
       цвета, которым запекание пишет альфу. */
    const glowed = [];
    const transparent = new Set();
    let scaledModels = 0;
    const adjusting = request.glow.length || request.scale !== 1 || request.opacity < 1 || request.material !== "standard";
    if (adjusting) {
      const glowSkipped = new Map();
      const models = sources.filter(
        (item) => item.role === "model" || item.role === "model-hi" || item.role === "magazine",
      );
      for (const item of models) {
        const main = item.role !== "magazine";
        const result = adjustWeaponModel(new Uint8Array(await fs.readFile(item.output)), {
          glow: main ? request.glow : [],
          scale: request.scale,
          opacity: request.opacity,
          material: request.material,
          materialGlow: request.materialGlow,
        });
        /* О детали говорит главная модель: в «_hi» деталей бывает больше. */
        if (item.role === "model") {
          glowed.push(...result.glowed);
          for (const entry of result.skipped)
            if (!/^(прозрачность|материал):/.test(entry.reason)) glowSkipped.set(entry.texture, entry.reason);
        }
        if (item.role !== "model-hi")
          for (const entry of result.skipped)
            if (/^(прозрачность|материал):/.test(entry.reason) && !skipped.some((known) => known.texture === entry.texture && known.reason === entry.reason))
              skipped.push(entry);
        for (const texture of result.alpha) transparent.add(texture.toLowerCase());
        if (result.scaled) scaledModels += 1;
        if (result.bytes) outputs.push({ file: item.name, bytes: result.bytes });
      }
      if (!models.some((item) => item.role === "model")) {
        for (const item of request.glow) glowSkipped.set(item.texture, "модели ствола нет в архивах игры");
        if (request.scale !== 1 || request.opacity < 1 || request.material !== "standard")
          throw refusal("WEAPON_SKIN_MODEL", "Модели ствола нет в архивах игры — размер, прозрачность и материал не поставить.");
      }
      for (const [texture, reason] of glowSkipped)
        skipped.push({ texture, reason: `свечение: ${reason}` });
    }
    /* Модель с украшениями, которую размер и свечение не тронули, — тоже в пакет. */
    for (const [name, bytes] of decorated)
      if (!outputs.some((entry) => entry.file === name)) outputs.push({ file: name, bytes });
    /* Палитра оттенков белеет, если красится деталь на ней — иначе игра
       умножила бы краску на тёмный штатный оттенок, — или если деталь на ней
       становится прозрачной: прозрачный шейдер палитры не знает, и без
       запечённого в цвет оттенка ствол в игре выходил белёсым (задача 2 ТЗ
       05.10.2026, кадр в игре). Модели правятся раньше: прозрачность
       называет свои детали только после них. */
    const repainted = new Set(
      [...painted, ...transparent].map((name) => palettes.get(name)).filter(Boolean),
    );
    const prepared = await prepareTintPalettes(
      { dictionaries, palettes, repainted, painted, work, request },
      resolved,
      context,
    );
    skipped.unshift(...prepared.skipped);
    /* Надписи оружия (ТЗ 12.10.2026, ночь): нарисованные в картинке надписи
       (`PAINTED_INSCRIPTIONS`) едут стёртыми и у текстур, которых человек не
       красил. Покрашенные и с запечённым оттенком уже чистые. */
    const clearing = await inscriptionTextureItems(
      {
        dictionaries,
        skip: (dictionary, name) =>
          painted.has(name.toLowerCase()) ||
          (prepared.extra.get(dictionary) || []).some((item) => item.texture.toLowerCase() === name.toLowerCase()),
        inspected: prepared.inspected,
        decoded: prepared.decoded,
        work,
        gameRoot: request.gameRoot,
      },
      resolved,
      context,
    );
    const clearedTextures = new Set();
    for (const items of clearing.values()) for (const item of items) clearedTextures.add(item.texture.toLowerCase());
    /* Скин — то, что попросил человек: одни стёртые надписи пакетом не считаются. */
    let landedRequest = outputs.length > 0;
    for (const dictionary of dictionaries) {
      const result = await bakeYtd(
        {
          input: dictionary.output,
          file: dictionary.name,
          textures: skinTextureList({
            textures: request.textures,
            extra: [...(prepared.extra.get(dictionary.name) || []), ...(clearing.get(dictionary.name) || [])],
            transparent,
            painted,
            opacity: request.opacity,
            material: request.material === "standard" ? null : { kind: request.material, tint: request.tint },
            keep: keptAsGameOf(prepared.inspected.get(dictionary.name)?.resource?.textures, palettes),
          }),
          work,
          gameRoot: request.gameRoot,
          inspected: prepared.inspected.get(dictionary.name) || null,
          decoded: prepared.decoded.get(dictionary.name) || "",
        },
        resolved,
        context,
      );
      baked.push(...result.baked);
      for (const item of result.skipped)
        skipped.push(clearedTextures.has(item.texture.toLowerCase()) ? { ...item, reason: `надписи: ${item.reason}` } : item);
      if (result.bytes) outputs.push({ file: dictionary.name, bytes: result.bytes });
      if (result.baked.some((item) => !clearedTextures.has(item.texture.toLowerCase()))) landedRequest = true;
    }
    /* Что не легло ни в один словарь — сказать словами (в «+hi» и в
       словаре магазина текстур меньше, и это не ошибка). */
    const landed = new Set(baked.map((item) => item.texture.toLowerCase()));
    /* Покраска выбранных обвесов уехала в их кусках внутри модели. */
    for (const name of usedPaint) landed.add(name);
    for (const item of request.textures)
      if (
        !landed.has(item.texture.toLowerCase()) &&
        !skipped.some(
          (entry) =>
            entry.texture.toLowerCase() === item.texture.toLowerCase() &&
            !entry.reason.startsWith("свечение:") &&
            !entry.reason.startsWith("прозрачность:"),
        )
      )
        skipped.push({ texture: item.texture, reason: "нет в словаре ствола" });
    if (!landedRequest)
      throw refusal(
        "WEAPON_SKIN_NOTHING",
        skipped.length
          ? `Покраска не легла ни на одну текстуру ствола: ${skipped
              .map((item) => `${item.texture} — ${item.reason}`)
              .join("; ")}.`
          : "Покраска не легла ни на одну текстуру ствола.",
      );
    /* Чистые модели (надписи оружия), которых не правили украшения, свечение
       и размер, — тоже в пакет. Сами по себе они скин не делают: проверка
       выше — по тому, что попросил человек. */
    for (const [name, model] of cleaned)
      if (!outputs.some((entry) => entry.file === name)) outputs.push({ file: name, bytes: model.bytes });

    const allowed = new Set(weaponSkinEntries(request.model));
    const files = outputs
      .map((item) => ({
        entry: `astral_stream.rpf/${item.file}`,
        size: item.bytes.length,
        sha256: sha256(item.bytes),
        bytes: item.bytes,
      }))
      .filter((file) => allowed.has(file.entry));
    const manifest = buildWeaponSkinManifest({
      model: request.model,
      name: request.name,
      files,
    });
    const directory = path.join(
      stateDir,
      "weapon-skins",
      "packages",
      manifest.weaponSkin.sourceDigest.slice(7, 19),
    );
    for (const file of files)
      await atomicWrite(
        path.join(directory, "payload", file.entry.split("/").pop()),
        file.bytes,
      );
    const main = located.find((item) => item.role === "texture");
    return {
      request,
      directory,
      manifest,
      manifestHash: `sha256:${sha256(Buffer.from(canonicalManifest(manifest)))}`,
      archive: path.relative(request.gameRoot, main.archivePath),
      baked,
      skipped,
      tint: prepared.whitened.length
        ? { palettes: prepared.whitened, composed: prepared.composed }
        : null,
      glow: glowed,
      /* Размер и прозрачность в игре: сколько моделей сменило размер,
         какие текстуры цвета стали прозрачными. */
      shape: {
        scale: request.scale,
        opacity: request.opacity,
        scaledModels,
        transparent: [...transparent],
      },
      /* Украшения в игре: в какие модели встали и к каким костям ствола. */
      decorations: request.decorations.length
        ? { count: request.decorations.length, ...decorationReport }
        : null,
      /* Своя модель: в какие модели встала, сколько треугольников в руках и
         вдали, упрощена ли, за какую кость держится, какие кости ствола на
         месте, спрятан ли штатный магазин. */
      ownModel: ownReport,
      /* Обвесы: какие вшиты в модель ствола (кость → обвес), какие встали в
         модель штатного, что не встало и почему. */
      attachments: attachmentReport,
      /* Надписи оружия: из каких моделей и сколько треугольников убрано,
         какие текстуры ушли со стёртыми нарисованными надписями. */
      inscriptions:
        cleaned.size || clearedTextures.size
          ? {
              models: [...cleaned.keys()],
              triangles: [...cleaned.values()].reduce((sum, model) => sum + model.removed, 0),
              textures: baked
                .filter((item) => clearedTextures.has(item.texture.toLowerCase()))
                .map((item) => `${item.file}:${item.texture}`),
            }
          : null,
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

function installOptions(built, stateDir, extra = {}) {
  return {
    manifest: built.manifest,
    packageRoot: built.directory,
    gameRoot: built.request.gameRoot,
    targetId: built.request.targetId,
    edition: "Legacy",
    stateDir,
    allowGameRootWrites: true,
    requireSignature: false,
    rpfProbe: probeRpfArchive,
    ...extra,
  };
}

/*
 * Сменяется только прежний СКИН мастерской на этом стволе (та же работа в новой версии, «Применить ещё раз»). СКИН НИКОГДА НЕ СНИМАЕТ ГАНПАК (решение лида 1, 23.11.2026; так было в 1.0.2): свой или каталожный ганпак
 * на том же стволе остаётся под скином слоем, снятие скина возвращает его модель — скин делают на модели ганпака. Мод каталога на том же слоте тоже остаётся под скином (Т-107b).
 * Прежний скин со стволами, которых у нового нет (`keeps` плана), не заменяется — общий помощник `conflictsReplacedWhole`; контейнер (режим RP) считает то же в `previousSkinsOf`.
 */
export const replacementIds = (plan) => conflictsReplacedWhole(plan, (item) => /^local-weapon-skin-/.test(String(item.modId)));

/*
 * Запись переигрывания скина (`engineReplay`, шаг 3 фазы 7, за флагом `ASTRAL_ENGINE_INSTALL=weapon-skin`):
 * скин многоархивный — DLC `astral_weapons` и, при регистрации, `update.rpf`. Запись держит импортируемые файлы
 * пакета: путь в папке пакета, запись в игре, размер и SHA-256. Маски удалений выводятся из модели и файлов.
 */
export function weaponSkinReplayRecord(built) {
  return {
    module: "weapon-skin",
    workId: built.manifest.id,
    version: built.manifest.version,
    sourceDigest: built.manifest.weaponSkin.sourceDigest,
    multi: true,
    order: {
      files: built.manifest.files
        .filter((file) => file.action === "import")
        .map((file) => ({ source: file.source, entry: file.entry, size: file.size, sha256: file.sha256 })),
    },
  };
}

/*
 * Пакет скина для переигрывания: файлы на месте, их SHA-256 и размеры — те, что в записи, и дайджест,
 * пересобранный из записей, даёт тот же дайджест. Иначе — отказ, который называет работу, до записи в игру.
 */
export async function weaponSkinReplayPackage(stateDir, replay) {
  const workName = String(replay?.workId || "скин оружия");
  const digest = String(replay?.sourceDigest || "");
  const listed = Array.isArray(replay?.order?.files) ? replay.order.files : [];
  if (!/^sha256:[0-9a-f]{64}$/.test(digest) || !listed.length)
    throw new Error(`Работа «${workName}»: запись переигрывания испорчена — поставьте скин заново из мастерской.`);
  const packageRoot = path.join(path.resolve(String(stateDir || "")), "weapon-skins", "packages", digest.slice("sha256:".length, "sha256:".length + 12));
  const files = [];
  for (const item of listed) {
    const file = path.join(packageRoot, String(item?.source || ""));
    const stat = item?.source ? await fs.stat(file).catch(() => null) : null;
    if (!stat?.isFile())
      throw new Error(`Работа «${workName}»: пакет для переигрывания удалён — переустановите скин из мастерской.`);
    const hash = await sha256File(file);
    if (hash !== String(item.sha256 || "") || stat.size !== item.size)
      throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите скин из мастерской.`);
    files.push({ entry: item.entry, sha256: hash });
  }
  if (`sha256:${weaponSkinSourceDigest(files)}` !== digest)
    throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите скин из мастерской.`);
  return { packageRoot, files };
}

/**
 * Ставит скин в игру поверх того, что лежит на стволе: прежний скин того же
 * ствола сменяется, мод каталога остаётся под ним.
 */
/*
 * Сборка скина для потока читателя (`game-read-host.js`): на входе только данные, прогресс уходит окну сообщениями
 * потока. Главный процесс ставит скин по сборке из потока; проверки установки и запуска — там же, что и раньше.
 */
export async function buildWeaponSkinInThread(input, stateDir, context = null) {
  return buildWeaponSkin(input, stateDir, {}, context);
}

export async function applyWeaponSkin(input, stateDir, dependencies = {}) {
  const context = {
    ...(dependencies.nativeContext || {}),
    onProgress: dependencies.onProgress,
  };
  /* Сборка — `dependencies.buildSkin` (поток, в приложении) или здесь же (тесты с подменой инструментов). */
  const built = await (dependencies.buildSkin ||
    ((request, dir, ctx) => buildWeaponSkin(request, dir, dependencies.tools || {}, ctx)))(input, stateDir, context);
  const game = await dependencies.assertGameReady?.(built.request.gameRoot, {
    mutate: true,
  });
  /* Оружие через update.rpf, `ASTRAL_WEAPONS_VIA_UPDATE=container` (GTA 5 RP, 20.11.2026): скин ложится в контейнер `x64/astral/astral_rp_weapons.rpf`
     в update.rpf, а не в хост `astral_weapons`. Хост и план по его записям не нужны (прежний скин той же модели заменяет `previousSkinsOf` установки),
     точка движка `weapon-skin` записывает записи хоста — для контейнера её нет. Иначе (по умолчанию) всё как раньше. */
  const containerRoute = (() => {
    const route = appWeaponUpdateRoute({
      gameRoot: built.request.gameRoot,
      stateDir,
      env: dependencies.env || process.env,
      note: (message) => dependencies.note?.(message),
    });
    return route?.mode === "container" ? route : null;
  })();
  /* DLC готовится подготовкой игры; если её не было — готовится здесь же,
     без включения чужих слотов. */
  if (!containerRoute)
    await (dependencies.provision || provisionFastWeaponInfrastructure)({
      gameRoot: built.request.gameRoot,
      targetId: built.request.targetId,
      edition: "Legacy",
      stateDir,
      assertRuntimeSafety: () => dependencies.assertRuntimeSafety?.(game),
      activate: false,
    });
  const plan = containerRoute
    ? { conflicts: [] }
    : await (dependencies.plan || planPackage)(
        installOptions(built, stateDir),
      );
  /* Флаг `ASTRAL_ENGINE_INSTALL=weapon-skin`: несколько архивов (DLC и update.rpf) — одна точка, одна транзакция. */
  const engineInstall = !containerRoute && engineInstallEnabled("weapon-skin")
    ? {
        install: dependencies.installPrebuilt ?? installRpfPrebuilt,
        edition: "Legacy",
        gameRoot: built.request.gameRoot,
        pointsRoot: nativeRestorePointsRoot(),
        multi: true,
        replay: weaponSkinReplayRecord(built),
      }
    : null;
  const installed = await (
    dependencies.install || installLocalWeaponSkinPackage
  )(
    installOptions(built, stateDir, {
      replaceModIds: replacementIds(plan),
      rpfComposer: composeRpfArchive,
      dlcListProvider: provideLegacyDlcList,
      contentXmlProvider: provideUpdateContentXml,
      assertRuntimeSafety: () => dependencies.assertRuntimeSafety?.(game),
      onProgress: dependencies.onProgress,
      ...(engineInstall ? { engineInstall } : {}),
      ...(containerRoute ? { weaponUpdateRoute: containerRoute } : {}),
    }),
  );
  return {
    ...installed,
    modId: built.manifest.id,
    model: built.request.model,
    archive: built.archive,
    baked: built.baked,
    skipped: built.skipped,
    glow: built.glow,
    shape: built.shape,
    decorations: built.decorations,
    ownModel: built.ownModel,
    attachments: built.attachments,
    inscriptions: built.inscriptions,
    restartRequired: true,
  };
}

export async function removeWeaponSkin(input, stateDir, dependencies = {}) {
  const modId = String(input?.modId || "");
  if (!MOD_ID_PATTERN.test(modId))
    throw refusal("WEAPON_SKIN_MOD", "Непонятный скин.");
  const gameRoot = path.resolve(String(input?.gameRoot || ""));
  const game = await dependencies.assertGameReady?.(gameRoot, { mutate: true });
  const targetId = String(input?.targetId || "default");
  const assertRuntimeSafety = () => dependencies.assertRuntimeSafety?.(game);
  const uninstall = () =>
    (dependencies.uninstall || uninstallPackage)({
      modId,
      targetId,
      stateDir,
      rpfComposer: composeRpfArchive,
      dlcListProvider: provideLegacyDlcList,
      contentXmlProvider: provideUpdateContentXml,
      assertRuntimeSafety,
      onProgress: dependencies.onProgress,
    });
  try {
    return await uninstall();
  } catch (error) {
    /*
     * Нативный патч Astral (эффекты ствола, мини-карта, небо) пишет
     * update.rpf помимо слоя, и движок видит архив сменённым: «Стандарт»
     * пистолета после «Применить» эффектов падал «Astral Weapons DLC
     * изменён. Сначала повторите подготовку» (04.10.2026). Снятие делает эту
     * подготовку само — как окно при запуске — и повторяет один раз.
     */
    if (!HOST_CHANGED.test(String(error?.message || ""))) throw error;
    await (dependencies.prepareGame || prepareWeaponGame)({
      gameRoot,
      targetId,
      stateDir,
      assertRuntimeSafety,
    });
    return uninstall();
  }
}

/* Отказ движка, который лечит подготовка игры (`uninstallPackage`). */
const HOST_CHANGED = /Astral Weapons DLC изменён/;

/* «Подготовка GTA V» для оружия — как `PREPARE_GAME`: слой Astral на живом
   update.rpf, затем хост DLC оружия. */
async function prepareWeaponGame({
  gameRoot,
  targetId,
  stateDir,
  assertRuntimeSafety,
}) {
  await provisionAstralLayer({
    gameRoot,
    targetId,
    edition: "Legacy",
    stateDir,
    assertRuntimeSafety,
  });
  await provisionFastWeaponInfrastructure({
    gameRoot,
    targetId,
    edition: "Legacy",
    stateDir,
    assertRuntimeSafety,
    activate: false,
  });
}

const MAX_MODEL_BYTES = 96 * 1024 * 1024;

/* Версия сборки модели из игры: новая сборка — новый файл кэша. v2 —
   магазин на кости и штатный оттенок палитры (`@modovik/gunpack/game-weapon`),
   v3 — без заводских надписей (надписи оружия, ТЗ 12.10.2026, ночь), v4 —
   нарисованные надписи закрыты фактурой листа, а не ровным пятном
   (13.10.2026). */
const GAME_MODEL_REVISION = "v5";
/* Кэш прежних сборок той же модели — прочь: в них надписи или пятна, а у
   v4 — нет штатных обвесов (ствола MK2, прицела снайперки). */
const STALE_MODEL_REVISIONS = ["v2", "v3", "v4"];

/*
 * Файлы обвесов из найденных (`part:<кость>:<роль>`) — частями для
 * `gameWeaponModel`: `[{ bone, component, files: [{ name, role, bytes }] }]`.
 * Обвес без модели в игре не встаёт.
 */
export function gameParts(files, parts) {
  return parts
    .map((part) => ({
      bone: part.bone,
      component: part.component,
      files: files
        .filter((file) => file.role.startsWith(`part:${part.bone}:`))
        .map((file) => ({ ...file, role: file.role.slice(`part:${part.bone}:`.length) })),
    }))
    .filter((part) => part.files.some((file) => file.role === "model"));
}

const inflateRaw = (bytes) =>
  new Uint8Array(
    zlib.inflateRawSync(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      { finishFlush: zlib.constants.Z_SYNC_FLUSH },
    ),
  );

export async function encodeGlbPng(rgba, width, height) {
  const buffer = await sharp(
    Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    { raw: { width, height, channels: 4 } },
  )
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/* Модель ствола «как в игре» в GLB: магазин на своей кости, оттенок
   палитры — в картинке цвета, деталь названа своей текстурой цвета.
   `onlyParts` (19.10.2026) — одни обвесы на костях ствола, без самого
   ствола и магазина: слой кадра для своей модели .glb, которая встаёт в
   игру вместо геометрий ствола, а обвесы — на его кости. */
/* Сборка — в потоке и с быстрым PNG (`weapon-glb-thread.js`, 02.11.2026): уровень 9 у `sharp` был 85–90 % холодного чтения ствола (2,6–3,3 с из 3,2 у карабина),
   а разбор модели держал очередь главного процесса. */
export async function buildGameWeaponGlb(files, model, { parts = [], onlyParts = false } = {}) {
  return runOffThread(new URL("./weapon-glb-thread.js", import.meta.url), "buildGameWeaponGlbBytes", [files, model, { parts, onlyParts }]);
}

/* Контур ствола в потоке (`weapon-outline-thread.js`). */
const buildGameWeaponOutline = (files, parts) =>
  runOffThread(new URL("./weapon-outline-thread.js", import.meta.url), "gameWeaponOutline", [files, parts]);

/*
 * Чтение прервано (22.10.2026): картинка обвеса для плитки — фоновое чтение, и когда человек просит модель сам, она
 * уступает (`weapon-read-watch.js`, `signal`). Метка в тексте — по ней окно узнаёт отмену через границу IPC и просит
 * картинку заново, когда модель встанет.
 */
export const WEAPON_READ_CANCELLED = "WEAPON_READ_CANCELLED";
const throwIfCancelled = (signal) => {
  if (signal?.aborted)
    throw refusal(WEAPON_READ_CANCELLED, `${WEAPON_READ_CANCELLED}: чтение прервано — человек ждёт модель`);
};

/*
 * Файлы ствола в архивах игры. Обновления «patchday» перекрывают файлы по
 * одному, поэтому каждый берётся из самого свежего архива, где он есть:
 * текстуры пистолета лежат в patchday8ng, а магазин может остаться в x64e.
 * Без модели или словаря ствол не собрать — это отказ словами; без `_hi`,
 * магазина и их словарей — собирается то, что есть.
 */
export async function locateGameWeaponModelFiles(
  { gameRoot, model, context = null, parts = [] },
  tools = {},
) {
  const resolved = { ...defaultTools(), ...tools };
  const names = gameWeaponFiles(model);
  const weapon = weaponByModel(model);
  /* Холодное и метательное без `_hi` и магазина — ждать их по всем архивам
     незачем; у ствола из таблицы обвесов без штатного магазина — тоже. */
  const solo = weapon && ["melee", "thrown"].includes(weapon.family);
  const knownPoints = weapon ? weaponAttachPoints(weapon.id) : [];
  const noClip =
    knownPoints.length > 0 && !knownPoints.some((point) => /^wapclip/i.test(point.bone) && point.default);
  const hiNeed = solo ? "optional" : "wanted";
  const clipNeed = noClip ? "optional" : "wanted";
  const roles = [
    ["model", names.model, "required"],
    ["texture", names.textures, "required"],
    ["model-hi", names.modelHi, hiNeed],
    ["texture-hi", names.texturesHi, hiNeed],
    ["magazine", names.magazine, clipNeed],
    ["magazine-texture", names.magazineTextures, clipNeed],
    ["magazine-texture-hi", names.magazineTexturesHi, "optional"],
    /* Обвесы (задача 6 ТЗ 17.10.2026): модель и словарь — нужны, `_hi` —
       если есть. */
    ...parts.flatMap((part) => {
      const files = componentFiles(part.component.model);
      const key = part.key || part.bone;
      return [
        [`part:${key}:model`, files.model, "wanted"],
        [`part:${key}:texture`, files.textures, "wanted"],
        [`part:${key}:model-hi`, files.modelHi, "optional"],
        [`part:${key}:texture-hi`, files.texturesHi, "optional"],
      ];
    }),
  ].filter(([, name]) => name);
  /* Один проход архива на всё: ствол — по имени, магазин с другим началом
     имени и обвесы — по началу имени файла. */
  const magazineBase = names.magazine?.replace(/\.ydr$/, "");
  const prefixes = [
    ...new Set([
      ...(magazineBase && !magazineBase.startsWith(model) ? [magazineBase] : []),
      ...parts.map((part) => part.component.model),
    ]),
  ];
  const found = new Map();
  /* Файлы «вида из каталога»: в архивах игры их не ищут. */
  for (const part of parts)
    for (const file of part.look?.files || [])
      found.set(`part:${part.key || part.bone}:${file.role}`, {
        role: `part:${part.key || part.bone}:${file.role}`,
        name: file.name,
        loose: file.path,
      });
  /*
   * Копия высокой детализации (`_hi.ydr`, `+hi.ytd`) обновляется вместе со
   * своим файлом: в архиве, где нашлась обычная, нет `_hi` — значит, её нет
   * и в старших (сверено по 233 парам игры, 17.10.2026). Без этого ствол без
   * `+hi.ytd` ждал её по всем сорока архивам — полминуты на пустом месте.
   */
  const pairOf = (role) =>
    role.endsWith("-hi") ? role.slice(0, -3) : null;
  const skipped = new Set();
  const settled = () =>
    roles.every(
      ([role, , need]) => need === "optional" || found.has(role) || skipped.has(role),
    );
  const homePacks = [...new Set(parts.map((part) => part.component.pack).filter(Boolean))];
  for (const archivePath of await weaponTextureArchives(
    gameRoot,
    model,
    homePacks.length ? { ...tools, homePacks } : tools,
  )) {
    if (settled()) break;
    throwIfCancelled(tools.signal);
    context?.onProgress?.({
      phase: "search",
      archive: path.basename(path.dirname(archivePath)),
    });
    /* Опись файлов оружия архива — одна на архив (`weapon-file-index.js`);
       нет её — прежний поиск по имени. */
    const indexed = await archiveWeaponEntries({
      archivePath,
      gameRoot,
      search: resolved.search,
      cacheDir: tools.indexDir || null,
    });
    const entries = indexed ? [...indexed] : [];
    if (!indexed)
      try {
        const result = await resolved.search({
          archivePath,
          query: model,
          ...(prefixes.length ? { prefixes } : {}),
          gameRoot,
          edition: "Legacy",
          maxMatches: 512,
          maxNestedDepth: 3,
        });
        entries.push(
          ...(result?.matches || []).map((match) => String(match?.entry || "")),
        );
      } catch {
        /* битый или чужой архив — дальше по старшинству */
      }
    for (const [role, name] of roles) {
      if (found.has(role)) continue;
      const entry = entries.find((item) => baseName(item) === name);
      if (entry) found.set(role, { role, name, archivePath, entry });
    }
    for (const [role] of roles) {
      const base = pairOf(role);
      if (base && !found.has(role) && found.get(base)?.archivePath === archivePath)
        skipped.add(role);
    }
  }
  if (!found.has("model"))
    throw refusal("WEAPON_MODEL_MISSING", "Модели ствола нет в игре.");
  if (!found.has("texture"))
    throw refusal(
      "WEAPON_SKIN_NOT_FOUND",
      "Текстур этого ствола нет в архивах игры: игра неполная или ствол из другой версии.",
    );
  return [...found.values()];
}

/**
 * Файлы ствола из игры игрока байтами — `[{ name, role, bytes }]`: модель,
 * её `_hi`, словари и магазин (`locateGameWeaponModelFiles`). Общий шаг
 * витрины (`readGameWeaponModel`) и показа «В руках» (`weapon-in-hands.js`).
 */
export async function readGameWeaponFiles({ gameRoot, model, context = null, parts = [] }, stateDir, tools = {}) {
  const resolved = { ...defaultTools(), ...tools };
  const work = path.join(stateDir, "weapon-models", "work", randomUUID());
  try {
    const located = await locateGameWeaponModelFiles(
      { gameRoot: path.resolve(gameRoot), model, context, parts },
      { indexDir: path.join(stateDir, "weapon-models", "index"), ...tools },
    );
    throwIfCancelled(tools.signal);
    const files = [];
    for (const item of await extractLocatedFiles(located, work, path.resolve(gameRoot), resolved))
      files.push({
        name: item.name,
        role: item.role,
        bytes: new Uint8Array(await fs.readFile(item.output)),
      });
    if (!files.some((file) => file.role === "model"))
      throw refusal("WEAPON_MODEL_MISSING", "Модели ствола нет в игре.");
    return files;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Модели обвесов из игры игрока байтами — для ствола пака (19.10.2026):
 * `parts` — `[{ bone, component }]`, ответ — `[{ name, role, bytes }]` в
 * ролях `part:<кость>:<роль>`. Ищутся тем же проходом архивов, что у ствола
 * `model` (обвесы DLC — в пакете ствола), но достаются только обвесы.
 */
export async function readGameAttachmentFiles({ gameRoot, model, parts = [], context = null }, stateDir, tools = {}) {
  const resolved = { ...defaultTools(), ...tools };
  if (!gameRoot || !path.isAbsolute(String(gameRoot)))
    throw refusal("WEAPON_SKIN_GAME", "Выберите папку GTA V Legacy.");
  if (!parts.length) return [];
  const root = path.resolve(gameRoot);
  const work = path.join(stateDir, "weapon-models", "work", randomUUID());
  try {
    const located = await locateGameWeaponModelFiles(
      { gameRoot: root, model, context, parts: parts.map((part) => ({ ...part, key: part.bone })) },
      { indexDir: path.join(stateDir, "weapon-models", "index"), ...tools },
    );
    const files = [];
    for (const item of await extractLocatedFiles(located.filter((entry) => entry.role.startsWith("part:")), work, root, resolved))
      files.push({ name: item.name, role: item.role, bytes: new Uint8Array(await fs.readFile(item.output)) });
    return files;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/*
 * Обвес кости для картинки плитки (21.10.2026): штатный обвес в выбор не
 * берут (`normalizeAttachments`), поэтому его кость и модель — отсюда.
 * `null` — такой кости или обвеса у ствола нет.
 */
function iconAttachment(weaponId, selection) {
  const [bone, id] = Object.entries(selection || {})[0] || [];
  const point = weaponAttachPoints(weaponId).find((item) => item.bone === bone);
  const component = point?.components.find((item) => item.id === String(id || "").trim().toUpperCase());
  return point && component ? { bone: point.bone, component, chosen: true, mode: point.mode } : null;
}

/*
 * Модель ствола из игры игрока — для раздела «Модели» и кадра витрины.
 *
 * В поставке Astral заводских моделей три десятка; остальные стволы игры —
 * револьвер MK2, двухзарядный, флотский и ещё сотня — лежат у человека в
 * игре. Модель, её текстуры и штатный магазин достаются оттуда же, где их
 * берёт скин, и собираются в glTF тем же сборщиком на JS, что модели
 * ганпаков (`@modovik/gunpack/game-weapon`): ствол — таким, каким его видно в
 * игре. Готовая модель кэшируется по игре: второй раз она открывается сразу.
 */
/* Идущие сборки моделей ствола: путь файла кэша → обещание `{ bytes, placed }`. */
const buildingModels = new Map();

export async function readGameWeaponModel(
  input,
  context,
  stateDir,
  tools = {},
) {
  const resolved = { ...defaultTools(), ...tools };
  const build = tools.buildGlb || buildGameWeaponGlb;
  const model = String(input?.model || "")
    .trim()
    .toLowerCase();
  if (!WEAPON_SKIN_MODEL.test(model) || !weaponByModel(model))
    throw refusal("WEAPON_MODEL", "Этот ствол Astral не знает.");
  const gameRoot = String(input?.gameRoot || "");
  if (!gameRoot || !path.isAbsolute(gameRoot))
    throw refusal("WEAPON_SKIN_GAME", "Выберите папку GTA V Legacy.");
  const cacheDir = path.join(
    stateDir,
    "weapon-models",
    createHash("sha256")
      .update(path.resolve(gameRoot).toLowerCase())
      .digest("hex")
      .slice(0, 16),
  );
  /* Обвесы (задача 6 ТЗ 17.10.2026): штатные — всегда (ствол MK2, прицел
     снайперки), выбранные — вместо штатных своей кости; у каждого набора
     свой файл кэша. */
  const weapon = weaponByModel(model);
  const chosen = normalizeAttachments(weapon.id, input?.attachments);
  /* Только выбранные обвесы, без ствола (19.10.2026): слой кадра для своей
     модели .glb. Ответ несёт ещё и `parts` — что встало на кости, а что нет
     (`skipped`: bone | read | absent): модель обвеса, которой нет в игре,
     молча не встаёт, и окну нужно сказать об этом словами. */
  /* Картинка одного обвеса для плитки (`icon`, 21.10.2026): сам обвес на своей
     кости, штатный — тоже, без ствола и без магазина. */
  const icon = input?.icon === true ? iconAttachment(weapon.id, input?.attachments) : null;
  if (input?.icon === true && !icon)
    throw refusal("WEAPON_ATTACHMENTS", "У этого ствола нет такого обвеса.");
  const onlyParts = input?.attachmentsOnly === true || Boolean(icon);
  if (onlyParts && !icon && !Object.keys(chosen).length)
    throw refusal("WEAPON_ATTACHMENTS", "Обвесы не выбраны.");
  /* «Вид из каталога» (`attachment-looks.js`): у выбранных обвесов модель — из мода, а не из игры. */
  const parts = icon
    ? [icon]
    : attachLooks(
        modelAttachments(weapon.id, chosen, {
          skipModel: gameWeaponFiles(model).magazine?.replace(/\.ydr$/, "") || null,
        }).filter((part) => !onlyParts || part.chosen),
        input?.looks,
      );
  const picked = icon ? { [icon.bone]: icon.component.id } : chosen;
  /* Кэш собранной модели — по выбору и по видам из каталога (мод и версия); без видов имя файла прежнее. */
  const looked = looksSignature(parts);
  const variant = Object.keys(picked).length
    ? `.${createHash("sha256")
        .update(JSON.stringify(looked ? { picked, looks: looked } : picked))
        .digest("hex")
        .slice(0, 12)}`
    : "";
  const cached = path.join(cacheDir, `${model}.${GAME_MODEL_REVISION}${onlyParts ? ".parts" : ""}${variant}.glb`);
  /* Отчёт слоя обвесов лежит рядом с моделью: из кэша он нужен так же, как с
     первой сборки. Нет одного из двух файлов — слой собирается заново. */
  const reportFile = cached.replace(/\.glb$/, ".json");
  /* Игра или клиент сервера запущены — фоновая сборка им не помеха: прогрев пропускается, ответ без чтения (`weapon-warm-guard.js`). */
  if (input?.warm) {
    const blocker = await (tools.warmBlockedBy || warmBlockedBy)();
    if (blocker) return { model, warm: false, skipped: blocker };
  }
  /* Прогрев (03.11.2026): `warm: "index"` — только опись архивов этого ствола (первое чтение ствола после установки: ~5 с на 32 архива, потом опись на диске и в памяти), `warm: true` —
     ещё и модель в кэш на диске, без байтов в ответе. Окно просит их в простое, пока человек выбирает редактор. */
  if (input?.warm === "index") {
    await locateGameWeaponModelFiles({ gameRoot: path.resolve(gameRoot), model, context, parts }, { indexDir: path.join(stateDir, "weapon-models", "index"), ...tools });
    return { model, warm: "index" };
  }
  /* Контур сбоку (`outline`, 21.10.2026) — схеме «Обвесов»: ствол со
     штатными обвесами, без картинок, счёт в потоке. Лежит рядом с моделью,
     ответ — без байтов модели. Нет контура этой версии — файлы ствола
     читаются заново (один раз на ствол). */
  if (input?.outline === true && !onlyParts) {
    const outlineFile = cached.replace(/\.glb$/, ".outline.json");
    const known = await fs.readFile(outlineFile, "utf8").then((text) => JSON.parse(text)).catch(() => null);
    if (known?.version === WEAPON_OUTLINE_VERSION) return { model, outline: known };
    const files = await readGameWeaponFiles({ gameRoot, model, context, parts }, stateDir, resolved);
    const outline = await (tools.buildOutline || buildGameWeaponOutline)(files, gameParts(files, parts));
    if (outline) await atomicWrite(outlineFile, JSON.stringify(outline));
    return { model, outline: outline || null };
  }
  let bytes = await fs.readFile(cached).catch(() => null);
  let placed = null;
  if (bytes && onlyParts) {
    placed = await fs.readFile(reportFile, "utf8").then((text) => JSON.parse(text)).catch(() => null);
    if (!Array.isArray(placed)) {
      bytes = null;
      placed = null;
    }
  }
  if (!bytes) {
    /* Одна сборка на файл кэша (02.11.2026): окно просит тот же ствол разом дважды — модель кадра и плитка «Моделей» (стенд `gun-pick.mjs`: две холодные
       сборки боевой винтовки по 0,6–4,5 с одновременно). Второй ждёт первую, а не собирает ту же модель рядом. */
    if (!buildingModels.has(cached))
      buildingModels.set(
        cached,
        (async () => {
          const files = await readGameWeaponFiles({ gameRoot, model, context, parts }, stateDir, resolved);
          const found = gameParts(files, parts);
          const built = await build(files, model, { parts: found, ...(onlyParts ? { onlyParts: true } : {}) });
          const fresh = Buffer.from(built.bytes);
          let report = null;
          if (onlyParts) {
            const known = new Set((built.parts || []).map((item) => item.bone));
            report = [
              ...(built.parts || []).map(({ bone, component, model: partModel, skipped }) => ({
                bone,
                component,
                model: partModel,
                ...(skipped ? { skipped } : {}),
              })),
              ...parts
                .filter((part) => !known.has(part.bone))
                .map((part) => ({ bone: part.bone, component: part.component.id, model: part.component.model, skipped: "absent" })),
            ];
            await atomicWrite(reportFile, JSON.stringify(report));
          }
          await atomicWrite(cached, fresh);
          /* Модели прежних сборок (белая без магазина, с надписями) не нужны. */
          await fs.rm(path.join(cacheDir, `${model}.glb`), { force: true });
          for (const stale of STALE_MODEL_REVISIONS)
            await fs.rm(path.join(cacheDir, `${model}.${stale}.glb`), { force: true });
          return { bytes: fresh, placed: report };
        })().finally(() => buildingModels.delete(cached)),
      );
    const done = await buildingModels.get(cached);
    bytes = done.bytes;
    if (onlyParts) placed = done.placed;
  }
  if (bytes.length > MAX_MODEL_BYTES)
    throw refusal("WEAPON_MODEL_LARGE", "Модель слишком велика для редактора.");
  if (input?.warm === true) return { model, warm: true, size: bytes.length };
  return {
    model,
    size: bytes.length,
    bytes: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
    ...(onlyParts ? { parts: placed } : {}),
  };
}
