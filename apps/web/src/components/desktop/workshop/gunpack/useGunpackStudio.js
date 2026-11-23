import { tr } from "../../../../locales/ui.js";
import { coverKey, shotKey } from "@modovik/gunpack/ids";
import {
  choosePackFiles,
  gunpackStudioAvailable,
  listPacks,
  openPack,
  packShots,
  removePack,
  savePackShot,
  setPackLook,
} from "./gunpack-bridge.js";
import { fill } from "../gun/gun-copy.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useGunpackStudio({ initialPackId = "" } = {}) {
  const [state, set] = useSlots();
  const available = gunpackStudioAvailable();
  const { pack, variantKey, model } = state;

  const { putShot, releaseShots } = useShotGallery(set);
  const run = useBusyRunner(set);
  const { refresh, show } = usePackLoader({ available, set, putShot, releaseShots });
  useOpenOnEntry({ initialPackId, refresh, run, show });
  const commands = useStudioCommands({ pack, packs: state.packs, putShot, refresh, releaseShots, run, set, show });

  const picked = useMemo(() => pickSelection(pack, variantKey, model), [pack, variantKey, model]);

  // не сеттер: вместе с ключом варианта подбирает модель его первого ствола
  const setVariantKey = (key) => {
    set.variantKey(key);
    set.model(firstWeaponModel(findVariant(pack, key)));
  };

  return {
    available,
    ...pick(state, ["packs", "pack"]),
    ...picked,
    ...pick(state, ["shots", "busy", "error"]),
    setError: set.error,
    setVariantKey,
    setModel: set.model,
    ...commands,
  };
}

/* состояние: каждое поле — свой useState (совпадающее значение не перерисовывает), наружу — запись и таблица сеттеров */

function useSlots() {
  const cells = {
    packs: useState([]),
    pack: useState(null),
    variantKey: useState(""),
    model: useState(""),
    busy: useState(null),
    error: useState(""),
    shots: useState({}),
  };
  const holder = useRef(null);
  if (holder.current === null) holder.current = mapCells(cells, 1);
  return [mapCells(cells, 0), holder.current];
}

function mapCells(cells, index) {
  return Object.fromEntries(Object.entries(cells).map(([name, cell]) => [name, cell[index]]));
}

/* кадры: blob-адреса живут в ведомости и отзываются при смене пака и при выходе */

class ShotLedger {
  constructor() {
    this.urls = new Map();
  }

  mint(key, bytes) {
    if (this.urls.has(key)) URL.revokeObjectURL(this.urls.get(key));
    const blob = new Blob([bytes], { type: SHOT_TYPE });
    const url = URL.createObjectURL(blob);
    this.urls.set(key, url);
    return url;
  }

  retireAll() {
    this.urls.forEach((url) => URL.revokeObjectURL(url));
    this.urls.clear();
  }
}

function useShotGallery(set) {
  const holder = useRef(null);
  if (holder.current === null) holder.current = new ShotLedger();
  const ledger = holder.current;

  const releaseShots = useCallback(() => discardShots({ ledger, set }), [ledger, set]);
  const putShot = useCallback((...args) => storeShot({ ledger, set }, ...args), [ledger, set]);

  useEffect(() => releaseShots, [releaseShots]);

  return { putShot, releaseShots };
}

function discardShots({ ledger, set }) {
  ledger.retireAll();
  set.shots({});
}

function storeShot({ ledger, set }, key, bytes, meta = {}) {
  const url = ledger.mint(key, bytes);
  set.shots((current) => Object.assign({}, current, { [key]: shotRecord(url, bytes, meta) }));
}

function shotRecord(url, bytes, meta) {
  return { url, bytes, length: Number(meta.length) || 0 };
}

/* работа над списком паков */

function useBusyRunner(set) {
  return useCallback((label, task) => guarded(set, label, task), [set]);
}

async function guarded(set, label, task) {
  set.busy(label);
  set.error("");
  let outcome = null;
  try {
    outcome = await task();
  } catch (reason) {
    set.error(errorText(reason));
  } finally {
    set.busy(null);
  }
  return outcome;
}

