/*
 * Лист «Расписания» — рисует окно (задача 11 ТЗ 10.10.2026, вечер).
 *
 * У табло сервера листа нет: буквы и плашки — сетки модели. Своё табло —
 * плашка во весь щит с листом 2048 × 1024, и этот лист рисуется здесь, одной
 * функцией для кадра, плиток, обложки и «Применить»: заголовок, шестнадцать
 * строк (плашка, квадрат значка, значок, название слева, время справа),
 * фон и рамка щита — по раскладке табло сервера (`scheduleLayout`
 * договора), цвета, прозрачность и шрифт — работы.
 *
 * Щит 1,8 : 1 ложится на лист 2 : 1: рисунок идёт в точках ширины листа, а
 * по высоте сжимается (`squash`) — на плашке буквы снова ровные. Шрифты —
 * системные шрифты Windows (как у надписей мастерской) или свой файл из
 * хранилища окна; ширина букв — растяжкой по горизонтали; длинное название
 * сжимается, чтобы не наехать на время.
 *
 * Значки сервера — его рисунки, вырезанные по квадрату (`icons/*.png`),
 * перекрашенные в цвет значков по своей альфе; значки Astral — свои
 * векторные рисунки (`schedule-icons.js` договора) тем же цветом; свои
 * картинки — как есть, вписанные в квадрат. Облик сервера (`server.png`) —
 * его табло, отрисованное по его сеткам: кадр показывает его, пока работа
 * «как на сервере».
 *
 * Строк — сколько в работе (задача 4 ТЗ 11.10.2026, утро): раскладку даёт
 * договор (`scheduleLayout(работа)`), до шестнадцати — места сервера.
 */

import {
  SCHEDULE_ASTRAL_ICON_GRID,
  SCHEDULE_ICONS,
  SCHEDULE_ICON_IMAGE,
  SCHEDULE_ICON_NONE,
  SCHEDULE_INVENTORY,
  SCHEDULE_SHEET,
  findScheduleAstralIcon,
  normalizeScheduleProject,
  scheduleIconKind,
  scheduleIsStock,
  scheduleLayout,
} from "@modovik/climb-contract/recolor/schedule";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { emblemFontFamily, ensureEmblemFont } from "../emblem/emblem-fonts.js";
import { loadSceneImage } from "../model-stage/scene-textures.js";

/* Раскладка по числу строк и колонкам работы — одна на сочетание. */
const layouts = new Map();
export function sheetLayout(project) {
  const key = `${project.rows.length}|${project.columns}`;
  if (!layouts.has(key)) layouts.set(key, scheduleLayout(project));
  return layouts.get(key);
}
/* Щит без работы — места сервера: пропорция и заголовок от него. */
const LAYOUT = scheduleLayout();

/* Слова, как они встанут на щит (заглавными, если так выбрано). */
const shown = (value, upper) => {
  const text = String(value ?? "").trim();
  return upper ? text.toLocaleUpperCase("ru-RU") : text;
};

/* Шрифты листа — те же семейства, что у надписей мастерской (`emblem-items.js`). */
export const SCHEDULE_FONT_FACES = Object.freeze({
  block: { weight: 900, family: `"Arial Black", "Segoe UI Black", Impact, sans-serif` },
  wide: { weight: 900, family: `"Segoe UI Black", "Arial Black", sans-serif` },
  modern: { weight: 700, family: `Bahnschrift, "Segoe UI", sans-serif` },
  serif: { weight: 700, family: `Georgia, "Times New Roman", serif` },
  stencil: { weight: 400, family: `Stencil, "Stencil Std", Impact, "Arial Black", sans-serif` },
  script: { weight: 700, style: "italic", family: `"Segoe Script", "Brush Script MT", "Segoe Print", cursive` },
  mono: { weight: 700, family: `Consolas, "Cascadia Mono", "Courier New", monospace` },
});

function faceOf(project) {
  if (project.font === "custom" && project.fontAsset) return { weight: 400, family: `"${emblemFontFamily(project.fontAsset)}", "Arial Black", sans-serif` };
  return SCHEDULE_FONT_FACES[project.font] || SCHEDULE_FONT_FACES.block;
}
const fontString = (face, size) => `${face.style || "normal"} ${face.weight} ${Math.max(1, size)}px ${face.family}`;

