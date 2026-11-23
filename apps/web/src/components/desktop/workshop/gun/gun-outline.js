import { weaponById } from "@modovik/rpf-inspector/weapon-identity";
import { readGameWeaponModel, gameWeaponModelsAvailable } from "../../../../api.js";
import { useState, useEffect } from "react";

// Память окна: итоги по модели ствола, идущие чтения и те, кто ждёт конца чтения.
const ledger = { done: new Map(), busy: new Map(), ears: new Set() };

const modelOf = (weaponId) => weaponById(weaponId || "")?.model ?? "";

export function weaponOutline(weaponId, resolveGameRoot) {
  const model = modelOf(weaponId);
  if (!model || !gameWeaponModelsAvailable()) return Promise.resolve(null);
  if (ledger.done.has(model)) return Promise.resolve(ledger.done.get(model));
  return ledger.busy.get(model) ?? beginRead(model, resolveGameRoot);
}

export function useWeaponOutline(weaponId, resolveGameRoot) {
  const repaint = useRepaint();
  const model = modelOf(weaponId);
  const allowed = Boolean(model) && Boolean(resolveGameRoot) && gameWeaponModelsAvailable();
  const phase = !allowed ? "idle" : ledger.done.has(model) ? "ready" : "waiting";

  useEffect(() => {
    if (phase !== "waiting") return undefined;
    const lease = { live: true };
    weaponOutline(weaponId, resolveGameRoot).then(() => {
      if (lease.live) repaint(nextTick);
    });
    return () => {
      lease.live = false;
    };
  }, [allowed, phase, model, weaponId, resolveGameRoot, repaint]);

  return VIEWS[phase](model);
}

export function useKnownWeaponOutline(weaponId) {
  const repaint = useRepaint();
  const model = modelOf(weaponId);

  useEffect(() => {
    const ear = (finished) => {
      if (finished === model) repaint(nextTick);
    };
    ledger.ears.add(ear);
    return () => {
      ledger.ears.delete(ear);
    };
  }, [model, repaint]);

  return ledger.done.get(model) ?? null;
}

export function forgetWeaponOutlines() {
  ledger.done.clear();
  ledger.busy.clear();
}

function useRepaint() {
  const [, setTicks] = useState(0);
  return setTicks;
}

function nextTick(count) {
  return count + 1;
}

function beginRead(model, findRoot) {
  const flight = locateRoot(findRoot)
    .then((gameRoot) => (gameRoot ? askDesktop(gameRoot, model) : null))
    .catch(() => null)
    .then((outline) => landRead(model, outline));
  ledger.busy.set(model, flight);
  return flight;
}

// Ошибки поиска папки (в том числе синхронные) и «не функция» дают пустую папку.
function locateRoot(find) {
  return new Promise((resolve) => {
    resolve(typeof find === "function" ? find() : "");
  });
}

function askDesktop(gameRoot, model) {
  return new Promise((resolve) => {
    resolve(readGameWeaponModel({ gameRoot, model, outline: true }));
  }).then((reply) => shapeOutline(reply?.outline));
}

function landRead(model, outline) {
  ledger.done.set(model, outline);
  ledger.busy.delete(model);
  for (const ear of ledger.ears) ear(model);
  return outline;
}

function shapeOutline(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const { width, height, path, spots } = raw;
  const sized = width > 0 && height > 0;
  const drawn = typeof path === "string" && path.startsWith("M");
  return sized && drawn ? { width, height, path, spots: shapeSpots(spots) } : null;
}

function shapeSpots(spots) {
  if (typeof spots !== "object" || spots === null) return {};
  const kept = [];
  for (const [bone, at] of Object.entries(spots)) {
    if (isPoint(at)) kept.push([bone, [at[0], at[1]]]);
  }
  return Object.fromEntries(kept);
}

function isPoint(value) {
  return Array.isArray(value) && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

const VIEWS = {
  idle: () => ({ outline: null, pending: false }),
  waiting: () => ({ outline: null, pending: true }),
  ready: (model) => ({ outline: ledger.done.get(model), pending: false }),
};
