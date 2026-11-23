import * as bridge from "./gunpack-bridge.js";
import { tr } from "../../../../locales/ui.js";
import * as tracerStore from "./gunpack-tracers.js";
import { useRememberedState } from "../../../../section-memory.js";
import * as studio from "./useGunpackStudio.js";
import * as React from "react";

/* ---------- раскладка паков ---------- */

const isComposable = ({ available, composed }) => available !== false && !composed;

export const composablePacks = (packs) => (packs || []).filter(isComposable);

const variantPairs = (packs) =>
  composablePacks(packs).flatMap((pack) => Array.from(pack.variants ?? [], (variant) => ({ pack, variant })));

const weaponsOfPack = (pack) =>
  Array.from(pack.variants ?? []).flatMap((variant) =>
    Array.from(variant.weapons ?? [], (weapon) => ({ pack, variant, weapon })),
  );

export const builderSlots = (packs) => {
  const entries = composablePacks(packs).flatMap(weaponsOfPack);
  const bySlot = entries
    .filter(({ weapon }) => weapon.kind !== "parts")
    .reduce((slots, entry) => {
      const slot = slots.get(entry.weapon.model) ?? openSlot(entry.weapon);
      slot.versions.push(versionOf(entry));
      return slots.set(entry.weapon.model, slot);
    }, new Map());
  return Array.from(bySlot.values()).sort(byFamilyThenName);
};

export const attachmentSources = (packs) =>
  variantPairs(packs)
    .filter(({ variant }) => variant.attachments?.length)
    .map(({ pack, variant }) => {
      const { attachments } = variant;
      const hidden = attachments.filter((part) => part.hidden).length;
      return {
        packId: pack.id,
        variantKey: variant.key,
        label: ownerLabel(pack, variant),
        count: attachments.length,
        hidden,
      };
    });

function openSlot({ model, weaponId, name, family, slang }) {
  return { model, weaponId: weaponId || "", name, family, slang: slang || [], versions: [] };
}

function versionOf({ pack, variant, weapon }) {
  const packName = ownerLabel(pack, variant);
  return { packId: pack.id, packName, variantKey: variant.key, variant, weapon };
}

// У пака с несколькими вариантами к имени добавляется подпись варианта.
function ownerLabel(pack, variant) {
  if (pack.variants.length <= 1) return pack.name;
  return `${pack.name} · ${variant.label}`;
}

const familyRank = (family) => FAMILY_RANK.get(family) ?? FAMILY_RANK.size;

function byFamilyThenName(left, right) {
  const gap = familyRank(left.family) - familyRank(right.family);
  if (gap !== 0) return gap;
  const [first, second] = [left, right].map(({ name }) => String(name));
  return first.localeCompare(second, "ru");
}

/* ---------- хук сборки ---------- */

