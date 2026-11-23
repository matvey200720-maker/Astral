/*
 * Арена: Maze Bank Arena двух серверов — GTA 5 RP и Majestic.
 *
 * Одна работа, у каждого сервера свои настройки: переключатель сервера
 * ничего не теряет, в игру уезжает арена выбранного. Мастерская открывает
 * арену стандартной (ТЗ 03.10.2026): у GTA 5 RP — штатная арена игры, у
 * Majestic — стандартная арена сервера. Снаружи — фасад и эмблема плашкой;
 * внутри — пол, стены и потолок порознь, экраны, таблички, эмблемы зала и
 * плакаты (своя картинка в выбранных местах с размером, поворотом и
 * сдвигом), знаки выхода, автоматы (показать или убрать), кресла и звезда
 * GTA5RP: своя картинка объёмной фигурой на подставке с движением. Спрайтов
 * (наклейки колы, потёки, номера, грязь) нет: они убраны насовсем.
 *
 * «Стандарт» — ставить нечего, «Применить» снимает файлы Astral. Устройство и пределы —
 * `@modovik/climb-contract/recolor/arenas`, файлы — `recolor-arenas.js`.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): каждый
 * раздел арены — инструмент слева (у Majestic их меньше: звезды и
 * банкоматов в его моде нет), справа — настройки взятого, сервер — в шапке.
 * Сцена отдельно от инструмента (ТЗ владельца 22.10.2026): «Внутри зала /
 * Снаружи» — переключатель в шапке рядом с сервером, и только он меняет
 * кадр. Колонка слева — инструменты этой сцены: снаружи фасад, эмблемы,
 * текст, логотипы и баннеры; в зале пол, стены, потолок, экраны, плакаты,
 * предметы. Раньше инструмент сам переставлял кадр — щелчок по «Фасаду» из
 * зала гасил зал и выносил на площадь, — теперь так не бывает. Звезда, как
 * и прежде, подводит к себе взгляд, но в той же сцене.
 *
 * Общее с остальными наборами — `useRecolorEditor`.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Buildings,
  Coin,
  Cube,
  CursorClick,
  Door,
  Image,
  ImageSquare,
  Lightning,
  MagicWand,
  Medal,
  Monitor,
  Package,
  Rows,
  Seal,
  SquaresFour,
  Stack,
  StackSimple,
  Star,
  Sticker,
  TextAa,
  TextT,
  Wall,
} from "../../../components/ui/icons.jsx";
import { ARENA_SECTIONS, ARENA_SECTION_LABELS, ARENA_SURFACES, arenaPlazaEnabled, arenaServerInventory, arenasProjectSignature } from "@modovik/climb-contract/recolor/arenas";
import { usePatternStamp, patternTool } from "../finish/PatternStamp.jsx";
import { arenaObjectModel, arenaObjectScope, arenaObjects } from "@modovik/climb-contract/recolor/arena-objects";
import { arenaLayersAvailable } from "./arena-layers-section.jsx";
import { applyArenaTemplate } from "@modovik/climb-contract/recolor/arena-templates";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { railMembers, withoutNote } from "../../../components/ui/editor-rail-groups.js";
import { toolsOfScene, useSceneToolMemory } from "../../../components/ui/editor-scene.js";
import PageTabs from "../../../components/ui/PageTabs.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { useRailGroups } from "../../../components/ui/useRailGroups.jsx";
import { isTextEntry } from "../../../utils/hotkeys.js";
import { emblemKindOf, emblemPlacingLabel, emblemToolActive } from "../emblem/emblem-tools.jsx";
import { useEmblemEditor } from "../emblem/useEmblemEditor.js";
import { modelsTool } from "../models/models-tool.jsx";
import { usePlaceModels } from "../models/usePlaceModels.jsx";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import { takePartNotice } from "../../catalog/part-notice.js";
import ArenaInspector from "./ArenaInspector.jsx";
import ArenaModStudio from "./ArenaModStudio.jsx";
import { dropForgottenArenaMod, forgetArenaModOpen, withoutArenaMod } from "./arena-mod-open.js";
import ArenaStage from "./ArenaStage.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { arenaImages } from "./arena-images.js";
import { shellPaintKey } from "./arena-shell-paint.js";
import { entityBounds, itemFocus } from "./arena-items.js";
import { arenaElementAt, arenaItemElements, arenaItemParts } from "./arena-item-parts.js";
import { arenaMenuFocus, arenaSectionScene, arenaToolFocus } from "./arena-camera.js";
import { itemFrameOf } from "./arena-item-looks.js";
import { arenaItemPlace, setArenaItemLook } from "@modovik/climb-contract/recolor/arena-item-looks";
import { itemMoveLook } from "../items-panel/item-look-objects.js";
import { applyItemLook } from "../items-panel/item-set-looks.js";
import { createItemShots } from "../items-panel/item-shots.js";
import { toggleSelection } from "../items-panel/use-scene-items.js";
import { saveArenaTemplatePictures } from "./arena-template-assets.js";
import { ARENA_SERVER_OPTIONS, ARENA_SIGN_SECTIONS, arenaSignFocus } from "./arena-text.js";
import { ArenaSubTabs, PanelHint } from "./arena-panel-parts.jsx";
import RebuiltArenaBanner from "./RebuiltArenaBanner.jsx";
import "../../../components/desktop/workshop/arena/arena-studio.css";
import { trFill } from "../../../locales/tr-fill.js";
import { tr, useTr } from "../../../locales/ui.js";

const ARENA_STORAGE_KEY = "astral.arenas.project.v1";
const CONTRACT = RECOLOR_PROJECTS.arenas;
const readEmblems = (project) => project[project.server].emblems;
const writeEmblems = (project, emblems) => ({ ...project, [project.server]: { ...project[project.server], emblems } });
/* Свои модели — у каждого сервера свои (задача 1 ТЗ 11.10.2026, вечер). */
const readModels = (project) => project[project.server].models;
const writeModels = (project, models) => ({ ...project, [project.server]: { ...project[project.server], models } });
const arenaSceneLabel = (scene) => (String(scene).endsWith("-outside") ? "снаружи" : "в зале");
/* Своя модель для перелёта: её рамка — от места и длинной стороны (размер модели в метрах), сцена — её же. */
const placeModelFocusTarget = (item) => ({
  box: { min: item.position.map((value) => value - item.size / 2), max: item.position.map((value) => value + item.size / 2) },
  scene: String(item.scene).endsWith("-outside") ? "outside" : "inside",
  normal: item.normal || null,
});
/* В какой сцене лететь: инструмент, предмет — зал; своя вещь — её сцена; место — сцена его раздела. */
const flightScene = (server, target) => (target.box ? target.scene : target.tool || Number.isInteger(target.item) ? "inside" : arenaSectionScene(server, target.section));

/* «GTA 5 RP» — имя сервера, а не крик прописными. */
const SERVER_OPTIONS = ARENA_SERVER_OPTIONS.map((item) => ({ ...item, label: <span data-audit-ignore="caps">{item.label}</span> }));

/*
 * Разделы арены инструментами. `view` — откуда кадр смотрит, когда инструмент
 * взят. Горячие клавиши — цифры по порядку в колонке: буквы в 3D-кадре
 * заняты полётом (W A S D, Q и E). `note` — подзаголовок колонки: короткое
 * имя того, что в панели, 2–4 слова без перечислений и кавычек (`design-qa.md`,
 * п. 9, 30.10.2026); на всех шести языках в одну строку.
 */
