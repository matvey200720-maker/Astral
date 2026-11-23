/*
 * «Применить» тату (ТЗ 04.10.2026, задача 10): рисунок с тела — в картинки
 * выбранных тату игры.
 *
 * Мастерская красит тело персонажа в полный рост (`tattoo-body.js`) по зонам
 * тату и шлёт сюда нарисованное — картинку каждой зоны, только слои, без
 * кожи (`bare`): тату — чернила с прозрачностью. Здесь:
 *  1. цели сверяются с оглавлением тату игры (`game-tattoos.js`): место
 *     тату (зона, `uvPos`, `scale`, `rotation`) и его картинка берутся из
 *     файлов игры, а не из окна;
 *  2. рисунок переносится из картинки зоны в картинку каждого тату по его
 *     месту в зоне (`@modovik/clothing/tattoo-zones`) — в размер исходной
 *     текстуры тату;
 *  3. картинка печётся в исходный `.ytd` тату (тот же формат и mip, альфа —
 *     рисунка) и ложится под своим именем в Astral Clothing DLC пакетом
 *     `local-tattoo-paint-*` (`tattoo-paint-manifest-trust.js`).
 *
 * Пакет — на каждое тату свой (разбор 01.11.2026): слот у пакета один, и работа
 * на занятом тату снимает только его, а не все тату прежней работы. Что стояло
 * большим пакетом до этого, снимается по-прежнему.
 *
 * Место (ТЗ 06.10.2026, вечер, задача 3): «рисунок остаётся там, где
 * нарисован, даже если заменяешь тату другой зоны». Нарисованное делится на
 * пятна (`@modovik/clothing/tattoo-place`): тату, в рамке которого пятно
 * лежит целиком, остаётся на своём месте; остальные переезжают под
 * оставшиеся пятна — тем же пакетом едет коллекция наложений с их новым
 * местом (штатная коллекция игрока, у переехавших тату — зона, `uvPos`,
 * `scale`, `rotation`). Каждое тату несёт только свои пятна.
 *
 * Тату, которому не досталось пятна, не ставится — оно уходит в «не легло»
 * с причиной; так же — пятно, которому не досталось тату.
 */

