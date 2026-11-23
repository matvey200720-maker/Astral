/*
 * «Полоска HP» (задача 2 ТЗ 11.10.2026) — полоска здоровья и брони над
 * игроком. Утром она была инструментом прицела; владелец вынес её в свой
 * редактор: «по умолчанию как в GTA — белая, а дальше человек правит».
 *
 * По умолчанию — штатная полоска игры: белое HP, броня #2F5C73 рядом,
 * чёрная рамка, видна при наведении. Человек выбирает вид (полоска, цифры
 * HP и брони, одна цифра — HP и броня вместе, до 200, — цифры в полоске),
 * одна полоса или две, когда она видна (как в игре или всегда), цвета HP и
 * брони отдельно, броню можно убрать, размер, толщину, место над головой,
 * фон и цифры. В игру работа уезжает своим
 * нативным патчем — метка игрока `mp_gamer_info.gfx`
 * (`target-hp-customizer.js` в главном процессе), договор —
 * `@modovik/reticle-contract` (`target-health.js`).
 *
 * Раскладка — мастерская «как в Photoshop»: инструменты слева, справа —
 * настройки взятого, кадр — постановочная сцена с тремя игроками.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowsOut, Heartbeat, Shield, SquaresFour, TextT, Trash } from "../../../components/ui/icons.jsx";
import {
  createTargetHpProject,
  describeTargetHealth,
  normalizeTargetHealth,
  normalizeTargetHpProject,
  parseTargetHpProject,
  serializeTargetHpProject,
  targetHealthIsStock,
  targetHpSignature,
  TARGET_HP_DEFAULTS,
} from "@modovik/reticle-contract";
import {
  chooseGameInstallation,
  detectInstallations,
  hasDesktopBridge,
  sanitizeDesktopErrorMessage,
  targetHpSupported,
} from "../../../api.js";
import Button from "../../../components/ui/Button.jsx";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { useSkyHistory } from "../../../components/desktop/workshop/useSkyHistory.js";
import useHistoryKeys from "../../../hooks/useHistoryKeys.js";
import { useRememberedState } from "../../../section-memory.js";
import { registerFrameShot } from "../frame-shot.js";
import { tr, useTr } from "../../../locales/ui.js";
import { humanFailure } from "../../../utils/installFailure.js";
import { useInstallRecord } from "../useInstallRecord.js";
import { REPLACING_INSTALL_STEPS, applyWorkshopWork, useWorkshopApplyButton, workSignature } from "../install-queue/index.js";
import { TARGET_HP_INSTALL_KEY, installTargetHp } from "../install-queue/tasks/target-hp.js";
import { WorksStoreError, linkedEditorWork, saveEditorWorkToWorks, unlinkEditorWork } from "../works/workshop-works.js";
import { targetHpCode } from "../works/work-transfer.js";
import { useWorkActions } from "../works/useWorkActions.jsx";
import TargetHpInspector from "./TargetHpInspector.jsx";
import TargetHpStage from "./TargetHpStage.jsx";
import { restoreTargetHpProject, saveTargetHpProject } from "./target-hp-project.js";

const EDITOR = "target-hp";
/* Кадр плоский — управлять в нём нечем, кроме истории правок. */
const GUIDE = Object.freeze([
  { keys: ["Ctrl", "Z"], text: "отменить" },
  { keys: ["Ctrl", "Y"], text: "повторить" },
]);

/* Инструменты. Цифры — горячие клавиши, как у остальных редакторов. */
const TOOLS = Object.freeze([
  {
    id: "view",
    label: "Вид",
    icon: <SquaresFour />,
    shortcut: "1",
    group: "look",
    note: "Полоска, цифры или одна цифра; одна полоса или две; когда видна",
    hint: "По умолчанию — как в игре: белая полоска при наведении. Выберите вид — кадр покажет его над игроками",
  },
  {
    id: "health",
    label: "HP",
    icon: <Heartbeat />,
    shortcut: "2",
    group: "parts",
    note: "Цвет полосы здоровья",
    hint: "Белая — как в игре; пустая часть полосы — тот же цвет, приглушённый",
  },
  {
    id: "armour",
    label: "Броня",
    icon: <Shield />,
    shortcut: "3",
    group: "parts",
    note: "Показывать ли броню и её цвет",
    hint: "Без брони полоска и цифры — одно HP; «HP и броня» в углу кадра показывает броню",
  },
  {
    id: "size",
    label: "Размер",
    icon: <ArrowsOut />,
    shortcut: "4",
    group: "look",
    note: "Размер, толщина, место над головой и фон",
    hint: "«Крупно» в углу кадра — метка того, на кого навелись: так видна толщина",
  },
  {
    id: "digits",
    label: "Цифры",
    icon: <TextT />,
    shortcut: "5",
    group: "look",
    note: "Шрифт игры, цвет и тень цифр",
    hint: "Цифры — доля HP и брони от 0 до 100, как её считает игра; одна цифра — их сумма, до 200",
  },
]);

