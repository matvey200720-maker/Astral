import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowUp,
  ArrowsOut,
  ArrowsOutCardinal,
  Circle,
  CircleNotch,
  CirclesThree,
  Crosshair,
  Disc,
  Eye,
  Lightning,
  Palette,
  Plus,
  Rows,
  Scan,
  Sparkle,
  Square,
  SquaresFour,
  Swatches,
  Target,
  TextT,
} from "../../ui/icons.jsx";
import {
  editAmmoCounter,
  damageCounterForProject,
  editDamageCounter,
  editReloadIndicator,
  normalizeAmmoCounter,
  normalizeDamageCounter,
  normalizeOrdinaryReticle,
  normalizeReloadIndicator,
  normalizeReticleAnimation,
  normalizeSniperReticle,
  ordinaryStyleOf,
  reticlePresetConfig,
  sniperStyleOf,
} from "@modovik/reticle-contract";
import { useWorkActions } from "../../../features/workshop/works/useWorkActions.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { useRailGroups } from "../../ui/useRailGroups.jsx";
import EditorActions from "../../ui/EditorActions.jsx";
import EditorShell from "../../ui/EditorShell.jsx";
import PageTabs from "../../ui/PageTabs.jsx";
import ReticleStage from "./reticle/ReticleStage.jsx";
import ReticleStyles from "./reticle/ReticleStyles.jsx";
import ReticlePresets from "./reticle/ReticlePresets.jsx";
import { ReticleVariantsPanel, variantTitle } from "./reticle/ReticleVariants.jsx";
import {
  SHARED_VARIANT,
  addVariantPatch,
  removeVariantPatch,
  reticleVariants,
  variantLookPatch,
  variantWeaponsPatch,
} from "./reticle/reticle-weapons.js";
import {
  OrdinaryInspector,
  SniperInspector,
} from "./reticle/ReticleInspector.jsx";
import { ReticleAmmoPanel } from "./reticle/ReticleAmmo.jsx";
import { ReticleDamagePanel, previewDamage, previewWeapon } from "./reticle/ReticleDamage.jsx";
import { ReticleReloadPanel } from "./reticle/ReticleReload.jsx";
import ReticleAnimationPanel from "./reticle/ReticleAnimation.jsx";
import { useReticleAnimationPreview } from "./reticle/reticle-animation-preview.js";
import { useProject } from "../../../features/catalog/catalog-projects.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";

/*
 * Редактор прицела: обычный прицел и снайперская оптика.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): части
 * прицела и то, что касается его целиком, — инструменты слева, справа —
 * настройки только взятого, кадр — на весь центр. «Обычный» и «Снайперский»
 * — вкладки в шапке, как сервер у арены (владелец, 10.10.2026): это выбор
 * предмета работы, а не инструмент, и у каждого свой набор инструментов. Готовые прицелы — инструмент
 * «Шаблоны», последним в колонке.
 *
 * Прицел собирается из частей — линии, точка, кольцо (целое или дугами),
 * уголки, шеврон; у снайперки ещё толстые края, деления, шкала поправок и
 * свой цвет центра. Вид — это набор частей: выбрал «Кольцо с точкой» — стоят
 * кольцо и точка, остальное убрано, цвета остались. Какой вид выбран, не
 * хранится, а узнаётся по частям (`ordinaryStyleOf`).
 *
 * Геометрия — из `@modovik/reticle-contract`, та же, что уходит в
 * `hud_reticle.gfx`: сцена 1280×720, объединение фигур без перекрытий,
 * цвета так, как их красит игра.
 *
 * Прицел на оружие (задача 4 ТЗ 07.10.2026; варианты — владелец, 31.10.2026):
 * инструмент «Оружие» — список вариантов, как у трассеров. Новый вариант — копия
 * взятого, ему отмечают стволы; всё, что правится, правится у выбранного варианта,
 * первый стоит у всего остального оружия (`reticle/reticle-weapons.js`). У
 * снайперской оптики вариантов нет: она одна на все снайперки. Одно «Применить»
 * ставит всё одним пакетом.
 *
 * Счётчик патронов (задача 12 ТЗ 10.10.2026) — инструмент «Патроны» в обеих
 * вкладках: блок оружия игры в hud.gfx своим видом (`reticle/ReticleAmmo.jsx`).
 * Он один на все стволы и лежит в модуле обычного прицела (`ammo`), а
 * правится и со вкладки «Снайперский».
 *
 * Счётчик урона (владелец, 30.10.2026) — инструмент «Счётчик урона» там же и
 * так же: один на все стволы, в модуле обычного прицела (`damageCounter`).
 * Игра не сообщает размер урона, поэтому считается он по стволу в руках
 * (`reticle/ReticleDamage.jsx`, `apps/desktop/src/reticle-damage-gfx.js`).
 *
 * Индикатор перезарядки (владелец, 14.11.2026) — инструмент «Перезарядка» там
 * же и так же (`reloadIndicator`). Игра не шлёт слова «перезарядка», поэтому
 * индикатор видит её по числам патронов (`reticle/ReticleReload.jsx`,
 * `apps/desktop/src/reticle-reload-gfx.js`).
 *
 * Полоски HP над игроком здесь нет: утром 11.10.2026 она была инструментом
 * прицела, днём владелец вынес её в свой редактор «Полоска HP»
 * (`features/workshop/target-hp-editor`). Сохранённая в модуле прицела
 * полоска (`targetHealth`) не трогается — с неё начинается работа нового
 * редактора.
 */