import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  TATTOO_ZONES,
  projectTattoo,
  rgbaSampler,
  zoneIndex,
  zoneOfMaterial,
} from "@modovik/clothing/tattoo-zones";
import { clothingContainerOptions } from "./clothing-container-options.js";
import { mergeOverlayVisibility, overlayInstallVisibility } from "./overlay-install-visibility.js";
import {
  inkRegions,
  planTattooPlaces,
  regionMask,
} from "@modovik/clothing/tattoo-place";
import {
  canonicalManifest,
  engineInstallEnabled,
  installLocalTattooPaintPackage,
  planPackage,
  tattooPaintManifest,
  tattooPaintTxd,
  TATTOO_PAINT_LIMIT,
} from "@modovik/install-engine";
import {
  readGameTattoos,
  readTattooCollection,
  readTattooYtd,
  tattooPicture,
} from "./game-tattoos.js";
import { clothingGameRoot } from "./clothing-models.js";
import { paintWeaponFiles } from "./gunpack-paint.js";
import { atomicWrite, normalizePaintedTextures } from "./ytd-bake.js";
import {
  composeRpfArchive,
  installRpfPrebuilt,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { provisionClothingInfrastructure } from "./clothing-dlc-provisioner.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";
import { tattooPaintReplayRecord } from "./tattoo-paint-replay.js";

const refusal = (code, message) => Object.assign(new Error(message), { code });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/* Картинка тату — до 1024 по стороне: крупнее у игры не бывает. */
const MAX_SIDE = 1024;

/*
 * Запрос окна: рисунок по частям тела, тату, папка игры. Две формы:
 *  - `targets` + `textures` — рисунок целиком и отмеченные тату, план делит пятна между ними;
 *  - `parts` (01.11.2026, «Куда поставить татуировки») — каждая часть своей строкой: `{ target, textures, stay }`. Картинка части ложится только в своё тату.
 *    `stay` — тату игры стоит на своём месте и на своём же тату: рамка не меняется, даже если повёрнутая рамка не вмещает прямоугольник чернил.
 */
export function normalizeTattooPaintRequest(input) {
  const parts = Array.isArray(input?.parts)
    ? input.parts.map((part) => ({
        key: String(part?.target || "").toLowerCase(),
        stay: part?.stay === true,
        textures: normalizePaintedTextures(part?.textures, "TATTOO_PAINT"),
      }))
    : null;
  const keys = parts
    ? parts.map((part) => part.key)
    : Array.isArray(input?.targets)
      ? input.targets.map((target) => String(target?.key || target || "").toLowerCase())
      : [];
  if (!keys.length || keys.some((key) => !key)) throw refusal("TATTOO_PAINT_TARGET", "Не выбрано, какое тату заменить.");
  if (keys.length > TATTOO_PAINT_LIMIT)
    throw refusal("TATTOO_PAINT_TARGET", `За раз — не больше ${TATTOO_PAINT_LIMIT} тату.`);
  if (new Set(keys).size !== keys.length)
    throw refusal("TATTOO_PAINT_TARGET", "Одно и то же тату выбрано дважды.");
  return {
    keys,
    parts,
    textures: parts ? null : normalizePaintedTextures(input?.textures, "TATTOO_PAINT"),
    name: String(input?.name || "Тату").slice(0, 80),
    gameRoot: clothingGameRoot(input),
    targetId: String(input?.targetId || "default"),
    /* Чьё тело красили (ТЗ 30.10.2026): рисунок лежит на зонах женского или мужского тела, и ложится он на тату того же пола. */
    gender: input?.gender === "female" ? "female" : "male",
  };
}

/** Чтение игры и запекание, какими пользуются покраска и набор тату каталога (`tattoo-set.js`). */
export const defaultTools = {
  index: readGameTattoos,
  ytd: readTattooYtd,
  picture: tattooPicture,
  paint: paintWeaponFiles,
  collection: readTattooCollection,
};

/* PNG окна → картинки зон (для пятен) и выборка цвета по месту в зоне;
   детали тела без зоны (ткань боксёров, шлёпанцы) пропускаются: тату там
   не бывает. */
async function zonesOf(textures) {
  const samplers = new Map();
  const images = [];
  for (const item of textures) {
    const zone = zoneOfMaterial(item.texture);
    if (zone < 0) continue;
    const { data, info } = await sharp(item.png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const image = { zone, width: info.width, height: info.height, data };
    images.push(image);
    samplers.set(zone, rgbaSampler(image, { wrap: true }));
  }
  return { samplers, images };
}

const fixed = (value) => Number(value).toFixed(6);

/* Тег пресета: заменить, а нет его — дописать первым в `<Item>`. */
function setTag(block, pattern, tag) {
  if (pattern.test(block)) return block.replace(pattern, tag);
  return block.replace(/<Item(?:\s[^>]*)?>/, (open) => `${open}\n      ${tag}`);
}

/**
 * Новое место тату в тексте коллекции: зона, центр, размер и поворот его
 * `<Item>` (по `nameHash`), остальное — как у игры.
 */
export function placeDecoration(xml, name, decoration) {
  const wanted = String(name || "").toLowerCase();
  let found = false;
  const text = String(xml).replace(/<Item(?:\s[^>]*)?>[\s\S]*?<\/Item>/g, (block) => {
    const own = /<nameHash>\s*([^<]*?)\s*<\/nameHash>/.exec(block)?.[1]?.toLowerCase();
    if (own !== wanted) return block;
    found = true;
    let out = setTag(block, /<uvPos\b[^>]*\/>/, `<uvPos x="${fixed(decoration.uv.x)}" y="${fixed(decoration.uv.y)}" />`);
    out = setTag(out, /<scale\b[^>]*\/>/, `<scale x="${fixed(decoration.scale.x)}" y="${fixed(decoration.scale.y)}" />`);
    out = setTag(out, /<rotation\b[^>]*\/>/, `<rotation value="${fixed(decoration.rotation || 0)}" />`);
    return setTag(out, /<zone>[^<]*<\/zone>/, `<zone>${decoration.zone}</zone>`);
  });
  if (!found) throw refusal("TATTOO_PLACE", `В коллекции игры нет тату ${name}.`);
  return text;
}

const zoneLabel = (zone) => TATTOO_ZONES[typeof zone === "number" ? zone : zoneIndex(zone)]?.label || "тело";

/**
 * Собирает пакет покраски тату. `deps.tools` подменяет оглавление, чтение
 * картинок, сетки тела и запекание (тесты); `deps.keysDirectory` — ключи
 * ArchiveFix.
 */
export async function buildTattooPaint(input, stateDir, deps = {}) {
  const request = normalizeTattooPaintRequest(input);
  const tools = { ...defaultTools, ...(deps.tools || {}) };
  const index = await tools.index({
    gameRoot: request.gameRoot,
    stateDir,
    keysDirectory: deps.keysDirectory || null,
  });
  const byKey = new Map((index.tattoos || []).map((tattoo) => [tattoo.key, tattoo]));
  const tattoos = request.keys.map((key) => {
    const tattoo = byKey.get(key);
    if (!tattoo) throw refusal("TATTOO_PAINT_TARGET", "Такого тату в игре нет — список устарел, открой «Замену» заново.");
    if (!tattooPaintTxd(tattoo.txd))
      throw refusal("TATTOO_PAINT_TARGET", `У тату «${tattoo.title}» неподходящее имя картинки.`);
    /* Тату игры — мужское или женское (`gender`); `null` — игра не делит. Женский рисунок на мужское тату встал бы мимо его места. */
    if (tattoo.gender && tattoo.gender !== request.gender)
      throw refusal(
        "TATTOO_PAINT_GENDER",
        request.gender === "female"
          ? `Тату «${tattoo.title}» мужское: женское тело красится по женским тату игры.`
          : `Тату «${tattoo.title}» женское: мужское тело красится по мужским тату игры.`,
      );
    return tattoo;
  });
  /* Пятна рисунка и план: какое тату остаётся на своём месте, какое
     переезжает под рисунок. Переносится только тату, чью коллекцию
     перенос умеет править. Части (`parts`) считаются каждая сама по себе: у неё одно тату и только её чернила. */
  const planOf = async (textures, list, stay = false) => {
    const { samplers, images } = await zonesOf(textures);
    const { regions, grids } = inkRegions(images);
    const plan = planTattooPlaces({
      targets: list.map((tattoo) => ({ ...tattoo, movable: Boolean(tattoo.xml?.patch) })),
      regions,
    });
    if (stay && regions.length) plan.places = list.map((tattoo) => ({ key: tattoo.key, action: "keep", regions }));
    if (stay) plan.left = [];
    return { samplers, sizes: new Map(images.map((image) => [image.zone, image])), regions, grids, plan };
  };
  const batches = request.parts
    ? await Promise.all(request.parts.map(async (part, at) => ({ list: [tattoos[at]], ...(await planOf(part.textures, [tattoos[at]], part.stay)) })))
    : [{ list: tattoos, ...(await planOf(request.textures, tattoos)) }];
  if (!batches.some((batch) => batch.samplers.size))
    throw refusal(
      "TATTOO_PAINT_BODY",
      "Нарисованное — не на теле персонажа: красить тату надо по телу из «Моделей».",
    );

  const files = [];
  const baked = [];
  const skipped = [];
  const kept = [];
  const moved = [];
  const rows = batches.flatMap((batch) => batch.list.map((tattoo, index) => ({ batch, tattoo, index })));
  for (const { batch, tattoo, index } of rows) {
    const { samplers, sizes, regions, grids, plan } = batch;
    const place = plan.places[index];
    if (place.action === "skip") {
      skipped.push({
        texture: tattoo.title,
        reason: !regions.length
          ? "на теле ничего не нарисовано"
          : !tattoo.xml?.patch && plan.left.length
            ? "рисунок не в его рамке, а это тату игры переносить не умеем"
            : "пятен рисунка меньше, чем отмеченных тату, — этому нечего нести",
      });
      continue;
    }
    const decoration = place.action === "move" ? { ...tattoo, ...place.decoration } : tattoo;
    const mask = regionMask(grids, place.regions);
    const original = await tools.ytd({
      gameRoot: request.gameRoot,
      keysDirectory: deps.keysDirectory || null,
      tattoo,
    });
    const picture = tools.picture(original, tattoo.texture);
    const width = Math.min(MAX_SIDE, picture.full.width);
    const height = Math.min(MAX_SIDE, picture.full.height);
    const rgba = projectTattoo({
      decoration,
      width,
      height,
      sample: (zone, u, v) => (mask(zone, u, v) ? samplers.get(zone)?.(u, v) || null : null),
    });
    let ink = false;
    for (let at = 3; at < rgba.length; at += 4)
      if (rgba[at] > 0) {
        ink = true;
        break;
      }
    if (!ink) {
      skipped.push({ texture: tattoo.title, reason: "на его месте на теле ничего не нарисовано" });
      continue;
    }
    const png = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
      raw: { width, height, channels: 4 },
    })
      .png()
      .toBuffer();
    const txd = tattooPaintTxd(tattoo.txd);
    /* Два тату с одной картинкой: второе сменило бы первое в той же установке. */
    if (files.some((file) => file.txd === txd)) {
      skipped.push({ texture: tattoo.title, reason: "у него та же картинка, что у другого выбранного тату" });
      continue;
    }
    /* Альфа тату — сам рисунок: покраска несёт свою, а не прежнюю. */
    const result = await tools.paint(
      [{ name: `${txd}.ytd`, bytes: original }],
      [{ texture: picture.name, png, opaque: false }],
    );
    if (!result.baked?.length) {
      skipped.push({
        texture: tattoo.title,
        reason: result.skipped?.[0]?.reason || "картинку тату не перезаписать",
      });
      continue;
    }
    const bytes = Buffer.from(result.files[0].bytes);
    files.push({ txd, bytes, title: tattoo.title, key: tattoo.key });
    baked.push(tattoo.title);
    if (place.action === "keep") {
      kept.push({ title: tattoo.title, zone: zoneLabel(tattoo.zone) });
      continue;
    }
    /* Картинка тату растягивается на новую рамку: крупный рисунок в малой
       картинке игры в игре мягче — об этом говорится. */
    const zone = sizes.get(zoneIndex(place.decoration.zone));
    const soft = Boolean(
      zone &&
        (2 * place.decoration.scale.x * zone.width > 1.5 * width ||
          2 * place.decoration.scale.y * zone.height > 1.5 * height),
    );
    moved.push({
      tattoo,
      decoration: place.decoration,
      title: tattoo.title,
      from: zoneLabel(tattoo.zone),
      zone: zoneLabel(place.decoration.zone),
      soft,
      size: `${width}×${height}`,
    });
  }
  for (const region of batches.flatMap((batch) => batch.plan.left))
    skipped.push({
      texture: `Рисунок · ${zoneLabel(region.zone)}`,
      reason: "для него не хватило тату — выбери ещё одно",
    });
  if (!files.length)
    throw refusal(
      "TATTOO_PAINT_NOTHING",
      skipped.length
        ? `Ни одно тату не легло: ${skipped.map((entry) => `${entry.texture} — ${entry.reason}`).join("; ")}.`
        : "Ни одно тату не легло.",
    );

  /* Коллекция с новым местом едет с пакетом переехавшего тату: штатный файл игрока, в нём новое только у него. Слоями разных пакетов такие файлы складываются (`decoration-overlay-v1`). Файл читается один раз. */
  const collections = new Map();
  const packages = [];
  for (const file of files) {
    const item = moved.find((entry) => entry.tattoo.key === file.key);
    const places = [];
    if (item) {
      const entry = item.tattoo.xml.patch;
      if (!collections.has(entry))
        collections.set(
          entry,
          await tools.collection({
            gameRoot: request.gameRoot,
            stateDir,
            keysDirectory: deps.keysDirectory || null,
            tattoo: item.tattoo,
          }),
        );
      const xml = placeDecoration(collections.get(entry), item.tattoo.name, item.decoration);
      places.push({
        entry,
        names: [item.tattoo.name],
        exists: item.tattoo.xml.exists !== false,
        bytes: Buffer.from(xml, "utf8"),
      });
    }
    packages.push({
      ...(await writeTattooPaintPackage({ files: [file], places, name: request.name, stateDir })),
      target: { key: file.key, title: file.title },
    });
  }
  return {
    packages,
    gameRoot: path.resolve(request.gameRoot),
    targetId: request.targetId,
    baked,
    skipped,
    kept,
    moved: moved.map(({ title, from, zone, soft, size }) => ({ title, from, zone, soft, size })),
  };
}

