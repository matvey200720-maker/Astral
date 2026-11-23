/*
 * Обложка мини-карты — кадром редактора мини-карты.
 *
 * Мини-карту нельзя сфотографировать вне игры: полосы здоровья и брони
 * Scaleform рисует скриптом. Но всё, что поменял автор, лежит в самом
 * `minimap.gfx`, и обложка собирает из этого ту же композицию, что показывает
 * редактор мини-карты (`MinimapPreview`): рамка радара 180:131 с полем карты
 * из игры, полосы по раскладке редактора, цифры и стрелка игрока — на чёрном
 * матовом фоне каталога.
 *
 * Что читается из файла и почему именно так — по настоящим файлам:
 *
 *  • Раскладка и толщина — матрица контейнера `healthArmourMC` внутри
 *    `HEALTH_ARMOUR_ABILITY_SMALL`: это полосы обычной мини-карты. Тот же
 *    контейнер стоит ещё в `…_BIG` (развёрнутый радар) и в `GOLF` (гольф) со
 *    своими матрицами, и первое попавшееся размещение легко оказывается чужим.
 *  • Цвет — только если автор его задал. Штатный `MINIMAP.as` сам красит
 *    полосы цветами HUD (`Colour.Colourise`), и цвет размещения в файле игра
 *    перебивает. Автор, который красит полосы по-своему, выключает это в
 *    скрипте и задаёт цвет преобразованием размещения — так у HLS сделан
 *    фиолетовый. Поэтому оттенок RGB в размещении полосы и есть признак
 *    авторского цвета; без него берутся цвета редактора. Прозрачность
 *    размещения тот же скрипт перебивает всегда (`_alpha = 100`), и видна
 *    прозрачность самого символа полосы.
 *  • Цифры — если в контейнере есть поля `healthNum` и `armourNum`. В
 *    штатном файле их нет, у HLS есть, и обложка без них врала бы.
 *  • Картинки, вложенные в файл, не рисуются. У HLS паук стоит только в
 *    `GOLF`, а фиолетовая стрелка не подключена ни к одной фигуре — в игре
 *    их не видно, и на обложке их быть не должно.
 *
 * Разбор XML — чистые функции (`inspectMinimapGfxXml`), их держат тесты на
 * выдержках из настоящих файлов; всё остальное — поле карты и рендер.
 */

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { MINIMAP_GAME_COLORS } from "@modovik/minimap-contract";
import { runNodeScript } from "./node-script.js";
import { resolveFfdec, swfToXml } from "./ffdec.js";
import { readWorldMapTiles } from "./world-map-customizer.js";

/* Штатное место контейнера полос в `HEALTH_ARMOUR_ABILITY_SMALL`, в твипах:
   выше половины этой высоты — полосы сверху; повёрнутый контейнер — сбоку. */
const STOCK_BAR_Y = 2520;
const STOCK_RADAR_WIDTH = 5037;
/* Единица масштаба матрицы SWF: числа 16.16. */
const MATRIX_UNIT = 65536;

/*
 * Цвета мини-карты самой игры — для файла, где автор цвет не задавал. Взяты
 * из `common/data/ui/hudcolor.dat` (`MINIMAP_GAME_COLORS`), потому что такой
 * файл в игре именно ими и красится.
 */
export const EDITOR_VITALS = Object.freeze({
  health: MINIMAP_GAME_COLORS.health,
  armor: MINIMAP_GAME_COLORS.armor,
  track: "#111723",
});

/** Сторона плитки в подложке редактора (`MINIMAP_FIELD_TILE`). */
export const EDITOR_FIELD_TILE = 512;

/** Здоровье и броня на обложке: полная полоса и половина, чтобы видна была дорожка. */
export const COVER_DEMO = Object.freeze({ health: 100, armor: 50 });

const attribute = (tag, name) => {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(` ${tag || ""}`);
  return match ? match[1] : null;
};

