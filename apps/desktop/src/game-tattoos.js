/*
 * Тату самой игры (ТЗ 04.10.2026, задача 10) — на что ставится рисунок с
 * тела в «Замене».
 *
 * Тату — наложение педа: место в XML коллекции
 * (`common/data/effects/peds/<пак>_overlays.xml`: зона, `uvPos`, `scale`,
 * `rotation`) и картинка `<txd>.ytd` в архиве `<пак>_ped_mp_overlay_txds.rpf`.
 * Продаются они в салонах: `common/data/shop_tattoo.meta` даёт ярлык
 * названия (`TAT_BI_005` → «Сделано в Америке»), сторону тела и цену.
 *
 * Где что лежит (разобрано по игре игрока 04.10):
 * - базовые тату GTA Online — `update.rpf/common/data/effects/peds/
 *   multiplayer_overlays.xml`, картинки — `x64v.rpf/models/cdimages/
 *   ped_mp_overlay_txds.rpf` (патчи — в patchday1ng/4ng);
 * - дополнения — в своих `dlc*.rpf`; у новых (mpheist4, mpsecurity) пак
 *   разбит на `dlc.rpf`, `dlc1.rpf`, `dlc2.rpf`, и картинки бывают не в
 *   первом; XML и магазин правит `update.rpf/dlc_patch/<пак>/…`;
 * - первые дополнения (пляж, бизнес, хипстеры, День независимости, лётная
 *   школа, День святого Валентина — mpbeach…mpvalentines) лежат в самой игре:
 *   `x64w.rpf/dlcpacks/<пак>/dlc.rpf` (разобрано 07.10 — «Замена» их не
 *   видела). Их картинки и коллекции читаются цепочкой вложенных архивов.
 *
 * Оглавление собирается один раз на версию игры (отпечаток файлов) и
 * лежит в кэше. Только чтение: файлы игры не меняются.
 *
 * Место тату (ТЗ 06.10.2026, вечер, задача 3) — штатное: update.rpf
 * читается из основы движка (`compositionBase` — архив игрока без слоёв
 * Astral), а не живой. Работа мастерской переносит тату под рисунок,
 * правя его коллекцию в update.rpf, — без основы следующая работа приняла
 * бы чужое новое место за место игры. У каждого тату — где лежит его
 * коллекция (`xml`: архив и запись) и какую запись update.rpf правит
 * перенос (`patch`; `exists: false` — правки дополнения у игрока ещё нет,
 * она добавляется), и цена в салоне (`cost`).
 */

import { ensureStoredFile } from "@modovik/install-engine/chunk-store.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { keysFromDirectory, openRpfFile, inflateRawNode } from "@modovik/rpf7/node";
import {
  parseDecorationCollection,
  tattoosOf,
} from "@modovik/clothing/decorations";
import { parseGxt2 } from "@modovik/clothing/gxt2";
import { FACIAL_FRAME, facialName, facialTitle, parseFacialOverlays } from "@modovik/clothing/facial-overlays";
import { decodeTextureRef, readTextureDictionary } from "@modovik/rage-drawable";
import sharp from "sharp";
import {
  downloadSignedPackage,
  inspectProfile,
  tattooPlaceEntryAllowed,
} from "@modovik/install-engine";
import { GAME_LANGUAGE_FILES, GAME_NAME_LANGUAGES, cleanGameNames } from "@modovik/clothing/game-names";
import { collectionTitle } from "./game-clothing-index.js";

/* 6 — названия тату на языках игры (`titles`: ru, en, de, fr, pl) и вид с номером для запасного названия (`kind`, `number`), 17.11.2026. */
/* 4 — в оглавлении и женские тату игры, у записи есть `gender` (ТЗ 30.10.2026). 5 — и настоящий грим игры (`facial`, 01.11.2026). */
export const TATTOO_INDEX_VERSION = 6;

const refusal = (code, message) => Object.assign(new Error(message), { code });

const OVERLAY_XML = /^common\/data\/effects\/peds\/([^/]+_overlays)\.xml$/i;
const PATCH_XML =
  /^dlc_patch\/([^/]+)\/common\/data\/effects\/peds\/([^/]+_overlays)\.xml$/i;
