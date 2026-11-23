/*
 * Что показать на месте ствола в кадре «Ганпак»: модель и покраска его черновика — те же, что откроет редактор ствола.
 *
 * Покраска берётся так: кадр, снятый со студии при уходе из ствола (в нём и наклейки); иначе — кадр из хранилища, снятый с этого же черновика; иначе её собирает сам черновик
 * тем же холстом, что в мастерской (`bakeOutfitDraft`): без наклеек, их печатает только сцена студии по модели. Это старый черновик, который с появления экрана ни разу не открывали.
 */

import { buildModelRegistry, normalizeDetached, normalizeSlot, normalizeModelScale, projectIsEmpty } from "@modovik/gun-studio";
import { weaponByShelf } from "@modovik/rpf-inspector/weapon-identity";
import { locateLegacyGame } from "../../../../../features/workshop/install-queue/game-root.js";
import { attachmentMode, attachmentSelection, attachmentWeapon } from "../gun-attachments.js";
import { standardGunVariant } from "../gun-models.js";
import { readGunDraft } from "../gun-drafts.js";
import { ownModels, resolveOwnModelUrl } from "../gun-own-models.js";
import { createPatternCache } from "../gun-patterns.js";
import { bakeOutfitDraft } from "../outfit-paint.js";
import { studioProfile } from "../studio-profiles.js";
import { READ_DEADLINE_MS, withDeadline } from "../read-deadline.js";
import { lendModel, recallModels } from "./model-handoff.js";
import { projectStamp, readPackPaint } from "./pack-store.js";
import { tr } from "../../../../../locales/ui.js";

const PAINT_SIZE = 1024;

