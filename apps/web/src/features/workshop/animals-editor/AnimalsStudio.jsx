/*
 * «Животные» (05.11.2026) — настоящие животные игры: кабан, олень, собаки, птицы, рыбы — все `a_c_*` из файлов игры игрока.
 * Слева — инструменты (цвет, свечение, метка), в центре — модель животного ровно из ваших файлов, справа — настройки взятого
 * инструмента и лёгкий список всех животных для переключения.
 *
 *   • «Цвет» — перекраска листов шерсти и перьев с сохранением светотени;
 *   • «Свечение» — тонкая светящаяся оболочка по форме тела;
 *   • «Метка» — над животным, видная издалека, по желанию на «палочке»: готовый значок (силуэт кабана, оленя и т. п.), своя
 *     эмблема (картинка человека) или копия самого животного одним цветом.
 *
 * Всё едет в игру заменой файлов (`x64/astral/astral_animals.rpf`, без скриптов): подходит серверам, где скрипты и ASI
 * запрещены. Размера нет: модель без физики разошлась бы с хитбоксом (подробно — `launcher_app/docs/ANIMALS.md`).
 *
 * Раскладка — мастерская «как в Photoshop»: инструменты слева, настройки и список справа, кадр посередине.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ANIMALS, animalInstallable, animalLookProblems } from "@modovik/climb-contract/animals";
import { ArrowCounterClockwise, MapPin, Palette, Sparkle, Trash } from "../../../components/ui/icons.jsx";
import Button from "../../../components/ui/Button.jsx";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { useSkyHistory } from "../../../components/desktop/workshop/useSkyHistory.js";
import useHistoryKeys from "../../../hooks/useHistoryKeys.js";
import { useRememberedState } from "../../../section-memory.js";
import { animalsSupported, chooseGameInstallation, hasDesktopBridge, sanitizeDesktopErrorMessage } from "../../../api.js";
import { tr, useTr } from "../../../locales/ui.js";
import { humanFailure } from "../../../utils/installFailure.js";
import { useInstallRecord } from "../useInstallRecord.js";
import { REPLACING_INSTALL_STEPS, applyWorkshopWork, useWorkshopApplyButton, workSignature } from "../install-queue/index.js";
import { ANIMALS_INSTALL_KEY, installAnimals } from "../install-queue/tasks/animals.js";
import AnimalList from "./AnimalList.jsx";
import AnimalStage from "./AnimalStage.jsx";
import AnimalsInspector from "./AnimalsInspector.jsx";
import { useAnimalList, useAnimalModel, useGameRoot, useShownAnimals } from "./animals-data.js";
import {
  createAnimalsDraft,
  draftIsEmpty,
  draftSignature,
  installProject,
  lookInDraft,
  restoreAnimalsDraft,
  saveAnimalsDraft,
  withLookChange,
  withoutLook,
} from "./animals-project.js";

const EDITOR = "animals";
const GUIDE = Object.freeze([
  { keys: ["ЛКМ"], text: "вращение" },
  { keys: ["Колесо"], text: "масштаб" },
  { keys: ["2×ЛКМ"], text: "вернуть вид" },
  { keys: ["Ctrl", "Z"], text: "отменить" },
]);

/* Инструменты. Цифры — горячие клавиши, как у остальных редакторов. */
const TOOLS = Object.freeze([
  { id: "colour", label: "Цвет", icon: <Palette />, shortcut: "1", note: "Перекрасить шерсть или перья", hint: "Цвет красит все расцветки животного, светотень остаётся: средний тон листа становится выбранным цветом" },
  { id: "glow", label: "Свечение", icon: <Sparkle />, shortcut: "2", note: "Тонкая светящаяся оболочка по форме тела", hint: "Оболочка на сантиметры больше тела и не меняет его кости и хитбокс" },
  { id: "marker", label: "Метка", icon: <MapPin />, shortcut: "3", note: "Значок над животным, видный издалека", hint: "Значок на высоте до 12 м, по желанию на «палочке»: посмотрел в небо — видишь, где животное" },
]);