/* Как ложится картинка фасада — тем же «?» шапки, следом за `hint`: у отделки своего заголовка с «?» нет (п. 17). */
const FACADE_HELP = Object.freeze([
  "Картинка ложится на листы фасада по их развёртке: «растянуть» — на лист, «замостить» — плиткой.",
  "Дальний фасад — тем же цветом общей системой дальних планов: издалека арена того же тона. Узор и картинку издалека не разглядеть — там остаётся их основной цвет.",
]);

const SECTION_TOOLS = Object.freeze({
  facade: {
    label: "Фасад",
    icon: <Buildings />,
    view: "outside",
    note: "Облик арены снаружи",
    hint: "Отделка фасада — кадр снаружи покажет её сразу; издалека арена того же тона",
  },
  /* Площадь у здания (Majestic, 21.11.2026): цвет плиты, бордюров и ступеней у входа — листы земли блока `sp1_10`. */
  plaza: {
    label: "Площадь",
    icon: <SquaresFour />,
    view: "outside",
    note: "Плита у здания",
    hint: "Свой цвет площади у здания: плита, бордюры клумб и ступени; трава, дороги и разметка вокруг остаются как в игре",
  },
  /* Эмблема встаёт и на площадь (21.11.2026): щелчок по плите кладёт её на пол — нормаль вверх, как у пола и потолка в общем редакторе эмблем. */
  emblem: arenaPlazaEnabled()
    ? {
        label: "Эмблемы фасада и площади",
        icon: <Sticker />,
        view: "outside",
        note: "Свои картинки снаружи",
        hint: "Добавьте картинку справа и ставьте её левой кнопкой на фасад или на площадь — на плите она ляжет на пол; правой — камера",
      }
    : {
        label: "Эмблемы фасада",
        icon: <Sticker />,
        view: "outside",
        note: "Свои картинки на фасаде",
        hint: "Добавьте картинку справа и ставьте её левой кнопкой на фасад — и в полёте тоже; правой — камера",
      },
  /* Надписи — второй инструмент общей системы эмблем (задача 1); название арены — строкой в нём (19.10.2026). */
  text: {
    label: "Текст",
    icon: <TextT />,
    view: "outside",
    note: "Надписи фасада",
    hint: "Щёлкните по модели и печатайте — надпись появится на месте щелчка; двойной щелчок по ней правит слова; шрифт, цвет и размер — справа",
  },
  /* Фасад GTA5RP снаружи (задача 6): надпись над входом и на стелах, щит и знаки, баннеры у входов. */
  mazeSign: {
    label: "Надпись Maze Bank Arena",
    icon: <TextAa />,
    view: "outside",
    note: "Название арены",
    hint: "Впишите своё название — оно встанет вместо объёмных букв MAZE BANK ARENA над главным входом и надписи на трёх стелах; можно и своей картинкой",
  },
  outLogos: {
    label: "Логотипы снаружи",
    icon: <Medal />,
    view: "outside",
    note: "Щит и знак у входа",
    hint: "Своя эмблема вместо белого щита PANIC под надписью над входом, знака Maze Bank и логотипов стел; «Убрать» — без них",
  },
  outBanners: {
    label: "Баннеры у входов",
    icon: <Image />,
    view: "outside",
    note: "Полотна у входов",
    hint: "Свой баннер или цвет — на полотнах у арок, флагах стел, плакате шоу и полотнах с игроками; места включаются отдельно",
  },
  floor: {
    label: "Пол",
    icon: <SquaresFour />,
    view: "inside",
    note: "Пол зала",
    hint: "Пол — своя отделка, независимо от стен и потолка",
  },
  walls: {
    label: "Стены",
    icon: <Wall />,
    view: "inside",
    note: "Стены зала",
    hint: "Стены — своя отделка, независимо от пола и потолка",
  },
  ceiling: {
    label: "Потолок",
    icon: <Stack />,
    view: "inside",
    note: "Потолок зала",
    hint: "Потолок — свой цвет или отделка, независимо от стен",
  },
  screens: {
    label: "Экраны",
    icon: <Monitor />,
    view: "inside",
    note: "Экраны зала",
    hint: "Своя картинка встаёт в каждый экран целиком; размер, поворот и сдвиг — справа. Один экран — отдельно: щёлкните по нему в кадре",
  },
  signs: {
    label: "Таблички",
    icon: <TextT />,
    view: "inside",
    note: "Таблички зала",
    hint: "Своя картинка или цвет на табличках вместо надписей",
  },
  logos: {
    label: "Эмблемы зала",
    icon: <Seal />,
    view: "inside",
    note: "Логотипы по стенам",
    hint: "Выберите, на каких местах будет эмблема: стены — да, пол и столы — по желанию",
  },
  posters: {
    label: "Плакаты",
    icon: <ImageSquare />,
    view: "inside",
    note: "Плакаты зала",
    hint: "Своя картинка заполняет каждое полотно и плакат. Любое полотно можно править отдельно: подлетите к нему и щёлкните по нему — откроется именно оно",
  },
  exits: {
    label: "Знаки выхода",
    icon: <Door />,
    view: "inside",
    note: "Таблички выхода",
    hint: "Свой цвет вместо зелёного у табличек выхода",
  },
  objects: {
    label: "Торговые автоматы",
    icon: <Coin />,
    view: "inside",
    note: "Автоматы зала",
    hint: "Каждый вид автоматов можно убрать",
  },
  seats: {
    label: "Кресла",
    icon: <Rows />,
    view: "inside",
    note: "Кресла зала",
    hint: "Кресла можно перекрасить, а у GTA 5 RP — ещё заменить моделью игры или убрать",
  },
  lights: {
    label: "Подсветка",
    icon: <Lightning />,
    view: "inside",
    note: "Подсветка зала",
    hint: "Свой цвет подсветки залов Majestic",
  },
  /* Majestic (ТЗ 11.10.2026, ночь): аирдропы, болид и др. — своими моделями. */
  replace: {
    label: "Замена моделей",
    icon: <Package />,
    view: "inside",
    note: "Модели целиком",
    hint: "Своя модель (GLB, glTF, OBJ) или картинка встаёт вместо модели сервера во все её места — и в игре. Подлетите к аирдропу или болиду и щёлкните по нему — откроется именно он",
  },
  /* Majestic (задача 10 ТЗ 18.10.2026, вечер): каждый предмет зала по одному, все такие или всё сразу. */
  items: {
    label: "Предметы зала",
    icon: <CursorClick />,
    view: "inside",
    /* В одну строку под заголовком колонки: длинная переносилась и сдвигала мини-кадр вниз на смене вкладки (29.10). */
    note: "Вещи зала",
    hint: "Щёлкните по предмету в кадре — он обведётся по своим краям; у монитора корпус и экран правятся порознь",
  },
  /* ТЗ 44А, п. 3: список моделей зала с галочкой у каждой. */
  layers: {
    label: "Слои",
    icon: <StackSimple />,
    view: "inside",
    note: "Модели зала",
    hint: "Снимите галочку — модель пропадёт из зала целиком (и из игры), поставьте — вернётся; пол, стены и потолок красятся в своих инструментах",
  },
  star: {
    label: "Звезда",
    icon: <Star />,
    view: "inside",
    note: "Своя фигура на подставке",
    hint: "Своя картинка встанет объёмной фигурой на подставке; камера подойдёт к ней сама",
  },
});

