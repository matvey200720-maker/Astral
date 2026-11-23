// Предупреждения о проблемах ствола до установки: быстрая проверка по описи и глубокая по файлам.

import { readResourceHeader } from "@modovik/ypt/resource-core";
import { readDrawable, readTextureDictionary } from "@modovik/rage-drawable";

export const HIGH_POLY_VERTICES = 150000;
export const HEAVY_MEMORY_BYTES = 67108864;

// Текст проверки живёт рядом со строгостью; подстановки приходят аргументами.
const CHECK_CATALOG = {
  "no-hi": ["warn", () => "Нет модели вблизи (_hi): у себя в руках и от первого лица игрок увидит штатный ствол."],
  retexture: ["info", () => "Только текстуры: модель остаётся штатной, меняется окраска."],
  "parts-only": ["warn", () => "В паке только детали этого ствола (магазины, прицел), самой модели нет."],
  duplicate: ["warn", (name) => `«${name}» лежит в паке дважды — взята копия побольше.`],
  enhanced: ["block", (name) => `«${name}» сделан для GTA V Enhanced — в обычной GTA V такой файл не загрузится.`],
  unreadable: ["warn", (name, reason) => `«${name}» не читается: ${reason}`],
  "no-diffuse": ["block", (list) => `У ствола нет цветной текстуры ${list}: ни в пакете, ни в самой модели. В игре он остался бы без цвета (белым или розовым), поэтому в каталог такой ствол не идёт.`],
  "missing-texture": ["warn", (word, list) => `В паке нет ${word} ${list}: игра возьмёт их из своих файлов, а если там таких нет — часть ствола станет розовой.`],
  "high-poly": ["info", (thousands) => `Очень детальная модель — ${thousands} тыс. вершин (у штатного ствола 10–20 тыс.). На слабом ПК в перестрелке может проседать FPS.`],
  heavy: ["warn", (megabytes) => `Ствол занимает в памяти игры ${megabytes} МБ. На слабом ПК с таким паком возможны вылеты.`],
  "hidden-parts": ["info", (word, list) => `Автор скрыл ${word} ствола (${list}) — в игре их не будет видно.`],
};

function makeCheck(code, ...values) {
  const [severity, compose] = CHECK_CATALOG[code];
  return { code, severity, message: compose(...values) };
}

const fileCheck = (code, name, ...values) => ({ ...makeCheck(code, name, ...values), file: name });

function filesOf(weapon) {
  if (!Array.isArray(weapon.files)) throw new TypeError("weapon.files must be an array.");
  return [...weapon.files];
}

// --- Быстрая проверка.

const ENHANCED_VERSIONS = { ydr: [159, 154], ytd: [5], yft: [171] };
const CHECKED_EXTENSION = /\.(ydr|ytd|yft)$/i;

function isEnhancedByVersion(file) {
  const match = CHECKED_EXTENSION.exec(file.name);
  return match !== null && ENHANCED_VERSIONS[match[1].toLowerCase()].includes(file.version);
}

const KIND_CHECKS = {
  model: (roles) => (roles.has("model") && !roles.has("model-hi") ? ["no-hi"] : []),
  retexture: () => ["retexture"],
  parts: () => ["parts-only"],
};

export function quickChecks(weapon) {
  const files = filesOf(weapon);
  const roles = new Set(weapon.roles || files.map((file) => file.role));
  const byKind = Object.hasOwn(KIND_CHECKS, weapon.kind) ? KIND_CHECKS[weapon.kind](roles) : [];
  return [
    ...byKind.map((code) => makeCheck(code)),
    ...[...(weapon.duplicates || [])].map((name) => makeCheck("duplicate", name)),
    ...files.filter(isEnhancedByVersion).map((file) => fileCheck("enhanced", file.name)),
  ];
}

const SEVERITY_RANK = new Map([["info", 1], ["warn", 2], ["block", 3]]);

export function worstSeverity(checks) {
  if (!checks) return null;
  // Полный проход: null на любом месте обязан дать TypeError.
  const [worst] = checks.reduce(([best, bestRank], check) => {
    const rank = SEVERITY_RANK.get(check.severity) ?? 0;
    return rank > bestRank ? [check.severity, rank] : [best, bestRank];
  }, [null, 0]);
  return worst;
}

// --- Глубокая проверка: состояние одного осмотра ствола.

const ENHANCED_MODEL_VERSIONS = new Set([159, 154]);
const ENHANCED_DICTIONARY_VERSION = 5;
const TEXTURE_PLACEHOLDERS = new Set(["none", "givemechecker", ""]);
const EMPTY_PART_VERTICES = 3;
const ENHANCED_ERROR_CODE = "RAGE_ENHANCED";

const isMainRole = (role) => role === "model" || role === "model-hi";

class WeaponInspection {
  vertices = 0;
  triangles = 0;
  memory = 0;
  /* Свечение — просто факт о модели (`stats.emissive`), не замечание: за светящееся оружие не банят (владелец, 13.11.2026, слова администрации). */
  emissive = false;
  main = null;
  textures = new Map();
  /* Листы, которые ствол видит в игре и на кадре: свои словари `.ytd` ствола (роли texture, texture-hi) и встроенные в главную модель. Словари магазинов и деталей сюда не входят. */
  ownTextures = new Set();
  /* Диффузы главной модели: `[{ name, triangles }]` по мешам без вывернутой оболочки. */
  diffuses = [];
  mentioned = new Set();
  problems = [];
  parts = {};

  constructor(read, inflateRaw) {
    this.read = read;
    this.parserOptions = { inflateRaw };
  }

