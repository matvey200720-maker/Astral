/*
 * «Дым из-под колёс» (ТЗ владельца 11.10.2026, вечер): «чтобы люди могли
 * настраивать его как угодно: цвет, прозрачность, вместо дыма звёзды с
 * искрами или ещё что-то, размер менять…».
 *
 * По умолчанию — дым игры как есть. Человек выбирает, что вылетает из-под
 * колёс (дым, звёзды, сердечки, искры, огонь или ничего), как красить (как в
 * игре, свой цвет, два цвета, радуга), плотность, размер, густоту и сколько
 * дым висит, и где он работает — на пробуксовке, в дрифте, у мотоциклов.
 * Договор — `@modovik/ptfx-studio/wheel-smoke.js` (только он: пакет студии
 * целиком в кусок редактора не тянется); в игру работа уезжает нативным
 * патчем: клоны правил дыма в ядре игрока и таблица колёс wheelfx.dat
 * (`wheel-smoke.js` в главном процессе).
 *
 * Кадр — машина на матовом полу, из-под её колёс идёт тот самый дым:
 * правила из ядра игрока и клоны, собранные тем же заказом, что уедет в игру.
 * Раскладка — мастерская «как в Photoshop»: инструменты слева, справа —
 * настройки взятого, кадр — на всё место с общей камерой мастерской.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, Fire, Gauge, MapPin, Palette, SlidersHorizontal, Sparkle, Swatches, Trash } from "../../../components/ui/icons.jsx";
import {
  WHEEL_SMOKE_EXHAUST_GROUPS,
  createWheelSmokeProject,
  describeWheelSmoke,
  normalizeWheelSmokeProject,
  parseWheelSmokeProject,
  serializeWheelSmokeProject,
  wheelSmokeExhaustDefaults,
  wheelSmokeExhaustIsStock,
  wheelSmokeIsStock,
  wheelSmokeSignature,
  wheelSmokeSlipstreamDefaults,
  wheelSmokeSmokeDefaults,
  wheelSmokeSmokeIsStock,
} from "@modovik/ptfx-studio/wheel-smoke.js";
import { chooseGameInstallation, hasDesktopBridge, sanitizeDesktopErrorMessage, wheelSmokeSupported } from "../../../api.js";
import Button from "../../../components/ui/Button.jsx";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { StageNote } from "../../../components/ui/StageOverlay.jsx";
import { useSkyHistory } from "../../../components/desktop/workshop/useSkyHistory.js";
import useHistoryKeys from "../../../hooks/useHistoryKeys.js";
import { useRememberedState } from "../../../section-memory.js";
import { failureReason, humanFailure } from "../../../utils/installFailure.js";
import { currentUiLanguage, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import { useInstallRecord } from "../useInstallRecord.js";
import { REPLACING_INSTALL_STEPS, applyWorkshopWork, useWorkshopApplyButton, workSignature } from "../install-queue/index.js";
import { WHEEL_SMOKE_INSTALL_KEY, installWheelSmoke } from "../install-queue/tasks/wheel-smoke.js";
import { WorksStoreError, linkedEditorWork, saveEditorWorkToWorks, unlinkEditorWork } from "../works/workshop-works.js";
import { wheelSmokeCode } from "../works/work-transfer.js";
import { useWorkActions } from "../works/useWorkActions.jsx";
import { cameraGuide } from "../model-stage/stage-camera.js";
import WheelSmokeInspector from "./WheelSmokeInspector.jsx";
import WheelSmokeStage from "./WheelSmokeStage.jsx";
import { findLegacyRoot, loadWheelSmokeBase, loadWheelSmokeCar } from "./wheel-smoke-base.js";
import { restoreWheelSmokeProject, saveWheelSmokeProject } from "./wheel-smoke-project.js";

const EDITOR = "wheel-smoke";
/* База не прочиталась, потому что главный процесс старше окна: лечится перезапуском. */
const BASE_NEEDS_RESTART = "needs-restart";

/* Инструменты. Цифры — горячие клавиши: буквы в кадре заняты полётом камеры. Подписи под именем панели нет (design-qa.md, п. 9):
   имена говорят сами, перечисление того, что внутри, — это и есть панель. */
