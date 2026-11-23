// Зона Z4 сцены мастерской оружия: форма модели, отделка материалов и лист «рентген».
// Всё состояние лежит в общем объекте ctx (имена полей — в gun-scene-frame.js, createFrame);
// операции соседних зон берутся из ctx.ops.

import { materialPixels } from "@modovik/rage-drawable/material-pixels";
import { STUDIO_FINISHES, finishOf, finishShader, isNeutralMaterial } from "./lighting.js";
import { XRAY_SIDE_LIMIT } from "./gun-scene-pure.js";
import { restingEmissiveMap } from "./gun-paint-maps.js";
import * as THREE from "three";

export const DEFAULT_FINISH = "metal";

const XRAY_GLOW_FACTOR = 0.6;
const XRAY_REFRESH_DELAY_MS = 250;
const MIN_OPACITY = 0.05;
const WHITE = "#ffffff";

// Три числа блеска: их меняют и отделка, и стекло.
const GLOSS_KEYS = ["roughness", "metalness", "envMapIntensity"];
const GLASS_SURFACE = { roughness: 0.06, metalness: 0, envMapIntensity: 2.2 };

const glossOf = (mat) => ({
  roughness: mat.roughness,
  metalness: mat.metalness,
  envMapIntensity: mat.envMapIntensity,
});

// Смена карты (цвета или свечения) перекомпилирует материал.
const swapMap = (mat, slot, map) => {
  if (mat[slot] === map) return;
  mat[slot] = map;
  mat.needsUpdate = true;
};

// ---------------------------------------------------------------------------
// Рентген
// ---------------------------------------------------------------------------

// Картинка записи и её размер; null, если размера нет.
const xraySource = (entry) => {
  const image = entry.texture?.image || entry.sourceMap?.image || null;
  const width = Number(image?.width) || 0;
  const height = Number(image?.height) || 0;
  return width && height ? { image, width, height } : null;
};

// Длинная сторона листа не больше XRAY_SIDE_LIMIT, короткая не уже пикселя.
const sheetSizeFor = ({ width, height }) => {
  const shrink = Math.min(XRAY_SIDE_LIMIT / Math.max(width, height), 1);
  return {
    width: Math.max(1, Math.round(width * shrink)),
    height: Math.max(1, Math.round(height * shrink)),
  };
};

// Рисует картинку на холст и пропускает через фильтр рентгена; false, если у холста нет контекста 2d.
const paintXray = (canvas, image, size) => {
  const pen = canvas.getContext("2d", { willReadFrequently: true });
  if (!pen) return false;
  canvas.width = size.width;
  canvas.height = size.height;
  pen.drawImage(image, 0, 0, size.width, size.height);
  const pixels = pen.getImageData(0, 0, size.width, size.height);
  materialPixels(pixels.data, size.width, size.height, { material: "xray", tint: WHITE, opacity: 1 });
  pen.putImageData(pixels, 0, 0);
  return true;
};

const xraySheet = (ctx, entry) => {
  const picture = xraySource(entry);
  if (!picture) return null;

  const cached = entry.xray;
  if (cached && cached.source === picture.image && !cached.stale) return cached.texture;

  const canvas = cached?.canvas || document.createElement("canvas");
  if (!paintXray(canvas, picture.image, sheetSizeFor(picture))) return null;

  const texture = cached?.texture || ctx.ops.surfaceTexture(entry, canvas);
  texture.needsUpdate = true;
  entry.xray = { source: picture.image, canvas, texture, stale: false };
  return texture;
};

const scheduleXray = (ctx) => {
  if (ctx.xrayTimer) return;
  ctx.xrayTimer = setTimeout(() => {
    ctx.xrayTimer = 0;
    if (ctx.closed) return;
    applyShape(ctx);
    ctx.requestRender();
  }, XRAY_REFRESH_DELAY_MS);
};

const stopXrayTimer = (ctx) => {
  if (ctx.xrayTimer) clearTimeout(ctx.xrayTimer);
  ctx.xrayTimer = 0;
};

// ---------------------------------------------------------------------------
// Применение формы к материалам
// ---------------------------------------------------------------------------

