import { READ_DEADLINE_MS, withDeadline } from "./read-deadline.js";
import {
  choosePackFiles,
  gunpackStudioAvailable,
  listPacks,
  openPack,
  packWeaponModel,
} from "../gunpack/gunpack-bridge.js";
import { fill } from "./gun-copy.js";
import { chooseGunpackFile, importGunpack, listGunpacks, readGunpackModel } from "../../../../api.js";
import { tr } from "../../../../locales/ui.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useGunpackLibrary({ onNotice } = {}) {
  const store = useModelStore();
  const [lists, put] = useLibraryState();
  const { busy, library, legacy } = lists;

  useInitialLists(put);
  useStoreDisposal(store);

  const resolveModelUrl = useCallback((entry) => plainModelUrl(store, entry), [store]);
  const resolveAttachedModel = useCallback((entry) => builtModel(store, entry), [store]);
  const forgetAttached = useCallback(() => store.dropBuilt(), [store]);
  const connect = useCallback(() => joinPack({ busy, onNotice, put }), [busy, onNotice, put]);
  const refresh = useCallback(() => reloadLibrary(put), [put]);

  const packs = useMemo(() => [...library, ...legacy], [library, legacy]);
  const actions = { connect, refresh, resolveModelUrl, resolveAttachedModel, forgetAttached };

  return { packs, busy, ...actions };
}

/* состояние: три поля — три useState; наружу запись значений и одна запись в поле по имени */

function useLibraryState() {
  const cells = { legacy: useState([]), library: useState([]), busy: useState(false) };
  const holder = useRef(null);
  if (holder.current === null) {
    holder.current = Object.fromEntries(Object.entries(cells).map(([name, cell]) => [name, cell[1]]));
  }
  const setters = holder.current;
  const put = useCallback((slot, value) => setters[slot](value), [setters]);
  const state = Object.fromEntries(Object.entries(cells).map(([name, cell]) => [name, cell[0]]));
  return [state, put];
}

/* адреса моделей: обычные лежат по id, модели с обвесами — обещаниями */

class ModelStore {
  constructor() {
    this.plain = new Map();
    this.built = new Map();
  }

  remember(id, pending) {
    this.built.set(id, pending);
    // неудачную сборку не запоминаем, но и более новую запись под тем же id не трогаем
    pending.catch(() => {
      if (this.built.get(id) === pending) this.built.delete(id);
    });
    return pending;
  }

  dropBuilt() {
    this.built.forEach(revokeWhenReady);
    this.built.clear();
  }

  dropAll() {
    this.plain.forEach((url) => URL.revokeObjectURL(url));
    this.plain.clear();
    this.dropBuilt();
  }
}

async function revokeWhenReady(pending) {
  try {
    const { url } = await pending;
    URL.revokeObjectURL(url);
  } catch {
    // отказ сборки или пустой ответ отзывать нечего
  }
}

function useModelStore() {
  const holder = useRef(null);
  if (holder.current === null) holder.current = new ModelStore();
  return holder.current;
}

/* эффекты: сначала первичная загрузка списков, потом уборка адресов */

function useInitialLists(put) {
  useEffect(() => {
    const lease = { alive: true };
    LIST_SOURCES.forEach((source) => {
      if (source.usable()) fetchInto(source, lease, put);
    });
    return () => {
      lease.alive = false;
    };
  }, [put]);
}

function fetchInto({ slot, read, shape }, lease, put) {
  read()
    .then((value) => lease.alive && put(slot, shape(value)))
    .catch(() => {});
}

function useStoreDisposal(store) {
  useEffect(() => () => store.dropAll(), [store]);
}

/* модели */

async function plainModelUrl(store, entry) {
  if (store.plain.has(entry.id)) return store.plain.get(entry.id);
  const model = await requestModelBytes(entry);
  const url = glbUrl(model.bytes);
  store.plain.set(entry.id, url);
  return url;
}

function builtModel(store, entry) {
  if (store.built.has(entry.id)) return store.built.get(entry.id);
  const guarded = withDeadline(packWeaponModel(attachedQuery(entry)), READ_DEADLINE_MS, deadlineMessage);
  return store.remember(entry.id, guarded.then(toBundle));
}

function deadlineMessage() {
  return tr("Модель с обвесами слишком долго собирается — повторите, выберите другой обвес или снимите обвесы.");
}

