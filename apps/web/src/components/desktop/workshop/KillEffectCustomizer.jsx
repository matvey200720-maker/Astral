/*
 * Редактор килл-эффекта.
 *
 * Эффект, который игра включает после убийства педа, — это один модификатор
 * таймцикла `hud_def_desat_cold_kill` и один ключ `misc.PedKillOverlay.duration`
 * в `visualsettings.dat`. Оба лежат внутри `update.rpf`, и почти каждый редукс
 * очищает первый — поэтому у большинства игроков вспышки при убийстве нет и
 * вернуть её без OpenIV нечем.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): разделы
 * правки — инструменты слева, от главного к редкому: цвет вспышки, знак на
 * килле, длительность, рамка по краям, кадр с его тоном, градиент, даль,
 * оптика, плёнка и готовые эффекты («Шаблоны»); справа — настройки взятого,
 * под ними разбор того, что уйдёт в игру. Кадр — на всю середину, органы
 * проигрывания — полосой поверх него. Вкладок «Шаблоны / Настройка /
 * Экспертный» больше нет: точный текст модификатора лежит в разборе и в
 * меню «⋯».
 *
 * Кадр проигрывает эффект во времени, а не показывает застывшую картинку: килл
 * длится доли секунды, и оценивать его по стоп-кадру нельзя. Сцена — матовая
 * стена Astral (`KillEffectStage.jsx`): на ней видно ровно то, что меняет
 * эффект.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Camera,
  CircleHalf,
  Clock,
  CloudFog,
  Copy,
  DownloadSimple,
  Eye,
  FilmStrip,
  FolderOpen,
  Lightning,
  Play,
  Rows,
  Skull,
  Square,
  Swatches,
  Trash,
  Warning,
} from "../../ui/icons.jsx";
import {
  KILL_DURATION_RANGE,
  KILL_EFFECT_CHANNEL_MAP,
  KILL_EFFECT_TEMPLATES,
  VANILLA_KILL_DURATION,
  createKillEffectProject,
  instantiateKillEffectTemplate,
  killEffectEnvelope,
  killEffectModifierSnippet,
  killEffectOverridesTone,
  parseKillEffectProject,
  resolveKillEffectFields,
  withKillEffectTone,
} from "@modovik/kill-effects";
import {
  applyKillEffectCustomization,
  chooseGameInstallation,
  detectInstallations,
  hasDesktopBridge,
  readKillEffectState,
  sanitizeDesktopErrorMessage,
} from "../../../api.js";
import { useInstallRecord } from "../../../features/workshop/useInstallRecord.js";
import {
  REPLACING_INSTALL_STEPS,
  applyWorkshopWork,
  useWorkshopApplyButton,
  workSignature,
} from "../../../features/workshop/install-queue/index.js";
import { installEditorWork } from "../../../features/workshop/install-queue/tasks/editor-work.js";
import {
  EDITOR_WORKS,
  WorksStoreError,
  currentEditorWorkState,
  installedEditorWorkState,
  linkedEditorWork,
  saveEditorWorkToWorks,
  unlinkEditorWork,
} from "../../../features/workshop/works/workshop-works.js";
import { killCode } from "../../../features/workshop/works/work-transfer.js";
import { useWorkActions } from "../../../features/workshop/works/useWorkActions.jsx";
import useHistoryKeys from "../../../hooks/useHistoryKeys.js";
import { useRememberedState } from "../../../section-memory.js";
import { useRailGroups } from "../../ui/useRailGroups.jsx";
import Button from "../../ui/Button.jsx";
import ChoiceTile from "../../ui/ChoiceTile.jsx";
import PresetShelf from "../../ui/PresetShelf.jsx";
import ColorField from "../../ui/ColorField.jsx";
import EditorActions from "../../ui/EditorActions.jsx";
import EditorShell from "../../ui/EditorShell.jsx";
import Slider from "../../ui/Slider.jsx";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import { StageBar, StageNote } from "../../ui/StageOverlay.jsx";
import Switch from "../../ui/Switch.jsx";
import CombatKillStage from "../../../features/workshop/combat-stage/CombatKillStage.jsx";
import { combatBodiesAvailable } from "../../../features/workshop/combat-stage/combat-bodies.js";
import FxKillFrameStage from "../../../features/workshop/fx-frame/FxKillFrameStage.jsx";
import { registerFrameShot } from "../../../features/workshop/frame-shot.js";
import { FRAME_VIEW_OPTIONS, choiceOptions } from "../../../features/workshop/fx-frame/frame-choices.js";
import KillEffectStage from "./KillEffectStage.jsx";
import {
  KillScrub,
  useKillPlayback,
  usePlayhead,
} from "./KillEffectPlayback.jsx";
import KillEffectThumb from "./KillEffectThumb.jsx";
import KillMarkerSection from "./KillMarkerSection.jsx";
import {
  importKillMarkerFile,
  killMarkerInstallFrames,
  killMarkerSequence,
} from "./kill-marker-frames.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";
import { failureReason } from "../../../utils/installFailure.js";
import {
  describeKillEffectFor,
  killCopyFor,
} from "./kill-lang.js";

/* Пауза между повторами: килл длится доли секунды, и без паузы предпросмотр
   превращается в мигание, по которому ничего не оценить. */
const REPLAY_GAP_MS = 900;
const MAX_HISTORY = 60;
/* Снимок работы — на этой миллисекунде после выстрела (та же, что у штатной плитки: `scripts/stock-covers-live/recipes.mjs`). */
const KILL_COVER_MOMENT_MS = 400;
/* Ключ записи установки — он же ключ работы в очереди применения: пока
   эффект ждёт очереди или ставится, второго «Применить» у него нет. */
const KILL_EFFECT_INSTALL_KEY = "astral.kill-effect.install.v1";

const durationPresets = () => [
  { id: "flash", label: tr("Вспышка"), value: 180 },
  { id: "vanilla", label: tr("Как в игре"), value: VANILLA_KILL_DURATION },
  { id: "cinema", label: tr("Кино"), value: 1400 },
  { id: "long", label: tr("Долгий"), value: 2400 },
];

/* Быстрые цвета — по восемь: ровно столько образцов встаёт в строку колонки
   правок, девятый уезжал на вторую строку один. У вспышки первым стоит
   красный — с него начинают почти все килл-эффекты серверов, — и ванильный
   холодный синий игры. У рамки — чёрный и тёмно-красный: так затемняют края
   ванильные эффекты. */
const FLASH_SWATCHES = Object.freeze([
  "#ff2500",
  "#ff7a1a",
  "#ffd400",
  "#7cff3d",
  "#22d3ee",
  "#38aaff",
  "#ff3df0",
  "#ffffff",
]);
const FRAME_SWATCHES = Object.freeze([
  "#000000",
  "#3d0000",
  "#ff0000",
  "#ff7a1a",
  "#ffd400",
  "#7cff3d",
  "#38aaff",
  "#ffffff",
]);
const GRADE_SWATCHES = Object.freeze([
  "#ffffff",
  "#ffaa38",
  "#ff5a36",
  "#dff2ff",
  "#8f5bff",
  "#7cff3d",
]);