/**
 * Пакет покраски на диск: манифест (`tattooPaintManifest`), картинки тату под их именами и коллекции с новым местом. `files` — `[{ txd, bytes, title }]`, `places` — `[{ entry, names, exists, bytes }]`.
 * Тем же пользуется набор тату каталога (`tattoo-set.js`): вместо рисунка с тела — картинки частей набора.
 */
export async function writeTattooPaintPackage({ files, places = [], name, stateDir }) {
  const manifest = tattooPaintManifest({
    title:
      files.length > 1
        ? `${name} → ${files.length} тату`
        : `${name} → ${files[0].title}`,
    files: files.map((file) => ({ txd: file.txd, size: file.bytes.length, sha256: sha256(file.bytes) })),
    places: places.map((place) => ({
      entry: place.entry,
      names: place.names,
      exists: place.exists,
      size: place.bytes.length,
      sha256: sha256(place.bytes),
    })),
  });
  const directory = path.join(stateDir, "tattoo-paint", "packages", manifest.id.slice(-12));
  for (const file of files)
    await atomicWrite(path.join(directory, "payload", `${file.txd}.ytd`), file.bytes);
  for (const [index, place] of places.entries())
    await atomicWrite(path.join(directory, "payload", "overlays", `${index}.xml`), place.bytes);
  return {
    directory,
    manifest,
    manifestHash: `sha256:${sha256(Buffer.from(canonicalManifest(manifest)))}`,
  };
}

