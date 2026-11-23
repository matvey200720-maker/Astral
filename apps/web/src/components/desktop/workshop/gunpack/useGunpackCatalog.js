import { focusInboxBatch } from "../../../../features/publishing/inbox-focus.js";
import { tr } from "../../../../locales/ui.js";
import { shotKey, coverKey } from "./useGunpackStudio.js";
import { cardKey } from "@modovik/gunpack/ids";
import { sendPackToInbox } from "./gunpack-bridge.js";
import { composeCollage, CATALOG_BACKGROUND } from "./collage.js";
import { useState, useEffect, useCallback } from "react";

export function useGunpackCatalog({ pack, variant, shots, saveShot, composeCover, onNavigate }) {
  const [state, setState] = useShipment(pack?.id, variant?.key);
  const { total, frames, covered } = surveyVariant(variant, shots);

  // Каждый рендер даёт свою send: она держит значения того рендера, где создана.
  async function send() {
    if (!pack || !variant) return;
    const words = {
      cards: tr("Собираю карточки стволов…"),
      cover: tr("Собираю обложку пака…"),
      inbox: tr("Кладу во входящие…"),
      fallback: tr("Не получилось."),
    };
    const plan = [{ banner: words.cards, work: () => renderCards({ frames, variant, saveShot }) }];
    if (!covered && frames.length > 0) {
      plan.push({ banner: words.cover, work: () => composeCover() });
    }
    plan.push({ banner: words.inbox, work: () => sendPackToInbox(pack.id, variant.key) });

    try {
      let reply;
      for (const { banner, work } of plan) {
        setState(stage.working(banner));
        reply = await work();
      }
      setState(stage.sent(reply));
    } catch (error) {
      setState(stage.failed(explainFailure(error, words.fallback)));
    }
  }

  const open = useCallback(() => {
    if (state.status !== "sent") return;
    focusInboxBatch(state.batchId);
    if (onNavigate) onNavigate(PUBLISHER_SCREEN);
  }, [state, onNavigate]);

  return {
    state,
    weapons: total,
    shot: frames.length,
    cover: covered,
    cardBackground: CATALOG_BACKGROUND,
    send,
    open,
    canOpen: Boolean(onNavigate),
  };
}

// Этап отправки сбрасывается следующим рендером после смены пака или варианта.
function useShipment(packId, variantKey) {
  const [state, setState] = useState(stage.idle);
  useEffect(() => {
    setState(stage.idle());
  }, [packId, variantKey]);
  return [state, setState];
}

// Стволы «parts» карточек не имеют; «снятый» ствол — тот, у которого в shots есть запись.
function surveyVariant(variant, shots) {
  const stems = (variant?.weapons || []).filter((weapon) => weapon.kind !== "parts");
  const frames = [];
  for (const { model } of stems) {
    const record = shots[shotKey(variant, model)];
    if (record) frames.push({ model, record });
  }
  const covered = variant ? Boolean(shots[coverKey(variant)]) : false;
  return { total: stems.length, frames, covered };
}

// Карточки делаются строго по очереди: композиция, затем сохранение.
async function renderCards({ frames, variant, saveShot }) {
  for (const { model, record } of frames) {
    const picture = await composeCollage([record], { backgroundId: CATALOG_BACKGROUND });
    await saveShot(cardKey(variant, model), picture);
  }
}

function explainFailure(error, fallback) {
  const headline = error?.message || (error ? String(error) : fallback);
  return stripElectronLead(String(headline));
}

// Срезает одну служебную приставку Electron и «Error: » за ней, только в начале.
function stripElectronLead(text) {
  if (!text.startsWith(ELECTRON_LEAD)) return text;
  const nameEnd = text.indexOf("'", ELECTRON_LEAD.length);
  if (nameEnd <= ELECTRON_LEAD.length) return text;
  const afterName = text.slice(nameEnd + 1);
  if (!afterName.startsWith(": ")) return text;
  const rest = afterName.slice(2);
  return rest.startsWith(WRAPPED_ERROR) ? rest.slice(WRAPPED_ERROR.length) : rest;
}

const PUBLISHER_SCREEN = "publisher";
const ELECTRON_LEAD = "Error invoking remote method '";
const WRAPPED_ERROR = "Error: ";

const stage = {
  idle: () => ({ status: "idle" }),
  working: (step) => ({ status: "working", step }),
  sent: (reply) => Object.assign({ status: "sent" }, reply),
  failed: (message) => ({ status: "failed", message }),
};