/*
 * Свои подписи раздела у сервера: у Majestic «Плакаты» — картины гоночной
 * зоны, фото гонщиков и баннеры команд (ТЗ 12.10.2026, задача 4), экраны —
 * каждый монитор и планшет по одному.
 */
const SERVER_TOOLS = Object.freeze({
  majestic: Object.freeze({
    posters: {
      label: "Картины и баннеры",
      note: "Картины зала",
      hint: "Своя картинка встаёт на все картины разом или на каждую по одной: подлетите к картине и щёлкните по ней — откроется именно она",
    },
    screens: {
      /* Одной строкой под заголовком (29.10); что каждый — по одному, говорит «?» и строки мест. */
      note: "Экраны зала",
      hint: "У каждого экрана, монитора игрока и планшета на столе — своя картинка: раскройте место или подлетите и щёлкните по нему",
    },
  }),
});

/*
 * Колонка по группам (ТЗ 22.10.2026, п. B): прежние разделы арены — пункты переключателя над панелью, а в колонке — значки
 * групп. В зале: «Отделка» (пол, стены, потолок, подсветка, узоры), «Предметы» (кресла, звезда, автоматы, предметы зала,
 * знаки выхода), «Рисунки» (экраны, таблички, эмблемы зала, плакаты), «Модели» (свои и замена моделей сервера), «Слои»,
 * «Шаблоны». Снаружи: «Отделка» (фасад, узоры), «Рисунки» (эмблемы фасада, текст, логотипы, баннеры),
 * «Модели», «Шаблоны». Память (`arenas:tool`), буквы кадра и панели — прежние.
 */
const ARENA_GROUPS = Object.freeze([
  { id: "finish", ids: ["floor", "walls", "ceiling", "lights", "facade", ...(arenaPlazaEnabled() ? ["plaza"] : []), "patterns"], label: "Отделка", icon: <Wall />, group: "main", demo: "paint" },
  { id: "furniture", ids: ["seats", "star", "objects", "items", "exits"], label: "Предметы", icon: <Rows />, group: "main", demo: "model" },
  { id: "pictures", ids: ["screens", "signs", "logos", "posters", "emblem", "text", "outLogos", "outBanners"], label: "Рисунки", icon: <ImageSquare />, group: "details", demo: "picture" },
  { id: "arena-models", ids: ["models", "replace"], label: "Модели", icon: <Cube />, group: "details", demo: "model" },
]);

/* Колонка инструментов сервера: снаружи, зал, «Шаблоны» последними. */
function arenaTools(server) {
  /* «Текст на фасаде» — сразу за эмблемами фасада. */
  /* «Надпись Maze Bank Arena» — строкой в «Тексте», не своим инструментом. */
  /* ТЗ 44А, п. 5: колонка — три ряда. Снаружи — фасад; «Основное» в зале — то, чем правят арену чаще всего (пол, стены, потолок,
     свет, кресла, у GTA 5 RP — звезда, у Majestic — свои модели вместо штатных); «Детали» — экраны, плакаты, знаки,
     автоматы, предметы и слои. Ничего не убрано, но простое — наверху, без поиска по двадцати значкам. */
  const outside = ARENA_SECTIONS[server].outside;
  const MAIN = ["floor", "walls", "ceiling", "lights", "seats", "star", "replace"];
  const inside = ARENA_SECTIONS[server].inside;
  const main = MAIN.filter((id) => inside.includes(id));
  const details = [...inside.filter((id) => !MAIN.includes(id)), ...(arenaObjects(server) ? ["items"] : []), ...(arenaLayersAvailable(server) ? ["layers"] : [])];
  const rows = [...outside.map((id) => [id, "outside"]), ...main.map((id) => [id, "main"]), ...details.map((id) => [id, "details"])]
    .filter(([id]) => id !== "mazeSign")
    .flatMap(([id, group]) => (id === "emblem" ? [[id, group], ["text", group]] : [[id, group]]));
  /* Цифры — по порядку в колонке своей сцены: у зала и у площади своя «1». */
  const order = { outside: 0, inside: 0 };
  return [
    ...rows.map(([id, group]) => {
      const scene = group === "outside" ? "outside" : "inside";
      const index = order[scene]++;
      return {
        id,
        ...SECTION_TOOLS[id],
        ...(SERVER_TOOLS[server]?.[id] || {}),
        shortcut: index < 9 ? String(index + 1) : index === 9 ? "0" : undefined,
        group,
        scenes: [scene],
      };
    }),
    /* Узор щелчком по фасаду, полу, стенам или потолку (19.10.2026). Подписи под именем панели нет: «Узор щелчком по части модели» — пять слов
       (п. 9 `design-qa.md`), а как класть узор, сказано по «?» панели и подсказкой инструмента. */
    withoutNote(patternTool()),
    /* Свои модели (задача 1 ТЗ 11.10.2026, вечер). */
    /* Без подписи под именем панели: заголовок самой панели — «Свои модели» (подпись повторяла бы его). */
    withoutNote(modelsTool()),
    /* Готовые шаблоны (ТЗ 12.10.2026): игры, праздники, на каждый день. */
    {
      id: "templates",
      label: "Шаблоны",
      icon: <MagicWand />,
      group: "ready",
      note: "Готовые арены",
      hint: "Шаблон меняет всю арену разом — своими картинками и словами; дальше любой раздел правится как обычно",
    },
    /* Своей вкладки «Как в игре» нет (критик 30.10.2026, п. 15): откат всей арены — строкой внизу «Шаблонов» и в «⋯», разделов — внизу раздела. */
  ];
}

/* Что из работы нельзя выразить перекраской листов штатных моделей Majestic: ключ из сборки → слова. */
function unexpressedLines(unexpressed, slabs = 0, plates = 0) {
  const words = {
    surfaces: () => tr("стены, пол и потолок красятся общими листами (перегородки и потолок тоже), раздельного цвета у них нет; чтобы стены были видны, выберите очень тёмный серый, а не чистый чёрный"),
    finishWalls: () => tr("картинка или узор на стенах, полу и потолке"),
    panels: () => tr("свои картинки на местах без своего листа в модели (например, плакаты команд)"),
    facade: () => tr("цвет фасада арены вблизи: на Majestic вблизи фасад остаётся серверным, а вдали цвет ложится"),
    itemsAll: () => tr(slabs || plates ? "перекраска и удаление вещей зала (мебель, будка, кубки), кроме замены аирдропов и объёмной картинки перед экраном: Majestic такие правки не принимает" : "облик и удаление вещей зала: в этой версии у Majestic такие правки не ставятся, чтобы не ломать зал"),
    items: () => tr("цвет вещей зала, у которых в Astral нет файла модели (кресла, зеркальные сиденья, часть декора): остались как были"),
    sharedIslands: () => tr("свои картинки на местах, что смотрят на один лист (например, табло турнира): показана одна из них"),
    replacements: () => tr("свои модели вместо моделей сервера"),
    signs: () => tr("своя надпись на домике"),
  };
  const lines = Object.keys(words)
    .filter((key) => unexpressed?.[key])
    .map((key) => words[key]());
  /* Плита «картинка → объём» на экране-стене: сама стена остаётся серой штатной, картинка стоит перед ней. */
  if (plates) lines.push(tr("картинка на самой стене-экране: стена остаётся серой штатной, объёмная картинка стоит перед ней"));
  return lines;
}

