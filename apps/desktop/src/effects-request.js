/*
 * Заявка «Эффекты и трассеры» из чужого редукса.
 *
 * Автор приносит своё ядро эффектов (`core.ypt`), иногда свой `bloodfx.dat`
 * и `weapons.meta`. Целиком ни один из них в каталог не ставится: ядро
 * заменой перетёрло бы подписанное ядро Astral, `bloodfx.dat` — всю кровь
 * игрока, а `weapons.meta` — всё оружие. Поэтому заявка вынимает из них то,
 * что ставится честно, и называет словами остальное.
 *
 *  • Текстуры, которые автор перерисовал или добавил, — DDS с превью, по
 *    группам: трассеры, кровь, вспышки, попадания. Пустышки — штатные
 *    текстуры, сжатые до пары точек ради FPS, — не рисунок: они считаются
 *    и называются, но файлов под них не пишется.
 *  • Трассер — текстура следа в раскладке слота ядра (128×256 DXT5, 6 mip) и
 *    оружие, у которого след виден: из weapons.meta редукса, если автор
 *    трогал привязки, иначе из игры. Список человек правит сам.
 *  • Перерисованные штатные текстуры — по слою на текстуру, картинкой автора
 *    без пересжатия: к раскладке ядра игрока её приводит установщик
 *    (`ypt-texture-layer-v1`).
 *  • Кровь — слой маршрутов `blood-routing-v1`: записи и клетки, которые
 *    автор поменял в bloodfx.dat, накладываются на файл игрока. Классы
 *    оружия, у которых эффект виден, названы; остальным человек может
 *    назначить его сам.
 *
 * Трассер и слои текстур ставятся в ядро самого игрока (путь «ядро игрока»,
 * `apps/desktop/src/ptfx-player-core.js`): слот следа строится из штатного
 * донора его же core.ypt, перерисованная текстура ложится в его раскладке.
 * Публикуются они, когда этот путь установки проверен в игре
 * (`apps/api/src/ptfx-core-release.js`). Слою крови ядро не нужно: его
 * правила частиц штатные, и установщик сверяет их с ядром игрока. Здесь всё
 * готовится заранее, чтобы в момент публикации хватило одной кнопки.
 */

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { readYptTextures } from "@modovik/ypt";
import { BLOCK_FORMATS, decodeDds, wholeMipLevels, writeDdsHeader } from "@modovik/dds";
import { fitDdsLayout } from "./dds-fit.js";
import {
  ASTRAL_PTFX_PLAYER_CORE_CHANNEL,
  ASTRAL_PTFX_PLAYER_CORE_VERSION,
  ASTRAL_TRACER_TEXTURE_LAYOUT,
  TRACER_RPF_ENTRIES,
  TRACER_WEAPONS,
  TRACER_WEAPON_IDS,
  VANILLA_TRACER_SHEET,
  tracerHasVisible,
  tracerRuleFrames,
  tracerSheetFrame,
} from "@modovik/tracer-contract";
import {
  BLANK_TEXTURE_SIDE,
  BLOOD_CLASS_LABELS,
  BLOODFX_ENTRY,
  BLOOD_ROUTING_PAYLOAD,
  analyzeBloodRouting,
  bloodRoutingSpec,
  diffCoreTextures,
  diffTracerBindings,
  effectKindLabel,
  isHandWeapon,
  readWeaponTracerBindings,
  tracerVisible,
  weaponById,
} from "@modovik/rpf-inspector";

/* Приведение DDS к раскладке — общее с установщиком ядра игрока. */
export { fitDdsLayout };

/* Кадры листа, которые рисует правило частицы следа автора, — из его ядра (`ypt-rule-export`). */
async function authorTracerRule(coreFile) {
  const { exportYptRules } = await import("./rpf-composer.js");
  const { export: exported } = await exportYptRules({ input: coreFile, rules: ["bullet_tracer"] });
  return tracerRuleFrames(exported?.particles?.bullet_tracer);
}