/*
 * Разделы после главных трёх — каналы по группам, от заметного к редкому;
 * каждый — свой инструмент (`id` — его id). У раздела с одним
 * необязательным каналом выключатель стоит в шапке (`toggle` — её строка:
 * имя раздела уже стоит заголовком панели), у раздела с несколькими — у
 * каждого канала свой.
 */
const detailSections = () => [
  {
    id: "screen",
    title: tr("Кадр"),
    channels: ["saturation", "exposure", "grade"],
  },
  {
    id: "gradient",
    title: tr("Градиент по экрану"),
    toggle: tr("Полосы сверху и снизу"),
    channels: ["gradient"],
  },
  {
    id: "distance",
    title: tr("Даль"),
    channels: ["fog", "depthOfField"],
  },
  {
    id: "optics",
    title: tr("Оптика"),
    channels: ["bloom", "blur", "lens"],
  },
  {
    id: "film",
    title: tr("Плёнка"),
    channels: ["grain", "scanlines"],
  },
];

/*
 * Инструменты килл-эффекта — разделы прежней колонки правок, сверху вниз от
 * главного к редкому. «Тон кадра» — в «Кадре»: он про тот же экран на время
 * килла. Цифры — горячие клавиши, как у остальных кадров мастерской; десятый
 * — «Шаблоны» — на ноле, последней клавише того же ряда.
 */
const killTools = () => [
  {
    id: "flash",
    label: tr("Цвет вспышки"),
    icon: <Lightning />,
    shortcut: "1",
    group: "main",
    note: tr("Цвет кадра в момент убийства; у игры — холодный синий"),
    hint: tr("Выберите цвет справа — вспышка в кадре сразу станет этого цвета"),
  },
  {
    id: "marker",
    label: tr("Знак на килле"),
    icon: <Skull />,
    shortcut: "2",
    group: "main",
    note: tr("Своя картинка вместо крестика над прицелом"),
    hint: tr("Включите знак и выберите картинку — она появится в кадре там, где прицел"),
  },
  {
    id: "timing",
    label: tr("Длительность и сила"),
    icon: <Clock />,
    shortcut: "3",
    group: "main",
    note: tr("Сколько держится вспышка и насколько она сильна"),
    hint: tr("Готовая длительность — плиткой, точная — ползунком; шкала над кадром покажет её"),
  },
  {
    id: "vignette",
    label: tr("Рамка по краям"),
    icon: <Square />,
    shortcut: "4",
    group: "screen",
    note: tr("Края экрана темнеют или окрашиваются, середина чистая"),
    hint: tr("Цвет и сила рамки — справа; кадр покажет её по краям стены"),
  },
  {
    id: "screen",
    label: tr("Кадр"),
    icon: <CircleHalf />,
    shortcut: "5",
    group: "screen",
    note: tr("Насыщенность, яркость, цветокоррекция и тон экрана"),
    hint: tr("Ползунки правят весь экран на время килла"),
  },
  {
    id: "gradient",
    label: tr("Градиент по экрану"),
    icon: <Rows />,
    shortcut: "6",
    group: "screen",
    note: tr("Полосы сверху и снизу — так затемняют верх экрана"),
    hint: tr("Включите градиент выключателем — появятся его полосы"),
  },
  {
    id: "distance",
    label: tr("Даль"),
    icon: <CloudFog />,
    shortcut: "7",
    group: "detail",
    note: tr("Уход в туман и размытие фона"),
    hint: tr("Туман и размытие фона включаются каждый своим выключателем"),
  },
  {
    id: "optics",
    label: tr("Оптика"),
    icon: <Camera />,
    shortcut: "8",
    group: "detail",
    note: tr("Свечение, размытие, искажение линзы и хроматика"),
    hint: tr("Ползунки оптики правят весь экран на время килла"),
  },
  {
    id: "film",
    label: tr("Плёнка"),
    icon: <FilmStrip />,
    shortcut: "9",
    group: "detail",
    note: tr("Зерно и строчная развёртка поверх кадра"),
    hint: tr("Зерно и развёртка включаются каждое своим выключателем"),
  },
  {
    id: "templates",
    label: tr("Шаблоны"),
    icon: <Swatches />,
    shortcut: "0",
    group: "ready",
    note: tr("Готовые эффекты и эффект из вашей игры"),
    hint: tr("Готовый эффект меняет вспышку целиком — знак на килле остаётся"),
  },
];

/*
 * Колонка по группам (ТЗ 22.10.2026, п. B): десять значков — четыре. «Вспышка» (цвет, знак на килле, длительность и сила),
 * «Экран» (рамка по краям, кадр, градиент), «Камера» (даль, оптика, плёнка), «Шаблоны». Прежние инструменты остаются:
 * панели, цифры 1–9 (каждая открывает свой пункт), запись killEffect:tool.
 */
const KILL_GROUPS = Object.freeze([
  { id: "burst", ids: ["flash", "marker", "timing"], label: "Вспышка", icon: <Lightning />, group: "main", demo: "light" },
  { id: "display", ids: ["vignette", "screen", "gradient"], label: "Экран", icon: <CircleHalf />, group: "screen", demo: "paint" },
  { id: "camera", ids: ["distance", "optics", "film"], label: "Камера", icon: <Camera />, group: "detail", demo: "paint" },
]);

/*
 * Управление кадром — строка внизу слева (`EditorStageGuide`). Мыши кадр не
 * ждёт: проигрыванием правит полоса над ним, правкой — панель и история.
 * Строка короткая намеренно: каркас держит её левее подписи кадра, и
 * длинная переносилась бы на вторую строку — на нижний край стены, где
 * идёт кайма вспышки. Цифры инструментов — в подсказках колонки.
 */
const killGuide = () => [
  { keys: ["Ctrl", "Z"], text: tr("отменить") },
  { keys: ["Ctrl", "Y"], text: tr("повторить") },
];

const SWATCHES_BY_CHANNEL = Object.freeze({
  tint: FLASH_SWATCHES,
  vignette: FRAME_SWATCHES,
  grade: GRADE_SWATCHES,
});

const formatMs = (value) =>
  value >= 1000
    ? `${(value / 1000).toFixed(2)}${tr(" с")}`
    : `${Math.round(value)}${tr(" мс")}`;

/* Часть ползунков ходит в сотых долях параметра игры: ползунок целочисленный,
   а подпись показывает то самое число, которое окажется в XML. */
const fieldFormat = (item) =>
  item.format === "hundredths"
    ? (value) => (value / 100).toFixed(2)
    : undefined;

/*
 * Подпись поля. У канала из одного поля подпись канала и есть подпись поля:
 * «Размытие экрана» над ползунком «Сила» читалось бы двумя строками про одно.
 * Экспозиция — единственный такой канал с выключателем: её имя стоит у
 * выключателя, а ползунок говорит, что он двигает.
 */
const loneFieldLabel = (channelId) =>
  channelId === "exposure" ? tr("Яркость") : "";

function fieldLabel(channel, item) {
  if (channel.fields.length !== 1) return tr(item.label);
  return channel.optional
    ? loneFieldLabel(channel.id) || tr(item.label)
    : tr(channel.label);
}

