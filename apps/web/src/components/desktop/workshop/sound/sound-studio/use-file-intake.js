import { useMemo, useState } from "react";
import { analyzeSamples, monoSamples, tagsOf } from "@modovik/sound-studio";
import {
  ASSIGNMENT_FX_KNOBS,
  FX_DEFAULTS,
  normalizeAssignmentFx,
} from "@modovik/sound-studio/sound-knobs";
import { sanitizeDesktopErrorMessage } from "../../../../../api.js";
import droppedFiles from "../../dropped-files.js";
import { decodeAudioBytes } from "../WaveformPlayer.jsx";
import { prepareSoundImport, SoundImportError } from "../sound-import.js";
import { useSoundDrop } from "../sound-drop.js";
import { fitVerdict, targetNeed } from "../sound-fit.js";
import { bankTarget, targetMaxSeconds, targetAssignment } from "../sound-targets.js";
import { soundTitle, soundWord } from "../sound-copy.js";
import { tr } from "../../../../../locales/ui.js";
import {
  LOOP_WAIT_MS,
  assignmentsOfBank,
  bankKeyOf,
  delay,
  feedbackKeyOf,
  firstStreamOf,
  hasFile,
  hashesOf,
  rewriteForTarget,
} from "./studio-model.js";
import { needOf } from "./use-target-actions.js";

// Что человек правит в окне подгонки -> правка назначения.
export function fitPatchOf(draft) {
  const raw = Object.fromEntries(ASSIGNMENT_FX_KNOBS.map((name) => [name, draft[name]]));
  return {
    trimStart: draft.trimStart,
    trimEnd: draft.trimEnd,
    fadeIn: draft.fadeIn,
    fadeOut: draft.fadeOut,
    fx: normalizeAssignmentFx(raw),
  };
}

export function fitValueOf(assignment) {
  const own = ["trimStart", "trimEnd", "fadeIn", "fadeOut"];
  const value = { ...FX_DEFAULTS, ...(assignment.fx || {}) };
  own.forEach((name) => {
    value[name] = assignment[name] || 0;
  });
  return value;
}

// Объявление после ввоза: слой, банк или дорожка.
function importedText(target, name) {
  const fill = (phrase, extra = {}) =>
    Object.entries({ name, ...extra }).reduce(
      (text, [field, value]) => text.replace(`{${field}}`, value),
      phrase,
    );
  if (target.kind === "bank") return fill(tr("Файл «{name}» назначен на банк"));
  if (target.kind !== "layer") return fill(tr("Файл «{name}» назначен на дорожку"));
  const count = target.streams.length;
  const title = soundTitle(target.title);
  return count > 1
    ? fill(tr("«{name}» встал на все {variants} слоя «{title}»"), {
        variants: `${count} ${soundWord(count, "variantAll")}`,
        title,
      })
    : fill(tr("«{name}» встал на слой «{title}»"), { title });
}

// Приём файлов: выбор кнопкой, перетаскивание, образец «похожести», окно подгонки.
class IntakeDesk {
  constructor(live, wires) {
    this.live = live;
    this.wires = wires;
    this.fileInput = { current: null };
    this.intent = { mode: "target", key: "" };
    this.fitBuffers = { current: new Map() };
  }

  focusTarget = (target, withEditor) => {
    const { setTool, setSelectedStream, setSelectedLayer } = this.wires;
    if (withEditor) setTool("edit");
    if (target.kind === "layer") {
      setSelectedStream(null);
      setSelectedLayer(target.key);
    } else if (target.kind === "stream") {
      setSelectedStream(target.id);
    }
  };

  targetForKey = (key) => {
    const now = this.live.current;
    const [head, rest] = [key.split(":")[0], key.slice(key.indexOf(":") + 1)];
    if (head === "shelf") return now.shelfTargets.get(rest) || null;
    if (!now.openBank || !key) return null;
    if (key === "bank") {
      if (!now.wholeBank) return null;
      return bankTarget(now.openBank, now.info.title || now.openBank.bank);
    }
    if (head === "layer") return now.layerTargets.find((one) => one.key === key) || null;
    return head === "stream" ? now.streamTargetOf(rest) : null;
  };

  importToTarget = async (target, files, withEditor = true) => {
    const { flag, unflag, setFit, setNotice, commit } = this.wires;
    const key = feedbackKeyOf(target);
    const first = firstStreamOf(target);
    try {
      const have = assignmentsOfBank(this.live.current.state.assignments, target.bank);
      const request = {
        assignedInBank: [...have.values()].filter(hasFile).length,
        fresh: hashesOf(target).filter((hash) => !hasFile(have.get(hash))).length,
        maxSeconds: targetNeed(target, { limit: targetMaxSeconds(target) }).limit,
      };
      const done = await prepareSoundImport(files, target, request);
      const { metadata, buffer, patch, notes } = done;
      const audio = () => this.live.current.audio;
      audio().rememberAsset(metadata.hash, buffer);
      const loopUnknown =
        target.kind !== "bank" && audio().loopOf(first, target.bank) === undefined;
      if (loopUnknown) {
        await Promise.race([audio().loadOriginal(first, target.bank), delay(LOOP_WAIT_MS)]);
      }
      const need = needOf(target, audio());
      const { assignments, events } = this.live.current.state;
      const next = rewriteForTarget(
        assignments,
        target,
        { ...patch, fx: need.loops ? { loop: true } : null },
        true,
      );
      if (next !== assignments) commit({ assignments: next, events });
      this.focusTarget(target, withEditor);
      if (notes.length) flag(key, { tone: "note", text: notes.join(". ") });
      else unflag([key]);
      const verdict = fitVerdict(buffer.duration - (patch.trimStart || 0), need);
      if (verdict === "long" || verdict === "over") {
        this.fitBuffers.current.set(key, buffer);
        setFit({ key, fresh: true });
      }
      setNotice(importedText(target, metadata.name));
    } catch (failure) {
      this.focusTarget(target, withEditor);
      const text =
        failure instanceof SoundImportError
          ? failure.message
          : sanitizeDesktopErrorMessage(failure) || tr("Файл не подошёл.");
      flag(key, { tone: "error", text });
      setNotice(text);
    }
  };