const flag = (tag, name) => attribute(tag, name) === "true";

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return value != null && Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Оглавление XML FFDec: определения по номеру и имена экспорта.
 *
 * Определения в файле лежат плоским списком. Тело спрайта — его `subTags`;
 * тело фигуры или текстового поля — всё до следующего определения.
 */
export function indexGfxXml(xml) {
  const source = String(xml || "");
  const definitions = new Map();
  const heads = [
    ...source.matchAll(/<item type="(Define[A-Za-z0-9]*Tag)"[^>]*>/g),
  ];
  heads.forEach((match, position) => {
    const id =
      attribute(match[0], "spriteId") ??
      attribute(match[0], "shapeId") ??
      attribute(match[0], "characterID") ??
      attribute(match[0], "characterId");
    if (id == null || definitions.has(id)) return;
    const next =
      position + 1 < heads.length ? heads[position + 1].index : source.length;
    let body = source.slice(match.index, next);
    if (match[1] === "DefineSpriteTag") {
      const close = body.indexOf("</subTags>");
      if (close > 0) body = body.slice(0, close);
    }
    definitions.set(id, { type: match[1], body });
  });

  const exports = new Map();
  for (const block of source.matchAll(
    /<item type="ExportAssetsTag">([\s\S]*?)<\/names>/g,
  )) {
    const [tags = "", names = ""] = block[1].split("<names>");
    const ids = [...tags.matchAll(/<item>(\d+)<\/item>/g)].map((m) => m[1]);
    const labels = [...names.matchAll(/<item>([^<]*)<\/item>/g)].map(
      (m) => m[1],
    );
    ids.forEach((id, position) => {
      const label = labels[position];
      if (label && !exports.has(label)) exports.set(label, id);
    });
  }
  return { definitions, exports };
}

function parseMatrix(tag) {
  if (!tag) return { a: MATRIX_UNIT, b: 0, c: 0, d: MATRIX_UNIT, tx: 0, ty: 0 };
  const scaled = flag(tag, "hasScale");
  const rotated = flag(tag, "hasRotate");
  return {
    a: scaled ? number(attribute(tag, "scaleX"), MATRIX_UNIT) : MATRIX_UNIT,
    d: scaled ? number(attribute(tag, "scaleY"), MATRIX_UNIT) : MATRIX_UNIT,
    b: rotated ? number(attribute(tag, "rotateSkew0")) : 0,
    c: rotated ? number(attribute(tag, "rotateSkew1")) : 0,
    tx: number(attribute(tag, "translateX")),
    ty: number(attribute(tag, "translateY")),
  };
}

const CHANNELS = ["red", "green", "blue", "alpha"];
const IDENTITY_CXFORM = Object.freeze({
  mult: [256, 256, 256, 256],
  add: [0, 0, 0, 0],
});

function parseCxform(tag) {
  if (!tag) return IDENTITY_CXFORM;
  const multiplied = flag(tag, "hasMultTerms");
  const added = flag(tag, "hasAddTerms");
  return {
    mult: CHANNELS.map((channel) =>
      multiplied ? number(attribute(tag, `${channel}MultTerm`), 256) : 256,
    ),
    add: CHANNELS.map((channel) =>
      added ? number(attribute(tag, `${channel}AddTerm`), 0) : 0,
    ),
  };
}

const clampChannel = (value) => Math.max(0, Math.min(255, value));

/** Цветовое преобразование SWF: `канал × mult / 256 + add`. */
const transformColor = (rgba, cxform) =>
  rgba.map((value, channel) =>
    clampChannel((value * cxform.mult[channel]) / 256 + cxform.add[channel]),
  );

/** Размещения внутри спрайта — имя, символ, матрица и цвет. */
function placementsOf(index, id) {
  const body = index.definitions.get(String(id))?.body || "";
  return [
    ...body.matchAll(
      /<item type="PlaceObject\d?Tag"([^>]*?)(?:\/>|>([\s\S]*?)<\/item>)/g,
    ),
  ].map((match) => {
    const inner = match[2] || "";
    return {
      name: attribute(match[1], "name"),
      characterId: attribute(match[1], "characterId"),
      matrix: parseMatrix(/<matrix[^>]*\/>/.exec(inner)?.[0]),
      cxform: parseCxform(/<colorTransform[^>]*\/>/.exec(inner)?.[0]),
    };
  });
}