const PATCH_SHOP = /^dlc_patch\/([^/]+)\/common\/data\/shop_tattoo\.meta$/i;
const TXD_ARCHIVE = /(^|\/)[^/]*ped_mp_overlay_txds\.rpf$/i;
const BASE_XML = "common/data/effects/peds/multiplayer_overlays.xml";
const FACIAL_META = "common/data/effects/peds/facial_overlays.meta";
const UPDATE_ARCHIVE = "update/update.rpf";

const samePath = (left, right) =>
  Boolean(left && right) &&
  path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

/**
 * Основа update.rpf — копия движка без слоёв Astral (`compositionBase`),
 * пока Astral этот архив не собирал — живой файл. Состояние не читается —
 * тоже живой: это и есть игра без Astral.
 */
export async function stockUpdateArchive({ gameRoot, stateDir, readState = inspectProfile }) {
  const live = path.join(gameRoot, "update", "update.rpf");
  try {
    const state = await readState({ stateDir });
    const target = Object.values(state?.targets || {}).find((item) =>
      samePath(item?.gameRoot, gameRoot),
    );
    const base = target?.resources?.[UPDATE_ARCHIVE]?.compositionBase;
    if (base?.exists && base.path && (await ensureStoredFile(base.path)) && (await fs.stat(base.path).catch(() => null))?.isFile())
      return base.path;
  } catch {
    /* профиль ещё не заведён */
  }
  return live;
}

/* Какую запись update.rpf правит перенос тату этой коллекции. */
const placeEntry = (entry) => {
  const value = String(entry || "").toLowerCase();
  return tattooPlaceEntryAllowed(value) ? value : null;
};

/* Стороны тела из магазина — подписью у строки. */
const FACINGS = Object.freeze({
  TATTOO_FRONT: "спереди",
  TATTOO_BACK: "сзади",
  TATTOO_LEFT: "слева",
  TATTOO_RIGHT: "справа",
  TATTOO_FRONT_LEFT: "спереди слева",
  TATTOO_BACK_LEFT: "сзади слева",
  TATTOO_FRONT_RIGHT: "спереди справа",
  TATTOO_BACK_RIGHT: "сзади справа",
});

/**
 * Файлы игры для оглавления тату — подменяются в тестах. `updatePath` —
 * какой update.rpf читать (`stockUpdateArchive`); `openArchive("update")`
 * — он же, иначе архив по пути от папки игры.
 */
export function tattooGameFiles(gameRoot, keys, { updatePath = null } = {}) {
  const packs = path.join(gameRoot, "update", "x64", "dlcpacks");
  const update = updatePath || path.join(gameRoot, "update", "update.rpf");
  const open = (file) => openRpfFile(file, { keys, nested: false });
  return {
    gameRoot,
    async fingerprint() {
      const parts = [];
      const stat = async (file) => {
        const info = await fs.stat(file).catch(() => null);
        return info ? `${info.size}:${Math.floor(info.mtimeMs)}` : "-";
      };
      parts.push(`update:${path.resolve(update).toLowerCase()}:${await stat(update)}`);
      parts.push(`base:${await stat(path.join(gameRoot, BASE_PACKS))}`);
      for (const pack of await this.listPacks())
        for (const file of pack.files)
          parts.push(`${pack.name}/${file}:${await stat(path.join(packs, pack.name, file))}`);
      return createHash("sha256").update(parts.join("|")).digest("hex");
    },
    openUpdate: () => open(update),
    openBase: () => open(path.join(gameRoot, "x64v.rpf")),
    openArchive: (label) => open(label === "update" ? update : path.join(gameRoot, label)),
    async listPacks() {
      const entries = await fs.readdir(packs, { withFileTypes: true }).catch(() => []);
      const out = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const files = (await fs.readdir(path.join(packs, entry.name)).catch(() => []))
          .filter((name) => /^dlc\d*\.rpf$/i.test(name))
          .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
        if (files.length) out.push({ name: entry.name, files });
      }
      /* Первые дополнения — внутри `x64w.rpf`; пак с тем же именем в
         update/x64/dlcpacks главнее. */
      const known = new Set(out.map((pack) => pack.name.toLowerCase()));
      const inner = await open(path.join(gameRoot, BASE_PACKS)).catch(() => null);
      if (inner) {
        try {
          const nested = new Map();
          for (const entry of inner.entries) {
            const match = /^dlcpacks\/([^/]+)\/(dlc\d*\.rpf)$/i.exec(entry.path);
            if (!match || known.has(match[1].toLowerCase())) continue;
            if (!nested.has(match[1])) nested.set(match[1], []);
            nested.get(match[1]).push(match[2]);
          }
          for (const [name, files] of nested)
            out.push({ name, files: files.sort((left, right) => left.localeCompare(right, "en", { numeric: true })), within: BASE_PACKS });
        } finally {
          await inner.close?.();
        }
      }
      return out.sort((left, right) => left.name.localeCompare(right.name));
    },
    /* Пак внутри архива игры — видом без приставки: пути внутри него те же,
       что у пака в update/x64/dlcpacks. */
    async openPackFile(pack, file, within = null) {
      if (!within) return open(path.join(packs, pack, file));
      const outer = await open(path.join(gameRoot, within));
      try {
        const step = `dlcpacks/${pack}/${file}`;
        return packView(await outer.open(step), outer, [step]);
      } catch (error) {
        await outer.close?.();
        throw error;
      }
    },
  };
}