function canvasOf(width, height) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context2d(canvas) {
  try {
    return canvas?.getContext("2d") || null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Картинки: значки сервера, свои картинки, облик сервера
 * ------------------------------------------------------------------ */

const images = new Map();

function loadUrl(url) {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve(null);
      return;
    }
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** Картинка по адресу поставки — один раз на окно; `null`, если не загрузилась. */
function publicImage(url) {
  if (!images.has(url))
    images.set(
      url,
      loadUrl(url).then((image) => {
        if (!image) images.delete(url);
        return image;
      }),
    );
  return images.get(url);
}

/** Своя картинка строки из хранилища окна. */
function ownImage(asset) {
  const key = `asset:${asset}`;
  if (!images.has(key))
    images.set(
      key,
      getWorkshopAsset(asset)
        .then(async (blob) => {
          if (!blob) return null;
          if (typeof createImageBitmap === "function") return createImageBitmap(blob);
          const url = URL.createObjectURL(blob);
          try {
            return await loadUrl(url);
          } finally {
            URL.revokeObjectURL(url);
          }
        })
        .catch(() => null)
        .then((image) => {
          if (!image) images.delete(key);
          return image;
        }),
    );
  return images.get(key);
}

/** Облик табло сервера (`server.png`): `HTMLImageElement` или `null`. */
export const loadServerSheet = () => publicImage(SCHEDULE_INVENTORY.server.url);

/**
 * Всё, что листу нужно до рисования: шрифт (свой — в набор шрифтов
 * документа), значки сервера и свои картинки видимых строк. Ответ —
 * `{ icons: Map, images: Map, font: true|false }`.
 */
export async function prepareScheduleSheet(input) {
  const project = normalizeScheduleProject(input);
  const visible = project.rows.filter((row) => !row.hidden);
  const iconIds = [...new Set(visible.map((row) => row.icon).filter((id) => scheduleIconKind(id) === "server"))];
  const assets = [...new Set(visible.filter((row) => row.icon === SCHEDULE_ICON_IMAGE).map((row) => row.image.asset))];
  const [font, iconPairs, imagePairs] = await Promise.all([
    project.font === "custom" ? ensureEmblemFont(project.fontAsset) : Promise.resolve(true),
    Promise.all(iconIds.map(async (id) => [id, await publicImage(SCHEDULE_ICONS.find((icon) => icon.id === id).url)])),
    Promise.all(assets.map(async (asset) => [asset, await ownImage(asset)])),
  ]);
  /* Системный шрифт — в набор документа до рисования (иначе холст напишет запасным). */
  const face = faceOf(project);
  if (globalThis.document?.fonts?.load) await document.fonts.load(fontString(face, 64), "РАСПИСАНИЕ 0123456789").catch(() => {});
  return { icons: new Map(iconPairs.filter(([, image]) => image)), images: new Map(imagePairs.filter(([, image]) => image)), font };
}

/* ------------------------------------------------------------------ *
 * Рисование
 * ------------------------------------------------------------------ */

function roundRect(context, x0, y0, x1, y1, radius) {
  const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2));
  context.beginPath();
  context.moveTo(x0 + r, y0);
  context.arcTo(x1, y0, x1, y1, r);
  context.arcTo(x1, y1, x0, y1, r);
  context.arcTo(x0, y1, x0, y0, r);
  context.arcTo(x0, y0, x1, y0, r);
  context.closePath();
}

/* Высота заглавной буквы шрифта в долях кегля — по «Н» и «H», один раз на шрифт. */
const capRatios = new Map();
function capRatio(context, face) {
  const key = `${face.weight}|${face.style || ""}|${face.family}`;
  if (!capRatios.has(key)) {
    context.font = fontString(face, 100);
    const ascent = Math.max(context.measureText("Н").actualBoundingBoxAscent || 0, context.measureText("H").actualBoundingBoxAscent || 0);
    capRatios.set(key, ascent > 10 ? ascent / 100 : 0.72);
  }
  return capRatios.get(key);
}

/*
 * Строка текста: кегль — по высоте заглавной, ширина букв — растяжкой,
 * длинная строка сжимается до `maxWidth`. `align` — left, right, center.
 * Возвращает ширину нарисованного.
 */
