/*
 * Метки и GPS (задача 9 ТЗ 10.10.2026): своя метка, свой цвет маршрута
 * сервера и точность маршрута.
 *
 * Что уходит в игру — снято в игре, а не угадано (`@modovik/minimap-contract/gps`):
 * цвет метки — строка `HUD_COLOUR_WAYPOINT` hudcolor.dat (ею игра красит и
 * значок, и линию к нему), значок — клетка листа значков minimap.ytd,
 * маршрут сервера — строки цветов значков, которыми сервер рисует GPS,
 * точность — флаги узлов дорог paths.rpf, как в файле владельца
 * (`@modovik/minimap-contract/paths`). Ставит главный процесс
 * (`gps-customizer.js`) одним патчем со своей точкой отката.
 *
 * Раскладка — мастерская «как в Photoshop»: метка, маршрут сервера,
 * точность и шаблоны — инструменты слева, справа — настройки взятого, кадр —
 * кусок карты из вашей игры с маршрутами по её узлам дорог. «Стандарт» — в
 * «Шаблонах».
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, MapPin, MapTrifold, Swatches, Target, Trash } from "../../../components/ui/icons.jsx";
import { GPS_ROUTE_COLOURS, GPS_DEFAULT_SERVER_ROUTE, gpsServerRoutesChanged } from "@modovik/minimap-contract/gps";
import { findGpsRoute } from "@modovik/minimap-contract/paths";
import {
  chooseGameInstallation,
  detectInstallations,
  gpsSupported,
  hasDesktopBridge,
  readGps,
  readGpsGraph,
  sanitizeDesktopErrorMessage,
} from "../../../api.js";
import Button from "../../../components/ui/Button.jsx";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { useSkyHistory } from "../../../components/desktop/workshop/useSkyHistory.js";
import { loadMinimapField } from "../../../components/desktop/workshop/hud-preview/hud-map-field.js";
import { fieldAligned } from "../../../components/desktop/workshop/blips/blips-scene.js";
import { StageNote } from "../../../components/ui/StageOverlay.jsx";
import useHistoryKeys from "../../../hooks/useHistoryKeys.js";
import { useRememberedState } from "../../../section-memory.js";
import { humanFailure } from "../../../utils/installFailure.js";
import { useInstallRecord } from "../useInstallRecord.js";
import { REPLACING_INSTALL_STEPS, applyWorkshopWork, useWorkshopApplyButton, workSignature } from "../install-queue/index.js";
import { GPS_INSTALL_KEY, STOCK_GPS_WORK, gpsSignature, installGps } from "../install-queue/tasks/gps.js";
import { WorksStoreError, linkedEditorWork, saveEditorWorkToWorks, unlinkEditorWork } from "../works/workshop-works.js";
import { gpsCode } from "../works/work-transfer.js";
import { useWorkActions } from "../works/useWorkActions.jsx";
import GpsInspector from "./GpsInspector.jsx";
import GpsStage from "./GpsStage.jsx";
import { gpsIconPicture, gpsIconPicturePng, importGpsIconPicture, loadStockIcon } from "./gps-icons.js";
import {
  GPS_DEFAULT_NAME,
  applyGpsPreset,
  applyGpsStandard,
  createGpsProject,
  describeGpsProject,
  gpsProjectIsStock,
  gpsWorkOf,
  normalizeGpsProject,
  parseGpsProject,
  serializeGpsProject,
} from "./gps-project.js";
import { GPS_DEFAULT_DESTINATION, GPS_SERVER_POINT, GPS_START, gpsDestination, gpsKilometres } from "./gps-scene.js";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

const STORAGE_KEY = "astral.gps.project.v1";
const EDITOR = "gps";
const GUIDE = Object.freeze([
  { keys: ["Ctrl", "Z"], text: "отменить" },
  { keys: ["Ctrl", "Y"], text: "повторить" },
]);
/* Подложка — плитки большой карты: тысячи точек на плитку хватает на путь от 1 до 10 км. */
const FIELD_TILE = 1024;

const TOOLS = Object.freeze([
  {
    id: "marker",
    label: "Метка",
    icon: <MapPin />,
    shortcut: "1",
    group: "look",
    note: "Цвет метки и её значок",
    hint: "Цвет метки — это и цвет линии к ней: игра красит их одной строкой",
  },
  {
    id: "server",
    label: "Маршрут сервера",
    icon: <MapTrifold />,
    shortcut: "2",
    group: "look",
    note: "Свой цвет GPS, который строит сервер",
    hint: "Отметьте цвет, которым сервер рисует маршрут, и выберите свой",
  },
  {
    id: "accuracy",
    label: "Точность",
    icon: <Target />,
    shortcut: "3",
    group: "look",
    note: "Маршрут как в игре или напрямую",
    hint: "Кадр показывает оба пути: пунктир — как в игре",
  },
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    shortcut: "4",
    group: "ready",
    note: "Готовые виды и «Стандарт»",
    hint: "Готовый вид — начало: дальше любой инструмент правит его",
  },
]);

