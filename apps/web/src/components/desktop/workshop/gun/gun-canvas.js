// Холсты покраски мастерской оружия и одежды: поверхность материала, шрифты надписей,
// загрузка картинок. Таймеров, слушателей и хранилища у модуля нет.

import { emblemFontFamily } from "../../../../features/workshop/emblem/emblem-fonts.js";
import { colourEffectAt } from "@modovik/climb-contract/recolor/colour-effects";
import { tr } from "../../../../locales/ui.js";
import { trKey, fill } from "./gun-copy.js";

export const maskKey = (layerId) => `mask:${layerId}`;

export const CLEAN_BASE_COLOUR = "#b9bdc3";

export const TEXT_FONTS = Object.freeze([
  { id: "sans", label: trKey("Гротеск") },
  { id: "serif", label: trKey("Антиква") },
  { id: "mono", label: trKey("Моно") },
  { id: "stencil", label: trKey("Трафарет") },
  { id: "script", label: trKey("Рукопись") },
  { id: "gothic", label: trKey("Готика") },
]);

// Имена из прототипа обычного объекта («constructor», «__proto__») находятся как «шрифт»
// и не раскладываются в пару: вызов падает с TypeError (контракт, Шр16 и Шр17).
export function textFont(id, size) {
  const [weight, family] = FONT_STACKS[id] ?? FONT_STACKS.sans;
  return `${weight} ${size}px ${family}`;
}

export function layerFont(layer, size) {
  if (layer?.font === "custom" && layer.fontAsset) {
    return `700 ${size}px "${emblemFontFamily(layer.fontAsset)}", "Segoe UI", Arial, sans-serif`;
  }
  return textFont(layer?.font, size);
}

// ───────── загрузка и чтение картинок ─────────

function isBase64Body(rest) {
  let at = 0;
  while (at < rest.length && BASE64_SYMBOLS.has(rest[at])) at += 1;
  if (at === 0) return false;
  while (rest[at] === "=") at += 1;
  return at === rest.length;
}

function isImageAddress(address) {
  if (REMOTE_PREFIXES.some((prefix) => address.startsWith(prefix))) return true;
  const prefix = DATA_PREFIXES.find((head) => address.startsWith(head));
  return prefix !== undefined && isBase64Body(address.slice(prefix.length));
}

export function loadImage(source) {
  const address = String(source || "");
  return new Promise((resolve, reject) => {
    if (!isImageAddress(address)) {
      reject(new Error(tr("Это не изображение.")));
      return;
    }
    const picture = new Image();
    picture.crossOrigin = "anonymous";
    picture.onload = () => resolve(picture);
    picture.onerror = () => reject(new Error(tr("Не удалось прочитать изображение.")));
    picture.src = address;
  });
}

// Причина отказа по файлу или null; текст берётся через tr в момент отказа.
function refusalFor(file, maxBytes) {
  if (!file) return tr("Файл не выбран.");
  if (!FILE_TYPES.includes(file.type)) return tr("Подойдёт PNG, JPEG или WebP.");
  if (file.size > maxBytes) return fill(tr("Картинка больше {mb} МБ."), { mb: Math.round(maxBytes / 1024 / 1024) });
  return null;
}

export function readImageFile(file, { maxBytes = DEFAULT_FILE_LIMIT } = {}) {
  return new Promise((resolve, reject) => {
    const refusal = refusalFor(file, maxBytes);
    if (refusal !== null) {
      reject(new Error(refusal));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(tr("Не удалось прочитать файл.")));
    reader.readAsDataURL(file);
  });
}

// ───────── мелкие помощники ─────────

function canvasOf(width, height) {
  const el = document.createElement("canvas");
  el.width = Math.max(1, Math.round(width));
  el.height = Math.max(1, Math.round(height));
  return el;
}

// Холст вместе со своим контекстом. Флаг «частых чтений» нужен тем холстам, что читаются
// или сами ложатся на такие же: с ним они остаются в памяти процессора, без обратной загрузки с видеочипа.
class Plane {
  constructor(width, height, frequentReads = false) {
    this.canvas = canvasOf(width, height);
    this.ctx = this.canvas.getContext("2d", frequentReads ? { willReadFrequently: true } : undefined);
  }

  get width() {
    return this.canvas.width;
  }

  get height() {
    return this.canvas.height;
  }

  wipe() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // Увеличивает холст (содержимое при этом пропадает), только если он меньше нужного.
  grow(width, height) {
    if (this.canvas.width < width) this.canvas.width = width;
    if (this.canvas.height < height) this.canvas.height = height;
  }
}

function isHexInk(value) {
  if (typeof value !== "string" || value.length !== 7 || value[0] !== "#") return false;
  for (let at = 1; at < 7; at += 1) {
    if (!HEX_DIGITS.has(value[at])) return false;
  }
  return true;
}

const inkOf = (value) => (isHexInk(value) ? value : "#ffffff");

function withAlpha(hex, alpha) {
  const packed = parseInt(hex.slice(1), 16);
  return `rgba(${packed >> 16}, ${(packed >> 8) & 255}, ${packed & 255}, ${alpha})`;
}

const unitClamp = (value) => Math.min(1, Math.max(0, value));

const isPlainBlend = (blend) => !blend || blend === "source-over";