/*
 * Инструменты. Кадр двумерный и полёта камеры у него нет, поэтому горячие
 * клавиши — буквы: V — вид, L — линии, D — точка, R — кольцо, K — шеврон,
 * C — цвет, O — обводка, T — шаблоны — одни и те же у обоих видов прицела.
 * `hint` — подсказка над кадром при первом взятии, `note` — строка под
 * заголовком панели.
 */
const stylesTool = () => ({
  id: "styles",
  label: tr("Вид"),
  icon: <SquaresFour />,
  shortcut: "v",
  group: "look",
  note: tr("Набор частей прицела одним щелчком"),
  hint: tr("Выберите вид — части встанут сами, а цвета останутся вашими"),
});
/* Счётчик патронов — у обоих видов прицела, одним инструментом. */
const ammoTool = () => ({
  id: "ammo",
  label: tr("Патроны"),
  icon: <TextT />,
  shortcut: "a",
  group: "whole",
  note: tr("Счётчик в обойме и в запасе — один на все стволы"),
  hint: tr("Перетащите счётчик в кадре — любая правка включает его, цифры в игре считает сама игра"),
});
/* Счётчик урона — тоже у обоих: он лежит поверх прицела и оптики, один на всё. */
const damageTool = () => ({
  id: "damage",
  label: tr("Счётчик урона"),
  icon: <Lightning />,
  shortcut: "u",
  group: "whole",
  note: tr("Сумма попаданий поверх прицела"),
  hint: tr("Перетащите число в кадре, а «Выстрел» покажет сумму, перелив и сброс"),
});
/* Индикатор перезарядки (14.11.2026) — тоже у обоих: заливка у прицела, одна на все стволы. */
const reloadTool = () => ({
  id: "reload",
  label: tr("Перезарядка"),
  icon: <CircleNotch />,
  shortcut: "e",
  group: "whole",
  note: tr("Заливка у прицела, пока ствол перезаряжается"),
  hint: tr("Выберите готовый индикатор и нажмите «Перезарядка» — кадр покажет, как он заливается в игре"),
});
/* Анимация (10.11.2026): затухание, появление, пульс на попадании и перелив — одна на оба вида прицела, лежит в модуле обычного (`animation`). */
const animationTool = () => ({
  id: "animation",
  label: tr("Анимация"),
  icon: <Sparkle />,
  shortcut: "n",
  group: "whole",
  note: tr("Затухание, пульс на попадании и перелив цвета"),
  hint: tr("Включите нужное и нажмите «Показать затухание» или «Показать попадание» — кадр сыграет то, что соберёт Astral"),
});
const templatesTool = () => ({
  id: "templates",
  label: tr("Шаблоны"),
  icon: <Swatches />,
  shortcut: "t",
  group: "ready",
  note: tr("Готовые прицелы целиком"),
  hint: tr("Готовый прицел встаёт целиком — дальше любую часть можно поправить"),
});