function drawLine(context, text, { x, baseline, cap, face, stretch, align = "left", maxWidth = 0, colour }) {
  if (!text) return 0;
  const size = cap / capRatio(context, face);
  context.font = fontString(face, size);
  const natural = context.measureText(text).width * stretch;
  const fit = maxWidth > 0 && natural > maxWidth ? maxWidth / natural : 1;
  const width = natural * fit;
  const left = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
  context.save();
  context.translate(left, baseline);
  context.scale(stretch * fit, 1);
  context.fillStyle = colour;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillText(text, 0, 0);
  context.restore();
  return width;
}

/*
 * Где на листе стоят буквы строки и заголовка — для правки прямо по ним, как
 * надпись «Большой карты» (18.10.2026, владелец: «тыкаешь два раза по тексту,
 * и у тебя именно текст открывается»). Кегль, растяжка, сжатие длинной
 * строки и край — тем же расчётом, что у `drawLine`, только без рисования:
 * прозрачное поле поверх листа ставит каретку между нарисованными буквами.
 */
let measureContext;
function measurer() {
  if (measureContext === undefined) measureContext = context2d(canvasOf(8, 8));
  return measureContext;
}

function lineBox(text, { x, cap, face, stretch, align = "left", maxWidth = 0 }) {
  const context = measurer();
  const size = cap / (context ? capRatio(context, face) : 0.72);
  let natural = 0;
  if (context && text) {
    context.font = fontString(face, size);
    natural = context.measureText(text).width * stretch;
  }
  const fit = maxWidth > 0 && natural > maxWidth ? maxWidth / natural : 1;
  const width = natural * fit;
  const left = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
  return { left, width, size, scale: stretch * fit };
}

/**
 * Места букв для правки на листе: `{ kind: "title" }` или `{ kind: "row", index }`.
 * В осях раскладки (`sheetLayout`): `font` — шрифт листа, `baseline`, `cap`;
 * у строки — `name` и `time`, у заголовка — `title`: где начинаются буквы
 * (`left`), их ширина, кегль, растяжка по ширине и поле, в котором им стоять
 * (`area` — от и до).
 */
export function scheduleTextPlaces(input, target) {
  const project = normalizeScheduleProject(input);
  const layout = sheetLayout(project);
  const face = faceOf(project);
  const stretch = project.letters / 100;
  const font = { ...face, upper: project.upper };
  if (target?.kind === "title") {
    const heading = layout.heading;
    const box = lineBox(shown(project.title, project.upper), { x: heading.x, cap: heading.cap, face, stretch, align: "center", maxWidth: heading.width });
    return {
      font,
      cap: heading.cap,
      baseline: heading.y + heading.cap / 2,
      /* Рамка — по буквам заголовка с полем по краям, не во всю ширину щита. */
      title: {
        ...box,
        align: "center",
        area: [heading.x - Math.max(box.width / 2 + heading.cap * 0.6, heading.cap * 2), heading.x + Math.max(box.width / 2 + heading.cap * 0.6, heading.cap * 2)],
        colour: project.colours.title,
      },
    };
  }
  const slot = layout.rows[target?.index];
  const row = project.rows[target?.index];
  if (!slot || !row) return null;
  const nameX = row.icon === SCHEDULE_ICON_NONE ? slot.box[0] + slot.gap : slot.nameX;
  const time = shown(row.time, project.upper);
  const timeShare = time.length > 8 ? 0.66 : 0.6;
  const timeBox = lineBox(time, { x: slot.timeX, cap: slot.cap, face, stretch, align: "right", maxWidth: (slot.timeX - nameX) * timeShare });
  /* Пустому времени — место под «00:00», чтобы было куда поставить каретку. */
  const timeLeft = Math.min(timeBox.left, slot.timeX - slot.cap * 3.2);
  const nameBox = lineBox(shown(row.text, project.upper), { x: nameX, cap: slot.cap, face, stretch, maxWidth: slot.timeX - nameX - (timeBox.width ? timeBox.width + slot.gap : 0) });
  return {
    font,
    cap: slot.cap,
    baseline: slot.centreY + slot.cap / 2,
    plate: [slot.plate[1], slot.plate[3]],
    name: { ...nameBox, align: "left", area: [nameX, Math.max(nameX + slot.cap, timeLeft - slot.gap)], colour: project.colours.text },
    time: { ...timeBox, align: "right", area: [timeLeft, slot.timeX], colour: project.colours.time },
  };
}