const WHITE = Object.freeze([255, 255, 255, 255]);

/**
 * Цвет символа — заливка фигуры, пропущенная через цветовые преобразования
 * вложенных размещений. Текстура вместо заливки считается белой: полосу
 * красят поверх неё.
 */
function symbolColor(index, id, depth = 0) {
  const definition = index.definitions.get(String(id));
  if (!definition || depth > 8) return [...WHITE];
  if (definition.type === "DefineSpriteTag") {
    const child = placementsOf(index, id).find((item) => item.characterId);
    return child
      ? transformColor(
          symbolColor(index, child.characterId, depth + 1),
          child.cxform,
        )
      : [...WHITE];
  }
  const solid = /<color type="RGBA?"[^>]*\/>/.exec(definition.body)?.[0];
  if (!solid) return [...WHITE];
  return [
    number(attribute(solid, "red")),
    number(attribute(solid, "green")),
    number(attribute(solid, "blue")),
    number(attribute(solid, "alpha"), 255),
  ];
}

const hexChannel = (value) =>
  Math.round(clampChannel(value)).toString(16).padStart(2, "0");

/** CSS-цвет из RGBA 0–255: непрозрачный — `#rrggbb`, иначе `rgba()`. */
export function cssColor([red, green, blue, alpha = 255]) {
  const opacity = Math.round((clampChannel(alpha) / 255) * 1000) / 1000;
  if (opacity >= 1)
    return `#${hexChannel(red)}${hexChannel(green)}${hexChannel(blue)}`;
  return `rgba(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}, ${opacity})`;
}

/**
 * Полоса или дорожка по имени размещения.
 *
 * `tinted` — задал ли автор оттенок RGB в самом размещении. Прозрачность
 * размещения в цвет не входит: скрипт всё равно ставит полосе `_alpha = 100`.
 */
function vital(index, parentId, name) {
  const placed = placementsOf(index, parentId).find(
    (item) => item.name === name,
  );
  if (!placed?.characterId) return null;
  const inner = symbolColor(index, placed.characterId);
  const { mult, add } = placed.cxform;
  const tinted = [0, 1, 2].some(
    (channel) => mult[channel] !== 256 || add[channel] !== 0,
  );
  const rgba = [
    ...[0, 1, 2].map((channel) =>
      clampChannel((inner[channel] * mult[channel]) / 256 + add[channel]),
    ),
    inner[3],
  ];
  return { tinted, rgba, placed };
}

/** Цвет текстового поля или белый, если поле цвет не хранит. */
function textColor(index, id) {
  const definition = index.definitions.get(String(id));
  const tag = /<textColor[^>]*\/>/.exec(definition?.body || "")?.[0];
  if (!tag) return "#ffffff";
  return cssColor([
    number(attribute(tag, "red"), 255),
    number(attribute(tag, "green"), 255),
    number(attribute(tag, "blue"), 255),
    number(attribute(tag, "alpha"), 255),
  ]);
}

/** Контейнер полос обычной мини-карты: по имени экспорта, иначе первый. */
function smallHealthContainer(index) {
  const exported = index.exports.get("HEALTH_ARMOUR_ABILITY_SMALL");
  const candidates = exported
    ? [exported]
    : [...index.definitions.entries()]
        .filter(([, definition]) => definition.type === "DefineSpriteTag")
        .map(([id]) => id);
  for (const id of candidates) {
    const placed = placementsOf(index, id).find(
      (item) => item.name === "healthArmourMC",
    );
    if (placed?.characterId) return { id, placed };
  }
  return null;
}