  remember(texture, own = false) {
    if (own) this.ownTextures.add(texture.name.toLowerCase());
    this.textures.set(texture.name.toLowerCase(), {
      name: texture.name,
      format: texture.format,
      width: texture.width,
      height: texture.height,
    });
  }

  async inspectDictionary(file) {
    try {
      const bytes = await this.read(file.path);
      const header = readResourceHeader(bytes);
      this.memory += header.systemSize + header.graphicsSize;
      if (header.version === ENHANCED_DICTIONARY_VERSION) return;
      const own = file.role === "texture" || file.role === "texture-hi";
      for (const texture of readTextureDictionary(bytes, this.parserOptions)) this.remember(texture, own);
    } catch (error) {
      this.problems.push(fileCheck("unreadable", file.name, error.message));
    }
  }

  async inspectModel(file) {
    try {
      const bytes = await this.read(file.path);
      const header = readResourceHeader(bytes);
      if (ENHANCED_MODEL_VERSIONS.has(header.version)) {
        this.parts[file.name] = { empty: false, enhanced: true };
        return;
      }
      this.readParsedModel(file, header, readDrawable(bytes, this.parserOptions));
    } catch (error) {
      const enhanced = error.code === ENHANCED_ERROR_CODE;
      this.problems.push(enhanced
        ? fileCheck("enhanced", file.name)
        : fileCheck("unreadable", file.name, error.message));
    }
  }

  // Порядок шагов виден снаружи: записанное до падения на меше остаётся.
  readParsedModel(file, header, { drawables }) {
    const drawable = drawables[0];
    const meshes = drawable?.meshes || [];
    const vertices = meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
    this.parts[file.name] = { empty: vertices <= EMPTY_PART_VERTICES, vertices };
    if (!isMainRole(file.role)) return;

    if (file.role === "model" || !this.main) this.main = { bounds: drawable?.bounds };
    if (file.role === "model") {
      this.memory += header.systemSize + header.graphicsSize;
      this.vertices = vertices;
      this.triangles = meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
    }
    for (const texture of drawable?.embeddedTextures || []) this.remember(texture, true);
    for (const mesh of meshes) {
      const { material } = mesh;
      if (material?.emissive) this.emissive = true;
      for (const name of Object.values(material?.textures || {})) {
        if (name) this.mentioned.add(String(name));
      }
      const diffuse = material?.textures?.diffuse;
      if (file.role === "model" && diffuse && !mesh.invertedHull) this.diffuses.push({ name: String(diffuse), triangles: (mesh.indices?.length || 0) / 3 });
    }
  }

  /* Диффуза нет — больше половины граней главной модели красить нечем (как `colourlessReason` съёмщика, но по файлам пака, без окна). */
  noDiffuseCheck() {
    if (this.diffuses.length === 0) return [];
    const absent = (name) => TEXTURE_PLACEHOLDERS.has(name.toLowerCase()) || !this.ownTextures.has(name.toLowerCase());
    const total = this.diffuses.reduce((sum, item) => sum + item.triangles, 0);
    const lost = this.diffuses.filter((item) => absent(item.name));
    const share = lost.reduce((sum, item) => sum + item.triangles, 0) / (total || 1);
    if (lost.length === 0 || share <= 0.5) return [];
    const names = [...new Set(lost.map((item) => item.name))];
    const shown = names.slice(0, 3).map((name) => `«${name}»`).join(", ");
    return [{ ...makeCheck("no-diffuse", names.length > 3 ? `${shown}…` : shown), textures: names }];
  }

  missingTextureCheck() {
    const missing = [...this.mentioned].filter((name) => {
      const lower = name.toLowerCase();
      return !TEXTURE_PLACEHOLDERS.has(lower) && !this.textures.has(lower);
    });
    if (missing.length === 0) return [];
    const shown = missing.slice(0, 3).map((name) => `«${name}»`).join(", ");
    const list = missing.length > 3 ? `${shown}…` : shown;
    const word = missing.length === 1 ? "текстуры" : "текстур";
    return [{ ...makeCheck("missing-texture", word, list), textures: missing }];
  }

  hiddenPartsCheck(files) {
    const hidden = files
      .filter((file) => !isMainRole(file.role) && this.parts[file.name]?.empty)
      .map((file) => file.name.replace(/\.ydr$/, ""));
    if (hidden.length === 0) return [];
    return [makeCheck("hidden-parts", hidden.length === 1 ? "деталь" : "детали", hidden.join(", "))];
  }

  finalChecks(files) {
    return [
      ...this.problems,
      ...this.noDiffuseCheck(),
      ...this.missingTextureCheck(),
      ...(this.vertices > HIGH_POLY_VERTICES ? [makeCheck("high-poly", Math.round(this.vertices / 1000))] : []),
      ...(this.memory > HEAVY_MEMORY_BYTES ? [makeCheck("heavy", (this.memory / 1048576).toFixed(0))] : []),
      ...this.hiddenPartsCheck(files),
    ];
  }

  result(files) {
    return {
      stats: {
        vertices: this.vertices,
        triangles: this.triangles,
        memory: this.memory,
        emissive: this.emissive,
        textures: [...this.textures.values()],
        bounds: this.main?.bounds || null,
      },
      checks: this.finalChecks(files),
      parts: this.parts,
    };
  }
}

export async function inspectWeapon(weapon, { read, inflateRaw }) {
  const files = filesOf(weapon);
  const dictionaries = files.filter((file) => file.name.endsWith(".ytd"));
  const models = files.filter((file) => file.name.endsWith(".ydr"));
  const inspection = new WeaponInspection(read, inflateRaw);
  for (const file of dictionaries) await inspection.inspectDictionary(file);
  for (const file of models) await inspection.inspectModel(file);
  return inspection.result(files);
}