/* Сводка словами — по частям (`описание · описание`), каждая переводится
   отдельно: целиком её не поймать ключом словаря. */
const translateSummary = (summary) =>
  summary
    .split(" · ")
    .map((part) => tr(part))
    .join(" · ");

/* Итог установки: после неё человек ждёт полоску в игре, и на Majestic RP и
   GTA 5 RP её не будет — там её рисует сервер. */
function doneText(result) {
  const summary = translateSummary(result?.summary || describeTargetHealth(result?.project));
  return tr("Полоска HP установлена: {0}. Перезапустите игру. На Majestic RP и GTA 5 RP полоску рисует сервер: там она не изменится.").replace("{0}", summary);
}

export default function TargetHpStudio({ onExit, onNotice }) {
  useTr();
  const [tool, setTool] = useRememberedState("target-hp:tool", "view");
  const [view, setView] = useRememberedState("target-hp:view", "zoom");
  const [backdrop, setBackdrop] = useRememberedState("target-hp:backdrop", "dark");
  const history = useSkyHistory(() => restoreTargetHpProject());
  const project = history.state;
  /* Пример в кадре: полное HP без брони — штатная белая полоска; у «Одной
     цифры» сразу с полной бронёй, чтобы было видно 200. */
  const [example, setExample] = useRememberedState("target-hp:example", () => (project.view === "total" ? "armour" : "full"));
  const config = useMemo(() => normalizeTargetHealth(project), [project]);
  const installRecord = useInstallRecord(TARGET_HP_INSTALL_KEY);

  const commit = useCallback((update, label = null) => history.commit((current) => normalizeTargetHpProject(update(current)), label), [history]);
  const onChange = useCallback(
    (values, label) => {
      /* «Одна цифра» без брони у примера показала бы 100 — сразу видно, что
         полное HP с полной бронёй дают 200. */
      if (values.view === "total" && example === "full") setExample("armour");
      commit((current) => ({ ...current, ...values }), label);
    },
    [commit, example, setExample],
  );
  const onStock = useCallback(() => {
    commit((current) => ({ ...current, ...TARGET_HP_DEFAULTS }), "Полоска HP: как в игре");
    onNotice?.("Полоска как в игре: белое HP, броня рядом, чёрная рамка, при наведении");
  }, [commit, onNotice]);

  /* --- Игра --- */

  const [gameRoot, setGameRoot] = useState("");
  useEffect(() => {
    let cancelled = false;
    detectInstallations()
      .then((games) => {
        if (cancelled) return;
        const legacy = (Array.isArray(games) ? games : []).find((item) => item?.path && String(item.edition || "Legacy").toLowerCase() === "legacy");
        if (legacy) setGameRoot(legacy.path);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
  }, [gameRoot, onNotice]);

  /* --- Черновик --- */

  const projectRef = useRef(project);
  projectRef.current = project;
  const saveDraft = useCallback(() => saveTargetHpProject(projectRef.current), []);
  useEffect(() => {
    const timer = window.setTimeout(saveDraft, 500);
    return () => window.clearTimeout(timer);
  }, [project, saveDraft]);
  useEffect(() => {
    window.addEventListener("beforeunload", saveDraft);
    return () => {
      window.removeEventListener("beforeunload", saveDraft);
      saveDraft();
    };
  }, [saveDraft]);
  useHistoryKeys(history);

  /* Снимок работы (`frame-shot.js`): кадр как открывается редактор — «Крупно», тёмный фон, штатный пример; потом выбор человека на место. */
  const coverBack = useRef(null);
  coverBack.current = { view, backdrop, example };
  useEffect(
    () =>
      registerFrameShot({
        pose: () => {
          const was = coverBack.current;
          setView("zoom");
          setBackdrop("dark");
          return () => {
            setView(was.view);
            setBackdrop(was.backdrop);
          };
        },
      }),
    [setBackdrop, setView],
  );

  /* --- Мои работы --- */

  const sourceName = useRef("");
  const stock = targetHealthIsStock(config);
  const works = useWorkActions({
    kind: EDITOR,
    onNotice,
    linkedName: () => linkedEditorWork(EDITOR)?.name || "",
    defaultName: () => sourceName.current,
    onSave: async ({ name, asNew }) => {
      if (targetHealthIsStock(project)) throw new WorksStoreError("empty");
      const { work, created } = saveEditorWorkToWorks(EDITOR, serializeTargetHpProject(project), { name, asNew });
      sourceName.current = "";
      return { name: work.name, created };
    },
    onCopy: () => targetHpCode(project, { name: linkedEditorWork(EDITOR)?.name || sourceName.current }),
    /* Код ложится шагом истории: «Отменить» возвращает свою полоску. */
    onOpen: (result) => {
      const template = result.templates[0];
      history.commit(() => parseTargetHpProject(template.state), null);
      sourceName.current = template.name;
      unlinkEditorWork(EDITOR);
    },
  });

  function resetEverything() {
    history.commit(() => createTargetHpProject(), null);
    sourceName.current = "";
    unlinkEditorWork(EDITOR);
    onNotice?.("Работа с начала: полоска как в игре");
  }

  /* --- В игру --- */

  const installSignature = useMemo(() => workSignature({ targetHp: targetHpSignature(project) }), [project]);
  const applyButton = useWorkshopApplyButton(TARGET_HP_INSTALL_KEY, installSignature);
  const busy = applyButton.pending;
  const installable = targetHpSupported();

  function install() {
    if (!gameRoot) return;
    const snapshot = normalizeTargetHpProject(project);
    const state = serializeTargetHpProject(snapshot);
    void applyWorkshopWork({
      key: TARGET_HP_INSTALL_KEY,
      signature: workSignature({ targetHp: targetHpSignature(snapshot) }),
      title: snapshot.name || "Полоска HP",
      editor: "Полоска HP",
      coverSlotId: "target-hp",
      coverState: state,
      steps: REPLACING_INSTALL_STEPS,
      notify: (text, tone) => onNotice?.(text, tone),
      savedText: "Ставим полоску HP в игру",
      run: ({ report }) => installTargetHp({ project: snapshot, state, report }),
      doneText: ({ result }) => doneText(result),
    });
  }

  async function rollbackInstall() {
    if (busy || installRecord.rollingBack) return;
    try {
      await installRecord.rollback();
      onNotice?.("Полоска HP снята: в игре снова её штатная метка");
    } catch (error) {
      onNotice?.(sanitizeDesktopErrorMessage(error), "error");
    }
  }

  const status = `${project.name || tr("Моя полоска HP")} · ${translateSummary(describeTargetHealth(config))}`;
  const applyTitle = !installable
    ? tr("Полоска HP ставится только в Astral Desktop")
    : !gameRoot
      ? tr("GTA V Legacy пока не подключена")
      : applyButton.hint || (stock ? tr("Поставить полоску как в игре — дальше её можно править") : tr("Поставить полоску в GTA V Legacy"));

  return (
    <EditorShell
      className="fx-editor target-hp-editor"
      onBack={onExit}
      backLabel="Назад в мастерскую"
      title="Полоска HP"
      status={status}
      tools={TOOLS}
      tool={tool}
      onTool={setTool}
      guide={GUIDE}
      guideKey="target-hp"
      actions={
        <EditorActions
          onUndo={history.undo}
          canUndo={history.canUndo}
          onRedo={history.redo}
          canRedo={history.canRedo}
          more={[
            ...works.items,
            { value: "reset", label: "Сбросить всё", icon: <ArrowCounterClockwise /> },
            ...(installRecord.record
              ? [{ value: "rollback", label: installRecord.rollingBack ? "Снимаем…" : "Снять из игры", icon: <Trash />, disabled: busy || installRecord.rollingBack }]
              : []),
          ]}
          onMore={(action) => {
            if (works.handle(action)) return;
            if (action === "reset") resetEverything();
            else if (action === "rollback") void rollbackInstall();
          }}
          apply={
            hasDesktopBridge()
              ? {
                  label: tr("Применить"),
                  title: applyTitle,
                  disabled: !gameRoot || !installable,
                  busy: applyButton.busy,
                  meter: applyButton.meter,
                  onClick: install,
                }
              : null
          }
        >
          {connectGame && (
            <Button variant="ghost" size="sm" onClick={connectGame}>
              Подключить GTA V
            </Button>
          )}
        </EditorActions>
      }
      inspector={<TargetHpInspector tool={tool} config={config} onChange={onChange} onStock={onStock} />}
    >
      <TargetHpStage
        config={config}
        view={view === "screen" ? "screen" : "zoom"}
        onView={setView}
        backdrop={backdrop}
        onBackdrop={setBackdrop}
        example={example}
        onExample={setExample}
      />
      {works.dialogs}
    </EditorShell>
  );
}
