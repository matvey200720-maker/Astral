import { createElement as h, Fragment } from "react";
import { SpeakerHigh } from "../../../../ui/icons.jsx";
import Button from "../../../../ui/Button.jsx";
import BankCard from "../BankCard.jsx";
import ReplacementEditor from "../ReplacementEditor.jsx";
import SoundFitDialog from "../SoundFitDialog.jsx";
import SoundInspector from "../SoundInspector.jsx";
import SoundPackPanel from "../SoundPackPanel.jsx";
import SoundRail from "../SoundRail.jsx";
import SoundTrackBrowser from "../SoundTrackBrowser.jsx";
import TrackCard from "../TrackCard.jsx";
import WeaponBankPanel from "../WeaponBankPanel.jsx";
import { tr } from "../../../../../locales/ui.js";
import { chooseHint, emptyEditHint, pickLabelFor } from "./studio-model.js";
import { fitPatchOf, fitValueOf } from "./use-file-intake.js";

const hint = (text) => h("small", { className: "snd-hint" }, text);

function guideBlock(text) {
  return h("div", { className: "snd-guide" }, h(SpeakerHigh), h("p", null, text));
}

function blockedNotice() {
  return h(
    "div",
    { className: "snd-blocked" },
    h(SpeakerHigh),
    h("h3", null, tr("Банки читаются из вашей игры")),
    h(
      "p",
      null,
      tr(
        "Прослушивание и установка звуков работают в приложении Astral — браузеру файлы GTA V недоступны.",
      ),
    ),
  );
}

/* ---------- кадр ---------- */

function weaponPanel(e) {
  const shown = e.tracksCount;
  return h(WeaponBankPanel, {
    title: tr(e.info.title || e.info.codename),
    detail: `${e.info.codename} · ${tr("{count} в банке").replace("{count}", shown)}`,
    state: e.bankState,
    targets: e.layerTargets,
    assignmentOf: e.assignmentOf,
    selectedKey: e.selectedTarget ? e.selectedTarget.key : "",
    playing: e.playing,
    armed: e.drop.armed,
    dropKey: e.drop.dropKey,
    feedback: e.openFeedback,
    busy: e.removing,
    onSelect: e.selectLayer,
    onPlayOriginal: e.playOriginalOf,
    onPlayMine: e.playMine,
    onPick: e.pickForTarget,
    onReset: e.resetTargets,
    onRemoveFromGame: e.removeWork,
  });
}

function allTracksButton(e) {
  const opened = e.trackListOpen;
  return h(
    Button,
    {
      className: "snd-all-tracks",
      variant: "link",
      size: "sm",
      "aria-expanded": opened,
      onClick: e.toggleTrackList,
    },
    opened
      ? tr("Свернуть все дорожки банка")
      : tr("Все дорожки банка ({count})").replace("{count}", e.tracksCount),
  );
}

function bankCard(e) {
  const first = e.selectedTarget ? e.selectedTarget.streams[0] : undefined;
  return h(BankCard, {
    target: e.selectedTarget,
    info: e.info,
    assignment: e.selectedAssignment,
    original: e.audio.originalOf(first),
    originalFailed: e.audio.originalFailed(first),
    state: e.bankState,
    playing: e.playing,
    armed: e.drop.armed,
    dropKey: e.drop.dropKey,
    feedback: e.openFeedback.bank,
    busy: e.anyBusy,
    onPlayOriginal: e.playOriginalOf,
    onPlayMine: e.playMine,
    onPick: e.pickForTarget,
    onReset: e.resetTargets,
    onRetryOriginal: () => e.retryOriginal(e.selectedTarget),
    onRemoveFromGame: e.removeWork,
  });
}

function trackBrowser(e) {
  return h(SoundTrackBrowser, {
    bank: e.openBank,
    bankTitle: tr(e.info.title || e.info.codename),
    banks: e.shelfBanks,
    project: e.project,
    events: e.events,
    showEvents: e.layerTargets.length === 0,
    assignments: e.openAssignments,
    profile: e.profile,
    onRetryProfile: () => e.retryProfile(),
    selectedStream: e.selectedStream,
    onSelectStream: e.selectStream,
    playing: e.playing,
    playOriginal: e.audio.playOriginal,
    onStop: e.audio.halt,
    onPick: e.pickForStream,
    onReset: e.resetStream,
    onOpenBank: e.openBankDirect,
    onPinEvent: e.pinEvent,
    reference: e.reference,
    onClearReference: e.clearReference,
    sortMode: e.sortMode,
    onSortMode: e.setSortMode,
    onPickReference: e.pickForReference,
    showTech: e.showTech,
    onShowTech: e.setShowTech,
    dropKey: e.drop.dropKey,
  });
}

// Пять мест в кадре: условие && элемент даёт false, тернарник — null.
export function frameKids(e) {
  const opened = Boolean(e.openBank);
  const layered = opened && !e.wholeBank && e.layerTargets.length > 0;
  return [
    e.readState === "unavailable" && blockedNotice(),
    layered ? h(Fragment, null, weaponPanel(e), e.full && allTracksButton(e)) : null,
    e.bankSection &&
      !opened &&
      e.readState === "ready" &&
      guideBlock(chooseHint(e.section, e.station)),
    e.bankSection && opened ? bankCard(e) : null,
    opened && !e.wholeBank && e.trackListShown ? trackBrowser(e) : null,
  ];
}

