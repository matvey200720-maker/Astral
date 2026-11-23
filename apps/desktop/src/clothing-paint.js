/*
 * Покраска одежды из мастерской — на вещь, которую выбрал человек.
 *
 * Раньше покраска ложилась только на ту же вещь игры, которую красили
 * («Верх №5» → `jbib_diff_005`), и только поверх текстуры. Но на RP-сервере
 * человек носит свою вещь — «Белую футболку с собакой» из Binco на Majestic,
 * — и видеть покраску хочет на ней. Поэтому «Применить» заканчивается
 * «На что поставить?», а здесь:
 *
 *  1. вещь-источник — модель и текстура цвета: вещь из игры игрока (из её
 *     архивов, как в «Виде») или вещь каталога (её подписанный пакет, тем же
 *     доверенным путём, что установка);
 *  2. покраска запекается в текстуру источника (`ytd-bake.js`) — тем же
 *     размером, форматом и числом mip, альфа заводская;
 *  3. модель и запечённая текстура ложатся под имена каждой выбранной вещи
 *     сервера — на все её цвета — пакетом замены (`clothing-replace.js`):
 *     тот же строгий локальный пакет, что у замененки каталога, и та же
 *     смена прежней замены на этой вещи.
 *
 * Пол и вид обязаны совпасть: мужскую вещь красят на мужскую цель, женскую —
 * на женскую (ТЗ 29.10.2026), а на штаны вместо футболки не поставить ни ту,
 * ни другую.
 *
 * Перенос на женскую пару (`transfer`, ТЗ 29.10.2026, п. 3): красили мужскую вещь,
 * а на цель сервера встаёт её женская пара — модель пары из игры и картинка,
 * перенесённая по 3D на её развёртку (`clothing-skin-transfer.js`). Источник
 * пакета тогда — женская вещь, и правило пола пропускает только женские цели.
 */

import { matchGloveForms } from "@modovik/clothing/glove-forms";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { randomUUID } from "node:crypto";
import { callNativeEngine } from "./native-engine.js";
import { inspectYtd, patchYtdTextures } from "./rpf-composer.js";
import {
  chooseGameTexture,
  clothingArchiveTools,
  clothingGameRoot,
  clothingSource,
  gameAlternateFiles,
  listGameClothing,
  placeOfItem,
  requestGender,
  slotOfComponent,
  textureByIndex,
  textureIndexOf,
  texturePlaceOf,
} from "./clothing-models.js";
import { armorMemberOf } from "@modovik/clothing/armor";
import { bakeYtd, normalizePaintedTextures } from "./ytd-bake.js";
/* Перенос скина считается по вызову: расчёт, подбор пар и разбор моделей (`clothing-skin-transfer.js`, `game-clothing-pairs.js`) — не в старте главного процесса (`main-startup-imports.test.js`). */
import { variantGender } from "@modovik/clothing/gender";
import { deflateRawAsync } from "./zlib-async.js";
import { withGameBodySkin } from "./clothing-body-skin.js";
import { routeOfTarget, serverOfTarget } from "./clothing-route.js";
import { parseAlternate } from "@modovik/clothing/model-variants";
import { normalizeModelOpacity, readDrawable } from "@modovik/rage-drawable";
import { pedAlphaShaders } from "@modovik/rage-drawable/ped-alpha";
import {
  installClothingReplacePackages,
  normalizeReplaceIds,
  normalizeReplaceTarget,
  clothingPackageForms,
  openClothingPackage,
  replaceNames,
  writeClothingReplacePackage,
} from "./clothing-replace.js";

const MAX_TARGETS = 64;
/* Источник пакета у покраски вещи из игры: мода каталога за ней нет. */
const GAME_SOURCE = "astral-paint";

const refusal = (code, message) => Object.assign(new Error(message), { code });

/** Номер расцветки вещи игры из источника запроса: `{ texture }` или ничего (лицо вещи). */
const gameTextureOf = (source) => {
  const texture = textureIndexOf(source?.texture);
  return texture === null ? {} : { texture };
};

const defaultTools = (stateDir) => ({
  ...clothingArchiveTools(stateDir),
  inspectYtd,
  patchYtd: patchYtdTextures,
  readTextures: (input, output, context) =>
    callNativeEngine("extract-textures", { input, output }, context),
});

/* `jbib_005_u.ydd` → «u»; `jbib_diff_005_a_uni.ytd` → «uni». */
const suffixOf = (model) => /_([ur])\.ydd$/i.exec(model || "")?.[1] || null;
const raceOf = (texture) =>
  /_diff_\d{3}_[a-z]_([a-z]{3})\.ytd$/i.exec(texture || "")?.[1] || null;

