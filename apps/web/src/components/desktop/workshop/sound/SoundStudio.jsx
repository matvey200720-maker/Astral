import { createElement, useState, useCallback, useEffect, useRef, useMemo } from "react";
import EditorActions from "../../../ui/EditorActions.jsx";
import EditorShell from "../../../ui/EditorShell.jsx";
import PageTabs from "../../../ui/PageTabs.jsx";
import { Playlist, UploadSimple, GameController, Package } from "../../../ui/icons.jsx";
import useHistoryKeys from "../../../../hooks/useHistoryKeys.js";
import { useRememberedState } from "../../../../section-memory.js";
import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";
import { SOUND_SECTIONS, sectionEvents } from "@modovik/sound-studio";
import { SOUND_FILE_ACCEPT } from "./sound-drop.js";
import { useSoundAudio } from "./useSoundAudio.js";
import { useSoundApplyQueue } from "./sound-apply.js";
import { adoptSoundAssignments } from "./sound-model.js";
import { targetAssignment, renderOptionsFor } from "./sound-targets.js";
import {
  actionBarProps,
  applyButtonOf,
  bankKeyOf,
  betaBadge,
  feedbackKeyOf,
  fitDialog,
  frameKids,
  hasSimplePath,
  inspectorFor,
  knownSection,
  needOf,
  sectionOf,
  shelfTitle,
  simpleSections,
  stateKeyOf,
  tabOptionsFor,
  useBankFeed,
  useBankProfiles,
  useByLanguage,
  useFileIntake,
  useInstallFlow,
  useNavigation,
  usePicks,
  useStudioDerived,
  useStudioView,
  useTargetActions,
} from "./sound-studio/index.js";

const h = createElement;

// Инструмент панели справа; подписи — русские ключи, переводятся при сборке.
const tool = (id, Icon, shortcut, group, label, note, hint) => ({
  id,
  Icon,
  shortcut,
  group,
  texts: [label, note, hint],
});

const TOOL_TABLE = [
  tool("banks", Playlist, "1", "pick", "Звуки игры", "Что заменить — из вашей GTA V",
    "Выберите ствол, музыку или песню — его звуки встанут в кадр"),
  tool("edit", UploadSimple, "2", "pick", "Свой звук",
    "Файл, громкость, обрезка и сравнение с оригиналом",
    "Перетащите файл на карточку в кадре — правка выбранного встанет сюда"),
  tool("game", GameController, "3", "game", "В игре", "Что уехало в игру и что там стоит",
    "Здесь итог «Применить» и всё, что студия поставила, — со снятием"),
  tool("packs", Package, "4", "game", "Готовые наборы",
    "Чужой набор звуков из архива или папки — целиком",
    "Покажите архив или папку с файлами .awc — Astral сам разложит их по местам"),
];

const toolsInLanguage = () =>
  TOOL_TABLE.map((one) => {
    const [label, note, hint] = one.texts.map((text) => tr(text));
    return {
      id: one.id,
      label,
      icon: h(one.Icon),
      shortcut: one.shortcut,
      group: one.group,
      note,
      hint,
    };
  });

const guideInLanguage = () => [
  { keys: tr("Файл"), text: tr("на карточку — свой звук") },
  { keys: ["Ctrl", "Z"], text: tr("отменить") },
];

// Берёт из объекта перечисленные поля под теми же именами.
const pull = (from, ...names) => Object.fromEntries(names.map((name) => [name, from[name]]));

// Отклики открытого банка: «банк|цель» -> цель.
const feedbackOfBank = (all, bankKey) => {
  const prefix = `${bankKey}|`;
  return Object.fromEntries(
    Object.entries(all)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, entry]) => [key.slice(prefix.length), entry]),
  );
};

// Назначение с адресом банка: архив и банк заполнены.
const isAddressed = (item) => Boolean(item && item.archive && item.bank);