/* Сетка листа следа из `ptxclipregions.dat` автора: строка `ptfx_bullet_tracer <столбцы> <строки> …`. */
function clipGridOf(text, texture) {
  const line = String(text || "")
    .split(/\r?\n/)
    .map((item) => item.trim().split(/\s+/))
    .find((tokens) => tokens[0]?.toLowerCase() === texture);
  const columns = Number(line?.[1]);
  const rows = Number(line?.[2]);
  return columns > 0 && rows > 0 ? { columns, rows } : null;
}

/**
 * DDS слота следа из картинки автора или `null` — видимых точек нет: автор убрал след, трассера нет.
 *
 * Штатный лист `ptfx_bullet_tracer` — сетка кадров (4×1, у автора — его строка `ptxclipregions.dat`), а слот рисует
 * текстуру целиком: в него едет один кадр на всю текстуру. Какой — `tracerSheetFrame`: кадр правила частицы автора
 * (`readRule(ядро)` → `TexFrameIDMin…Max`), иначе единственный непустой, иначе штатный кадр 3. 30.10.2026: у 314 картинка
 * только в кадре 0, а прежний штатный кадр 3 давал прозрачный слот — в игре следа не было. Другие текстуры следа едут как есть.
 */
export async function tracerSlotDds({ sheet: authorSheet, texture, authorCore = null, clips = null, readRule = authorTracerRule }) {
  /* Лист автора с мелкими mip без округления до блока (sad redux, 15.11.2026: «обрывается на уровне 6: заявлено 9 mip») — слоту нужен верхний уровень. */
  const sheet = wholeMipLevels(authorSheet);
  let options = {};
  if (String(texture || "").toLowerCase() === VANILLA_TRACER_SHEET.texture) {
    const top = decodeDds(sheet).levels[0];
    const rule = authorCore ? await Promise.resolve().then(() => readRule(authorCore)).catch(() => null) : null;
    const frame = tracerSheetFrame({
      rgba: top.rgba,
      width: top.width,
      height: top.height,
      grid: clipGridOf(clips, VANILLA_TRACER_SHEET.texture) || VANILLA_TRACER_SHEET,
      rule,
    });
    if (!frame) return null;
    options = { frame };
  }
  const fitted = await fitDdsLayout(sheet, ASTRAL_TRACER_TEXTURE_LAYOUT, options);
  return tracerHasVisible(decodeDds(fitted).levels[0].rgba) ? fitted : null;
}

export const GAME_CORE_ENTRY = "x64/patch/data/effects/ptfx.rpf/core.ypt";
export const WEAPONS_META_ENTRY = "common/data/ai/weapons.meta";
/* Слой крови — общий с разбором очереди (`@modovik/rpf-inspector`). */
export { BLOODFX_ENTRY, BLOOD_ROUTING_PAYLOAD, bloodRoutingSpec };

/* DDS пишется байтами ядра без пересжатия — для форматов, которые читает
   кодек; остальные показываются в списке без файла. */
const RAW_FORMATS = new Set([...BLOCK_FORMATS, "A8R8G8B8"]);
/* Ядро другой сборки может отличаться сотнями текстур: заявка не должна
   превращаться в дамп всего ядра. */
const MAX_TEXTURES = 600;

const CORE_ENTRIES = TRACER_RPF_ENTRIES.filter((item) => item.role === "core");

/* Имя текстуры, которое установщик принимает слотом слоя. */
/* Штатные текстуры ядра бывают с подчёркиванием в начале (`_explosion_fireball`). */
const TEXTURE_SLOT_NAME = /^[a-z0-9_][a-z0-9_]{0,119}$/i;

/* Подраздел общего каталога для слоя — по группе текстуры. */
const LAYER_SUBCATEGORY = Object.freeze({
  blood: "Попадания",
  impact: "Попадания",
  smoke: "Дым",
});

const slug = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "texture";

const fileSafe = (value) =>
  String(value || "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 120) || "texture";

const plural = (count, one, few, many) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

const rgbaBuffer = (rgba) =>
  Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);