const isLive = (layer) => Boolean(layer.visible) && !(layer.opacity <= 0);

const blit = (plane) => (ctx) => ctx.drawImage(plane.canvas, 0, 0);

// Накладывает источник режимом обрезки или стирания; area — необязательные ширина и высота растяжения.
function applyThrough(ctx, operation, source, ...area) {
  Object.assign(ctx, { globalCompositeOperation: operation });
  ctx.drawImage(source, 0, 0, ...area);
  Object.assign(ctx, PLAIN_STATE);
}

// Слои приходят сверху вниз; собираем группы снизу вверх: слой с обтравкой
// садится на ближайшую ниже основу, а без основы сам становится основой.
function bundle(layers) {
  const groups = [];
  let open = null;
  for (let at = layers.length - 1; at >= 0; at -= 1) {
    const layer = layers[at];
    if (layer.clip && open) {
      open.riders.push(layer);
      continue;
    }
    open = { base: layer, riders: [] };
    groups.push(open);
  }
  return groups;
}

// Квадрат вокруг отрезка, обрезанный по листу; null, если пуст.
function boxAround(x0, y0, x1, y1, pad, plane) {
  const left = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
  const top = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
  const right = Math.min(plane.width, Math.ceil(Math.max(x0, x1) + pad));
  const bottom = Math.min(plane.height, Math.ceil(Math.max(y0, y1) + pad));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

// Выполняет рисование с заданными прозрачностью и режимом, потом возвращает состояние контекста.
function stampWith(ctx, operation, alpha, draw) {
  Object.assign(ctx, { globalAlpha: alpha, globalCompositeOperation: operation });
  try {
    draw(ctx);
  } finally {
    Object.assign(ctx, PLAIN_STATE);
  }
}

const layUnit = (ctx, unit, draw) => stampWith(ctx, unit.blend || "source-over", unit.opacity / 100, draw);

const eraseOrPaint = (erase) => (erase ? "destination-out" : "source-over");

const regionKey = (r) => `${r.x},${r.y},${r.w},${r.h}`;

// ───────── подложка материала ─────────

function averageLight(canvas) {
  try {
    const copy = new Plane(MEAN_SIDE, MEAN_SIDE, true);
    copy.ctx.drawImage(canvas, 0, 0, MEAN_SIDE, MEAN_SIDE);
    const { data } = copy.ctx.getImageData(0, 0, MEAN_SIDE, MEAN_SIDE);
    let sum = 0;
    let count = 0;
    for (let at = 0; at < data.length; at += 4) {
      if (data[at + 3] < MEAN_MIN_ALPHA) continue;
      sum += (0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2]) / 255;
      count += 1;
    }
    return count > 0 ? sum / count : 0.5;
  } catch {
    return 0.5;
  }
}

class Backdrop {
  #saved = new Map();
  #mean;
  #cleanPlane = null;
  #shapePlane = null;
  #cleanDirty = true;
  #shapeDirty = true;

  constructor(sheet, picture, colour) {
    this.sheet = sheet;
    this.plane = new Plane(sheet.width, sheet.height);
    this.#paint(picture, colour);
  }

