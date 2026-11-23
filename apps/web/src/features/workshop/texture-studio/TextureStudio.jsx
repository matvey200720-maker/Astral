/*
 * Студия текстур (ТЗ 18.10.2026, Session 1, задача 6): окно «как в
 * Photoshop» для картинки поверхности — слева рейка инструментов (V, M, L,
 * W, B, E, G, S, J, O, R, I, T, U, H, Z), сверху строка настроек инструмента,
 * справа настройки инструмента, внизу — «Слои» и «История», в шапке «Экспорт
 * PNG» и «Поставить на …», а в плавающем окне — живой 3D-вид объекта с этой
 * текстурой. Одно окно на все редакторы мастерской: каждый открывает его со
 * своей поверхностью (`surface`) и забирает итог (`onPlace`).
 *
 * Основа холста — текущая текстура поверхности из игры игрока (не пустой
 * лист): `surface.base()` отдаёт картинку, студия кладёт её слоем «Основа».
 * Документ слоёв сохраняется вместе с работой (`studio-store.js`) — повторное
 * открытие продолжает со слоями.
 *
 *   surface = {
 *     id,                 // ключ хранения документа: «редактор:поверхность»
 *     title,              // «Мегамолл · Главный фасад»
 *     width, height,      // холст, px (≤ 8192 по стороне)
 *     base?: () => Promise<ImageBitmap | canvas | null>,  // текстура из игры
 *     baseColour?,        // если основы из игры нет
 *     baseLabel?,         // чем названа основа из игры (по умолчанию — «лист вашей GTA V»)
 *     current?: { asset } | null,   // картинка, что уже стоит на поверхности
 *     placeLabel,         // «Поставить на стену»
 *     region?: [u0, v0, u1, v1] | () => Promise<[u0, v0, u1, v1] | null>,  // область листа, что занимает выбранная поверхность (доли листа, `v` вниз): студия открывается на ней
 *     wall?: object | null,   // стена, по которой щёлкнули в кадре (`wall-face.js`): вид «стена» — стена в метрах, лист на ней повторён плиткой
 *     plate?: { surface, onPlace } | null,   // своя картинка только этой стене (3В): холст — сама стена в плоскости; окно открывается на нём, а «Эта стена на листе» и «Весь лист» — прежний вид
 *     panels?: { count, metres: [w, h] } | null,   // разметка панелей
 *     view3d?: { scene, frame, parts?, lookFor(texture) }      // кадр с текстурой холста; или
 *            | { live(preview, { refresh }) }                   // облик собирает редактор (банкомат, баннер на здании); или
 *            | { asset, stage(version), reloads }               // кадр самого редактора с живой картинкой (`StudioLive.jsx`)
 *            | null,
 *   }
 *   onPlace(blob, { width, height }) → Promise<{ asset }>  // итог на поверхность
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
/* Стили студии едут вместе с её куском сборки (он грузится по нажатию «Студия»), а не в общем листе: тот упирается в потолок. */
import "./texture-studio.css";
import { createPortal } from "react-dom";
import {
  ArrowUUpLeft,
  ArrowUUpRight,
  ArrowsOutCardinal,
  Bandaids,
  DownloadSimple,
  Eraser,
  Eyedropper,
  FloppyDisk,
  FolderOpen,
  HandGrabbing,
  ImageSquare,
  Keyboard,
  Lasso,
  MagicWand,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  PaintBrush,
  PaintBucket,
  Selection,
  Shapes,
  Stamp,
  Sun,
  Drop,
  TextT,
} from "../../../components/ui/icons.jsx";
import { layerOf, documentAssets } from "./engine/document.js";
import { panelCount, panelLayout, wallCanvasSize } from "./engine/panels.js";
import { regionRect } from "./uv-region.js";
import { wallRegion, wallSpace } from "./wall-view.js";
import { SHORTCUTS, TOOLS, nextKind, resolveKey, toolOf } from "./engine/tools.js";
import { useRailGroups } from "../../../components/ui/useRailGroups.jsx";
import { zoomText } from "./engine/view.js";
import { DEFAULT_OPTIONS, effectiveOptions, patchOptions } from "./studio-options.js";
import { createSession } from "./session.js";
import { createToolController } from "./tool-controller.js";
import { loadStudioDocument, saveStudioDocument } from "./studio-store.js";
import { packStudioFile, studioFileName, unpackStudioFile, STUDIO_FILE_EXTENSION } from "./studio-file.js";
import StudioFloat3D from "./StudioFloat3D.jsx";
import StudioInspector from "./StudioInspector.jsx";
import { HistoryPanel, LayersPanel } from "./StudioPanels.jsx";
import StudioViewport from "./StudioViewport.jsx";
import StudioDock from "./StudioDock.jsx";
import Button from "../../../components/ui/Button.jsx";
import Dialog from "../../../components/ui/Dialog.jsx";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import ShortcutsDialog from "../../../components/ui/ShortcutsDialog.jsx";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { FINISH_IMAGE_ACCEPT, saveFinishImage } from "../finish/finish-assets.js";
import { hotkey, isTextEntry } from "../../../utils/hotkeys.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";

const TOOL_ICONS = {
  move: <ArrowsOutCardinal />,
  marquee: <Selection />,
  lasso: <Lasso />,
  wand: <MagicWand />,
  brush: <PaintBrush />,
  eraser: <Eraser />,
  fill: <PaintBucket />,
  stamp: <Stamp />,
  heal: <Bandaids />,
  tone: <Sun />,
  soften: <Drop />,
  picker: <Eyedropper />,
  text: <TextT />,
  shape: <Shapes />,
  hand: <HandGrabbing />,
  zoom: <MagnifyingGlassPlus />,
};