/* ---------- панель справа ---------- */

function editorPanel(e) {
  const target = e.selectedTarget;
  if (!target) return hint(emptyEditHint(e.readState === "unavailable"));
  const first = target.streams[0];
  const asTrack =
    target.kind === "stream"
      ? h(TrackCard, {
          target,
          bankTitle: tr(e.info.title || e.info.codename),
          assignment: e.selectedAssignment,
          features: e.profileTracks ? e.profileTracks[target.id] || null : null,
          original: e.audio.originalOf(first),
          originalFailed: e.audio.originalFailed(first),
          showTech: e.showTech,
          reference: e.reference,
          onRetryOriginal: () => e.retryOriginal(target),
          onSimilar: e.similarTo,
          onReplaceWithReference: e.replaceWithReference,
        })
      : null;
  return h(
    ReplacementEditor,
    {
      key: e.feedbackKey,
      target,
      assignment: e.selectedAssignment,
      loadAsset: e.audio.loadAsset,
      playing: e.playing,
      pickLabel: pickLabelFor(target, e.selectedAssignment, e.layerTargets.length > 0),
      feedback: e.targetFeedback,
      dropTarget: e.drop.dropKey === target.key,
      matching: e.matching === target.key,
      onPatch: (patch) => e.patchSelected(patch),
      onPick: e.pickForTarget,
      onReset: e.resetTargets,
      onPlayOriginal: e.playOriginalOf,
      onPlayMine: e.playMine,
      onMatch: e.matchLoudness,
      need: e.need,
      onFit: e.openFit,
    },
    asTrack,
  );
}

function packsPanel(e) {
  if (e.gameRoot) {
    return h(SoundPackPanel, {
      gameRoot: e.gameRoot,
      onNotice: e.announce,
      onChanged: e.packsChanged,
    });
  }
  return hint(
    e.readState === "unavailable"
      ? tr("Готовые наборы ставятся в игру из приложения Astral — браузеру файлы GTA V недоступны.")
      : tr("Ищем папку вашей GTA V…"),
  );
}

function shelfPanel(e) {
  if (e.readState === "unavailable") {
    return hint(tr("Здесь будет список звуков вашей GTA V — его читает Astral Desktop."));
  }
  return h(SoundRail, {
    railTitle: e.railTitle,
    sectionId: e.section.id,
    station: e.station,
    banks: e.shelfBanks,
    banksState: e.readState,
    groups: e.groups,
    activeKey: e.openKey,
    states: e.labels,
    advanced: e.full,
    onAdvanced: e.setAdvancedChoice,
    bankQuery: e.bankQuery,
    onBankQuery: e.setBankQuery,
    staleShown: e.staleShown,
    problems: e.problems,
    errorText: e.notice,
    onlyReplaced: e.onlyReplaced,
    replacedCount: e.replacedCount,
    onOnlyReplaced: e.setOnlyReplaced,
    onRefresh: e.refreshBanks,
    shelfTargets: e.shelfTargets,
    dropKey: e.drop.dropKey,
    onSelectBank: e.selectBank,
    onChooseStation: e.chooseStation,
  });
}

function gamePanel(e) {
  return h(SoundInspector, {
    plan: e.plan,
    describeStream: e.describeStream,
    pendingCount: e.pendingCount,
    works: e.works,
    busy: e.removing,
    onRemoveWork: (work) => e.removeWork(work),
  });
}

export function inspectorFor(tool, e) {
  if (tool === "edit") return editorPanel(e);
  if (tool === "game") return gamePanel(e);
  if (tool === "packs") return packsPanel(e);
  return shelfPanel(e);
}

/* ---------- органы действий и окно подгонки ---------- */

/* Кнопки шапки без «Применить»: оболочка студии подставляет apply={…} сама, записью в разметке. */
export function actionBarProps(e) {
  return {
    onUndo: e.history.undo,
    canUndo: e.history.canUndo,
    onRedo: e.history.redo,
    canRedo: e.history.canRedo,
    more: e.more,
    onMore: (value) => {
      if (value === "pack") e.takeTool("packs");
    },
  };
}

export function applyButtonOf(e) {
  return {
    label: e.caption.label,
    title: e.queue.hint || e.caption.title,
    busy: e.queue.busy ? tr("Идёт установка…") : "",
    disabled: e.removing || e.pending.length === 0,
    onClick: e.press,
  };
}

export function betaBadge(e) {
  return e.section.readiness === "candidate"
    ? h("span", { className: "snd-beta", title: tr(e.section.notice) }, tr("Бета"))
    : null;
}

export function fitDialog(e) {
  const target = e.selectedTarget;
  const open = e.fit;
  const mine = e.selectedAssignment;
  if (!open || !target || open.key !== e.feedbackKey || !mine) return null;
  const asset = e.fitBuffers.current.get(open.key);
  if (!asset) return null;
  const rate = target.sampleRate || 44100;
  return h(SoundFitDialog, {
    key: `${open.key}|${mine.assetHash}|${open.fresh}`,
    fileName: mine.assetName,
    asset,
    need: e.need,
    value: fitValueOf(mine),
    fresh: open.fresh,
    render: (draft) => e.audio.renderFor({ ...mine, ...fitPatchOf(draft) }, rate, e.renderOptions),
    original: () => e.audio.loadOriginal(target.streams[0], target.bank),
    onApply: (draft) => e.applyFit(target, draft),
    onClose: e.closeFit,
  });
}