/* Значок сервера в цвет значков: его альфа — маска (кэш по значку и цвету). */
const tinted = new Map();
function tintedIcon(image, colour) {
  const key = `${image.src || image.width}|${colour}`;
  if (tinted.has(key)) return tinted.get(key);
  const canvas = canvasOf(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const context = context2d(canvas);
  if (!context) return image;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = colour;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (tinted.size > 64) tinted.clear();
  tinted.set(key, canvas);
  return canvas;
}

/* Значок Astral — путь на сетке 64 × 64, вписанный в квадрат строки. */
const astralPaths = new Map();
function astralPath(id) {
  if (typeof Path2D !== "function") return null;
  if (!astralPaths.has(id)) {
    const icon = findScheduleAstralIcon(id);
    astralPaths.set(id, icon ? new Path2D(icon.path) : null);
  }
  return astralPaths.get(id);
}

function drawAstralIcon(context, id, [x0, y0, x1, y1], colour) {
  const path = astralPath(id);
  if (!path) return;
  /* Рисунки сервера занимают квадрат почти целиком — свои чуть меньше, с тем же воздухом. */
  const side = Math.min(x1 - x0, y1 - y0) * 0.86;
  context.save();
  context.translate((x0 + x1) / 2 - side / 2, (y0 + y1) / 2 - side / 2);
  context.scale(side / SCHEDULE_ASTRAL_ICON_GRID, side / SCHEDULE_ASTRAL_ICON_GRID);
  context.fillStyle = colour;
  context.fill(path, "nonzero");
  context.restore();
}

/* Своя картинка — вписанная в квадрат с полями. */
function drawContain(context, image, [x0, y0, x1, y1], pad) {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  if (!w || !h) return;
  const boxW = x1 - x0 - pad * 2;
  const boxH = y1 - y0 - pad * 2;
  const scale = Math.min(boxW / w, boxH / h);
  const dw = w * scale;
  const dh = h * scale;
  context.drawImage(image, x0 + (x1 - x0 - dw) / 2, y0 + (y1 - y0 - dh) / 2, dw, dh);
}

/**
 * Лист работы на холсте `context` размера `width × height` (весь лист — от
 * 2048 × 1024 до плитки). `assets` — из `prepareScheduleSheet`; чего в нём
 * нет (значок не загрузился), то не рисуется.
 */
export function paintScheduleSheet(context, input, assets, { width = SCHEDULE_SHEET.width, height = SCHEDULE_SHEET.height } = {}) {
  const project = normalizeScheduleProject(input);
  const layout = sheetLayout(project);
  const face = faceOf(project);
  const stretch = project.letters / 100;
  const board = project.opacity.board / 100;
  context.save();
  context.clearRect(0, 0, width, height);
  /* Точки ширины листа → холст: по высоте щит 1,8 : 1 сжимается в лист. */
  context.setTransform(width / layout.width, 0, 0, height / layout.height, 0, 0);
  const H = layout.height;
  const W = layout.width;
  const { outline } = layout;
  /* Фон щита и рамка. */
  if (board > 0 && project.opacity.background > 0) {
    context.globalAlpha = board * (project.opacity.background / 100);
    context.fillStyle = project.colours.background;
    roundRect(context, 0, 0, W, H, outline.radius);
    context.fill();
  }
  if (board > 0 && project.opacity.outline > 0) {
    context.globalAlpha = board * (project.opacity.outline / 100);
    context.strokeStyle = project.colours.outline;
    context.lineWidth = outline.width;
    roundRect(context, outline.width / 2, outline.width / 2, W - outline.width / 2, H - outline.width / 2, outline.radius - outline.width / 2);
    context.stroke();
  }
  if (board > 0) {
    /* Заголовок. */
    context.globalAlpha = board;
    drawLine(context, shown(project.title, project.upper), {
      x: layout.heading.x,
      baseline: layout.heading.y + layout.heading.cap / 2,
      cap: layout.heading.cap,
      face,
      stretch,
      align: "center",
      maxWidth: layout.heading.width,
      colour: project.colours.title,
    });
    /* Строки. */
    for (const slot of layout.rows) {
      const row = project.rows[slot.index];
      if (row.hidden) continue;
      const iconless = row.icon === SCHEDULE_ICON_NONE;
      /* Без значка плашка начинается там, где был квадрат: край колонки ровный. */
      const [px0, py0, px1, py1] = iconless ? [slot.box[0], ...slot.plate.slice(1)] : slot.plate;
      if (project.opacity.plates > 0) {
        context.globalAlpha = board * (project.opacity.plates / 100);
        context.fillStyle = row.accent ? project.colours.accent : project.colours.plate;
        roundRect(context, px0, py0, px1, py1, slot.radius);
        context.fill();
      }
      if (project.opacity.boxes > 0 && !iconless) {
        context.globalAlpha = board * (project.opacity.boxes / 100);
        context.fillStyle = project.colours.box;
        roundRect(context, ...slot.box, slot.radius);
        context.fill();
      }
      context.globalAlpha = board;
      const kind = scheduleIconKind(row.icon);
      if (kind === "image") {
        const image = assets?.images?.get(row.image.asset);
        if (image) drawContain(context, image, slot.box, (slot.box[3] - slot.box[1]) * 0.1);
      } else if (kind === "astral") {
        drawAstralIcon(context, row.icon, slot.box, project.colours.icon);
      } else if (kind === "server") {
        const image = assets?.icons?.get(row.icon);
        if (image) context.drawImage(tintedIcon(image, project.colours.icon), slot.box[0], slot.box[1], slot.box[2] - slot.box[0], slot.box[3] - slot.box[1]);
      }
      const baseline = slot.centreY + slot.cap / 2;
      /* Без значка название встаёт к краю плашки. */
      const nameX = iconless ? px0 + slot.gap : slot.nameX;
      const time = shown(row.time, project.upper);
      /* Несколько времён или промежутки — длиннее: им до двух третей строки. */
      const timeShare = time.length > 8 ? 0.66 : 0.6;
      const timeWidth = drawLine(context, time, { x: slot.timeX, baseline, cap: slot.cap, face, stretch, align: "right", maxWidth: (slot.timeX - nameX) * timeShare, colour: project.colours.time });
      drawLine(context, shown(row.text, project.upper), {
        x: nameX,
        baseline,
        cap: slot.cap,
        face,
        stretch,
        maxWidth: slot.timeX - nameX - (timeWidth ? timeWidth + slot.gap : 0),
        colour: project.colours.text,
      });
    }
  }
  context.restore();
}

/** Лист работы на новом холсте (по умолчанию 2048 × 1024) или `null` без 2D. */
export async function drawScheduleSheet(input, { width = SCHEDULE_SHEET.width, height = SCHEDULE_SHEET.height } = {}) {
  const canvas = canvasOf(width, height);
  const context = context2d(canvas);
  if (!context) return null;
  const assets = await prepareScheduleSheet(input);
  paintScheduleSheet(context, input, assets, { width, height });
  return canvas;
}

/* ------------------------------------------------------------------ *
 * Плитки и обложка
 * ------------------------------------------------------------------ */

/* Пропорция щита сервера (ширина к высоте). */
export const BOARD_ASPECT = LAYOUT.width / LAYOUT.height;

/*
 * Стена, на которой табло висит (задача 14 ТЗ 18.10.2026): штатный серый бетон GTA V игрока — тот же лист,
 * что у стены в кадре «На месте» (сцена `scene.bin` несёт ту же запись; тест следит, чтобы совпадали).
 * Окно читает его из игры; без игры — стена средним цветом бетона. Лист один на окно.
 */
export const SCHEDULE_WALL_SHEET = Object.freeze({
  game: "update/x64/dlcpacks/patchday2ng/dlc.rpf:x64/levels/gta5/generic/gtxd.rpf/globalroads.ytd",
  texture: "im_wall_concrete32",
  colour: "#8b8c88",
});

let wallSheet = null;
/** Лист бетона стены — картинка или `null` (игры нет / лист не нашёлся). */
export function loadWallSheet() {
  if (!wallSheet) wallSheet = Promise.resolve(loadSceneImage({ game: SCHEDULE_WALL_SHEET.game, texture: SCHEDULE_WALL_SHEET.texture }, 512)).then((image) => image || null, () => null);
  return wallSheet;
}

/* Бетон на весь холст: лист ложится плиткой в `tile` пикселей — табло на стене в размер её листа. */
function paintWall(context, image, width, height, tile) {
  context.fillStyle = SCHEDULE_WALL_SHEET.colour;
  context.fillRect(0, 0, width, height);
  if (!image || !(tile > 0)) return;
  for (let top = 0; top < height; top += tile) for (let left = 0; left < width; left += tile) context.drawImage(image, left, top, tile, tile);
}

/*
 * Табло в прямоугольнике `width × height` (холст плитки или обложки, CSS-
 * пиксели): щит в своей пропорции посередине. `assets` — из
 * `prepareScheduleSheet` (лист работы) или `{ server }` — облик сервера.
 * `wall` — `{ image }`: щит висит на бетонной стене (`image` — лист из игры или `null` —
 * стена серым) и бросает на неё тень; без `wall` холст прозрачный, как у плиток шаблонов.
 */
export function paintScheduleTile(context, project, assets, { width, height, margin = 0.08, wall = null } = {}) {
  const w = Math.min(width * (1 - margin * 2), height * (1 - margin * 2) * BOARD_ASPECT);
  const h = w / BOARD_ASPECT;
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  /* Плитка бетона — примерно в ширину табло: у сервера щит 3,3–4,5 м, лист — 4 м. */
  if (wall) paintWall(context, wall.image, width, height, w * 1.15);
  if (!assets) return;
  context.save();
  if (wall) {
    context.shadowColor = "rgba(0, 0, 0, 0.5)";
    context.shadowBlur = h * 0.1;
    context.shadowOffsetY = h * 0.04;
  }
  try {
    if (assets.server) {
      context.drawImage(assets.server, x, y, w, h);
      return;
    }
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    const canvas = canvasOf(w * ratio * 2, h * ratio * 2);
    const sheet = context2d(canvas);
    if (!sheet) return;
    paintScheduleSheet(sheet, project, assets, { width: canvas.width, height: canvas.height });
    context.drawImage(canvas, x, y, w, h);
  } finally {
    context.restore();
  }
}

/** Что нужно плитке: облик сервера («как на сервере») или всё для листа работы. */
export async function scheduleTileAssets(project) {
  const normal = normalizeScheduleProject(project);
  if (scheduleIsStock(normal)) {
    const server = await loadServerSheet();
    return server ? { server } : null;
  }
  return prepareScheduleSheet(normal);
}

/** Картинка плитки (data URL) работы; без холста — пусто. */
export async function scheduleTileImage(project, { width = 240, height = 120 } = {}) {
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  const canvas = canvasOf(width * ratio, height * ratio);
  const context = context2d(canvas);
  if (!context) return "";
  const assets = await scheduleTileAssets(project);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  paintScheduleTile(context, project, assets, { width, height, margin: 0.04 });
  return canvas.toDataURL?.() || "";
}

async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

/**
 * Картинки «Применить»: `{ sheet: { data: base64 PNG 2048 × 1024 } }`; у
 * «Как на сервере» — `null` (ставить нечего). Та же функция рисует и
 * работу из «Моих работ» без открытого редактора.
 */
export async function scheduleImages(input) {
  const project = normalizeScheduleProject(input);
  if (scheduleIsStock(project)) return null;
  if (project.font === "custom" && !(await ensureEmblemFont(project.fontAsset))) throw new Error("Файл своего шрифта пропал из хранилища окна — выберите шрифт ещё раз.");
  const assets = await prepareScheduleSheet(project);
  if (project.rows.some((row) => !row.hidden && row.icon === SCHEDULE_ICON_IMAGE && !assets.images.has(row.image.asset)))
    throw new Error("Своя картинка строки пропала из хранилища окна — загрузите её ещё раз.");
  const canvas = canvasOf(SCHEDULE_SHEET.width, SCHEDULE_SHEET.height);
  const context = context2d(canvas);
  if (!context) throw new Error("Окно не может нарисовать лист расписания — обновите Astral.");
  paintScheduleSheet(context, project, assets);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Лист расписания не нарисовался — нажмите «Применить» ещё раз.");
  return { sheet: { data: await blobBase64(blob) } };
}