  readReferenceFile = async (file) => {
    const { setReference, setSortMode, setNotice } = this.wires;
    try {
      const buffer = await decodeAudioBytes(await file.arrayBuffer());
      const found = analyzeSamples(monoSamples(buffer), buffer.sampleRate);
      setReference({ title: file.name, features: { ...found, tags: tagsOf(found) }, file });
      setSortMode("similar");
      const phrase = tr(
        "Дорожки выстроены по похожести на «{name}» — выберите подходящую и замените её этим файлом",
      );
      setNotice(phrase.replace("{name}", file.name));
    } catch (failure) {
      setNotice(sanitizeDesktopErrorMessage(failure) || tr("Файл не удалось прочитать."));
    }
  };

  /* ----- выбор файла кнопками ----- */
  openChooser = (mode, key) => {
    this.intent = { mode, key };
    if (this.fileInput.current) this.fileInput.current.click();
  };
  pickForTarget = (target) => {
    this.wires.setTool("edit");
    this.openChooser("target", target.key);
  };
  pickForStream = (hash) => {
    this.wires.setTool("edit");
    this.openChooser("target", `stream:${hash}`);
  };
  pickForReference = () => this.openChooser("reference", "");

  onFileChosen = (event) => {
    const chosen = Array.from(event.target.files || []);
    event.target.value = "";
    const { mode, key } = this.intent;
    this.intent = { mode: "target", key: "" };
    if (!chosen.length) return;
    if (mode === "reference") {
      this.readReferenceFile(chosen[0]);
      return;
    }
    const target = this.targetForKey(key) || this.live.current.selectedTarget;
    if (target) this.importToTarget(target, chosen);
  };

  // Бросок файла: ключ приёмника + dataTransfer. Сбор файлов начинается сразу, пока перенос жив.
  dropped = async (key, transfer) => {
    const target = this.targetForKey(key);
    if (!target) return;
    const received = droppedFiles(transfer);
    const onShelf = key.startsWith("shelf:");
    if (onShelf) {
      const shelfKey = key.slice(6);
      const bank = this.live.current.shelfBanks.find((one) => bankKeyOf(one) === shelfKey);
      if (bank) this.wires.selectBank(bank);
    }
    const { files } = await received;
    await this.importToTarget(target, files, !onShelf);
  };

  /* ----- окно подгонки ----- */
  openFit = async (target, assignmentOf) => {
    const mine = targetAssignment(target, assignmentOf);
    const buffer = mine && (await this.live.current.audio.loadAsset(mine.assetHash));
    if (!buffer) return;
    const key = feedbackKeyOf(target);
    this.fitBuffers.current.set(key, buffer);
    this.wires.setFit({ key, fresh: false });
  };
  closeFit = () => this.wires.setFit(null);
  applyFit = (target, draft) => {
    this.wires.setFit(null);
    this.wires.patchTarget(target, fitPatchOf(draft));
    this.wires.unflag([feedbackKeyOf(target)]);
  };
}

export function useFileIntake({ live, history, frameRef, setTool, setNotice, ...rest }) {
  const { set, actions, nav, assignmentOf, fallbackKey } = rest;
  const [fit, setFit] = useState(null);
  const wires = useState(() => ({}))[0];
  Object.assign(wires, {
    setTool,
    setNotice,
    setFit,
    commit: history.commit,
    setSelectedStream: set.stream,
    setSelectedLayer: set.layer,
    setReference: set.reference,
    setSortMode: set.sort,
    flag: actions.flag,
    unflag: actions.unflag,
    patchTarget: actions.patchTarget,
    selectBank: nav.selectBank,
  });
  const desk = useState(() => new IntakeDesk(live, wires))[0];

  const drop = useSoundDrop(frameRef, { fallbackKey, onDrop: desk.dropped });
  const openFit = useMemo(
    () => (target) => desk.openFit(target, assignmentOf),
    [desk, assignmentOf],
  );

  return {
    fileInput: desk.fileInput,
    drop,
    fit,
    fitBuffers: desk.fitBuffers,
    onFileChosen: desk.onFileChosen,
    pickForTarget: desk.pickForTarget,
    pickForStream: desk.pickForStream,
    pickForReference: desk.pickForReference,
    importToTarget: desk.importToTarget,
    openFit,
    closeFit: desk.closeFit,
    applyFit: desk.applyFit,
  };
}