function glbUrl(bytes) {
  const blob = new Blob([bytes], { type: GLB_TYPE });
  return URL.createObjectURL(blob);
}

function toBundle(model) {
  const url = glbUrl(model.bytes);
  return { url, parts: listOrEmpty(model.parts) };
}

function listOrEmpty(value) {
  if (!Array.isArray(value)) return [];
  return value;
}

function requestModelBytes(entry) {
  const route = entry.library === "studio" ? MODEL_ROUTES.studio : MODEL_ROUTES.file;
  return route.call(mapFields(entry, route.fields));
}

function attachedQuery(entry) {
  const present = OPTIONAL_FIELDS.filter(([, from]) => entry[from]);
  return mapFields(entry, [...ATTACHED_FIELDS, ...present]);
}

function mapFields(source, fields) {
  return Object.fromEntries(fields.map(([to, from]) => [to, source[from]]));
}

/* подключение пака: два пути, каждый — сопрограмма, шаги которой ждёт общий цикл */

async function joinPack({ busy, onNotice, put }) {
  if (busy) return null;
  put("busy", true);
  try {
    const flow = gunpackStudioAvailable() ? studioJoin(put, onNotice) : fileJoin(put, onNotice);
    let step = flow.next();
    while (!step.done) step = flow.next(await step.value);
    return step.value;
  } catch (error) {
    reportFailure(onNotice, error);
    return null;
  } finally {
    put("busy", false);
  }
}

function* studioJoin(put, notify) {
  const { paths } = (yield choosePackFiles()) || {};
  if (!paths?.length) return null;
  const pack = yield openPack({ paths });
  put("library", studioPacks(yield listPacks()));
  const count = weaponCount(pack);
  notify?.(NOTICES.studio(pack, count));
  return pack;
}

function* fileJoin(put, notify) {
  const { source } = (yield chooseGunpackFile()) || {};
  if (!source) return null;
  const pack = yield importGunpack({ source });
  put("legacy", (current) => replaceLegacy(current, pack));
  notify?.(NOTICES.legacy(pack));
  return pack;
}

function reportFailure(notify, error) {
  notify?.(String(error?.message || error), "error");
}

async function reloadLibrary(put) {
  if (!gunpackStudioAvailable()) return;
  put("library", studioPacks(await listPacks()));
}

/* списки */

function replaceLegacy(current, pack) {
  return current.filter((item) => item.id !== pack.id).concat([pack]);
}

function* weaponsOf(pack) {
  for (const variant of pack?.variants || []) yield* variant.weapons || [];
}

function weaponCount(pack) {
  let total = 0;
  for (const weapon of weaponsOf(pack)) {
    if (weapon.kind !== "parts") total += 1;
  }
  return total;
}

function isListed(pack) {
  return pack?.available !== false;
}

function studioPacks(list) {
  return (list || []).filter(isListed);
}

const GLB_TYPE = "model/gltf-binary";

const LIST_SOURCES = [
  { slot: "legacy", usable: () => true, read: () => listGunpacks(), shape: (result) => result?.packs || [] },
  { slot: "library", usable: () => gunpackStudioAvailable(), read: () => listPacks(), shape: studioPacks },
];

// поле запроса к соседу → поле записи каталога
const ATTACHED_FIELDS = [
  ["packId", "packId"],
  ["variantKey", "variantKey"],
  ["model", "weaponId"],
  ["attachments", "attachments"],
];

const OPTIONAL_FIELDS = [
  ["looks", "looks"],
  ["gameRoot", "gameRoot"],
];

const MODEL_ROUTES = {
  studio: {
    call: (query) => packWeaponModel(query),
    fields: ATTACHED_FIELDS.slice(0, 3),
  },
  file: {
    call: (query) => readGunpackModel(query),
    fields: [
      ["directory", "packDirectory"],
      ["baseName", "key"],
      ["zip", "zip"],
    ],
  },
};

const NOTICES = {
  studio: (pack, count) =>
    announce(tr("Ганпак «{name}» в «Моих паках»: стволов {count}. Он виден и в студии «Ганпаки»."), pack.name, count),
  legacy: (pack) => announce(tr("Ганпак «{name}» подключён: {count} стволов"), pack.name, pack.categories.length),
};

function announce(template, name, count) {
  return fill(template, { name, count });
}