/**
 * Раскладка редактора по контейнеру полос.
 *
 * Здоровье и броня внутри контейнера стоят либо рядом (броня сдвинута по x),
 * либо стопкой (по y). Повёрнутый контейнер ставит ту же пару вдоль края:
 * рядом — одной линией, стопкой — двумя.
 */
function vitalsLayout(index, container) {
  const { matrix } = container.placed;
  const inside = placementsOf(index, container.placed.characterId);
  const health = inside.find((item) => item.name === "healthBar");
  const armor = inside.find((item) => item.name === "armourBar");
  const dx = Math.abs((armor?.matrix.tx ?? 1820) - (health?.matrix.tx ?? 0));
  const dy = Math.abs((armor?.matrix.ty ?? 0) - (health?.matrix.ty ?? 0));
  const stacked = dy > dx;
  if (matrix.b !== 0 || matrix.c !== 0) {
    const side = matrix.tx < STOCK_RADAR_WIDTH / 2 ? "left" : "right";
    return `${side}-${stacked ? "vertical" : "split"}`;
  }
  const edge = matrix.ty < STOCK_BAR_Y / 2 ? "top" : "bottom";
  return `${edge}-${stacked ? "stack" : "row"}`;
}

/**
 * Разбирает XML `minimap.gfx` (FFDec `-swf2xml`) в раскладку обложки.
 *
 * Возвращает раскладку полос в терминах редактора, толщину относительно
 * штатной, цвета, цифры и признаки того, что из этого найдено в файле.
 */
export function inspectMinimapGfxXml(xml) {
  const index = indexGfxXml(xml);
  const container = smallHealthContainer(index);
  if (!container)
    return {
      layout: "bottom-row",
      thickness: 1,
      colors: { ...EDITOR_VITALS },
      numbers: null,
      detected: { layout: false, colors: false, numbers: false },
    };

  const barsId = container.placed.characterId;
  const { c, d } = container.placed.matrix;
  const thickness =
    Math.round(
      Math.max(0.5, Math.min(3, Math.hypot(c, d) / MATRIX_UNIT)) * 1000,
    ) / 1000;

  const health = vital(index, barsId, "healthBar");
  const armor = vital(index, barsId, "armourBar");
  const authored = Boolean(health?.tinted || armor?.tinted);
  const trough = authored ? vital(index, barsId, "healthTrough") : null;
  const colors = authored
    ? {
        health: health ? cssColor(health.rgba) : EDITOR_VITALS.health,
        armor: armor ? cssColor(armor.rgba) : EDITOR_VITALS.armor,
        track: trough ? cssColor(trough.rgba) : EDITOR_VITALS.track,
      }
    : { ...EDITOR_VITALS };

  const fields = placementsOf(index, container.id);
  const healthNumber = fields.find((item) => item.name === "healthNum");
  const armorNumber = fields.find((item) => item.name === "armourNum");
  const numbers =
    healthNumber || armorNumber
      ? {
          health: healthNumber
            ? textColor(index, healthNumber.characterId)
            : null,
          armor: armorNumber ? textColor(index, armorNumber.characterId) : null,
        }
      : null;

  return {
    layout: vitalsLayout(index, container),
    thickness,
    colors,
    numbers,
    detected: { layout: true, colors: authored, numbers: Boolean(numbers) },
  };
}

/**
 * Поле карты — весь атлас плиток из игры игрока, как у редактора.
 *
 * Редактор (`hud-map-field.js`) сшивает плитки целиком — море под сушей,
 * сторона плитки не больше `MINIMAP_FIELD_TILE` — и вписывает кадр в рамку
 * с обрезкой по краям. Обложка делает то же, иначе поле на ней было бы не
 * тем, что человек видел в редакторе. Без игры поля нет — это отмечается.
 */