/** Проверяет запрос окна: источник, вещи сервера, развёртки, папка игры. */
const serverIdOf = (value) => (/^[a-z0-9_-]{1,32}$/.test(String(value || "")) ? String(value) : "");

export function normalizeClothingPaintRequest(input) {
  const kind = input?.source?.kind;
  if (kind !== "game" && kind !== "catalog")
    throw refusal("CLOTHING_PAINT_SOURCE", "Непонятно, какую вещь красили.");
  const list = Array.isArray(input?.targets) ? input.targets : [];
  if (!list.length)
    throw refusal("CLOTHING_PAINT_TARGET", "Не выбрана вещь на сервере.");
  if (list.length > MAX_TARGETS)
    throw refusal(
      "CLOTHING_PAINT_TARGET",
      `За раз — не больше ${MAX_TARGETS} вещей.`,
    );
  /* Непрозрачность вещи (задача 3 ТЗ 05.10.2026): с ней в игру едет и
     некрашеная вещь. */
  const opacity = normalizeModelOpacity(input?.opacity);
  /* Перенос окно кладёт и в источник (`source.transfer`): его вещь на женскую цель — тоже «источник» установки со своим ключом. */
  const transfer = normalizeTransfer(input?.transfer ?? input?.source?.transfer, kind, Number(input.source.variant));
  /* Вещь «как есть» (31.10.2026): комплект ставит всё надетое, и вещь без правок — тоже; красить нечего, на вещь сервера встаёт её собственная текстура. Только по слову запроса: пустая покраска без него — отказ, как прежде. */
  const asIs = input?.asIs === true;
  return {
    opacity,
    transfer,
    asIs,
    source:
      kind === "game"
        ? {
            kind,
            slot: String(input.source.slot || ""),
            variant: Number(input.source.variant),
            /* Расцветка вещи игры по номеру (30.10.2026): красили её — в её текстуру и печётся; без номера — лицо вещи. */
            ...gameTextureOf(input.source),
          }
        : {
            kind,
            manifest: input.source.manifest,
            baseUrl: String(input.source.baseUrl || ""),
            variant: /^[a-z]$/.test(input.source.variant || "")
              ? input.source.variant
              : null,
            ...(Number.isInteger(input.source.form) ? { form: input.source.form } : {}),
          },
    targets: list.map(normalizeReplaceTarget),
    /* Прежние пакеты этой покраски и чужие заменёнки, которые человек
       согласился сменить (задача 4 ТЗ 05.10.2026). */
    replace: normalizeReplaceIds(input?.replace),
    name: String(input?.name || "Покраска").slice(0, 80),
    /* С переносом красить не обязательно: картинка — заводская текстура мужской вещи или мода. */
    textures: normalizePaintedTextures(input?.textures, "CLOTHING_PAINT", { allowEmpty: opacity < 1 || Boolean(transfer) || asIs }),
    gameRoot: clothingGameRoot(input),
    targetId: String(input?.targetId || "default"),
    /* Проект, на который ставят: у Majestic замена идёт в пак игры, где лежит вещь (`clothing-pack-place.js`), а не в Astral Clothing DLC. */
    server: serverIdOf(input?.server),
    /* Сервер самой вещи-цели (13.11.2026): окно сервер проекта в запрос не кладёт, а вещь из «На что поставить?» его несёт (`server: "majestic"`); `normalizeReplaceTarget` его
       вычищает, поэтому он читается здесь, по порядку целей. Сильнее общего: на вещи другого сервера покраска ложится по его правилам. */
    targetServers: list.map((target) => serverIdOf(target?.server)),
  };
}

/**
 * Перенос на женскую пару: `{ variant, accept }` или `null`. Красили мужскую вещь игры, пара — женская вещь игры (числа «Моделей»,
 * `@modovik/clothing/gender`). `accept` — человек видел меру переноса ниже порога и согласен.
 */