export const useGunpackBuilder = ({ packs, onSaved }) => {
  const { fields, set } = useBuilderMemory();
  const tracers = useEffectTracers(fields.open);
  const thumbs = useShotThumbs(fields.open, packs);
  const [isSaving, setSaving] = React.useState(false);

  const slots = React.useMemo(() => builderSlots(packs), [packs]);
  const slot = slots.find(({ model }) => model === fields.model) ?? null;
  const wanted = slot ? fields.picks[slot.model] : undefined;
  const [error, setError] = React.useState("");

  const start = React.useCallback(
    (...args) => startBuild(slots, { ...set, setError }, ...args),
    // сеттеры стабильны, поэтому ссылка на start меняется только вместе со слотами
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slots],
  );
  const choose = React.useCallback(
    (key, version) => set.picks((current) => withPick(current, key, version)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const { attachments, editingId, name, picks } = fields;
  const save = React.useCallback(async () => {
    const chosen = pickList(picks);
    if (!(chosen.length && name.trim())) return;

    setError("");
    setSaving(true);
    const input = { ...(editingId && { id: editingId }), name, picks: chosen, attachments };
    await new Promise((resolve) => resolve(bridge.composePack(input)))
      .then((summary) => {
        set.open(false);
        return onSaved?.(summary);
      })
      .catch((reason) => setError(refusalText(reason)))
      .finally(() => setSaving(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments, editingId, name, onSaved, picks]);

  const sources = React.useMemo(() => attachmentSources(packs), [packs]);
  const pickedCount = Object.keys(picks).length;

  return {
    ...fields,
    slots,
    slot,
    shown: slot ? findShown(slot, wanted) : null,
    sources,
    thumbs,
    tracers,
    thumbOf: makeThumbOf(thumbs),
    picked: pickedCount,
    isChosen: makeIsChosen(wanted),
    start,
    choose,
    save,
    saving: isSaving,
    error,
    cancel: () => set.open(false),
  };
};

/* ---------- части хука ---------- */

// Состояние сборки переживает уход из раздела (общая память окна).
function useBuilderMemory() {
  const cells = {
    open: useRememberedState("gunpack:builder:open", false),
    editingId: useRememberedState("gunpack:builder:editing", ""),
    name: useRememberedState("gunpack:builder:name", ""),
    picks: useRememberedState("gunpack:builder:picks", {}),
    attachments: useRememberedState("gunpack:builder:attachments", null),
    model: useRememberedState("gunpack:builder:model", ""),
  };
  const {
    open: [isOpen, setIsOpen],
    editingId: [editing, setEditing],
    name: [title, setTitle],
    picks: [chosen, setChosen],
    attachments: [parts, setParts],
    model: [focused, setFocused],
  } = cells;

  return {
    fields: {
      open: isOpen,
      editingId: editing,
      name: title,
      setName: setTitle,
      picks: chosen,
      attachments: parts,
      setAttachments: setParts,
      model: focused,
      setModel: setFocused,
    },
    set: {
      open: setIsOpen,
      editingId: setEditing,
      name: setTitle,
      picks: setChosen,
      attachments: setParts,
      model: setFocused,
    },
  };
}

function useEffectTracers(open) {
  const [found, remember] = React.useReducer(
    (_previous, next) => next,
    open,
    (isOpen) => (isOpen ? tracerStore.readEffectsTracers() : { ...NO_TRACERS }),
  );
  React.useEffect(() => {
    if (open) remember(tracerStore.readEffectsTracers());
  }, [open]);
  return found;
}

function startBuild(slots, setters, composed = null) {
  setters.setError("");
  const composition = composed?.composition ?? null;
  const saved = composition?.picks || [];
  const restored = Object.fromEntries(saved.map(({ model: key, packId, variantKey }) => [key, { packId, variantKey }]));
  const model = [saved[0], slots[0]].map((entry) => entry?.model).find(Boolean) ?? "";
  const title = composed?.name || tr("Моя сборка");

  setters.editingId(composed?.id || "");
  setters.name(title);
  setters.picks(restored);
  setters.attachments(composition?.attachments || null);
  setters.model(model);
  setters.open(true);
}

const pickList = (picks) => Object.keys(picks).map((model) => ({ ...picks[model], model }));

const withPick = (picks, key, version) =>
  version
    ? { ...picks, [key]: version }
    : Object.fromEntries(Object.entries(picks).filter(([existing]) => existing !== key));

const samePick = ({ packId, variantKey }, version) => packId === version.packId && variantKey === version.variantKey;

function findShown(slot, pick) {
  const match = pick ? slot.versions.find((version) => samePick(pick, version)) : undefined;
  return match ?? slot.versions[0];
}

const makeIsChosen = (pick) => (version) => Boolean(pick) && samePick(pick, version);

const thumbKey = (packId, variantKey, model) => `${packId}|${variantKey}|${model}`;

const makeThumbOf = (thumbs) => (version) =>
  version ? thumbs[thumbKey(version.packId, version.variantKey, version.weapon.model)] : null;

/* ---------- кадры версий ---------- */

// Одно чтение кадров: паки идут по очереди, ссылки blob: хранятся для освобождения.
class ShotJob {
  stale = false;
  urls = [];

  async read(sources, found = {}) {
    if (sources.length === 0) return found;
    const [pack, ...rest] = sources;
    const shots = await bridge.packShots(pack.id).catch(noShots);
    if (this.stale) return null;
    for (const { variant, weapon } of weaponsOfPack(pack)) {
      const bytes = shots?.[studio.shotKey(variant, weapon.model)];
      if (bytes) found[thumbKey(pack.id, variant.key, weapon.model)] = this.link(bytes);
    }
    return this.read(rest, found);
  }

  link(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], PNG));
    this.urls.push(url);
    return url;
  }

  cancel() {
    this.stale = true;
    this.urls.forEach((url) => URL.revokeObjectURL(url));
    this.urls = [];
  }
}

// Кадры появляются одним обновлением после чтения всех паков; отмена освобождает ссылки.
function useShotThumbs(open, packs) {
  const [thumbs, setThumbs] = React.useState({});
  const packsKey = composablePacks(packs)
    .map(({ id }) => id)
    .join("|");

  React.useEffect(() => {
    const sources = open ? composablePacks(packs) : [];
    if (sources.length === 0) return undefined;

    const job = new ShotJob();
    job.read(sources).then((found) => {
      if (found && !job.stale) setThumbs(found);
    });
    return () => {
      setThumbs({});
      job.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, packsKey]);

  return thumbs;
}

// Из отказа главного процесса убирается служебное начало «Error invoking remote method '…': [Error: ]».
function refusalText(reason) {
  const text = String(reason?.message || reason);
  const quote = text.startsWith(IPC_HEAD) ? text.indexOf("'", IPC_HEAD.length) : -1;
  if (quote < 0 || !text.startsWith("': ", quote)) return text;
  const rest = text.slice(quote + 3);
  return rest.startsWith("Error: ") ? rest.slice("Error: ".length) : rest;
}

const noShots = () => ({});
const PNG = { type: "image/png" };
const NO_TRACERS = { draft: null, installed: null };
const IPC_HEAD = "Error invoking remote method '";
const FAMILY_RANK = new Map(
  "pistol smg rifle shotgun sniper machinegun launcher melee thrown".split(" ").map((family, at) => [family, at]),
);