/* Оружие: варианты прицела, как у трассеров. У снайперки инструмента нет — оптика одна на все. */
const weaponsTool = () => ({
  id: "weapons",
  label: tr("Оружие"),
  icon: <Crosshair />,
  shortcut: "w",
  group: "look",
  note: tr("Для какого оружия этот прицел"),
  hint: tr("Новый прицел — для других стволов: отметьте их, и правки пойдут только в него"),
});

const ordinaryTools = () => [
  stylesTool(),
  weaponsTool(),
  {
    id: "lines",
    label: tr("Линии"),
    icon: <Plus />,
    shortcut: "l",
    group: "parts",
    note: tr("Длина, толщина, зазор и стороны креста"),
    hint: tr("Тяните ползунки справа; сторону креста убирают кнопкой — выйдет T-образный"),
  },
  {
    id: "dot",
    label: tr("Точка"),
    icon: <Disc />,
    shortcut: "d",
    group: "parts",
    note: tr("Точка в центре: размер и форма"),
    hint: tr("Включите точку выключателем справа и выберите ей форму"),
  },
  {
    id: "ring",
    label: tr("Кольцо"),
    icon: <Circle />,
    shortcut: "r",
    group: "parts",
    note: tr("Целое кольцо или дуги"),
    hint: tr("Разбейте кольцо на части — появятся промежуток и поворот дуг"),
  },
  {
    id: "brackets",
    label: tr("Уголки"),
    icon: <Scan />,
    shortcut: "b",
    group: "parts",
    note: tr("Рамка из четырёх уголков"),
    hint: tr("Длина уголка от двух размеров рамки смыкает их в квадрат"),
  },
  {
    id: "chevron",
    label: tr("Шеврон"),
    icon: <ArrowUp />,
    shortcut: "k",
    group: "parts",
    note: tr("Галочка: вершина — точка прицеливания"),
    hint: tr("Сдвиг вниз опускает галочку под центр — как у ACOG"),
  },
  {
    id: "colour",
    label: tr("Цвет"),
    icon: <Palette />,
    shortcut: "c",
    group: "paint",
    note: tr("Цвет прицела и цвет на цели"),
    hint: tr("Возьмите цвет из палитры или впишите код — прицел перекрасится целиком"),
  },
  {
    id: "outline",
    label: tr("Обводка"),
    icon: <Square />,
    shortcut: "o",
    group: "paint",
    note: tr("Край, с которым прицел читается на небе"),
    hint: tr("На светлом небе прицел без обводки теряется: задайте ей толщину и цвет"),
  },
  {
    id: "size",
    label: tr("Размер и поворот"),
    icon: <ArrowsOut />,
    shortcut: "s",
    group: "whole",
    note: tr("Масштаб всего прицела и наклон"),
    hint: tr("Тяните «Размер» — сколько это пикселей на 1080p, написано в панели"),
  },
  {
    id: "visibility",
    label: tr("Видимость"),
    icon: <Eye />,
    shortcut: "h",
    group: "whole",
    note: tr("Когда прицел гаснет и отметка попадания"),
    hint: tr("Выберите, когда прицел гаснет; «Попадание» в панели покажет отметку игры"),
  },
  animationTool(),
  ammoTool(),
  damageTool(),
  reloadTool(),
  templatesTool(),
];