const TOOLS = Object.freeze([
  {
    id: "look",
    label: "Вид дыма",
    icon: <Sparkle />,
    shortcut: "1",
    group: "look",
    hint: "Выберите, что вылетает из-под колёс, или возьмите шаблон — машина в кадре покажет сразу",
  },
  {
    id: "colour",
    label: "Цвет дыма",
    icon: <Palette />,
    shortcut: "2",
    group: "look",
    hint: "Свой цвет красит и дым, и значки, и искры; «Как в игре» — серый дым игры",
  },
  {
    id: "shape",
    label: "Форма дыма",
    icon: <SlidersHorizontal />,
    shortcut: "3",
    group: "look",
    hint: "100 % — как в игре; поле числом — щелчок по значению",
  },
  {
    id: "where",
    label: "Где дым",
    icon: <MapPin />,
    shortcut: "4",
    group: "where",
    hint: "Выключено — как в игре.",
  },
  {
    id: "exhaust",
    label: "Огонь выхлопа",
    icon: <Fire />,
    shortcut: "5",
    group: "exhaust",
    hint: "Красит огонь у машин, у которых он в игре есть; кадр вспыхивает из трубы сам",
  },
  {
    id: "slipstream",
    label: "Воздушный пакет",
    icon: <Gauge />,
    shortcut: "6",
    group: "slipstream",
    hint: "Красит полосы воздуха, когда едешь в струе чужой машины; в кадре машина идёт на скорости",
  },
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    shortcut: "7",
    group: "ready",
    hint: "Готовый дым, огонь выхлопа и воздушный пакет; кадр показывает то, что взято",
  },
]);

function doneText(result) {
  const summary = result?.summary || describeWheelSmoke(result?.project);
  return trFill("Настройка автомобиля установлена: {0}. Перезапустите игру.", summary);
}

/* Фраза с вставкой {0}, {1}…: перевод шаблона, потом подстановка. */
const fillText = (tr, text, ...values) => values.reduce((out, value, index) => out.replace(`{${index}}`, () => value), tr(text));