/** Холст покраски в размер кадра «Ганпак»: большие листы экрану не нужны. */
export function paintCopy(source, most = PAINT_SIZE) {
  const scale = Math.min(1, most / Math.max(source.width, source.height, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/* Основа детали для сборки из черновика: отделённые куски уже на своих местах листа, как у холста студии (`moveRegion`). */
function movedBase(image, records = []) {
  if (!records.length) return { image, width: image.width, height: image.height };
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  for (const { from, to, size } of records) {
    const x = image.width / size[0];
    const y = image.height / size[1];
    context.drawImage(image, from.x * x, from.y * y, from.w * x, from.h * y, to.x * x, to.y * y, to.w * x, to.h * y);
  }
  return { image: canvas, width: canvas.width, height: canvas.height };
}

/** Читатель моделей экрана: адреса живут, пока открыт экран, и одна модель читается один раз. */
export function createPackModels({ library, catalogOf = () => [] }) {
  const profile = studioProfile("weapon");
  const urls = new Map();
  /* Простые модели игры, адрес которых отдан редактору взаймы (`model-handoff.js`): при уходе экрана реестр чистится. */
  const lentIds = new Set();
  /* Кадры, снятые со студии в этом заходе: слот → { stamp, paint }. */
  const handed = new Map();
  let patterns = null;

  const blobUrl = (result) => URL.createObjectURL(new Blob([result.bytes], { type: "model/gltf-binary" }));

  function modelOf(slot, project) {
    const catalogItems = catalogOf(slot) || [];
    const registry = buildModelRegistry({
      builtin: profile.models(),
      game: profile.gameModels(slot),
      catalog: profile.catalogModels(slot, catalogItems),
      server: [],
      packs: library.packs,
      custom: ownModels(profile.id),
    });
    const own = registry.slots.find((item) => item.slot === normalizeSlot(slot))?.variants || [];
    const custom = registry.entries.filter((entry) => entry.source === "custom" && entry.slot !== normalizeSlot(slot));
    const variants = [...own, ...custom];
    const model = variants.find((entry) => entry.id === project?.modelId) || standardGunVariant(variants, slot);
    if (!model) return { model: null, selection: {} };
    const mode = attachmentMode(model, profile.skin.target(model, slot, { catalogItems, serverTattoos: [] }));
    const selection = attachmentSelection(attachmentWeapon(model, slot, mode), mode, project?.attachments);
    return { model, mode, selection };
  }

  async function readUrl(slot, { model, mode, selection }) {
    const attached = Object.keys(selection).length > 0;
    const game = () => locateLegacyGame("");
    const deadline = (promise) => withDeadline(promise, READ_DEADLINE_MS, () => tr("Модель слишком долго читается из игры — повторите или выберите другую."));
    if (attached && mode === "pack") {
      const gameRoot = await game().catch(() => "");
      return (await library.resolveAttachedModel({ ...model, id: `${model.id}~pack`, attachments: selection, gameRoot })).url;
    }
    if (attached && mode === "game") {
      const entry = { ...model, source: "game", weaponId: model.source === "game" ? model.weaponId : weaponByShelf(slot)?.model || "", attachments: selection };
      return blobUrl(await deadline(game().then((gameRoot) => profile.readGameModel({ entry, gameRoot, slotId: slot }))));
    }
    if (model.url) return model.url;
    if (model.source === "game") return blobUrl(await deadline(game().then((gameRoot) => profile.readGameModel({ entry: model, gameRoot, slotId: slot }))));
    if (model.source === "custom") return resolveOwnModelUrl(model);
    if (model.source === "gunpack") return library.resolveModelUrl(model);
    throw new Error(tr("У модели нет файла."));
  }

  async function paintOf(slot, project, stamp, bases) {
    if (!project || projectIsEmpty(project)) return null;
    const kept = handed.get(slot);
    if (kept?.stamp === stamp) return kept.paint;
    const saved = await readPackPaint(slot, stamp).catch(() => null);
    if (saved) return saved;
    patterns ||= createPatternCache();
    const usable = new Map();
    const detached = normalizeDetached(project.detached);
    for (const [name, image] of bases) if (image) usable.set(name, movedBase(image, detached[name]));
    const baked = await bakeOutfitDraft(project, usable, patterns);
    const out = new Map();
    for (const [name, canvas] of baked) out.set(name, paintCopy(canvas));
    return out;
  }

  return {
    /** Задание сцене на этот ствол, `null` — модели нет. `stamp` — подпись: та же, что в прошлый раз, значит кадр и так верный. */
    jobOf(slot) {
      const project = readGunDraft(slot);
      const chosen = modelOf(slot, project);
      if (!chosen.model) return null;
      const attachKey = Object.keys(chosen.selection).length ? JSON.stringify(chosen.selection) : "";
      const key = `${chosen.model.id}~${attachKey}`;
      const stamp = project ? projectStamp(project) : "";
      const scale = project ? normalizeModelScale(project.modelScale) : 1;
      return {
        key,
        stamp: `${key}|${stamp}|${scale}`,
        scale,
        detached: project ? normalizeDetached(project.detached) : {},
        url: () => {
          if (!urls.has(key)) {
            const pending = readUrl(slot, chosen);
            pending.catch(() => urls.delete(key));
            /* Прочитанная простая модель игры — редактору взаймы: он откроет её же и не станет читать заново. */
            if (!attachKey && !chosen.model.url && chosen.model.source === "game")
              pending.then(
                (url) => {
                  if (urls.get(key) !== pending) return;
                  lendModel(chosen.model.id, url);
                  lentIds.add(chosen.model.id);
                },
                () => {},
              );
            urls.set(key, pending);
          }
          return urls.get(key);
        },
        paint: (bases) => paintOf(slot, project, stamp, bases),
      };
    },
    /** Кадр покраски, снятый со студии при уходе из ствола. */
    hand(slot, stamp, paint) {
      handed.set(slot, { stamp, paint });
    },
    forget(slot) {
      handed.delete(slot);
    },
    dispose() {
      recallModels(lentIds);
      lentIds.clear();
      for (const pending of urls.values())
        pending.then(
          (url) => {
            if (String(url).startsWith("blob:")) URL.revokeObjectURL(url);
          },
          () => {},
        );
      urls.clear();
      handed.clear();
      patterns?.dispose?.();
    },
  };
}