  #paint(picture, colour) {
    const { ctx, canvas } = this.plane;
    if (picture) {
      try {
        ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
        return;
      } catch {
        // негодная картинка: ниже подложка просто закрашивается цветом
      }
    }
    ctx.fillStyle = colour || DEFAULT_BASE_COLOUR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Есть ли в подложке вырез: любой пиксель с альфой меньше порога.
  hasNotch() {
    const { canvas, ctx } = this.plane;
    try {
      const w = Math.min(canvas.width, PROBE_SIDE);
      const h = Math.min(canvas.height, PROBE_SIDE);
      let reader = ctx;
      if (w < canvas.width || h < canvas.height) {
        const thumb = new Plane(w, h, true);
        thumb.ctx.imageSmoothingEnabled = false;
        thumb.ctx.drawImage(canvas, 0, 0, w, h);
        reader = thumb.ctx;
      }
      const { data } = reader.getImageData(0, 0, w, h);
      for (let at = 3; at < data.length; at += 4) {
        if (data[at] < NOTCH_ALPHA) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Средняя яркость считается один раз за жизнь поверхности.
  mean() {
    this.#mean ??= averageLight(this.plane.canvas);
    return this.#mean;
  }

  // «Чистая модель»: подложка одного тона с прежней альфой.
  clean() {
    this.#cleanPlane ??= new Plane(this.sheet.width, this.sheet.height);
    if (this.#cleanDirty) {
      const { ctx, canvas } = this.#cleanPlane;
      this.#cleanPlane.wipe();
      ctx.drawImage(this.plane.canvas, 0, 0);
      Object.assign(ctx, { globalCompositeOperation: "source-in", fillStyle: CLEAN_BASE_COLOUR });
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      Object.assign(ctx, PLAIN_STATE);
      this.#cleanDirty = false;
    }
    return this.#cleanPlane.canvas;
  }

  // Форма подложки с усиленной альфой: любая прозрачность выше нуля становится почти сплошной.
  shape() {
    this.#shapePlane ??= new Plane(this.sheet.width, this.sheet.height);
    if (this.#shapeDirty) {
      this.#shapePlane.wipe();
      for (let pass = 0; pass < SHAPE_PASSES; pass += 1) {
        this.#shapePlane.ctx.drawImage(this.plane.canvas, 0, 0);
      }
      this.#shapeDirty = false;
    }
    return this.#shapePlane.canvas;
  }

  touched() {
    this.#cleanDirty = true;
    this.#shapeDirty = true;
  }

  remember(to) {
    const key = regionKey(to);
    if (this.#saved.has(key)) return;
    const data = this.plane.ctx.getImageData(to.x, to.y, to.w, to.h);
    this.#saved.set(key, { x: Number(to.x), y: Number(to.y), data });
  }

  putBack(to) {
    const key = regionKey(to);
    const kept = this.#saved.get(key);
    if (!kept) return;
    this.plane.ctx.putImageData(kept.data, to.x, to.y);
    this.#saved.delete(key);
    this.touched();
  }

  list() {
    return Array.from(this.#saved.values(), ({ x, y, data }) => ({ x, y, data }));
  }
}

// ───────── растры слоёв ─────────

class RasterBook {
  constructor(sheet) {
    this.sheet = sheet;
    this.planes = new Map();
  }

  get(id) {
    let plane = this.planes.get(id);
    if (!plane) {
      plane = new Plane(this.sheet.width, this.sheet.height, true);
      this.planes.set(id, plane);
    }
    return plane;
  }

  canvasFor(id) {
    return this.planes.get(id)?.canvas ?? null;
  }

  isEmpty(id) {
    const plane = this.planes.get(id);
    if (!plane) return true;
    const { data } = plane.ctx.getImageData(0, 0, plane.width, plane.height);
    for (let at = 3; at < data.length; at += 4) {
      if (data[at] !== 0) return false;
    }
    return true;
  }

  exportPng(id) {
    const plane = this.planes.get(id);
    return plane ? plane.canvas.toDataURL("image/png") : null;
  }

  paste(id, picture) {
    const plane = this.get(id);
    plane.wipe();
    plane.ctx.drawImage(picture, 0, 0, plane.width, plane.height);
  }

  flood(id, ink) {
    const { ctx, canvas } = this.get(id);
    Object.assign(ctx, PLAIN_STATE, { fillStyle: inkOf(ink) });
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  clear(id) {
    this.planes.get(id)?.wipe();
  }
}

// ───────── кисть ─────────

// След кисти: линия круглыми концами; мягкая кисть добавляет круг с градиентом у конца.
function leaveTrace(ctx, trace) {
  const { x0, y0, x1, y1, radius, ink, soft, hardness } = trace;
  ctx.save();
  Object.assign(ctx, { strokeStyle: ink, lineWidth: radius * 2, lineCap: "round", lineJoin: "round" });
  walkPath(ctx, [["moveTo", x0, y0], ["lineTo", x1, y1]]);
  ctx.stroke();
  if (soft) {
    const halo = ctx.createRadialGradient(x1, y1, (radius * hardness) / 100, x1, y1, radius);
    halo.addColorStop(0, withAlpha(ink, 1));
    halo.addColorStop(1, withAlpha(ink, 0));
    ctx.fillStyle = halo;
    walkPath(ctx, [["arc", x1, y1, radius, 0, Math.PI * 2]]);
    ctx.fill();
  }
  ctx.restore();
}

// Контур задаётся списком шагов [метод, ...числа] и рисуется обычными вызовами контекста
// (Path2D нет в окружении тестов).
function walkPath(ctx, steps) {
  ctx.beginPath();
  for (const [verb, ...numbers] of steps) ctx[verb](...numbers);
}

// Шаги контура для треугольников границы; обход каждого приводится к одному,
// чтобы пересекающиеся треугольники не вычитались друг из друга.
function* triangleSteps(triangles, width, height) {
  for (let at = 0; at + 6 <= triangles.length; at += 6) {
    const ax = triangles[at] * width;
    const ay = triangles[at + 1] * height;
    let bx = triangles[at + 2] * width;
    let by = triangles[at + 3] * height;
    let cx = triangles[at + 4] * width;
    let cy = triangles[at + 5] * height;
    if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0) {
      [bx, by, cx, cy] = [cx, cy, bx, by];
    }
    yield ["moveTo", ax, ay];
    yield ["lineTo", bx, by];
    yield ["lineTo", cx, cy];
    yield ["closePath"];
  }
}

// Маски острова по границам; хранятся восемь последних.
class IslandMasks {
  #kept = new Map();

  constructor(sheet) {
    this.sheet = sheet;
  }

  of(clip) {
    let plane = this.#kept.get(clip);
    if (!plane) {
      plane = this.#draw(clip.triangles);
      this.#kept.set(clip, plane);
      if (this.#kept.size > KEPT_MASKS) this.#kept.delete(this.#kept.keys().next().value);
    }
    return plane.canvas;
  }

  #draw(triangles) {
    const { width, height } = this.sheet;
    const plane = new Plane(width, height, true);
    const { ctx } = plane;
    const reserve = Math.max(1, Math.round(Math.max(width, height) / 512));
    Object.assign(ctx, { fillStyle: "#ffffff", strokeStyle: "#ffffff", lineWidth: reserve * 2, lineJoin: "round" });
    walkPath(ctx, triangleSteps(triangles, width, height));
    ctx.fill();
    ctx.stroke();
    return plane;
  }
}

class Brush {
  #sessions = new Map();
  #draft = null;

  constructor(sheet, book) {
    this.sheet = sheet;
    this.book = book;
    this.islands = new IslandMasks(sheet);
  }

  stroke(layerId, { from, to, tool = "brush", colour, size, opacity = 100, hardness = 70, clip = null, strokeId = null }) {
    const { width, height } = this.sheet;
    const x1 = to.u * width;
    const y1 = to.v * height;
    const erase = tool === "eraser" || tool === "clear";
    const trace = {
      x0: from == null ? x1 : (from.u ?? to.u) * width,
      y0: from == null ? y1 : (from.v ?? to.v) * height,
      x1,
      y1,
      radius: Math.max(0.5, ((size || DEFAULT_BRUSH_SIZE) / 100 * Math.max(width, height)) / 2),
      ink: inkOf(colour),
      hardness,
      soft: !erase && hardness < 100,
    };
    const alpha = unitClamp(opacity / 100);
    const target = this.book.get(layerId);
    const sessioned = alpha < 1 && strokeId != null;
    const islanded = Boolean(clip?.triangles?.length);

    let box = null;
    if (sessioned || islanded) {
      box = boxAround(trace.x0, trace.y0, x1, y1, trace.radius + 1, target);
      if (!box) return;
    }

    const session = sessioned ? this.#sessionFor(layerId, strokeId, target, erase) : null;
    const sink = session ? session.layer : target;
    const mode = session ? { alpha: 1, operation: "source-over" } : { alpha, operation: eraseOrPaint(erase) };
    if (islanded) this.#drawThroughIsland(sink, box, trace, clip, mode, erase);
    else stampWith(sink.ctx, mode.operation, mode.alpha, () => leaveTrace(sink.ctx, trace));
    if (session) this.#rebuild(target, session, box, alpha);
  }

  end(layerId) {
    this.#sessions.delete(layerId);
  }

  #sessionFor(layerId, strokeId, target, erase) {
    const known = this.#sessions.get(layerId);
    if (known && known.id === strokeId) return known;
    const before = new Plane(this.sheet.width, this.sheet.height, true);
    before.ctx.drawImage(target.canvas, 0, 0);
    const fresh = { id: strokeId, erase, before, layer: new Plane(this.sheet.width, this.sheet.height, true) };
    this.#sessions.set(layerId, fresh);
    return fresh;
  }

  // Заново собирает прямоугольник растра: снимок «до» и поверх слой мазка с нажимом.
  #rebuild(target, session, box, alpha) {
    const { ctx } = target;
    const area = [box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h];
    ctx.clearRect(box.x, box.y, box.w, box.h);
    ctx.drawImage(session.before.canvas, ...area);
    stampWith(ctx, eraseOrPaint(session.erase), alpha, () => ctx.drawImage(session.layer.canvas, ...area));
  }

  #drawThroughIsland(sink, box, trace, clip, mode, erase) {
    this.#draft ??= new Plane(box.w, box.h, true);
    this.#draft.grow(box.w, box.h);
    const { ctx, canvas } = this.#draft;
    ctx.clearRect(0, 0, box.w, box.h);
    ctx.save();
    ctx.translate(-box.x, -box.y);
    leaveTrace(ctx, erase ? { ...trace, ink: "#ffffff" } : trace);
    ctx.restore();
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(this.islands.of(clip), box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    ctx.globalCompositeOperation = "source-over";
    stampWith(sink.ctx, mode.operation, mode.alpha, () =>
      sink.ctx.drawImage(canvas, 0, 0, box.w, box.h, box.x, box.y, box.w, box.h),
    );
  }
}

// ───────── сборка итога ─────────

class Surface {
  #glow = null;
  #lit = false;
  #slots = [];
  #carrier = null;
  #only = null;
  #closed = false;
  #hint = null;

  constructor(sheet, backdrop, book, notched, drawing) {
    this.sheet = sheet;
    this.backdrop = backdrop;
    this.book = book;
    this.notched = notched;
    this.drawing = drawing;
    this.result = new Plane(sheet.width, sheet.height, true);
  }

  get glow() {
    return this.#lit ? this.#glow.canvas : null;
  }

  render(layers = [], sources = {}) {
    const feed = sources instanceof Map ? { images: sources } : sources;
    const { images, patterns, stickers, skinOff, bare } = feed;
    const frame = { sheet: this.sheet, images, patterns, rasters: this.book.planes, backdrop: this.backdrop };
    const out = this.result.ctx;

    if (this.#lit) this.#glow.wipe();
    this.#lit = false;
    this.result.wipe();
    Object.assign(out, PLAIN_STATE);
    if (!bare) out.drawImage(skinOff ? this.backdrop.clean() : this.backdrop.plane.canvas, 0, 0);

    for (const group of bundle(layers)) this.#drawGroup(group, frame);
    this.#wearAway(feed);
    const placed = this.#decals(stickers);
    this.#keepItem(feed);
    this.#trim(placed);
    this.#tintSkin(feed);
  }

  // Подсветка «кожи» (всё вне вещи) розовым поверх итога: в режиме отметки — по отметке человека; у закрытого листа (догадка не уверена) — по догадке, как предложение. Только для показа, в печать (`bare`) и в игру не идёт.
  #tintSkin(feed) {
    const view = this.#hint ?? this.#only;
    if (feed.bare || !view || !(feed.markItem || this.#hint)) return;
    const { width, height } = this.sheet;
    const veil = this.#slot(0);
    veil.wipe();
    Object.assign(veil.ctx, { fillStyle: MARK_TINT });
    veil.ctx.fillRect(0, 0, width, height);
    applyThrough(veil.ctx, "destination-out", view.canvas, width, height);
    stampWith(this.result.ctx, "source-over", MARK_ALPHA, () => this.result.ctx.drawImage(veil.canvas, 0, 0));
  }

  // Белым на холсте плоскости — треугольники (доли листа, по шесть чисел на треугольник).
  #drawMask(plane, triangles) {
    const { width, height } = this.sheet;
    const { ctx } = plane;
    plane.wipe();
    if (!(triangles?.length >= 6)) return;
    const reserve = Math.max(1, Math.round(Math.max(width, height) / 512));
    Object.assign(ctx, { fillStyle: "#ffffff", strokeStyle: "#ffffff", lineWidth: reserve * 2, lineJoin: "round" });
    walkPath(ctx, triangleSteps(triangles, width, height));
    ctx.fill();
    ctx.stroke();
  }

  // «Красить только вещь» (`item-mask.js`): маска листа — белое там, где вещь; вне маски лист возвращается к подложке (кожа на том же листе остаётся как была), а свечение стирается.
  // Одно место для предпросмотра, «На модельке» и печати: все идут через `render`. Печать подложки (`bare`) маски не знает.
  // `closed` — вещь не отмечена и догадка не уверена: маска пустая, красить нечего, лист остаётся подложкой (кисть и заливка не меняют ничего); `hint` — треугольники догадки (вещь): кожа вне них подсвечена как предложение.
  setItemMask(triangles, { closed = false, hint = null } = {}) {
    const empty = !(triangles?.length >= 6);
    this.#closed = closed && empty;
    if (empty && !closed) {
      this.#only = null;
      this.#hint = null;
      return;
    }
    const { width, height } = this.sheet;
    this.#only ??= new Plane(width, height, true);
    this.#drawMask(this.#only, triangles);
    if (closed && hint?.length >= 6) {
      this.#hint ??= new Plane(width, height, true);
      this.#drawMask(this.#hint, hint);
    } else this.#hint = null;
  }
  get itemMask() {
    return this.#only ? this.#only.canvas : null;
  }

  // Лежит ли вещь под кистью: точка листа (`u`, `v` — доли листа) и кисть размером `share` (доля большей стороны листа, как «Размер» кисти, 0 — точка). Без маски красится всё — `true`; закрытый лист (пустая маска) и кисть целиком на коже — `false`.
  // По этому мазок узнаёт, что он «пустой» (подсказка `ItemOnlyBar`); край кисти, задевший вещь, пустым мазок не делает.
  itemInk(u, v, share = 0) {
    if (!this.#only) return true;
    if (this.#closed) return false;
    const { width, height } = this.sheet;
    const centreX = (u - Math.floor(u)) * width;
    const centreY = (v - Math.floor(v)) * height;
    const radius = Math.max(0, (share * Math.max(width, height)) / 2);
    const x0 = Math.min(Math.max(Math.floor(centreX - radius), 0), width - 1);
    const y0 = Math.min(Math.max(Math.floor(centreY - radius), 0), height - 1);
    const x1 = Math.min(Math.max(Math.ceil(centreX + radius), 0), width - 1);
    const y1 = Math.min(Math.max(Math.ceil(centreY + radius), 0), height - 1);
    try {
      const { data } = this.#only.ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
      const reach = (radius + 0.5) ** 2;
      for (let y = y0; y <= y1; y += 1)
        for (let x = x0; x <= x1; x += 1) {
          if ((x + 0.5 - centreX) ** 2 + (y + 0.5 - centreY) ** 2 > reach) continue;
          if (data[((y - y0) * (x1 - x0 + 1) + (x - x0)) * 4 + 3] > 127) return true;
        }
      return false;
    } catch {
      return true;
    }
  }

  #keepItem(feed) {
    if (!this.#only || feed.bare) return;
    const { width, height } = this.sheet;
    const keep = this.#slot(0);
    keep.wipe();
    keep.ctx.drawImage(this.result.canvas, 0, 0);
    applyThrough(keep.ctx, "destination-in", this.#only.canvas, width, height);
    this.result.wipe();
    const out = this.result.ctx;
    out.drawImage(feed.skinOff ? this.backdrop.clean() : this.backdrop.plane.canvas, 0, 0);
    out.drawImage(keep.canvas, 0, 0);
    if (this.#lit) applyThrough(this.#glow.ctx, "destination-in", this.#only.canvas, width, height);
  }

  // Средние цвета листа под наборами треугольников (доли листа, по шесть чисел на треугольник): выборка по центрам треугольников; нет цвета — null.
  readTones(sets) {
    const { width, height } = this.sheet;
    let data = null;
    try {
      const plane = new Plane(width, height, true);
      plane.ctx.drawImage(this.backdrop.plane.canvas, 0, 0);
      data = plane.ctx.getImageData(0, 0, width, height).data;
    } catch {
      return sets.map(() => null);
    }
    return sets.map((triangles) => {
      const count = Math.floor(triangles.length / 6);
      if (!count) return null;
      const step = Math.max(1, Math.floor(count / TONE_SAMPLES));
      let red = 0;
      let green = 0;
      let blue = 0;
      let taken = 0;
      for (let t = 0; t < count; t += step) {
        const u = (triangles[t * 6] + triangles[t * 6 + 2] + triangles[t * 6 + 4]) / 3;
        const v = (triangles[t * 6 + 1] + triangles[t * 6 + 3] + triangles[t * 6 + 5]) / 3;
        const x = Math.min(width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * width)));
        const y = Math.min(height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * height)));
        const at = (y * width + x) * 4;
        if (data[at + 3] < MEAN_MIN_ALPHA) continue;
        red += data[at];
        green += data[at + 1];
        blue += data[at + 2];
        taken += 1;
      }
      return taken ? [red / taken, green / taken, blue / taken] : null;
    });
  }
  pick(u, v) {
    const { canvas, ctx } = this.result;
    const x = Math.min(Math.max(Math.round(u * this.sheet.width), 0), canvas.width - 1);
    const y = Math.min(Math.max(Math.round(v * this.sheet.height), 0), canvas.height - 1);
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }

  moveRegion(from, to, { rasters = true } = {}) {
    this.backdrop.remember(to);
    this.#carry(this.backdrop.plane, from, to);
    this.backdrop.touched();
    if (rasters === false) return;
    for (const plane of this.book.planes.values()) this.#carry(plane, from, to);
  }

  returnRegion(to) {
    this.backdrop.putBack(to);
  }

  #slot(index) {
    this.#slots[index] ??= new Plane(this.sheet.width, this.sheet.height);
    return this.#slots[index];
  }

  #glowPlane() {
    this.#glow ??= new Plane(this.sheet.width, this.sheet.height);
    return this.#glow;
  }

  #carry(plane, from, to) {
    if (!(from.w > 0 && from.h > 0 && to.w > 0 && to.h > 0)) return;
    const piece = plane.ctx.getImageData(from.x, from.y, from.w, from.h);
    this.#carrier ??= new Plane(piece.width, piece.height, true);
    this.#carrier.grow(piece.width, piece.height);
    this.#carrier.ctx.putImageData(piece, 0, 0);
    plane.ctx.clearRect(to.x, to.y, to.w, to.h);
    plane.ctx.drawImage(this.#carrier.canvas, 0, 0, piece.width, piece.height, to.x, to.y, to.w, to.h);
  }

  // Свечение: светящийся слой пишется в карту, а обычный слой выше него стирает карту под собой.
  #glowTouch(unit, stamp) {
    const strength = Number(unit.glow) || 0;
    if (strength > 0) {
      this.#lit = true;
      stampWith(this.#glowPlane().ctx, "source-over", (unit.opacity / 100) * (strength / 100), stamp);
      return;
    }
    if (this.#lit && isPlainBlend(unit.blend)) {
      stampWith(this.#glow.ctx, "destination-out", unit.opacity / 100, stamp);
    }
  }

  #veilOf(layer) {
    if (!layer.mask || layer.maskEnabled === false) return undefined;
    return this.book.planes.get(maskKey(layer.id));
  }

  // Рисует слой на отдельный холст и обрезает его маской, если она есть.
  #paintInto(plane, layer, paint, frame) {
    plane.wipe();
    paint(plane.ctx, layer, frame);
    const veil = this.#veilOf(layer);
    if (veil) applyThrough(plane.ctx, "destination-in", veil.canvas);
  }

  #drawGroup({ base, riders }, frame) {
    if (!isLive(base)) return;
    const shown = riders.filter(isLive);
    if (shown.length === 0) this.#single(base, frame);
    else this.#clipped(base, shown, frame);
  }