const GROUP_LABELS = { view: 0, select: 1, paint: 2, retouch: 3, object: 4 };

/*
 * Подзаголовок инструмента в шапке панели — три-четыре слова (ТЗ владельца 29.10.2026, п. 3.1: пояснения абзацами под
 * заголовком — мусор). Полное «что делает» осталось подсказкой значка на рейке и в строке инструментов.
 */
const TOOL_SUBTITLES = Object.freeze({
  move: "Двигает слой целиком",
  marquee: "Прямоугольник или овал",
  lasso: "Область от руки",
  wand: "Область по цвету",
  brush: "Рисует цветом",
  eraser: "Стирает до прозрачного",
  fill: "Ведро и градиент",
  stamp: "Копирует кусок холста",
  heal: "Штамп с подгонкой цвета",
  tone: "Светлее или темнее",
  soften: "Размытие, резкость, палец",
  picker: "Берёт цвет с холста",
  text: "Надпись отдельным слоем",
  shape: "Линия, стрелка, фигура",
  hand: "Двигает холст",
  zoom: "Ближе и дальше",
});

/*
 * Колонка по группам (ТЗ 22.10.2026, п. B; решение лида: буквы и действия — полностью прежние): шестнадцать значков — пять.
 * «Перемещение» (перемещение, рука, масштаб), «Выделение» (область, лассо, палочка), «Краска» (кисть, ластик, заливка,
 * пипетка), «Ретушь» (штамп, восстанавливающая кисть, осветлитель, размытие), «Объекты» (текст, фигуры). Буква инструмента
 * открывает его группу и его самого (клавиши — таблица `engine/tools.js`, их разбирает сама студия), Shift + буква листает
 * виды; значок группы возвращает к последнему пункту. Своё меню у пунктов — переключатель над панелью.
 */
const TEXTURE_RAIL = Object.freeze([
  { id: "navigate", ids: ["move", "hand", "zoom"], group: "0" },
  { id: "selection", ids: ["marquee", "lasso", "wand"], label: "Выделение", group: "1" },
  { id: "ink", ids: ["brush", "eraser", "fill", "picker"], label: "Краска", group: "2" },
  { id: "retouch", ids: ["stamp", "heal", "tone", "soften"], label: "Ретушь", group: "3" },
  { id: "objects", ids: ["text", "shape"], label: "Объекты", group: "4" },
]);

/* Что умеет вид «стена» (3Б ТЗ 18.10.2026): точечные инструменты, что переводятся в лист мышью, — выделения, перенос и фигуры живут в листе. */
const WALL_TOOLS = new Set(["brush", "eraser", "fill", "text", "picker", "hand", "zoom"]);

function overlayHost() {
  if (typeof document === "undefined") return null;
  return document.querySelector("[data-desktop-overlay-host]") || document.querySelector(".desktop-app") || document.body;
}

/* Окно «Все клавиши» из таблицы клавиш и инструментов: клавиша, которой нет в окне, человек не найдёт. */
function shortcutGroups() {
  const names = { history: "История", select: "Выделение", layers: "Слои", file: "Файл", view: "Вид", paint: "Кисть", edit: "Правка", help: "Справка" };
  const groups = new Map();
  for (const shortcut of SHORTCUTS) {
    const label = tr(names[shortcut.group] || shortcut.group);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push({ keys: shortcut.keys.split(" / ")[0].split(" + "), label: tr(shortcut.label) });
  }
  const tools = TOOLS.map((tool) => ({ keys: [tool.key.toUpperCase()], label: tr(tool.label) }));
  return [{ group: tr("Инструменты (Shift + буква — следующий вид)"), items: tools }, ...[...groups].map(([group, items]) => ({ group, items }))];
}

