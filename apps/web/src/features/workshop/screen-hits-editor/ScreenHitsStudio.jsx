/*
 * Эффекты попадания на экране (задача 3 ТЗ 04.10.2026): красный след по
 * краю экрана, когда попадают по самому игроку.
 *
 * Человек выбирает картинку следа — каплю игры, готовую маску Astral или
 * свою, — цвет, непрозрачность (по умолчанию прозрачнее игры), размер,
 * разброс, появление, длительность и затухание. В игру работа уезжает
 * ключами `misc.DamageOverlay.*` в visualsettings.dat и текстурой
 * `dmg_overlay_fade` в graphics.ytd (`screen-hits-customizer.js` в главном
 * процессе); устройство — `@modovik/kill-effects/screen-hits`.
 *
 * Раскладка — мастерская «как в Photoshop»: картинка, цвет, вид, время и
 * готовые виды — инструменты слева, справа — настройки взятого, кадр —
 * матовая стена с тремя попаданиями. «Стандарт GTA» — в «Шаблонах».
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, Clock, Drop, Palette, SlidersHorizontal, Swatches, Trash } from "../../../components/ui/icons.jsx";
import {
  applyScreenHitsPreset,
  createScreenHitsProject,
  describeScreenHits,
  normalizeScreenHitsProject,
  parseScreenHitsProject,
  screenHitsIsVanilla,
  screenHitsSignature,
  serializeScreenHitsProject,
} from "@modovik/kill-effects/screen-hits.js";
import {
  chooseGameInstallation,
  detectInstallations,
  hasDesktopBridge,
  readScreenHits,
  sanitizeDesktopErrorMessage,
  screenHitsSupported,
} from "../../../api.js";
import Button from "../../../components/ui/Button.jsx";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { StageNote } from "../../../components/ui/StageOverlay.jsx";
import { useSkyHistory } from "../../../components/desktop/workshop/useSkyHistory.js";
import useHistoryKeys from "../../../hooks/useHistoryKeys.js";
import { useRememberedState } from "../../../section-memory.js";
import { failureReason, humanFailure } from "../../../utils/installFailure.js";
import { useInstallRecord } from "../useInstallRecord.js";
import { REPLACING_INSTALL_STEPS, applyWorkshopWork, useWorkshopApplyButton, workSignature } from "../install-queue/index.js";
import { SCREEN_HITS_INSTALL_KEY, STOCK_SCREEN_HITS, installScreenHits } from "../install-queue/tasks/screen-hits.js";
import { WorksStoreError, linkedEditorWork, saveEditorWorkToWorks, unlinkEditorWork } from "../works/workshop-works.js";
import { screenHitsCode } from "../works/work-transfer.js";
import { useWorkActions } from "../works/useWorkActions.jsx";
import ScreenHitsInspector from "./ScreenHitsInspector.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { prefetchPtfxBase, usePtfxBase } from "../../../components/desktop/workshop/ptfx/ptfx-base-store.js";
import CombatScreenHitsStage from "../combat-stage/CombatScreenHitsStage.jsx";
import { combatBodiesAvailable } from "../combat-stage/combat-bodies.js";
import FxScreenHitsFrameStage from "../fx-frame/FxScreenHitsFrameStage.jsx";
import ScreenHitsStage from "./ScreenHitsStage.jsx";
import { dropField } from "./screen-hits-painter.js";
import { importScreenHitPicture, screenHitPicture, screenHitPicturePng } from "./screen-hit-pictures.js";
import { currentUiLanguage, tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

const STORAGE_KEY = "astral.screen-hits.project.v1";
/* Кадр плоский — управлять в нём нечем, кроме истории правок. */
const GUIDE = Object.freeze([
  { keys: ["Ctrl", "Z"], text: "отменить" },
  { keys: ["Ctrl", "Y"], text: "повторить" },
]);
const EDITOR = "screen-hits";