export async function buildMinimapField(
  output,
  { gameRoot, stateDir, native, context, keys },
) {
  if (!gameRoot) throw new Error("папка игры не подтверждена");
  const { atlasFromTiles, parseTileName, tileRect } =
    await import("@modovik/vector-map");
  const loaded = await readWorldMapTiles(
    { gameRoot, keys },
    context,
    stateDir,
    native ? { native } : {},
  );
  const placed = (loaded?.tiles || [])
    .map((tile) => ({ tile, position: parseTileName(tile.name) }))
    .filter((item) => item.position)
    .sort((left, right) =>
      left.position.layer === right.position.layer
        ? 0
        : left.position.layer === "sea"
          ? -1
          : 1,
    );
  if (!placed.length) throw new Error("плитки карты не найдены");

  const atlas = atlasFromTiles(placed.map((item) => item.tile));
  const sides = placed
    .map(({ tile }) => Math.max(tile.width || 0, tile.height || 0))
    .filter((side) => side > 0);
  const side = sides.length
    ? Math.min(EDITOR_FIELD_TILE, Math.max(...sides))
    : EDITOR_FIELD_TILE;
  const width = atlas.columns * side;
  const height = atlas.rows * side;

  const layers = [];
  for (const { tile, position } of placed) {
    const rect = tileRect(position.column, position.row, atlas);
    layers.push({
      input: await sharp(Buffer.from(tile.png))
        .resize(
          Math.round(rect.width * width),
          Math.round(rect.height * height),
        )
        .png()
        .toBuffer(),
      left: Math.round(rect.u * width),
      top: Math.round(rect.v * height),
    });
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png()
    .toFile(output);
  return { file: output, width, height };
}

const dataUrl = async (file) =>
  `data:image/png;base64,${(await fs.readFile(file)).toString("base64")}`;

/* Рисованная подложка редактора — ею он живёт, когда игры нет. */
const PAINTED_FIELD = [
  "apps",
  "web",
  "public",
  "assets",
  "workshop",
  "minimap",
  "minimap-gfx-field.png",
];

/**
 * Рисует обложку мини-карты из чужого `minimap.gfx`.
 *
 * Возвращает описание кадра для `preview.json`: раскладка, толщина, цвета,
 * есть ли цифры, откуда поле, — и что из этого найдено в файле, а что взято
 * у редактора.
 */
export async function renderMinimapCover(
  output,
  {
    gfx,
    workspace,
    stage,
    native,
    context,
    gameRoot,
    stateDir,
    keys,
    width = 1200,
    height = 675,
  },
) {
  const ffdec = await resolveFfdec({ workspace });
  if (!ffdec) throw new Error("FFDec не найден — мини-карту не разобрать");
  await fs.mkdir(stage, { recursive: true });
  const xml = await swfToXml(ffdec, gfx, path.join(stage, "minimap.xml"));
  const inspected = inspectMinimapGfxXml(xml);

  let field = null;
  let fieldNote = null;
  try {
    const built = await buildMinimapField(path.join(stage, "field.png"), {
      gameRoot,
      stateDir,
      native,
      context,
      keys,
    });
    field = await dataUrl(built.file);
  } catch (error) {
    fieldNote = String(error?.message || error);
  }
  const painted = field
    ? null
    : await dataUrl(path.join(workspace, ...PAINTED_FIELD)).catch(() => null);

  const stateFile = path.join(stage, "minimap-state.json");
  await fs.writeFile(
    stateFile,
    JSON.stringify({
      width,
      height,
      layout: inspected.layout,
      thickness: inspected.thickness,
      colors: inspected.colors,
      numbers: inspected.numbers,
      demo: COVER_DEMO,
      field: field || painted,
    }),
    "utf8",
  );
  await runNodeScript(
    path.join(workspace, "scripts", "render-minimap-preview.js"),
    [stateFile, output, "--width", String(width), "--height", String(height)],
    { cwd: workspace },
  );
  return {
    kind: "minimap",
    layout: inspected.layout,
    thickness: inspected.thickness,
    colors: inspected.colors,
    numbers: Boolean(inspected.numbers),
    detected: inspected.detected,
    field: field ? "game" : painted ? "painted" : "none",
    ...(fieldNote ? { fieldNote } : {}),
  };
}
