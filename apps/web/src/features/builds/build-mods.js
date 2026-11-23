import { cloudCatalogIDPattern, isCatalogBundle } from "../../catalog-utils.js";
import { knownBlockReason } from "./install-plan.js";
import { readModFaces, rememberModFaces, withRememberedFace } from "./mod-faces.js";
import { readModNames, rememberModNames } from "./mod-names.js";
import { useEffect, useMemo, useState } from "react";

// ---------- состояние каталога и причины блокировки ----------

export const catalogStateOf = (connection) => {
  for (const [state, applies] of CATALOG_STATES) {
    if (applies(connection)) return state;
  }
  return "ready";
};

export function buildBlockReason(mod, catalogState) {
  if (mod) return knownBlockReason(mod);
  return catalogState === "ready" ? "missing" : "";
}

// ---------- что войдёт в новую сборку ----------

export function newBuildModIds(ids = [], options = {}) {
  const { modsById = null, catalogState = "ready", cloud = false } = options;
  const catalog = typeof modsById?.get === "function" ? modsById : EMPTY_CATALOG;
  // Неизвестный мод ждёт каталога, только если сборка не облачная и каталог ещё не готов
  const unknownMayWait = !cloud && catalogState !== "ready";

  const accepts = (id) => {
    const mod = catalog.get(id);
    return mod ? acceptsFound(mod, id, cloud) : unknownMayWait && !isSystemId(id);
  };
  return ids.filter(accepts);
}

function acceptsFound(mod, id, cloud) {
  if (mod.internal || isCatalogBundle(mod)) return false;
  if (!cloud) return true;
  return cloudCatalogIDPattern.test(id) && cloudCatalogIDPattern.test(mod.releaseId);
}

function isSystemId(id) {
  const text = String(id);
  for (const prefix of SYSTEM_PREFIXES) {
    if (text.startsWith(prefix)) return true;
  }
  return false;
}

// ---------- записи открытой сборки ----------

export function openedBuildMods(modIds = [], { modsById, names, faces = {}, catalogState }) {
  const out = [];
  for (const id of modIds) {
    const mod = modsById.get(id);
    out.push(mod || withRememberedFace(placeholderMod(id, names[id] || "", catalogState), faces[id]));
  }
  return out;
}

function placeholderMod(id, name, catalogState) {
  return catalogState === "ready"
    ? { id, name, missing: true }
    : { id, name, pending: catalogState };
}

// ---------- хуки ----------

export function useModNames(profiles, modsById) {
  const ids = useMemo(() => modIdsOf(profiles), [profiles]);
  return useMemoryOf(readModNames, rememberModNames, ids, modsById);
}

export function useModFaces(profiles, installed, modsById) {
  const ids = useMemo(() => {
    const all = new Set(modIdsOf(profiles));
    for (const id of installed) all.add(id);
    return [...all];
  }, [profiles, installed]);
  return useMemoryOf(readModFaces, rememberModFaces, ids, modsById);
}

export function useUntickMissing(catalogState, modsById, blockOf, setEnabled) {
  useEffect(() => {
    if (catalogState !== "ready") return;
    setEnabled((current) => withoutBlocked(current, blockOf));
    // blockOf и setEnabled берём из той отрисовки, где сработал эффект
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogState, modsById]);
}

// Состояние, прочитанное из хранилища один раз и дополняемое при смене ids или каталога
function useMemoryOf(read, remember, ids, modsById) {
  const [memory, setMemory] = useState(read);
  useEffect(() => {
    const next = remember(ids, modsById, memory);
    if (next !== memory) setMemory(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, modsById]);
  return memory;
}

function modIdsOf(profiles) {
  const seen = new Set();
  for (const profile of profiles) {
    for (const id of profile.modIds ?? []) seen.add(id);
  }
  return [...seen];
}

// Тот же Set, если снимать нечего; у массива нет size, поэтому он всегда превращается в новый Set
function withoutBlocked(current, blockOf) {
  const kept = [];
  for (const id of current) {
    if (!blockOf(id)) kept.push(id);
  }
  return kept.length === current.size ? current : new Set(kept);
}

// ---------- таблицы ----------

// Загрузка главнее недоступности
const CATALOG_STATES = [
  ["loading", (connection) => connection?.catalogLoading],
  ["offline", (connection) => connection?.gap?.catalog],
];

const SYSTEM_PREFIXES = ["astral-", "local-", "@"];

const EMPTY_CATALOG = { get: () => undefined };