const cloneColour = (colour) => (colour ? colour.clone() : null);

// Первый вид материала; порядок ключей читает gun-paint-maps.js.
const captureBase = (mat) => ({
  transparent: mat.transparent,
  opacity: mat.opacity,
  depthWrite: mat.depthWrite,
  side: mat.side,
  blending: mat.blending,
  color: cloneColour(mat.color),
  emissive: cloneColour(mat.emissive),
  emissiveIntensity: mat.emissiveIntensity,
  ...glossOf(mat),
  map: mat.map || null,
});

// Основа запоминается один раз.
const shapeBaseOf = (mat) => {
  const store = mat.userData;
  store.astralShapeBase ??= captureBase(mat);
  return store.astralShapeBase;
};

// Каким должен стать материал при данной форме. Только вычисление: в материал ничего не пишется.
const surfaceTarget = (base, plan) => {
  const { kind, clear } = plan;
  return {
    transparent: clear || base.transparent,
    blending: kind === "xray" ? THREE.AdditiveBlending : base.blending,
    opacity: base.opacity * plan.opacity,
    depthWrite: clear ? false : base.depthWrite,
    side: clear ? THREE.FrontSide : base.side,
    map: kind === "standard" ? base.map : plan.sheet,
  };
};

const applySurface = (mat, target) => {
  // смена прозрачности или смешения тоже перекомпилирует материал
  if (mat.transparent !== target.transparent || mat.blending !== target.blending) mat.needsUpdate = true;
  mat.transparent = target.transparent;
  mat.blending = target.blending;
  mat.opacity = target.opacity;
  mat.depthWrite = target.depthWrite;
  mat.side = target.side;
  swapMap(mat, "map", target.map);
};

const shapeColour = (mat, base, plan) => {
  if (!base.color || !mat.color) return;
  if (plan.kind === "xray") mat.color.setRGB(0, 0, 0);
  else mat.color.copy(plan.kind === "glass" ? plan.tint : base.color);
};

// Рентген светится листом; выход из рентгена возвращает прежнее свечение.
const shapeGlow = (mat, base, plan) => {
  if (!mat.emissive) return;
  if (plan.kind === "xray") {
    swapMap(mat, "emissiveMap", plan.sheet);
    mat.emissive.copy(plan.tint);
    mat.emissiveIntensity = plan.glow * XRAY_GLOW_FACTOR;
  } else if (plan.leavingXray) {
    mat.emissiveMap = restingEmissiveMap(mat, plan.entry.texture || base.map);
    if (base.emissive) mat.emissive.copy(base.emissive);
    mat.emissiveIntensity = base.emissiveIntensity;
    mat.needsUpdate = true;
  }
};

const shapeGloss = (mat, base, plan) => {
  const gloss = plan.kind === "glass" ? GLASS_SURFACE : base;
  for (const key of GLOSS_KEYS) {
    if (key in mat) mat[key] = gloss[key];
  }
};

const shapeMaterial = (mat, base, plan) => {
  applySurface(mat, surfaceTarget(base, plan));
  shapeColour(mat, base, plan);
  shapeGlow(mat, base, plan);
  shapeGloss(mat, base, plan);
};

const dressEntry = (ctx, entry, common) => {
  const leavingXray = entry.shaped === "xray" && common.kind !== "xray";
  const sheet = common.kind === "xray" ? xraySheet(ctx, entry) : null;
  const plan = { ...common, entry, leavingXray, sheet };
  for (const mat of entry.targets || []) shapeMaterial(mat, shapeBaseOf(mat), plan);
  entry.shaped = common.kind;
  if (leavingXray) ctx.ops.applyEntryGlow(entry);
};

// В руках масштабируется корень, а держатель стоит на единице.
const scaleModel = (ctx, factor) => {
  ctx.holder.scale.setScalar(ctx.hand ? 1 : factor);
  if (ctx.hand) ctx.root.scale.setScalar(factor);
};

// Общая часть плана: одна на все записи.
const planFor = (shape) => {
  const kind = shape.material || "standard";
  return {
    kind,
    clear: kind !== "standard" || shape.opacity < 1,
    opacity: shape.opacity,
    glow: shape.glow,
    tint: new THREE.Color(shape.tint || WHITE),
  };
};

