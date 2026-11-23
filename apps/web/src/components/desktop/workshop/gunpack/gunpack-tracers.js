import { findStudioTracerWeapon } from "@modovik/tracer-contract";
import { sameTracerLook, weaponTracer } from "../tracer-profiles.js";
import * as ptfx from "@modovik/ptfx-studio";

// Два места, откуда студия эффектов отдаёт набор: черновик и запись установки.
class Shelf {
  constructor(storage) {
    this.storage = storage;
  }

  draft() {
    return this.load(DRAFT_KEY, (parsed) => parsed);
  }

  installed() {
    return this.load(INSTALL_KEY, (record) => record.installedProject);
  }

  // Сначала черновик, потом запись установки.
  both() {
    return [this.draft(), this.installed()];
  }

  // Любая неудача на пути (хранилище, JSON, разбор проекта) — «записи нет».
  load(key, unwrap) {
    try {
      const candidate = unwrap(JSON.parse(this.storage.getItem(key) || "null"));
      return typeof candidate === "object" && candidate !== null ? ptfx.parseProject(candidate) : null;
    } catch {
      return null;
    }
  }

  stash(project) {
    try {
      this.storage.setItem(DRAFT_KEY, JSON.stringify(project));
    } catch {
      // приватный режим или нет хранилища: правка остаётся неприменённой
    }
  }
}

// Правка идёт от текущего черновика (или от нового проекта); ошибка соседа — до записи.
function amendDraft(shelf, edit) {
  const base = shelf.draft() ?? ptfx.serializeProject(ptfx.createProject());
  shelf.stash(edit(base));
}

function shotOf(project, weaponId) {
  return {
    flash: ptfx.muzzleFlashOf(project, weaponId),
    smoke: ptfx.muzzleSmokeOf(project, weaponId),
    shell: ptfx.muzzleShellOf(project, weaponId),
  };
}

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const tracerOf = (project) => project?.tracer ?? null;
const dropWeaponMuzzle = (project, weaponId) => ptfx.withoutWeaponMuzzle(project, weaponId);

/* ---------- чтение набора ---------- */

export const readEffectsTracers = (storage = globalThis.localStorage) => {
  const [draft, installed] = new Shelf(storage).both().map(tracerOf);
  return { draft, installed };
};

export const readEffectsDraft = (storage = globalThis.localStorage) => new Shelf(storage).draft();

export const tracerWeapon = (weaponId) => Boolean(weaponId) && findStudioTracerWeapon(weaponId) != null;

export const slotTracer = (tracers, weaponId) => {
  if (!tracerWeapon(weaponId)) return null;
  const [held, live] = SOURCES.map((field) => weaponTracer(tracers?.[field], weaponId));
  return { tracer: held, inGame: sameTracerLook(held?.profile, live?.profile) };
};

/* ---------- вспышка ---------- */

export const slotMuzzle = (weaponId, storage = globalThis.localStorage) => {
  if (!tracerWeapon(weaponId)) return null;
  const [flash, live] = new Shelf(storage).both().map((project) => ptfx.muzzleFlashOf(project, weaponId));
  return { flash, inGame: sameJson(flash, live) };
};

export const saveMuzzleFlash = (weaponId, patch, storage = globalThis.localStorage) => {
  amendDraft(new Shelf(storage), (project) => ptfx.withMuzzleFlash(project, weaponId, patch));
  return slotMuzzle(weaponId, storage);
};

/* ---------- выстрел целиком ---------- */

export const weaponMuzzle = (weaponId, storage = globalThis.localStorage) => {
  if (!tracerWeapon(weaponId)) return null;
  const [draft, installed] = new Shelf(storage).both().map((project) => shotOf(project, weaponId));
  return { draft, installed, inGame: sameJson(draft, installed) };
};

export const saveWeaponMuzzle = (weaponId, kind, patch, storage = globalThis.localStorage) => {
  const edit = MUZZLE_EDITS.get(kind) ?? dropWeaponMuzzle;
  amendDraft(new Shelf(storage), (project) => edit(project, weaponId, patch));
  return weaponMuzzle(weaponId, storage);
};

/* ---------- таблицы и ключи ---------- */

const MUZZLE_EDITS = new Map([
  ["flash", (project, weaponId, patch) => ptfx.withMuzzleFlash(project, weaponId, patch)],
  ["smoke", (project, weaponId, patch) => ptfx.withMuzzleSmoke(project, weaponId, patch)],
  ["shell", (project, weaponId, shell) => ptfx.withMuzzleShell(project, weaponId, shell)],
]);

const SOURCES = ["draft", "installed"];
const DRAFT_KEY = "astral.ptfx.project.v1";
const INSTALL_KEY = "astral.effects-studio.install.v1";
