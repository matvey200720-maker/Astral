import { useMemo, useReducer, useState } from "react";
import { eventPinKey } from "@modovik/sound-studio";
import { sanitizeDesktopErrorMessage } from "../../../../../api.js";
import { levels, loudnessMatchGain } from "../sound-model.js";
import { targetMaxSeconds, targetAssignment, renderOptionsFor } from "../sound-targets.js";
import { targetNeed } from "../sound-fit.js";
import { soundTitle } from "../sound-copy.js";
import { tr } from "../../../../../locales/ui.js";
import {
  feedbackKeyOf,
  firstStreamOf,
  patchGlue,
  rewriteForTarget,
  stateKeyOf,
  without,
  withoutTargets,
} from "./studio-model.js";

const channelsFor = (target) => (target.kind === "bank" ? 2 : 1);
const renderRateOf = (target) => target.sampleRate || 44100;

// Сколько звука ждёт цель: петля берётся из прочитанного оригинала.
export function needOf(target, audio) {
  const known = target.kind === "bank" ? null : audio.loopOf(firstStreamOf(target), target.bank);
  return targetNeed(target, { loopPoint: known ?? null, limit: targetMaxSeconds(target) });
}

// Отклики по целям: запись { тон, текст } под ключом «банк|цель».
const feedbackStep = (all, [verb, ...args]) => {
  if (verb === "set") return { ...all, [args[0]]: args[1] };
  if (verb === "drop") return args[0].reduce((rest, key) => without(rest, key), all);
  const [key] = args;
  return all[key] && all[key].tone === "error" ? without(all, key) : all;
};

// Правки назначений выбранной цели. Читает свежее состояние студии из live.
class TargetDesk {
  constructor(live, wires) {
    this.live = live;
    this.wires = wires;
  }

  flag = (key, entry) => this.wires.feedback(["set", key, entry]);
  unflag = (keys) => this.wires.feedback(["drop", keys]);
  unflagRed = (key) => this.wires.feedback(["red", key]);
  forgetPlan = (bank) => this.wires.setPlans((all) => without(all, stateKeyOf(bank)));

  commitList = (next, label) => {
    const { state } = this.live.current;
    if (next !== state.assignments) {
      this.wires.commit({ assignments: next, events: state.events }, label);
    }
  };

  patchTarget = (target, patch) => {
    const next = rewriteForTarget(this.live.current.state.assignments, target, patch, false);
    this.commitList(next, patchGlue(target, patch));
    this.unflagRed(feedbackKeyOf(target));
    this.forgetPlan(target.bank);
  };

  resetTargets = (list) => {
    if (!list || !list.length) return;
    const { halt, setNotice } = this.wires;
    halt();
    list.forEach(({ bank }) => this.forgetPlan(bank));
    this.commitList(withoutTargets(this.live.current.state.assignments, list));
    this.unflag(list.map(feedbackKeyOf));
    setNotice(
      list.length === 1
        ? tr("Оригинал «{title}» вернулся").replace("{title}", soundTitle(list[0].title))
        : tr("Оригиналы ствола вернулись"),
    );
  };

  resetStream = (hash) => {
    const target = this.live.current.streamTargetOf(hash);
    if (target) this.resetTargets([target]);
  };

  playMine = async (target, assignmentOf) => {
    const mine = targetAssignment(target, assignmentOf);
    if (!mine) return;
    const key = feedbackKeyOf(target);
    const options = renderOptionsFor(target, channelsFor(target));
    try {
      const { audio } = this.live.current;
      await audio.playRender(`mine|${target.key}`, mine, renderRateOf(target), options);
      this.unflagRed(key);
    } catch (failure) {
      const text = sanitizeDesktopErrorMessage(failure) || tr("Не удалось собрать звук.");
      this.flag(key, { tone: "error", text });
    }
  };

  matchLoudness = async (target, assignmentOf) => {
    const mine = targetAssignment(target, assignmentOf);
    if (!mine) return;
    const { audio } = this.live.current;
    const key = feedbackKeyOf(target);
    this.wires.setMatching(target.key);
    try {
      const options = renderOptionsFor(target, channelsFor(target));
      const original = audio.loadOriginal(firstStreamOf(target), target.bank);
      const rendered = audio.renderFor({ ...mine, gain: 100 }, renderRateOf(target), options);
      const [heard, built] = await Promise.all([original, rendered]);
      if (!heard) return;
      const gain = loudnessMatchGain(levels(heard.getChannelData(0)), levels(built.samples));
      this.patchTarget(target, { gain });
      const phrase = tr("Громкость подогнана под оригинал: {gain} %");
      this.wires.setNotice(phrase.replace("{gain}", gain));
    } catch (failure) {
      const text = sanitizeDesktopErrorMessage(failure) || tr("Не удалось сравнить громкость.");
      this.flag(key, { tone: "error", text });
    } finally {
      this.wires.setMatching(null);
    }
  };

  // Отметка дорожки за событие: тот же адрес второй раз — снимает.
  pinEvent = (eventId, hash) => {
    const { openBank, state } = this.live.current;
    const address = eventPinKey(openBank.archive, openBank.bank, hash);
    const events = { ...state.events };
    if (events[eventId] === address) delete events[eventId];
    else events[eventId] = address;
    this.wires.commit({ assignments: state.assignments, events });
  };
}

export function useTargetActions({ live, history, halt, setNotice, setPlans, assignmentOf }) {
  const [feedback, feedbackTo] = useReducer(feedbackStep, {});
  const [matching, setMatching] = useState("");
  // wires переписывается каждой отрисовкой: правки всегда идут свежими функциями
  const wires = useState(() => ({}))[0];
  const { commit } = history;
  Object.assign(wires, { feedback: feedbackTo, setPlans, commit, halt, setNotice, setMatching });
  const desk = useState(() => new TargetDesk(live, wires))[0];

  // Эти два зависят от индекса назначений и меняются вместе с ним.
  const byIndex = useMemo(
    () => ({
      playMine: (target) => desk.playMine(target, assignmentOf),
      matchLoudness: (target) => desk.matchLoudness(target, assignmentOf),
    }),
    [desk, assignmentOf],
  );

  return {
    feedback,
    matching,
    flag: desk.flag,
    unflag: desk.unflag,
    unflagRed: desk.unflagRed,
    forgetPlan: desk.forgetPlan,
    commitList: desk.commitList,
    patchTarget: desk.patchTarget,
    resetTargets: desk.resetTargets,
    resetStream: desk.resetStream,
    pinEvent: desk.pinEvent,
    ...byIndex,
  };
}