/* Сводка словами по частям: каждая переводится отдельно. */
function summaryOf(draft) {
  const project = installProject(draft);
  const ids = Object.keys(project.animals);
  if (!ids.length) return tr("Как в игре");
  const parts = [];
  const count = (key) => ids.filter((id) => project.animals[id][key].on).length;
  if (count("colour")) parts.push(`${tr("цвет")}: ${count("colour")}`);
  if (count("glow")) parts.push(`${tr("свечение")}: ${count("glow")}`);
  if (count("marker")) parts.push(`${tr("метки")}: ${count("marker")}`);
  return `${tr("Животных")}: ${ids.length} · ${parts.join(" · ")}`;
}

function doneText(result) {
  const count = Array.isArray(result?.animals) ? result.animals.filter((row) => !row.skipped).length : 0;
  return tr("Животные установлены: {0}. Перезапустите игру — животные подхватят новый вид.").replace("{0}", String(count));
}

export default function AnimalsStudio({ onExit, onNotice }) {
  useTr();
  const [tool, setTool] = useRememberedState("animals:tool", "colour");
  const [currentId, setCurrentId] = useRememberedState("animals:current", "a_c_boar");
  const [query, setQuery] = useState("");
  const history = useSkyHistory(() => restoreAnimalsDraft());
  const draft = history.state;
  const [gameRoot, setGameRoot] = useGameRoot();
  const list = useAnimalList(gameRoot);
  const shown = useShownAnimals(list);
  const installRecord = useInstallRecord(ANIMALS_INSTALL_KEY);

  /* При входе — сразу какое-то животное: прошлое, а нет его в игре — первое из найденных. */
  const animal = useMemo(() => shown.find((item) => item.id === currentId) || shown[0] || ANIMALS[0], [shown, currentId]);
  const look = useMemo(() => lookInDraft(draft, animal.id), [draft, animal.id]);
  const model = useAnimalModel(gameRoot, list.status === "loading" ? "" : animal.id);
  const installable = animalInstallable(animal);

  const change = useCallback(
    (section, values, label) => history.commit((current) => withLookChange(current, animal.id, section, values), label),
    [history, animal.id],
  );
  const lookOf = useCallback((id) => lookInDraft(draft, id), [draft]);

  /* --- Черновик --- */

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saveDraft = useCallback(() => saveAnimalsDraft(draftRef.current), []);
  useEffect(() => {
    const timer = window.setTimeout(saveDraft, 500);
    return () => window.clearTimeout(timer);
  }, [draft, saveDraft]);
  useEffect(() => {
    window.addEventListener("beforeunload", saveDraft);
    return () => {
      window.removeEventListener("beforeunload", saveDraft);
      saveDraft();
    };
  }, [saveDraft]);
  useHistoryKeys(history);

  /* --- Игра --- */

  const connectGame = useMemo(() => {
    if (gameRoot || !hasDesktopBridge()) return null;
    return async () => {
      try {
        const chosen = await chooseGameInstallation();
        const selected = chosen?.path || chosen?.gameRoot || "";
        if (selected) setGameRoot(selected);
      } catch (error) {
        onNotice?.(humanFailure(error), "error");
      }
    };
  }, [gameRoot, onNotice, setGameRoot]);

  /* --- В игру --- */

  const empty = draftIsEmpty(draft);
  /* Метка «своя эмблема» без картинки не ставится: «Применить» ждёт, пока картинку выберут или сменят вид метки. */
  const unfinished = useMemo(() => Object.values(installProject(draft).animals).some((item) => animalLookProblems(item).length > 0), [draft]);
  const installSignature = useMemo(() => workSignature({ animals: draftSignature(draft) }), [draft]);
  const applyButton = useWorkshopApplyButton(ANIMALS_INSTALL_KEY, installSignature);
  const busy = applyButton.pending;
  const supported = animalsSupported();

  function install() {
    if (!gameRoot || empty || unfinished) return;
    const snapshot = installProject(draft);
    const state = JSON.stringify(snapshot);
    void applyWorkshopWork({
      key: ANIMALS_INSTALL_KEY,
      signature: installSignature,
      title: tr("Животные"),
      editor: tr("Животные"),
      coverSlotId: EDITOR,
      coverState: state,
      steps: REPLACING_INSTALL_STEPS,
      notify: (text, tone) => onNotice?.(text, tone),
      savedText: tr("Ставим животных в игру"),
      run: ({ report }) => installAnimals({ project: snapshot, state, report }),
      doneText: ({ result }) => doneText(result),
    });
  }

  async function rollbackInstall() {
    if (busy || installRecord.rollingBack) return;
    try {
      await installRecord.rollback();
      onNotice?.(tr("Животные сняты: в игре снова штатные"));
    } catch (error) {
      onNotice?.(sanitizeDesktopErrorMessage(error), "error");
    }
  }

  const resetAnimal = () => {
    history.commit((current) => withoutLook(current, animal.id), null);
    onNotice?.(tr("{0}: как в игре").replace("{0}", tr(animal.name)));
  };
  const resetAll = () => {
    history.commit(() => createAnimalsDraft(), null);
    onNotice?.(tr("Работа с начала: все животные как в игре"));
  };

  const status = `${tr(animal.name)} · ${summaryOf(draft)}`;
  const applyTitle = !supported
    ? tr("Животные ставятся только в Astral Desktop")
    : !gameRoot
      ? tr("GTA V Legacy пока не подключена")
      : empty
        ? tr("Включите цвет, свечение или метку хотя бы у одного животного")
        : unfinished
          ? tr("У метки выбран вид «Своя эмблема», но картинки нет — выберите картинку или другой вид метки")
          : applyButton.hint || tr("Поставить животных в GTA V Legacy");

  return (
    <EditorShell
      className="fx-editor animals-editor"
      onBack={onExit}
      backLabel="Назад в мастерскую"
      title={tr("Животные")}
      status={status}
      tools={TOOLS}
      tool={tool}
      onTool={setTool}
      /* Над настройками нет рисованной карточки инструмента: картинка здесь — сам кадр (design-qa.md, п. 9). */
      toolCards={false}
      guide={GUIDE}
      guideKey={EDITOR}
      actions={
        <EditorActions
          onUndo={history.undo}
          canUndo={history.canUndo}
          onRedo={history.redo}
          canRedo={history.canRedo}
          more={[
            { value: "reset-animal", label: tr("Это животное — как в игре"), icon: <ArrowCounterClockwise />, disabled: !draft.animals[animal.id] },
            { value: "reset", label: tr("Сбросить всё"), icon: <ArrowCounterClockwise />, disabled: !Object.keys(draft.animals).length },
            ...(installRecord.record
              ? [{ value: "rollback", label: installRecord.rollingBack ? tr("Снимаем…") : tr("Снять из игры"), icon: <Trash />, disabled: busy || installRecord.rollingBack }]
              : []),
          ]}
          onMore={(action) => {
            if (action === "reset-animal") resetAnimal();
            else if (action === "reset") resetAll();
            else if (action === "rollback") void rollbackInstall();
          }}
          apply={
            hasDesktopBridge()
              ? {
                  label: tr("Применить"),
                  title: applyTitle,
                  disabled: !gameRoot || !supported || empty || unfinished,
                  busy: applyButton.busy,
                  meter: applyButton.meter,
                  onClick: install,
                }
              : null
          }
        >
          {connectGame && (
            <Button variant="ghost" size="sm" onClick={connectGame}>
              {tr("Подключить GTA V")}
            </Button>
          )}
        </EditorActions>
      }
      inspector={
        <fieldset className="animals-fieldset" disabled={!installable}>
          {!installable && (
            <p className="fx-hint animals-preview-only" role="note">
              {tr("Животное из дополнения Rockstar: слой Astral грузится раньше его файлов, поэтому облик на него пока не ставится — модель только для просмотра.")}
            </p>
          )}
          <AnimalsInspector tool={tool} look={look} animal={animal} onChange={change} />
        </fieldset>
      }
      dock={<AnimalList animals={shown} currentId={animal.id} query={query} onQuery={setQuery} lookOf={lookOf} onPick={setCurrentId} />}
    >
      <AnimalStage animal={animal} look={look} model={model} />
    </EditorShell>
  );
}