export function normalizeTransfer(input, kind, maleVariant) {
  if (!input) return null;
  /* Мужская вещь — из игры (число «Моделей») или мод каталога со своей мужской моделью (ТЗ 29.10.2026, пп. 4–5): у мода категория пары (`slot`) — в запросе. */
  if (kind !== "game" && kind !== "catalog")
    throw refusal("CLOTHING_TRANSFER_SOURCE", "Скин на женского персонажа переносится только с мужской вещи игры или мода каталога.");
  if (kind === "game" && variantGender(maleVariant) !== "male")
    throw refusal("CLOTHING_TRANSFER_SOURCE", "Скин на женского персонажа переносится только с мужской вещи игры или мода каталога.");
  const variant = Number(input.variant);
  if (!Number.isInteger(variant) || variantGender(variant) !== "female")
    throw refusal("CLOTHING_TRANSFER_PAIR", "Не выбрана женская вещь, на которую переносить скин.");
  const slot = String(input.slot || "");
  if (kind === "catalog" && !/^[a-z-]{1,32}$/.test(slot))
    throw refusal("CLOTHING_TRANSFER_PAIR", "Не названа категория женской вещи, на которую переносить скин.");
  return { variant, accept: input.accept === true, ...(kind === "catalog" ? { slot } : {}) };
}

/**
 * Вещь из игры игрока: модель и текстура цвета — в рабочую папку. Вещь
 * свободного персонажа, мужского или женского (по числу в «Моделях»); форма
 * патрульного (модель полицейского) сюда не проходит.
 */
async function gameSource(request, work, resolved, stateDir, context) {
  /* Пол вещи — по её числу в «Моделях»: женская вещь красится на своей женской развёртке и встаёт только на женскую цель. */
  const gender = requestGender(request.source);
  const source = clothingSource(request.source.slot, gender);
  if (source.fixed)
    throw refusal(
      "CLOTHING_PAINT_SOURCE",
      "Эту вещь не поставить на вещь сервера: она не из набора свободного персонажа.",
    );
  const { variants } = await listGameClothing(
    { gameRoot: request.gameRoot, slot: request.source.slot, gender },
    context,
    stateDir,
    resolved,
  );
  const item = variants.find(
    (entry) => entry.variant === request.source.variant,
  );
  if (!item) throw refusal("CLOTHING_PAINT_SOURCE", "Такой вещи в игре нет.");
  if (!item.texture)
    throw refusal(
      "CLOTHING_PAINT_TEXTURE",
      "У этой вещи в игре нет текстуры цвета — покраске некуда лечь.",
    );
  /* Вещь из другого архива игры (большая сумка GTA5RP) лежит у себя; у вещи
     с моделью из заплатки Rockstar текстуры — в исходном пакете. */
  const place = placeOfItem(source, item);
  const texturePlace = texturePlaceOf(source, item);
  /* Та же расцветка, что в «Виде»: красили её — в неё и печётся. Выбранная по номеру (расцветка надетой вещи на персонаже и в правке) — она; нет номера или такой нет у вещи — лицо. */
  const textureName =
    textureByIndex(item, request.source.texture ?? null) ||
    (await chooseGameTexture(
      { gameRoot: request.gameRoot, source: texturePlace, item },
      context,
      resolved,
      work,
    ));
  const model = path.join(work, "source", item.model);
  const texture = path.join(work, "source", textureName);
  await fs.mkdir(path.dirname(model), { recursive: true });
  context?.onProgress?.({ phase: "search", archive: place.archive });
  for (const [file, output, where] of [
    [item.model, model, place],
    [textureName, texture, texturePlace],
  ])
    await resolved.read(
      {
        gameRoot: request.gameRoot,
        entry: `${where.archive.replace(/\.rpf$/i, "")}:/${where.folder}/${file}`,
        output,
      },
      context,
    );
  const component = source.component;
  /* Доп. модели самой вещи-источника (`hair_003_u_1.ydd`: форма «под шапкой»): читаются по требованию, когда у цели есть доп. модель с тем же номером (правило заменёнки, `model-variants.js`). */
  const sourceAlternates = await gameAlternateFiles(
    { gameRoot: request.gameRoot, place, item, component },
    context,
    resolved,
  );
  const alternateOf = async (number) => {
    const name = sourceAlternates.get(number);
    if (!name) return null;
    const output = path.join(work, "source", name);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await resolved.read(
      {
        gameRoot: request.gameRoot,
        entry: `${place.archive.replace(/\.rpf$/i, "")}:/${place.folder}/${name}`,
        output,
      },
      context,
    );
    return fs.readFile(output);
  };
  return {
    wear: {
      gender,
      component,
      prop: component.startsWith("p_"),
      modelSuffix: suffixOf(item.model),
      race: raceOf(textureName),
    },
    alternateOf,
    /* Место вещи в игре: по нему узнаётся крой бронежилета (задача 9). */
    place: {
      folder: path.posix.basename(place.folder),
      drawable: Number(/_(\d{3})(?:_[ur])?\.ydd$/i.exec(item.model)?.[1]),
    },
    model: await fs.readFile(model),
    texture,
    textureName,
    origin: { modId: GAME_SOURCE, version: "1.0.0" },
  };
}