function restoreProject() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? parseGpsProject(stored) : createGpsProject();
  } catch {
    return createGpsProject();
  }
}

const STOCK_DONE_TEXT = "Метка и GPS — снова как в игре";
function doneText(result) {
  if (gpsProjectIsStock(result?.work)) return STOCK_DONE_TEXT;
  return `Метка и GPS установлены: ${result?.summary || tr("своё")}. Перезапустите игру.`;
}

export default function GpsStudio({ onExit, onNotice }) {
  useTr();
  const [tool, setTool] = useRememberedState("gps:tool", "marker");
  const [destinationId, setDestinationId] = useRememberedState("gps:destination", GPS_DEFAULT_DESTINATION);
  const [customPoint, setCustomPoint] = useRememberedState("gps:custom-point", null);
  const history = useSkyHistory(restoreProject);
  const project = history.state;
  const installRecord = useInstallRecord(GPS_INSTALL_KEY);

  const commit = useCallback((update, label = null) => history.commit((current) => normalizeGpsProject(update(current)), label), [history]);
  const onMarker = useCallback((values, label) => commit((current) => ({ ...current, marker: { ...current.marker, ...values } }), label), [commit]);
  const onServer = useCallback((values, label) => commit((current) => ({ ...current, server: { ...current.server, ...values } }), label), [commit]);
  const onAccuracy = useCallback((accuracy) => commit((current) => ({ ...current, route: { ...current.route, accuracy } }), "Точность"), [commit]);

  /* --- Игра: цвета, значок, узлы дорог и карта --- */

  const [gameRoot, setGameRoot] = useState("");
  const [base, setBase] = useState(null);
  const [baseFailure, setBaseFailure] = useState("");
  const [baseLoading, setBaseLoading] = useState(false);
  const [stockImage, setStockImage] = useState(null);
  const [field, setField] = useState(null);
  /* Граф дорог — десятки тысяч узлов: он живёт в ссылке, а не в пропсах
     (React в разработке расписывает пропсы), наружу — только номер версии. */
  const graphRef = useRef(null);
  const [graphVersion, setGraphVersion] = useState(0);
  const [graphState, setGraphState] = useState("idle");

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
    let cancelled = false;
    let loaded = null;
    loadMinimapField({ tile: FIELD_TILE })
      .then((result) => {
        if (cancelled) result?.revoke?.();
        else {
          loaded = result;
          setField(result);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      loaded?.revoke?.();
    };
  }, []);

  useEffect(() => {
    if (!gameRoot) return undefined;
    let cancelled = false;
    setBaseLoading(true);
    readGps({ gameRoot })
      .then((result) => {
        if (cancelled) return;
        setBase(result || null);
        setBaseFailure(result ? "" : tr("главный процесс ещё не знает этого раздела — перезапустите Astral"));
      })
      .catch((error) => {
        if (!cancelled) setBaseFailure(sanitizeDesktopErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setBaseLoading(false);
      });
    setGraphState("loading");
    readGpsGraph({ gameRoot })
      .then((graph) => {
        if (cancelled) return;
        graphRef.current = graph?.nodes?.length ? graph.nodes : null;
        setGraphState(graphRef.current ? "ready" : "missing");
        setGraphVersion((value) => value + 1);
      })
      .catch(() => {
        if (!cancelled) setGraphState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [gameRoot]);

  useEffect(() => {
    let cancelled = false;
    loadStockIcon(base?.icon?.stockPng || null).then((image) => {
      if (!cancelled) setStockImage(image);
    });
    return () => {
      cancelled = true;
    };
  }, [base]);

  /* --- Маршруты кадра --- */

  const destination = useMemo(() => gpsDestination(destinationId, customPoint), [destinationId, customPoint]);
  const accuracy = project.route.accuracy;
  const routes = useMemo(() => {
    const nodes = graphRef.current;
    if (!nodes) return null;
    return {
      stock: findGpsRoute(nodes, GPS_START, destination, "stock"),
      direct: findGpsRoute(nodes, GPS_START, destination, "direct"),
      server: findGpsRoute(nodes, GPS_START, GPS_SERVER_POINT, accuracy),
    };
    // Граф — в ссылке: пересчёт по его версии.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphVersion, destination, accuracy]);
  const distances = routes ? { stock: routes.stock?.distance, direct: routes.direct?.distance } : null;

  const serverChanged = gpsServerRoutesChanged(project).length > 0;
  const serverStock = project.server.routes[0] || GPS_DEFAULT_SERVER_ROUTE;
  const serverColour = serverChanged
    ? project.server.color
    : base?.baseColours?.[serverStock] || GPS_ROUTE_COLOURS.find((item) => item.hud === serverStock)?.stock || "#f0c850";

  const onDestination = useCallback(
    (id) => {
      if (id === "custom" && !customPoint) {
        onNotice?.(tr("Щёлкните по карте — метка встанет туда"));
      }
      setDestinationId(id);
    },
    [customPoint, onNotice, setDestinationId],
  );
  const onPick = useCallback(
    (point) => {
      setCustomPoint({ x: Math.round(point.x), y: Math.round(point.y) });
      setDestinationId("custom");
    },
    [setCustomPoint, setDestinationId],
  );

  /* --- Своя картинка значка --- */

  const [picture, setPicture] = useState(null);
  const [pictureBusy, setPictureBusy] = useState(false);
  const [pictureError, setPictureError] = useState("");
  const pictureAsset = project.marker.assetId;

  useEffect(() => {
    let cancelled = false;
    if (!pictureAsset) {
      setPicture(null);
      return undefined;
    }
    gpsIconPicture(pictureAsset)
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
        const next = await importGpsIconPicture(file);
        setPicture(next);
        commit((current) => ({ ...current, marker: { ...current.marker, icon: "custom", assetId: next.asset } }), null);
        onNotice?.(`Свой значок метки: ${next.name}`);
      } catch (error) {
        setPictureError(humanFailure(error));
      } finally {
        setPictureBusy(false);
      }
    },
    [commit, onNotice],
  );

  /* --- Шаблоны и «Стандарт» --- */

  const onPreset = useCallback(
    (preset) => {
      commit((current) => applyGpsPreset(current, preset.id), null);
      unlinkEditorWork(EDITOR);
      onNotice?.(`Готовый вид: ${preset.label}`);
    },
    [commit, onNotice],
  );
  const onStandard = useCallback(() => {
    commit((current) => applyGpsStandard(current), "Стандарт");
    onNotice?.(tr("Метка и GPS как в игре: цвет, значок, маршруты и узлы дорог Rockstar"));
  }, [commit, onNotice]);

  /* --- Черновик и отмена --- */

  const projectRef = useRef(project);
  projectRef.current = project;
  const saveDraft = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeGpsProject(projectRef.current));
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
  const stock = gpsProjectIsStock(project);
  const works = useWorkActions({
    kind: EDITOR,
    onNotice,
    linkedName: () => linkedEditorWork(EDITOR)?.name || "",
    defaultName: () => sourceName.current,
    onSave: async ({ name, asNew }) => {
      if (gpsProjectIsStock(project)) throw new WorksStoreError("empty");
      const { work, created } = saveEditorWorkToWorks(EDITOR, serializeGpsProject(project), { name, asNew });
      sourceName.current = "";
      return { name: work.name, created };
    },
    onCopy: () => gpsCode(project, { name: linkedEditorWork(EDITOR)?.name || sourceName.current }),
    /* Код ложится шагом истории: «Отменить» возвращает свою метку. */
    onOpen: (result) => {
      const template = result.templates[0];
      history.commit(() => parseGpsProject(template.state), null);
      sourceName.current = template.name;
      unlinkEditorWork(EDITOR);
    },
  });

  function resetEverything() {
    history.commit(() => createGpsProject(), null);
    sourceName.current = "";
    unlinkEditorWork(EDITOR);
    onNotice?.(tr("Работа с начала: метка и GPS как в игре"));
  }

  /* --- В игру --- */

  const installSignature = useMemo(() => workSignature({ gps: gpsSignature(gpsWorkOf(project)) }), [project]);
  const applyButton = useWorkshopApplyButton(GPS_INSTALL_KEY, installSignature);
  const busy = applyButton.pending;
  const installable = gpsSupported();
  const restoresStock = stock && Boolean(installRecord.record);

  async function install() {
    if (!gameRoot || (stock && !installRecord.record)) return;
    const snapshot = restoresStock ? normalizeGpsProject({ ...STOCK_GPS_WORK, name: project.name }) : normalizeGpsProject(project);
    const state = serializeGpsProject(snapshot);
    const work = gpsWorkOf(snapshot);
    let pictureData = null;
    if (work.marker.icon === "custom") {
      pictureData = await gpsIconPicturePng(work.marker.assetId).catch(() => null);
      if (!pictureData) {
        onNotice?.(tr("Своей картинки значка нет на этом компьютере — выберите файл в «Метке» заново"), "error");
        return;
      }
    }
    void applyWorkshopWork({
      key: GPS_INSTALL_KEY,
      signature: workSignature({ gps: gpsSignature(work) }),
      title: snapshot.name || tr("Метки и GPS"),
      editor: tr("Метки и GPS"),
      coverSlotId: "blips",
      coverState: state,
      steps: REPLACING_INSTALL_STEPS,
      notify: (text, tone) => onNotice?.(text, tone),
      savedText: restoresStock ? tr("Возвращаем метку и GPS игры") : tr("Ставим метку и GPS в игру"),
      run: ({ report }) => installGps({ work, state, picture: pictureData, report }),
      doneText: ({ result }) => doneText(result),
    });
  }

  async function rollbackInstall() {
    if (busy || installRecord.rollingBack) return;
    try {
      await installRecord.rollback();
      onNotice?.(tr("Метка и GPS возвращены к состоянию до установки"));
    } catch (error) {
      onNotice?.(`${sanitizeDesktopErrorMessage(error)} Можно вернуть игре её вид: «Стандарт» в «Шаблонах» и «Применить».`, "error");
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
   * Строки состояния кадра — в панели редактора, не на картинке: карта и дороги из игры или не прочитаны, откуда значок метки,
   * куда ведёт маршрут сервера.
   */
  const aligned = fieldAligned(field);
  const mapLine = aligned
    ? tr("Карта — плитки из вашей GTA V.")
    : field?.reason
      ? trFill("Карта игры здесь не прочитана — под линиями тёмная подложка ({0}).", field.reason)
      : tr("Карта игры здесь не прочитана — под линиями тёмная подложка.");
  const routeLine =
    graphState === "ready"
      ? trFill(
          "Маршруты Astral считает по узлам дорог вашей игры. Сейчас до «{0}»: как в игре {1}, напрямую {2}.",
          tr(destination.label),
          gpsKilometres(distances?.stock),
          gpsKilometres(distances?.direct),
        )
      : graphState === "loading"
        ? tr("Читаем узлы дорог вашей игры — пока линии по прямой.")
        : tr("Линии — по прямой: узлов дорог без вашей игры нет.");
  const iconUnread = project.marker.icon === "stock" && !stockImage && !baseLoading;
  const iconLine =
    project.marker.icon === "stock"
      ? stockImage
        ? tr("Значок метки — из вашей игры, в цвете метки.")
        : baseLoading
          ? tr("Читаем значок метки из вашей игры…")
          : baseFailure
            ? trFill("Значок метки из вашей игры не прочитан ({0}).", baseFailure)
            : tr("Значок метки из вашей игры не прочитан.")
      : tr("Значок метки — тот силуэт, что уйдёт в игру, в цвете метки.");
  const serverLine = trFill("Маршрут сервера ведёт к «{0}» — так рисуется GPS сервера отмеченного цвета.", tr(GPS_SERVER_POINT.label));

  const status = `${project.name || GPS_DEFAULT_NAME} · ${describeGpsProject(project)}`;
  const applyTitle = !installable
    ? tr("Метки и GPS ставятся только в Astral Desktop")
    : !gameRoot
      ? tr("GTA V Legacy пока не подключена")
      : stock
        ? installRecord.record
          ? tr("Вернуть игре её метку и GPS")
          : tr("Это вид игры — ставить нечего")
        : applyButton.hint || tr("Поставить метку и GPS в GTA V Legacy");

  return (
    <EditorShell
      className="fx-editor gps-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Метки и GPS")}
      status={status}
      tools={TOOLS}
      tool={tool}
      onTool={setTool}
      guide={GUIDE}
      guideKey="gps"
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
        <GpsInspector
          tool={tool}
          project={project}
          baseColours={base?.baseColours || null}
          distances={distances}
          stockImage={stockImage}
          picture={picture}
          pictureBusy={pictureBusy}
          pictureError={pictureError}
          onPicture={onPicture}
          onMarker={onMarker}
          onServer={onServer}
          onAccuracy={onAccuracy}
          onPreset={onPreset}
          onStandard={onStandard}
        />
      }
    >
      <GpsStage
        project={project}
        field={field}
        routes={routes}
        destination={destination}
        destinationId={destination.id}
        onDestination={onDestination}
        onPick={onPick}
        serverColour={serverColour}
        stockImage={stockImage}
        picture={picture}
      />
      <StageNote tone={aligned ? undefined : "warning"}>{mapLine}</StageNote>
      <StageNote tone={graphState === "ready" || graphState === "loading" ? undefined : "warning"}>{routeLine}</StageNote>
      <StageNote tone={iconUnread ? "warning" : undefined}>{iconLine}</StageNote>
      <StageNote>{serverLine}</StageNote>
      {works.dialogs}
    </EditorShell>
  );
}
