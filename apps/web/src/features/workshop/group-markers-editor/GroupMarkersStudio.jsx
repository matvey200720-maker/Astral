/*
 * Групповые метки (задача 21 ТЗ 18.10.2026, вечер): свой цвет, своя картинка или «убрать» для меток,
 * которые рисует сама игра, — листов `commonmenu`, `mpinventory`, `mpmissmarkers` и других в
 * `x64/textures/script_txds.rpf` у `update.rpf`.
 *
 * Что за метки и почему именно эти — `@modovik/minimap-contract/group-markers`: метку группы на
 * проектах сервер чаще всего рисует сам, своей картинкой, — файлом игры она не меняется; здесь
 * меняется то, что рисуется листами игры. Ставит главный процесс (`group-markers-customizer.js`)
 * одним патчем со своей точкой отката.
 *
 * Раскладка — мастерская «как в Photoshop»: метки и шаблоны — инструменты слева, справа — настройки
 * взятого, кадр — метка над куском улицы из вашей игры с подписью расстояния.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, MapPin, Swatches, Trash } from "../../../components/ui/icons.jsx";
import { changedGroupMarkers, groupMarkerFinishOf, groupMarkersWorkIsStock } from "@modovik/minimap-contract/group-markers";
import {
  chooseGameInstallation,
  detectInstallations,
  groupMarkersSupported,
  hasDesktopBridge,
  readGroupMarkers,
  sanitizeDesktopErrorMessage,
} from "../../../api.js";
import Button from "../../../components/ui/Button.jsx";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { useSkyHistory } from "../../../components/desktop/workshop/useSkyHistory.js";
import useHistoryKeys from "../../../hooks/useHistoryKeys.js";
import { useRememberedState } from "../../../section-memory.js";
import { humanFailure } from "../../../utils/installFailure.js";
import { useInstallRecord } from "../useInstallRecord.js";
import { REPLACING_INSTALL_STEPS, applyWorkshopWork, useWorkshopApplyButton, workSignature } from "../install-queue/index.js";
import { GROUP_MARKERS_INSTALL_KEY, STOCK_GROUP_MARKERS_WORK, groupMarkersInstallSignature, installGroupMarkers } from "../install-queue/tasks/group-markers.js";
import { WorksStoreError, linkedEditorWork, saveEditorWorkToWorks, unlinkEditorWork } from "../works/workshop-works.js";
import { groupMarkersCode } from "../works/work-transfer.js";
import { useWorkActions } from "../works/useWorkActions.jsx";
import GroupMarkersInspector from "./GroupMarkersInspector.jsx";
import GroupMarkersStage from "./GroupMarkersStage.jsx";
import { composeMark, loadPngImage } from "./group-markers-art.js";
import { GROUP_MARKER_DEFAULT_DISTANCE, GROUP_MARKER_STREET } from "./group-markers-view.js";
import { groupMarkerFrames, groupMarkerPicture, groupMarkerPicturesFor, importGroupMarkerPicture, renderGroupMarkerText } from "./group-markers-pictures.js";
import {
  EDITOR_GROUP_MARKERS,
  GROUP_MARKERS_DEFAULT_NAME,
  GROUP_MARKERS_STORAGE_KEY,
  applyGroupMarkersPreset,
  applyGroupMarkersStandard,
  createGroupMarkersProject,
  groupMarkersProjectIsStock,
  groupMarkersWorkOf,
  normalizeGroupMarkersProject,
  parseGroupMarkersProject,
  serializeGroupMarkersProject,
  withGroupMarkerEdit,
} from "./group-markers-project.js";
import { largestStockPng, rememberGroupMarkerStock } from "./group-markers-stock.js";
import { inGameLine, installedText, markCountText } from "./group-markers-text.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";

const EDITOR = "group-markers";
const GUIDE = Object.freeze([
  { keys: ["Ctrl", "Z"], text: "отменить" },
  { keys: ["Ctrl", "Y"], text: "повторить" },
]);
const TILE_EDGE = 64;

const TOOLS = Object.freeze([
  {
    id: "marks",
    label: "Метки",
    icon: <MapPin />,
    shortcut: "1",
    group: "look",
    hint: "Выберите метку, потом — как она выглядит: цвет, картинка, надпись или убрать; размер, обводка и прозрачность — ниже",
  },
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    shortcut: "2",
    group: "ready",
    hint: "Готовый вид — начало: дальше «Метки» правят любую",
  },
]);

function restoreProject() {
  try {
    const stored = window.localStorage.getItem(GROUP_MARKERS_STORAGE_KEY);
    return stored ? parseGroupMarkersProject(stored) : createGroupMarkersProject();
  } catch {
    return createGroupMarkersProject();
  }
}

export default function GroupMarkersStudio({ onExit, onNotice }) {
  useTr();
  const language = useUiLanguage();
  const [tool, setTool] = useRememberedState("group-markers:tool", "marks");
  const [markId, setMarkId] = useRememberedState("group-markers:mark", "warning");
  const [distance, setDistance] = useRememberedState("group-markers:distance", GROUP_MARKER_DEFAULT_DISTANCE);
  const history = useSkyHistory(restoreProject);
  const project = history.state;
  const installRecord = useInstallRecord(GROUP_MARKERS_INSTALL_KEY);
  const mark = EDITOR_GROUP_MARKERS.find((item) => item.id === markId) || EDITOR_GROUP_MARKERS[0];

  const commit = useCallback((update, label = null) => history.commit((current) => normalizeGroupMarkersProject(update(current)), label), [history]);
  const onEdit = useCallback((id, edit, label) => commit((current) => withGroupMarkerEdit(current, id, edit), label), [commit]);

  /* --- Игра: листы меток --- */

  const [gameRoot, setGameRoot] = useState("");
  const [state, setState] = useState(null);
  const [failure, setFailure] = useState("");
  const [stockImages, setStockImages] = useState(() => new Map());
  /* Габарит штатной накладки радара в точках экрана — пропорции её рисунка (из чтения игры). */
  const overlayBoxes = useMemo(() => new Map((state?.marks || []).filter((entry) => entry.overlay?.box).map((entry) => [entry.id, entry.overlay.box])), [state]);

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
    readGroupMarkers({ gameRoot })
      .then((result) => {
        if (cancelled) return;
        setState(result || null);
        /* Обложка полки рисуется без игры: листы запоминаются окном. */
        rememberGroupMarkerStock(result);
        setFailure(result ? "" : tr("главный процесс ещё не знает этого раздела — перезапустите Astral"));
      })
      .catch((error) => {
        if (!cancelled) setFailure(sanitizeDesktopErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [gameRoot]);

  useEffect(() => {
    let cancelled = false;
    const wanted = (state?.marks || []).map((entry) => [entry.id, largestStockPng(entry)]).filter(([, png]) => png);
    Promise.all(wanted.map(async ([id, png]) => [id, await loadPngImage(png)])).then((loaded) => {
      if (!cancelled) setStockImages(new Map(loaded.filter(([, image]) => image)));
    });
    return () => {
      cancelled = true;
    };
  }, [state]);

  const gameFound = Boolean(state?.available && stockImages.size);

  /* --- Свои картинки --- */

  const [pictures, setPictures] = useState(() => new Map());
  const [pictureBusy, setPictureBusy] = useState(false);
  const [pictureError, setPictureError] = useState("");
  /* Картинки работы: первый кадр и — у гифки накладки радара — кадры из ленты. */
  const assetKey = useMemo(
    () =>
      Object.values(project.marks)
        .map((edit) => [edit.asset || "", edit.strip || "", edit.frames || 0].join(":"))
        .filter((item) => !item.startsWith(":"))
        .sort()
        .join(","),
    [project],
  );

  useEffect(() => {
    let cancelled = false;
    const wanted = assetKey ? assetKey.split(",").map((item) => item.split(":")) : [];
    Promise.all(
      wanted.map(async ([asset, strip, count]) => {
        const picture = await groupMarkerPicture(asset).catch(() => null);
        if (!picture) return [asset, null];
        const frames = strip ? await groupMarkerFrames(strip, Number(count)).catch(() => null) : null;
        return [asset, frames ? { ...picture, frames } : picture];
      }),
    ).then((loaded) => {
      if (!cancelled) setPictures((current) => new Map([...current, ...loaded.filter(([, picture]) => picture)]));
    });
    return () => {
      cancelled = true;
    };
  }, [assetKey]);

  const onPicture = useCallback(
    async (id, file) => {
      setPictureBusy(true);
      setPictureError("");
      try {
        const next = await importGroupMarkerPicture(file);
        setPictures((current) => new Map(current).set(next.asset, next));
        commit(
          (current) =>
            withGroupMarkerEdit(current, id, {
              mode: "image",
              asset: next.asset,
              name: next.name,
              animated: next.animated,
              ...(next.strip ? { strip: next.strip, frames: next.frames.length, delays: next.delays } : {}),
            }),
          null,
        );
        onNotice?.(`${tr("Своя картинка метки")}: ${next.name}`);
      } catch (error) {
        setPictureError(humanFailure(error));
      } finally {
        setPictureBusy(false);
      }
    },
    [commit, onNotice],
  );

  /* --- Надпись вместо метки: окно рисует её PNG-ом, установщик получает её как свою картинку --- */

  const textRuns = useRef(new Map());
  const onText = useCallback(
    async (id, spec, auto = false) => {
      const run = (textRuns.current.get(id) || 0) + 1;
      textRuns.current.set(id, run);
      setPictureError("");
      try {
        const next = await renderGroupMarkerText(spec);
        if (textRuns.current.get(id) !== run) return;
        setPictures((current) => new Map(current).set(next.asset, next));
        const update = (current) => {
          const own = current.marks[id];
          /* Достройка без человека не должна перебивать то, что он успел сделать, пока надпись рисовалась. */
          if (auto && !(own?.mode === "text" && own.text === spec.text && !own.asset)) return current;
          return withGroupMarkerEdit(current, id, { ...groupMarkerFinishOf(own), mode: "text", text: spec.text, font: spec.font, ...(spec.fontAsset ? { fontAsset: spec.fontAsset, fontName: spec.fontName } : {}), color: spec.color, asset: next.asset });
        };
        if (auto) history.amend((current) => normalizeGroupMarkersProject(update(current)));
        else commit(update, "Надпись метки");
      } catch (error) {
        if (textRuns.current.get(id) === run) setPictureError(humanFailure(error));
      }
    },
    [commit, history],
  );
  /* Надпись, пришедшая кодом работы, ещё без картинки: дорисовываем её на открытии, а не молча теряем. */
  const textInflight = useRef(new Set());
  useEffect(() => {
    for (const [id, entry] of Object.entries(project.marks)) {
      if (entry.mode !== "text" || entry.asset) continue;
      const key = `${id}|${entry.text}|${entry.font}|${entry.fontAsset || ""}|${entry.color}`;
      if (textInflight.current.has(key)) continue;
      textInflight.current.add(key);
      void onText(id, { text: entry.text, font: entry.font, color: entry.color, fontAsset: entry.fontAsset, fontName: entry.fontName }, true).finally(() => textInflight.current.delete(key));
    }
  }, [project, onText]);

  const edit = project.marks[mark.id] || null;
  const picture = edit?.asset ? pictures.get(edit.asset) || null : null;

  /*
   * Картинки карточек: каждая метка в облике правки. Ползунок правит одну метку, а пересобирались и
   * кодировались в PNG все карточки разом — на каждый шаг (19.10.2026, лаг правки): картинка метки
   * теперь пересобирается, только когда поменялась её правка, лист или картинка.
   */
  const previewCache = useRef(new Map());
  const previews = useMemo(() => {
    const out = new Map();
    for (const item of EDITOR_GROUP_MARKERS) {
      const own = project.marks[item.id] || null;
      const stockImage = stockImages.get(item.id) || null;
      const picture = own?.asset ? pictures.get(own.asset) || null : null;
      const box = overlayBoxes.get(item.id) || null;
      const key = JSON.stringify(own);
      const known = previewCache.current.get(item.id);
      let url = "";
      if (known && known.key === key && known.stockImage === stockImage && known.picture === picture && known.box === box) url = known.url;
      else {
        const composed = composeMark({ mark: item, edit: own, stockImage, picture, edge: TILE_EDGE, box });
        try {
          /* Штатная метка без листа игры — нарисованное кольцо, одно на все: строке значка нет. */
          url = composed.canvas && !(composed.drawn && !own) ? composed.canvas.toDataURL("image/png") : "";
        } catch {
          url = "";
        }
        previewCache.current.set(item.id, { key, stockImage, picture, box, url });
      }
      if (url) out.set(item.id, url);
    }
    return out;
  }, [project, stockImages, pictures, overlayBoxes]);

  const markOptions = EDITOR_GROUP_MARKERS.map((item) => [item.id, tr(item.label)]);

  /* --- Шаблоны и «Как в игре» --- */

  const onPreset = useCallback(
    (preset) => {
      commit((current) => applyGroupMarkersPreset(current, preset.id), null);
      unlinkEditorWork(EDITOR);
      onNotice?.(`${tr("Готовый вид")}: ${tr(preset.label)}`);
    },
    [commit, onNotice],
  );
  const onStandard = useCallback(() => {
    commit((current) => applyGroupMarkersStandard(current), "Как в игре");
    onNotice?.(tr("Групповые метки как в игре: листы Rockstar"));
  }, [commit, onNotice]);

  /* --- Черновик и отмена --- */

  const projectRef = useRef(project);
  projectRef.current = project;
  const saveDraft = useCallback(() => {
    try {
      window.localStorage.setItem(GROUP_MARKERS_STORAGE_KEY, serializeGroupMarkersProject(projectRef.current));
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
  const stock = groupMarkersProjectIsStock(project);
  const works = useWorkActions({
    kind: EDITOR,
    onNotice,
    linkedName: () => linkedEditorWork(EDITOR)?.name || "",
    defaultName: () => sourceName.current,
    onSave: async ({ name, asNew }) => {
      if (groupMarkersProjectIsStock(project)) throw new WorksStoreError("empty");
      const { work, created } = saveEditorWorkToWorks(EDITOR, serializeGroupMarkersProject(project), { name, asNew });
      sourceName.current = "";
      return { name: work.name, created };
    },
    onCopy: () => groupMarkersCode(project, { name: linkedEditorWork(EDITOR)?.name || sourceName.current }),
    /* Код ложится шагом истории: «Отменить» возвращает свои метки. */
    onOpen: (result) => {
      const template = result.templates[0];
      history.commit(() => parseGroupMarkersProject(template.state), null);
      sourceName.current = template.name;
      unlinkEditorWork(EDITOR);
    },
  });

  function resetEverything() {
    history.commit(() => createGroupMarkersProject(), null);
    sourceName.current = "";
    unlinkEditorWork(EDITOR);
    onNotice?.(tr("Работа с начала: групповые метки как в игре"));
  }

  /* --- В игру --- */

  const installSignature = useMemo(() => workSignature({ groupMarkers: groupMarkersInstallSignature(groupMarkersWorkOf(project)) }), [project]);
  const applyButton = useWorkshopApplyButton(GROUP_MARKERS_INSTALL_KEY, installSignature);
  const busy = applyButton.pending;
  const installable = groupMarkersSupported();
  const restoresStock = stock && Boolean(installRecord.record);
  const changedCount = changedGroupMarkers(groupMarkersWorkOf(project)).length;

  async function install() {
    if (!gameRoot || (stock && !installRecord.record)) return;
    const snapshot = restoresStock ? normalizeGroupMarkersProject({ ...STOCK_GROUP_MARKERS_WORK, name: project.name }) : normalizeGroupMarkersProject(project);
    const work = groupMarkersWorkOf(snapshot);
    const saved = serializeGroupMarkersProject(snapshot);
    if (Object.values(work.marks).some((entry) => entry.mode === "text" && !entry.asset)) {
      onNotice?.(tr("Надпись ещё рисуется — подождите секунду и примените снова"), "error");
      return;
    }
    const { pictures: pictureData, missing } = await groupMarkerPicturesFor(work);
    if (missing.length) {
      onNotice?.(tr("Своей картинки метки нет на этом компьютере — выберите файл в «Метках» заново"), "error");
      return;
    }
    let previous = null;
    try {
      previous = installRecord.record?.installedState ? groupMarkersWorkOf(parseGroupMarkersProject(installRecord.record.installedState)) : null;
    } catch {
      previous = null;
    }
    const count = changedGroupMarkers(work).length;
    void applyWorkshopWork({
      key: GROUP_MARKERS_INSTALL_KEY,
      signature: workSignature({ groupMarkers: groupMarkersInstallSignature(work) }),
      title: snapshot.name || tr("Групповые метки"),
      editor: tr("Групповые метки"),
      coverSlotId: "group-markers",
      coverState: saved,
      steps: REPLACING_INSTALL_STEPS,
      notify: (text, tone) => onNotice?.(text, tone),
      savedText: restoresStock ? tr("Возвращаем метки игры") : tr("Ставим групповые метки в игру"),
      run: ({ report }) => installGroupMarkers({ work, state: saved, previous, pictures: pictureData, report }),
      doneText: () => (groupMarkersWorkIsStock(work) ? tr("Групповые метки — снова как в игре") : installedText(language, count)),
    });
  }

  async function rollbackInstall() {
    if (busy || installRecord.rollingBack) return;
    try {
      await installRecord.rollback();
      onNotice?.(tr("Групповые метки возвращены к состоянию до установки"));
    } catch (error) {
      onNotice?.(`${sanitizeDesktopErrorMessage(error)} ${tr("Можно вернуть игре её метки: «Как в игре» в «Шаблонах» и «Применить».")}`, "error");
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
        setFailure(humanFailure(error));
      }
    };
  }, [gameRoot]);

  const status = `${project.name || tr(GROUP_MARKERS_DEFAULT_NAME)} · ${markCountText(language, changedCount)}`;
  const applyTitle = !installable
    ? tr("Групповые метки ставятся только в Astral Desktop")
    : !gameRoot
      ? tr("GTA V Legacy пока не подключена")
      : stock
        ? installRecord.record
          ? tr("Вернуть игре её метки")
          : tr("Это вид игры — ставить нечего")
        : applyButton.hint || tr("Поставить групповые метки в GTA V Legacy");

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor group-markers-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Групповые метки")}
      status={status}
      tools={TOOLS}
      tool={tool}
      onTool={setTool}
      guide={GUIDE}
      guideKey="group-markers"
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
                  disabled: (stock && !restoresStock) || !gameRoot || !installable,
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
        <GroupMarkersInspector
          tool={tool}
          project={project}
          markId={mark.id}
          previews={previews}
          picture={picture}
          pictureBusy={pictureBusy}
          pictureError={pictureError}
          animated={edit?.animated === true}
          gameFound={gameFound}
          failure={failure}
          onSelect={setMarkId}
          onEdit={onEdit}
          onPicture={onPicture}
          onText={onText}
          onPreset={onPreset}
          onStandard={onStandard}
        />
      }
    >
      <GroupMarkersStage
        marks={markOptions}
        markId={mark.id}
        onMark={setMarkId}
        edit={edit}
        stockImage={stockImages.get(mark.id) || null}
        picture={picture}
        overlayBox={overlayBoxes.get(mark.id) || null}
        distance={Number(distance) || GROUP_MARKER_DEFAULT_DISTANCE}
        onDistance={(value) => setDistance(Number(value))}
        gameFound={gameFound}
        sceneUrl={GROUP_MARKER_STREET.url}
        stock={stock}
        inGameText={inGameLine(language, changedCount)}
      />
      {works.dialogs}
    </EditorShell>
  );
}
