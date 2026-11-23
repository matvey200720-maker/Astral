/*
 * Редактор «Интерьеры проектов» — интерьеры серверов Majestic и GTA 5 РП из
 * каталога Astral (паки с CDN) и из папок и кэша самого игрока (ТЗ 17.10.2026,
 * вечер, задача 10; раздача с CDN — решение владельца того же вечера).
 *
 * Над кадром — какой проект (Majestic или GTA 5 РП: у каждого свой список) и
 * какой интерьер правится. Интерьеры берутся из того, что лежит у игрока:
 * из выбранной папки или найденного кэша клиента RAGE:MP; ни файлов проектов,
 * ни их картинок в Astral нет. Кэш клиента Majestic (alt:V) зашифрован —
 * интерьеры его сервера из него не прочесть, поэтому у Majestic остаётся
 * «папка или сборка игрока», и редактор говорит это прямо.
 *
 * Инструменты слева (мастерская «как в Photoshop»): «Интерьер» (что это, чего
 * не хватает, «Поставить в игру»), «Цвет и блеск» (стены, пол, потолок,
 * мебель: свой цвет и блеск — чистая, глянец, зеркало), «Шаблоны»,
 * «Источники». Внутри — только цвет и блеск (решение владельца 12.10.2026
 * про интерьеры).
 *
 * Общее с остальными местами (работа, черновик, «Мои работы», камера) —
 * `useRecolorEditor`. Интерьер сервера на самом сервере остаётся серверным:
 * облик ложится на него в одиночной игре.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, PaintBucket, Storefront, Swatches } from "../../../components/ui/icons.jsx";
import {
  PROJECT_LIST,
  applyProjectInteriorsPreset,
  applyProjectInteriorsStandard,
  installedInteriors,
  interiorLookOf,
  setInteriorLook,
  stockInteriorLook,
} from "@modovik/climb-contract/recolor/project-interiors";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import MenuButton from "../../../components/ui/MenuButton.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import ProjectInteriorsInspector from "./ProjectInteriorsInspector.jsx";
import ProjectInteriorsStage from "./ProjectInteriorsStage.jsx";
import { useProjectCatalog, useProjectPacks, useProjectScene } from "./project-interiors-data.js";
import { fill, interiorsCountText, projectName, unitMenuOptions, unitTitle } from "./project-interiors-text.js";
import { tr, useTr } from "../../../locales/ui.js";

const DRAFT_KEY = "astral.projectinteriors.project.v1";
const CONTRACT = RECOLOR_PROJECTS.projectinteriors;

/* Цифры — горячие клавиши по порядку панели: буквы в 3D-кадре заняты полётом. */
const numbered = (tools) => Object.freeze(tools.map((tool, index) => Object.freeze({ ...tool, shortcut: String(index + 1) })));

const TOOLS = numbered([
  {
    id: "interior",
    label: "Интерьер",
    icon: <Storefront />,
    group: "place",
    hint: "Интерьер выбирают в меню над кадром. Здесь — что в нём найдено, чего не хватает и можно ли поставить его в одиночную игру",
  },
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
  {
    id: "sources",
    label: "Источники",
    icon: <FolderOpen />,
    group: "place",
    hint: "Паки интерьеров из каталога Astral и ваши собственные папки: отсюда берутся интерьеры",
  },
]);
const TOOL_IDS = TOOLS.map((tool) => tool.id);

/*
 * Подписи инструментов — переводом в месте отрисовки: каркас выводит заголовок
 * и пояснение панели как есть, а слой перевода разметки у украинского
 * оставляет смесь (перевод тоже кириллица).
 */
/* Подписи под именем панели нет (п. 9 `design-qa.md`): имя инструмента и есть короткое имя того, что в панели. */
const translatedTools = () => TOOLS.map((tool) => ({ ...tool, label: tr(tool.label), hint: tr(tool.hint) }));

