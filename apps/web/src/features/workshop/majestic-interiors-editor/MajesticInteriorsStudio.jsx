/*
 * Редактор «Интерьеры Majestic RP» — двенадцать интерьеров сервера Majestic (Хелпер 7, 25.10.2026).
 *
 * Корень работы один на все интерьеры (`majestic-interiors-project.js`): у казино своя часть (`casino`: покрытия и подсветка), у остальных
 * десяти — цвет и блеск поверхностей по номеру интерьера (`colour`, `majestic-colour.js`). Какой интерьер правится — в меню над кадром:
 * записи реестра (`majestic-interiors.js`) по группам «Город», «Службы», «Государство и армия»; у тронутых — отметка, у тех, чьего
 * пакета в выгрузке нет (LSPD Vespucci), пункт погашен словами. Рядом — переключатель сцены: у казино семь залов, у остальных — помещения
 * интерьера; сцену меняет только он, инструмент её не трогает. Цифры 1–9 — по порядку переключателя.
 *
 * Инструменты слева зависят от записи. Казино: «Покрытия» (27 листов: перекрасить или залить цветом) и «Подсветка зала» (пять светящихся листов:
 * свой цвет или выключить — гаснут и лампы); колесо по залу берёт лист. Остальные: «Цвет и блеск» (стены, пол, потолок, мебель — цвет и блеск, как
 * в «Интерьерах проектов») и «Шаблоны» (готовые облики); колесо по стене, полу, потолку или мебели берёт поверхность. У обоих
 * есть «Предметы»: всё, что стоит в помещении или зале, по одной вещи — найти, обвести, выбрать все такие (`use-interiors-items.jsx`).
 *
 * Помещение собирает Astral Desktop из файлов пака интерьера и GTA V игрока (тот же канал, что у «Интерьеров проектов»). Общее с остальными
 * местами (работа, черновик, «Мои работы», камера, «Применить») — `useRecolorEditor`. Интерьер сервера на самом сервере остаётся серверным:
 * правка ложится на него в одиночной игре. «Стандарт» — ничего не правлено, «Применить» снимает установку.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, Images, Lightbulb, PaintBucket, PencilSimple, Swatches } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import { colourLookOf, setColourLook } from "@modovik/climb-contract/recolor/majestic-colour";
import { clearSheetsOfUnit, setSheetLook, sheetsOfUnit } from "@modovik/climb-contract/recolor/majestic-sheets";
import { applyProjectInteriorsPreset, createProjectInteriors, interiorLookOf, stockInteriorLook } from "@modovik/climb-contract/recolor/project-interiors";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { withoutNote } from "../../../components/ui/editor-rail-groups.js";
import MenuButton from "../../../components/ui/MenuButton.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import { preloadProjectScenes, projectSheetSource, releaseProjectScenes, setProjectScenesLimit, useProjectCatalog, useProjectPacks, useProjectScene } from "../project-interiors-editor/project-interiors-data.js";
import { fill, surfaceLabel } from "../project-interiors-editor/project-interiors-text.js";
import MajesticColourInspector from "./MajesticColourInspector.jsx";
import MajesticInteriorsInspector from "./MajesticInteriorsInspector.jsx";
import MajesticInteriorsStage from "./MajesticInteriorsStage.jsx";
import MajesticPacksInspector from "./MajesticPacksInspector.jsx";
import MajesticSheetsInspector from "./MajesticSheetsInspector.jsx";
import { majesticImages } from "./majestic-sheet-pictures.js";
import { CASINO_GLOW_SHEETS, CASINO_PROJECT, CASINO_ZONES, casinoZone, isCasinoGlowSheet } from "./majestic-interiors-data.js";
import { DEFAULT_ENTRY, changedEntries, defaultRoom, entryAvailable, entryGroups, entryOf, entrySides, entryUnitId, roomHex } from "./majestic-interiors-entries.js";
import { sheetsOfAsset } from "./majestic-sheets-data.js";
import { INTERIORS_ITEMS_COPY } from "./interiors-items.js";
import { INTERIORS_ITEMS_TOOL, useInteriorsItems } from "./use-interiors-items.jsx";
import { tr, useTr } from "../../../locales/ui.js";

const DRAFT_KEY = "astral.majesticinteriors.project.v1";
const CONTRACT = RECOLOR_PROJECTS.majesticinteriors;

/* «Паки интерьеров» — последний инструмент у любого интерьера: откуда берутся файлы, а не что правится. */
const PACKS_TOOL = Object.freeze({
  id: "packs",
  label: "Паки интерьеров",
  icon: <FolderOpen />,
  group: "files",
  hint: "Паки интерьеров Majestic RP: какие уже на вашем компьютере, какие можно скачать с серверов Astral. Скачанный интерьер сразу появляется в кадре",
});