function usePackLoader({ available, set, putShot, releaseShots }) {
  const refresh = useCallback(() => reloadList({ available, set }), [available, set]);
  const show = useCallback(
    (summary) => showPack({ putShot, releaseShots, set }, summary),
    [putShot, releaseShots, set],
  );
  return { refresh, show };
}

async function reloadList({ available, set }) {
  if (available) {
    const list = await listPacks();
    set.packs(list);
    return list;
  }
  return [];
}

async function showPack({ putShot, releaseShots, set }, summary) {
  releaseShots();
  set.pack(summary);
  applyLead(set, firstOf(summary.variants));
  const saved = await packShots(summary.id).catch(emptyShots);
  for (const [key, bytes] of Object.entries(saved || {})) {
    putShot(key, bytes, shotMeta(summary, key));
  }
}

function useOpenOnEntry({ initialPackId, refresh, run, show }) {
  useEffect(() => {
    const visit = new Visit();
    run(tr("Открываю «Мои паки»…"), () => drive(openFirstFlow({ initialPackId, refresh, show, visit })));
    return () => visit.end();
  }, [initialPackId, refresh, run, show]);
}

// отметка «запуск устарел»: ставится при очистке эффекта
class Visit {
  constructor() {
    this.stale = false;
  }

  end() {
    this.stale = true;
  }
}

function* openFirstFlow({ initialPackId, refresh, show, visit }) {
  const list = yield refresh();
  if (visit.stale) return;
  const wanted = byId(list, initialPackId) || list[0];
  if (isOpenable(wanted)) yield show(wanted);
}

/* команды: у каждой своя зависимость от рендера, поэтому свои useCallback */

function useStudioCommands({ pack, packs, putShot, refresh, releaseShots, run, set, show }) {
  const openId = pack?.id;

  const accept = useCallback((...args) => COMMANDS.accept({ refresh, run, show }, ...args), [refresh, run, show]);
  const adopt = useCallback((...args) => COMMANDS.adopt({ refresh, run, show }, ...args), [refresh, run, show]);
  const choose = useCallback((...args) => COMMANDS.choose({ accept, run }, ...args), [accept, run]);
  const select = useCallback(
    (...args) => COMMANDS.select({ packs, run, set, show }, ...args),
    [packs, run, set, show],
  );
  const forget = useCallback(
    (...args) => COMMANDS.forget({ openId, refresh, releaseShots, run, set, show }, ...args),
    [openId, refresh, releaseShots, run, set, show],
  );
  const saveShot = useCallback((...args) => COMMANDS.saveShot({ pack, putShot }, ...args), [pack, putShot]);
  const setLook = useCallback((...args) => COMMANDS.setLook({ pack, set }, ...args), [pack, set]);
  const setInstalled = useCallback((...args) => COMMANDS.setInstalled({ set }, ...args), [set]);

  return { accept, adopt, choose, select, forget, saveShot, setLook, setInstalled };
}

// сценарий с ожиданиями: каждый yield — обещание, которое ждёт общий ход
function runFlow(label, flow) {
  return (env, ...args) => env.run(label(), () => drive(flow(env, ...args)));
}

async function drive(flow) {
  let step = flow.next();
  while (!step.done) step = flow.next(await step.value);
  return step.value;
}

async function pickFiles({ accept, run }) {
  const { paths } = (await run(tr("Выбор файлов…"), later(choosePackFiles))) || {};
  return paths?.length ? accept({ paths }) : null;
}

async function selectEntry({ packs, run, set, show }, id) {
  const entry = byId(packs, id);
  if (entry && entry.available !== false) {
    await run(tr("Открываю пак…"), later(show, entry));
  } else if (entry) {
    set.error(goneMessage(entry));
  }
}

async function persistShot({ pack, putShot }, key, bytes, meta = {}) {
  if (!pack) return;
  const payload = [key, bytes, meta];
  await savePackShot(pack.id, ...payload);
  putShot(...payload);
}

async function storeLook({ pack, set }, key, look) {
  if (!pack) return;
  const packId = pack.id;
  try {
    const saved = await setPackLook(packId, key, look);
    patchPack(set, packId, (item) => withLook(item, key, saved?.look));
  } catch (reason) {
    set.error(errorText(reason));
  }
}

function markInstalled({ set }, packId, record) {
  patchPack(set, packId, (item) => {
    const rest = omit(item, "installed");
    if (!record) return rest;
    return Object.assign(rest, { installed: record });
  });
}

