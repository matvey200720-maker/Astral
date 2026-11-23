/*
 * Редактор «Флаги» — флаги на флагштоках всей карты (задача 7 ТЗ 10.10.2026,
 * вечер): свой флаг вместо флага игры — страна из шаблонов или своя
 * картинка, — а ткань и ветер штатные: флаг в игре развевается, как прежде.
 *
 * Над кадром — какой флаг игры в работе: «Все флаги» или вид (США,
 * Сан-Андреас, Лос-Сантос, службы, страны), стрелками и меню. Инструменты
 * слева (мастерская «как в Photoshop»): «Флаг» — своя картинка первым делом
 * (слово владельца 30.10.2026, `design-qa.md`, п. 10–12: положил — и вид
 * свой), подгонка под полотнище и флаги игры строками; «Шаблоны стран» — 25
 * флагов, нарисованных кодом; «Ткань» — насыщенность и складки. Кадр —
 * полотнище на древке с волной.
 *
 * Общее с остальными местами (работа, черновик, «Мои работы»,
 * «Применить») — `useRecolorEditor`. Все флаги «Как в игре» — ставить
 * нечего: «Применить» снимает установку.
 */

import { useCallback, useDeferredValue, useMemo } from "react";
import { CaretLeft, CaretRight, Flag, Swatches } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import {
  applyFlagCountry,
  applyFlagsStandard,
  changedFlagCount,
  changedFlagKinds,
  clearFlagLook,
  flagLookOf,
  normalizeFlagLook,
  updateFlagLook,
} from "@modovik/climb-contract/recolor/flags";
import Button from "../../../components/ui/Button.jsx";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import MenuButton from "../../../components/ui/MenuButton.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import FlagsInspector from "./FlagsInspector.jsx";
import FlagsStage from "./FlagsStage.jsx";
import { flagsImages } from "./flags-images.js";
import { ALL_FLAGS, FLAG_TARGETS, flagsText, kindsText, siblingTarget, targetLabel, targetMenuOptions } from "./flags-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Кадр плоский — горячие клавиши буквами. Подпись под именем панели — короткое имя того, что в ней (п. 9): у «Флага» — сама цель. */
const TOOLS = Object.freeze([
  {
    id: "flag",
    label: "Флаг",
    icon: <Flag />,
    shortcut: "F",
    group: "target",
    note: "Все флаги",
    hint: "Своя картинка на флаг над кадром; «Все флаги» — все флаги карты разом, вид флага — только он",
  },
  {
    id: "countries",
    label: "Шаблоны стран",
    icon: <Swatches />,
    shortcut: "T",
    group: "paint",
    hint: "Флаг страны ляжет на флаг над кадром — «Все флаги» или один вид",
  },
  /* Вкладки «Ткань» нет (критик 30.10.2026): насыщенность — того же рода, что яркость картинки (п. 11), складки — у «Флага». */
]);
const TOOL_IDS = TOOLS.map((tool) => tool.id);

function doneText(result) {
  if (result?.status === "unchanged") return tr("Флаги в игре уже такие — ставить было нечего");
  const count = result?.flags || 0;
  return count ? `Флаги установлены: ${flagsText(count)} на карте. Перезапустите игру.` : tr("Флаги установлены. Перезапустите игру.");
}