/*
 * Инструменты. Цифры — горячие клавиши, как у остальных редакторов.
 */
const TOOLS = Object.freeze([
  {
    id: "shape",
    label: "Картинка",
    icon: <Drop />,
    shortcut: "1",
    group: "look",
    note: "Капля игры, готовые маски или своя картинка",
    hint: "Выберите картинку следа — кадр сразу покажет её на трёх попаданиях; «Количество» — сколько пятен в одном следе",
  },
  {
    id: "colour",
    label: "Цвет",
    icon: <Palette />,
    shortcut: "2",
    group: "look",
    note: "Свой цвет следа: один или два",
    hint: "Один цвет — на весь след; два — для низа и верха экрана, как у самой игры",
  },
  {
    id: "look",
    label: "Вид",
    icon: <SlidersHorizontal />,
    shortcut: "3",
    group: "look",
    note: "Непрозрачность, размер, разброс",
    hint: "По умолчанию след прозрачнее игры; 0 % — следа нет совсем",
  },
  {
    id: "time",
    label: "Время",
    icon: <Clock />,
    shortcut: "4",
    group: "look",
    note: "Появление, длительность, затухание",
    hint: "Кадр повторяет три попадания по кругу — видно, как след нарастает, держится и гаснет",
  },
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    shortcut: "5",
    group: "ready",
    note: "Готовые виды и «Стандарт GTA»",
    hint: "Готовый вид — начало: дальше любой инструмент правит его",
  },
]);

function restoreProject() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? parseScreenHitsProject(stored) : createScreenHitsProject();
  } catch {
    return createScreenHitsProject();
  }
}

const STOCK_DONE_TEXT = "След на экране — снова как в игре";

function doneText(result) {
  if (screenHitsIsVanilla(result?.project)) return STOCK_DONE_TEXT;
  const texture = result?.texture === "custom" ? tr(" и своя картинка следа") : "";
  return `След на экране установлен: ${result?.summary || tr("своё")}${texture}. Перезапустите игру.`;
}

/* Капля из игры игрока (PNG base64) → поле яркости для кадра. */
function useGameDrop(png) {
  const [drop, setDrop] = useState(null);
  useEffect(() => {
    if (!png || typeof Image === "undefined") {
      setDrop(null);
      return undefined;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setDrop({ key: png.length + png.slice(-24), field: dropField(image) });
    };
    image.onerror = () => {
      if (!cancelled) setDrop(null);
    };
    image.src = `data:image/png;base64,${png}`;
    return () => {
      cancelled = true;
    };
  }, [png]);
  return drop;
}