  #single(layer, frame) {
    const paint = PAINTERS.get(layer.kind);
    if (!paint) return;
    let stamp = (ctx) => paint(ctx, layer, frame);
    if (this.#veilOf(layer)) {
      const slot = this.#slot(0);
      this.#paintInto(slot, layer, paint, frame);
      stamp = blit(slot);
    }
    layUnit(this.result.ctx, layer, stamp);
    this.#glowTouch(layer, stamp);
  }

  // Основа и слои с обтравкой: слои видны только там, где нарисована основа.
  #clipped(base, riders, frame) {
    const basePaint = PAINTERS.get(base.kind);
    if (!basePaint) return;
    const groupPlane = this.#slot(0);
    const layerPlane = this.#slot(1);
    this.#paintInto(groupPlane, base, basePaint, frame);
    this.#glowTouch(base, blit(groupPlane));
    for (const rider of riders) {
      const paint = PAINTERS.get(rider.kind);
      if (!paint) continue;
      this.#paintInto(layerPlane, rider, paint, frame);
      applyThrough(layerPlane.ctx, "destination-in", groupPlane.canvas);
      this.#glowTouch(rider, blit(layerPlane));
      layUnit(groupPlane.ctx, rider, blit(layerPlane));
    }
    layUnit(this.result.ctx, base, blit(groupPlane));
  }

  // Потёртость: там, где маска непрозрачна, проступает исходная подложка, а свечение стирается.
  #wearAway(feed) {
    const { wear, patterns, bare, skinOff } = feed;
    if (bare || !(wear?.amount > 0) || !patterns) return;
    const { width, height, name } = this.sheet;
    const veil = patterns.wear(feed.name || name, wear, width, height);
    if (!veil) return;
    const slot = this.#slot(0);
    slot.wipe();
    slot.ctx.drawImage(skinOff ? this.backdrop.clean() : this.backdrop.plane.canvas, 0, 0);
    applyThrough(slot.ctx, "destination-in", veil, width, height);
    this.result.ctx.drawImage(slot.canvas, 0, 0);
    if (this.#lit) applyThrough(this.#glow.ctx, "destination-out", veil, width, height);
  }

  // Наклейки ложатся поверх всего; возвращает те, что действительно легли.
  #decals(list) {
    const { width, height } = this.sheet;
    const placed = [];
    for (const piece of list || []) {
      if (!piece || !piece.canvas || piece.opacity <= 0) continue;
      const stamp = (ctx) => ctx.drawImage(piece.canvas, 0, 0, width, height);
      this.#glowTouch(piece, stamp);
      layUnit(this.result.ctx, piece, stamp);
      placed.push({ piece, stamp });
    }
    return placed;
  }

  // Что нарисовали наклейки на непрозрачной части подложки, до обрезки итога.
  #imprint(placed) {
    const cover = this.#slot(0);
    const keep = this.#slot(1);
    cover.wipe();
    for (const { piece, stamp } of placed) stampWith(cover.ctx, "source-over", piece.opacity / 100, stamp);
    keep.wipe();
    keep.ctx.drawImage(this.result.canvas, 0, 0);
    applyThrough(keep.ctx, "destination-in", cover.canvas);
    applyThrough(keep.ctx, "destination-in", this.backdrop.shape());
    return keep;
  }

  // Итог обрезается по вырезу подложки; картинки наклеек на полупрозрачной подложке возвращаются.
  #trim(placed) {
    if (!this.notched || this.drawing) return;
    const out = this.result.ctx;
    const kept = placed.length > 0 ? this.#imprint(placed) : null;
    applyThrough(out, "destination-in", this.backdrop.plane.canvas);
    if (this.#lit) applyThrough(this.#glow.ctx, "destination-in", this.backdrop.plane.canvas);
    if (kept) out.drawImage(kept.canvas, 0, 0);
  }
}