/* Поля канала: цвет — общим полем с быстрыми цветами, число — ползунком. */
function ChannelFields({ channel, value, onField }) {
  useTr();
  return channel.fields.map((item) =>
    item.kind === "color" ? (
      <ColorField
        key={item.key}
        label={fieldLabel(channel, item)}
        value={value[item.key]}
        swatches={SWATCHES_BY_CHANNEL[channel.id] || []}
        onChange={(next) => onField(item.key, next)}
        ariaLabel={`${tr(channel.label)}: ${tr(item.label)}`}
      />
    ) : (
      <Slider
        key={item.key}
        label={fieldLabel(channel, item)}
        hint={item.hint ? tr(item.hint) : item.hint}
        value={value[item.key]}
        min={item.min}
        max={item.max}
        step={item.step}
        unit={item.unit ? tr(item.unit) : item.unit}
        format={fieldFormat(item)}
        onChange={(next) => onField(item.key, next)}
      />
    ),
  );
}

/*
 * Раздел из нескольких каналов — панель своего инструмента. Канал с
 * выключателем показывает поля, только когда включён: выключенный канал игра
 * не читает, и шесть ползунков под ним были бы ручками без дела. Имя раздела
 * стоит заголовком панели (его рисует каркас), поэтому своего заголовка у
 * раздела нет — только строка выключателя, если он один на раздел.
 */
function ChannelSection({ section, channels, onField, onToggle }) {
  useTr();
  const copy = killCopyFor(useUiLanguage());
  const single = section.channels.length === 1;
  const lone = single ? KILL_EFFECT_CHANNEL_MAP[section.channels[0]] : null;
  const loneOn = lone ? !lone.optional || channels[lone.id].enabled : false;
  return (
    <section className="ui-panel fx-section" aria-label={section.title}>
      {lone?.optional && (
        <header className="fx-section-head">
          <h3>{section.toggle || tr(lone.label)}</h3>
          <Switch
            checked={loneOn}
            label={copy.toggle(tr(lone.label))}
            onChange={(on) => onToggle(lone.id, on)}
          />
        </header>
      )}
      {section.channels.map((id) => {
        const channel = KILL_EFFECT_CHANNEL_MAP[id];
        const value = channels[id];
        const on = !channel.optional || value.enabled;
        /* Шапка канала — там, где ей есть что сказать: имя над несколькими
           полями или выключатель. Канал из одного поля подписан самим
           полем. */
        const head = !single && (channel.optional || channel.fields.length > 1);
        return (
          <div className="kill-channel" key={id}>
            {head && (
              <div className="kill-channel-head">
                <b>{tr(channel.label)}</b>
                {channel.optional && (
                  <Switch
                    checked={on}
                    label={copy.toggle(tr(channel.label))}
                    onChange={(next) => onToggle(id, next)}
                  />
                )}
              </div>
            )}
            {on && (
              <ChannelFields
                channel={channel}
                value={value}
                onField={(key, next) => onField(id, key, next)}
              />
            )}
          </div>
        );
      })}
    </section>
  );
}

/*
 * Готовые эффекты — сеткой в панели инструмента «Шаблоны», как пресеты у
 * эффектов попадания и трейсеров, без переключателя: тринадцать кадров на
 * матовой стене — это и есть выбор, который человек делает глазами. Плитка
 * рисует свой эффект тем же проходом, что и сцена, и перерисовывается только
 * от своих пропсов (`memo`), а не от каждого движения ползунка. Плитка —
 * кадр, имя и длительность; описание всплывает (18.10.2026, владелец:
 * панели «перегружены»).
 */
const TemplateGrid = memo(function TemplateGrid({ selected, onPick }) {
  useTr();
  return (
    <PresetShelf
      title={tr("Готовые эффекты")}
      label={tr("Готовые килл-эффекты")}
      count={KILL_EFFECT_TEMPLATES.length}
      className="kill-templates"
      collapsible={false}
    >
      {KILL_EFFECT_TEMPLATES.map((template) => (
        <ChoiceTile
          key={template.id}
          className="kill-template-card"
          selected={selected === template.id}
          media={
            <KillEffectThumb
              project={template.project}
              className="kill-template-swatch"
            />
          }
          title={tr(template.label)}
          tooltip={tr(template.description)}
          meta={formatMs(template.project.duration)}
          onClick={() => onPick(template.id)}
        />
      ))}
    </PresetShelf>
  );
});

/* Правка между запусками — там же, где её ищут «Мои работы». */
const KILL_EFFECT_DRAFT_KEY = EDITOR_WORKS["kill-effect"].storageKey;

function readDraft() {
  try {
    return window.localStorage.getItem(KILL_EFFECT_DRAFT_KEY);
  } catch {
    return null;
  }
}

/*
 * Правка, с которой редактор открывается, когда памяти раздела нет — после
 * перезапуска приложения. Раньше здесь всегда был заводской эффект, и
 * собранный вчера килл-эффект пропадал вместе с закрытием окна.
 *
 * Сначала — свой черновик; до него правка жила в «текущей работе», которую
 * заводило «Применить», — её снимок читается один раз, после обновления. Нет
 * и его — то, что стоит в игре: это ближе к правде, чем заводской эффект.
 */
const rowKey = (fields) =>
  JSON.stringify(
    (fields || []).map(([name, first, second = 0]) => [
      name,
      Math.round(Number(first) * 1000),
      Math.round(Number(second) * 1000),
    ]),
  );

/*
 * Тот ли килл-эффект сейчас в игре, что ставил Astral.
 *
 * Установку переписывает всё, что правит те же файлы мимо Astral: редукс
 * через OpenIV, чужой прицел, проверка файлов Steam. Редактор узнаёт это по
 * самой игре — строкам модификатора и отпечатку знака в файле прицела — и
 * отвечает «модификатор» или «знак» (что именно уехало) либо `null`.
 */
export function killEffectDrift(record, gameState) {
  if (!record?.installedState || !gameState?.available) return null;
  let installed;
  try {
    installed = parseKillEffectProject(JSON.parse(record.installedState));
  } catch {
    return null;
  }
  if (
    Array.isArray(gameState.modifierFields) &&
    rowKey(gameState.modifierFields) !== rowKey(resolveKillEffectFields(installed))
  )
    return "modifier";
  const live = gameState.marker;
  if (installed.marker.enabled && live?.available && record.markerSignature)
    if (live.signature !== record.markerSignature) return "marker";
  return null;
}

function restoreKillEffectWork() {
  for (const saved of [
    readDraft(),
    currentEditorWorkState("kill-effect"),
    installedEditorWorkState("kill-effect"),
  ]) {
    if (!saved) continue;
    try {
      return parseKillEffectProject(JSON.parse(saved));
    } catch {
      /* Снимок не читается — берём следующий, а не пустой экран. */
    }
  }
  return instantiateKillEffectTemplate("vanilla");
}

/*
 * Черновик пишется с задержкой: ползунок даёт десятки правок в секунду, а
 * `localStorage` пишет синхронно. Уход с экрана и закрытие окна дописывают
 * его сразу.
 */