function withLook(item, key, look) {
  const looks = omit(item.looks || {}, key);
  if (look) looks[key] = look;
  return { ...item, looks };
}

// правка пака и его копии в списке одним обходом
function patchPack(set, packId, change) {
  const patch = (item) => (item?.id !== packId ? item : change(item));
  set.pack(patch);
  set.packs((list) => list.map((item) => patch(item)));
}

/* выбор варианта и ствола */

function pickSelection(pack, variantKey, model) {
  const variant = pickVariant(pack, variantKey);
  return { variant, weapon: pickWeapon(variant, model) };
}

function findVariant(pack, key) {
  if (!pack) return undefined;
  for (const candidate of pack.variants) {
    if (candidate.key === key) return candidate;
  }
  return undefined;
}

function pickVariant(pack, key) {
  if (!pack) return null;
  return findVariant(pack, key) || pack.variants[0] || null;
}

function pickWeapon(variant, model) {
  if (!variant) return null;
  for (const candidate of variant.weapons) {
    if (candidate.model === model) return candidate;
  }
  return null;
}

function firstWeaponModel(variant) {
  return variant?.weapons[0]?.model || "";
}

function leadModel(variant) {
  if (!variant) return "";
  const { weapons } = variant;
  let preferred;
  for (const weapon of weapons) {
    if (weapon.kind === "model") {
      preferred = weapon;
      break;
    }
  }
  return preferred?.model || weapons[0]?.model || "";
}

/* помощники */

function later(fn, ...args) {
  return () => fn(...args);
}

function firstOf(list) {
  return list[0];
}

function applyLead(set, lead) {
  set.variantKey(lead?.key || "");
  set.model(leadModel(lead));
}

function byId(list, id) {
  for (const item of list) {
    if (item.id === id) return item;
  }
  return undefined;
}

function isOpenable(pack) {
  return Boolean(pack) && pack.available !== false;
}

function shotMeta(summary, key) {
  return summary.shots?.[key] || {};
}

function pick(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

function omit(source, key) {
  const copy = { ...source };
  delete copy[key];
  return copy;
}

function goneMessage(entry) {
  const template = entry.composed
    ? tr("Одного из паков сборки «{name}» больше нет в «Моих паках» — добавьте его заново.")
    : tr("Архив пака «{name}» больше не на своём месте — добавьте его заново.");
  return fill(template, { name: entry.name });
}

// главный процесс Electron оборачивает ошибки в «Error invoking remote method 'имя': [Error: ]»
function errorText(error) {
  const reason = error?.message || error || tr("Что-то пошло не так.");
  return stripRemoteWrap(String(reason));
}

function stripRemoteWrap(text) {
  if (!text.startsWith(REMOTE_WRAP)) return text;
  const quote = text.indexOf("'", REMOTE_WRAP.length);
  if (quote <= REMOTE_WRAP.length || !text.startsWith(": ", quote + 1)) return text;
  const rest = text.slice(quote + 3);
  return rest.startsWith(REMOTE_INNER) ? rest.slice(REMOTE_INNER.length) : rest;
}

const REMOTE_WRAP = "Error invoking remote method '";
const REMOTE_INNER = "Error: ";
const SHOT_TYPE = "image/png";
const emptyShots = () => ({});

const COMMANDS = {
  accept: runFlow(
    () => tr("Разбираю пак…"),
    function* ({ refresh, show }, input) {
      const summary = yield openPack(input);
      yield refresh();
      yield show(summary);
      return summary;
    },
  ),
  adopt: runFlow(
    () => tr("Открываю сборку…"),
    function* ({ refresh, show }, summary) {
      yield refresh();
      yield show(summary);
    },
  ),
  choose: pickFiles,
  select: selectEntry,
  forget: runFlow(
    () => tr("Убираю пак…"),
    function* ({ openId, refresh, releaseShots, set, show }, id) {
      yield removePack(id);
      const list = yield refresh();
      if (openId !== id) return;
      releaseShots();
      set.pack(null);
      if (isOpenable(list[0])) yield show(list[0]);
    },
  ),
  saveShot: persistShot,
  setLook: storeLook,
  setInstalled: markInstalled,
};

export { coverKey, shotKey };