const applyShape = (ctx) => {
  scaleModel(ctx, ctx.shape.scale);
  const common = planFor(ctx.shape);
  for (const entry of ctx.entries) dressEntry(ctx, entry, common);
};

// ---------------------------------------------------------------------------
// Отделка
// ---------------------------------------------------------------------------

// Шейдер студийной отделки: только у нейтрального материала и только если отделка задаёт iblDiffuse.
const finishPatchFor = (source, finish) => {
  if (!isNeutralMaterial(source)) return null;
  const iblDiffuse = STUDIO_FINISHES[finish]?.iblDiffuse;
  return iblDiffuse === undefined ? null : finishShader(iblDiffuse);
};

const refinishMaterial = (mat, finish) => {
  // материалу без блеска отделка не нужна
  if (!("roughness" in mat)) return;
  const store = mat.userData;
  store.astralFinishSource ??= glossOf(mat);
  const source = store.astralFinishSource;

  // Числа отделки получает и основа формы: возврат к стандарту должен вернуть уже отделанный вид.
  const look = finishOf(source, finish);
  const shapeBase = store.astralShapeBase;
  for (const key of GLOSS_KEYS) {
    mat[key] = look[key];
    if (shapeBase) shapeBase[key] = look[key];
  }

  const shader = finishPatchFor(source, finish);
  const programKey = shader?.key || "";
  if (programKey === (store.astralFinishKey ?? "")) return;
  store.astralFinishKey = programKey;
  mat.onBeforeCompile = shader ? shader.patch : () => {};
  mat.customProgramCacheKey = () => programKey;
  mat.needsUpdate = true;
};

const applyFinish = (ctx) => {
  for (const entry of ctx.entries) {
    for (const mat of entry.targets || []) refinishMaterial(mat, ctx.finish);
  }
};

const setFinish = (ctx, next) => {
  const finish = next === "cloth" ? "cloth" : "metal";
  if (finish === ctx.finish) return;
  ctx.finish = finish;
  // до загрузки модели достаточно запомнить отделку
  if (ctx.root) {
    applyFinish(ctx);
    applyShape(ctx);
    ctx.requestRender();
  }
};

// ---------------------------------------------------------------------------
// Нормализация формы, пришедшей от хоста
// ---------------------------------------------------------------------------

const positiveOr = (raw, fallback) => (Number(raw) > 0 ? Number(raw) : fallback);

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const materialKind = (raw) => (raw === "glass" || raw === "xray" ? raw : "standard");

const normalizeShape = (next) => ({
  scale: positiveOr(next.scale, 1),
  opacity: clamp(Number(next.opacity) || 1, MIN_OPACITY, 1),
  material: materialKind(next.material),
  tint: typeof next.tint === "string" ? next.tint : "",
  glow: positiveOr(next.glow, 3),
});

// Форма по умолчанию — то, во что нормализация превращает пустой ввод.
export const initialShape = () => normalizeShape({});

const setModelShape = (ctx, next) => {
  const shape = normalizeShape(next);
  const unchanged = Object.entries(shape).every(([field, value]) => value === ctx.shape[field]);
  if (unchanged) return;
  ctx.shape = shape;
  applyShape(ctx);
  ctx.requestRender();
};

// ---------------------------------------------------------------------------
// Подключение зоны к общему состоянию
// ---------------------------------------------------------------------------

export const attachShapeZone = (ctx) => {
  ctx.shape = initialShape();
  ctx.finish = DEFAULT_FINISH;
  ctx.xrayTimer = 0;
  return Object.assign(ctx.ops, {
    applyShape: () => applyShape(ctx),
    applyFinish: () => applyFinish(ctx),
    setFinish: (next) => setFinish(ctx, next),
    xraySheet: (entry) => xraySheet(ctx, entry),
    scheduleXray: () => scheduleXray(ctx),
    setModelShape: (next = {}) => setModelShape(ctx, next),
    stopXrayTimer: () => stopXrayTimer(ctx),
  });
};
