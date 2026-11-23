import {
  findTemplate,
  parseGunProject,
  serializeGunProject,
} from "@modovik/gun-studio";
import { useWorkActions } from "../../../../features/workshop/works/useWorkActions.jsx";
import { storeGunThumbnail } from "./gun-images.js";
import { tr } from "../../../../locales/ui.js";
import { gunCode } from "../../../../features/workshop/works/work-transfer.js";
import { fill, tl } from "./gun-copy.js";
import {
  putGunDraftEntry,
  CLOTHING_DRAFTS_KEY,
  draftGenderOf,
  draftSlot,
} from "../../../../features/workshop/works/gun-draft-store.js";
import {
  linkedEditorWork,
  saveEditorWorkToWorks,
  unlinkEditorWork,
} from "../../../../features/workshop/works/workshop-works.js";

// Поля options, которые нужны обработчикам: срез строится заново каждый рендер,
// поэтому значения всегда свежие.
const SLICE_KEYS = [
  "profile",
  "slotId",
  "slotName",
  "project",
  "history",
  "scene",
  "ready",
  "onOpened",
  "onChanged",
];

const plainProject = (ctx) => JSON.parse(serializeGunProject(ctx.project));

// Строка состояния работы: порядок полей — порядок ключей в строке.
const FIELD_SOURCES = {
  slot: (ctx) => ctx.slotId,
  thumbnail: (ctx, shot) => shot,
  project: (ctx) => plainProject(ctx),
};
const SAVE_FIELDS = ["slot", "thumbnail", "project"];
const SHARE_FIELDS = ["slot", "project"];

const encodeState = (ctx, fields, shot = "") =>
  JSON.stringify(
    Object.fromEntries(fields.map((field) => [field, FIELD_SOURCES[field](ctx, shot)])),
  );

const renderSlice = (options) => {
  const slice = Object.fromEntries(SLICE_KEYS.map((key) => [key, options[key]]));
  return { kind: slice.profile.workKind, ...slice };
};

const linkedWorkName = (ctx) => linkedEditorWork(ctx.kind, undefined, ctx.slotId)?.name || "";

// Кадр обложки снимается с живой сцены; отказ хранилища кадров не мешает сохранению.
async function sceneThumbnail({ scene, ready }) {
  if (!(scene.current && ready)) return "";
  scene.current.snapshot?.();
  const pending = storeGunThumbnail(scene.current.canvas);
  return pending.catch(() => "");
}

const baseLabel = ({ slotName, profile }) => slotName || profile.noun.one;

function suggestedName(ctx) {
  const template = findTemplate(ctx.project.template);
  const base = baseLabel(ctx);
  if (template && template.id !== "factory") return `${tl(template.label.ru)} — ${base}`;
  return `${ctx.profile.noun.mine}: ${base.toLowerCase()}`;
}

async function saveWork(ctx, { name, asNew }) {
  const { kind, onChanged } = ctx;
  const state = encodeState(ctx, SAVE_FIELDS, await sceneThumbnail(ctx));
  const { work: saved, created } = saveEditorWorkToWorks(kind, state, { name, asNew });
  onChanged?.();
  const { name: savedName } = saved;
  return { name: savedName, created };
}

async function shareCode(ctx) {
  const { kind } = ctx;
  const state = encodeState(ctx, SHARE_FIELDS);
  return gunCode(state, { name: linkedWorkName(ctx), kind });
}

// Работу другой вещи не открываем здесь: на чужой развёртке слои легли бы не на те детали.
function otherSlotError(profile, foreignSlot) {
  const text = tr("Это работа для «{name}» — она ждёт в мастерской этой вещи.");
  const shown = profile.slotName(foreignSlot) || foreignSlot;
  return Object.assign(new Error(fill(text, { name: shown })), { reason: "other-slot" });
}

function adoptHere({ kind, slotId, history, onOpened }, parsed) {
  unlinkEditorWork(kind, undefined, slotId);
  history.reset(parseGunProject(parsed.project));
  onOpened?.();
}

function parkElsewhere({ profile }, parsed) {
  /* Одежда: женская работа ждёт в женском черновике слота (ревью п. 4). */
  const key = profile.draftsKey === CLOTHING_DRAFTS_KEY ? draftSlot(parsed.slot, draftGenderOf(parsed.project?.modelId)) : parsed.slot;
  putGunDraftEntry(key, parsed.project, undefined, profile.draftsKey);
  throw otherSlotError(profile, parsed.slot);
}

function openWork(ctx, result) {
  const parsed = JSON.parse(result.templates[0].state);
  const route = parsed.slot === ctx.slotId ? adoptHere : parkElsewhere;
  return route(ctx, parsed);
}

export function useStudioWorks(options) {
  const ctx = renderSlice(options);
  const { kind } = ctx;

  return useWorkActions({
    kind,
    onNotice: options.onNotice,
    linkedName: () => linkedWorkName(ctx),
    defaultName: () => suggestedName(ctx),
    onSave: (args) => saveWork(ctx, args),
    onCopy: () => shareCode(ctx),
    onOpen: (result) => openWork(ctx, result),
    accept: [kind],
  });
}