/*
 * Перенос на женскую пару: источник пакета — женская вещь игры (её модель и заводская текстура), а картинка на её развёртке — мужская, перенесённая по 3D
 * (`transferSkinImages`). Мужская картинка — то, что красили в мастерской (PNG на текстуру вещи) или заводская текстура мужской вещи, если красить нечем.
 * Ниже порога меры без согласия человека (`transfer.accept`) — отказ с числом: окно показывает предпросмотр и спрашивает.
 */
async function transferSource(request, work, resolved, stateDir, context, deps = {}) {
  const fromCatalog = request.source.kind === "catalog";
  const male = fromCatalog
    ? await catalogSource(request, path.join(work, "male"), stateDir, deps)
    : await gameSource(request, path.join(work, "male"), resolved, stateDir, context);
  if (fromCatalog && male.wear.gender !== "male")
    throw refusal("CLOTHING_TRANSFER_SOURCE", "Скин переносится с мужской вещи на женскую; эта вещь каталога уже женская.");
  const pairSlot = request.transfer.slot || request.source.slot;
  const female = await gameSource(
    { ...request, source: { kind: "game", slot: pairSlot, variant: request.transfer.variant } },
    path.join(work, "female"),
    resolved,
    stateDir,
    context,
  );
  const stem = String(male.textureName || "").replace(/\.ytd$/i, "").toLowerCase();
  /* Рисунок мастерской — только у вещи игры: у мода каталога картинка — его расцветка. */
  const painted = fromCatalog ? null : request.textures.find((item) => item.texture.toLowerCase() === stem) || request.textures[0] || null;
  /* `resolved.imageOf` подменяет разбор словаря текстуры в тестах. */
  const { pngImage, transferSkinImages, ytdImage } = await import("./clothing-skin-transfer.js");
  const image = painted ? await pngImage(painted.png) : (resolved.imageOf || ytdImage)(await fs.readFile(male.texture));
  /* `resolved.transferSkin` подменяет расчёт в тестах и песочнице. */
  const result = await (resolved.transferSkin || transferSkinImages)(
    { gameRoot: request.gameRoot, male: { model: male.model, image }, female: { model: female.model, ytd: await fs.readFile(female.texture) } },
    resolved,
    context,
    stateDir,
  );
  if (!result.verdict.ok && !request.transfer.accept)
    throw Object.assign(
      refusal(
        "CLOTHING_TRANSFER_LOW",
        `Скин перенёсся на женскую вещь только на ${result.coverage.percent} % — у неё другой крой, и часть вещи останется штатной. Посмотри предпросмотр и подтверди, если так подходит.`,
      ),
      { percent: result.coverage.percent },
    );
  return {
    ...female,
    /* Перенос с мода каталога: пакет — его, чтобы «Библиотека» и повторная установка знали, чья это заменёнка. */
    ...(fromCatalog ? { origin: male.origin } : {}),
    /* Картинка женской развёртки — вместо покраски: она уже в размере женской текстуры. */
    painted: [{ texture: "transferred", png: result.png, opaque: true }],
    transfer: {
      percent: result.coverage.percent,
      ok: result.verdict.ok,
      coverage: result.coverage,
      pair: request.transfer.variant,
      from: fromCatalog ? { mod: male.origin.modId } : { slot: request.source.slot, variant: request.source.variant },
    },
  };
}

/**
 * Предпросмотр переноса без установки: мера «перенесено N %» и картинка женской развёртки. Запрос — как у покраски, но без вещей сервера.
 * `{ percent, ok, width, height, coverage, png }`, `png` — байты.
 */