const sniperTools = () => [
  stylesTool(),
  {
    id: "lines",
    label: tr("Перекрестие"),
    icon: <Plus />,
    shortcut: "l",
    group: "parts",
    note: tr("Линии сетки до краёв линзы"),
    hint: tr("Длина — доля пути до края экрана; сторону убирают кнопкой"),
  },
  /* Края и деления живут на линиях перекрестия: без него этих инструментов
     в колонке нет (`hidden`), как прежде не было их разделов. */
  {
    id: "posts",
    label: tr("Толстые края"),
    icon: <ArrowsOutCardinal />,
    shortcut: "p",
    group: "parts",
    note: tr("Толстые столбики у краёв, как у дуплекса"),
    hint: tr("Начало от центра решает, где тонкая линия переходит в столбик"),
  },
  {
    id: "divisions",
    label: tr("Деления"),
    icon: <CirclesThree />,
    shortcut: "m",
    group: "parts",
    note: tr("Риски или точки на линиях"),
    hint: tr("Выберите вид делений — риски или точки, как у mil-dot"),
  },
  {
    id: "dot",
    label: tr("Точка"),
    icon: <Disc />,
    shortcut: "d",
    group: "parts",
    note: tr("Центральная точка"),
    hint: tr("Включите точку выключателем справа и задайте ей размер"),
  },
  {
    id: "ring",
    label: tr("Кольцо"),
    icon: <Circle />,
    shortcut: "r",
    group: "parts",
    note: tr("Целое кольцо или дуги"),
    hint: tr("Разбейте кольцо на части — появятся промежуток и поворот дуг"),
  },
  {
    id: "chevron",
    label: tr("Шеврон"),
    icon: <ArrowUp />,
    shortcut: "k",
    group: "parts",
    note: tr("Галочка под центром, как у ACOG и ПСО"),
    hint: tr("Включите шеврон и задайте ему ширину, высоту и толщину"),
  },
  {
    id: "holdover",
    label: tr("Шкала поправок"),
    icon: <Rows />,
    shortcut: "h",
    group: "parts",
    note: tr("Отметки под центром для дальней стрельбы"),
    hint: tr("Число отметок, шаг и прирост ширины — справа"),
  },
  {
    id: "colour",
    label: tr("Цвет"),
    icon: <Palette />,
    shortcut: "c",
    group: "paint",
    note: tr("Цвет сетки и свой цвет центра"),
    hint: tr("Свой цвет центра красит точку, кольцо и шевроны отдельно от сетки"),
  },
  {
    id: "outline",
    label: tr("Обводка"),
    icon: <Square />,
    shortcut: "o",
    group: "paint",
    note: tr("Край сетки на ярком фоне"),
    hint: tr("На светлом небе сетка без обводки теряется: задайте ей толщину и цвет"),
  },
  {
    id: "optics",
    label: tr("Оптика"),
    icon: <Target />,
    shortcut: "z",
    group: "whole",
    note: tr("Линза, отметки игры и поворот сетки"),
    hint: tr("«Хевик» и «Снайперка» в углу кадра показывают отметки каждой оптики"),
  },
  animationTool(),
  ammoTool(),
  damageTool(),
  reloadTool(),
  templatesTool(),
];

/*
 * Колонка по группам (ТЗ 22.10.2026, п. B): у обычного прицела двенадцать значков, у снайперки тринадцать — стало шесть и пять.
 * «Части» (линии, точка, кольцо, уголки, шеврон; у снайперки ещё края, деления и шкала поправок), «Цвет» (цвет и обводка),
 * «Размер и поворот» (+ видимость; у снайперки — «Оптика»), «Вид», «Патроны», «Шаблоны». Буквы прежние.
 */
const RETICLE_GROUPS = Object.freeze([
  { id: "parts", ids: ["lines", "posts", "divisions", "dot", "ring", "brackets", "chevron", "holdover"], label: "Части", icon: <Plus />, group: "parts", demo: "select" },
  { id: "paint", ids: ["colour", "outline"], label: "Цвет", icon: <Palette />, group: "paint", demo: "paint" },
  { id: "whole", ids: ["size", "visibility", "optics", "animation"], group: "whole", demo: "size" },
]);

/* Управление кадром: на сцене прицела мышью ничего не таскают — органы кадра
   в его углу, а история и сохранение — с клавиатуры. */
const reticleGuide = () => [
  { keys: ["Ctrl", "Z"], text: tr("отменить") },
  { keys: ["Ctrl", "S"], text: tr("сохранить") },
];

/* Куда уйти, когда взятого инструмента у вида прицела нет: края и деления
   без перекрестия — к самому перекрестию, остальное — к «Виду». */
const TOOL_FALLBACK = Object.freeze({ posts: "lines", divisions: "lines" });

/* Инструменты, что правят не вид варианта: один на всё оружие или сам список. */
const VARIANT_FREE_TOOLS = new Set(["weapons", "visibility", "ammo", "damage", "reload", "animation"]);

/* Плитка вида стоит на той же матовой подложке, что и кадр. */
const RETICLE_PLATE = "#141517";