export default function WheelSmokeStudio({ onExit, onNotice }) {
  const tr = useTr();
  const fill = (text, ...values) => fillText(tr, text, ...values);
  const [tool, setTool] = useRememberedState("wheel-smoke:tool", "look");
  const [mode, setMode] = useRememberedState("wheel-smoke:mode", "burnout");
  /* Что показывает кадр у инструмента «Огонь выхлопа»: задний огонь или хлопки. */
  const [fire, setFire] = useRememberedState("wheel-smoke:fire", "backfire");
  const [paint, setPaint] = useRememberedState("wheel-smoke:paint", "white");
  const [cameraMode, setCameraMode] = useState("orbit");
  const history = useSkyHistory(() => restoreWheelSmokeProject());
  const project = history.state;
  const installRecord = useInstallRecord(WHEEL_SMOKE_INSTALL_KEY);

  const commit = useCallback((update, label = null) => history.commit((current) => normalizeWheelSmokeProject(update(current)), label), [history]);
  const onChange = useCallback((values, label) => commit((current) => ({ ...current, ...values }), label), [commit]);
  /* Дым и огонь выхлопа правятся порознь: сброс и шаблон одного не трогают другое. */
  const onStock = useCallback(() => {
    commit((current) => ({ ...current, ...wheelSmokeSmokeDefaults() }), "Дым: как в игре");
    onNotice?.(tr("Дым как в игре: серый, во всех ползунках 100 %"));
  }, [commit, onNotice, tr]);
  /* Вкладка «Шаблоны»: кадр показывает то, чей шаблон взят последним, — дым, огонь выхлопа или воздушный пакет. */
  const [readyKind, setReadyKind] = useState("smoke");
  const onPreset = useCallback(
    (preset) => {
      setReadyKind("smoke");
      commit((current) => ({ ...current, ...wheelSmokeSmokeDefaults(), ...preset.project }), `Дым: ${preset.name}`);
      onNotice?.(trFill("Шаблон «{0}»", tr(preset.name)));
    },
    [commit, onNotice, tr],
  );
  const onExhaustStock = useCallback(() => {
    commit((current) => ({ ...current, ...wheelSmokeExhaustDefaults() }), "Огонь выхлопа: как в игре");
    onNotice?.(tr("Огонь выхлопа как в игре: оранжевый, во всех ползунках 100 %"));
  }, [commit, onNotice, tr]);
  const onExhaustPreset = useCallback(
    (preset) => {
      setReadyKind("exhaust");
      commit((current) => ({ ...current, ...wheelSmokeExhaustDefaults(), ...preset.project }), `Огонь выхлопа: ${preset.name}`);
      onNotice?.(trFill("Шаблон «{0}»", tr(preset.name)));
    },
    [commit, onNotice, tr],
  );
  const onSlipstreamStock = useCallback(() => {
    commit((current) => ({ ...current, ...wheelSmokeSlipstreamDefaults() }), "Воздушный пакет: как в игре");
    onNotice?.(tr("Воздушный пакет как в игре: белые полосы, во всех ползунках 100 %"));
  }, [commit, onNotice, tr]);
  const onSlipstreamPreset = useCallback(
    (preset) => {
      setReadyKind("slip");
      commit((current) => ({ ...current, ...wheelSmokeSlipstreamDefaults(), ...preset.project }), `Воздушный пакет: ${preset.name}`);
      onNotice?.(trFill("Шаблон «{0}»", tr(preset.name)));
    },
    [commit, onNotice, tr],
  );
  const onCamera = useCallback((next) => setCameraMode(next), []);

  /* --- Игра и её дым --- */

  const [gameRoot, setGameRoot] = useState("");
  /* Папку игры искали — до этого неизвестно, будет ли у кадра машина игры (колёса без кузова до неё не показываются, П6.7). */
  const [rootSearched, setRootSearched] = useState(false);
  const [base, setBase] = useState(null);
  const [baseFailure, setBaseFailure] = useState("");
  const [baseLoading, setBaseLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    findLegacyRoot()
      .then((root) => {
        if (!cancelled && root) setGameRoot(root);
      })
      .catch(() => {})
      .finally(() => !cancelled && setRootSearched(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!gameRoot) return undefined;
    let cancelled = false;
    setBaseLoading(true);
    /* Одна база на сеанс: обложка плитки могла прочитать её раньше. */
    loadWheelSmokeBase(gameRoot)
      .then((result) => {
        if (cancelled) return;
        setBase(result);
        setBaseFailure(result ? "" : BASE_NEEDS_RESTART);
      })
      .catch((error) => {
        /* Причина словами, без стека помощника RPF (ядро чужой сборки). */
        if (!cancelled) setBaseFailure(failureReason(error, currentUiLanguage()));
      })
      .finally(() => {
        if (!cancelled) setBaseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameRoot]);

  /* Дрифт-машина кадра — из той же игры; без неё в кадре колёса Astral.
     `null` — ещё читается (или игры нет), `false` — в игре её не нашлось. */
  const [gameCar, setGameCar] = useState(null);
  useEffect(() => {
    if (!gameRoot) return undefined;
    let cancelled = false;
    loadWheelSmokeCar(gameRoot)
      .then((result) => {
        if (!cancelled) setGameCar(result || false);
      })
      .catch(() => {
        if (!cancelled) setGameCar(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameRoot]);

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
  const saveDraft = useCallback(() => saveWheelSmokeProject(projectRef.current), []);
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

  /* --- Мои работы --- */

  const sourceName = useRef("");
  const stock = wheelSmokeIsStock(project);
  const works = useWorkActions({
    kind: EDITOR,
    onNotice,
    linkedName: () => linkedEditorWork(EDITOR)?.name || "",
    defaultName: () => sourceName.current,
    onSave: async ({ name, asNew }) => {
      if (wheelSmokeIsStock(project)) throw new WorksStoreError("empty");
      const { work, created } = saveEditorWorkToWorks(EDITOR, serializeWheelSmokeProject(project), { name, asNew });
      sourceName.current = "";
      return { name: work.name, created };
    },
    onCopy: () => wheelSmokeCode(project, { name: linkedEditorWork(EDITOR)?.name || sourceName.current }),
    /* Код ложится шагом истории: «Отменить» возвращает свой дым. */
    onOpen: (result) => {
      const template = result.templates[0];
      history.commit(() => parseWheelSmokeProject(template.state), null);
      sourceName.current = template.name;
      unlinkEditorWork(EDITOR);
    },
  });

  function resetEverything() {
    history.commit(() => createWheelSmokeProject(), null);
    sourceName.current = "";
    unlinkEditorWork(EDITOR);
    onNotice?.(tr("Работа с начала: дым как в игре"));
  }

  /* --- В игру --- */

  const installSignature = useMemo(() => workSignature({ wheelSmoke: wheelSmokeSignature(project) }), [project]);
  const applyButton = useWorkshopApplyButton(WHEEL_SMOKE_INSTALL_KEY, installSignature);
  const busy = applyButton.pending;
  const installable = wheelSmokeSupported();
  /* Дым игры без своей установки — ставить нечего; после своей — «Применить»
     вернёт игре её дым. */
  const restoresStock = stock && Boolean(installRecord.record);

  function install() {
    if (!gameRoot || (stock && !restoresStock)) return;
    const snapshot = normalizeWheelSmokeProject(project);
    const state = serializeWheelSmokeProject(snapshot);
    void applyWorkshopWork({
      key: WHEEL_SMOKE_INSTALL_KEY,
      signature: workSignature({ wheelSmoke: wheelSmokeSignature(snapshot) }),
      title: snapshot.name || tr("Настройка автомобиля"),
      editor: tr("Настройка автомобиля"),
      coverSlotId: "wheel-smoke",
      coverState: state,
      steps: REPLACING_INSTALL_STEPS,
      notify: (text, tone) => onNotice?.(text, tone),
      savedText: tr("Ставим настройку автомобиля в игру"),
      run: ({ report }) => installWheelSmoke({ project: snapshot, state, report }),
      doneText: ({ result }) => doneText(result),
    });
  }

  async function rollbackInstall() {
    if (busy || installRecord.rollingBack) return;
    try {
      await installRecord.rollback();
      onNotice?.(tr("Настройка автомобиля снята: в игре снова всё как у игры"));
    } catch (error) {
      onNotice?.(sanitizeDesktopErrorMessage(error), "error");
    }
  }

  /* Выключенная в «Где дым» цель остаётся с дымом игры — кадр так и играет. */
  const ready = tool === "templates";
  const exhaustTool = tool === "exhaust" || (ready && readyKind === "exhaust");
  const slipTool = tool === "slipstream" || (ready && readyKind === "slip");
  const stageMode = slipTool
    ? "slipstream"
    : exhaustTool
      ? fire === "misfire"
        ? "misfire"
        : "backfire"
      : mode === "drift"
        ? "drift"
        : "burnout";

  /*
   * Строка под кадром — одна и короткая (design-qa.md, п. 14): откуда кадр — в `title`, жёлтая — только то, что человек
   * может исправить. Без игры — одна строка «подключите», дым и огонь отдельно об этом не говорят.
   */
  const carLine = gameCar?.car?.name
    ? ""
    : gameRoot && gameCar === false
      ? tr("В вашей GTA V нет дрифт-машины — в кадре одни колёса.")
      : gameRoot
        ? baseLoading ? "" : tr("Читаем машину из вашей GTA V…")
        : tr("Подключите GTA V — машина, дым и огонь берутся из вашей игры.");
  const carWarn = !gameRoot && !gameCar?.car?.name;
  const smokeStock = wheelSmokeSmokeIsStock(project);
  const exhaustStock = wheelSmokeExhaustIsStock(project);
  const gameHere =
    !exhaustTool && !slipTool && !smokeStock && !project[stageMode]
      ? fill("{0} — дым игры: эта цель выключена в «Где дым».", tr(stageMode === "drift" ? "В дрифте" : "На пробуксовке"))
      : "";
  const noSmoke = !exhaustTool && !slipTool && !smokeStock && project.look === "none" && project[stageMode];
  const exhaustGroup = WHEEL_SMOKE_EXHAUST_GROUPS.find((item) => item.id === stageMode);
  const flameHere =
    exhaustTool && !exhaustStock && exhaustGroup && !project[exhaustGroup.field]
      ? fill("{0} — огонь игры: эта часть выключена в «Что красить».", tr(exhaustGroup.label))
      : "";
  /* Что в кадре: правила ядра игры, их чтение и отказ. Прочиталось — строки нет, только «эта цель выключена». */
  const effect = slipTool ? "slip" : exhaustTool ? "fire" : "smoke";
  const effectSource = gameCar?.car?.name
    ? fill("{0}: модель, колёса и текстуры из вашей GTA V. Правила частиц и листы — из ядра вашей игры, собранные так же, как уедут в игру.", gameCar.car.name)
    : tr("Правила частиц и листы — из ядра вашей игры, собранные так же, как уедут в игру.");
  let effectLine = "";
  let effectWarn = false;
  let effectTitle = base ? effectSource : "";
  if (!slipTool && !exhaustTool && noSmoke) {
    effectLine = tr("Колёса не дымят — так будет и в игре: вид «Без дыма».");
  } else if (base) {
    effectLine = slipTool ? "" : exhaustTool ? flameHere : gameHere;
  } else if (!gameRoot) {
    effectLine = "";
  } else if (baseLoading) {
    effectLine = { slip: tr("Читаем воздушный пакет вашей GTA V…"), fire: tr("Читаем огонь выхлопа вашей GTA V…"), smoke: tr("Читаем дым из-под колёс вашей GTA V…") }[effect];
  } else if (baseFailure === BASE_NEEDS_RESTART) {
    effectWarn = true;
    effectLine = { slip: tr("Перезапустите Astral — тогда воздушный пакет появится в кадре."), fire: tr("Перезапустите Astral — тогда огонь игры появится в кадре."), smoke: tr("Перезапустите Astral — тогда дым игры появится в кадре.") }[effect];
  } else {
    effectLine = { slip: tr("Воздушный пакет игры не прочитался — в кадре его нет."), fire: tr("Огонь игры не прочитался — в кадре его нет."), smoke: tr("Дым игры не прочитался — в кадре его нет.") }[effect];
    effectTitle = baseFailure ? tr(baseFailure) : "";
  }

  const status = `${project.name || tr("Моя настройка автомобиля")} · ${describeWheelSmoke(project)}`;
  const applyTitle = !installable
    ? tr("Настройка автомобиля ставится только в Astral Desktop")
    : !gameRoot
      ? tr("GTA V Legacy пока не подключена")
      : stock
        ? restoresStock
          ? tr("Вернуть игре её дым и огонь: клоны Astral уйдут из ядра")
          : tr("Это дым и огонь игры — ставить нечего")
        : applyButton.hint || tr("Поставить настройку автомобиля в GTA V Legacy");

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor wheel-smoke-editor"
      onBack={onExit}
      backLabel="Назад в мастерскую"
      title={tr("Настройка автомобиля")}
      status={status}
      tools={TOOLS}
      tool={tool}
      onTool={setTool}
      guide={cameraGuide(cameraMode)}
      guideKey="wheel-smoke"
      actions={
        <EditorActions
          onUndo={history.undo}
          canUndo={history.canUndo}
          onRedo={history.redo}
          canRedo={history.canRedo}
          more={[
            ...works.items,
            { value: "reset", label: tr("Сбросить всё"), icon: <ArrowCounterClockwise /> },
            ...(installRecord.record
              ? [{ value: "rollback", label: installRecord.rollingBack ? tr("Снимаем…") : tr("Снять из игры"), icon: <Trash />, disabled: busy || installRecord.rollingBack }]
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
                  disabled: !gameRoot || !installable || (stock && !restoresStock),
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
        <WheelSmokeInspector
          tool={tool}
          onTool={setTool}
          project={project}
          onChange={onChange}
          onStock={onStock}
          onPreset={onPreset}
          onExhaustStock={onExhaustStock}
          onExhaustPreset={onExhaustPreset}
          onSlipstreamStock={onSlipstreamStock}
          onSlipstreamPreset={onSlipstreamPreset}
        />
      }
    >
      <WheelSmokeStage
        project={project}
        base={base}
        car={gameCar || null}
        carPending={hasDesktopBridge() && (!rootSearched || (Boolean(gameRoot) && gameCar === null))}
        mode={stageMode}
        onMode={slipTool ? null : exhaustTool ? setFire : setMode}
        paint={paint}
        onPaint={setPaint}
        onCamera={onCamera}
      />
      <StageNote tone={carWarn ? "warning" : undefined}>{carLine}</StageNote>
      <StageNote tone={effectWarn ? "warning" : undefined} title={effectTitle}>{effectLine}</StageNote>
      {works.dialogs}
    </EditorShell>
  );
}