/** DDS из текстуры ядра: заголовок и её собственные байты, без пересжатия. */
function ddsFromTexture(texture) {
  const header = writeDdsHeader({
    width: texture.width,
    height: texture.height,
    mipLevels: texture.levels,
    format: texture.format,
  });
  const bytes = new Uint8Array(header.length + texture.payload.length);
  bytes.set(header, 0);
  bytes.set(texture.payload, header.length);
  return bytes;
}

/** Превью текстуры для окна: верхний уровень, не больше `size` точек. */
async function writePreview(bytes, output, size = 192) {
  const top = decodeDds(bytes).levels[0];
  await fs.mkdir(path.dirname(output), { recursive: true });
  await sharp(rgbaBuffer(top.rgba), {
    raw: { width: top.width, height: top.height, channels: 4 },
  })
    .resize(size, size, { fit: "inside" })
    .webp({ quality: 82 })
    .toFile(output);
  return output;
}

/** Обложка слоя: сама текстура на матовом чёрном фоне каталога. */
async function layerCover(bytes, output) {
  const top = decodeDds(bytes).levels[0];
  const art = await sharp(rgbaBuffer(top.rgba), {
    raw: { width: top.width, height: top.height, channels: 4 },
  })
    .resize(560, 560, { fit: "inside" })
    .png()
    .toBuffer();
  const meta = await sharp(art).metadata();
  await fs.mkdir(path.dirname(output), { recursive: true });
  await sharp({
    create: {
      width: 1200,
      height: 675,
      channels: 4,
      background: { r: 7, g: 7, b: 8, alpha: 1 },
    },
  })
    .composite([
      {
        input: art,
        left: Math.round((1200 - meta.width) / 2),
        top: Math.round((675 - meta.height) / 2),
      },
    ])
    .png()
    .toFile(output);
  return output;
}

/**
 * Спецификация слоя одной текстуры ядра — ровно в той форме, что принимает
 * установщик: три `core.ypt`, один payload, один слот.
 */
export function textureLayerSpec({
  id,
  version = "1.0.0",
  author = "",
  texture,
}) {
  const slot = `ptfx-${slug(texture)}`;
  return {
    id,
    version,
    adapter: "rpf-entry",
    editions: ["Legacy"],
    requiresLoader: false,
    scope: "game-root",
    ...(author ? { author } : {}),
    capabilities: [
      "ypt-texture-layer-v1",
      "direct-update-entries-v1",
      "rpf-container-entry-v1",
    ],
    slots: [slot],
    files: CORE_ENTRIES.map(({ entry }) => ({
      source: `payload/${fileSafe(texture)}.dds`,
      target: "update/update.rpf",
      entry,
      action: "replace",
      merge: {
        strategy: "ypt-texture-layer-v1",
        coreChannel: ASTRAL_PTFX_PLAYER_CORE_CHANNEL,
        coreVersion: ASTRAL_PTFX_PLAYER_CORE_VERSION,
        texture,
        slot,
      },
    })),
  };
}

/**
 * Спецификация слоя крови: один JSON маршрутов на bloodfx.dat в update.rpf.
 * Сам файл собирает установщик у игрока (`blood-routing-v1`).
 */

/** Файлы чистой игры для сравнения: ядро, weapons.meta, bloodfx.dat. */
async function gameFiles({ native, gameRoot, keys, context, stage, entries }) {
  if (!gameRoot || !native) return {};
  try {
    const result = await native(
      "extract-archive-entries",
      {
        input: path.join(gameRoot, "update", "update.rpf"),
        outputDirectory: stage,
        entries,
        gameRoot,
        keys,
      },
      context,
    );
    const found = {};
    for (const item of result?.files || [])
      found[String(item.entry).toLowerCase()] = path.join(stage, item.file);
    return found;
  } catch {
    return {};
  }
}

const clampChance = (value) => Math.max(0, Math.min(1, Number(value) || 0));