export async function previewClothingTransfer(input, stateDir, deps = {}) {
  const kind = input?.source?.kind === "catalog" ? "catalog" : "game";
  const request = {
    source:
      kind === "catalog"
        ? {
            kind,
            manifest: input.source.manifest,
            baseUrl: String(input.source.baseUrl || ""),
            variant: /^[a-z]$/.test(input.source.variant || "") ? input.source.variant : null,
          }
        : { kind, slot: String(input?.source?.slot || ""), variant: Number(input?.source?.variant), ...gameTextureOf(input?.source) },
    transfer: normalizeTransfer(input?.transfer, kind, Number(input?.source?.variant)),
    textures: kind === "game" && input?.textures?.length ? normalizePaintedTextures(input.textures, "CLOTHING_PAINT") : [],
    gameRoot: clothingGameRoot(input),
  };
  if (!request.transfer) throw refusal("CLOTHING_TRANSFER_PAIR", "Не выбрана женская вещь, на которую переносить скин.");
  request.transfer.accept = true;
  const resolved = { ...defaultTools(stateDir), ...(deps.tools || {}) };
  const work = path.join(stateDir, "clothing-paint", "work", randomUUID());
  try {
    const source = await transferSource(request, work, resolved, stateDir, { onProgress: deps.onProgress }, deps);
    return {
      percent: source.transfer.percent,
      ok: source.transfer.ok,
      coverage: source.transfer.coverage,
      width: source.painted[0].png.readUInt32BE(16),
      height: source.painted[0].png.readUInt32BE(20),
      png: source.painted[0].png,
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/** Вещь каталога: модель и выбранная расцветка из её подписанного пакета. */
async function catalogSource(request, work, stateDir, deps) {
  const opened = await openClothingPackage(
    { manifest: request.source.manifest, baseUrl: request.source.baseUrl, forms: true },
    stateDir,
    deps,
  );
  /* Набор перчаток: модель той формы, что выпала цели (`paintFormGroups`); вне набора форм нет, модель одна. */
  const described = opened.describe(request.source.form ?? opened.forms[0] ?? null);
  const letter =
    request.source.variant && described.textures.has(request.source.variant)
      ? request.source.variant
      : [...described.textures.keys()].sort()[0];
  const chosen = described.textures.get(letter);
  const textureName = path.posix.basename(String(chosen.file.entry || ""));
  const texture = path.join(work, "source", textureName || "texture.ytd");
  await fs.mkdir(path.dirname(texture), { recursive: true });
  await fs.writeFile(texture, await opened.read(chosen.file));
  return {
    wear: {
      gender: described.gender,
      component: described.component,
      prop: described.prop,
      modelSuffix: described.modelSuffix,
      race: chosen.race,
    },
    model: await opened.read(described.model),
    /* Свои доп. модели пакета (`_1`, `_2`…): номер варианта → файл; цели с таким номером получают их, а не основную модель. */
    alternateOf: async (number) => {
      const file = described.alternates?.get?.(number);
      return file ? opened.read(file) : null;
    },
    texture,
    textureName,
    origin: {
      modId: String(opened.manifest.id),
      version: String(opened.manifest.version || "1.0.0"),
    },
  };
}

/** Суффикс файла основной модели: `hair_001_u.ydd` → `u`; нет суффикса — `null`. */
const parseModelSuffix = (name) => /_([ur])\.ydd$/i.exec(String(name || ""))?.[1]?.toLowerCase() || null;

/**
 * Собирает пакеты замены с покраской — по одному на вещь сервера.
 * `deps.tools` подменяет чтение архивов и запекание (тесты, песочница).
 */
/*
 * Набор перчаток каталога (01.11.2026, лог владельца: «В пакете несколько моделей — это набор, а не одна вещь» на «Применить»): одна перчатка — 11 моделей под 11 кроёв торса, и установка мода
 * давно ставит каждую цель своей формой (`openedForTarget`), а покраска знала только одну модель и отказывала. Здесь то же сопоставление `matchGloveForms`: цели делятся по формам пакета, и каждая группа собирается своей моделью и текстурой.
 */
export function paintFormGroups(forms, targets) {
  const position = (list) => list.map((drawable, index) => ({ drawable, index, size: list.length }));
  const groups = new Map();
  const folders = new Map();
  for (const target of targets) {
    if (!folders.has(target.folder)) folders.set(target.folder, []);
    folders.get(target.folder).push(target);
  }
  for (const list of folders.values()) {
    const drawables = list.map((target) => target.drawable).sort((left, right) => left - right);
    const { pairs } = matchGloveForms(position(forms), position(drawables));
    for (const pair of pairs) {
      const form = pair.source.drawable;
      if (!groups.has(form)) groups.set(form, []);
      groups.get(form).push(list.find((target) => target.drawable === pair.target.drawable));
    }
  }
  return groups;
}

export async function buildClothingPaint(input, stateDir, deps = {}) {
  const sourceForms = clothingPackageForms(input?.source?.kind === "catalog" ? input.source.manifest : null);
  if (sourceForms.length > 1 && input?.source?.form === undefined && !input?.transfer && !input?.source?.transfer) {
    const parts = [];
    for (const [form, targets] of paintFormGroups(sourceForms, normalizeClothingPaintRequest(input).targets))
      parts.push(await buildClothingPaint({ ...input, source: { ...input.source, form }, targets }, stateDir, deps));
    return {
      ...parts[0],
      built: parts.flatMap((part) => part.built),
      baked: parts.flatMap((part) => part.baked),
      skipped: parts.flatMap((part) => part.skipped),
    };
  }
  const request = normalizeClothingPaintRequest(input);
  const resolved = { ...defaultTools(stateDir), ...(deps.tools || {}) };
  const context = { onProgress: deps.onProgress };
  const work = path.join(stateDir, "clothing-paint", "work", randomUUID());
  try {
    const source =
      request.transfer
        ? await transferSource(request, work, resolved, stateDir, context, deps)
        : request.source.kind === "game"
          ? await gameSource(request, work, resolved, stateDir, context)
          : await catalogSource(request, work, stateDir, deps);
    /* Что запекается в текстуру: покраска мастерской или перенесённая картинка женской развёртки. */
    const paintedTextures = source.painted || request.textures;
    /* Цвет вещи — только от покраски вещи того же кроя: развёртка
       другой модели легла бы на жилет пятнами. */
    const own = source.place ? armorMemberOf(source.place) : null;
    for (const target of request.targets) {
      if (!target.colour) continue;
      const member = armorMemberOf({
        folder: target.folder,
        drawable: target.drawables[0],
      });
      if (!own || !member || own.cut !== member.cut)
        throw refusal(
          "CLOTHING_PAINT_TARGET",
          "Цвет бронежилета меняет покраска бронежилета того же кроя — выбери его в «Моделях» → «Из игры».",
        );
    }
    /* Имена — до запекания: несовместимую вещь незачем печь. Маршрут — по вещи-цели (`clothing-route.js`, 14.11.2026): штатная вещь и вещь Majestic белого пака идут под именами вещи в паке игры
       (запись — `replace` по вложенному архиву пака, чужое имя было бы отказом движка), вещь серверного пака Majestic — в свой overlay-RPF (имена — по её строке базы), остальное — Astral Clothing DLC;
       вид и пол проверяет `replaceNames` так же. */
    const plans = [];
    /* Доп. модели цели (`hair_001_u_1.ydd`, `_2`: игра берёт их при шапке, маске, куртке): как у заменёнки (`clothing-replace.js`, `modelAlternatesPlan`) — вариант источника с тем же номером, иначе его основная
       модель; раньше они оставались штатными, и под шапкой причёска вставала старой формой (находка B3 задачи «причёски и бороды», 15.11.2026). Берутся только варианты с тем же суффиксом, что у основной модели
       (`_u`/`_r`): иначе манифест не пройдёт доверие (`alternatesAgree`, ревью №12). Вещи без вариантов, цвет и пропсы — без изменений; место вещи читал маршрут (`routed.gamePlace`/`place`), второго чтения нет. */
    const alternatesOf = (target, place, model) => {
      if (target.colour || target.prop || source.wear.component.startsWith("p_") || !model) return [];
      const suffix = parseModelSuffix(model);
      /* Место вещи в игре знает свои доп. модели (даже если их нет); у вещи собственной коллекции проекта места нет — имена из данных разбора (`target.alternates`, `normalizeReplaceTarget`). */
      const names = place ? place.alternates || [] : target.alternates || [];
      return names.filter((name) => parseAlternate(name)?.suffix === suffix);
    };
    for (const target of request.targets) {
      const names = replaceNames(source.wear, target);
      const server = serverOfTarget(target, request.server);
      const routed = await routeOfTarget({ target, server, deps });
      if (!routed.pack) {
        plans.push({ target, names, route: routed.summary, alternates: alternatesOf(target, routed.gamePlace, names.model) });
        continue;
      }
      /* Цвет вещи на месте в паке игры: текстуры — под именами файлов цвета у каждой модели в паке (`routed.colourTextures`, по порядку `drawables`), модели нет. */
      if (routed.colourTextures) {
        plans.push({
          target,
          names: { model: null, textures: routed.colourTextures },
          pack: routed.pack,
          route: routed.summary,
        });
        continue;
      }
      if (!routed.place) {
        plans.push({ target, names, pack: routed.pack, route: routed.summary, alternates: alternatesOf(target, null, names.model) });
        continue;
      }
      const place = routed.place;
      plans.push({
        target: { ...target, textures: place.textures.length },
        names: { model: names.model ? place.model : null, textures: place.textures },
        pack: routed.pack,
        route: routed.summary,
        alternates: alternatesOf(target, place, names.model ? place.model : null),
      });
    }
    /* Прозрачность: детали вещи — на шейдер игры `ped_alpha`, альфа
       текстуры цвета — непрозрачность. Цвет бронежилета (без модели)
       прозрачным не сделать: прозрачность — в модели. */
    let model = source.model;
    let transparency = null;
    if (request.opacity < 1) {
      if (plans.some(({ names }) => !names.model))
        throw refusal(
          "CLOTHING_PAINT_OPACITY",
          "Прозрачность ставится заменой вещи целиком — у цвета бронежилета модели нет. Уберите прозрачность или выберите вещь, а не цвет.",
        );
      transparency = await transparentModel(source.model);
      model = transparency.bytes;
    }
    const alpha = request.opacity < 1 ? request.opacity : null;
    /* Вещь как есть, непрозрачная: в игру едет её текстура байт в байт — перекодировать нечего, и «что видишь — то ставится» без потерь сжатия. */
    const baked =
      request.asIs && !paintedTextures.length && request.opacity >= 1
        ? { bytes: await fs.readFile(source.texture), baked: [{ file: source.textureName, asIs: true }], skipped: [] }
        : await (resolved.bake || bakeYtd)(
            {
              input: source.texture,
              file: source.textureName,
              /* Некрашеная прозрачная вещь — её заводская текстура с ровной
                 альфой (у словаря вещи одна текстура цвета — `sole`). */
              textures: paintedTextures.length
                ? paintedTextures.map((item) => ({ ...item, alpha }))
                : [{ texture: "diffuse", png: null, opaque: true, alpha }],
              work,
              gameRoot: request.gameRoot,
              missing: "нет в текстуре вещи",
              sole: true,
            },
            resolved,
            context,
          );
    if (!baked.bytes)
      throw refusal(
        "CLOTHING_PAINT_NOTHING",
        baked.skipped?.length
          ? `Покраска не легла на текстуру вещи: ${baked.skipped
              .map((entry) => `${entry.texture} — ${entry.reason}`)
              .join("; ")}.`
          : "Покраска не легла на текстуру вещи.",
      );
    /* Доп. модель цели: свой вариант источника с тем же номером (с прозрачностью, как основная), иначе основная модель источника. Один раз на номер: у разных целей те же байты. */
    const alternateNotes = [];
    const alternateBytes = new Map();
    const alternateModel = async (name) => {
      const number = parseAlternate(name)?.number;
      if (!number || !source.alternateOf) return model;
      if (!alternateBytes.has(number))
        alternateBytes.set(
          number,
          (async () => {
            const own = await source.alternateOf(number);
            if (!own) return model;
            if (request.opacity >= 1) return own;
            try {
              return (await transparentModel(own)).bytes;
            } catch (error) {
              alternateNotes.push({ texture: name, reason: `прозрачность: ${String(error?.message || error)}` });
              return own;
            }
          })(),
        );
      return alternateBytes.get(number);
    };
    const built = [];
    for (const { target, names, pack, route, alternates = [] } of plans)
      built.push({
        /* Сервер вещи — в журнал установки (`clothing-write-note.js`). */
        server: route.server,
        ...(await writeClothingReplacePackage({
          stateDir,
          source: source.transfer ? { ...source.origin, transfer: source.transfer } : source.origin,
          name: request.name,
          targetName: target.name,
          target,
          component: source.wear.component,
          /* Цвет вещи — без модели: она общая у всех цветов кроя. */
          files: [
            ...(names.model ? [{ name: names.model, bytes: model }] : []),
            ...(await Promise.all(alternates.map(async (name) => ({ name, bytes: await alternateModel(name) })))),
            ...names.textures.map((name) => ({ name, bytes: baked.bytes })),
          ],
          gameRoot: request.gameRoot,
          /* Модель без весов — веса тела игры тем же чтением архивов, что и у покраски (`clothing-body-skin.js`, разбор 02.11.2026). */
          skinModel: deps.skinModel ?? ((input) => withGameBodySkin({ ...input, tools: resolved, work, context })),
          targetId: request.targetId,
          ...(pack ? { pack } : {}),
          route,
        })),
      });
    return {
      request,
      built,
      ...(source.transfer ? { transfer: source.transfer } : {}),
      baked: baked.baked || [],
      skipped: [
        ...(baked.skipped || []),
        ...(transparency?.skipped || []).map((item) => ({ texture: item.texture || "", reason: `прозрачность: ${item.reason}` })),
        ...alternateNotes,
      ],
      ...(transparency ? { opacity: request.opacity, transparent: transparency.changed.length } : {}),
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/*
 * Модель вещи с деталями на `ped_alpha` (`@modovik/rage-drawable/ped-alpha`):
 * правка на месте, пересжатие под прежний заголовок RSC7. Ни одна деталь не
 * перешилась — отказ: вещь осталась бы плотной под словом «прозрачная».
 */
async function transparentModel(bytes) {
  const source = new Uint8Array(bytes);
  const { resource } = readDrawable(source, { inflateRaw: zlib.inflateRawSync, kind: "ydd" });
  const result = pedAlphaShaders(resource);
  if (!result.changed.length)
    throw refusal(
      "CLOTHING_PAINT_OPACITY",
      `Эту вещь прозрачной не сделать: ${result.skipped.map((item) => item.reason).join("; ") || "у неё нет деталей с текстурой цвета"}.`,
    );
  /* Пересжатие — мимо потока окна (06.10.2026, вечер). */
  const body = await deflateRawAsync(Buffer.from(resource.data.buffer, resource.data.byteOffset, resource.data.byteLength), { level: 9 });
  const out = Buffer.alloc(16 + body.length);
  out.set(source.subarray(0, 16));
  out.set(body, 16);
  return { bytes: out, changed: result.changed, skipped: result.skipped };
}

/** Ставит покраску на выбранные вещи сервера. */
export async function applyClothingPaint(input, stateDir, deps = {}, { origin = null } = {}) {
  const { built, baked, skipped, transfer } = await buildClothingPaint(
    input,
    stateDir,
    deps,
  );
  const installed = await installClothingReplacePackages(built, stateDir, deps, { replace: input?.replace, ...(origin ? { origin } : {}) });
  return { ...installed, baked, skipped, ...(transfer ? { transfer } : {}) };
}

/**
 * Подбор женской пары есть не у всех видов (14.11.2026, ревью №7): у причёсок женской пары по номеру и крою нет — женская причёска отдельная вещь со своим списком; слот `hair` в `CLOTHING_SOURCES`
 * появился с причёской-вещью, и без этого отказа подбор по крою пошёл бы и для неё. `null` — подбор возможен (отказ словами — `CLOTHING_TRANSFER_SLOT`).
 */
export function femalePairRefusal(component) {
  return component === "hair"
    ? refusal("CLOTHING_TRANSFER_SLOT", "У причёсок нет женской пары: женская причёска — отдельная вещь, выберите её в списке.")
    : null;
}

/**
 * Похожие женские вещи игры для мода каталога со своей мужской моделью (ТЗ 29.10.2026, п. 5): мужскую модель на женское тело не поставить — тело другое, —
 * но картинку мода можно перенести на женскую вещь игры того же вида и похожего кроя. `{ slot, component, pairs: [{ variant, name?, closeness, fits, shape }] }`;
 * пусто — похожей вещи в игре нет.
 */
export async function suggestCatalogFemalePairs(input, stateDir, deps = {}) {
  const gameRoot = clothingGameRoot(input);
  const opened = await openClothingPackage({ manifest: input?.manifest, baseUrl: String(input?.baseUrl || ""), forms: true }, stateDir, deps);
  const described = opened.describe(opened.forms[0] ?? null);
  if (described.gender !== "male")
    throw refusal("CLOTHING_TRANSFER_SOURCE", "Подбор женской пары — для мужской вещи каталога; эта вещь уже женская.");
  const noPair = femalePairRefusal(described.component);
  if (noPair) throw noPair;
  const slot = slotOfComponent(described.component);
  if (!slot) throw refusal("CLOTHING_TRANSFER_SLOT", "Для этого вида вещи в игре нет женских вещей, на которые можно перенести картинку.");
  const bytes = await opened.read(described.model);
  const [{ suggestFemaleByShape }, { clothingDrawable }, { garmentShape }, { inflateRawNode }] = await Promise.all([
    import("./game-clothing-pairs.js"),
    import("@modovik/clothing/model"),
    import("@modovik/clothing/garment-shape"),
    import("@modovik/rpf7/node"),
  ]);
  const maleShape = garmentShape(clothingDrawable(bytes, { inflateRaw: inflateRawNode }), described.component);
  const resolved = { ...defaultTools(stateDir), ...(deps.tools || {}) };
  const pairs = await suggestFemaleByShape({ gameRoot, slot, maleShape, maleSize: bytes.length, stateDir }, resolved, { onProgress: deps.onProgress });
  return { slot, component: described.component, pairs };
}
