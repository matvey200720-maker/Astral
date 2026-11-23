import * as gameApi from "../../../../api.js";
import * as thumbs from "./model-thumbnail.js";
import * as assets from "../workshop-assets.js";
import * as identity from "@modovik/rpf-inspector/weapon-identity";

export const forgetAttachmentIcons = () => {
  shelf.forget();
};

export function attachmentIconKey(weaponModel, componentId) {
  return [KEY_HEAD, weaponModel, componentId].map(String).join(":");
}

export function attachmentIcon(request) {
  const { bone, component, resolveGameRoot } = request;
  const wanted = request.wanted === undefined ? ALWAYS_WANTED : request.wanted;
  const model = identity.weaponById(request.weaponId || "")?.model;
  const componentId = component?.id;
  if (!(model && bone && componentId)) return Promise.resolve(refusal("failed"));

  const key = attachmentIconKey(model, componentId);
  return shelf.lend({ key, model, bone, componentId, resolveGameRoot }, wanted);
}

// Память окна: загрузки по ключу и «желающие» (плитки, которым картинка ещё нужна).
// Набор желающих живёт только пока загрузка идёт; повторные вызовы за готовой картинкой ничего не копят.
class IconShelf {
  constructor() {
    this.loads = new Map();
    this.crowds = new Map();
    this.era = 0;
  }

  lend(job, wanted) {
    const running = this.loads.get(job.key);
    if (running === undefined) return this.begin(job, wanted);
    this.crowds.get(job.key)?.add(wanted);
    return running;
  }

  forget() {
    this.era += 1;
    this.loads.clear();
    this.crowds.clear();
  }

  begin(job, wanted) {
    const era = this.era;
    this.crowds.set(job.key, new Set([wanted]));
    const load = this.persist(job, 1).then(
      (outcome) => {
        this.wrapUp(job.key, era, "reason" in outcome);
        return outcome;
      },
      (failure) => {
        this.wrapUp(job.key, era, false);
        throw failure;
      },
    );
    this.loads.set(job.key, load);
    return load;
  }

  // Успех остаётся в памяти, неуспех стирается; отказ самого промиса (порча хранилища) залипает.
  wrapUp(key, era, dropLoad) {
    if (era !== this.era) return;
    this.crowds.delete(key);
    if (dropLoad) this.loads.delete(key);
  }

  // Прерванное чтение начинается заново с хранилища; всего RETRY.turns попыток.
  persist(job, turn) {
    return this.attempt(job).then((outcome) => {
      if (!wasInterrupted(outcome)) return outcome;
      if (turn >= RETRY.turns) return refusal("failed");
      return pause(RETRY.pauseMs).then(() => this.persist(job, turn + 1));
    });
  }

  attempt(job) {
    return peekStore(job.key).then((stored) => (stored ? { url: URL.createObjectURL(stored) } : this.viaGame(job)));
  }

  viaGame(job) {
    if (!gameApi.gameWeaponModelsAvailable()) return refusal("unavailable");
    return thumbs.queueModelThumbnail(() => this.shoot(job));
  }

  shoot(job) {
    const ctx = { ...job, crowdWants: () => this.anyoneWaits(job.key) };
    return runSteps(ctx).catch(reasonFromError);
  }

  // Опрос идёт один раз за очередь и останавливается на первой истине.
  anyoneWaits(key) {
    const crowd = this.crowds.get(key);
    return crowd !== undefined && [...crowd].some((stillWants) => stillWants());
  }
}

async function runSteps(ctx) {
  for (const step of SHOOTING_STEPS) {
    const verdict = await step(ctx);
    if (verdict) return verdict;
  }
  return develop(ctx.key, ctx.reply.bytes);
}

// Модель обвеса -> снимок -> запись в хранилище; адрес модели отзывается при любом исходе.
function develop(key, bytes) {
  const modelBlob = new Blob([bytes], { type: MODEL_MIME });
  const modelUrl = URL.createObjectURL(modelBlob);
  return new Promise((resolve) => resolve(thumbs.renderModelThumbnail(modelUrl, snapshotLook())))
    .then((picture) => Promise.resolve(assets.putWorkshopAsset(key, picture)).then(() => ({ url: URL.createObjectURL(picture) })))
    .finally(() => URL.revokeObjectURL(modelUrl));
}

function peekStore(key) {
  return new Promise((resolve) => resolve(assets.getWorkshopAsset(key))).catch(() => null);
}

function slotMatcher(bone, componentId) {
  return (part) => part.component === componentId && part.bone === bone;
}

function askBody({ gameRoot, model, bone, componentId }) {
  const attachments = { [bone]: componentId };
  return { gameRoot, model, attachments, attachmentsOnly: true, icon: true };
}

function refusal(name) {
  return { reason: ICON_REASON[name] };
}

function reasonFromError(error) {
  return { reason: String(error?.message || ICON_REASON.failed) };
}

function wasInterrupted(outcome) {
  return typeof outcome.reason === "string" && outcome.reason.includes(CANCEL_MARK);
}

function pause(ms) {
  return new Promise((release) => {
    setTimeout(release, ms);
  });
}

const snapshotLook = () => ({ finish: "metal", tight: true });

// Шаги чтения игры по порядку; шаг, вернувший итог, останавливает остальные.
const SHOOTING_STEPS = [
  (ctx) => (ctx.crowdWants() ? undefined : refusal("failed")),
  async (ctx) => {
    const { resolveGameRoot } = ctx;
    ctx.gameRoot = await resolveGameRoot();
    return ctx.gameRoot ? undefined : refusal("game");
  },
  async (ctx) => {
    ctx.reply = await gameApi.readGameWeaponModel(askBody(ctx));
  },
  (ctx) => {
    ctx.part = ctx.reply.parts?.find(slotMatcher(ctx.bone, ctx.componentId));
    return ctx.part ? undefined : refusal("absent");
  },
  ({ part }) => (part.skipped ? { reason: SKIP_REASONS[part.skipped] ?? ICON_REASON.absent } : undefined),
];

const MODEL_MIME = "model/gltf-binary";
const CANCEL_MARK = "WEAPON_READ_CANCELLED";
const RETRY = { turns: 3, pauseMs: 400 };
const ALWAYS_WANTED = () => true;

export const ATTACHMENT_ICON_VERSION = 3;

const KEY_HEAD = `attachicon${ATTACHMENT_ICON_VERSION}`;

export const ICON_REASON = Object.freeze(
  Object.fromEntries([
    ["unavailable", "Картинки обвесов берутся из вашей игры: откройте мастерскую в Astral Desktop с подключённой GTA V."],
    ["game", "GTA V Legacy не найдена — картинку обвеса не снять."],
    ["absent", "Модели этого обвеса нет в вашей игре — картинки не будет."],
    ["read", "Модель этого обвеса не читается — картинки не будет."],
    ["bone", "У ствола нет кости под этот обвес — картинки не будет."],
    ["failed", "Картинка обвеса не снялась — попробуем снова позже."],
  ]),
);

// «skipped» из ответа игры -> причина; обычный объект, незнакомое имя даёт absent.
const SKIP_REASONS = Object.fromEntries(["bone", "read", "game", "absent"].map((name) => [name, ICON_REASON[name]]));

const shelf = new IconShelf();