function installOptions(built, stateDir, extra = {}) {
  return {
    manifest: built.manifest,
    packageRoot: built.directory,
    gameRoot: built.gameRoot,
    targetId: built.targetId,
    edition: "Legacy",
    stateDir,
    allowGameRootWrites: true,
    requireSignature: false,
    rpfProbe: probeRpfArchive,
    ...extra,
  };
}

/* Проверка игры и DLC одежды — один раз на установку, сколько бы в ней ни было пакетов. */
async function prepareTattooInstall(built, stateDir, deps) {
  const game = await deps.assertGameReady?.(built.gameRoot, { mutate: true });
  await (deps.provision || provisionClothingInfrastructure)({
    gameRoot: built.gameRoot,
    targetId: built.targetId,
    edition: "Legacy",
    stateDir,
    assertRuntimeSafety: () => deps.assertRuntimeSafety?.(game),
    activate: false,
  });
  return game;
}

/**
 * Ставит покраску тату: каждое тату своим пакетом (`results`). Прежняя замена этого тату сменяется — слот у тату свой, общий с паками тату каталога; остальные тату прежней работы не трогаются.
 * Сбой посреди установки не теряет то, что уже встало: оно есть в `results`, а что не встало — в `skipped` с причиной. Повторное «Применить» поставит то же самое теми же пакетами.
 */