export default function FlagsStudio({ onExit, onNotice }) {
  useTr();
  const [savedTool, setTool] = useRememberedState("flags:tool", "flag");
  const [savedTarget, setTarget] = useRememberedState("flags:target", ALL_FLAGS);
  /* «Своя картинка», «Цвет и яркость» и «Ткань» были своими инструментами до 30.10.2026: теперь всё — в «Флаге». */
  const tool = savedTool === "image" ? "flag" : TOOL_IDS.includes(savedTool) ? savedTool : "flag";
  const target = FLAG_TARGETS.includes(savedTarget) ? savedTarget : ALL_FLAGS;

  const editor = useRecolorEditor({
    set: "flags",
    contract: RECOLOR_PROJECTS.flags,
    storageKey: "astral.flags.project.v1",
    title: tr("Флаги"),
    coverSlotId: "flags",
    onNotice,
    resetNotice: tr("Все флаги как в игре"),
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
    removalTitle: tr("Снять флаги Astral — в игре флаги станут как были"),
    savedText: tr("Ставим флаги в игру"),
    doneText,
    rolledBackText: tr("Флаги сняты из игры — остальные моды на месте"),
    images: flagsImages,
  });
  const { project, commit, replace } = editor;

  /* Правка облика цели над кадром: «Все флаги» или вид (свой флаг поверх общего). */
  const onLook = useCallback((patch, label) => commit((current) => updateFlagLook(current, target, patch), label), [commit, target]);
  const onCountry = useCallback(
    (country) => commit((current) => applyFlagCountry(current, target, country.id), `${targetLabel(target)}: ${country.label}`),
    [commit, target],
  );
  const onStock = useCallback(() => commit((current) => updateFlagLook(current, target, { mode: "standard" }), `${targetLabel(target)}: как в игре`), [commit, target]);
  const onOwn = useCallback(
    (id, on) =>
      commit(
        (current) => (on ? updateFlagLook(current, id, normalizeFlagLook(flagLookOf(current, id))) : clearFlagLook(current, id)),
        `${targetLabel(id)}: ${on ? tr("свой флаг") : tr("как у всех")}`,
      ),
    [commit],
  );
  const onClearOwn = useCallback(() => commit((current) => ({ ...current, kinds: {} }), "Все флаги — как у всех"), [commit]);
  const onStandard = useCallback(() => replace((current) => applyFlagsStandard(current), "Все флаги как в игре"), [replace]);

  const look = target === ALL_FLAGS ? project.all : flagLookOf(project, target);
  const options = useMemo(() => targetMenuOptions(project), [project]);
  /* Флаг над кадром: стрелки и меню — строкой кнопок мест (`recolor-actions`). */
  const tabs = (
    <div className="recolor-actions" role="group" aria-label={tr("Какой флаг в кадре")}>
      <Button size="sm" variant="ghost" icon={<CaretLeft />} aria-label={tr("Предыдущий флаг")} title={tr("Предыдущий флаг")} onClick={() => setTarget(siblingTarget(target, -1))} />
      <MenuButton label={targetLabel(target)} ariaLabel={tr("Какой флаг в кадре")} options={options} value={target} onSelect={setTarget} />
      <Button size="sm" variant="ghost" icon={<CaretRight />} aria-label={tr("Следующий флаг")} title={tr("Следующий флаг")} onClick={() => setTarget(siblingTarget(target, 1))} />
    </div>
  );

  const tools = useMemo(() => TOOLS.map((item) => (item.id === "flag" ? { ...item, note: targetLabel(target) } : item)), [target]);
  const changed = changedFlagKinds(project).length;
  const status = `${project.name || tr("Флаги")} · ${changed ? `в игру — ${flagsText(changedFlagCount(project))} (${kindsText(changed)})` : tr("как в игре")}`;
  const deferred = useDeferredValue(look);

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor flags-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская флагов")}
      status={status}
      tabs={tabs}
      tools={tools}
      tool={tool}
      onTool={setTool}
      guideKey="flags"
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <FlagsInspector
          tool={tool}
          project={project}
          target={target}
          onTarget={setTarget}
          onOwn={onOwn}
          onClearOwn={onClearOwn}
          onLook={onLook}
          onCountry={onCountry}
          onStock={onStock}
          onStandard={onStandard}
          onTool={setTool}
          onNotice={onNotice}
        />
      }
    >
      <FlagsStage target={target} look={deferred} />
      {editor.works.dialogs}
    </EditorShell>
  );
}