// ───────── что рисует каждый вид слоя ─────────

function gradientAxis(direction, width, height) {
  switch (direction) {
    case "along":
      return [0, 0, width, 0];
    case "height":
      return [0, height, 0, 0];
    default:
      return [0, 0, 0, height];
  }
}

function effectRamp(ctx, effect, width, height) {
  const ramp = ctx.createLinearGradient(...gradientAxis(effect.direction, width, height));
  for (let step = 0; step <= RAMP_STEPS; step += 1) {
    const t = step / RAMP_STEPS;
    const [r, g, b] = colourEffectAt(effect, t);
    ramp.addColorStop(t, `rgb(${r}, ${g}, ${b})`);
  }
  return ramp;
}

function paintFill(ctx, layer, { sheet }) {
  const useRamp = layer.effect && typeof ctx.createLinearGradient === "function";
  ctx.fillStyle = useRamp ? effectRamp(ctx, layer.effect, sheet.width, sheet.height) : inkOf(layer.colour);
  ctx.fillRect(0, 0, sheet.width, sheet.height);
}

function paintRaster(ctx, layer, { rasters }) {
  const plane = rasters.get(layer.id);
  if (plane) ctx.drawImage(plane.canvas, 0, 0);
}

function tileWith(ctx, picture, layer, { width, height }) {
  const weave = ctx.createPattern(picture, "repeat");
  if (!weave) return;
  const cell = Math.max(2, (layer.scale / 100) * Math.min(width, height));
  const zoom = cell / Math.max(picture.width, 1);
  if (!(zoom > 0)) return;
  const reach = (1.5 * Math.hypot(width, height)) / zoom;
  ctx.scale(zoom, zoom);
  ctx.fillStyle = weave;
  ctx.fillRect(-reach, -reach, reach * 2, reach * 2);
}