/* «Листы» (ТЗ 29.10.2026-e, п. 3): у любого интерьера — правка по самому листу, а не по классу поверхности; список берётся из кадра. */
const SHEETS_TOOL = Object.freeze({
  id: "sheets",
  label: "Листы",
  icon: <Images />,
  group: "paint",
  note: "Любой лист интерьера: перекрасить или залить",
  hint: "Нажмите по стене, полу или вещи в кадре — выберется её лист, он обведён во всех местах. Перекрасьте его (узор остаётся) или залейте ровным цветом: правка ляжет на лист во всём интерьере",
});

/* Цифры 1–9 — переключатель сцены (залы, помещения), поэтому у инструментов клавиш нет. */
const CASINO_TOOLS = Object.freeze([
  {
    id: "coverings",
    label: "Покрытия",
    icon: <PaintBucket />,
    group: "paint",
    hint: "27 покрытий казино: перекрасьте лист (узор остаётся) или залейте ровным цветом. Выберите покрытие в списке справа или нажмите колесом по залу",
  },
  {
    id: "glow",
    label: "Подсветка зала",
    icon: <Lightbulb />,
    group: "paint",
    hint: "Пять светящихся листов казино разом: свой цвет или выключенная подсветка — вместе с ней гаснут и лампы",
  },
  SHEETS_TOOL,
  INTERIORS_ITEMS_TOOL,
  PACKS_TOOL,
]);
/* Остальные места выгрузки (ТЗ 29.10.2026-e): правка только по листам; цвета и блеска поверхностей, шаблонов и покрытий у них нет. */
const SHEETS_ONLY_TOOLS = Object.freeze([SHEETS_TOOL, INTERIORS_ITEMS_TOOL, PACKS_TOOL]);
const COLOUR_TOOLS = Object.freeze([
  {
    id: "surfaces",
    label: "Цвет и блеск",
    icon: <PaintBucket />,
    group: "paint",
    hint: "У каждой поверхности — свой цвет и блеск: чистая, глянец или зеркало. Щелчок по стене, полу или мебели в кадре открывает её здесь",
  },
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    group: "ready",
    hint: "Готовый облик оформляет интерьер разом — дальше любую поверхность можно поправить",
  },
  SHEETS_TOOL,
  INTERIORS_ITEMS_TOOL,
  PACKS_TOOL,
]);

/*
 * Подписи инструментов — переводом в месте отрисовки: каркас выводит заголовок и пояснение панели как есть, а слой перевода
 * разметки у украинского оставляет смесь (перевод тоже кириллица).
 */
/* Подписи под именем панели нет (п. 9 `design-qa.md`): имя инструмента и есть короткое имя того, что в панели. */
const translatedTools = (tools) => tools.map((tool) => ({ ...withoutNote(tool), label: tr(tool.label), hint: tr(tool.hint) }));

/** Пункты меню над кадром: группы заголовками, записи реестра пунктами; тронутые — с отметкой, без пакета — погашены словами. */
function entryMenuOptions(changed) {
  const options = [];
  entryGroups().forEach((group, index) => {
    if (index) options.push({ separator: true });
    options.push({ heading: tr(group.label) });
    for (const entry of group.entries) {
      const gone = !entryAvailable(entry);
      options.push({
        value: entry.id,
        label: gone ? `${tr(entry.label)} · ${tr("пакета нет в выгрузке")}` : tr(entry.label),
        disabled: gone,
        /* Пометка реестра («Предположение: Artex») — подсказкой пункта: открытый вопрос к владельцу не прячется. */
        title: gone ? tr(entry.open || "Пакета нет в выгрузке") : [entry.open ? tr(entry.open) : "", changed.has(entry.id) ? tr("есть изменения") : ""].filter(Boolean).join(" · ") || undefined,
        icon: changed.has(entry.id) ? <PencilSimple /> : undefined,
      });
    }
  });
  return options;
}