/* Что из особого Majestic принял (arena10): баннеры и экраны листами, замена аирдропов, плита перед экраном. */
function appliedLines(safe) {
  const lines = [];
  if (safe?.onSheets) lines.push(tr("баннеры и экраны листами"));
  if (safe?.slabs) lines.push(tr("замена аирдропов"));
  if (safe?.screenPlates?.length) lines.push(tr("объёмная картинка перед экраном"));
  return lines;
}

function arenaDoneTextBase(result) {
  if (result?.status === "unchanged") return tr("Арена в игре уже такая — ставить было нечего");
  /* Собрана на файлах поставленного мода арены (`atop`, 16.10): человек
     должен знать, что мод не пропал, а правка легла на него. */
  if (result?.atop?.files) return tr("Арена установлена поверх поставленного мода арены — его текстуры остались. Перезапустите игру.");
  /* Majestic не принимает пересобранные модели зала: чего не применилось — словами (`arena-shell-guard.js`), без молчаливой потери. */
  const skipped = unexpressedLines(result?.safeModels?.unexpressed, result?.safeModels?.slabs, result?.safeModels?.screenPlates?.length);
  const applied = appliedLines(result?.safeModels);
  const also = applied.length ? ` ${trFill("Кроме того, на месте: {0}.", applied.join("; "))}` : "";
  if (skipped.length) return `${trFill("Арена установлена безопасным способом: Majestic сейчас не принимает арены с пересобранными моделями зала, поэтому не применено: {0}. Остальное на месте. Перезапустите игру.", skipped.join("; "))}${also}`;
  return `${tr("Арена установлена. Перезапустите игру.")}${also}`;
}

/* Majestic: цвет крупных поверхностей темнее порога поднят до графита — человеку об этом словами (чёрное на чёрном в игре не видно). */
function arenaDoneText(result) {
  const text = arenaDoneTextBase(result);
  if (result?.status === "unchanged" || !result?.safeModels?.lifted?.length) return text;
  return `${text} ${tr("Самый тёмный цвет стен, пола и потолка поднят до графита: чисто чёрный в игре не отражает свет, и стены пропадают.")}`;
}