function paintImage(ctx, layer, { sheet, images }) {
  const picture = images?.get(layer.id);
  if (!picture) return;
  const { width, height } = sheet;
  ctx.save();
  try {
    ctx.translate((layer.x / 100) * width, (layer.y / 100) * height);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    if (layer.tile) {
      tileWith(ctx, picture, layer, sheet);
      return;
    }
    const w = (layer.scale / 100) * width;
    const h = (w * picture.height) / Math.max(picture.width, 1);
    ctx.drawImage(picture, -w / 2, -h / 2, w, h);
  } finally {
    ctx.restore();
  }
}

function paintText(ctx, layer, { sheet }) {
  const { width, height } = sheet;
  ctx.save();
  try {
    Object.assign(ctx, {
      font: layerFont(layer, Math.max((layer.size / 100) * height, 1)),
      textAlign: "center",
      textBaseline: "middle",
    });
    ctx.translate((layer.x / 100) * width, (layer.y / 100) * height);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    if (layer.outlineWidth > 0) {
      Object.assign(ctx, {
        lineWidth: (layer.outlineWidth / 100) * height,
        strokeStyle: inkOf(layer.outline),
        lineJoin: "round",
      });
      ctx.strokeText(layer.value, 0, 0);
    }
    ctx.fillStyle = inkOf(layer.colour);
    ctx.fillText(layer.value, 0, 0);
  } finally {
    ctx.restore();
  }
}