export default function ScreenHitsStudio({ onExit, onNotice }) {
  useTr();
  const [tool, setTool] = useRememberedState("screen-hits:tool", "shape");
  const [view, setView] = useRememberedState("screen-hits:view", "third");
  /* Кадр: объёмный (сцена боя с людьми из игры) или плоский (матовая стена). */
  const [stageMode, setStageMode] = useRememberedState("screen-hits:stage", "3d");
  const [stage3dFailed, setStage3dFailed] = useState(false);
  const history = useSkyHistory(restoreProject);
  const project = history.state;
  const installRecord = useInstallRecord(SCREEN_HITS_INSTALL_KEY);

  const commit = useCallback((update, label = null) => history.commit((current) => normalizeScreenHitsProject(update(current)), label), [history]);
  const onChange = useCallback((values, label) => commit((current) => ({ ...current, ...values }), label), [commit]);

  /* --- Игра и её капля --- */

  const [gameRoot, setGameRoot] = useState("");
  const [base, setBase] = useState(null);
  const [baseFailure, setBaseFailure] = useState("");
  const [baseLoading, setBaseLoading] = useState(false);

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

  useEffect(() => {
    if (!gameRoot) return undefined;
    let cancelled = false;
    setBaseLoading(true);
    readScreenHits({ gameRoot })
      .then((result) => {
        if (cancelled) return;
        setBase(result || null);
        setBaseFailure(result ? "" : tr("главный процесс ещё не знает этого раздела — перезапустите Astral"));
      })
      .catch((error) => {
        /* Причина словами, без стека помощника RPF. */
        if (!cancelled) setBaseFailure(failureReason(error, currentUiLanguage()));
      })
      .finally(() => {
        if (!cancelled) setBaseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameRoot]);

  const drop = useGameDrop(base?.stockDrop || null);

  /* База эффектов — для вспышки и следа пули в объёмном кадре; живёт в окне одна на редакторы. */
  const ptfx = usePtfxBase();
  useEffect(() => {
    prefetchPtfxBase();
  }, []);
  const can3d = combatBodiesAvailable() && Boolean(gameRoot);
  const stage3d = can3d && stageMode !== "flat" && !stage3dFailed;
  /* Кадры GTA V для экранных попаданий (docs/fx-scenes.md): нашлись хоть раз — «Кадр игры» стоит вместо 3D-сцены и стены, «Плоский» её прячет. */
  const [framesExist, setFramesExist] = useState(false);
  const onFrameStatus = useCallback((status) => {
    if (status.shown) setFramesExist(true);
  }, []);
  const modeControl = can3d || framesExist ? (
    <SegmentedControl
      size="sm"
      label={tr("Вид кадра")}
      options={[
        { value: "3d", label: framesExist ? tr("Кадр игры") : tr("Объёмный") },
        { value: "flat", label: tr("Плоский") },
      ]}
      value={framesExist ? (stageMode !== "flat" ? "3d" : "flat") : stage3d ? "3d" : "flat"}
      onChange={(next) => {
        setStage3dFailed(false);
        setStageMode(next);
      }}
    />
  ) : null;

  /* --- Своя картинка --- */

  const [picture, setPicture] = useState(null);
  const [pictureBusy, setPictureBusy] = useState(false);
  const [pictureError, setPictureError] = useState("");
  const pictureAsset = project.own.asset;

  useEffect(() => {
    let cancelled = false;
    if (!pictureAsset) {
      setPicture(null);
      return undefined;
    }
    screenHitPicture(pictureAsset)
      .then((found) => {
        if (!cancelled) setPicture(found);
      })
      .catch(() => {
        if (!cancelled) setPicture(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pictureAsset]);

  const onPicture = useCallback(
    async (file) => {
      setPictureBusy(true);
      setPictureError("");
      try {
        const next = await importScreenHitPicture(file);
        setPicture(next);
        commit((current) => ({ ...current, shape: "own", count: 1, own: { asset: next.asset, name: next.name, invert: false } }), null);
        onNotice?.(`Своя картинка следа: ${next.name}`);
      } catch (error) {
        setPictureError(humanFailure(error));
      } finally {
        setPictureBusy(false);
      }
    },
    [commit, onNotice],
  );

  /* --- Шаблоны и «Стандарт GTA» --- */

  const onPreset = useCallback(
    (preset) => {
      commit((current) => applyScreenHitsPreset(current, preset.id), null);
      unlinkEditorWork(EDITOR);
      onNotice?.(`Готовый вид: ${preset.label}`);
    },
    [commit, onNotice],
  );
  const onStandard = useCallback(() => {
    commit((current) => applyScreenHitsPreset(current, "vanilla"), "Стандарт GTA");
    onNotice?.(tr("След как в игре: капля, цвет, прозрачность и время Rockstar"));
  }, [commit, onNotice]);

  /* --- Черновик и отмена --- */

  const projectRef = useRef(project);
  projectRef.current = project;
  const saveDraft = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeScreenHitsProject(projectRef.current));
    } catch {
      /* приватный режим браузера — сохранять некуда, редактор работает дальше */
    }
  }, []);
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
  const vanilla = screenHitsIsVanilla(project);
  const works = useWorkActions({
    kind: EDITOR,
    onNotice,
    linkedName: () => linkedEditorWork(EDITOR)?.name || "",
    defaultName: () => sourceName.current,
    onSave: async ({ name, asNew }) => {
      if (screenHitsIsVanilla(project)) throw new WorksStoreError("empty");
      const { work, created } = saveEditorWorkToWorks(EDITOR, serializeScreenHitsProject(project), { name, asNew });
      sourceName.current = "";
      return { name: work.name, created };
    },
    onCopy: () => screenHitsCode(project, { name: linkedEditorWork(EDITOR)?.name || sourceName.current }),
    /* Код ложится шагом истории: «Отменить» возвращает свой след. */
    onOpen: (result) => {
      const template = result.templates[0];
      history.commit(() => parseScreenHitsProject(template.state), null);
      sourceName.current = template.name;
      unlinkEditorWork(EDITOR);
    },
  });

  function resetEverything() {
    history.commit(() => createScreenHitsProject(), null);
    sourceName.current = "";
    unlinkEditorWork(EDITOR);
    onNotice?.(tr("Работа с начала: капля игры, прозрачнее штатной"));
  }

  /* --- В игру --- */

  const installSignature = useMemo(() => workSignature({ screenHits: screenHitsSignature(project) }), [project]);
  const applyButton = useWorkshopApplyButton(SCREEN_HITS_INSTALL_KEY, installSignature);
  const busy = applyButton.pending;
  const installable = screenHitsSupported();
  const restoresStock = vanilla && Boolean(installRecord.record);

  async function install() {
    if (!gameRoot || (vanilla && !installRecord.record)) return;
    const snapshot = restoresStock ? STOCK_SCREEN_HITS : normalizeScreenHitsProject(project);
    const state = serializeScreenHitsProject(snapshot);
    let pictureData = null;
    if (snapshot.shape === "own" && !snapshot.off) {
      pictureData = await screenHitPicturePng(snapshot.own.asset).catch(() => null);
      if (!pictureData) {
        onNotice?.(tr("Своей картинки следа нет на этом компьютере — выберите файл в «Картинке» заново"), "error");
        return;
      }
    }
    void applyWorkshopWork({
      key: SCREEN_HITS_INSTALL_KEY,
      signature: workSignature({ screenHits: screenHitsSignature(snapshot) }),
      title: snapshot.name || tr("Эффекты попадания на экране"),
      editor: tr("Эффекты попадания на экране"),
      coverSlotId: "screen-hits",
      coverState: state,
      steps: REPLACING_INSTALL_STEPS,
      notify: (text, tone) => onNotice?.(text, tone),
      savedText: restoresStock ? tr("Возвращаем след игры") : tr("Ставим след на экране в игру"),
      run: ({ report }) => installScreenHits({ project: snapshot, state, picture: pictureData, report }),
      doneText: ({ result }) => doneText(result),
    });
  }

  async function rollbackInstall() {
    if (busy || installRecord.rollingBack) return;
    try {
      await installRecord.rollback();
      onNotice?.(tr("След на экране возвращён к состоянию до установки"));
    } catch (error) {
      onNotice?.(`${sanitizeDesktopErrorMessage(error)} Можно вернуть след игры: «Стандарт GTA» в «Шаблонах» и «Применить».`, "error");
    }
  }

  const connectGame = useMemo(() => {
    if (gameRoot || !hasDesktopBridge()) return null;
    return async () => {
      try {
        const chosen = await chooseGameInstallation();
        const selected = chosen?.path || chosen?.gameRoot || "";
        if (selected) setGameRoot(selected);
      } catch (error) {
        setBaseFailure(humanFailure(error));
      }
    };
  }, [gameRoot]);


  /*
   * Строки состояния кадра — в панели редактора, не на картинке: откуда капля и что сейчас стоит в игре.
   */
  const dropLine = drop
    ? tr("Капля «Как в игре» — из вашей GTA V.")
    : baseLoading
      ? tr("Читаем каплю из вашей GTA V…")
      : baseFailure
        ? trFill("Каплю «Как в игре» кадр рисует своим очерком: игру прочитать не вышло ({0}).", baseFailure)
        : tr("Каплю «Как в игре» кадр рисует своим очерком — подключите GTA V, чтобы видеть каплю Rockstar.");
  const dropMissing = !drop && !baseLoading;
  const liveLine =
    base?.texture && base.texture.stock === false
      ? tr("Сейчас в игре стоит не капля Rockstar (своя прежняя или чужого мода); «Как в игре» вернёт штатную.")
      : "";
  const numbersLine = tr("Картинка, цвет, прозрачность низа и верха экрана, размер, разброс и время — те же числа, что уйдут в игру (visualsettings.dat, misc.DamageOverlay, и текстура dmg_overlay_fade).");

  const status = `${project.name || tr("Мой след на экране")} · ${describeScreenHits(project)}`;
  const applyTitle = !installable
    ? tr("След ставится только в Astral Desktop")
    : !gameRoot
      ? tr("GTA V Legacy пока не подключена")
      : vanilla
        ? installRecord.record
          ? tr("Вернуть игре её след: капля, цвет и время Rockstar")
          : tr("Это вид игры — ставить нечего")
        : applyButton.hint || tr("Поставить след в GTA V Legacy");

  /* Кадр GTA V от лица игрока, снятый стендом (docs/fx-scenes.md): есть — вместо 3D-сцены и стены («Плоский» его прячет); нет — прежняя сцена. */
  const viewName = view === "first" ? "first" : "third";
  const flatStage = (
    <ScreenHitsStage
      project={project}
      drop={drop}
      picture={picture}
      view={viewName}
      onView={setView}
      modeControl={modeControl}
    />
  );
  const stageNode =
    stageMode === "flat" ? (
      flatStage
    ) : (
      <FxScreenHitsFrameStage
        project={project}
        drop={drop}
        picture={picture}
        view={viewName}
        onView={setView}
        modeControl={modeControl}
        onStatus={onFrameStatus}
        fallback={
          stage3d ? (
            <CombatScreenHitsStage
              project={project}
              drop={drop}
              picture={picture}
              view={viewName}
              onView={setView}
              modeControl={modeControl}
              base={ptfx.base}
              baseLoading={ptfx.loading && !ptfx.base}
              gameRoot={gameRoot}
              onFailed={() => setStage3dFailed(true)}
            />
          ) : (
            flatStage
          )
        }
      />
    );

  return (
    <EditorShell
      className="fx-editor screen-hits-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Эффекты попадания на экране")}
      status={status}
      tools={TOOLS}
      tool={tool}
      onTool={setTool}
      guide={GUIDE}
      guideKey="screen-hits"
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
              ? [{ value: "rollback", label: installRecord.rollingBack ? tr("Возвращаем…") : tr("Снять из игры"), icon: <Trash />, disabled: busy || installRecord.rollingBack }]
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
                  disabled: (vanilla && !restoresStock) || !gameRoot || !installable,
                  busy: applyButton.busy,
                  meter: applyButton.meter,
                  onClick: () => void install(),
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
        <ScreenHitsInspector
          tool={tool}
          project={project}
          drop={drop}
          picture={picture}
          pictureBusy={pictureBusy}
          pictureError={pictureError}
          onPicture={onPicture}
          onChange={onChange}
          onPreset={onPreset}
          onStandard={onStandard}
        />
      }
    >
      {stageNode}
      <StageNote tone={dropMissing ? "warning" : undefined}>{dropLine}</StageNote>
      <StageNote>{liveLine}</StageNote>
      <StageNote>{numbersLine}</StageNote>
      {works.dialogs}
    </EditorShell>
  );
}