const BASE_PACKS = "x64w.rpf";

/* Вложенный пак без приставки пути: `chain` — как его открыть от архива
   игры, `prefix` — приставка записей внутри. */
function packView(archive, outer, chain) {
  const prefix = `${chain.at(-1)}/`.toLowerCase();
  return {
    chain,
    prefix,
    entries: archive.entries
      .filter((entry) => entry.path.toLowerCase().startsWith(prefix))
      .map((entry) => ({ ...entry, path: entry.path.slice(prefix.length) })),
    read: (entry) => archive.read(prefix + entry),
    open: (entry) => archive.open(prefix + entry),
    close: () => outer.close?.(),
  };
}

const textOf = (bytes) => new TextDecoder().decode(bytes);

/* Магазин тату: пресет → ярлык, сторона, группа места, цена. */
export function parseTattooShop(text) {
  const items = new Map();
  for (const [, block] of String(text || "").matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
    const tag = (name) =>
      new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`).exec(block)?.[1] || "";
    const preset = tag("preset");
    if (!preset) continue;
    items.set(preset.toLowerCase(), {
      label: tag("textLabel"),
      facing: tag("eFacing"),
      group: tag("updateGroup"),
      cost: Number(/<cost\s+value="(\d+)"/.exec(block)?.[1]) || 0,
    });
  }
  return items;
}

const NO_TEXT = Object.freeze({ get: () => "" });

async function languageOf(archive, name) {
  try {
    const child = await archive.open(`x64/data/lang/${name}dlc.rpf`);
    /* Записи вложенного архива — с путём родителя: ищем по имени. */
    const table = child.entries.find((entry) => /(^|\/)global\.gxt2$/i.test(entry.path));
    return table ? parseGxt2(await child.read(table.path)) : NO_TEXT;
  } catch {
    return NO_TEXT;
  }
}

async function baseLanguage(update, name) {
  if (!update) return NO_TEXT;
  try {
    const file = `x64/patch/data/lang/${name}_rel.rpf`;
    const child = await update.open(file);
    return parseGxt2(await child.read(`${file}/global.gxt2`));
  } catch {
    return NO_TEXT;
  }
}

/* Таблицы всех пяти языков игры (код языка Astral → таблица): общие строки заплатки `update.rpf` и таблица дополнения. */
const NO_TEXTS = Object.freeze(Object.fromEntries(GAME_NAME_LANGUAGES.map((language) => [language, NO_TEXT])));

async function baseLanguages(update) {
  const out = {};
  for (const language of GAME_NAME_LANGUAGES) out[language] = await baseLanguage(update, GAME_LANGUAGE_FILES[language]);
  return out;
}

async function packLanguages(archive) {
  const out = {};
  for (const language of GAME_NAME_LANGUAGES) out[language] = await languageOf(archive, GAME_LANGUAGE_FILES[language]);
  return out;
}

async function laterPackLanguages(io, pack) {
  for (const file of pack.files) {
    let archive;
    try {
      archive = await io.openPackFile(pack.name, file, pack.within || null);
    } catch {
      continue;
    }
    try {
      const texts = await packLanguages(archive);
      if (hasTexts(texts)) return texts;
    } finally {
      await archive.close?.();
    }
  }
  return NO_TEXTS;
}

const hasTexts = (texts) => GAME_NAME_LANGUAGES.some((language) => texts[language] !== NO_TEXT);

/* «???» у игры — заглушка, а не имя. */
const named = (text) => (text && !/^[?\s]+$/.test(text) ? text : "");

/* Картинки тату архива: имя `.ytd` → где он. Позднее перекрывает раннее. */
async function indexTextures(archive, label, into) {
  for (const entry of archive.entries) {
    if (!TXD_ARCHIVE.test(entry.path)) continue;
    let child;
    try {
      child = await archive.open(entry.path);
    } catch {
      continue;
    }
    /* Пак внутри архива игры — цепочкой: пак, затем архив картинок. */
    const inner = archive.chain ? [...archive.chain, archive.prefix + entry.path] : entry.path;
    for (const file of child.entries) {
      if (!/\.ytd$/i.test(file.path)) continue;
      const name = file.path.slice(file.path.lastIndexOf("/") + 1, -4).toLowerCase();
      into.set(name, { file: label, inner, entry: file.path });
    }
  }
}

/* «MP_MP_Biker_Tat_005_M» без ярлыка — «Тату №5 · Байкеры»; базовые
   «FM_Tat_Award_M_000» — «Награда №0 · GTA Online». */
function fallbackName(name, title) {
  const digits = /(\d{1,3})(?!.*\d)/.exec(name)?.[1];
  const kind = /award/i.test(name) ? "award" : "tattoo";
  const word = kind === "award" ? "Награда" : "Тату";
  if (!digits) return { title: `${name} · ${title}`, kind, number: null };
  const number = Number(digits);
  return { title: `${word} №${number} · ${title}`, kind, number };
}

/**
 * Собирает оглавление тату мужского персонажа. `io` — `tattooGameFiles`
 * или его подмена; `onProgress({ done, total, pack })`.
 */
export async function buildGameTattoos({ io, onProgress } = {}) {
  const update = await io.openUpdate().catch(() => null);
  const patchedXml = new Map();
  const patchedShop = new Map();
  if (update) {
    for (const entry of update.entries) {
      const xml = PATCH_XML.exec(entry.path);
      const shop = PATCH_SHOP.exec(entry.path);
      if (!xml && !shop) continue;
      const bytes = await update.read(entry.path).catch(() => null);
      if (!bytes) continue;
      if (xml)
        patchedXml.set(xml[1].toLowerCase(), {
          name: xml[2],
          text: textOf(bytes),
          xml: { file: "update", entry: entry.path, patch: placeEntry(entry.path), exists: true },
        });
      else patchedShop.set(shop[1].toLowerCase(), textOf(bytes));
    }
  }
  const baseTexts = await baseLanguages(update);
  const textures = new Map();
  const base = await io.openBase().catch(() => null);
  if (base) await indexTextures(base, "x64v.rpf", textures);
  await base?.close?.();

  const collections = [];
  if (update) {
    const xml = await update.read(BASE_XML).catch(() => null);
    if (xml)
      collections.push({
        pack: "base",
        collection: "multiplayer_overlays",
        title: "GTA Online",
        text: textOf(xml),
        shop: new Map(),
        texts: baseTexts,
        xml: { file: "update", entry: BASE_XML, patch: BASE_XML, exists: true },
      });
  }
  const facialMeta = update ? await update.read(FACIAL_META).catch(() => null) : null;
  await update?.close?.();

  const packs = await io.listPacks();
  let done = 0;
  for (const pack of packs) {
    onProgress?.({ done, total: packs.length, pack: pack.name });
    done += 1;
    let xml = null;
    let shopText = patchedShop.get(pack.name.toLowerCase()) || "";
    let texts = NO_TEXTS;
    for (const file of pack.files) {
      let archive;
      try {
        archive = await io.openPackFile(pack.name, file, pack.within || null);
      } catch {
        continue;
      }
      try {
        const label = pack.within || `update/x64/dlcpacks/${pack.name}/${file}`;
        await indexTextures(archive, label, textures);
        for (const entry of archive.entries) {
          const match = OVERLAY_XML.exec(entry.path);
          if (match && !xml) {
            const bytes = await archive.read(entry.path).catch(() => null);
            /* Своей правки в update.rpf у дополнения нет: перенос добавит её
               тем же путём, каким игра сама правит коллекции дополнений. */
            if (bytes)
              xml = {
                name: match[1],
                text: textOf(bytes),
                xml: {
                  file: label,
                  ...(archive.chain ? { chain: archive.chain } : {}),
                  entry: (archive.prefix || "") + entry.path,
                  patch: placeEntry(`dlc_patch/${pack.name}/${entry.path}`),
                  exists: false,
                },
              };
          }
          if (!shopText && /^common\/data\/shop_tattoo\.meta$/i.test(entry.path)) {
            const bytes = await archive.read(entry.path).catch(() => null);
            if (bytes) shopText = textOf(bytes);
          }
        }
        /* Таблицы языков нужны только пакам с магазином тату: названия идут по ярлыкам магазина (замер 17.11.2026: пять языков у всех 95 паков — +300 мс сборки). */
        if (shopText && !hasTexts(texts)) texts = await packLanguages(archive);
      } finally {
        await archive.close?.();
      }
    }
    /* Магазин нашёлся в более позднем файле пака, чем таблицы языков, — их ищем теперь (редкий путь). */
    if (shopText && !hasTexts(texts)) texts = await laterPackLanguages(io, pack);
    const patched = patchedXml.get(pack.name.toLowerCase());
    if (patched) xml = patched;
    if (!xml) continue;
    collections.push({
      pack: pack.name,
      collection: xml.name,
      title: collectionTitle(pack.name),
      text: xml.text,
      shop: parseTattooShop(shopText),
      texts,
      xml: xml.xml,
    });
  }

  /* Базовый магазин тату живёт в данных игры, а не в дополнениях: его
     ярлыки ищутся по имени пресета в общих таблицах. */
  const tattoos = [];
  const seen = new Set();
  for (const source of collections) {
    for (const tattoo of tattoosOf(parseDecorationCollection(source.text))) {
      /* «Причёски» — наложения стрижек, а не тату салона. */
      if (/_hair_/i.test(tattoo.name)) continue;
      const key = `${source.collection}:${tattoo.name}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const place = textures.get(String(tattoo.txd || "").toLowerCase());
      if (!place) continue;
      const shop = source.shop.get(String(tattoo.name).toLowerCase()) || null;
      const label = shop?.label || "";
      /* Название на каждом языке игры: таблица дополнения, затем общие строки. Нет строки на языке — этого языка здесь нет (окно возьмёт английское по цепочке языка, `game-names.js`). */
      const titles = label
        ? cleanGameNames(Object.fromEntries(GAME_NAME_LANGUAGES.map((language) => [language, named(source.texts[language].get(label) || baseTexts[language].get(label))])))
        : null;
      const own = fallbackName(tattoo.name, source.title);
      /* `title` — как было: русское название, затем английское, затем запасное по виду и номеру. Вид и номер отдельно — окно называет безымянное тату на своём языке. */
      const title = titles?.ru || titles?.en || own.title;
      tattoos.push({
        key,
        pack: source.pack,
        collection: source.collection,
        collectionTitle: source.title,
        name: tattoo.name,
        title,
        /* Строки игры по языкам и вид с номером для запасного названия — только то, чего нет в `title`: у названного тату номер не нужен, у безымянного нет строк. */
        ...(titles ? { titles } : {}),
        ...(!titles && own.number !== null ? { kind: own.kind, number: own.number } : {}),
        txd: tattoo.txd,
        texture: tattoo.texture || tattoo.txd,
        zone: tattoo.zone,
        /* Пол тела, на которое тату набивается: `male`, `female` или `null` — игра не делит (обоим). */
        gender: tattoo.gender || null,
        uv: tattoo.uv,
        scale: tattoo.scale,
        rotation: tattoo.rotation,
        facing: FACINGS[shop?.facing] || "",
        group: shop?.group || "",
        sold: Boolean(shop),
        cost: shop?.cost || 0,
        place,
        xml: source.xml || null,
      });
    }
  }
  /* Настоящий грим игры (`facial-overlays.js`): наложения головы из данных персонажа. Рамка — вся зона, цены и коллекции нет (его ставит цирюльник). Пол игра не делит. */
  for (const { name, group } of facialMeta ? parseFacialOverlays(textOf(facialMeta)) : []) {
    const place = textures.get(name);
    if (!place) continue;
    const facial = { group, ...facialName(name, group) };
    tattoos.push({
      key: `facial_overlays:${name}`,
      pack: "facial",
      collection: "facial_overlays",
      collectionTitle: "Грим персонажа",
      name,
      title: facialTitle(facial),
      txd: name,
      texture: name,
      zone: "head",
      gender: null,
      ...FACIAL_FRAME,
      facing: "",
      group: "",
      sold: false,
      cost: 0,
      place,
      xml: null,
      facial,
    });
  }
  return { version: TATTOO_INDEX_VERSION, builtAt: Date.now(), tattoos };
}