function paintPattern(ctx, layer, { sheet, patterns }) {
  if (!patterns) return;
  const art = patterns.pattern(layer, sheet.width, sheet.height);
  if (art === null) return;
  ctx.save();
  try {
    ctx.imageSmoothingEnabled = layer.pattern !== "digital";
    ctx.drawImage(art, 0, 0, sheet.width, sheet.height);
  } finally {
    ctx.restore();
  }
}

function paintShade(ctx, layer, { backdrop }) {
  const lift = 0.5 / Math.max(backdrop.mean(), MIN_LIGHT);
  const punch = (Number(layer.contrast) || 0) / 100;
  ctx.save();
  try {
    ctx.filter = `grayscale(1) brightness(${lift.toFixed(3)}) contrast(${punch.toFixed(3)})`;
    ctx.drawImage(backdrop.plane.canvas, 0, 0);
  } finally {
    ctx.restore();
  }
}

// ───────── поверхность материала ─────────

export function createSurface({ name, width, height, baseImage, image, baseColour, opaque, drawing = false }) {
  const sheet = { name, width, height };
  const backdrop = new Backdrop(sheet, baseImage || image, baseColour);
  const notched = opaque === true ? false : backdrop.hasNotch();
  const book = new RasterBook(sheet);
  const surface = new Surface(sheet, backdrop, book, notched, drawing);
  const brush = new Brush(sheet, book);

  return {
    name,
    width,
    height,
    canvas: surface.result.canvas,
    get glow() {
      return surface.glow;
    },
    base: backdrop.plane.canvas,
    raster: (id) => book.get(id).canvas,
    forget: (id) => book.planes.delete(id),
    restoreRaster: async (id, address) => {
      if (!address) return;
      book.paste(id, await loadImage(address));
    },
    restoreRasterImage: (id, picture) => book.paste(id, picture),
    rasterCanvas: (id) => book.canvasFor(id),
    exportRaster: (id) => book.exportPng(id),
    rasterIsEmpty: (id) => book.isEmpty(id),
    render: (layers, sources) => surface.render(layers, sources),
    setItemMask: (triangles, options) => surface.setItemMask(triangles, options),
    get itemMask() {
      return surface.itemMask;
    },
    itemInk: (u, v, share) => surface.itemInk(u, v, share),
    readTones: (sets) => surface.readTones(sets),
    stroke: (layerId, options) => brush.stroke(layerId, options),
    endStroke: (layerId) => brush.end(layerId),
    fillLayer: (layerId, ink) => book.flood(layerId, ink),
    clearLayer: (layerId) => book.clear(layerId),
    moveRegion: (from, to, options) => surface.moveRegion(from, to, options),
    returnRegion: (to) => surface.returnRegion(to),
    savedRegions: () => backdrop.list(),
    pick: (u, v) => surface.pick(u, v),
    toDataURL: (type = "image/png") => surface.result.canvas.toDataURL(type),
    opaque: opaque ?? !notched,
  };
}