function useKillEffectDraft(project) {
  const latest = useRef(null);
  useEffect(() => {
    const flush = () => {
      if (!latest.current) return;
      try {
        window.localStorage.setItem(
          KILL_EFFECT_DRAFT_KEY,
          JSON.stringify(latest.current),
        );
      } catch {
        /* Хранилище переполнено — правка живёт в памяти раздела. */
      }
      latest.current = null;
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  useEffect(() => {
    latest.current = project;
    const timer = window.setTimeout(() => {
      if (latest.current !== project) return;
      try {
        window.localStorage.setItem(
          KILL_EFFECT_DRAFT_KEY,
          JSON.stringify(project),
        );
        latest.current = null;
      } catch {
        /* см. выше */
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [project]);
}

export default function KillEffectCustomizer({ onExit, onNotice }) {
  useTr();
  const language = useUiLanguage();
  const copy = killCopyFor(language);
  /* Названия инструментов и подсказки колонки собираются функциями на языке
     окна: пересобираются, когда язык сменился. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tools = useMemo(() => killTools(), [language]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const guide = useMemo(() => killGuide(), [language]);
  /* Проект и история живут одним состоянием: два отдельных `useState` дали бы
     кадры, где ползунок уже сдвинут, а «отменить» ещё не знает об этом.

     Оно же переживает уход в соседний раздел: заглянувший в загрузки человек
     возвращается к своей правке, а не к заводскому эффекту. Проигрывание —
     положение и `runId` — не помнится: это положение внутри проигрываемого
     кадра, и начинать его заново правильно. */
  const [state, setState] = useRememberedState("killEffect:project", () => ({
    present: restoreKillEffectWork(),
    past: [],
    future: [],
  }));
  const project = state.present;
  useKillEffectDraft(project);
  const [tool, setTool] = useRememberedState("killEffect:tool", "flash");
  const rail = useRailGroups({ groups: KILL_GROUPS, tools, tool, onTool: setTool, letters: true, head: true });
  /* Положение внутри килла — не состояние редактора: оно меняется каждый
     кадр, и редактор, перерисованный от каждого, стоил бы шестьдесят полных
     проходов React в секунду (см. `KillEffectPlayback.jsx`). */
  const playhead = usePlayhead(0);
  const stageRef = useRef(null);
  const [playback, setPlayback] = useRememberedState(
    "killEffect:playback",
    "loop",
  );
  const [runId, setRunId] = useState(0);
  const [comparing, setComparing] = useRememberedState(
    "killEffect:comparing",
    false,
  );
  const [gameRoot, setGameRoot] = useState("");
  /* Кадр: объёмный (сцена боя с людьми из игры) или плоский (матовая стена). */
  const [stageMode, setStageMode] = useRememberedState("killEffect:stage", "3d");
  const [stage3dFailed, setStage3dFailed] = useState(false);
  /* Есть ли для килла серия кадров GTA V (docs/fx-scenes.md): тогда она стоит вместо 3D-сцены и матовой стены; `null` — кадров нет. */
  const [frameStatus, setFrameStatus] = useState(null);
  /* Серия кадров нашлась хоть раз: «Плоский» убирает кадр с экрана, а вернуться к нему надо мочь. */
  const [framesExist, setFramesExist] = useState(false);
  /* Ракурс серии (24.10 вечером): «Сбоку / От третьего лица»; пусто — как лучше (от третьего лица), если такая серия снята. */
  const [frameView, setFrameView] = useRememberedState("killEffect:frameView", "");
  const onFrameStatus = useCallback((status) => {
    setFrameStatus(status);
    if (status.shown) setFramesExist(true);
  }, []);
  const frameShown = Boolean(frameStatus?.shown) && stageMode !== "flat";
  const frameViewOptions = choiceOptions(FRAME_VIEW_OPTIONS, frameStatus?.views || [], tr);
  const can3d = combatBodiesAvailable() && Boolean(gameRoot);
  const stage3d = can3d && stageMode !== "flat" && !stage3dFailed;
  const [gameState, setGameState] = useState(null);
  const [stateError, setStateError] = useState("");
  const installRecord = useInstallRecord(KILL_EFFECT_INSTALL_KEY);
  /* Версия эффекта, которую увезёт «Применить»: пока ставится прежняя,
     новая правка встаёт в очередь следом. */
  const installSignature = useMemo(() => workSignature(project), [project]);
  const applyButton = useWorkshopApplyButton(
    KILL_EFFECT_INSTALL_KEY,
    installSignature,
  );
  const busy = applyButton.pending;
  const fileInputRef = useRef(null);

  const envelope = useMemo(() => killEffectEnvelope(project), [project]);
  const fields = useMemo(() => resolveKillEffectFields(project), [project]);
  const snippet = useMemo(() => killEffectModifierSnippet(project), [project]);
  const marker = project.marker;
  /* Килл длится столько, сколько самое долгое из двух: вспышка или знак. */
  const timelineMs = marker.enabled
    ? Math.max(envelope.duration, marker.duration)
    : envelope.duration;

  /*
   * Кадры картинки знака. Строятся по ключу картинки, а не по каждой правке
   * знака: ползунок размера не должен заново рисовать эмодзи. `null` — своей
   * картинки на этом компьютере нет (работа пришла кодом, файл не выбран).
   */
  const markerKey = marker.enabled ? JSON.stringify(marker.source) : "";
  const [markerSequence, setMarkerSequence] = useState(null);
  const [markerPending, setMarkerPending] = useState(false);
  const [markerBusy, setMarkerBusy] = useState(false);
  useEffect(() => {
    if (!markerKey) {
      setMarkerSequence(null);
      setMarkerPending(false);
      return undefined;
    }
    let cancelled = false;
    setMarkerPending(true);
    killMarkerSequence(JSON.parse(markerKey))
      .then((sequence) => {
        if (!cancelled) setMarkerSequence(sequence);
      })
      .catch(() => {
        if (!cancelled) setMarkerSequence(null);
      })
      .finally(() => {
        if (!cancelled) setMarkerPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [markerKey]);
  const markerMissing =
    marker.enabled && !markerPending && !markerSequence?.canvases?.length;

  /* Правка проекта всегда проходит здесь: иначе половина ручек попадала бы в
     историю, а половина нет, и «отменить» вело бы себя случайно. */
  const commit = useCallback(
    (next) => {
      setState((current) => {
        const value = typeof next === "function" ? next(current.present) : next;
        if (value === current.present) return current;
        return {
          present: value,
          past: [...current.past, current.present].slice(-MAX_HISTORY),
          future: [],
        };
      });
    },
    [setState],
  );

  const undo = useCallback(() => {
    setState((current) =>
      current.past.length
        ? {
            present: current.past[current.past.length - 1],
            past: current.past.slice(0, -1),
            future: [current.present, ...current.future].slice(0, MAX_HISTORY),
          }
        : current,
    );
  }, [setState]);

  const redo = useCallback(() => {
    setState((current) =>
      current.future.length
        ? {
            present: current.future[0],
            past: [...current.past, current.present].slice(-MAX_HISTORY),
            future: current.future.slice(1),
          }
        : current,
    );
  }, [setState]);

  /* Ctrl+Z / Ctrl+Y — те же шаги, что у стрелок в шапке: своя история у
     редактора была, а клавиш у неё не было. */
  useHistoryKeys({ undo, redo });

  const setProjectField = useCallback(
    (key, value) =>
      commit((current) =>
        createKillEffectProject({ ...current, [key]: value }),
      ),
    [commit],
  );

  const setChannelField = useCallback(
    (channelId, key, value) => {
      commit((current) =>
        createKillEffectProject({
          ...current,
          template: null,
          channels: {
            ...current.channels,
            [channelId]: { ...current.channels[channelId], [key]: value },
          },
        }),
      );
    },
    [commit],
  );

  const toggleChannel = useCallback(
    (channelId, enabled) => setChannelField(channelId, "enabled", enabled),
    [setChannelField],
  );

  /* Знак — часть проекта: правка знака ложится шагом истории, как любая. */
  const setMarker = useCallback(
    (next) =>
      commit((current) => createKillEffectProject({ ...current, marker: next })),
    [commit],
  );

  const pickMarkerFile = useCallback(
    async (file) => {
      setMarkerBusy(true);
      try {
        const { source } = await importKillMarkerFile(file);
        commit((current) =>
          createKillEffectProject({
            ...current,
            marker: { ...current.marker, enabled: true, source },
          }),
        );
        onNotice?.(
          source.animated
            ? copy.gifLoaded(source.name, source.frames)
            : copy.imageLoaded(source.name),
        );
      } catch (error) {
        onNotice?.(String(error?.message || error), "error");
      } finally {
        setMarkerBusy(false);
      }
    },
    [commit, onNotice, copy],
  );

  const setTone = useCallback(
    (enabled) => commit((current) => withKillEffectTone(current, enabled)),
    [commit],
  );

  /*
   * Проигрывание. Килл длится доли секунды, и по стоп-кадру его не оценить,
   * поэтому по умолчанию эффект идёт по кругу с паузой между повторами —
   * ровно так человек видит его в бою.
   *
   * Сам цикл кадров и его часы — в `KillEffectPlayback.jsx`: он пишет
   * положение в хранилище, а холст и шкала рисуются из него напрямую.
   */
  const finishOnce = useCallback(() => setPlayback("paused"), [setPlayback]);
  useKillPlayback({
    playhead,
    playback,
    runId,
    loopMs: timelineMs + REPLAY_GAP_MS,
    endMs: timelineMs,
    stageRef,
    onFinish: finishOnce,
  });

  /* Перемотка шкалой ставит проигрывание на паузу: человек смотрит кадр,
     который выбрал, а не тот, куда уехал повтор. */
  const scrubTo = useCallback(
    (value) => {
      setPlayback("paused");
      playhead.set(value);
    },
    [playhead, setPlayback],
  );

  /* Песочница (только dev): шкала килла — съёмщику штатных обложек, как `__astralModelStage`. */
  useEffect(() => {
    if (!import.meta.env?.DEV) return undefined;
    window.__astralKill = { scrubTo };
    return () => {
      delete window.__astralKill;
    };
  }, [scrubTo]);

  /* Снимок работы (`frame-shot.js`): момент, где вспышка раскрылась, и с эффектом, а не между повторами на пустом кадре; потом всё как было. */
  const coverBack = useRef(null);
  coverBack.current = { playback, comparing };
  useEffect(
    () =>
      registerFrameShot({
        pose: () => {
          const { playback: was, comparing: compared } = coverBack.current;
          const moment = playhead.get();
          scrubTo(KILL_COVER_MOMENT_MS);
          if (compared) setComparing(false);
          return () => {
            playhead.set(moment);
            setPlayback(was);
            if (compared) setComparing(true);
          };
        },
      }),
    [playhead, scrubTo, setComparing, setPlayback],
  );

  useEffect(() => {
    let cancelled = false;
    detectInstallations()
      .then((games) => {
        if (cancelled) return;
        const legacy = (Array.isArray(games) ? games : []).find(
          (item) =>
            item?.path &&
            String(item.edition || "Legacy").toLowerCase() === "legacy",
        );
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
    readKillEffectState({ gameRoot })
      .then((state) => {
        if (cancelled) return;
        // `null` приходит из браузера, где рабочего стола нет. Это состояние,
        // а не ошибка: редактор продолжает работать на шаблонах.
        setGameState(
          state || {
            available: false,
            reason: tr("Файлы игры доступны только в Astral Desktop"),
          },
        );
        setStateError("");
      })
      .catch((error) => {
        if (!cancelled) setStateError(sanitizeDesktopErrorMessage(error));
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
        setStateError(sanitizeDesktopErrorMessage(error));
      }
    };
  }, [gameRoot]);

  /*
   * Килл-эффект в «Моих работах». Редактор, открытый из сохранённой работы,
   * правит её: «Сохранить» обновит её же. Загрузил шаблон, код, файл или
   * эффект из игры — это уже другая работа, и сохранение заведёт новую под
   * именем того, что открыто.
   */
  const sourceName = useRef("");
  const openedElsewhere = useCallback((name = "") => {
    sourceName.current = name;
    unlinkEditorWork("kill");
  }, []);
  const works = useWorkActions({
    kind: "kill",
    onNotice,
    linkedName: () => linkedEditorWork("kill")?.name || "",
    defaultName: () => sourceName.current,
    onSave: async ({ name, asNew }) => {
      if (!project) throw new WorksStoreError("empty");
      const { work, created } = saveEditorWorkToWorks(
        "kill",
        JSON.stringify(project),
        { name, asNew },
      );
      sourceName.current = "";
      return { name: work.name, created };
    },
    onCopy: () =>
      killCode(project, {
        name: linkedEditorWork("kill")?.name || sourceName.current,
      }),
    /* Код ложится шагом истории: «Отменить» возвращает свой эффект. */
    onOpen: (result) => {
      const template = result.templates[0];
      commit(() => parseKillEffectProject(JSON.parse(template.state)));
      openedElsewhere(template.name);
    },
  });

  /*
   * Готовый эффект меняет вспышку, а знак на килле остаётся: человек собрал
   * себе картинку и движение, и выбор синей или красной вспышки не должен
   * их стирать.
   */
  const applyTemplate = useCallback(
    (id) => {
      const label = KILL_EFFECT_TEMPLATES.find((item) => item.id === id)?.label;
      commit((current) =>
        createKillEffectProject({
          ...instantiateKillEffectTemplate(id),
          marker: current.marker,
        }),
      );
      openedElsewhere(label || "");
      onNotice?.(copy.templateLoaded(tr(label)));
    },
    [commit, onNotice, openedElsewhere, copy],
  );

  /* Из игры читается вспышка; знак остаётся тем, что в редакторе, — его
     настройки из файла прицела обратно не восстановить. */
  const openInstalled = useCallback(() => {
    if (!gameState?.project) return;
    commit((current) =>
      createKillEffectProject({
        ...parseKillEffectProject(gameState.project),
        marker: current.marker,
      }),
    );
    openedElsewhere();
    onNotice?.(
      gameState.cleared
        ? tr("Открыт пустой килл-эффект вашей сборки — редукс его отключил")
        : copy.openedFromGame(gameState.fields),
    );
  }, [commit, gameState, onNotice, openedElsewhere, copy]);

  /* «Сбросить всё» — килл как в игре: ванильная вспышка и без знака. Шагом
     истории: «Отменить» возвращает своё. */
  function resetEverything() {
    commit(() => instantiateKillEffectTemplate("vanilla"));
    openedElsewhere();
    onNotice?.(tr("Килл-эффект как в игре: ванильная вспышка, без знака"));
  }

  /* Снятие из игры («Снять из игры» в «⋯», прежнее «Откатить») возвращает
     `update.rpf` целиком из точки восстановления — той самой, что установщик
     снял до записи. Ошибку говорим тостом, как и всё остальное в этом
     редакторе: своего места под сообщение у него нет. */
  async function rollbackInstall() {
    if (busy || installRecord.rollingBack) return;
    try {
      await installRecord.rollback();
      onNotice?.(tr("Килл-эффект возвращён к состоянию до установки"));
    } catch (error) {
      onNotice?.(sanitizeDesktopErrorMessage(error), "error");
    }
  }

  /*
   * «Применить» — одно нажатие на весь путь эффекта в игру.
   *
   * Эффект встаёт в очередь применения; на каком шаге он сейчас, видно на
   * экране «В процессе». В «Мои работы» — только через «Сохранить в мои работы».
   * Редактор при этом свободен — раньше он сорок пять секунд стоял под
   * слоем, накрывавшим приложение целиком.
   */
  function install(override = null) {
    if (!gameRoot) return;
    /* В игру уедет та правка, что была в момент нажатия, а не та, что будет
       в редакторе, когда дойдёт очередь. `override` — «Вернуть мой»: то, что
       стояло, со своими кадрами знака. */
    const snapshot = override?.project || project;
    const sequence = override ? override.sequence : markerSequence;
    const state = JSON.stringify(snapshot);
    void applyWorkshopWork({
      key: KILL_EFFECT_INSTALL_KEY,
      signature: override ? workSignature(snapshot) : installSignature,
      title: snapshot.name || tr("Килл-эффект"),
      editor: tr("Килл-эффект"),
      coverSlotId: "kill-effects",
      coverState: state,
      steps: REPLACING_INSTALL_STEPS,
      notify: (text, tone) => onNotice?.(text, tone),
      savedText: tr("Ставим килл-эффект в игру"),
      run: ({ report }) =>
        installEditorWork({
          editor: "kill-effect",
          storageKey: KILL_EFFECT_INSTALL_KEY,
          state,
          report,
          /* Кадры знака — те, что были в кадре в момент нажатия. */
          apply: async () =>
            applyKillEffectCustomization({
              project: snapshot,
              gameRoot,
              markerFrames: snapshot.marker.enabled
                ? await killMarkerInstallFrames(sequence)
                : [],
            }),
          /* Отпечаток знака в записи: по нему редактор видит, тот ли знак
             сейчас в файле прицела. */
          details: (result) => ({
            fields: result?.fields || 0,
            markerSignature: result?.marker?.signature || null,
          }),
        }),
      doneText: ({ result }) => {
        const restored = result?.modifier?.previousFields === 0;
        const duration = result?.duration?.applied
          ? copy.durationPart(formatMs(result.duration.applied))
          : tr(", длительность не менялась: в архиве нет visualsettings.dat");
        const sign = result?.marker?.enabled
          ? copy.markerPart(result.marker.frames)
          : result?.marker?.removed
            ? tr(", знак на килле снят — вернулся крестик игры")
            : "";
        /* Состояние игры перечитывается после установки: строка над кадром
           говорит, что в архиве лежит сейчас. */
        setGameState(null);
        readKillEffectState({ gameRoot })
          .then(setGameState)
          .catch(() => {});
        return (
          (result?.fields
            ? copy.installed(result.fields, duration)
            : tr("Килл-эффект установлен: вспышки нет")) +
          sign +
          (restored && result?.fields
            ? tr(". Пустой модификатор редукса заменён")
            : "")
        );
      },
    });
  }

  /* «Вернуть мой»: поставленное Astral — снова в редактор и снова в игру. */
  async function restoreInstalled() {
    let installed;
    try {
      installed = parseKillEffectProject(
        JSON.parse(installRecord.record?.installedState || "null"),
      );
    } catch {
      onNotice?.(tr("Запись установки не читается — поставьте эффект заново"), "error");
      return;
    }
    commit(() => installed);
    const sequence = installed.marker.enabled
      ? await killMarkerSequence(installed.marker.source).catch(() => null)
      : null;
    if (installed.marker.enabled && !sequence?.canvases?.length) {
      onNotice?.(
        tr("Картинки знака на этом компьютере нет — выберите её и нажмите «Применить»"),
        "error",
      );
      return;
    }
    install({ project: installed, sequence });
  }

  function download() {
    const blob = new Blob([`${JSON.stringify(project, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.name || "kill-effect"}.astral-kill.json`;
    link.click();
    URL.revokeObjectURL(url);
    onNotice?.(tr("Килл-эффект сохранён в файл"));
  }

  async function openProjectFile(list) {
    const file = [...(list || [])].find((item) => /\.json$/i.test(item.name));
    if (!file) {
      onNotice?.(tr("Нужен сохранённый проект килл-эффекта (.json)"), "error");
      return;
    }
    try {
      // Разбор до записи в состояние: битый файл должен назваться сразу, а не
      // превратиться в пустой редактор.
      const loaded = parseKillEffectProject(JSON.parse(await file.text()));
      commit(() => loaded);
      openedElsewhere(loaded.name || "");
      onNotice?.(copy.projectLoaded(file.name));
    } catch (error) {
      onNotice?.(String(error?.message || error), "error");
    }
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      onNotice?.(
        tr("Модификатор скопирован — можно вставить в timecycle_mods_4.xml"),
      );
    } catch {
      onNotice?.(tr("Буфер обмена недоступен"), "error");
    }
  }

  const status = stateError
    ? stateError
    : !gameRoot
      ? tr("GTA V не подключена — правки применятся к файлу игры при установке")
      : !gameState
        ? tr("Читаем файлы вашей GTA V…")
        : gameState.cleared
          ? tr("В вашей GTA V килл-эффект отключён: модификатор пуст")
          : gameState.available
            ? copy.inGame(gameState.fields, formatMs(gameState.duration))
            : gameState.broken
              ? /* Таймцикл испорчен чужим модом: файл и строка — словами окна. */
                failureReason(gameState.reason)
              : gameState.reason || tr("Файлы килл-эффекта в архиве не найдены");

  const tint = project.channels.tint;
  const vignette = project.channels.vignette;
  const drift = useMemo(
    () => killEffectDrift(installRecord.record, gameState),
    [installRecord.record, gameState],
  );
  const installedFlashless = useMemo(() => {
    try {
      const installed = JSON.parse(installRecord.record?.installedState || "null");
      return Boolean(installed) && !resolveKillEffectFields(parseKillEffectProject(installed)).length;
    } catch {
      return false;
    }
  }, [installRecord.record]);
  /* Пустой модификатор, который поставил сам человек («Без вспышки»), — его
     выбор, а не беда редукса. */
  const clearedByRedux = Boolean(gameState?.cleared) && !installedFlashless;
  /* Знак включён, а картинки нет — такой знак в игру не уедет: установка
     отказала бы уже после нажатия, поэтому кнопка гаснет до неё. */
  const applyBlocked = !gameRoot || markerMissing || markerPending;

  /*
   * Панель взятого инструмента — только его настройки. Имя раздела стоит
   * заголовком панели (каркас), поэтому у первого раздела своего заголовка
   * нет; что делает раздел — строка под заголовком панели (`note`).
   */
  const detail = detailSections().find((section) => section.id === tool);
  let panel;
  if (tool === "marker")
    panel = (
      <KillMarkerSection
        marker={marker}
        onChange={setMarker}
        onPickFile={pickMarkerFile}
        missing={markerMissing}
        busy={markerBusy}
        hidden={Boolean(gameState?.marker?.hidden)}
      />
    );
  else if (tool === "timing")
    panel = (
      <section className="ui-panel fx-section" aria-label={tr("Длительность")}>
        <div
          className="kill-duration-grid"
          role="group"
          aria-label={tr("Готовая длительность")}
        >
          {durationPresets().map((preset) => (
            <ChoiceTile
              key={preset.id}
              title={preset.label}
              description={formatMs(preset.value)}
              selected={project.duration === preset.value}
              onClick={() => setProjectField("duration", preset.value)}
            />
          ))}
        </div>
        <Slider
          label={tr("Длительность")}
          value={project.duration}
          min={KILL_DURATION_RANGE.min}
          max={KILL_DURATION_RANGE.max}
          step={10}
          unit={tr(" мс")}
          onChange={(value) => setProjectField("duration", value)}
        />
        <Slider
          label={tr("Интенсивность")}
          hint={tr("Все каналы разом; 0 % — без эффекта")}
          value={project.intensity}
          min={0}
          max={200}
          step={5}
          unit=" %"
          onChange={(value) => setProjectField("intensity", value)}
        />
      </section>
    );
  else if (tool === "vignette")
    panel = (
      <section className="ui-panel fx-section" aria-label={tr("Рамка по краям")}>
        <ChannelFields
          channel={KILL_EFFECT_CHANNEL_MAP.vignette}
          value={vignette}
          onField={(key, next) => setChannelField("vignette", key, next)}
        />
      </section>
    );
  else if (tool === "screen")
    panel = (
      <>
        <ChannelSection
          section={detail}
          channels={project.channels}
          onField={setChannelField}
          onToggle={toggleChannel}
        />
        {/* Тон кадра — то, чем вспышка спорит с таймциклом игрока: ванильная
            на миг подменяет тонмаппинг своим, и со своим небом или
            редуксом кадр прыгает по яркости. */}
        <section className="ui-panel fx-section" aria-label={tr("Тон кадра")}>
          <header className="fx-section-head">
            <h3>{tr("Тон кадра")}</h3>
            <Switch
              checked={killEffectOverridesTone(project)}
              label={tr("Тон игры на время килла")}
              onChange={setTone}
            />
          </header>
          <p className="fx-hint">
            {killEffectOverridesTone(project)
              ? tr("Вспышка на миг ставит плёночный тон игры. Со своим таймциклом или редуксом кадр прыгнет по яркости — тогда выключите.")
              : tr("Вспышка ложится поверх тона вашего таймцикла: цвет есть, скачка яркости нет.")}
          </p>
        </section>
      </>
    );
  else if (detail)
    panel = (
      <ChannelSection
        section={detail}
        channels={project.channels}
        onField={setChannelField}
        onToggle={toggleChannel}
      />
    );
  else if (tool === "templates")
    panel = (
      <>
        {/* Эффект, который уже стоит в игре, открывается отсюда одной
            кнопкой — с него начинают так же, как с готового. */}
        {!drift && gameState?.available && !gameState.cleared && (
          <div className="fx-core-missing kill-game-note is-info" role="note">
            <b>{tr("Сейчас в игре")}</b>
            {/* Описание собирает главный процесс по-русски; окно собирает его на языке окна из тех же данных проекта. */}
            <span>{gameState.project ? describeKillEffectFor(copy, parseKillEffectProject(gameState.project)) : gameState.summary}</span>
            <Button size="sm" variant="secondary" onClick={openInstalled}>
              {tr("Открыть в редакторе")}
            </Button>
          </div>
        )}
        <TemplateGrid selected={project.template} onPick={applyTemplate} />
      </>
    );
  else
    panel = (
      <section className="ui-panel fx-section" aria-label={tr("Цвет вспышки")}>
        <ColorField
          label={tr("Цвет")}
          value={tint.color}
          swatches={FLASH_SWATCHES}
          onChange={(next) => setChannelField("tint", "color", next)}
          ariaLabel={tr("Оттенок килла: Цвет")}
        />
        <Slider
          label={tr("Сила")}
          value={tint.amount}
          min={0}
          max={200}
          step={1}
          unit=" %"
          onChange={(next) => setChannelField("tint", "amount", next)}
        />
      </section>
    );

  return (
    <EditorShell
      className="fx-editor kill-effect-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская килл-эффекта")}
      status={status}
      tools={rail.tools}
      tool={rail.tool}
      onTool={rail.onTool}
      toolShortcuts={rail.shellShortcuts}
      panelHead={rail.panelHead}
      guide={guide}
      guideKey="kill-effect"
      actions={
        <EditorActions
          onUndo={undo}
          canUndo={state.past.length > 0}
          onRedo={redo}
          canRedo={state.future.length > 0}
          /* В «⋯» (владелец, 03.10.2026): мои работы и код, модификатор
             текстом, файл проекта, сброс и «Снять из игры» — прежнее
             «Откатить», которое стояло кнопкой в полосе. Оно появляется
             только после установки: установщик снял копию update.rpf до
             записи, и без него у установки не было бы дороги назад. */
          more={[
            ...works.items,
            {
              value: "copy-modifier",
              label: tr("Скопировать модификатор"),
              icon: <Copy />,
              disabled: !fields.length,
            },
            { value: "open", label: tr("Открыть файл"), icon: <FolderOpen /> },
            {
              value: "download",
              label: tr("Скачать файлом"),
              icon: <DownloadSimple />,
            },
            {
              value: "reset",
              label: tr("Сбросить всё"),
              icon: <ArrowCounterClockwise />,
            },
            ...(installRecord.record
              ? [
                  {
                    value: "rollback",
                    label: installRecord.rollingBack
                      ? tr("Снимаем из игры…")
                      : tr("Снять из игры"),
                    icon: <Trash />,
                    disabled: busy || installRecord.rollingBack,
                  },
                ]
              : []),
          ]}
          onMore={(action) => {
            if (works.handle(action)) return;
            if (action === "copy-modifier") void copySnippet();
            else if (action === "open") fileInputRef.current?.click();
            else if (action === "download") download();
            else if (action === "reset") resetEverything();
            else if (action === "rollback") void rollbackInstall();
          }}
          apply={{
            label: tr("Применить"),
            busy: applyButton.busy,
            meter: applyButton.meter,
            /* Кнопка всегда говорит, что сделает или почему погашена — как
               «Применить» мини-карты и прицела. */
            title:
              applyButton.hint ||
              (!gameRoot
                ? tr("GTA V Legacy на этом компьютере не нашлась — укажите папку игры")
                : markerMissing
                  ? tr("Выберите картинку знака на килле или выключите знак")
                  : markerPending
                    ? tr("Картинка знака ещё загружается")
                    : tr("Поставить килл-эффект в GTA V Legacy")),
            disabled: applyBlocked,
            onClick: () => install(),
          }}
        >
          {/* Игры нет — кнопка на виду: без неё «Применить» серое, и прятать
              причину в меню нельзя. */}
          {connectGame && (
            <Button variant="ghost" size="sm" onClick={connectGame}>
              {tr("Подключить GTA V")}
            </Button>
          )}
        </EditorActions>
      }
      inspector={
        <>
          {rail.switcher}
          <div className="fx-inspector kill-inspector">
            {panel}
          </div>
        </>
      }
    >
      {/*
       * Сцена — на весь кадр каркаса, на сплошной матовой пластине: сквозь
       * неё фона не видно, и зеркалу стекла под ней держать нечего
       * (`data-frost="off"`). Сама стена со вспышкой — экран между полосой
       * органов сверху и подсказками с подписью снизу: кайма вспышки идёт
       * вдоль всех четырёх краёв, и полоса поверх неё прятала бы верхний.
       */}
      <div className="kill-stage" data-frost="off">
        {/* Матовая стена без кадра игры — постановка, снимком работы она не становится (пустой тёмный кадр). */}
        <div className="kill-scene" ref={stageRef} data-frame-staged={frameShown || stage3d ? undefined : ""}>
          {/* Серия кадров GTA V с глубиной, снятая стендом: есть — вместо 3D-сцены и стены (выбор «Плоский» её прячет); нет — прежняя сцена. */}
          {stageMode === "flat" ? (
            <KillEffectStage
              project={project}
              playhead={playhead}
              bypass={comparing}
              markerSequence={markerSequence}
            />
          ) : (
            <FxKillFrameStage
              project={project}
              playhead={playhead}
              bypass={comparing}
              markerSequence={markerSequence}
              view={frameView || undefined}
              onStatus={onFrameStatus}
              fallback={
                stage3d ? (
                  <CombatKillStage
                    project={project}
                    playhead={playhead}
                    bypass={comparing}
                    markerSequence={markerSequence}
                    gameRoot={gameRoot}
                    onFailed={() => setStage3dFailed(true)}
                  />
                ) : (
                  <KillEffectStage
                    project={project}
                    playhead={playhead}
                    bypass={comparing}
                    markerSequence={markerSequence}
                  />
                )
              }
            />
          )}
          {/* Диагнозы — поверх кадра, а не в панели: это не настройка, и
              человек пришёл сюда потому, что вспышки в игре нет или она не
              та. Узнать причину он должен там, куда смотрит. */}
          {(drift || clearedByRedux) && (
            <div className="kill-stage-alerts">
              {drift && (
                /* Поставленное Astral в игре уже другое: поверх лёг редукс,
                   чужой мод или проверка файлов Steam. Дорога назад — одной
                   кнопкой, тем же «Применить» с тем, что стояло. */
                <div className="kill-stage-alert" role="note">
                  <Warning weight="fill" />
                  <div>
                    <b>{tr("В игре уже не ваш килл-эффект")}</b>
                    <small>
                      {drift === "marker"
                        ? tr("Знак на килле из игры пропал — файл прицела заменили после установки.")
                        : tr("Модификатор убийства в игре переписан после установки: редуксом, другим модом или проверкой файлов.")}
                    </small>
                  </div>
                  <Button size="sm" onClick={restoreInstalled}>
                    {tr("Вернуть мой")}
                  </Button>
                </div>
              )}
              {clearedByRedux && (
                <div className="kill-stage-alert" role="status">
                  <Warning weight="fill" />
                  <div>
                    <b>{tr("В вашей сборке килл-эффект выключен")}</b>
                    <small>
                      {tr("Модификатор на месте, но пустой — так делает почти каждый редукс. Поставьте «Как в игре», чтобы вернуть вспышку.")}
                    </small>
                  </div>
                  <Button size="sm" onClick={() => applyTemplate("vanilla")}>
                    {tr("Вернуть ванильную")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
        <StageBar wide className="kill-stage-bar" label={tr("Проигрывание")}>
          {/* Подпись постоянная, состояние — в `aria-pressed` и подсветке:
              подпись, которая меняется вместе с `aria-pressed`, читалка
              произносит как обратное правде. */}
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowClockwise />}
            active={playback === "loop"}
            aria-pressed={playback === "loop"}
            title={
              playback === "loop"
                ? tr("Остановить повтор")
                : tr("Повторять килл по кругу")
            }
            onClick={() =>
              setPlayback((value) => (value === "loop" ? "paused" : "loop"))
            }
          >
            {tr("Повтор")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Play />}
            title={tr("Проиграть килл один раз")}
            onClick={() => {
              playhead.set(0);
              setPlayback("once");
              setRunId((value) => value + 1);
            }}
          >
            {tr("Килл")}
          </Button>
          {/* Переключатель, а не «удерживать»: удержание мышью не повторяется
              с клавиатуры, а сравнивать кадр надо всем. */}
          <Button
            variant="ghost"
            size="sm"
            icon={<Eye />}
            active={comparing}
            aria-pressed={comparing}
            title={comparing ? tr("Вернуть эффект") : tr("Показать экран без эффекта")}
            onClick={() => setComparing((value) => !value)}
          >
            {tr("Как было")}
          </Button>
          {(can3d || framesExist) && (
            <SegmentedControl
              size="sm"
              label={tr("Вид кадра")}
              options={[
                { value: "3d", label: framesExist ? tr("Кадр игры") : tr("Объёмный") },
                { value: "flat", label: tr("Плоский") },
              ]}
              value={frameShown || stage3d ? "3d" : "flat"}
              onChange={(next) => {
                setStage3dFailed(false);
                setStageMode(next);
              }}
            />
          )}
          {/* Ракурс серии — только когда снято больше одного (у набора до ракурсов выбирать не из чего). */}
          {frameShown && frameViewOptions.length > 0 && (
            <SegmentedControl size="sm" label={tr("Ракурс кадра")} options={frameViewOptions} value={frameStatus.view} onChange={setFrameView} />
          )}
          <KillScrub
            playhead={playhead}
            max={timelineMs}
            onScrub={scrubTo}
          />
        </StageBar>
        {/* Строки состояния кадра: у серии кадров и у 3D-сцены они свои (`FxKillFrameStage`, `CombatKillStage`), у плоского — эта. */}
        {!frameShown && !stage3d ? (
          <StageNote>{tr("Цвет вспышки, её плотность и время — те, что уйдут в игру.")}</StageNote>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          void openProjectFile(event.target.files);
          event.target.value = "";
        }}
      />
      {works.dialogs}
    </EditorShell>
  );
}