export default function ArenaStudio({ onExit, onNotice }) {
  /* Кадр — в штатных листах игры (ТЗ 44А, 20.10.2026): золотая звезда, «Fame or Shame», баннеры — как в игре, а не листы
     поставленного мода арены (с 16.10 кадр показывал их — `setSceneOverMods`, теперь режим не включается). */
  /* Открыт из каталога «Редактировать», а мода арены в игре нет — строка
     об этом до правки (`part-notice.js`) и пометка в статусе, пока редактор
     открыт: уведомление живёт секунды, а правят минутами. */
  const [modMissing, setModMissing] = useState(false);
  useEffect(() => {
    const notice = takePartNotice("arenas");
    if (!notice) return;
    setModMissing(true);
    onNotice?.(notice);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз при открытии
  }, []);
  useTr();
  const [view, setView] = useRememberedState("arenas:view", "inside");
  const arenaView = view === "outside" ? "outside" : "inside";
  const [savedTool, setTool] = useRememberedState("arenas:tool", "floor");
  /* К чему подошла камера (звезда, стела площади). */
  const [focus, setFocus] = useState(null);
  /* Взятый элемент раздела (`{ section, key }`: «Баннер фойе 2») — кадр обводит его
     полотно; `aim` растёт с каждым выбором колесом — панель раскрывает его место. */
  const [element, setElement] = useState(null);
  const [aim, setAim] = useState(0);
  /* Строка или плитка панели под курсором (ТЗ 29.10, Модуль Б): кадр обводит то, о чём она, — место, полотно, модель сервера
     (`{ section, key | place }`), а у «Предметов зала» — вещи группы (номера сущностей). */
  const [hovered, setHovered] = useState(null);
  const [hoverItems, setHoverItems] = useState(null);
  /* «Предметы зала»: выбранный предмет (номер сущности), охват и материал стены (у оболочки охват — по материалу). */
  /* `keys` — выбранные вещи по порядку щелчков (Shift — ещё одну, п. 7 `docs/3D-ELEMENTS-PICTURES.md`), `key` — последняя взятая. */
  const [itemSel, setItemSel] = useState({ key: null, keys: [], scope: "one", material: null, part: null, piece: null });
  const [itemFly, setItemFly] = useState(null);
  /* Камера снаружи, подведённая к выбранному из меню (`arena-camera.js`), и выбор, что ждёт свою сцену. */
  const [closeUp, setCloseUp] = useState(null);
  const [pendingFly, setPendingFly] = useState(null);
  /* Кадры предметов для плиток панели: сцена отдаёт снимок (`ArenaStage`), плитки берут готовое из памяти. */
  const shots = useMemo(() => createItemShots(), []);
  const [asset, setAsset] = useState(null);
  /* До первого чтения черновика: плитка мастерской открывает штатную арену, а не мод, забытый в черновике (`arena-mod-open.js`). */
  useState(() => dropForgottenArenaMod(ARENA_STORAGE_KEY));
  const editor = useRecolorEditor({
    set: "arenas",
    contract: CONTRACT,
    storageKey: ARENA_STORAGE_KEY,
    title: tr("Арена"),
    coverSlotId: "arenas",
    onNotice,
    resetNotice: tr("Арена стандартная"),
    savedText: tr("Ставим арену в игру"),
    doneText: arenaDoneText,
    rolledBackText: tr("Арена снята из игры — остальные моды на месте"),
    images: arenaImages,
    stockMeansRemoval: true,
    removalTitle: tr("Снять арену Astral — в игре будет арена игры или сервера"),
    /* «⋯ → Как в игре» — откат зала выбранного сервера (`resetArenasServer`), а не «Как в моде» по умолчанию (п. 15). */
    resetLabel: "Как в игре",
  });
  const { project, commit, replace } = editor;
  const server = project.server;
  const tools = useMemo(() => arenaTools(server), [server]);
  /* Инструмент — из колонки своей сцены (ТЗ 22.10.2026). У Majestic разделов меньше (нет звезды, табличек, автоматов),
     а снаружи свои: взятого здесь нет — пол в зале, фасад на площади. */
  const sceneTools = useMemo(() => toolsOfScene(tools, arenaView), [tools, arenaView]);
  const tool = sceneTools.some((item) => item.id === savedTool) ? savedTool : arenaView === "outside" ? "facade" : "floor";
  const toolFor = useSceneToolMemory(tools, arenaView, tool);

  /* Перелёт задан ниже (`flyTo` ждёт сцену кадра): модели и колонка зовут его через ссылку. */
  const flyRef = useRef(null);
  /* Свои модели: зал Majestic — помещение сервера, его файла в Astral нет. */
  const models = usePlaceModels({
    editor,
    read: readModels,
    write: writeModels,
    scene: `${server}-${arenaView}`,
    tool,
    onTool: setTool,
    where: arenaView === "outside" ? "у арены" : "в зале арены",
    sceneLabel: arenaSceneLabel,
    onSceneChange: (scene) => setView(String(scene).endsWith("-outside") ? "outside" : "inside"),
    /* Строка списка — как прочий выбор из меню: камера подходит к модели (перелёт задан ниже, `flyRef`). */
    onListPick: (item) => flyRef.current?.(placeModelFocusTarget(item)),
    /* Залы Majestic (ТЗ 11.10.2026, ночь): модели вшиваются в модель зала — что там можно, говорит панель. */
    blocked: arenaServerInventory(server) ? "" : "Арены этого сервера нет в этой версии Astral — свои модели сюда не поставить.",
    onNotice,
  });

  /* Эмблемы и надписи на фасаде — списком выбранного сервера; эмблема в руке —
     пока взят её инструмент и картинка есть: левая кнопка ставит её на фасад. */
  /* Страница «Текста»: «» — свои надписи, `mazeSign` — название арены. */
  const [textPage, setTextPage] = useState("");
  const signPage = tool === "text" && textPage === "mazeSign";
  const emblems = useEmblemEditor({
    project,
    commit,
    amend: editor.amend,
    read: readEmblems,
    write: writeEmblems,
    /* На странице названия щелчок по фасаду не ставит новую надпись. */
    active: emblemToolActive(tool) && !signPage,
    kind: emblemKindOf(tool),
    onNotice,
  });
  const placing = emblems.placing;

  /*
   * Взятый инструмент. `menu` — из колонки, пункта переключателя или плитки: камера подводится к тому, что инструмент правит (звезда, кресла, автоматы, знаки выхода, надпись
   * над входом). Щелчок по вещи в кадре (`onAim`) инструмент берёт без перелёта: «щелчок камеру не дёргает» (слово владельца 30.10.2026).
   */
  const onToolStudio = useCallback(
    (next, { menu = false } = {}) => {
      setTool(next);
      setTextPage("");
      setHovered(null);
      setHoverItems(null);
      setPendingFly(null);
      if (next !== "items") setItemFly(null);
      setCloseUp(null);
      /* Сцену инструмент не трогает (ТЗ 22.10.2026): её меняет только переключатель в шапке. Звезда и надпись с
         логотипами снаружи подводят к себе взгляд в своей сцене (надпись — ко входу или к стеле), другой — уводит. */
      setFocus((current) => (menu && next === "star" && project[project.server].star?.mode === "image" ? "star" : menu && ARENA_SIGN_SECTIONS.has(next) ? arenaSignFocus(current) : null));
    },
    [setTool, project],
  );
  /* «Вернуть камеру» у звезды — явный путь домой (п. 23 `design-qa.md`): снятый фокус камеру больше не уводит, возврат — счётчиком кадра. */
  const [cameraHome, setCameraHome] = useState(0);
  const onFocus = useCallback((next) => {
    setFocus(next);
    if (!next) setCameraHome(Date.now());
  }, []);
  const onToolPicked = useCallback(
    (next) => {
      onToolStudio(next, { menu: true });
      if (["seats", "objects", "exits", "lights", "floor", "walls", "ceiling"].includes(next)) flyRef.current?.({ tool: next });
    },
    [onToolStudio],
  );
  const rail = useRailGroups({ groups: ARENA_GROUPS, tools: sceneTools, tool, onTool: onToolPicked, renumber: true });
  const onTool = onToolStudio;
  /* Пункты взятой группы — значком и словом (`ArenaSubTabs`), а не немыми значками общего переключателя. */
  const railGroup = ARENA_GROUPS.find((group) => group.id === rail.tool) || null;
  const members = useMemo(() => (railGroup ? railMembers(railGroup, sceneTools) : []), [railGroup, sceneTools]);
  const activeTool = sceneTools.find((item) => item.id === tool) || null;
  /* Что делает взятый пункт — у «?» имени панели (рисованной карточки над колонкой нет, `design-qa.md`, п. 9): одним «?» с подсказками
     разделов и строками кадра (`panel-help.js`), а не вторым значком в шапке. */
  const toolHint = activeTool?.hint ? [activeTool.hint, ...(activeTool.id === "facade" ? FACADE_HELP : [])].map((text) => tr(text)) : [];

  /* Страница названия арены: взгляд — к надписи у входа или к стеле, как у прежнего инструмента. */
  const onTextPage = useCallback(
    (page, { fly = true } = {}) => {
      if (page === "mazeSign") {
        onTool("text");
        setTextPage("mazeSign");
        if (fly) setFocus((current) => arenaSignFocus(current));
      } else {
        setTextPage("");
        setFocus(null);
      }
    },
    [onTool],
  );

  const onServer = useCallback(
    (next) => {
      setFocus(null);
      commit((current) => ({ ...current, server: next }), next === "majestic" ? tr("Сервер: Majestic") : tr("Сервер: GTA 5 RP"));
    },
    [commit],
  );
  /* Сервер другой — выбор предмета не переезжает: номера сущностей у залов свои. */
  useEffect(() => {
    setItemSel({ key: null, keys: [], scope: "one", material: null, piece: null });
    setItemFly(null);
    setHovered(null);
    setHoverItems(null);
  }, [server]);
  /* Esc — уровнем вверх (ТЗ 29.10, Модуль Б; вариант A разбора 31.10.2026): со страницы части или элемента — к вещи, потом снимает выбранный
     предмет зала, потом взятое полотно или модель сервера; камера стоит. Не в поле ввода, не при окне и не с эмблемой в руке (там
     Esc убирает её из рук) и не у своих моделей (у них Esc свой). Материал оболочки — не уровень: стену выбирают по нему. */
  const selectionNow = useRef({ item: null, element: null });
  selectionNow.current = {
    item: itemSel.key,
    piece: itemSel.piece ?? null,
    material: itemSel.material ?? null,
    structure: Number.isInteger(itemSel.key) && arenaObjectModel(server, itemSel.key)?.kind === "structure",
    several: itemSel.keys?.length > 1,
    element,
  };
  const escapeIdle = placing || models.active;
  useEffect(() => {
    if (escapeIdle) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || isTextEntry(event.target)) return;
      if (document.querySelector("[role='dialog']:not([data-ui-tour])")) return;
      const { item, piece, material, structure, several, element: picked } = selectionNow.current;
      const inside = item !== null && item !== undefined && !several && (piece !== null || (Boolean(material) && !structure));
      if (inside) setItemSel((current) => ({ ...current, piece: null, material: null }));
      else if (item !== null && item !== undefined) setItemSel((current) => ({ ...current, key: null, keys: [], material: null, part: null, piece: null }));
      else if (picked) setElement(null);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [escapeIdle]);
  /* Убранные из игры вещи (работа): в кадре их нет, обвести и выбрать их нельзя. «Спрятать» убрано (ТЗ 26.10.2026): оно
     прятало вещь только в кадре, а в игре оставляло её с тенью. */
  const removedItems = project[server].removed || null;
  const goneItems = removedItems?.length ? removedItems : null;
  const itemEntities = useMemo(() => {
    if (itemSel.key === null) return hoverItems ? new Set(hoverItems) : null;
    /* Несколько вещей — сами вещи, у каждой одна и та же подсветка. */
    const scope = itemSel.keys?.length > 1 ? new Set(itemSel.keys) : arenaObjectScope(server, itemSel.key, itemSel.scope);
    if (!goneItems) return scope;
    const gone = new Set(goneItems);
    return new Set([...scope].filter((key) => !gone.has(key)));
  }, [server, itemSel, goneItems, hoverItems]);
  /* Материал — только у оболочки зала (стена): охват «этот / в комнате / во всей арене» берёт её части этого материала. */
  /* `part` — «screen» или «body»: куда щёлкнули у предмета с экраном (экран монитора — картинка, корпус — сам монитор); без щелчка — `null`. */
  /* `piece` — номер части предмета, модель которого — набор (десяток баннеров одной моделью, `arena-item-parts.js`); `null` — предмет целиком. */
  const onItemSelect = useCallback(
    (key, scope, material = null, part = null, piece = null) =>
      setItemSel((current) =>
        key === null || key === undefined
          ? { key: null, keys: [], scope: current.scope, material: null, part: null, piece: null }
          : { key, keys: [key], scope: scope || current.scope, material, part, piece: Number.isInteger(piece) ? piece : null, click: part ? (current.click || 0) + 1 : current.click },
      ),
    [],
  );
  /* Shift+щелчок по предмету в кадре (и Shift по строке): в набор или из набора, камера стоит (`toggleSelection`, общий с «Предметами»). */
  const onItemToggle = useCallback((key) => setItemSel((current) => ({ ...toggleSelection(current, key), part: null })), []);
  /* Щелчок по пустому месту кадра — выбора нет (п. 7: «Esc или щелчок по пустому — снять выбор»), камера стоит. */
  const onItemClear = useCallback(() => setItemSel((current) => (current.key === null ? current : { ...current, key: null, keys: [], material: null, part: null, piece: null })), []);
  const onItemScope = useCallback((scope) => setItemSel((current) => ({ ...current, scope })), []);
  /* Наведение на группу или строку «Предметов зала»: вещи, что ещё в игре, светятся в кадре, пока курсор на строке. */
  const onItemsHover = useCallback((keys) => setHoverItems(keys?.length ? keys : null), []);
  /* «Удалить»: вещь уходит из работы и из кадра; страница предмета остаётся с «Откатить». «Откатить» — наоборот. */
  const onItemRemove = useCallback(
    (keys, label) => {
      commit((current) => {
        const at = current[current.server];
        /* Убранному предмету облик ни к чему: он уходит из своих групп (опустевшая группа — прочь). */
        const items = at.items?.length ? setArenaItemLook(at.items, keys, null) : at.items;
        return { ...current, [current.server]: { ...at, ...(items ? { items } : {}), removed: [...new Set([...(at.removed || []), ...keys])] } };
      }, label);
    },
    [commit],
  );
  const onItemRestore = useCallback(
    (keys, label) =>
      commit((current) => {
        const at = current[current.server];
        return { ...current, [current.server]: { ...at, removed: (at.removed || []).filter((key) => !keys.includes(key)) } };
      }, label),
    [commit],
  );
  /* Облик предметов (`ItemLook`): своя модель, цвет или картинка выбранным предметам; `null` — как в игре. Групп (копий моделей) не больше предела. */
  const projectNow = useRef(project);
  projectNow.current = project;
  /* `part` — «как в игре» у одной части (`{ box }`): снимается только она; у облика на часть она уже в `look.part`. */
  const onItemLook = useCallback(
    (keys, look, label, part = look?.part || null) => {
      const modelOf = (key) => itemFrameOf(projectNow.current.server, key)?.modelKey || "";
      const now = projectNow.current[projectNow.current.server];
      /* Облик части — только этой части; облик на всю модель и на набор вещей (Shift) — по группе на модель игры одним шагом (перила 77 и 78 под
         одним именем, `setArenaItemLooks`); групп больше предела — отказ с числами. */
      const { refusal } = applyItemLook(now.items, keys, look, modelOf, part);
      if (refusal) {
        onNotice?.(refusal, "error");
        return;
      }
      commit((current) => {
        const at = current[current.server];
        return { ...current, [current.server]: { ...at, items: applyItemLook(at.items, keys, look, modelOf, part).items ?? at.items } };
      }, label);
    },
    [commit, onNotice],
  );
  /*
   * Замена вещи (своя картинка или модель вместо неё) — мышью в кадре (владелец 01.11.2026: «заменил объект на картинку — можешь его перемещать»):
   * сдвиг сцены от начала протяжки → в оси модели первой вещи группы и прибавляется к сдвигу облика (`itemMoveLook`, общее с местами).
   */
  const onItemMove = useCallback(
    (key, delta) => {
      const server = projectNow.current.server;
      const moved = itemMoveLook(projectNow.current[server].items, key, delta, (item) => arenaItemPlace(server, item));
      if (moved) onItemLook(moved.keys, moved.look, tr("перемещение"));
    },
    [onItemLook],
  );
  /* «Найти в зале»: у части (`piece`) или элемента (`texture`) — камера к нему самому, а не к середине всей модели. */
  const onItemFind = useCallback(
    (key, piece = null, texture = null) => {
      const part = Number.isInteger(piece) ? arenaItemParts(asset, server, key)?.[piece] : null;
      const element = texture ? arenaItemElements(asset, server, key).find((entry) => entry.texture === texture) : null;
      const box = element?.box ? { min: element.box[0], max: element.box[1] } : part ? part.sceneBox : entityBounds(asset).get(key);
      const flight = itemFocus(arenaServerInventory(server)?.view?.inside?.eye, box, { asset, key });
      if (flight) setItemFly({ ...flight, at: Date.now() });
      else onNotice?.(tr("Этого предмета нет в кадре."), "info");
    },
    [asset, server, onNotice],
  );
  /*
   * Камера к выбранному из меню (слово владельца 30.10.2026): полотно, экран, табличка, место, модель сервера, предмет, кресла, автоматы, знаки выхода. Изнутри — тот же перелёт,
   * что «Найти в зале» (`itemFly`), снаружи — рамка кадра (`closeUp`); пока сцена другая, выбор ждёт её (`pendingFly`) и камера летит, как только она встала. Щелчок по вещи в кадре
   * сюда не ходит. `target` — как у `arenaMenuFocus` или `{ tool }`.
   */
  const homeEye = arenaServerInventory(server)?.view?.inside?.eye || null;
  const assetScene = asset ? (asset.parts?.some((part) => (part?.id ?? part) === "facade") ? "outside" : "inside") : "";
  const flyTo = useCallback(
    (target) => {
      if (!target) return;
      const scene = flightScene(server, target);
      if (assetScene !== scene) {
        if (arenaView !== scene) setView(scene);
        setPendingFly(target);
        return;
      }
      const focus = target.tool ? arenaToolFocus(server, target.tool, { asset, home: homeEye, view: arenaServerInventory(server)?.view?.inside }) : arenaMenuFocus(server, target, { asset, home: homeEye });
      if (!focus) return;
      if (focus.inside) {
        setCloseUp(null);
        setItemFly({ ...focus.inside, at: Date.now() });
      } else if (focus.outside) {
        setItemFly(null);
        setCloseUp({ ...focus.outside, at: Date.now() });
      }
    },
    [server, asset, assetScene, arenaView, homeEye, setView],
  );
  flyRef.current = flyTo;
  useEffect(() => {
    if (!pendingFly || !asset) return;
    if (assetScene !== flightScene(server, pendingFly)) return;
    setPendingFly(null);
    flyTo(pendingFly);
  }, [pendingFly, asset, assetScene, server, flyTo]);
  /* Выбор из списка и плитки — с перелётом; щелчок по вещи в кадре — без него. */
  const onElementMenu = useCallback(
    (value) => {
      setElement(value);
      if (value?.key) flyTo({ section: value.section, key: value.key });
    },
    [flyTo],
  );
  /* Части предмета для панели (`arena-item-parts.js`): `null` — поток ещё считает, `[]` — одна часть, иначе `{ index, label, box, … }` по порядку. */
  const itemPartsOfKey = useCallback((key) => arenaItemParts(asset, server, key), [asset, server]);
  /*
   * Камера к выбранному сама (ТЗ 29.10.2026, вечер: «Найти в зале» отдельной кнопкой нет): выбор справа — строкой списка, стрелками ‹ ›
   * «3 из 6», частями — подводит камеру к вещи или к её части. Щелчок в кадре камеру не двигает (вещь и так видна): он идёт мимо этих
   * обёрток, прямо в `onItemSelect` (`onAim`).
   */
  const onPanelSelect = useCallback(
    (key, scope, material = null, part = null, piece = null) => {
      onItemSelect(key, scope, material, part, piece);
      if (key === null || key === undefined || key === "") return;
      /* Часть — к самой части (`onItemFind`); предмет целиком — тем же перелётом, что и прочий выбор из меню (`flyTo`: из сцены снаружи — сначала в зал). */
      if (Number.isInteger(piece)) onItemFind(key, piece);
      else flyTo({ item: key });
    },
    [onItemSelect, onItemFind, flyTo],
  );
  /* Листание частей справа (‹ ›): часть выбрана — и камера подходит к ней; `null` — предмет целиком (камера к нему). */
  const onItemPiece = useCallback((key, piece) => onPanelSelect(key, "one", null, null, piece), [onPanelSelect]);
  /* Элемент вещи справа (строка «Из чего», стрелки ‹ ›): взят — подсвечен (`material` выбора — имя листа) и камера подходит к нему; `null` — вся вещь. */
  const onItemElement = useCallback(
    (key, texture) => {
      if (!texture) return onPanelSelect(key, undefined);
      onItemSelect(key, undefined, texture);
      onItemFind(key, null, texture);
    },
    [onPanelSelect, onItemSelect, onItemFind],
  );
  /* «Показать» на плашке «… за кадром» и клавиша F (как «Frame selected» в Blender и Unity; ловит кадр, `use-selection-offstage.jsx`): подлететь к выбранному. */
  const onShowSelected = useCallback(() => {
    const { item, piece, material, structure } = selectionNow.current;
    if (item !== null && item !== undefined) onItemFind(item, piece, structure ? null : material);
  }, [onItemFind]);
  const patchServer = useCallback(
    (id, values, label) => commit((current) => ({ ...current, [current.server]: { ...current[current.server], [id]: { ...current[current.server][id], ...values } } }), label),
    [commit],
  );
  /* Покраска стен комнаты (или всей арены) — запись `комната|материал` в разделе `shellPaint`; `null` — как было. */
  const onShellPaint = useCallback(
    (room, material, colour) => patchServer("shellPaint", { [shellPaintKey(room, material)]: colour || null }, tr("Покраска стен")),
    [patchServer],
  );
  const onSurface = useCallback(
    (id, values, label) => {
      setFocus(null);
      patchServer(id, values, label);
    },
    [patchServer],
  );
  /* «Узоры»: фасад снаружи, пол, стены и потолок в зале — узор в руке ложится туда, куда щёлкнули. */
  const stamp = usePatternStamp("arena", {
    onNotice,
    miss: tr("Сюда узор не ляжет — щёлкните по фасаду, полу, стенам или потолку."),
    apply: useCallback(
      (target, finish) => {
        /* Площадь — только цвет: узор на ней не ложится. */
        if (!target || target.tool === "plaza" || !ARENA_SURFACES.includes(target.tool)) return null;
        const label = ARENA_SECTION_LABELS[target.tool] || target.tool;
        onSurface(target.tool, finish, `${label}: узор`);
        return tr(label);
      },
      [onSurface],
    ),
  });
  /* Правка звезды, надписи или логотипов подводит к ним взгляд; правка другого раздела — уводит. */
  const onSection = useCallback(
    (id, values, label) => {
      setFocus((current) => (id === "star" ? "star" : ARENA_SIGN_SECTIONS.has(id) ? arenaSignFocus(current) : null));
      patchServer(id, values, label);
    },
    [patchServer],
  );
  /* Эмблему ставят на фасад — её инструмент живёт только снаружи, кадр уже там. */
  const onPlacing = useCallback((on) => emblems.setPlacing(Boolean(on)), [emblems]);
  /* Переключатель сцены в шапке — единственное, что меняет кадр. Взятого инструмента в той сцене нет — взят тот,
     которым там правили последним (в первый раз — пол или фасад). */
  const onView = useCallback(
    (next) => {
      setView(next);
      setFocus(null);
      setElement(null);
      setTextPage("");
      setCloseUp(null);
      setItemFly(null);
      setPendingFly(null);
      setTool(toolFor(next, next === "outside" ? "facade" : "floor"));
    },
    [setView, setTool, toolFor],
  );
  const onStandard = useCallback(() => {
    setFocus(null);
    replace((current) => CONTRACT.standard(current), server === "majestic" ? tr("Как на сервере: арена Majestic") : tr("Стандарт GTA: штатная арена"));
  }, [replace, server]);

  /*
   * Шаблон (ТЗ 12.10.2026): его PNG — в хранилище окна, поля — в работу
   * выбранного сервера. Плитка отмечена, пока работа совпадает с шаблоном.
   */
  const [templateBusy, setTemplateBusy] = useState("");
  const [applied, setApplied] = useState(null);
  const onTemplate = useCallback(
    async (template) => {
      setTemplateBusy(template.id);
      try {
        const pictures = await saveArenaTemplatePictures(template.id);
        setFocus(null);
        setApplied({ id: template.id, signature: arenasProjectSignature(applyArenaTemplate(project, template.id, pictures)) });
        replace((current) => applyArenaTemplate(current, template.id, pictures), `Шаблон «${template.label}»`);
        onNotice?.(`Шаблон «${template.label}» на арене ${server === "majestic" ? "Majestic" : "GTA 5 RP"}. Любой раздел слева можно поправить — картинки, слова, цвета.`, "success");
      } catch (error) {
        onNotice?.(String(error?.message || error), "error");
      } finally {
        setTemplateBusy("");
      }
    },
    [project, replace, server, onNotice],
  );
  const currentTemplate = useMemo(() => (applied && arenasProjectSignature(project) === applied.signature ? applied.id : ""), [applied, project]);

  /*
   * Щелчок и нажатие колеса по кадру (ТЗ 11.10.2026, ночь: «подлетел, нажал колёсико — редактируется именно этот баннер»; 30.10.2026: «выбрал звезду —
   * открылся редактор именно с ней»): `route` — решение `arenaPickRoute`, то же, что обвело наведение. Вещь со своим инструментом (кресла, звезда, автоматы,
   * знаки выхода, экраны, таблички, эмблемы, плакаты, подсветка) открывает его — и сам элемент, если у места они по одному; предмет без инструмента —
   * «Предметы зала» с ним одним (охват «Только этот», а не тот, что остался от прошлого выбора); стена, пол и потолок — свой инструмент отделки;
   * своя модель — «Модели».
   */
  const onAim = useCallback(
    (hit, route) => {
      if (models.onAim?.(hit)) return;
      /* Мимо выбранной своей модели: сначала снять выбор (как щелчок мимо у вещей), инструмент «Модели» остаётся; следующий щелчок берёт то, что под ним. */
      if (models.active && models.edit.selected) {
        models.edit.deselect();
        return;
      }
      if (!route) {
        onNotice?.(tool === "items" ? tr("Здесь предмета нет — щёлкните по предмету зала.") : "Здесь править нечего — щёлкните по полотну, экрану, табличке, стене или креслам.", "info");
        return;
      }
      if (route.kind === "item") {
        if (tool !== "items") onTool("items");
        setElement(null);
        /* Оболочка в «Предметах зала» держит охват (по материалу: «в комнате», «во всей арене»); предмет — один. */
        const structure = arenaObjectModel(server, route.entity)?.kind === "structure";
        if (structure) {
          onItemSelect(route.entity, undefined, route.material, route.part, null);
          return;
        }
        /* Shift — ещё предмет в набор или прочь из него (п. 7 `docs/3D-ELEMENTS-PICTURES.md`). */
        if (hit?.additive) {
          onItemToggle(route.entity);
          return;
        }
        /* Вариант A разбора 31.10.2026 (как в Figma): первый щелчок — вещь целиком; второй по уже выбранной — элемент под курсором (лист
           модели), а у вещи из одного листа — часть (баннер из десятка). Охват и камера при этом стоят. */
        const again = !selectionNow.current.several && selectionNow.current.item === route.entity;
        const texture = again ? arenaElementAt(asset, server, hit) : null;
        const piece = again && !texture ? (hit.piece ?? null) : null;
        onItemSelect(route.entity, again ? undefined : "one", texture, route.part, piece);
        return;
      }
      const target = route.target;
      /* Надпись над входом и на стелах — страница названия в «Тексте». */
      if (target.tool === "mazeSign") onTextPage("mazeSign", { fly: false });
      else onTool(target.tool);
      setElement(target.key ? { section: target.tool, key: target.key } : null);
      if (target.key) setAim((count) => count + 1);
    },
    [models, onTool, onTextPage, onNotice, tool, server, asset, onItemSelect, onItemToggle],
  );

  const deferred = useDeferredValue(project);
  const label = server === "majestic" ? "Majestic" : "GTA 5 RP";
  /* Кадр арены для «Студии»: тот же кадр (тот же вид) с работой, где на месте поверхности стоит холст студии. */
  const renderLive = useCallback((live) => <ArenaStage project={live} view={arenaView} />, [arenaView]);
  /* Из арены мода — к штатной: кнопкой, отказом кадра или когда мод сняли с каталога. Шаг отмены возвращает мод обратно. */
  const onLeaveMod = useCallback(() => {
    forgetArenaModOpen();
    replace(withoutArenaMod, tr("Штатная арена"));
  }, [replace]);
  const onExitMod = useCallback(() => {
    forgetArenaModOpen();
    onExit?.();
  }, [onExit]);

  /* Работа открыта на арене мода (25.10.2026, «Редактировать» у арены каталога): зал мода и его листы — своя студия на той же работе. */
  if (project.mod) return <ArenaModStudio editor={editor} onExit={onExitMod} onStandard={onLeaveMod} onNotice={onNotice} />;

  return (
    <EditorShell
      className="fx-editor recolor-editor arena-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская арены")}
      status={[editor.status, label, modMissing ? tr("мод арены не поставлен") : ""].filter(Boolean).join(" · ")}
      tabs={<PageTabs role="group" label={tr("Сервер")} options={SERVER_OPTIONS} value={server} onChange={onServer} />}
      scene={{
        label: tr("Откуда смотреть"),
        /* Значки сцены (шапка одной дорожкой, 29.10): ряды кресел — зал, здание — площадь. */
        options: [
          { value: "inside", label: tr("Внутри зала"), icon: <Rows /> },
          { value: "outside", label: tr("Снаружи"), icon: <Buildings /> },
        ],
        value: arenaView,
        onChange: onView,
      }}
      tools={rail.tools}
      tool={rail.tool}
      onTool={rail.onTool}
      /* Рисованной карточки над колонкой нет (`design-qa.md`, п. 9, 30.10.2026): картинка — это кадр. */
      toolCards={false}
      guide={models.active ? models.guide : editor.guide(placing && arenaView === "outside", { aim: "править то, что под курсором" })}
      guideKey="arena"
      actions={
        <EditorActions {...editor.actionProps({ compare: true })} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <>
          <RebuiltArenaBanner editor={editor} />
          <PanelHint paragraphs={toolHint} />
          <ArenaSubTabs members={members} value={tool} onChange={onToolPicked} server={server} />
          {models.active ? (
            models.panel
          ) : tool === "patterns" ? (
            stamp.panel
          ) : (
            <StudioLiveProvider project={project} render={renderLive}>
              <ArenaInspector
                tool={tool}
                project={project}
                onStandard={onStandard}
                onSurface={onSurface}
                onSection={onSection}
                emblems={emblems}
                onNotice={onNotice}
                onPlacing={onPlacing}
                textPage={textPage}
                onTextPage={onTextPage}
                focus={focus}
                onFocus={onFocus}
                element={element}
                onElement={onElementMenu}
                aim={aim}
                onHover={setHovered}
                onFly={flyTo}
                items={{
                  selection: itemSel,
                  onSelect: onPanelSelect,
                  /* Shift по строке — в набор или из набора (страница «N вещей» — у панели). */
                  onToggle: onItemToggle,
                  onScope: onItemScope,
                  onShellPaint,
                  shellPaint: project[server].shellPaint || null,
                  shots,
                  home: arenaServerInventory(server)?.view?.inside?.eye || null,
                  onTool,
                  onFind: onItemFind,
                  partsOf: itemPartsOfKey,
                  onPiece: onItemPiece,
                  onElement: onItemElement,
                  asset,
                  removed: removedItems,
                  onRemove: onItemRemove,
                  onRestore: onItemRestore,
                  onLook: onItemLook,
                  onHover: onItemsHover,
                }}
                template={currentTemplate}
                templateBusy={templateBusy}
                onTemplate={onTemplate}
              />
            </StudioLiveProvider>
          )}
        </>
      }
    >
      <ArenaStage
        cameraHome={cameraHome}
        project={editor.shown(emblems.hide(deferred))}
        comparing={editor.comparing}
        shots={shots}
        view={arenaView}
        focus={focus}
        closeUp={closeUp}
        placing={placing}
        placingLabel={emblemPlacingLabel(tool)}
        onPlace={emblems.place}
        onAdjust={emblems.adjust}
        textStage={emblems.stage}
        onPlaced={() => emblems.setPlacing(false)}
        onCamera={editor.onCamera}
        {...models.stageProps}
        /* После свойств «Моделей»: выбор колесом арены сам спрашивает их первыми. */
        onAim={tool === "patterns" ? stamp.onAim : onAim}
        tool={models.active ? "" : tool}
        /* «Слои»: строка под курсором светит вещи своей модели — тем же путём, что у «Предметов зала», пока курсор на ней. */
        items={{ active: (tool === "items" || (tool === "layers" && Boolean(hoverItems))) && !models.active, key: itemSel.key, keys: itemSel.keys, scope: itemSel.scope, material: itemSel.material, part: itemSel.part, piece: itemSel.piece, entities: itemEntities, onClear: onItemClear, onToggle: onItemToggle, focus: itemFly, hidden: goneItems, onShow: onShowSelected, onMove: onItemMove }}
        onAsset={setAsset}
        highlight={hovered?.section === tool ? hovered : element?.section === tool ? element : null}
        overlay={models.bar}
      />
      {editor.works.dialogs}
    </EditorShell>
  );
}