export async function applyTattooPaint(input, stateDir, deps = {}) {
  const built = await buildTattooPaint(input, stateDir, deps);
  const game = await prepareTattooInstall(built, stateDir, deps);
  const results = [];
  const skipped = [...built.skipped];
  for (const [at, pack] of built.packages.entries()) {
    try {
      const installed = await installTattooPackage({ ...pack, gameRoot: built.gameRoot, targetId: built.targetId }, game, stateDir, deps);
      results.push({ ...installed, modId: pack.manifest.id, slots: pack.manifest.slots, target: pack.target });
    } catch (error) {
      if (!results.length) throw error;
      for (const rest of built.packages.slice(at))
        skipped.push({ texture: rest.target.title, reason: `установка прервалась: ${String(error?.message || error)}` });
      break;
    }
  }
  const titles = new Set(results.map((item) => item.target.title));
  /* Слова режима RP по всем пакетам этого «Применить»: любой остаток в хосте — одна строка (`mergeOverlayVisibility`). */
  const visibility = mergeOverlayVisibility(results.map((item) => item.visibility));
  return {
    results,
    ...(visibility ? { visibility } : {}),
    modId: results[0].modId,
    archive: results.at(-1).archive || "",
    baked: built.baked.filter((title) => titles.has(title)),
    skipped,
    kept: built.kept.filter((item) => titles.has(item.title)),
    moved: built.moved.filter((item) => titles.has(item.title)),
    replaced: [...new Set(results.flatMap((item) => item.replaced))].sort(),
    restartRequired: true,
  };
}