const hashOf = (value) =>
  createHash("sha256").update(String(value).toLowerCase()).digest("hex").slice(0, 16);

/*
 * Оглавление тату в памяти процесса (15.11.2026, жалоба владельца: вход в «Тело · татуировки» стоял на «Читаю вещь из игры» 13+ с): окно просит картинки всех видимых плиток разом (30–60), и каждая
 * просила оглавление: сверка отпечатка игры (открыть `x64w.rpf`, пройти паки дополнений, сотня `stat`) и разбор файла кэша в несколько мегабайт — в главном процессе Electron, у каждой плитки заново,
 * пока диск занят чужой записью. Теперь одновременные просьбы ждут одну сверку, а готовое оглавление держится несколько секунд: игра за это время не меняется (Astral пишет в архивы игры только
 * по нажатию «Применить», а оглавление строится по штатной основе `update.rpf`).
 */
const TATTOO_MEMO_MS = 8000;
const tattooMemo = new Map();

/** Для тестов: забыть оглавление в памяти. */
export const forgetGameTattoosMemo = () => tattooMemo.clear();

/** Оглавление тату из кэша или собранное заново: один файл на игру. */
export async function readGameTattoos(args, options = {}) {
  /* Подмена файлов игры (`io`, тесты) и пересборка идут мимо памяти. */
  if (args?.io || options.refresh || !args?.gameRoot || !args?.stateDir) return readGameTattoosFromFiles(args, options);
  const key = `${path.resolve(String(args.stateDir)).toLowerCase()}|${hashOf(args.gameRoot)}`;
  const known = tattooMemo.get(key);
  if (known && (known.pending || Date.now() - known.at < TATTOO_MEMO_MS)) return known.value;
  const record = { at: Date.now(), pending: true, value: null };
  record.value = readGameTattoosFromFiles(args, options).then(
    (index) => {
      record.pending = false;
      record.at = Date.now();
      return index;
    },
    (error) => {
      if (tattooMemo.get(key) === record) tattooMemo.delete(key);
      throw error;
    },
  );
  tattooMemo.set(key, record);
  return record.value;
}