const NO_SCENE = Object.freeze({ state: "loading", surfaces: {} });

export default function ProjectInteriorsStudio({ onExit, onNotice }) {
  useTr();
  const [savedTool, setTool] = useRememberedState("projectinteriors:tool", "interior");
  const [side, setSide] = useRememberedState("projectinteriors:side", "gta5rp");
  const [pickedMajestic, setPickedMajestic] = useRememberedState("projectinteriors:unit:majestic", "");
  const [pickedGta5rp, setPickedGta5rp] = useRememberedState("projectinteriors:unit:gta5rp", "");
  const tool = TOOL_IDS.includes(savedTool) ? savedTool : "interior";
  const project = side === "majestic" ? "majestic" : "gta5rp";
  const picked = project === "majestic" ? pickedMajestic : pickedGta5rp;
  const [mlos, setMlos] = useState({});
  /* Поверхность, выбранная щелчком в кадре: панель раскрывает её первой. */
  const [focus, setFocus] = useState({ surface: null, at: 0, unit: "" });

  const catalog = useProjectCatalog(project);
  const packs = useProjectPacks(project, catalog.rescan);
  const { current: catalogCurrent, units: catalogUnits } = catalog;
  const units = useMemo(() => (catalogCurrent ? catalogUnits : []), [catalogCurrent, catalogUnits]);
  const unit = useMemo(() => units.find((item) => item.id === picked) || units.find((item) => item.install.offered) || units[0] || null, [units, picked]);
  const mlo = unit ? mlos[unit.id] || unit.mlo[0].hash.toString(16).padStart(8, "0") : "";
  const sceneInfo = useProjectScene(project, unit?.id || "", mlo) || NO_SCENE;

  const editor = useRecolorEditor({
    set: "projectinteriors",
    contract: CONTRACT,
    storageKey: DRAFT_KEY,
    title: tr("Интерьеры проектов"),
    coverSlotId: "project-interiors",
    onNotice,
    resetNotice: tr("Ничего не ставится в игру"),
    resetLabel: tr("Ничего не ставить"),
    stockLabel: tr("Ничего не ставится"),
    stockMeansRemoval: true,
    removalTitle: tr("Снять интерьеры проектов Astral — в игре они исчезнут, остальное на месте"),
    applyLabel: tr("Установить"),
    removeLabel: tr("Снять из игры"),
    installTitle: tr("Ставится в одиночную игру как мод. В игре ещё не проверено. Снятие возвращает игру как была."),
    savedText: tr("Ставим интерьеры в игру"),
    doneText: () => tr("Интерьеры установлены. Перезапустите игру."),
    rolledBackText: tr("Интерьеры сняты из игры — остальные моды на месте"),
  });
  const { project: work, commit, replace } = editor;
  const installed = installedInteriors(work);

  const onPick = useCallback(
    (id) => {
      if (project === "majestic") setPickedMajestic(id);
      else setPickedGta5rp(id);
    },
    [project, setPickedMajestic, setPickedGta5rp],
  );

  /* Песочница (только dev): работа и выбор интерьера — снимкам кадра проверок, как `__astralModelStage`. */
  useEffect(() => {
    if (!import.meta.env?.DEV) return undefined;
    const hook = { project: work, replace, setUnit: onPick, setSide };
    window.__astralProjectInteriorsEditor = hook;
    return () => {
      if (window.__astralProjectInteriorsEditor === hook) delete window.__astralProjectInteriorsEditor;
    };
  }, [work, replace, onPick, setSide]);

  /* Правка облика взятого интерьера. */
  const editLook = useCallback(
    (update, text) => {
      if (!unit) return;
      commit((current) => setInteriorLook(current, unit.id, update(interiorLookOf(current, unit.id))), text);
    },
    [commit, unit],
  );
  const label = unit?.label || tr("Интерьер");
  const onSurface = useCallback(
    (surface, patch, text) => editLook((look) => ({ ...look, surfaces: { ...look.surfaces, [surface]: { ...look.surfaces[surface], ...patch } } }), text || `${label}: ${surface}`),
    [editLook, label],
  );
  const onSurfacesStandard = useCallback(() => editLook((look) => stockInteriorLook(look), `${label}: как в игре — все поверхности`), [editLook, label]);
  const onInteriorStandard = onSurfacesStandard;
  const onInstall = useCallback((flag) => editLook((look) => ({ ...look, install: flag }), `${label}: ${flag ? "ставится в игру" : "не ставится"}`), [editLook, label]);
  const onPreset = useCallback(
    (preset) => {
      if (unit) replace((current) => applyProjectInteriorsPreset(current, unit.id, preset.id), `${label}: ${tr(preset.label)}`);
    },
    [replace, unit, label],
  );
  const onStandard = useCallback(() => replace((current) => applyProjectInteriorsStandard(current), tr("Ничего не ставится в игру")), [replace]);

  /* Щелчок в кадре: стена, пол, потолок или мебель — её поверхность в «Цвете и блеске». */
  const unitId = unit?.id || "";
  const onSurfacePick = useCallback(
    (surface) => {
      if (tool !== "surfaces") setTool("surfaces");
      setFocus({ surface, at: Date.now(), unit: unitId });
    },
    [setTool, tool, unitId],
  );
  /* Подсветка в кадре идёт за состоянием: раздел поверхности открыт в «Цвете и блеске» у этого интерьера. */
  const selectedSurface = tool === "surfaces" && focus.unit === unitId ? focus.surface : null;

  const changedIds = useMemo(() => new Set(Object.entries(work.interiors).map(([id]) => id)), [work]);
  const options = useMemo(() => unitMenuOptions(units, new Set(installed), changedIds), [units, installed, changedIds]);
  const sideOptions = PROJECT_LIST.map((item) => ({ value: item.id, label: projectName(item.id) }));
  const tabs = (
    <>
      <SegmentedControl label={tr("Проект")} className="project-interiors-sides" size="sm" value={project} options={sideOptions} onChange={setSide} />
      <MenuButton
        className="project-interiors-menu"
        label={unit ? unitTitle(unit) : tr("Нет интерьеров")}
        ariaLabel={tr("Что правится")}
        options={options}
        value={unit?.id}
        onSelect={onPick}
        disabled={!unit}
      />
    </>
  );

  const status = `${work.name || tr("Интерьеры проектов")} · ${projectName(project)}${catalog.status === "ready" ? ` · ${interiorsCountText(units.length)}` : ""}${
    installed.length ? fill(tr(" · в игру — интерьеров: {0}"), installed.length) : ""
  }`;

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor project-interiors-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Интерьеры проектов")}
      status={status}
      tabs={tabs}
      tools={translatedTools()}
      tool={tool}
      onTool={setTool}
      guide={editor.guide(false, { aim: tr("править поверхность под курсором") })}
      guideKey="projectinteriors"
      guideFlash={editor.cameraMode}
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <ProjectInteriorsInspector
          tool={tool}
          work={work}
          side={project}
          unit={unit}
          mlo={mlo}
          sceneInfo={sceneInfo}
          catalog={catalog}
          packs={packs}
          focus={focus}
          onMlo={(value) => unit && setMlos((current) => ({ ...current, [unit.id]: value }))}
          onInstall={onInstall}
          onSurface={onSurface}
          onSurfacesStandard={onSurfacesStandard}
          onPreset={onPreset}
          onInteriorStandard={onInteriorStandard}
          onStandard={onStandard}
          onTool={setTool}
        />
      }
    >
      <ProjectInteriorsStage work={work} side={project} unit={unit} mlo={mlo} catalog={catalog} onAim={onSurfacePick} selected={selectedSurface} onCamera={editor.onCamera} />
      {editor.works.dialogs}
    </EditorShell>
  );
}
