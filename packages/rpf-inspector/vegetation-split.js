// Смешанный контейнер травы: отделяет штатные объекты от растений и замечает, что мод траву убирает.

import inventory from "@modovik/climb-contract/recolor/inventory/vegetation";
import { recategorizeFinding } from "./classify.js";
import { placeTarget, VEGETATION_MODEL_NAME } from "./containers.js";
import { stockVegetationKind } from "./vegetation-groups.js";

const OBJECTS_CATEGORY = "object-optimization";
const GRASS_HINT = "трава";
const PROC_ARCHETYPE = "procobj.ytyp";
const MIN_MIXED_MODELS = 3;
const EMPTY_MODEL_BYTES = 4096;
const MODEL_EXTENSIONS = [".ydr", ".yft", ".ydd"];
const PROC_MODEL = /^proc_[a-z0-9_]+\.(?:ydr|yft)$/;
const GRASS_MAP = /_grass_\d+\.ymap$/;

function vegetationArchiveStem(at) {
  const folder = String(at ?? "").toLowerCase().split("/").at(-2) ?? "";
  return folder.startsWith("v_") && folder.endsWith(".rpf") ? folder.slice(0, -".rpf".length) : null;
}

const VEGETATION_ARCHIVES = new Set(
  (inventory.trees ?? []).map((row) => vegetationArchiveStem(row.at)).filter(Boolean),
);

function fileName(path) {
  return String(path || "").split("/").pop().toLowerCase();
}

function isModelFile(name) {
  return MODEL_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function baseName(name) {
  const dot = name.lastIndexOf(".");
  const bare = dot < 0 || dot === name.length - 1 ? name : name.slice(0, dot);
  const plus = bare.indexOf("+");
  return plus < 0 ? bare : bare.slice(0, plus);
}

export function isVegetationModel(name) {
  const file = fileName(name);
  return Boolean(
    stockVegetationKind(file) ||
      VEGETATION_MODEL_NAME.test(file) ||
      file === PROC_ARCHETYPE ||
      PROC_MODEL.test(file),
  );
}

function isGrassFinding(finding) {
  return (
    finding.origin === "container" && finding.category === "mapping" && finding.hint === GRASS_HINT
  );
}

function isObjectModel(entry) {
  return isModelFile(fileName(entry.path)) && !isVegetationModel(entry.path);
}

function followsObjects(entry, objectBases) {
  const name = fileName(entry.path);
  const base = baseName(name);
  if (name.endsWith(".ytyp") && !VEGETATION_ARCHIVES.has(base) && name !== PROC_ARCHETYPE) {
    return true;
  }
  return !isModelFile(name) && !name.endsWith(".ymap") && objectBases.has(base);
}

function objectsEvidence(models) {
  const empty = models.filter((entry) => {
    const size = Number(entry.size);
    return size > 0 && size < EMPTY_MODEL_BYTES;
  }).length;
  const tail = empty ? `, ${empty} — пустыми моделями` : "";
  return `${models.length} штатных объектов не из растительности рядом с картами травы${tail}`;
}

function objectsFinding(finding, entries, evidence) {
  const label = finding.container?.label;
  const recategorized = recategorizeFinding({ ...finding, entries }, OBJECTS_CATEGORY, evidence, {
    targetLookup: placeTarget,
    hint: null,
  });
  return {
    ...recategorized,
    id: `${String(finding.id).replace(/::[^:]+$/, "")}::objects`,
    title: label ? `Оптимизация объектов · ${label}` : "Оптимизация объектов",
  };
}

export function splitObjectsOutOfVegetation(finding) {
  if (!isGrassFinding(finding)) return [finding];
  const entries = finding.entries || [];
  const models = entries.filter(isObjectModel);
  if (models.length < MIN_MIXED_MODELS) return [finding];

  const objectBases = new Set(models.map((entry) => baseName(fileName(entry.path))));
  const taken = new Set([
    ...models,
    ...entries.filter((entry) => followsObjects(entry, objectBases)),
  ]);
  const objects = objectsFinding(finding, [...taken], objectsEvidence(models));
  const rest = entries.filter((entry) => !taken.has(entry));
  return rest.length ? [{ ...finding, entries: rest }, objects] : [objects];
}

export async function refineGrassRemoval(finding, { readBytes, countGrass }) {
  if (!countGrass || !isGrassFinding(finding) || finding.removes) return finding;

  const maps = (finding.entries || []).filter((entry) => GRASS_MAP.test(fileName(entry.path)));
  let empty = 0;
  for (const entry of maps) {
    try {
      // Ответ счёта намеренно не дожидается: обещание истинно и пустой картой не считается.
      if (!countGrass(await readBytes(entry.path))) empty += 1;
    } catch {
      // Сбойная карта остаётся в общем числе, но пустой не считается.
    }
  }
  if (empty === 0 || empty * 2 < maps.length) return finding;

  return {
    ...finding,
    removes: true,
    evidence: `${String(finding.evidence)}; в ${empty} из ${maps.length} карт ни травинки — мод траву убирает`,
  };
}