/* Файл-картинка из буфера обмена. */
const imageFileOf = (data) => [...(data?.files || [])].find((file) => /^image\//.test(file.type)) || [...(data?.items || [])].find((item) => item.kind === "file" && /^image\//.test(item.type))?.getAsFile?.() || null;

/*
 * Сессия живёт ровно от монтирования до размонтирования окна: создаётся и
 * освобождается в одном эффекте. Создать её в `useMemo` нельзя — React в
 * разработке на пробу размонтирует и снова монтирует окно, `dispose()`
 * обнулял бы холсты у той же сессии, и студия открывалась бы пустой.
 */
function StudioBody(props) {
  const { surface } = props;
  const [session, setSession] = useState(null);
  useEffect(() => {
    /* Прозрачный холст (лого, текстура дирижабля): прозрачное остаётся цветом модели. */
    const next = createSession({ width: surface.width, height: surface.height, background: surface.transparent ? "transparent" : "#000000" });
    setSession(next);
    return () => next.dispose();
  }, [surface.width, surface.height, surface.transparent]);
  if (!session) return null;
  return <StudioWorkspace key={surface.id} {...props} session={session} />;
}

function StudioWorkspace({ surface, session, onPlace, onClose, onNotice, switcher = null, sheetStart = false }) {
  useTr();
  /* Язык окна — в зависимостях запомненных частей окна: они не рисуются заново на каждый шаг ползунка, но меняют язык. */
  const language = useUiLanguage();
  const [ready, setReady] = useState(false);
  /* Откуда основа: лист игры игрока (`game`), ровный тон при пустом ответе (`plain`) или основа без листа игры (``). Говорит об этом строка состояния. */
  const [baseKind, setBaseKind] = useState("");
  const [snapshotState, setSnapshotState] = useState(() => session.snapshot());
  const [options, setOptionsState] = useState(DEFAULT_OPTIONS);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dock, setDock] = useState("layers");
  const [help, setHelp] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [notice, setNotice] = useState("");
  /*
   * Область выбранной поверхности на листе (`surface.region`): студия открывается на
   * ней, а не на всём листе; кисть и фильтры правят только её (замок сессии), остальной
   * лист притушен. «Весь лист» (`sheetShown`) снимает рамку и замок — по просьбе человека.
   */
  const [regionUv, setRegionUv] = useState(null);
  const [regionKnown, setRegionKnown] = useState(() => !surface.wall && !surface.region && !(import.meta.env.DEV && typeof window !== "undefined" && window.__astralStudioRegion));
  const [sheetShown, setSheetShown] = useState(Boolean(sheetStart));
  const regionPx = useMemo(() => regionRect(regionUv, surface.width, surface.height), [regionUv, surface.width, surface.height]);
  const focusKey = regionPx && !sheetShown ? `${regionPx.x}:${regionPx.y}:${regionPx.width}:${regionPx.height}` : "";
  const focus = focusKey ? regionPx : null;
  /* Стена под щелчком (`surface.wall`): окно показывает её, а не лист; «Весь лист» (`sheetShown`) возвращает лист. */
  const wallSpaceValue = useMemo(() => (surface.wall ? wallSpace(surface.wall, surface.width, surface.height) : null), [surface.wall, surface.width, surface.height]);
  const wallActive = Boolean(wallSpaceValue) && !sheetShown;
  const optionsRef = useRef(options);
  const viewRef = useRef(view);
  viewRef.current = view;
  const viewportRef = useRef(null);
  const fileInput = useRef(null);
  const overlayState = useRef(null);
  const stamp = useRef(null);
  const [overlayTick, setOverlayTick] = useState(0);
  const overlayApi = useMemo(() => ({ get: () => overlayState.current }), []);
  optionsRef.current = options;

  /*
   * Снимок сессии — на внешней подписке: окно перерисовывается по её событиям.
   * Точки мазка («pixels») идут потоком — окно берёт их не чаще раза в 120 мс
   * (миниатюры, 3D-вид), а холст на экране рисует свою подписку сам: React не
   * перерисовывает всю студию на каждую точку.
   */
  useEffect(() => {
    let timer = 0;
    let last = 0;
    const flush = () => {
      timer = 0;
      last = performance.now();
      setSnapshotState(session.snapshot());
    };
    const off = session.subscribe((event) => {
      if (event.kind !== "pixels") {
        window.clearTimeout(timer);
        flush();
        return;
      }
      if (timer) return;
      timer = window.setTimeout(flush, Math.max(0, 120 - (performance.now() - last)));
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [session]);
  const snapshot = snapshotState;

  useEffect(() => {
    let cancelled = false;
    /* Стена накрывает свою область листа сама: плиточный лист — весь, остров — его рамка. */
    if (surface.wall) {
      setRegionUv(wallRegion(surface.wall));
      setRegionKnown(true);
      return undefined;
    }
    /* Песочница: область можно подставить руками (`window.__astralStudioRegion = [u0, v0, u1, v1]`) — поверхностей с узкой областью в готовых сценах мало. */
    const forced = import.meta.env.DEV && typeof window !== "undefined" ? window.__astralStudioRegion : null;
    if (!surface.region && !forced) return undefined;
    Promise.resolve(forced || (typeof surface.region === "function" ? surface.region() : surface.region))
      .then((uv) => {
        if (!cancelled) setRegionUv(Array.isArray(uv) ? uv : null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRegionKnown(true);
      });
    return () => {
      cancelled = true;
    };
  }, [surface]);

  /* Замок сессии — по рамке: пока студия на поверхности, пиксели вне её не трогаются. */
  useEffect(() => {
    session.setLock(focus);
    return () => session.setLock(null);
    // Замок следит за рамкой, а не за её объектом.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, focusKey]);

  /* Вид «стена»: мазок через край листа продолжается с противоположного (плитка). */
  useEffect(() => {
    session.setWrap(wallActive);
    return () => session.setWrap(false);
  }, [session, wallActive]);

  const say = useCallback(
    (text) => {
      setNotice(text);
      onNotice?.(text);
    },
    [onNotice],
  );

  /* Открытие: сохранённые слои (если они про ту же картинку) или основа из игры. */
  useEffect(() => {
    let cancelled = false;
    session.setAssetLoader(async (key) => {
      const blob = await getWorkshopAsset(key);
      return blob ? createImageBitmap(blob) : null;
    });
    (async () => {
      /* Слои — той картинки, что стоит на поверхности (у каждой работы свои); нет картинки — черновик поверхности. */
      const saved = await loadStudioDocument(surface.id, surface.current?.asset || "").catch(() => null);
      if (cancelled) return;
      if (saved && (await session.restore(saved).catch(() => false))) {
        if (!cancelled) {
          setBaseKind(saved.meta?.baseKind || "");
          session.markSaved();
          setReady(true);
        }
        return;
      }
      let base = null;
      try {
        base = (await surface.base?.()) || null;
      } catch {
        base = null;
      }
      if (cancelled) return;
      setBaseKind(base ? "game" : surface.base ? "plain" : "");
      if (base) session.loadBase(base);
      else if (!surface.transparent) session.fillBase(surface.baseColour || "#202226");
      base?.close?.();
      /* Картинка, что уже стоит на поверхности, — слоем поверх основы. */
      if (surface.current?.asset) {
        const blob = await getWorkshopAsset(surface.current.asset).catch(() => null);
        const bitmap = blob ? await createImageBitmap(blob).catch(() => null) : null;
        if (bitmap && !cancelled) {
          session.addImage({ asset: surface.current.asset, bitmap, name: tr("Текущая картинка"), fitTo: 1 });
          /* Картинка места лежит на нём «Растянуть» — на весь холст; у лого и текстур (`currentFit: "contain"`) — вписана по центру. */
          const layer = session.activeLayer();
          if (layer && surface.currentFit !== "contain") session.patchLayer(layer.id, { x: 0, y: 0, width: session.width, height: session.height }, "Текущая картинка");
        }
      }
      if (cancelled) return;
      session.markSaved();
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // Студия открывается один раз на поверхность.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  /* На стене — только то, что переводится в лист: чужой инструмент не берётся ни мышью, ни клавишей. */
  const wallActiveRef = useRef(wallActive);
  wallActiveRef.current = wallActive;
  const setOptions = useCallback((patch) => {
    if (patch.tool && wallActiveRef.current && !WALL_TOOLS.has(patch.tool)) return;
    setOptionsState((current) => patchOptions(current, patch));
  }, []);
  useEffect(() => {
    if (wallActive) setOptionsState((current) => (WALL_TOOLS.has(current.tool) ? current : patchOptions(current, { tool: "brush" })));
  }, [wallActive]);

  /* Контроллер инструментов: читает свежие настройки через ref. */
  const controller = useMemo(
    () =>
      createToolController({
        session,
        options: () => effectiveOptions(optionsRef.current),
        setColours: (patch) => setOptionsState((current) => ({ ...current, ...patch })),
        overlay: {
          get: () => overlayState.current,
          set: (value) => {
            overlayState.current = value;
            setOverlayTick((tick) => tick + 1);
          },
        },
        view: {
          pan: (dx, dy) => viewportRef.current?.pan(dx, dy),
          zoomTo: (rect) => viewportRef.current?.zoomTo(rect),
          zoomStep: (direction, point) => viewportRef.current?.zoomStep(direction, point),
        },
        zoom: () => viewRef.current.zoom,
        stampSource: () => stamp.current,
        setStampSource: (value) => {
          stamp.current = value;
        },
        onText: () => setDock("layers"),
        onNotice: say,
      }),
    [session, say],
  );

  /* ----------------------------- действия ----------------------------- */

  const insertImage = useCallback(
    async (file) => {
      try {
        const saved = await saveFinishImage(file);
        const blob = await getWorkshopAsset(saved.asset);
        const bitmap = blob ? await createImageBitmap(blob) : null;
        session.addImage({ asset: saved.asset, bitmap, name: saved.name || tr("Картинка") });
        setOptions({ tool: "move" });
      } catch (error) {
        say(String(error?.message || error));
      }
    },
    [session, say, setOptions],
  );

  const exportPng = useCallback(async () => {
    const blob = await session.exportBlob("image/png");
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${String(surface.slug || surface.id || "texture").replace(/[^a-zA-Z0-9._-]+/g, "-")}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    say(tr("PNG сохранён в «Загрузки»"));
  }, [session, surface, say]);

  /* Слои — файлом: сохранить в «Загрузки» и открыть из файла (другая сессия окна, другой компьютер). */
  const layersInput = useRef(null);
  const saveLayers = useCallback(async () => {
    try {
      const blob = await packStudioFile(await session.save(), { id: surface.id, width: session.width, height: session.height }, { baseKind });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = studioFileName(surface);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      say(tr("Слои сохранены в «Загрузки»"));
    } catch (error) {
      say(String(error?.message || error));
    }
  }, [session, surface, baseKind, say]);
  const openLayers = useCallback(
    async (file) => {
      try {
        const saved = await unpackStudioFile(file, { width: session.width, height: session.height });
        if (!(await session.restore(saved))) throw new Error(tr("Документ слоёв в файле не читается."));
        setBaseKind(saved.meta?.baseKind || baseKind);
        say(tr("Слои открыты из файла"));
      } catch (error) {
        say(String(error?.message || error));
      }
    },
    [session, baseKind, say],
  );

  const place = useCallback(async () => {
    if (placing) return;
    setPlacing(true);
    try {
      const blob = await session.exportBlob("image/png");
      if (!blob) throw new Error(tr("Холст не собрался — попробуйте ещё раз."));
      const result = await onPlace(blob, { width: session.width, height: session.height });
      await saveStudioDocument(surface.id, await session.save(), { asset: result?.asset || "", baseKind }).catch(() => {});
      session.markSaved();
      say(tr("Картинка поставлена"));
      onClose?.({ placed: true });
    } catch (error) {
      say(String(error?.message || error));
    } finally {
      setPlacing(false);
    }
  }, [placing, session, onPlace, surface.id, say, onClose, baseKind]);

  /*
   * Три вида у стены (3В): «Только эта стена» — холст сама стена (плашка), «Эта стена на листе» и «Весь лист» — лист игры.
   * Между плашкой и листом студия меняет поверхность: слои этой остаются черновиком (вернуться можно), а не пропадают.
   */
  const shownMode = switcher ? (switcher.hosted === "plate" ? "plate" : sheetShown ? "sheet" : "surface") : "";
  const switchMode = useCallback(
    async (next) => {
      if (!switcher || next === shownMode) return;
      if (switcher.hosted !== "plate" && next !== "plate") {
        setSheetShown(next === "sheet");
        return;
      }
      await saveStudioDocument(surface.id, await session.save(), { asset: surface.current?.asset || "", baseKind }).catch(() => {});
      switcher.change(next);
    },
    [switcher, shownMode, surface, session, baseKind],
  );

  const requestClose = useCallback(() => {
    if (session.snapshot().dirty) setLeaving(true);
    else onClose?.({ placed: false });
  }, [session, onClose]);

  const runShortcut = useCallback(
    (id) => {
      const selected = layerOf(session.doc, session.doc.active);
      switch (id) {
        case "undo":
          session.undo();
          break;
        case "redo":
          session.redo();
          break;
        case "select-all":
          session.selectAll();
          break;
        case "deselect":
          session.deselect();
          break;
        case "invert-selection":
          session.invertSelection();
          break;
        case "clear":
          session.clearSelection();
          break;
        case "new-layer":
          session.addRaster();
          break;
        case "duplicate-layer":
          if (selected) session.duplicate(selected.id);
          break;
        case "merge-down":
          if (selected) session.mergeDown(selected.id);
          break;
        case "export":
          void exportPng();
          break;
        case "place":
          void place();
          break;
        case "fit":
          viewportRef.current?.fit();
          break;
        case "actual":
          viewportRef.current?.actual();
          break;
        case "zoom-in":
          viewportRef.current?.zoomStep(1);
          break;
        case "zoom-out":
          viewportRef.current?.zoomStep(-1);
          break;
        case "brush-smaller":
          setOptionsState((current) => ({ ...current, size: Math.max(1, Math.round(current.size * 0.85 - 1)) }));
          break;
        case "brush-larger":
          setOptionsState((current) => ({ ...current, size: Math.min(2000, Math.round(current.size / 0.85 + 1)) }));
          break;
        case "swap-colours":
          setOptionsState((current) => ({ ...current, foreground: current.background, background: current.foreground }));
          break;
        case "default-colours":
          setOptionsState((current) => ({ ...current, foreground: "#000000", background: "#ffffff" }));
          break;
        case "commit":
          controller.finishPolygon();
          break;
        case "cancel":
          controller.cancel();
          break;
        case "help":
          setHelp(true);
          break;
        default:
          break;
      }
    },
    [session, exportPng, place, controller],
  );

  /* Клавиши — на окно, пока студия открыта: раскладка не важна (`hotkey`). */
  useEffect(() => {
    const onKeyDown = (event) => {
      if (leaving || help) return;
      if (event.key === " " && !isTextEntry(event.target) && event.target.tagName !== "BUTTON") {
        event.preventDefault();
        setSpaceHeld(true);
        return;
      }
      const typing = isTextEntry(event.target) || event.target?.tagName === "SELECT";
      if (typing && event.key !== "Escape" && event.key !== "F1") return;
      const resolved = resolveKey({ key: hotkey(event), ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey });
      if (!resolved) return;
      if (resolved.type === "shortcut") {
        /* «Всё» и «снять» в поле — свои; Esc без мазка закрывает студию только по кнопке. */
        if (resolved.id === "cancel" && !controller.active) return;
        event.preventDefault();
        runShortcut(resolved.id);
      } else if (resolved.type === "tool") {
        if (event.target?.tagName === "BUTTON" && event.target.closest(".ui-editor-rail")) return;
        event.preventDefault();
        if (wallActiveRef.current && !WALL_TOOLS.has(resolved.id)) return;
        setOptionsState((current) => {
          if (current.tool === resolved.id && resolved.cycle) return patchOptions(current, { kind: nextKind(resolved.id, current.kinds[resolved.id] || toolOf(resolved.id).kinds[0]) });
          return patchOptions(current, { tool: resolved.id });
        });
      }
    };
    const onKeyUp = (event) => {
      if (event.key === " ") setSpaceHeld(false);
    };
    const onPaste = (event) => {
      const file = imageFileOf(event.clipboardData);
      if (file && !isTextEntry(event.target)) {
        event.preventDefault();
        void insertImage(file);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("paste", onPaste);
    };
  }, [leaving, help, runShortcut, controller, insertImage]);

  /* Закрыть с несохранёнными правками браузер не даст молча. */
  useEffect(() => {
    const warn = (event) => {
      if (session.snapshot().dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [session]);

  /* --------------------------- разметка и вид ------------------------- */

  const panels = useMemo(() => {
    if (!surface.panels) return null;
    const count = panelCount(surface.panels.metres?.[0], surface.panels.count);
    return panelLayout({ width: surface.width, height: surface.height, metres: surface.panels.metres, count });
  }, [surface]);
  const [showPanels, setShowPanels] = useState(true);

  const active = layerOf(snapshot.doc, snapshot.doc.active);
  const effective = effectiveOptions(options);
  /*
   * Ползунки и цвет не лагают (ТЗ 29.10.2026, п. 5): шаг ползунка меняет настройки инструмента, и окно рисуется заново.
   * Части, которым настройки не нужны, — список инструментов рейки, док «Слои | История», 3D-вид, окно клавиш, шапка —
   * запомнены и на этот шаг не рисуются.
   */
  const tools = useMemo(
    () =>
      TOOLS.map((tool) => ({
        id: tool.id,
        label: tr(tool.label),
        icon: TOOL_ICONS[tool.id],
        shortcut: tool.key,
        group: String(GROUP_LABELS[tool.group] ?? 0),
        hint: wallActive && !WALL_TOOLS.has(tool.id) ? tr("На стене — кисть, ластик, заливка, текст и пипетка; остальное — на всём листе") : tr(tool.note),
        disabled: wallActive && !WALL_TOOLS.has(tool.id),
      })),
    // Подписи переводятся заново при смене языка.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallActive, language],
  );

  const activeTool = tools.find((item) => item.id === options.tool) || null;
  /* Пункты взятой группы рейки — первой группой строки инструментов («Краска»: кисть, ластик, заливка, пипетка). */
  const subTools = (TEXTURE_RAIL.find((group) => group.ids.includes(options.tool))?.ids || []).map((id) => tools.find((item) => item.id === id)).filter(Boolean);
  const onEditorTool = (id) => setOptions({ tool: id });
  const rail = useRailGroups({ groups: TEXTURE_RAIL, tools, tool: options.tool, onTool: onEditorTool, head: true });
  const onPick = () => fileInput.current?.click();

  /* Шапка — как у остальных редакторов мастерской (`EditorActions`): отмена и возврат, «⋯» с редкими действиями, справа главная кнопка. */
  const actions = useMemo(() => (
    <EditorActions
      more={[
        { value: "export", label: tr("Экспорт PNG"), icon: <DownloadSimple /> },
        { value: "layers-save", label: tr("Слои в файл"), icon: <FloppyDisk /> },
        { value: "layers-open", label: tr("Слои из файла"), icon: <FolderOpen /> },
      ]}
      onMore={(action) => {
        if (action === "export") exportPng();
        else if (action === "layers-save") saveLayers();
        else if (action === "layers-open") layersInput.current?.click();
      }}
      apply={{
        label: tr(surface.placeLabel || "Поставить"),
        busy: placing ? tr("Ставим…") : "",
        disabled: placing || !ready,
        title: tr("Студия правит картинку места: «Поставить» кладёт её в редактор, в игру её отправит «Применить» там"),
        onClick: place,
      }}
    />
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [placing, ready, surface.placeLabel, exportPng, saveLayers, place, language]);
  const guide = useMemo(
    () => [
      { keys: "F1", text: tr("все клавиши") },
      { keys: tr("Пробел"), text: tr("рука на время") },
      { keys: tr("Колесо"), text: tr("масштаб") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );
  const dockPanel = useMemo(
    () => (
      <StudioDock value={dock} onChange={setDock}>
        {dock === "layers" ? <LayersPanel session={session} snapshot={snapshot} /> : <HistoryPanel session={session} snapshot={snapshot} />}
      </StudioDock>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dock, session, snapshot, language],
  );
  const float3d = useMemo(
    () => (surface.view3d && ready && regionKnown ? <StudioFloat3D session={session} view3d={surface.view3d} flatVersion={snapshot.flatVersion} /> : null),
    [surface.view3d, ready, regionKnown, session, snapshot.flatVersion],
  );
  const shortcutsDialog = useMemo(
    () => <ShortcutsDialog open={help} onClose={() => setHelp(false)} kicker={tr("Студия текстур")} groups={shortcutGroups()} />,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [help, language],
  );

  const bar = <StudioToolbar options={effective} setOptions={setOptions} subTools={subTools} onInsert={onPick} session={session} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo} />;
  const scope = <StudioScope panels={panels} showPanels={showPanels} setShowPanels={setShowPanels} hasRegion={Boolean(regionPx) || Boolean(wallSpaceValue)} isWall={Boolean(wallSpaceValue)} tileNote={surface.plateNote || (wallActive ? tileNoteOf(wallSpaceValue) : "")} sheetShown={sheetShown} onSheet={setSheetShown} modeSwitch={switcher ? { value: shownMode, onChange: switchMode } : null} />;

  return (
    <>
      <EditorShell
        className="txs-shell fx-editor"
        onBack={requestClose}
        backLabel={tr("Закрыть студию")}
        title={tr("Студия текстур")}
        status={`${surface.title}${wallActive ? ` · ${tr("стена")} ${wallSizeText(surface.wall)}` : ""} · ${snapshot.dirty ? tr("есть правки") : tr("без правок")}`}
        actions={actions}
        tools={rail.tools}
        tool={rail.tool}
        onTool={rail.onTool}
        panelHead={activeTool ? { label: tr(activeTool.label), note: TOOL_SUBTITLES[activeTool.id] ? tr(TOOL_SUBTITLES[activeTool.id]) : undefined } : null}
        toolShortcuts={false}
        guide={guide}
        guideKey="texture-studio"
        tour={[]}
        inspector={
          /* Пункты группы — в строке инструментов над холстом; что студия в игру сама не ставит, говорит подсказка «Поставить на …». */
          <StudioInspector session={session} snapshot={snapshot} options={options} setOptions={setOptions} />
        }
        dock={dockPanel}
      >
        <div className="txs-stage">
          {bar}
          <div className="txs-canvas-area">
            {ready && regionKnown ? (
              <StudioViewport
                ref={viewportRef}
                session={session}
                controller={controller}
                overlay={overlayApi}
                overlayTick={overlayTick}
                view={view}
                onView={setView}
                options={effective}
                guides={showPanels ? panels : null}
                focus={wallActive ? null : focus}
                wall={wallActive ? wallSpaceValue : null}
                spaceHeld={spaceHeld}
                flatVersion={snapshot.flatVersion}
                selectionRevision={snapshot.selection?.revision || 0}
                activeLayer={active}
                label={tr("Холст студии")}
              />
            ) : (
              <p className="txs-loading">{tr("Открываем студию…")}</p>
            )}
            {snapshot.busy && <div className="txs-busy" role="status">{tr(snapshot.busy)}…</div>}
            {float3d}
          </div>
          <footer className="txs-footer">
            <div className="txs-zoom" role="group" aria-label={tr("Масштаб")}>
              <Button size="sm" variant="ghost" icon={<MagnifyingGlassMinus />} aria-label={tr("Дальше")} onClick={() => viewportRef.current?.zoomStep(-1)} />
              <output aria-live="off">{zoomText(view.zoom)}</output>
              <Button size="sm" variant="ghost" icon={<MagnifyingGlassPlus />} aria-label={tr("Ближе")} onClick={() => viewportRef.current?.zoomStep(1)} />
              <Button size="sm" variant="ghost" onClick={() => viewportRef.current?.fit()}>
                {tr("Вписать")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => viewportRef.current?.actual()}>
                100 %
              </Button>
            </div>
            {scope}
            <span className="txs-footer-info">
              {snapshot.selection?.bounds ? `${tr("Выделено")}: ${snapshot.selection.bounds.width} × ${snapshot.selection.bounds.height}` : `${tr("Слоёв")}: ${snapshot.doc.layers.length}`}
              {` · ${surface.width} × ${surface.height}`}
              {baseKind ? ` · ${tr(baseKind === "game" ? surface.baseLabel || "основа — лист вашей GTA V" : "основа — ровный тон: листа игры в этом окне нет")}` : ""}
              {notice ? ` · ${tr(notice)}` : ""}
            </span>
            <Button size="sm" variant="ghost" icon={<Keyboard />} onClick={() => setHelp(true)}>
              {tr("Все клавиши")} · F1
            </Button>
          </footer>
        </div>
      </EditorShell>
      <input
        ref={layersInput}
        type="file"
        accept={`.${STUDIO_FILE_EXTENSION},.zip,application/zip`}
        hidden
        aria-label={tr("Слои из файла")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void openLayers(file);
        }}
      />
      <input ref={fileInput} type="file" accept={FINISH_IMAGE_ACCEPT} hidden aria-label={tr("Вставить картинку")} onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void insertImage(file);
      }} />
      {shortcutsDialog}
      <Dialog
        open={leaving}
        onClose={() => setLeaving(false)}
        title={tr("Закрыть без сохранения?")}
        role="alertdialog"
        size="sm"
        description={tr("В студии есть правки, которые не поставлены на поверхность. Если закрыть сейчас, они пропадут.")}
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => setLeaving(false)}>
              {tr("Остаться")}
            </Button>
            <Button size="sm" variant="primary" onClick={() => onClose?.({ placed: false })}>
              {tr("Закрыть без сохранения")}
            </Button>
          </>
        }
      />
    </>
  );
}

/* Стена в метрах: «12 × 8 м». */
const wallSizeText = (wall) => `${Math.round(wall.width * 10) / 10} × ${Math.round(wall.height * 10) / 10} ${tr("м")}`;

/* Честная строка про повторы: лист на стене — плиткой или один раз; правка ложится на сам лист. */
const tileNoteOf = (space) => (space?.tiles.count > 1 ? tr("Лист повторяется плиткой — правка ляжет на все его повторы и на другие места с этим листом.") : tr("Правка ляжет на лист — и на другие места с этим листом."));

/*
 * Быстрые параметры строки: два главных у взятого инструмента. Полный набор — в панели справа; здесь — то, что крутят
 * между мазками, не уводя взгляд с холста.
 */
const QUICK_PARAMS = Object.freeze([
  { key: "size", label: "Размер", min: 1, max: (session) => Math.min(2000, Math.max(200, session.height)), format: (value) => `${Math.round(value)} px` },
  { key: "opacity", label: "Непрозрачность", min: 1, max: 100, format: (value) => `${Math.round(value)} %` },
  { key: "amount", label: "Сила", min: 1, max: 100, format: (value) => `${Math.round(value)} %` },
  { key: "tolerance", label: "Допуск", min: 0, max: 255, format: (value) => `${Math.round(value)}` },
  { key: "feather", label: "Растушёвка", min: 0, max: 200, format: (value) => `${Math.round(value)} px` },
  /* Надпись и фигура держат свои настройки внутри (`options.text`, `options.shape`): кегль и толщина линии. */
  { key: "text", field: "size", label: "Размер", min: 8, max: (session) => Math.max(512, session.height), format: (value) => `${Math.round(value)} px` },
  { key: "shape", field: "strokeWidth", label: "Толщина", min: 0, max: 200, format: (value) => `${Math.round(value)} px` },
]);

/*
 * Строка инструментов под шапкой (ТЗ владельца 29.10.2026, модуль В, п. 1): ровная полоса 46 px, три группы через
 * тонкие черты — пункты взятой группы рейки значками, два быстрых параметра, действия (картинка, отменить, вернуть).
 */
function StudioToolbar({ options, setOptions, subTools, onInsert, session, canUndo, canRedo }) {
  useTr();
  const tool = toolOf(options.tool);
  const quick = QUICK_PARAMS.filter((param) => tool.options.includes(param.key) && !(param.key === "tolerance" && (options.kind === "linear" || options.kind === "radial"))).slice(0, 2);
  return (
    <div className="txs-bar" role="toolbar" aria-label={tr("Строка инструментов")}>
      {subTools.length > 1 && (
        <>
          <div className="txs-bar-group txs-bar-tools" role="group" aria-label={tr("Инструменты группы")}>
            {subTools.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={item.id === options.tool ? "secondary" : "ghost"}
                icon={item.icon}
                aria-label={item.label}
                aria-pressed={item.id === options.tool}
                title={`${item.label} (${String(item.shortcut).toUpperCase()}) — ${item.hint}`}
                disabled={item.disabled}
                onClick={() => setOptions({ tool: item.id })}
              />
            ))}
          </div>
          <span className="txs-bar-sep" aria-hidden="true" />
        </>
      )}
      <div className="txs-bar-group txs-bar-params" role="group" aria-label={tr("Быстрые параметры")}>
        {quick.length ? (
          quick.map((param) => (
            <div key={param.key} className="txs-bar-range">
              <Slider
                label={tr(param.label)}
                ariaLabel={tr(param.label)}
                value={param.field ? options[param.key][param.field] : options[param.key]}
                min={param.min}
                max={typeof param.max === "function" ? param.max(session) : param.max}
                step={1}
                format={param.format}
                onChange={(value) => setOptions({ [param.key]: param.field ? { ...options[param.key], [param.field]: value } : value })}
              />
            </div>
          ))
        ) : (
          <span className="txs-bar-empty">{tr(tool.label)}</span>
        )}
      </div>
      <span className="txs-bar-sep" aria-hidden="true" />
      <div className="txs-bar-group txs-bar-actions" role="group" aria-label={tr("Действия")}>
        <Button size="sm" variant="ghost" icon={<ImageSquare />} title={tr("Вставить картинку (или Ctrl+V)")} onClick={onInsert}>
          {tr("Картинка")}
        </Button>
        <Button size="sm" variant="ghost" icon={<ArrowUUpLeft />} aria-label={tr("Отменить шаг")} title={tr("Отменить шаг (Ctrl+Z)")} disabled={!canUndo} onClick={() => session.undo()} />
        <Button size="sm" variant="ghost" icon={<ArrowUUpRight />} aria-label={tr("Вернуть шаг")} title={tr("Вернуть шаг (Ctrl+Shift+Z)")} disabled={!canRedo} onClick={() => session.redo()} />
      </div>
    </div>
  );
}

/* Что показано (эта поверхность, стена, весь лист) и разметка панелей фасада — в нижней полосе, у масштаба: это вид, а не инструмент. */
function StudioScope({ panels, showPanels, setShowPanels, hasRegion = false, isWall = false, tileNote = "", sheetShown = false, onSheet = null, modeSwitch = null }) {
  useTr();
  return (
    <>
      {modeSwitch && (
        <span className="txs-scope" title={`${tr("«Только эта стена» — картинка ляжет плашкой на эту стену одну. «Эта стена на листе» и «Весь лист» правят лист игры: правка ляжет на все его повторы и на другие места с этим листом.")}${tileNote ? ` ${tileNote}` : ""}`}>
          <SegmentedControl
            label={tr("Что показано")}
            size="sm"
            options={[
              { value: "plate", label: tr("Только эта стена") },
              { value: "surface", label: tr("Эта стена на листе") },
              { value: "sheet", label: tr("Весь лист") },
            ]}
            value={modeSwitch.value}
            onChange={modeSwitch.onChange}
          />
        </span>
      )}
      {!modeSwitch && hasRegion && onSheet && (
        <span className="txs-scope" title={`${isWall ? tr("Студия показывает выбранную стену, развёрнутую в плоскость: лист на ней повторён так, как он лежит в игре, и кисть идёт по стене. «Весь лист» — сам лист целиком.") : tr("Студия открыта на той части листа, что занимает выбранная поверхность: кисть правит только её. «Весь лист» показывает и правит лист целиком.")}${tileNote ? ` ${tileNote}` : ""}`}>
          <SegmentedControl
            label={tr("Что показано")}
            size="sm"
            options={[
              { value: "surface", label: isWall ? tr("Эта стена") : tr("Эта поверхность") },
              { value: "sheet", label: tr("Весь лист") },
            ]}
            value={sheetShown ? "sheet" : "surface"}
            onChange={(value) => onSheet(value === "sheet")}
          />
        </span>
      )}
      {panels && (
        <Button size="sm" variant={showPanels ? "secondary" : "ghost"} aria-pressed={showPanels} onClick={() => setShowPanels(!showPanels)} title={tr("Разметка панелей фасада")}>
          {tr("Панели")}
        </Button>
      )}
    </>
  );
}

/**
 * Студия текстур: окно поверх редактора. `open` — показано ли; закрывается
 * `onClose({ placed })`. Тело монтируется заново на каждое открытие.
 */
export default function TextureStudio({ open, surface, onPlace, onClose, onNotice }) {
  const host = open ? overlayHost() : null;
  const plate = surface?.plate || null;
  /* Стена с плашкой (3В): окно открывается на холсте самой стены; «Эта стена на листе» и «Весь лист» — на листе. */
  const [hosted, setHosted] = useState(plate ? "plate" : "sheet");
  const [sheetStart, setSheetStart] = useState(false);
  if (!open || !host || !surface) return null;
  const onPlate = Boolean(plate) && hosted === "plate";
  const shown = onPlate ? plate.surface : surface;
  const switcher = plate
    ? {
        hosted: onPlate ? "plate" : "sheet",
        change: (next) => {
          setHosted(next === "plate" ? "plate" : "sheet");
          setSheetStart(next === "sheet");
        },
      }
    : null;
  return createPortal(
    <div className="txs-root" role="dialog" aria-modal="true" aria-label={shown.title}>
      {/* Своя сессия на каждую поверхность: слои плашки и листа не смешиваются. */}
      <StudioBody key={shown.id} surface={shown} onPlace={onPlate ? plate.onPlace : onPlace} onClose={onClose} onNotice={onNotice} switcher={switcher} sheetStart={sheetStart} />
    </div>,
    host,
  );
}

export { wallCanvasSize, documentAssets };