/** Что в правке крови не повторяет файл автора — словами, для заметки. */
function bloodGaps(unsupported) {
  const gaps = [];
  if (unsupported.fields)
    gaps.push(
      `${unsupported.fields} ${plural(unsupported.fields, "поле", "поля", "полей")} записей правкой не выражаются`,
    );
  if (unsupported.routes)
    gaps.push(
      `${unsupported.routes} ${plural(unsupported.routes, "клетка ведёт", "клетки ведут", "клеток ведут")} на свои записи автора`,
    );
  if (unsupported.cells)
    gaps.push(
      `${unsupported.cells} ${plural(unsupported.cells, "клетка покажет", "клетки покажут", "клеток покажут")} не то, что у автора`,
    );
  return gaps;
}

/**
 * Собирает заявку эффектов в папку `root`.
 *
 * Помощники сборщика (`extractPlan`, `extractFromSource`, `planExtraction`,
 * `coverFor`, `gate`) приходят снаружи: заявка пользуется теми же, что и
 * остальные семейства, и не тянет за собой весь модуль разбора.
 *
 * Возвращает черновик для входящих: сводку для окна и публикуемые части —
 * трассер, слой крови и слои текстур.
 */
export async function buildEffectsRequest({
  family,
  members,
  card,
  label = "",
  author = "",
  packageId,
  version = "1.0.0",
  source,
  root,
  native,
  keys,
  gameRoot,
  context,
  extractPlan,
  extractFromSource,
  planExtraction,
  coverFor,
  gate,
  readTextures = readYptTextures,
  readTracerRule = null,
}) {
  const plan = members
    .flatMap((finding) => planExtraction(finding))
    .map((item, index) => ({
      ...item,
      source: `payload/${String(index).padStart(3, "0")}-${item.source.split("/").pop()}`,
    }));
  const laid = await extractPlan(plan, {
    source,
    root,
    native,
    keys,
    gameRoot,
    context,
  });
  const cores = laid.filter((item) => /(^|\/)core\.ypt$/i.test(item.entry));
  /* Основное ядро — из `ptfx.rpf`; `_hi` и `_lo` несут те же картинки. */
  const authorCore =
    (
      cores.find((item) => /\/ptfx\.rpf\/core\.ypt$/i.test(item.entry)) ||
      cores[0]
    )?.file || null;
  const authorBlood =
    laid.find((item) => /(^|\/)bloodfx\.dat$/i.test(item.entry))?.file || null;
  const stage = path.join(root, ".effects-stage");
  const notes = [];

  try {
    if (!gameRoot)
      notes.push(
        "Папка игры не подтверждена: сравнивать не с чем, показано всё, что принёс автор.",
      );
    const game = await gameFiles({
      native,
      gameRoot,
      keys,
      context,
      stage: path.join(stage, "game"),
      entries: [
        GAME_CORE_ENTRY,
        WEAPONS_META_ENTRY,
        ...(authorBlood ? [BLOODFX_ENTRY] : []),
      ],
    });
    const authorMeta = await extractFromSource(source, {
      entries: [WEAPONS_META_ENTRY],
      outputDirectory: path.join(stage, "author"),
      gameRoot,
      keys,
      native,
      context,
    })
      .then((result) => {
        const file = result?.files?.[0];
        return file ? path.join(stage, "author", file.file) : null;
      })
      .catch(() => null);

    /* Текстуры ядра: автор против игры. */
    let authorTextures = null;
    let vanillaTextures = null;
    if (authorCore) {
      try {
        authorTextures = readTextures(await fs.readFile(authorCore));
      } catch (error) {
        notes.push(`Ядро эффектов автора не читается: ${error.message}`);
      }
    }
    const gameCore = game[GAME_CORE_ENTRY.toLowerCase()];
    if (authorTextures && gameCore) {
      try {
        vanillaTextures = readTextures(await fs.readFile(gameCore));
      } catch (error) {
        notes.push(`Ядро эффектов игры не читается: ${error.message}`);
      }
    }
    if (authorTextures && !vanillaTextures)
      notes.push(
        "Ядра чистой игры под рукой нет — показаны все текстуры ядра автора, без сравнения.",
      );
    const changes = authorTextures
      ? diffCoreTextures(authorTextures, vanillaTextures)
      : [];
    const blankedTextures = changes.filter((item) => item.change === "blanked");
    const drawn = changes.filter((item) => item.change !== "blanked");
    if (drawn.length > MAX_TEXTURES)
      notes.push(
        `Автор тронул ${drawn.length} текстур — в заявку вынуты первые ${MAX_TEXTURES}.`,
      );
    const byName = new Map(
      (authorTextures || []).map((texture) => [
        texture.name.toLowerCase(),
        texture,
      ]),
    );
    const textures = [];
    let unwritten = 0;
    for (const change of drawn.slice(0, MAX_TEXTURES)) {
      const texture = byName.get(change.name.toLowerCase());
      const item = { ...change, dds: null, preview: null };
      if (texture?.payload && RAW_FORMATS.has(texture.format)) {
        const bytes = ddsFromTexture(texture);
        const base = path.join(root, "textures", fileSafe(change.name));
        await fs.mkdir(path.dirname(base), { recursive: true });
        await fs.writeFile(`${base}.dds`, bytes);
        item.dds = `${base}.dds`;
        item.preview = await writePreview(bytes, `${base}.webp`).catch(
          () => null,
        );
      } else unwritten += 1;
      textures.push(item);
    }
    if (unwritten)
      notes.push(
        `${unwritten} текстур в форматах, которые Astral не пишет в DDS, показаны без файла.`,
      );

    /* Пустышки — выключенные ради FPS эффекты: счёт по группам и имена. */
    const blanked = blankedTextures.length
      ? {
          count: blankedTextures.length,
          kinds: [
            ...blankedTextures.reduce(
              (counts, item) =>
                counts.set(item.kind, (counts.get(item.kind) || 0) + 1),
              new Map(),
            ),
          ].map(([kind, count]) => ({
            kind,
            label: effectKindLabel(kind),
            count,
          })),
          names: blankedTextures.slice(0, 40).map((item) => item.name),
        }
      : null;
    if (blanked)
      notes.push(
        `${blanked.count} ${plural(blanked.count, "текстуру", "текстуры", "текстур")} ядра автор сжал в пустышки — эти эффекты выключены ради FPS. Рисунка в них нет, в каталог эффектов они не идут.`,
      );
    /* Своя картинка автора — не пара точек: 4×4 без штатного имени тоже
       пустышка, называть её «текстурой автора» нечестно. */
    const added = textures.filter(
      (item) =>
        item.change === "added" &&
        (item.width > BLANK_TEXTURE_SIDE || item.height > BLANK_TEXTURE_SIDE),
    );
    if (added.length)
      notes.push(
        `Свои текстуры автора (${added
          .slice(0, 4)
          .map((item) => item.name)
          .join(
            ", ",
          )}${added.length > 4 ? "…" : ""}) слоем не ставятся: в ядре нет правила, которое их рисует.`,
      );

    /* Привязки следа к оружию: правка автора — или то, что стоит в игре.
       Пулемёты техники (`VEHICLE_WEAPON_*`) в руки не берутся — их нет. */
    const readBindings = async (file) =>
      file ? readWeaponTracerBindings(await fs.readFile(file, "utf8")) : null;
    const vanillaBindings = await readBindings(
      game[WEAPONS_META_ENTRY.toLowerCase()],
    ).catch(() => null);
    const authorBindings = await readBindings(authorMeta).catch(() => null);
    const rows = diffTracerBindings(
      authorBindings || vanillaBindings || new Map(),
      authorBindings ? vanillaBindings : null,
    ).filter((row) => isHandWeapon(row.weapon));
    const authored = rows.filter((row) => row.changed && tracerVisible(row));
    const visible = authored.length ? authored : rows.filter(tracerVisible);
    const supported = new Set(TRACER_WEAPON_IDS);
    const labels = new Map(TRACER_WEAPONS.map((item) => [item.id, item.label]));
    const detected = visible.map((row) => ({
      weapon: row.weapon,
      name:
        weaponById(row.weapon)?.name || labels.get(row.weapon) || row.weapon,
      tracerFx: row.tracerFx,
      chanceSP: row.chanceSP,
      chanceMP: row.chanceMP,
      changed: row.changed,
      supported: supported.has(row.weapon),
    }));
    const bindingsSource = authored.length
      ? "redux"
      : rows.length
        ? "game"
        : "none";

    /* Трассер: главная текстура следа в раскладке слота ядра. */
    const tracerTexture =
      textures.find(
        (item) =>
          item.kind === "tracer" &&
          item.dds &&
          item.name.toLowerCase() === "ptfx_bullet_tracer",
      ) || textures.find((item) => item.kind === "tracer" && item.dds);
    let tracer = null;
    /* Кадр листа, который рисует правило автора, — в слот целиком; пустой слот — не трассер. */
    const authorClips = laid.find((item) =>
      /(^|\/)ptxclipregions\.dat$/i.test(item.entry),
    )?.file;
    const fitted = tracerTexture
      ? await tracerSlotDds({
          sheet: await fs.readFile(tracerTexture.dds),
          texture: tracerTexture.name,
          authorCore,
          clips: authorClips
            ? await fs.readFile(authorClips, "utf8").catch(() => null)
            : null,
          ...(readTracerRule ? { readRule: readTracerRule } : {}),
        })
      : null;
    if (tracerTexture && !fitted)
      notes.push(
        `Картинка следа ${tracerTexture.name} у автора пустая во всех кадрах — автор убрал след: трассером не публикуется.`,
      );
    if (fitted) {
      const directory = path.join(root, "tracer");
      await fs.mkdir(directory, { recursive: true });
      const dds = path.join(directory, "tracer.dds");
      await fs.writeFile(dds, fitted);
      const weapons = detected
        .filter((item) => item.supported)
        .map((item) => item.weapon);
      const chanceOf = (field) =>
        authored.length
          ? clampChance(Math.max(...authored.map((row) => row[field])))
          : 1;
      tracer = {
        id: `${packageId}-tracer`,
        kind: "tracer",
        name: "Трассер",
        texture: tracerTexture.name,
        textureKind: "tracer",
        directory,
        dds,
        previewFile: await writePreview(
          fitted,
          path.join(directory, "tracer.webp"),
        ).catch(() => null),
        /* Без найденных стволов — всё поддерживаемое оружие: трассер,
           который ни на что не ставится, публиковать незачем. */
        weapons: weapons.length ? weapons : [...TRACER_WEAPON_IDS],
        chanceSP: chanceOf("chanceSP"),
        chanceMP: chanceOf("chanceMP"),
        files: CORE_ENTRIES.length + 1,
        bytes: fitted.length,
        status: "prepared",
        card: {
          name: label ? `Трассер ${label}` : "Трассер",
          description: `След пули из ядра эффектов${label ? ` ${label}` : ""}: картинка ${tracerTexture.name} ставится в ядро эффектов вашей игры на выбранное оружие, остальные эффекты остаются штатными.`,
          author,
          category: "effects",
          categoryLabel: "Трейсеры",
          section: "redux",
          slot: "tracers",
          catalogCategory: "effects",
          subcategory: "Трейсеры",
        },
      };
    }

    /* Слои: перерисованные штатные текстуры, по одной на мод, картинкой
       автора как есть. Раскладку игрока (кровь редукса 1024×1024 на штатные
       512×512) установщик знает только у него и приводит к ней сам. */
    const layers = [];
    for (const texture of textures) {
      if (
        texture.change !== "changed" ||
        texture.kind === "tracer" ||
        !texture.dds ||
        !texture.base
      )
        continue;
      if (!TEXTURE_SLOT_NAME.test(texture.name)) {
        notes.push(
          `${texture.name}: слот с таким именем установщик не принимает — слой не собран.`,
        );
        continue;
      }
      if (!RAW_FORMATS.has(texture.base.format)) {
        notes.push(
          `${texture.name}: у текстуры ядра игры формат ${texture.base.format} — слоем она не пишется.`,
        );
        continue;
      }
      const id = `${packageId}-${slug(texture.name)}`.slice(0, 96);
      const spec = textureLayerSpec({
        id,
        version,
        author,
        texture: texture.name,
      });
      const broken = gate(spec);
      if (broken) {
        notes.push(`${texture.name}: слой не собирается — ${broken}`);
        continue;
      }
      const payload = await fs.readFile(texture.dds);
      const directory = path.join(root, "layers", id);
      await fs.mkdir(path.join(directory, "payload"), { recursive: true });
      await fs.writeFile(
        path.join(directory, "payload", `${fileSafe(texture.name)}.dds`),
        payload,
      );
      await fs.writeFile(
        path.join(directory, "mod.json"),
        `${JSON.stringify(spec, null, 2)}\n`,
      );
      const group = effectKindLabel(texture.kind);
      layers.push({
        id,
        kind: "texture-layer",
        name: texture.name,
        texture: texture.name,
        textureKind: texture.kind,
        directory,
        cover: await layerCover(
          payload,
          path.join(directory, "preview", "cover.png"),
        ).catch(() => null),
        previewFile: texture.preview,
        files: CORE_ENTRIES.length,
        bytes: payload.length,
        status: "prepared",
        card: {
          name: `${group}${label ? ` ${label}` : ""} · ${texture.name}`,
          description: `Перерисованная текстура ${texture.name} из ядра эффектов${label ? ` ${label}` : ""}: ставится в ядро эффектов вашей игры и меняет только эту картинку, остальные эффекты остаются штатными.`,
          author,
          category: "effects",
          categoryLabel: group,
          section: "redux",
          slot: spec.slots[0],
          catalogCategory: "effects",
          subcategory: LAYER_SUBCATEGORY[texture.kind] || "",
        },
      });
    }

    /* Кровь: правка bloodfx.dat слоем маршрутов поверх файла игрока. */
    let blood = null;
    if (authorBlood) {
      try {
        const gameBlood = game[BLOODFX_ENTRY.toLowerCase()];
        blood = analyzeBloodRouting(
          await fs.readFile(authorBlood, "utf8"),
          gameBlood ? await fs.readFile(gameBlood, "utf8") : null,
        );
      } catch (error) {
        notes.push(`bloodfx.dat автора не читается: ${error.message}`);
      }
    }
    const extraClasses = Object.entries(blood?.extra || {}).map(
      ([weaponClass, routes]) => ({
        weaponClass,
        label: BLOOD_CLASS_LABELS[weaponClass] || weaponClass,
        parts: new Set(routes.map((route) => route.bodyPart)).size,
      }),
    );
    if (blood && !blood.compared)
      notes.push(
        "bloodfx.dat игры под рукой нет — правку крови не выделить, слой крови не собран.",
      );
    if (blood?.error) notes.push(`Правка крови не собирается: ${blood.error}`);
    let bloodLayer = null;
    if (blood?.patch) {
      const id = `${packageId}-blood`.slice(0, 96);
      const spec = bloodRoutingSpec({ id, version, author });
      const broken = gate(spec);
      if (broken) notes.push(`Слой крови не собирается — ${broken}`);
      else {
        const directory = path.join(root, "blood");
        const routing = `${JSON.stringify(blood.patch, null, 2)}\n`;
        await fs.mkdir(path.join(directory, "payload"), { recursive: true });
        await fs.writeFile(
          path.join(directory, ...BLOOD_ROUTING_PAYLOAD.split("/")),
          routing,
        );
        await fs.writeFile(
          path.join(directory, "mod.json"),
          `${JSON.stringify(spec, null, 2)}\n`,
        );
        /* Маршруты для классов, которым эффект назначит человек, — рядом с
           правкой: сервер сложит выбранные при публикации. */
        await fs.writeFile(
          path.join(directory, "blood-classes.json"),
          `${JSON.stringify({ schema: 1, classes: blood.classes, extra: blood.extra }, null, 2)}\n`,
        );
        if (!blood.exact) {
          const gaps = bloodGaps(blood.unsupported);
          notes.push(
            `Слой крови повторяет файл автора не полностью${gaps.length ? `: ${gaps.join(", ")}` : ""}.`,
          );
        }
        const rulesLine = blood.rules.slice(0, 3).join(", ");
        const cover = await coverFor(
          directory,
          {
            ...family,
            preview: "card",
            title: "Попадания",
            subtitle: rulesLine || "bloodfx.dat",
          },
          [],
        ).catch(() => ({ cover: null, preview: null }));
        const classCount = blood.classes.length;
        bloodLayer = {
          id,
          kind: "blood-routing",
          name: "Попадания",
          directory,
          cover: cover.cover,
          preview: cover.preview,
          files: 1,
          bytes: Buffer.byteLength(routing),
          status: "prepared",
          blood: {
            classes: blood.classes,
            extraClasses,
            rules: blood.rules,
            exact: blood.exact,
            effects: blood.effects,
            routes: blood.routes,
          },
          card: {
            name: label ? `Попадания ${label}` : "Попадания",
            description: `Эффекты попадания из bloodfx.dat${label ? ` ${label}` : ""}${rulesLine ? ` — правила частиц ${rulesLine}` : ""}. Срабатывают у ${classCount} ${plural(classCount, "класса", "классов", "классов")} оружия. Ставятся слоем поверх bloodfx.dat игрока: меняются только записи и маршруты из правки, слой снимается отдельно.`,
            author,
            category: "effects",
            categoryLabel: "Попадания",
            section: "redux",
            slot: "blood-routing",
            catalogCategory: "effects",
            subcategory: "Попадания",
          },
        };
      }
    }

    const { cover, preview } = await coverFor(root, family, laid);
    if (tracer && cover) {
      tracer.cover = path.join(tracer.directory, "preview", "cover.png");
      await fs.mkdir(path.dirname(tracer.cover), { recursive: true });
      await fs.copyFile(cover, tracer.cover);
    }

    const relative = (file) =>
      file ? path.relative(root, file).split(path.sep).join("/") : null;
    const summary = {
      compared: {
        core: Boolean(vanillaTextures),
        weapons: Boolean(vanillaBindings),
        blood: Boolean(blood?.compared),
      },
      textures: textures.map((item) => ({
        ...item,
        dds: relative(item.dds),
        preview: relative(item.preview),
      })),
      blanked,
      tracerTexture: tracer?.texture || null,
      detected,
      bindingsSource,
      blood: blood
        ? {
            compared: blood.compared,
            exact: blood.exact,
            rules: blood.rules,
            newRules: blood.newRules,
            classes: blood.classes,
            extraClasses,
            effects: blood.effects,
            routes: blood.routes,
            unsupported: blood.unsupported,
            identical: blood.identical,
            error: blood.error,
          }
        : null,
      notes,
    };
    await fs.writeFile(
      path.join(root, "effects-request.json"),
      `${JSON.stringify(
        {
          schema: 2,
          ...summary,
          layers: layers.map((item) => item.id),
          bloodLayer: bloodLayer?.id || null,
        },
        null,
        2,
      )}\n`,
    );

    return {
      id: packageId,
      family: family.id,
      kind: "effects",
      title: family.title,
      card,
      directory: root,
      cover,
      preview,
      files: laid.length,
      bytes: family.bytes,
      omitted: [],
      delivery: "effects",
      effects: summary,
      children: [
        ...(tracer ? [tracer] : []),
        ...(bloodLayer ? [bloodLayer] : []),
        ...layers,
      ],
    };
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}