/** Ставит уже собранный пакет покраски (`buildTattooSet`: набор каталога — одна карточка и один пакет): проверка игры, DLC одежды, план, установка. */
export async function installTattooPaintBuilt(built, stateDir, deps = {}) {
  const game = await prepareTattooInstall(built, stateDir, deps);
  return {
    ...(await installTattooPackage(built, game, stateDir, deps)),
    modId: built.manifest.id,
    slots: built.manifest.slots,
    baked: built.baked,
    skipped: built.skipped,
    kept: built.kept,
    moved: built.moved,
    restartRequired: true,
  };
}

/* План и установка одного пакета; `replaced` — кого он сменил. */
async function installTattooPackage(built, game, stateDir, deps) {
  const plan = await (deps.plan || planPackage)(installOptions(built, stateDir));
  const replaced = [...new Set((plan.conflicts || []).map((item) => item.modId))].sort();
  /* Флаг `ASTRAL_ENGINE_INSTALL=tattoo-paint`: картинки в DLC одежды и места в update.rpf — одна точка, одна транзакция. */
  const engineInstall = engineInstallEnabled("tattoo-paint")
    ? {
        install: deps.installPrebuilt ?? installRpfPrebuilt,
        edition: "Legacy",
        gameRoot: built.gameRoot,
        pointsRoot: nativeRestorePointsRoot(),
        multi: true,
        replay: tattooPaintReplayRecord(built),
      }
    : null;
  /* Наложения через контейнер в update.rpf (`ASTRAL_OVERLAYS_VIA_UPDATE`): пусто — ничего не добавляется. */
  const container = await clothingContainerOptions(stateDir, deps);
  const installed = await (deps.install || installLocalTattooPaintPackage)(
    installOptions(built, stateDir, {
      replaceModIds: replaced,
      rpfComposer: composeRpfArchive,
      dlcListProvider: provideLegacyDlcList,
      contentXmlProvider: provideUpdateContentXml,
      assertRuntimeSafety: () => deps.assertRuntimeSafety?.(game),
      onProgress: deps.onProgress,
      ...(engineInstall ? { engineInstall } : {}),
      ...container,
    }),
  );
  /* Режим RP (21.11.2026): картинка осталась в хосте `astral_clothing` — слова «на GTA 5 RP не видно» (`overlay-install-visibility.js`); ушла в контейнер или режим выключен — поля нет. */
  const visibility = overlayInstallVisibility({ files: built.manifest.files, route: container.overlaysUpdateRoute });
  return { ...installed, replaced, ...(visibility ? { visibility } : {}) };
}