// ───────── таблицы и константы ─────────

const PAINTERS = new Map([
  ["fill", paintFill],
  ["image", paintImage],
  ["text", paintText],
  ["paint", paintRaster],
  ["pattern", paintPattern],
  ["shade", paintShade],
]);

const FONT_STACKS = {
  sans: [600, '"Inter", system-ui, sans-serif'],
  serif: [600, 'Georgia, "Times New Roman", serif'],
  mono: [600, 'ui-monospace, "SF Mono", monospace'],
  stencil: [800, '"Arial Black", Impact, sans-serif'],
  script: [600, '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive'],
  gothic: [700, '"Old English Text MT", "Luminari", "UnifrakturMaguntia", fantasy'],
};

const DATA_PREFIXES = ["png", "jpeg", "webp"].map((kind) => `data:image/${kind};base64,`);
const REMOTE_PREFIXES = ["blob:", "http://", "https://"];
const BASE64_SYMBOLS = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
const HEX_DIGITS = new Set("0123456789abcdefABCDEF");
const FILE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const DEFAULT_FILE_LIMIT = 4 * 1024 * 1024;

const PLAIN_STATE = { globalAlpha: 1, globalCompositeOperation: "source-over" };
const DEFAULT_BASE_COLOUR = "#9aa0a8";
const DEFAULT_BRUSH_SIZE = 8;
const PROBE_SIDE = 512;
const NOTCH_ALPHA = 250;
const MEAN_SIDE = 64;
const MEAN_MIN_ALPHA = 16;
const TONE_SAMPLES = 64;
const MARK_TINT = "#d946ef";
const MARK_ALPHA = 0.55;
const MIN_LIGHT = 0.04;
const SHAPE_PASSES = 8;
const RAMP_STEPS = 32;
const KEPT_MASKS = 8;