export default function ReticleCustomizer({
  project,
  activeModuleId,
  ordinary,
  sniper,
  dirty,
  canUndo,
  canRedo,
  /* «Мои работы» и коды — от студии (workshop-studio/studio-works.js). */
  works,
  onModuleChange,
  onPatch,
  onUndo,
  onRedo,
  onApply,
  /* Надпись занятой кнопки, пока работа ждёт очереди или ставится: очередь
     применения общая на всё окно, и знает о ней студия. */
  applyBusy = "",
  /* Ход записи для заливки «Применить» (`useWorkshopApplyButton`). */
  applyMeter = null,
  applyHint = "",
  onCancel,
  onReset,
}) {
  useTr();
  const language = useUiLanguage();
  const kind = activeModuleId === "sniper-scope" ? "sniper" : "ordinary";
  /* Выбранный вариант помнится, пока редактор открыт и после; у снайперского
     прицела вариантов нет — оптика одна на все снайперки. */
  const [rememberedVariant, setVariantId] = useRememberedState("reticle:variant", SHARED_VARIANT);
  const variants = useMemo(() => reticleVariants(ordinary), [ordinary]);
  const variant =
    (kind === "ordinary" && variants.find((item) => item.id === rememberedVariant)) || variants[0];
  /* Настройки в границах контракта. Считаются заново только на правку: от
     этого объекта зависит рисунок сцены, плиток и разбора. */
  const raw = kind === "sniper" ? sniper : variant.config;
  const config = useMemo(
    () =>
      kind === "sniper"
        ? normalizeSniperReticle(raw)
        : normalizeOrdinaryReticle(raw),
    [kind, raw],
  );
  const styleId =
    kind === "sniper" ? sniperStyleOf(config) : ordinaryStyleOf(config);

  /* Инструменты вида прицела. У снайперки края и деления — только при
     перекрестии. */
  const linesEnabled = Boolean(config.linesEnabled);
  /* Вариантов несколько — панель говорит, какой правится, как у трассеров. */
  const variantName = variants.length > 1 && !variant.everything ? variantTitle(variants, variant.id) : "";
  const tools = useMemo(
    () =>
      kind === "sniper"
        ? sniperTools().map((item) =>
            item.id === "posts" || item.id === "divisions"
              ? { ...item, hidden: !linesEnabled }
              : item,
          )
        : ordinaryTools().map((item) =>
            variantName && !VARIANT_FREE_TOOLS.has(item.id) ? { ...item, note: `${variantName} · ${item.note}` } : item,
          ),
    /* язык окна: подписи инструментов собираются заново */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, linesEnabled, language, variantName],
  );
  /* язык окна: строка органов собирается заново */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const guide = useMemo(() => reticleGuide(), [language]);
  /* Взятый инструмент помнится один на оба вида: «Цвет» обычного прицела
     остаётся «Цветом» и у снайперки. Нет его у этого вида — запасной. */
  const [remembered, setTool] = useRememberedState("reticle:tool", "styles");
  const tool = tools.some((item) => item.id === remembered && !item.hidden)
    ? remembered
    : TOOL_FALLBACK[remembered] || "styles";
  const shownTools = useMemo(() => tools.filter((item) => !item.hidden), [tools]);
  const onToolStudio = (next) => {
    setTool(next);
    /* Счётчик стоит где угодно на экране — кадр показывает экран целиком. */
    if (next === "ammo" || next === "damage") setViews((current) => ({ ...current, [kind]: "game" }));
  };
  const rail = useRailGroups({ groups: RETICLE_GROUPS, tools: shownTools, tool, onTool: onToolStudio, letters: true, head: true });

  /* Счётчик патронов: один на все стволы, в модуле обычного прицела. Любая
     его настройка включает его (`editAmmoCounter`): настроенный, но
     выключенный счётчик в игру не уходил. */
  const ammo = useMemo(() => normalizeAmmoCounter(ordinary?.ammo), [ordinary?.ammo]);
  const patchAmmo = (change, label, property) =>
    onPatch({ ammo: editAmmoCounter(ammo, change) }, label, `ammo:${property}`, "crosshair");

  /* Счётчик урона: там же и по тем же правилам. */
  /* Сервер не выбран — окно идёт за проектом приложения, как и «Применить». */
  const [appProject] = useProject();
  const damage = useMemo(
    () => normalizeDamageCounter(damageCounterForProject(ordinary?.damageCounter, appProject)),
    [ordinary?.damageCounter, appProject],
  );
  const patchDamage = (change, label, property) =>
    onPatch({ damageCounter: editDamageCounter(damage, change) }, label, `damage:${property}`, "crosshair");

  /* Индикатор перезарядки: там же и по тем же правилам — любая настройка включает его. */
  const reload = useMemo(() => normalizeReloadIndicator(ordinary?.reloadIndicator), [ordinary?.reloadIndicator]);
  const patchReload = (change, label, property) =>
    onPatch({ reloadIndicator: editReloadIndicator(reload, change) }, label, `reload:${property}`, "crosshair");

  /* Анимация прицела: одна на оба вида, в модуле обычного. Правка пишет поле целиком — компилятор зажимает значения в границы контракта. */
  const animation = useMemo(() => normalizeReticleAnimation(ordinary?.animation), [ordinary?.animation]);
  const patchAnimation = (next, label, property) => onPatch({ animation: next }, label, `animation:${property}`, "crosshair");
  const animating = tool === "animation";
  const animationPreview = useReticleAnimationPreview({ animation, shimmer: animating && animation.shimmer });

  /* Как смотреть — не часть работы: в проект не пишется. */
  const [state, setState] = useState("plain");
  const [hit, setHit] = useState(false);
  const [scope, setScope] = useState("heavy");
  const [views, setViews] = useState({ ordinary: "zoom", sniper: "screen" });
  /* Счётчик в кадре стреляют из его панели: состояние живёт в самом слое. Индикатор перезарядки — так же. */
  const damageLayer = useRef(null);
  const reloadLayer = useRef(null);

  const workActions = useWorkActions({
    kind: "reticle",
    onNotice: (text, tone) => works?.notify?.(text, tone),
    linkedName: works?.linkedName,
    onSave: works?.save,
    onCopy: works?.copy,
    onOpen: works?.open,
  });

  /* Правка взятого: выбранного варианта; у снайперки и первого варианта — самого модуля. */
  const patch = (values, label, property = "") => {
    if (kind !== "ordinary" || variant.everything) return onPatch(values, label, property);
    return onPatch(
      variantLookPatch(ordinary, variant.id, values),
      `${label} · ${variantTitle(variants, variant.id)}`,
      `variant:${variant.id}:${property}`,
    );
  };
  const applyStyle = (item) =>
    patch(item.values, `${tr("Вид прицела")}: ${tr(item.label)}`, "style");
  /* Полка пресетов перерисовывается только от своего вида: обработчик один
     на всё время жизни, а правку берёт свежую. */
  const patchRef = useRef(patch);
  useEffect(() => {
    patchRef.current = patch;
  });
  const applyPreset = useCallback(
    (item) =>
      patchRef.current(
        reticlePresetConfig(kind, item),
        `${tr("Готовый прицел")}: ${tr(item.label)}`,
        "preset",
      ),
    [kind],
  );
  /* Счётчик урона считает ствол выбранного варианта; у первого — ходовой (`previewWeapon`). */
  const damageWeapon = previewWeapon(kind, variant.weapons[0] || "", scope);
  const damageSample = previewDamage(damage, damageWeapon);

  return (
    <EditorShell
      className="fx-editor reticle-editor"
      title={tr("Мастерская прицела")}
      status={`${project.name} · ${dirty ? tr("Есть изменения") : tr("Сохранено")}`}
      backLabel={tr("Назад в мастерскую")}
      onBack={onCancel}
      tools={rail.tools}
      tool={rail.tool}
      onTool={rail.onTool}
      toolShortcuts={rail.shellShortcuts}
      panelHead={rail.panelHead}
      guide={guide}
      guideKey="reticle"
      actions={
        <EditorActions
          onUndo={onUndo}
          canUndo={canUndo}
          onRedo={onRedo}
          canRedo={canRedo}
          more={[
            ...workActions.items,
            {
              value: "reset",
              label: tr("Сбросить"),
              icon: <ArrowCounterClockwise />,
            },
          ]}
          onMore={(action) => {
            if (workActions.handle(action)) return;
            if (action === "reset") onReset(kind);
          }}
          /* Одно нажатие на весь путь в игру: работа сохраняется и встаёт в
             очередь применения, а её ход виден на экране «В процессе». */
          apply={{
            label: tr("Применить"),
            title: applyHint || tr("Поставить прицел в GTA V Legacy"),
            busy: applyBusy,
            meter: applyMeter,
            onClick: onApply,
          }}
        />
      }
      /* Тип прицела — вкладками в шапке, как сервер у арены (владелец,
         10.10.2026, вечер: «перенеси переключение со снайперки и обычного
         наверх, как в арене GTA5RP и MAJESTIC»). До этого он стоял первым в
         панели (ТЗ 03.10) — теперь панель целиком отдана настройкам взятого,
         а выбор того, что правят, стоит там же, где у остальных редакторов. */
      tabs={
        <PageTabs
          className="reticle-mode-tabs"
          role="tablist"
          label={tr("Тип прицела")}
          value={kind}
          onChange={(next) =>
            onModuleChange(next === "sniper" ? "sniper-scope" : "crosshair")
          }
          options={[
            { value: "ordinary", label: tr("Обычный"), icon: <Crosshair /> },
            { value: "sniper", label: tr("Снайперский"), icon: <Scan /> },
          ]}
        />
      }
      inspector={
        <>
          {rail.switcher}
          {tool === "weapons" && (
            <ReticleVariantsPanel
              module={ordinary}
              selectedId={variant.id}
              onSelect={setVariantId}
              onAdd={() => {
                const { id, patch: added } = addVariantPatch(ordinary, config);
                onPatch(added, tr("Новый прицел"), "variants");
                setVariantId(id);
              }}
              onRemove={(id) => {
                onPatch(removeVariantPatch(ordinary, id), tr("Прицел убран"), "variants");
                if (id === variant.id) setVariantId(SHARED_VARIANT);
              }}
              onToggle={(id, weapons, on) =>
                onPatch(variantWeaponsPatch(ordinary, id, weapons, on), tr("Оружие прицела"), `variant:${id}:weapons`)
              }
            />
          )}
          {tool === "styles" && (
            <ReticleStyles
              key={kind}
              kind={kind}
              config={config}
              activeId={styleId}
              plate={RETICLE_PLATE}
              onSelect={applyStyle}
            />
          )}
          {tool === "templates" && (
            <ReticlePresets kind={kind} onApply={applyPreset} />
          )}
          {tool === "ammo" && (
            <ReticleAmmoPanel counter={ammo} onPatch={patchAmmo} />
          )}
          {tool === "damage" && (
            <ReticleDamagePanel
              counter={damage}
              onPatch={patchDamage}
              canShoot={Boolean(damageSample)}
              onShot={(kill) => damageLayer.current?.hit(damageSample, kill)}
            />
          )}
          {tool === "reload" && (
            <ReticleReloadPanel config={reload} onPatch={patchReload} onPlay={(name) => reloadLayer.current?.play(name)} />
          )}
          {tool === "animation" && (
            <ReticleAnimationPanel
              kind={kind}
              animation={animation}
              onPatch={patchAnimation}
              onPlay={animationPreview.play}
              playing={animationPreview.playing}
            />
          )}
          {kind === "sniper" ? (
            <SniperInspector tool={tool} config={config} onPatch={patch} hit={hit} onHit={setHit} />
          ) : (
            <OrdinaryInspector tool={tool} config={config} onPatch={patch} hit={hit} onHit={setHit} />
          )}
        </>
      }
    >
      <ReticleStage
        kind={kind}
        config={config}
        view={views[kind]}
        onView={(view) => setViews((current) => ({ ...current, [kind]: view }))}
        state={state}
        onState={setState}
        /* Отметка попадания в кадре — пока открыт инструмент, где её показывают. */
        hit={hit && (tool === "visibility" || tool === "optics")}
        scope={scope}
        onScope={setScope}
        ammo={ammo}
        ammoEditing={tool === "ammo"}
        onAmmoMove={(point) => patchAmmo(point, tr("Счётчик патронов: место"), "position")}
        damage={damage}
        damageEditing={tool === "damage"}
        damageHit={damageSample}
        damageRef={damageLayer}
        onDamageMove={(point) => patchDamage(point, tr("Счётчик урона: место"), "position")}
        reload={tool === "reload" ? reload : null}
        reloadRef={reloadLayer}
        onReloadMove={(point) => patchReload(point, tr("Перезарядка: место"), "position")}
        animation={animating ? animationPreview : null}
      />
      {workActions.dialogs}
    </EditorShell>
  );
}