export default function SoundStudio({ onExit, initialSection = "" }) {
  useTr();
  const lang = useUiLanguage();
  const [notice, setNotice] = useState("");
  const announce = useCallback((text) => setNotice(text), []);
  const { view, setView, history, advanced, setAdvanced, project } = useStudioView();
  const [currentTool, setTool] = useRememberedState("sound-studio:tool", "banks");
  const { picked, pick, set } = usePicks();
  const [plans, setPlans] = useState({});

  const section = sectionOf(view.section);
  const full = advanced || !hasSimplePath(section.id);

  useEffect(() => {
    if (!knownSection(initialSection)) return;
    setView((was) =>
      was.section === initialSection ? was : { ...was, section: initialSection, bank: "" },
    );
  }, [initialSection, setView]);

  const feed = useBankFeed({
    sectionId: section.id,
    station: view.station,
    setNotice: announce,
    setView,
  });
  const derived = useStudioDerived(feed, picked, {
    section,
    full,
    view,
    assignments: history.state.assignments,
  });
  const { openBank, wholeBank, selectedTarget, assignmentOf } = derived;
  const queue = useSoundApplyQueue(derived.pending);

  const audio = useSoundAudio({ bank: openBank, onNotice: announce });

  // Самые свежие значения для устойчивых обработчиков.
  const live = useRef(null);
  live.current = {
    state: history.state,
    sectionId: section.id,
    projectBank: view.bank,
    reference: picked.reference,
    audio,
    ...pull(
      derived,
      "openBank",
      "wholeBank",
      "info",
      "layerTargets",
      "selectedTarget",
      "assignmentOf",
      "streamTargetOf",
      "shelfBanks",
      "shelfTargets",
    ),
  };

  const actions = useTargetActions({
    live,
    history,
    halt: audio.halt,
    setNotice: announce,
    setPlans,
    assignmentOf,
  });
  const nav = useNavigation({
    pick,
    halt: audio.halt,
    setView,
    setTool,
    setAdvanced,
    readPending: feed.readPending,
    live,
  });

  const frameRef = useRef(null);
  const files = useFileIntake({
    live,
    history,
    frameRef,
    setTool,
    setNotice: announce,
    set,
    actions,
    nav,
    assignmentOf,
    fallbackKey: derived.fallbackKey,
  });
  useHistoryKeys(history);
  const install = useInstallFlow(queue, derived.pending, audio.renderFor, {
    setNotice: announce,
    setPlans,
    setView,
    reloadWorks: feed.reloadWorks,
  });

  const trackListShown = derived.layerTargets.length === 0 || (full && picked.trackList);
  const { profiles, retry: retryProfile } = useBankProfiles({
    wanted: full && trackListShown && !!openBank && !wholeBank && !openBank.pending,
    bank: openBank,
  });

  /* ----- побочные действия ----- */
  const { amend } = history;
  useEffect(() => {
    const { state, projectBank } = live.current;
    if (!feed.banks.length || state.assignments.every(isAddressed)) return;
    const probe = { bank: projectBank, assignments: state.assignments };
    const adopted = adoptSoundAssignments(probe, feed.banks);
    if (adopted !== probe) amend({ ...state, assignments: adopted.assignments });
  }, [feed.banks, amend]);

  const { loadOriginal, forgetOriginals, playOriginal } = audio;
  useEffect(() => {
    const found = openBank && derived.bankStreams.find((one) => one.hash === picked.stream);
    if (picked.stream && found) loadOriginal(found);
  }, [picked.stream, openBank, derived.bankStreams, loadOriginal]);

  useEffect(() => {
    if (derived.replacedCount === 0 && picked.onlyReplaced) set.onlyReplaced(false);
  }, [derived.replacedCount, picked.onlyReplaced, set]);

  /* ----- сборка кадра ----- */
  const { reload } = feed;
  const rereads = useMemo(
    () => ({
      refreshBanks: () => reload({ refresh: true, announce: true, onFresh: forgetOriginals }),
      packsChanged: () => {
        forgetOriginals();
        reload({ refresh: true });
      },
    }),
    [reload, forgetOriginals],
  );
  const { importToTarget } = files;
  const replaceWithReference = useCallback(
    (target) => {
      const { reference } = live.current;
      if (reference && reference.file) importToTarget(target, [reference.file]);
    },
    [importToTarget],
  );
  const playOriginalOf = useCallback(
    (target) => playOriginal(target.streams[0]),
    [playOriginal],
  );
  const simpleTabs = useByLanguage(lang, () =>
    tabOptionsFor(simpleSections()),
  );
  const allTabs = useByLanguage(lang, () => tabOptionsFor(SOUND_SECTIONS));
  const tools = useByLanguage(lang, toolsInLanguage);
  const more = useByLanguage(lang, () => [
    { value: "pack", label: tr("Готовые наборы звуков…"), icon: h(Package) },
  ]);
  const guide = useByLanguage(lang, guideInLanguage);
  const events = useMemo(() => sectionEvents(section.id), [section.id]);

  const openKey = openBank ? bankKeyOf(openBank) : "";
  const stateKey = openBank ? stateKeyOf(openBank) : "";
  const profile = openBank ? profiles[openKey] : undefined;
  const feedKey = selectedTarget ? feedbackKeyOf(selectedTarget) : "";
  const selectedAssignment = selectedTarget
    ? targetAssignment(selectedTarget, assignmentOf)
    : null;
  const openFeedback = useMemo(
    () => feedbackOfBank(actions.feedback, openKey),
    [actions.feedback, openKey],
  );
  const touched = new Set(feed.works.map((one) => one.archive));
  const channelsOfTarget = selectedTarget && selectedTarget.kind === "bank" ? 2 : 1;

  const env = {
    section,
    full,
    notice,
    project,
    history,
    announce,
    audio,
    station: view.station,
    playing: audio.playing,
    ...pull(feed, "readState", "problems", "works", "gameRoot"),
    ...pull(files, "drop", "fit", "fitBuffers", "openFit", "closeFit", "applyFit"),
    ...pull(files, "pickForTarget", "pickForStream", "pickForReference"),
    ...pull(install, "queue", "caption", "press", "removeWork"),
    ...pull(actions, "playMine", "matchLoudness", "resetTargets", "resetStream", "pinEvent"),
    ...pull(nav, "selectStream", "selectLayer", "openBankDirect", "selectBank", "chooseStation"),
    ...pull(nav, "setAdvancedChoice", "clearReference", "similarTo"),
    ...pull(derived, "bankSection", "openBank", "wholeBank", "info", "shelfBanks", "layerTargets"),
    ...pull(derived, "assignmentOf", "openAssignments", "selectedTarget", "groups", "labels"),
    ...pull(derived, "shelfTargets", "replacedCount", "pending", "describeStream"),
    ...rereads,
    playOriginalOf,
    more,
    openKey,
    selectedAssignment,
    events,
    profile,
    retryProfile,
    takeTool: setTool,
    matching: actions.matching,
    tracksCount: derived.bankStreams.length,
    bankState: openBank ? derived.bankStates.get(stateKey) || null : null,
    selectedStream: picked.stream,
    feedbackKey: feedKey,
    openFeedback,
    targetFeedback: feedKey ? actions.feedback[feedKey] : undefined,
    removing: install.busy === "remove",
    anyBusy: install.busy !== "",
    need: selectedTarget ? needOf(selectedTarget, audio) : null,
    renderOptions: selectedTarget
      ? renderOptionsFor(selectedTarget, channelsOfTarget)
      : null,
    trackListOpen: picked.trackList,
    trackListShown,
    toggleTrackList: () => set.trackList((opened) => !opened),
    profileTracks: profile && profile.tracks ? profile.tracks : null,
    reference: picked.reference,
    sortMode: picked.sort,
    setSortMode: set.sort,
    showTech: picked.tech,
    setShowTech: set.tech,
    setBankQuery: set.query,
    setOnlyReplaced: set.onlyReplaced,
    onlyReplaced: picked.onlyReplaced,
    bankQuery: picked.query,
    replaceWithReference,
    retryOriginal: (target) => {
      forgetOriginals();
      loadOriginal(target.streams[0]);
    },
    patchSelected: (patch) => selectedTarget && actions.patchTarget(selectedTarget, patch),
    pendingCount: derived.pending.length,
    plan: openBank ? plans[stateKey] || null : null,
    staleShown: feed.stale && feed.worksKnown && !feed.banks.some((b) => touched.has(b.archive)),
    railTitle: shelfTitle(section, view.station),
  };

  const frame = h(
    "section",
    {
      ref: frameRef,
      className: files.drop.armed && derived.fallbackKey ? "snd-streams is-armed" : "snd-streams",
      "aria-label": derived.bankSection ? tr("Банк") : tr("Звуки"),
    },
    ...frameKids(env),
  );
  const chooser = h("input", {
    ref: files.fileInput,
    type: "file",
    accept: SOUND_FILE_ACCEPT,
    hidden: true,
    onChange: files.onFileChosen,
  });

  // Свойства оболочки идут тремя частями, чтобы guideKey остался записью в разметке.
  const upper = {
    className: "snd-shell",
    title: tr("Мастерская звука"),
    status: notice,
    backLabel: tr("Назад в каталог"),
    onBack: onExit,
    tabs: h(PageTabs, {
      role: "tablist",
      label: tr("Раздел звука"),
      value: section.id,
      onChange: nav.switchSection,
      options: full ? allTabs : simpleTabs,
    }),
    tools,
    tool: currentTool,
    onTool: setTool,
    guide,
  };
  const lower = {
    inspector: inspectorFor(currentTool, env),
    actions: (
      <EditorActions {...actionBarProps(env)} apply={applyButtonOf(env)}>
        {betaBadge(env)}
      </EditorActions>
    ),
  };

  return (
    <EditorShell
      {...upper}
      guideKey="sound-studio"
      {...lower}
    >
      {frame}
      {chooser}
      {fitDialog(env)}
    </EditorShell>
  );
}