async function readGameTattoosFromFiles(
  { gameRoot, stateDir, keysDirectory, io = null, onProgress = null, readState },
  { refresh = false } = {},
) {
  if (!gameRoot || (!io && !path.isAbsolute(gameRoot)))
    throw refusal("TATTOO_GAME", "Выберите папку GTA V Legacy.");
  const files =
    io ||
    tattooGameFiles(gameRoot, keysDirectory ? await keysFromDirectory(keysDirectory) : null, {
      updatePath: await stockUpdateArchive({ gameRoot, stateDir, readState }),
    });
  const fingerprint = await files.fingerprint();
  const cache = path.join(stateDir, "clothing-index", `tattoos-${hashOf(gameRoot)}.json`);
  if (!refresh) {
    const stored = await fs
      .readFile(cache, "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => null);
    if (stored?.version === TATTOO_INDEX_VERSION && stored.fingerprint === fingerprint)
      return stored;
  }
  const index = await buildGameTattoos({ io: files, onProgress });
  /* Пустое оглавление — не игра без тату, а папка не та или архивы заняты:
     в кэш оно не идёт, иначе «Замена» оставалась бы пустой до смены игры. */
  if (!index.tattoos.length)
    throw refusal(
      "TATTOO_GAME",
      "Тату игры не прочитались: в этой папке нет архивов GTA V с тату (папка не та или архивы заняты).",
    );
  index.fingerprint = fingerprint;
  await fs.mkdir(path.dirname(cache), { recursive: true });
  const temporary = `${cache}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(index));
  await fs.rename(temporary, cache);
  return index;
}

/**
 * Тату игры для обложек разбора (29.10.2026, `ref/28`): `[{ txd, zone, uv, scale, rotation, … }]` — где игра ставит каждое. Оглавление строится во временной папке,
 * кэш приложения не трогается; `update.rpf` читается как есть (основы Astral у разбора нет). Только чтение игры.
 */
export async function readTattooPlaces({ gameRoot, keysDirectory }) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "astral-tattoo-index-"));
  try {
    const index = await readGameTattoos({ gameRoot, stateDir, keysDirectory, readState: async () => null }, { refresh: true });
    return index.tattoos;
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Текст коллекции тату — штатный, из того же архива, откуда его взяло
 * оглавление (`tattoo.xml`): основа update.rpf или файл дополнения.
 */
export async function readTattooCollection({ gameRoot, stateDir, keysDirectory, tattoo, io = null, readState }) {
  const source = tattoo?.xml;
  if (!source?.file || !source.entry) throw refusal("TATTOO_PLACE", "Коллекции этого тату в игре нет.");
  const files =
    io ||
    tattooGameFiles(gameRoot, keysDirectory ? await keysFromDirectory(keysDirectory) : null, {
      updatePath: await stockUpdateArchive({ gameRoot, stateDir, readState }),
    });
  const archive = await files.openArchive(source.file);
  try {
    let inner = archive;
    for (const step of source.chain || []) inner = await inner.open(step);
    return textOf(await inner.read(source.entry));
  } finally {
    await archive.close?.();
  }
}

/** Байты `.ytd` тату из архивов игры. */
export async function readTattooYtd({ gameRoot, keysDirectory, tattoo, io = null }) {
  const place = tattoo?.place;
  if (!place?.file || !place.inner || !place.entry)
    throw refusal("TATTOO_PLACE", "Картинки этого тату в игре нет.");
  const keys = keysDirectory ? await keysFromDirectory(keysDirectory) : null;
  const outer = io
    ? await io.openFile(place.file)
    : await openRpfFile(path.join(gameRoot, place.file), { keys, nested: false });
  try {
    let child = outer;
    for (const step of Array.isArray(place.inner) ? place.inner : [place.inner]) child = await child.open(step);
    return Buffer.from(await child.read(place.entry));
  } finally {
    await outer.close?.();
  }
}

/** Картинка тату из `.ytd`: RGBA нужной текстуры (по `txtHash`) или единственной. */
export function tattooPicture(bytes, texture, { maxSize = 0 } = {}) {
  const dictionary = readTextureDictionary(bytes, { inflateRaw: inflateRawNode });
  const wanted = String(texture || "").toLowerCase();
  const ref =
    dictionary.find((entry) => entry.name.toLowerCase() === wanted && entry.format) ||
    dictionary.find((entry) => entry.format) ||
    null;
  if (!ref) throw refusal("TATTOO_TEXTURE", "В картинке тату нет читаемой текстуры.");
  /* `full` — размер исходной текстуры: в него и печётся замена. */
  return {
    name: ref.name,
    full: { width: ref.width, height: ref.height },
    ...decodeTextureRef(ref, maxSize ? { maxSize } : {}),
  };
}

const PICTURE_SIDE = 160;
const FULL_SIDE = 1024;

const arrayBufferOf = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

/**
 * Картинка тату для плитки «Замены» — PNG до 160 px на светлой коже не
 * подкладывается: прозрачность рисунка остаётся. `full` — картинка целиком
 * (до 1024 px): «Взять рисунок» кладёт её слоем на тело (задача 3 ТЗ
 * 06.10.2026, вечер). Кэш — по игре и тату.
 */
export async function readGameTattooPicture(input, { stateDir, keysDirectory }) {
  const gameRoot = String(input?.gameRoot || "");
  const key = String(input?.key || "").toLowerCase();
  const full = input?.full === true;
  if (!gameRoot || !key) throw refusal("TATTOO_PICTURE", "Не названо тату.");
  const cache = path.join(
    stateDir,
    "clothing-index",
    "tattoo-pictures",
    hashOf(gameRoot),
    `${hashOf(key)}${full ? "-full" : ""}.png`,
  );
  let bytes = await fs.readFile(cache).catch(() => null);
  if (!bytes) {
    const index = await readGameTattoos({ gameRoot, stateDir, keysDirectory });
    const tattoo = index.tattoos.find((entry) => entry.key === key);
    if (!tattoo) throw refusal("TATTOO_PICTURE", "Такого тату в игре нет.");
    const picture = tattooPicture(
      await readTattooYtd({ gameRoot, keysDirectory, tattoo }),
      tattoo.texture,
      { maxSize: full ? FULL_SIDE : 256 },
    );
    const image = sharp(Buffer.from(picture.rgba), {
      raw: { width: picture.width, height: picture.height, channels: 4 },
    });
    bytes = await (full ? image : image.resize(PICTURE_SIDE, PICTURE_SIDE, { fit: "inside" }))
      .png()
      .toBuffer();
    await fs.mkdir(path.dirname(cache), { recursive: true });
    await fs.writeFile(cache, bytes);
  }
  return { key, bytes: arrayBufferOf(bytes) };
}

const CATALOG_TATTOO_ENTRY = /^astral_stream_00\.rpf\/([a-z0-9][a-z0-9_]{0,63})\.ytd$/i;
const CATALOG_TATTOO_LIMIT = 64;

/**
 * Картинки пака тату каталога (Т-101) — «Взять рисунок» (задача 3 ТЗ
 * 06.10.2026, вечер): тату каталога правится, как своё. Пакет качается
 * доверенным путём каталога (подпись сверяется), картинка каждого словаря
 * `<txd>.ytd` — PNG до 1024 px. Чьё это тату, окно узнаёт по `txd` из
 * оглавления тату игры.
 */
export async function readCatalogTattooPictures(input, context, deps) {
  const manifest = input?.manifest;
  const id = String(manifest?.id || "");
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(id) || !manifest?.version)
    throw refusal("TATTOO_CATALOG", "У тату каталога нет пакета.");
  const downloaded = await (deps.download || downloadSignedPackage)({
    manifest,
    baseUrl: String(input?.baseUrl || ""),
    publicKey: deps.publicKey,
    stateDir: deps.stateDir,
    downloadsDir: deps.downloadsDir || null,
    allowInsecureLocalhost: Boolean(deps.allowInsecureLocalhost),
    allowedHosts: deps.allowedHosts ?? null,
    onProgress: context?.onProgress || null,
  });
  const root = path.resolve(downloaded.packageRoot);
  const pictures = [];
  for (const file of downloaded?.manifest?.files || manifest.files || []) {
    if (pictures.length >= CATALOG_TATTOO_LIMIT) break;
    const txd = CATALOG_TATTOO_ENTRY.exec(String(file?.entry || ""))?.[1]?.toLowerCase();
    if (!txd || !file.source || file.action === "delete") continue;
    const source = path.resolve(root, file.source);
    if (!source.startsWith(root + path.sep)) continue;
    try {
      const picture = tattooPicture(await fs.readFile(source), txd, { maxSize: FULL_SIDE });
      const bytes = await sharp(Buffer.from(picture.rgba), {
        raw: { width: picture.width, height: picture.height, channels: 4 },
      })
        .png()
        .toBuffer();
      pictures.push({ txd, width: picture.width, height: picture.height, bytes: arrayBufferOf(bytes) });
    } catch {
      /* непрочитанный словарь — без этой картинки */
    }
  }
  if (!pictures.length)
    throw refusal("TATTOO_CATALOG", "В паке нет читаемых картинок тату.");
  return { id, pictures };
}