/** Цифры 1–9 переключают сцену (залы казино, помещения интерьера), пока человек не печатает в поле. */
function useSceneKeys(sceneSwitch) {
  const latest = useRef(sceneSwitch);
  latest.current = sceneSwitch;
  useEffect(() => {
    const onKey = (event) => {
      const current = latest.current;
      if (!current?.options?.length || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "")) return;
      const index = "123456789".indexOf(event.key);
      if (index >= 0 && event.key.length === 1 && current.options[index]) current.onChange(current.options[index].value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export default function MajesticInteriorsStudio({ onExit, onNotice }) {
  useTr();
  const [savedEntry, setEntryId] = useRememberedState("majesticinteriors:entry", DEFAULT_ENTRY);
  const [savedTool, setTool] = useRememberedState("majesticinteriors:tool", "coverings");
  const [zoneId, setZoneId] = useRememberedState("majesticinteriors:zone", CASINO_ZONES[0].id);
  /* Сторона записи с двумя пакетами (тюрьма: снаружи или внутри); помещение по номеру интерьера; взятое покрытие казино; поверхность, взятая щелчком в кадре цветного интерьера. */
  const [sides, setSides] = useState({});
  const [rooms, setRooms] = useState({});
  const [selected, setSelected] = useState("");
  const [focus, setFocus] = useState({ surface: null, at: 0, unit: "" });
  /* Лист, взятый щелчком в кадре или в списке «Листов», и сцена кадра с номером интерьера — из неё берётся список листов помещения. */
  const [sheet, setSheet] = useState("");
  const [frame, setFrame] = useState({ unit: "", asset: null });

  const entry = entryAvailable(entryOf(savedEntry)) ? entryOf(savedEntry) : entryOf(DEFAULT_ENTRY);
  const casinoMode = entry.mode === "casino";
  /* Остальные места выгрузки владельца — только листы: у них нет ни покрытий казино, ни цвета и блеска поверхностей. */
  const sheetsOnly = entry.mode === "sheets";
  const tools = casinoMode ? CASINO_TOOLS : sheetsOnly ? SHEETS_ONLY_TOOLS : COLOUR_TOOLS;
  const tool = tools.some((item) => item.id === savedTool) ? savedTool : tools[0].id;
  /* Паки записи (казино — два из двенадцати): остальные паки каталог не читает, пока их запись не открыли. */
  const entrySlugs = useMemo(() => entry.packs.map((item) => item.slug).filter(Boolean), [entry]);
  const catalog = useProjectCatalog(CASINO_PROJECT, { slugs: entrySlugs });
  /* Паки реестра из облачного каталога: скачанный пак сразу перечитывает каталог — интерьер встаёт в кадр. */
  const packs = useProjectPacks(CASINO_PROJECT, catalog.rescan);
  const { current: catalogCurrent, units: catalogUnits } = catalog;
  /*
   * Снаружи и внутри — два пакета, то есть два номера интерьера: у каждого свои помещения и свой облик в работе. Человек, не выбравший сторону, видит ту,
   * чьи файлы есть среди его папок: у владельца выгрузки тюрьмы «снаружи» нет (в выгрузке только «внутри»), и интерьер не должен открываться словами «нет среди
   * ваших файлов», когда другая сторона на месте.
   */
  const sideChoices = entrySides(entry);
  const hasUnit = (role) => Boolean(catalogCurrent && catalogUnits.some((item) => item.id === entryUnitId(entry, role)));
  const side = sideChoices.includes(sides[entry.id]) ? sides[entry.id] : (!hasUnit("main") && sideChoices.find(hasUnit)) || "main";
  const unitId = entryUnitId(entry, side);
  const zone = casinoZone(zoneId);
  const unit = useMemo(() => (catalogCurrent ? catalogUnits.find((item) => item.id === unitId) || null : null), [catalogCurrent, catalogUnits, unitId]);
  /* Помещение: у казино — хеш зала, у остальных — выбранное из помещений интерьера (по умолчанию первое). */
  const room = unit && unit.mlo.find((item) => roomHex(item) === rooms[unitId]) ? rooms[unitId] : defaultRoom(unit) ? roomHex(defaultRoom(unit)) : "";
  const mlo = casinoMode ? zone.mlo : room;
  const scene = useProjectScene(CASINO_PROJECT, unit ? unitId : "", mlo);

  /*
   * Залы казино ждут заранее (ТЗ 26.10.2026, п. C3): как только открытый зал собран, поток читателя по одному собирает остальные —
   * сначала те, что следуют за открытым по кругу, — и переключение берёт готовую сцену, а не ждёт сборки. Редактор закрыт — ссылки на сцены
   * освобождаются: каждая держит в памяти зал целиком.
   */
  const sceneReady = scene.state === "ready";
  useEffect(() => {
    if (!casinoMode || !unit || !sceneReady) return undefined;
    setProjectScenesLimit(CASINO_ZONES.length + 1);
    const at = CASINO_ZONES.findIndex((item) => item.id === zone.id);
    const order = [...CASINO_ZONES.slice(at + 1), ...CASINO_ZONES.slice(0, Math.max(0, at))].map((item) => item.mlo);
    return preloadProjectScenes(CASINO_PROJECT, unitId, order);
  }, [casinoMode, unit, unitId, sceneReady, zone.id]);
  useEffect(() => releaseProjectScenes, []);

  const editor = useRecolorEditor({
    set: "majesticinteriors",
    contract: CONTRACT,
    storageKey: DRAFT_KEY,
    /* Свои картинки листов из студии текстур едут в «Применить» из хранилища окна (`majestic-sheet-pictures.js`). */
    images: majesticImages,
    title: tr("Интерьеры Majestic RP"),
    coverSlotId: "majestic-interiors",
    onNotice,
    resetNotice: tr("Ничего не ставится в игру"),
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
    removalTitle: tr("Снять интерьеры Majestic RP Astral — в игре они станут как были, остальное на месте"),
    savedText: tr("Ставим интерьеры в игру"),
    doneText: () => tr("Интерьеры установлены. Перезапустите игру."),
    rolledBackText: tr("Интерьеры сняты из игры — остальные моды на месте"),
  });
  const { project: work, commit, replace } = editor;


  /* Правки части казино: `commit` принимает функцию обновления и сам приводит работу в порядок. */
  const onCovering = useCallback(
    (tex, look, text) =>
      commit((current) => {
        const coverings = { ...current.casino.coverings };
        if (look) coverings[tex] = look;
        else delete coverings[tex];
        return { ...current, casino: { ...current.casino, coverings } };
      }, text),
    [commit],
  );
  const onCoveringsReset = useCallback(() => commit((current) => ({ ...current, casino: { ...current.casino, coverings: {} } }), tr("Покрытия: как в игре")), [commit]);
  const onGlow = useCallback((glow, text) => commit((current) => ({ ...current, casino: { ...current.casino, glow } }), text), [commit]);

  /* Правки цвета и блеска взятого интерьера: часть `colour` корня, облик по номеру интерьера. */
  const label = tr(entry.label);
  const editLook = useCallback(
    (update, text) => {
      if (!unitId) return;
      commit((current) => ({ ...current, colour: setColourLook(current.colour, unitId, update(colourLookOf(current.colour, unitId))) }), text);
    },
    [commit, unitId],
  );
  const onSurface = useCallback(
    (surface, patch, text) => editLook((look) => ({ ...look, surfaces: { ...look.surfaces, [surface]: { ...look.surfaces[surface], ...patch } } }), text || `${label}: ${tr(surfaceLabel(surface))}`),
    [editLook, label],
  );
  const onInteriorStandard = useCallback(() => editLook((look) => stockInteriorLook(look), `${label}: ${tr("Как в игре")}`), [editLook, label]);
  const onPreset = useCallback(
    (preset) => {
      if (!unitId) return;
      replace(
        (current) => ({ ...current, colour: setColourLook(current.colour, unitId, interiorLookOf(applyProjectInteriorsPreset(createProjectInteriors(), unitId, preset.id), unitId)) }),
        `${label}: ${tr(preset.label)}`,
      );
    },
    [replace, unitId, label],
  );
  const onAllStandard = useCallback(() => replace((current) => CONTRACT.standard(current), tr("Ничего не ставится в игру")), [replace]);

  /* Правки листов взятого интерьера: часть `sheets` корня, правка по номеру интерьера и имени листа; «как в игре» лист из работы убирает. */
  const onSheetLook = useCallback(
    (tex, look, text) => {
      if (!unitId) return;
      commit((current) => ({ ...current, sheets: setSheetLook(current.sheets, unitId, tex, look || { mode: "standard" }) }), text);
    },
    [commit, unitId],
  );
  const onSheetsReset = useCallback(() => {
    if (!unitId) return;
    commit((current) => ({ ...current, sheets: clearSheetsOfUnit(current.sheets, unitId) }), `${label}: ${tr("листы как в игре")}`);
  }, [commit, unitId, label]);

  /* Нажатие по листу в кадре: у казино — покрытие в «Покрытиях» взятым или «Подсветка зала»; у остальных — поверхность в «Цвете и блеске». */
  const onAim = useCallback(
    (name) => {
      if (casinoMode) {
        if (isCasinoGlowSheet(name)) {
          setTool("glow");
          setSelected("");
        } else {
          setTool("coverings");
          setSelected(name);
        }
        return;
      }
      if (tool !== "surfaces") setTool("surfaces");
      setFocus({ surface: name, at: Date.now(), unit: unitId });
    },
    [casinoMode, setTool, tool, unitId],
  );
  const onTool = useCallback(
    (next) => {
      setTool(next);
      if (next === "glow") setSelected("");
    },
    [setTool],
  );
  /* «Предметы» (ТЗ 26.10.2026, п. A): всё, что стоит в помещении или зале, по одной вещи; опись и выбор — в `use-interiors-items.jsx`. */
  /* Сцены не будет — у «Предметов» одна строка, а не вечная плашка загрузки. */
  const sceneAbsent = catalog.status === "web" || (Boolean(catalogCurrent) && !unit) || scene.state === "missing";
  /* Исправить это человек может сам: у казино — выбрать папку с его файлами, у остальных — скачать пак. Без Astral Desktop — нечем. */
  const itemsFix =
    !sceneAbsent || catalog.status === "web"
      ? null
      : casinoMode || entry.ownerOnly
        ? typeof catalog.add === "function"
          ? { title: tr("Выбрать папку"), caption: casinoMode ? tr("Нет файлов казино") : tr("Нет файлов интерьера"), onOpen: () => catalog.add() }
          : null
        : { title: tr("Паки интерьеров"), caption: tr("Нет файлов интерьера"), onOpen: () => setTool("packs") };
  const itemsKit = useInteriorsItems({ active: tool === "items", casino: casinoMode, onTool, onNotice, absent: sceneAbsent, fix: itemsFix });
  /* Вещь под щелчком в другом инструменте — «Предметы» на ней: правится она одна (п. 7 `docs/3D-ELEMENTS-PICTURES.md`). */
  const pickThing = itemsKit.stage.onPick;
  const onThing = useCallback(
    (key) => {
      setTool("items");
      pickThing(key, "one");
    },
    [setTool, pickThing],
  );
  /* Сцена кадра приходит из модели позже, чем меняется интерьер: номер берётся по ссылке, чтобы список листов не достался чужому интерьеру. */
  const unitRef = useRef(unitId);
  unitRef.current = unitId;
  const { onAsset: onItemsAsset } = itemsKit;
  const onFrameAsset = useCallback(
    (loaded, eye) => {
      onItemsAsset?.(loaded, eye);
      setFrame({ unit: unitRef.current, asset: loaded });
    },
    [onItemsAsset],
  );
  const frameSheets = useMemo(() => (frame.unit === unitId ? sheetsOfAsset(frame.asset) : []), [frame, unitId]);
  const sheetSource = useMemo(() => (unitId ? projectSheetSource(CASINO_PROJECT, unitId) : null), [unitId]);

  /* Песочница (только dev): работа, интерьер, зал, инструмент и взятое — снимкам кадра проверок, как `__astralProjectInteriorsEditor`. */
  useEffect(() => {
    if (!import.meta.env?.DEV) return undefined;
    const hook = {
      project: work,
      replace,
      setEntry: setEntryId,
      setSide: (value) => setSides((current) => ({ ...current, [entry.id]: value })),
      setZone: setZoneId,
      setTool,
      select: setSelected,
      setSheet,
      sheets: frameSheets,
      setRoom: (value) => setRooms((current) => ({ ...current, [unitId]: value })),
    };
    window.__astralMajesticInteriorsEditor = hook;
    return () => {
      if (window.__astralMajesticInteriorsEditor === hook) delete window.__astralMajesticInteriorsEditor;
    };
  }, [work, replace, setEntryId, setZoneId, setTool, unitId, entry.id, frameSheets]);
  const onEntry = useCallback(
    (id) => {
      setEntryId(id);
      setSelected("");
      setSheet("");
      setFocus({ surface: null, at: 0, unit: "" });
    },
    [setEntryId],
  );

  /* Сцена кадра: у казино — залы, у интерьера с несколькими помещениями — они; сцену меняет только этот переключатель. */
  const sceneSwitch = (() => {
    if (casinoMode) {
      return {
        label: tr("Зал казино"),
        options: CASINO_ZONES.map((item, index) => ({ value: item.id, label: tr(item.label), title: `${tr(item.label)} (${index + 1})` })),
        value: zone.id,
        onChange: setZoneId,
      };
    }
    if (!unit || unit.mlo.length < 2) return null;
    return {
      label: tr("Помещение"),
      options: unit.mlo.map((item, index) => ({
        value: roomHex(item),
        label: String(index + 1),
        title: `${fill(tr("Помещение {0}"), index + 1)} · ${fill(tr("комнат: {0}, вещей: {1}"), item.rooms, item.entities)}${index < 9 ? ` (${index + 1})` : ""}`,
      })),
      value: room,
      onChange: (value) => setRooms((current) => ({ ...current, [unitId]: value })),
    };
  })();
  useSceneKeys(sceneSwitch);

  const shown = editor.shown(work);
  const changed = useMemo(() => changedEntries(work), [work]);
  const colourWork = useMemo(() => ({ interiors: work.colour }), [work.colour]);
  const colourLook = useMemo(() => colourLookOf(shown.colour, unitId), [shown.colour, unitId]);
  /* Подсветка в кадре идёт за состоянием: у казино — открыта «Подсветка зала» (её листы) или взятое покрытие; у остальных — поверхность, взятая в «Цвете и блеске». */
  const highlighted = tool === "sheets" ? sheet : casinoMode ? (tool === "glow" ? CASINO_GLOW_SHEETS[0] : selected) : tool === "surfaces" && focus.unit === unitId ? focus.surface : null;
  /* Листы взятого интерьера в работе, как их показывает кадр (сравнение «как в игре» их снимает вместе с остальным). */
  const sheetLooks = useMemo(() => Object.fromEntries(sheetsOfUnit(shown.sheets, unitId)), [shown.sheets, unitId]);

  const sideText = sideChoices.length ? tr(side === "inside" ? "Внутри" : "Снаружи") : "";
  const roomText = !casinoMode && unit && unit.mlo.length > 1 ? fill(tr("Помещение {0}"), unit.mlo.findIndex((item) => roomHex(item) === room) + 1) : "";
  const where = casinoMode ? `${tr("Казино Majestic RP")} · ${tr(zone.label)}` : [label, sideText, roomText].filter(Boolean).join(" · ");
  /*
   * Подпись в шапке — только что стоит («Как в игре», «Есть изменения», имя своей работы). Имя редактора уже стоит слева, а интерьер,
   * сторона и зал — выбором рядом: строка «Интерьеры Majestic RP · Как в игре · Казино Majestic RP · Лобби» повторяла их и обрезалась
   * с обеих сторон (критик 30.10.2026). Где мы — в подсказке подписи.
   */
  const editorTitle = tr("Интерьеры Majestic RP");
  const headState = editor.status.startsWith(`${editorTitle} · `) ? editor.status.slice(editorTitle.length + 3) : editor.status;
  const tabs = (
    <>
      <MenuButton className="majestic-interiors-menu" label={label} ariaLabel={tr("Что правится")} options={entryMenuOptions(changed)} value={entry.id} onSelect={onEntry} />
      {sideChoices.length ? (
        <SegmentedControl
          label={tr("Снаружи или внутри")}
          className="majestic-interiors-sides"
          size="sm"
          value={side}
          options={sideChoices.map((role) => ({ value: role, label: tr(role === "inside" ? "Внутри" : "Снаружи") }))}
          onChange={(value) => setSides((current) => ({ ...current, [entry.id]: value }))}
        />
      ) : null}
    </>
  );

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor majestic-interiors-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={editorTitle}
      status={<span title={where}>{headState}</span>}
      tabs={tabs}
      scene={sceneSwitch}
      tools={translatedTools(tools)}
      tool={tool}
      onTool={onTool}
      guide={editor.guide(false, { aim: tool === "items" ? tr(INTERIORS_ITEMS_COPY.aim) : casinoMode || tool === "sheets" ? tr("взять лист под курсором") : tr("править поверхность под курсором") })}
      guideKey="majesticinteriors"
      guideFlash={editor.cameraMode}
      actions={
        <EditorActions {...editor.actionProps({ compare: true })} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        tool === "items" ? (
          itemsKit.panel
        ) : tool === "packs" ? (
          <MajesticPacksInspector packs={packs} catalog={catalog} current={entry.id} />
        ) : tool === "sheets" ? (
          <MajesticSheetsInspector
            sheets={frameSheets}
            looks={sheetLooks}
            selected={sheet}
            source={sheetSource}
            loading={scene.state === "loading"}
            project={CASINO_PROJECT}
            unitId={unitId}
            unitLabel={label}
            onNotice={onNotice}
            onSelect={setSheet}
            onLook={onSheetLook}
            onReset={onSheetsReset}
            absent={sceneAbsent}
            fix={itemsFix}
          />
        ) : casinoMode ? (
          <MajesticInteriorsInspector tool={tool} casino={work.casino} selected={selected} onSelect={setSelected} onCovering={onCovering} onCoveringsReset={onCoveringsReset} onGlow={onGlow} />
        ) : (
          <MajesticColourInspector
            tool={tool}
            work={colourWork}
            unit={unit}
            sceneInfo={scene}
            note={entry.open ? tr(entry.open) : ""}
            focus={focus}
            onSurface={onSurface}
            onSurfacesStandard={onInteriorStandard}
            onPreset={onPreset}
            onInteriorStandard={onInteriorStandard}
            onAllStandard={onAllStandard}
          />
        )
      }
    >
      <MajesticInteriorsStage
        kind={casinoMode ? "casino" : "colour"}
        entry={entry}
        unit={unit}
        catalog={catalog}
        scene={scene}
        title={where}
        casino={shown.casino}
        look={colourLook}
        sheets={shown.sheets}
        sheetTool={tool === "sheets"}
        onSheet={setSheet}
        selected={highlighted}
        onAim={onAim}
        /* Вещь под щелчком в любом инструменте (п. 7 `docs/3D-ELEMENTS-PICTURES.md`) — «Предметы» на ней. */
        onThing={onThing}
        onCamera={editor.onCamera}
        items={itemsKit.stage}
        onAsset={onFrameAsset}
        onPacks={() => setTool("packs")}
      />
      {editor.works.dialogs}
    </EditorShell>
  );
}
