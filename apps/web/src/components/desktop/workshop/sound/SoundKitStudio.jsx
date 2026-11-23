/*
 * Мастерская звуков: выстрелы стволов и попадания.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026). Кадр
 * посередине — стрельбище, где ствол стреляет в такт звуку, или
 * человек-мишень, по которому слышно попадание. Органы кадра — в правом
 * верхнем углу (`StageBar`): ствол выбирается карточкой (вся полка «Оружие»
 * мастерской), «Огонь» держит курок, пока его не остановят, и всё, что
 * правится во время стрельбы, слышно прямо в ней. Слева — инструменты:
 * «Свой звук» (файл первым — с него приходят), «Звучание», «В игре» (правда
 * об игре) и «Шаблоны» — готовые звуки, по шестнадцать на группу стволов и на
 * каждую часть тела. Справа — настройки только взятого инструмента.
 *
 * «Оружие» и «Попадания» остаются вкладками в полосе над кадром, а не
 * инструментами: это выбор предмета работы — у них разные кадры и разные
 * моды в игре, — а инструменты у обоих одни и те же.
 *
 * Звук ствола — только его: у карабина и карабина MK2 в игре одни дорожки,
 * но свой звук встаёт переопределением одного ствола (главный процесс,
 * `weapon-voice-plan`), и соседи стреляют как прежде. Две вкладки — две
 * разные вещи в игре, и ставятся они раздельно: у каждого ствола свой мод,
 * у попаданий — свой (голова и тело внутри него отдельными частями).
 * Поэтому и в библиотеке они лежат отдельно: звуки оружия, попадание в
 * голову, попадание в тело.
 *
 * «Окружение» (ТЗ владельца 17.10.2026, задача 5) — третья вкладка: пульт
 * громкости машин, улиц, природы, погоды и людей по отдельности. Кадр у неё
 * свой — сам пульт (`MixStage`), инструменты свои: «Микшер», «Шаблоны»,
 * «В игре». В игру ползунки уезжают своим модом — громкостью категорий
 * звука игры (`@modovik/sound-studio/sound-mix`).
 *
 * Замена дорожек музыки загрузки, сирен и полный список дорожек — в прежней
 * студии; дорога к ней — в меню «⋯». Там же, как у
 * всех редакторов мастерской, «Сохранить в мои работы» и код для друга:
 * выстрелы и попадания — одна работа, свои файлы в код не уходят.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  Crosshair,
  GameController,
  MusicNotes,
  Play,
  SlidersHorizontal,
  Stop,
  Swatches,
  Target,
  Trash,
  UploadSimple,
  Wind,
} from "../../../ui/icons.jsx";
import {
  DEFAULT_WEAPON_SOUND,
  HIT_SOUND_PART_IDS,
  WEAPON_SOUNDS,
  WEAPON_SOUND_GROUP_MAP,
  WEAPON_SOUND_MAP,
} from "@modovik/sound-studio";
import {
  chooseGameInstallation,
  desktopHost,
  detectInstallations,
  hasDesktopBridge,
  sanitizeDesktopErrorMessage,
} from "../../../../api.js";
import { useWorkshopInstalls } from "../../../../features/workshop/install-queue/index.js";
import { workshopInstallStatusOf } from "../../../../features/workshop/install-queue/queue.js";
import { useWorkActions } from "../../../../features/workshop/works/useWorkActions.jsx";
import { soundCode } from "../../../../features/workshop/works/work-transfer.js";
import {
  WorksStoreError,
  linkedEditorWork,
  saveEditorWorkToWorks,
  unlinkEditorWork,
} from "../../../../features/workshop/works/workshop-works.js";
import { useRememberedState } from "../../../../section-memory.js";
import Button from "../../../ui/Button.jsx";
import EditorActions from "../../../ui/EditorActions.jsx";
import EditorShell from "../../../ui/EditorShell.jsx";
import PageTabs from "../../../ui/PageTabs.jsx";
import { StageBar, StageNote } from "../../../ui/StageOverlay.jsx";
import { useSkyHistory } from "../useSkyHistory.js";
import HitStage from "./HitStage.jsx";
import { HitInspector, WeaponInspector } from "./SoundKitInspector.jsx";
import SoundKitPresets from "./SoundKitPresets.jsx";
import { WeaponChip, WeaponSheet } from "./WeaponPicker.jsx";
import WeaponStage, { useRangeEffects } from "./WeaponStage.jsx";
import { FX_DEFAULTS, fxIsNeutral } from "./sound-fx.js";
import { HIT_PRESETS, WEAPON_PRESETS } from "./sound-presets.js";
import {
  SOUND_KIT_HITS_KEY,
  SOUND_KIT_MIX_KEY,
  hitPartInstallState,
  mixInstallState,
  queueMixRemoval,
  queueSoundKit,
  hitsInstallCurrent,
  queueWeaponRemoval,
  reconcileSoundKitInstalls,
  refreshOutdatedSoundKit,
  soundKitInstalls,
  soundKitOutdated,
  soundKitPending,
  soundKitPendingCount,
  soundKitServiceCurrent,
  soundKitWeaponKey,
  useSoundKitInstalls,
  weaponInstallCurrent,
  weaponInstallState,
} from "./sound-kit-apply.js";
import { hitCombatAudibility } from "@modovik/sound-studio/hit-masking";
import {
  SOUND_MIX_CHANNEL_MAP,
  SOUND_MIX_CHANNELS,
  normalizeSoundMix,
  soundMixFromPreset,
  soundMixPresetOf,
  toggleSoundMixChannel,
  toggleSoundMixGroup,
} from "@modovik/sound-studio/sound-mix";
import MixInspector from "./MixInspector.jsx";
import MixStage from "./MixStage.jsx";
import {
  designSource,
  loadAssetBuffer,
  renderHitPreview,
  renderWeaponPreview,
} from "./sound-kit-audio.js";
import { SoundImportError, importKitSound } from "./sound-kit-import.js";
import SoundFitDialog from "./SoundFitDialog.jsx";
import { fitVerdict, hitNeed, weaponNeed } from "./sound-fit.js";
import {
  SILENT_DESIGN,
  designFromPreset,
  designIsSilent,
  designSignature,
  hitsSignature,
  loadSoundKit,
  mixSignature,
  normalizeDesign,
  soundKitDraftIsWork,
  soundKitFromWorkState,
  soundKitIsEmpty,
  soundKitWorkState,
  storeSoundKit,
} from "./sound-kit-model.js";
import { useSoundKitAudio } from "./useSoundKitAudio.js";
import useHistoryKeys from "../../../../hooks/useHistoryKeys.js";
import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";
import { soundLower } from "./sound-copy.js";

const TABS = Object.freeze([
  { value: "weapons", label: "Оружие", icon: <Crosshair /> },
  { value: "hits", label: "Попадания", icon: <Target /> },
  { value: "mix", label: "Окружение", icon: <Wind /> },
]);

/*
 * Инструменты студии — одни у стволов и у попаданий. Цифры — горячие
 * клавиши, как у остальных кадров мастерской.
 */
const KIT_TOOLS = Object.freeze([
  {
    id: "source",
    label: "Свой звук",
    icon: <UploadSimple />,
    shortcut: "1",
    group: "sound",
    note: "Свой файл вместо звука игры",
    hint: "Перетащите файл на кадр или в поле справа — он сразу зазвучит так, как в игре",
  },
  {
    id: "tone",
    label: "Звучание",
    icon: <SlidersHorizontal />,
    shortcut: "2",
    group: "sound",
    note: "Громкость, глухота, тембр, эхо и тон",
    hint: "Двигайте ручки во время стрельбы или серии — правка слышна сразу",
  },
  {
    id: "game",
    label: "В игре",
    icon: <GameController />,
    shortcut: "3",
    group: "game",
    note: "Что заменится в игре и стоит ли звук сейчас",
    hint: "Здесь видно, ждёт ли звук «Применить» и что в игре останется своим",
  },
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    shortcut: "4",
    group: "ready",
    note: "Готовые звуки — с них начинают",
    hint: "Плитка ставит звук и сразу играет его — выбирайте на слух",
  },
]);

/*
 * Инструменты «Окружения»: пульт, готовые настройки и правда об игре.
 * Своего звука и звучания у громкости категорий нет — это не дорожка.
 */
const MIX_TOOLS = Object.freeze([
  {
    id: "mixer",
    label: "Микшер",
    icon: <SlidersHorizontal />,
    shortcut: "1",
    group: "sound",
    note: "Громкость каждого канала по отдельности",
    hint: "Двигайте ползунки на пульте; щелчок по каналу покажет, что в нём звучит",
  },
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    shortcut: "2",
    group: "ready",
    note: "Готовые настройки окружения",
    hint: "Плитка ставит все ползунки шаблона — дальше правьте на пульте",
  },
  {
    id: "game",
    label: "В игре",
    icon: <GameController />,
    shortcut: "3",
    group: "game",
    note: "Стоит ли окружение и что оно меняет",
    hint: "Здесь видно, ждёт ли окружение «Применить» и как его снять",
  },
]);

/* Управление кадром: у стрельбища — файл и отмена, у мишени ещё щелчок по
   фигуре, у пульта — канал. */
const KIT_GUIDE = Object.freeze({
  weapons: Object.freeze([
    { keys: "Файл", text: "на кадр — свой звук" },
    { keys: ["Ctrl", "Z"], text: "отменить" },
  ]),
  hits: Object.freeze([
    { keys: "ЛКМ", text: "по фигуре — часть и её звук" },
    { keys: "Файл", text: "на кадр — свой звук" },
    { keys: ["Ctrl", "Z"], text: "отменить" },
  ]),
  mix: Object.freeze([
    { keys: "ЛКМ", text: "по каналу — что в нём звучит" },
    { keys: ["Ctrl", "Z"], text: "отменить" },
  ]),
});

/* Бюджет банка до ответа игры: так же, как его считает главный процесс. */
const DEFAULT_HIT_TARGET = Object.freeze({
  sampleRate: 24000,
  maxSamples: 21600,
  maxSeconds: 0.9,
});

/* Ствол «как в игре», которому тронули ручку: голос игры с обработкой. */
const ORIGINAL_DESIGN = Object.freeze({
  source: Object.freeze({ kind: "original" }),
  preset: "",
  fx: Object.freeze({ ...FX_DEFAULTS, normalize: false }),
});

const PART_TITLES = Object.freeze({ head: "Голова", body: "Тело" });

/* Ручки окна подгонки — поверх ручек замысла: громкость и прочее остаются
   (задача 6). */
const fitDesign = (design, draft, options) =>
  normalizeDesign({ ...design, fx: { ...design.fx, ...draft } }, options);

function restoreEdits() {
  const kit = loadSoundKit();
  return { weapons: kit.weapons, hits: kit.hits, mix: kit.mix };
}

/* Замысел, который звучит ровно как игра, — не замысел: ставить нечего. */
function settleWeaponDesign(design) {
  const normal = design ? normalizeDesign(design) : null;
  if (normal?.source.kind === "original" && fxIsNeutral(normal.fx)) return null;
  return normal;
}

/* Выбрана ли плитка: готовый звук стоит как есть, ручки не тронуты. */
function presetSelected(design, presets) {
  if (!design?.preset) return "";
  const preset = presets.find((item) => item.id === design.preset);
  if (!preset) return "";
  return designSignature(designFromPreset(preset)) === designSignature(design)
    ? preset.id
    : "";
}

const isLive = (status) => status === "running" || status === "queued";

export default function SoundKitStudio({
  onExit,
  onNotice,
  initialTab = "",
  initialPart = "",
  onOpenLegacy = null,
}) {
  useTr();
  const language = useUiLanguage();
  const stored = useMemo(() => loadSoundKit(), []);
  /* Вкладки, инструменты и органы кадра — данные уровня модуля, на русском:
     в место отрисовки они приходят переведёнными. */
  const tabs = useMemo(
    () => TABS.map((item) => ({ ...item, label: tr(item.label) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );
  const [tab, setTab] = useRememberedState("sound-kit:tab", stored.tab);
  const mixTab = tab === "mix";
  const tools = useMemo(
    () =>
      (mixTab ? MIX_TOOLS : KIT_TOOLS).map((item) => ({
        ...item,
        label: tr(item.label),
        note: tr(item.note),
        hint: tr(item.hint),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, mixTab],
  );
  const guide = useMemo(
    () =>
      KIT_GUIDE[mixTab ? "mix" : tab === "hits" ? "hits" : "weapons"].map((item) => ({
        ...item,
        keys: typeof item.keys === "string" ? tr(item.keys) : item.keys,
        text: tr(item.text),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, tab, mixTab],
  );
  const [weaponId, setWeaponId] = useRememberedState(
    "sound-kit:weapon",
    stored.weapon,
  );
  const [part, setPart] = useRememberedState("sound-kit:part", stored.part);
  const [kitTool, setKitTool] = useRememberedState("sound-kit:tool", "source");
  /* У «Окружения» свои инструменты — и свой взятый. */
  const [storedMixTool, setMixTool] = useRememberedState("sound-kit:mix-tool", "mixer");
  /* Запомненный инструмент, которого у «Окружения» больше нет (сетка одних
     шаблонов 18.10.2026 жила без пульта), — пульт: иначе справа пусто. */
  const mixTool = MIX_TOOLS.some((item) => item.id === storedMixTool) ? storedMixTool : "mixer";
  const tool = mixTab ? mixTool : kitTool;
  const setTool = mixTab ? setMixTool : setKitTool;
  /* Канал пульта, который показан справа. */
  const [mixChannel, setMixChannel] = useRememberedState(
    "sound-kit:mix-channel",
    SOUND_MIX_CHANNELS[0].id,
  );
  /* Полка стволов поверх кадра: открывает её карточка ствола в органах кадра. */
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const history = useSkyHistory(restoreEdits);
  const edits = history.state;

  /* Плитка звука открывает свою вкладку: «Звуки при попадании» — попадания. */
  useEffect(() => {
    if (initialTab === "weapons" || initialTab === "hits" || initialTab === "mix")
      setTab(initialTab);
    if (HIT_SOUND_PART_IDS.includes(initialPart)) setPart(initialPart);
  }, [initialTab, initialPart, setTab, setPart]);

  const weapon =
    WEAPON_SOUND_MAP[weaponId] || WEAPON_SOUND_MAP[DEFAULT_WEAPON_SOUND];
  const weaponDesign = edits.weapons[weapon.id] || null;
  const hitDesign = edits.hits[part] || null;
  const voiced = weapon.voice.length > 0;

  /* --- Игра --- */

  const host = useMemo(() => desktopHost() || null, []);
  const [game, setGame] = useState(null);
  const gameRoot = game?.path || "";

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
        if (legacy) setGame({ path: legacy.path, id: legacy.id });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /* Запись установки сверяется с игрой: мод могли снять мимо студии. Звук,
     поставленный прежней версией Astral, сразу встаёт заново тем же
     замыслом. */
  const noticeRef = useRef(onNotice);
  useEffect(() => {
    noticeRef.current = onNotice;
  }, [onNotice]);
  useEffect(() => {
    if (!game?.id || !host?.listSoundWorks) return;
    let cancelled = false;
    host
      .listSoundWorks({ targetId: game.id })
      .then((result) => {
        if (cancelled) return;
        reconcileSoundKitInstalls(result?.works);
        const notify = (...args) => noticeRef.current?.(...args);
        /* Окно обновилось на лету, а приложение не перезапускали: звук
           встал бы прежним способом — об этом говорится прямо. */
        if (!soundKitServiceCurrent(result?.formats)) {
          const outdated = soundKitOutdated(soundKitInstalls());
          if (outdated.weapons.length || outdated.hits)
            notify(
              tr("Astral обновился — перезапустите приложение, и звуки в игре встанут по-новому сами."),
            );
          return;
        }
        refreshOutdatedSoundKit({ host, notify, formats: result?.formats });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [game, host]);

  /* Сколько звука примет каждая часть попадания — из банка игры. */
  const [budget, setBudget] = useState(null);
  useEffect(() => {
    if (!gameRoot || !host?.readHitSoundBudget) return undefined;
    let cancelled = false;
    host
      .readHitSoundBudget({ gameRoot })
      .then((result) => {
        if (!cancelled) setBudget(result || null);
      })
      .catch(() => {
        if (!cancelled) setBudget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [gameRoot, host]);
  const hitTarget = useCallback(
    (id) => budget?.parts?.[id] || DEFAULT_HIT_TARGET,
    [budget],
  );

  /*
   * Слышно ли звук части в бою — мерка по записи звука игры
   * (`@modovik/sound-studio/hit-masking`): одиночный звук в студии звучит в
   * тишине, а в игре — в эхе выстрела и в крике раненого. Меряется тот же
   * рендер, что уйдёт в дорожку игры. Пока не посчитано (или браузер не
   * умеет синтез) — `null`, и студия молчит, а не гадает.
   */
  const [combat, setCombat] = useState(null);
  const hitDesignKey = designSignature(hitDesign);
  useEffect(() => {
    if (tab !== "hits" || !hitDesign) {
      setCombat(null);
      return undefined;
    }
    let cancelled = false;
    renderHitPreview(hitDesign, hitTarget(part))
      .then((rendered) => {
        if (cancelled) return;
        setCombat({
          key: `${part}|${hitDesignKey}`,
          ...hitCombatAudibility(rendered.channels[0], rendered.sampleRate, part),
        });
      })
      .catch(() => {
        if (!cancelled) setCombat(null);
      });
    return () => {
      cancelled = true;
    };
    // hitDesign меняется вместе со своим отпечатком — он и ключ пересчёта.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, part, hitDesignKey, hitTarget]);

  const connectGame = useMemo(() => {
    if (gameRoot || !hasDesktopBridge()) return null;
    return async () => {
      try {
        const chosen = await chooseGameInstallation();
        const picked = chosen?.game || chosen;
        if (picked?.path) setGame({ path: picked.path, id: picked.id });
      } catch (error) {
        onNotice?.(sanitizeDesktopErrorMessage(error), "error");
      }
    };
  }, [gameRoot, onNotice]);

  /* --- Звук в окне --- */

  const audio = useSoundKitAudio({ host, gameRoot, onNotice });
  const { setWeapon, prepare, prepareHits, setHits, stop, shoot, hit, toggleFire, toggleSeries } =
    audio;

  /* Проигрыватель всегда знает, что звучит сейчас: стрельба и серия берут
     звук отсюда на каждом выстреле, поэтому правка слышна на ходу. */
  useEffect(() => {
    setWeapon(weapon, weaponDesign);
  }, [setWeapon, weapon, weaponDesign]);
  useEffect(() => {
    setHits(edits.hits, hitTarget);
  }, [setHits, edits.hits, hitTarget]);
  /* Звук ствола собирается заранее, в паузах (ТЗ 24.10.2026, п. 3): «Огонь» не ждёт чтения игры и сведения. */
  useEffect(() => {
    if (tab === "weapons") prepare();
  }, [tab, prepare, weapon, weaponDesign]);
  useEffect(() => {
    if (tab === "hits") prepareHits();
  }, [tab, prepareHits, edits.hits, hitTarget]);

  /* Переход на другую вкладку глушит звучащее; смена ствола — нет: стрельба
     продолжается уже новым стволом. Полка стволов уходит вместе с
     вкладкой. */
  useEffect(() => stop, [tab, stop]);
  useEffect(() => setPickerOpen(false), [tab]);

  /* --- Правка --- */

  const setWeaponDesign = useCallback(
    (id, update, label = null) =>
      history.commit((current) => {
        const previous = current.weapons[id] || null;
        const next = settleWeaponDesign(
          typeof update === "function" ? update(previous) : update,
        );
        if (!next && !previous) return current;
        const weapons = { ...current.weapons };
        if (next) weapons[id] = next;
        else delete weapons[id];
        return { ...current, weapons };
      }, label),
    [history],
  );

  const setHitDesign = useCallback(
    (id, update, label = null) =>
      history.commit((current) => {
        const previous = current.hits[id] || null;
        const raw = typeof update === "function" ? update(previous) : update;
        const next = raw
          ? normalizeDesign(raw, { allowOriginal: false })
          : null;
        if (!next && !previous) return current;
        return { ...current, hits: { ...current.hits, [id]: next } };
      }, label),
    [history],
  );

  /* Окружение: ползунок двигает один канал, шаблон и сбросы — все разом.
     Метка истории у ползунка своя: перетаскивание — один шаг «Отменить». */
  const setMix = useCallback(
    (update, label = null) =>
      history.commit((current) => {
        const next = normalizeSoundMix(
          typeof update === "function" ? update(current.mix) : update,
        );
        if (mixSignature(next) === mixSignature(current.mix)) return current;
        return { ...current, mix: next };
      }, label),
    [history],
  );
  const onMixLevel = useCallback(
    (id, level) =>
      setMix(
        (mix) => ({ levels: { ...(mix?.levels || {}), [id]: level } }),
        `mix:${id}`,
      ),
    [setMix],
  );
  /* «Выключить / включить»: выключенный канал возвращается на прежнее значение, а не на 0 — прежние значения помнит окно, пока открыта студия. */
  const mixMemory = useRef({});
  const mixNow = useRef(null);
  mixNow.current = edits.mix;
  const onMixToggle = useCallback(
    (id) => {
      const { mix, memory } = toggleSoundMixChannel(mixNow.current, id, mixMemory.current);
      mixMemory.current = memory;
      setMix(mix, `mix-toggle:${id}`);
    },
    [setMix],
  );
  const onMixGroupToggle = useCallback(
    (group) => {
      const { mix, memory } = toggleSoundMixGroup(mixNow.current, group, mixMemory.current);
      mixMemory.current = memory;
      setMix(mix, `mix-group:${group}`);
    },
    [setMix],
  );
  const onMixGroupReset = useCallback(
    (group) =>
      setMix((mix) => ({
        levels: Object.fromEntries(
          Object.entries(mix?.levels || {}).filter(
            ([id]) => SOUND_MIX_CHANNEL_MAP[id]?.group !== group,
          ),
        ),
      })),
    [setMix],
  );
  const onMixPreset = useCallback(
    (preset) => setMix(soundMixFromPreset(preset)),
    [setMix],
  );
  const onMixReset = useCallback(() => setMix({ levels: {} }), [setMix]);
  const selectMixChannel = useCallback(
    (id) => {
      setMixChannel(id);
    },
    [setMixChannel],
  );

  /* Без стрельбы новый звук пробуется сразу: у автомата — короткой
     очередью. Во время стрельбы он и так звучит в ней. */
  const auditionWeapon = useCallback(
    (design) => void shoot({ design, audition: true }),
    [shoot],
  );

  /* Свой файл: прочитан и сохранён — сразу звучит так, как будет в игре. */
  const [assets, setAssets] = useState({});
  const [importing, setImporting] = useState("");
  const [importNotes, setImportNotes] = useState({ target: "", notes: [] });
  const target = tab === "hits" ? `hit:${part}` : `weapon:${weapon.id}`;

  /*
   * Сколько звука ждёт место (задача 6 ТЗ 10.10.2026, вечер): выстрел — в
   * длинах дорожек голоса ствола, попадание — в бюджете банка. Файл длиннее
   * места — студия сама предлагает подогнать его (`SoundFitDialog`), а не
   * молча отдаёт игре на обрезку.
   */
  const need = useMemo(
    () => (tab === "hits" ? hitNeed(hitTarget(part), part) : weaponNeed(weapon)),
    // Язык — в зависимостях: подписи места собираются переводом.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, part, weapon, hitTarget, language],
  );
  /* Окно подгонки: для какой цели и открылось ли само после загрузки. */
  const [fitting, setFitting] = useState(null);
  const openFit = useCallback(
    () => setFitting({ target, fresh: false }),
    [target],
  );

  const importFiles = useCallback(
    async (files) => {
      const forTarget = target;
      if (tab !== "hits" && !voiced) {
        onNotice?.(
          tr("У «{title}» нет своего голоса в игре — свой звук ставить некуда.").replace("{title}", weapon.title),
          "error",
        );
        return;
      }
      setImporting(forTarget);
      try {
        const maxSeconds = tab === "hits" ? hitTarget(part).maxSeconds : 0;
        const imported = await importKitSound(files, { maxSeconds });
        setAssets((current) => ({
          ...current,
          [imported.source.assetHash]: imported.buffer,
        }));
        setImportNotes({ target: forTarget, notes: imported.notes });
        const design = {
          source: imported.source,
          preset: "",
          fx: {
            ...FX_DEFAULTS,
            trimStart: imported.trimStart,
            trimEnd: imported.trimEnd,
          },
        };
        if (tab === "hits") {
          setHitDesign(part, design);
          void hit(part, normalizeDesign(design, { allowOriginal: false }));
        } else {
          setWeaponDesign(weapon.id, design);
          auditionWeapon(normalizeDesign(design));
        }
        /* Длиннее места — предложение подогнать: длина файла без тишины в
           начале, а не уже обрезанная по пределу. */
        const length = imported.buffer.duration - imported.trimStart;
        if (fitVerdict(length, need) !== "fits")
          setFitting({ target: forTarget, fresh: true });
      } catch (error) {
        onNotice?.(
          error instanceof SoundImportError
            ? error.message
            : sanitizeDesktopErrorMessage(error),
          "error",
        );
      } finally {
        setImporting("");
      }
    },
    [
      target,
      tab,
      voiced,
      weapon.title,
      part,
      weapon.id,
      hitTarget,
      need,
      setHitDesign,
      setWeaponDesign,
      auditionWeapon,
      hit,
      onNotice,
    ],
  );

  /* Файл текущей правки — для обрезки по волне. `null` — файла больше нет. */
  const currentDesign = tab === "hits" ? hitDesign : weaponDesign;
  const assetHash =
    currentDesign?.source?.kind === "file"
      ? currentDesign.source.assetHash
      : "";
  useEffect(() => {
    if (!assetHash || assets[assetHash] !== undefined) return undefined;
    let cancelled = false;
    loadAssetBuffer(assetHash)
      .then((buffer) => {
        if (!cancelled)
          setAssets((current) => ({ ...current, [assetHash]: buffer }));
      })
      .catch(() => {
        if (!cancelled)
          setAssets((current) => ({ ...current, [assetHash]: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [assetHash, assets]);

  const onWeaponFx = useCallback(
    (patch, knob) =>
      setWeaponDesign(
        weapon.id,
        (previous) => {
          const base = previous || ORIGINAL_DESIGN;
          return { ...base, fx: { ...base.fx, ...patch } };
        },
        `fx:${weapon.id}:${knob}`,
      ),
    [setWeaponDesign, weapon.id],
  );
  const onWeaponTrim = useCallback(
    (patch) =>
      setWeaponDesign(weapon.id, (previous) =>
        previous ? { ...previous, fx: { ...previous.fx, ...patch } } : previous,
      ),
    [setWeaponDesign, weapon.id],
  );
  const onWeaponResetFx = useCallback(
    () =>
      setWeaponDesign(weapon.id, (previous) =>
        previous
          ? {
              ...previous,
              fx: {
                ...FX_DEFAULTS,
                normalize: previous.source.kind !== "original",
                trimStart: previous.fx.trimStart,
                trimEnd: previous.fx.trimEnd,
              },
            }
          : previous,
      ),
    [setWeaponDesign, weapon.id],
  );
  const onWeaponRevertSource = useCallback(
    () =>
      setWeaponDesign(weapon.id, (previous) =>
        previous
          ? {
              source: { kind: "original" },
              preset: "",
              fx: { ...previous.fx, trimStart: 0, trimEnd: 0 },
            }
          : previous,
      ),
    [setWeaponDesign, weapon.id],
  );

  /* «Без своих выстрелов» (30.10.2026): тишина — замысел ствола, один выбор вместе со своим звуком. Выключили — звук игры («как в игре»); включили — тишина вместо звука. */
  const onWeaponMute = useCallback(
    (on) => {
      stop();
      setWeaponDesign(weapon.id, on ? SILENT_DESIGN : null, `mute:${weapon.id}`);
    },
    [setWeaponDesign, stop, weapon.id],
  );
  /* Всем стволам разом одним шагом «Отменить»: выключить выстрелы у всех или вернуть звук игры тем, у кого они выключены; свой звук других стволов остаётся. */
  const onWeaponMuteAll = useCallback(
    (on) => {
      stop();
      history.commit((current) => {
        const weapons = { ...current.weapons };
        for (const item of WEAPON_SOUNDS) {
          if (on) weapons[item.id] = SILENT_DESIGN;
          else if (designIsSilent(weapons[item.id])) delete weapons[item.id];
        }
        return { ...current, weapons };
      }, "mute:all");
    },
    [history, stop],
  );

  const firstHitPreset = useCallback(
    (id) => designFromPreset(HIT_PRESETS[id][0]),
    [],
  );
  /* Часть без звука — штатный удар игры; вернуть её к нему — снять замысел. */
  const onHitRevert = useCallback(
    (id) => setHitDesign(id, null),
    [setHitDesign],
  );
  /* Тронул ручку части без звука — значит, хочешь её звук: часть получает
     первый готовый звук и сразу правку. */
  const onHitFx = useCallback(
    (patch, knob) =>
      setHitDesign(
        part,
        (previous) => {
          const base = previous || firstHitPreset(part);
          return { ...base, fx: { ...base.fx, ...patch } };
        },
        `hit:${part}:${knob}`,
      ),
    [setHitDesign, part, firstHitPreset],
  );
  const onHitTrim = useCallback(
    (patch) =>
      setHitDesign(part, (previous) =>
        previous ? { ...previous, fx: { ...previous.fx, ...patch } } : previous,
      ),
    [setHitDesign, part],
  );
  const onHitResetFx = useCallback(
    () =>
      setHitDesign(part, (previous) => {
        if (!previous) return previous;
        const preset = HIT_PRESETS[part].find(
          (item) => item.id === previous.preset,
        );
        /* Готовый звук возвращается к своим ручкам, свой файл — к чистым. */
        const fx =
          previous.source.kind === "synth" && preset
            ? designFromPreset(preset).fx
            : FX_DEFAULTS;
        return {
          ...previous,
          fx: {
            ...fx,
            trimStart: previous.fx.trimStart,
            trimEnd: previous.fx.trimEnd,
          },
        };
      }),
    [setHitDesign, part],
  );

  const weaponPresets = WEAPON_PRESETS[weapon.group] || [];
  const onWeaponPreset = useCallback(
    (preset) => {
      const design = designFromPreset(preset);
      setWeaponDesign(weapon.id, design);
      auditionWeapon(settleWeaponDesign(design));
    },
    [setWeaponDesign, weapon.id, auditionWeapon],
  );
  const onHitPreset = useCallback(
    (preset) => {
      const design = designFromPreset(preset);
      setHitDesign(part, design);
      void hit(part, design);
    },
    [setHitDesign, part, hit],
  );

  /* --- Подгонка длины (задача 6) --- */

  /* «Стало» в окне — тот же рендер, что у стрельбы и серии попаданий:
     выстрел очереди в длине дорожки игры, удар — в бюджете банка. */
  const renderFit = useCallback(
    async (draft) => {
      if (tab === "hits")
        return renderHitPreview(
          fitDesign(hitDesign, draft, { allowOriginal: false }),
          hitTarget(part),
        );
      const { shot } = await renderWeaponPreview(weapon, fitDesign(weaponDesign, draft), {
        host,
        gameRoot,
      });
      return shot;
    },
    [tab, hitDesign, weaponDesign, hitTarget, part, weapon, host, gameRoot],
  );
  const gameVoice = useCallback(
    async () =>
      (await designSource({ source: { kind: "original" } }, { host, gameRoot, weapon }))
        .shot,
    [host, gameRoot, weapon],
  );
  const applyFit = useCallback(
    (draft) => {
      setFitting(null);
      setImportNotes({ target: "", notes: [] });
      if (tab === "hits") {
        const next = fitDesign(hitDesign, draft, { allowOriginal: false });
        setHitDesign(part, next);
        void hit(part, next);
      } else {
        const next = fitDesign(weaponDesign, draft);
        setWeaponDesign(weapon.id, next);
        auditionWeapon(next);
      }
    },
    [tab, hitDesign, weaponDesign, part, weapon.id, setHitDesign, setWeaponDesign, hit, auditionWeapon],
  );

  /* --- Черновик и отмена --- */

  const snapshotRef = useRef(null);
  snapshotRef.current = { edits, tab, weapon: weapon.id, part };
  const saveDraft = useCallback(() => {
    const { edits: current, ...view } = snapshotRef.current;
    storeSoundKit({ version: 1, ...view, ...current });
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(saveDraft, 400);
    return () => window.clearTimeout(timer);
  }, [edits, tab, weapon.id, part, saveDraft]);
  useEffect(() => {
    window.addEventListener("beforeunload", saveDraft);
    return () => {
      window.removeEventListener("beforeunload", saveDraft);
      saveDraft();
    };
  }, [saveDraft]);

  useHistoryKeys(history);

  /* --- В игру --- */

  const installs = useSoundKitInstalls();
  /* Подписка на очередь: работа ушла в игру — состояния пересчитываются. */
  const queue = useWorkshopInstalls();
  const pending = useMemo(() => {
    const all = soundKitPending(edits, installs);
    const queued = (key, signature) =>
      isLive(workshopInstallStatusOf(key, signature));
    return {
      weapons: all.weapons.filter(
        (id) =>
          !queued(soundKitWeaponKey(id), designSignature(edits.weapons[id])),
      ),
      removals: all.removals.filter(
        (id) => !queued(soundKitWeaponKey(id), "removed"),
      ),
      hits:
        all.hits &&
        !queued(
          SOUND_KIT_HITS_KEY,
          all.hits === "install" ? hitsSignature(edits.hits) : "removed",
        )
          ? all.hits
          : null,
      mix:
        all.mix &&
        !queued(
          SOUND_KIT_MIX_KEY,
          all.mix === "install" ? mixSignature(edits.mix) : "removed",
        )
          ? all.mix
          : null,
    };
    // `queue` — снимок очереди: без него статусы работ читались бы старые.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, installs, queue]);
  const pendingCount = soundKitPendingCount(pending);
  const busy = (queue?.jobs || []).some(
    (job) =>
      String(job.key || "").startsWith("astral.sound-kit.install") &&
      isLive(job.status),
  );

  const weaponState = (id) =>
    isLive(
      workshopInstallStatusOf(
        soundKitWeaponKey(id),
        designSignature(edits.weapons[id]),
      ),
    )
      ? "queued"
      : weaponInstallState(id, edits.weapons[id] || null, installs);
  const currentWeaponState = weaponState(weapon.id);
  const mixState = isLive(
    workshopInstallStatusOf(
      SOUND_KIT_MIX_KEY,
      mixSignature(edits.mix) || "removed",
    ),
  )
    ? "queued"
    : mixInstallState(edits.mix, installs);
  const hitStates = Object.fromEntries(
    HIT_SOUND_PART_IDS.map((id) => [
      id,
      hitPartInstallState(id, edits.hits, installs),
    ]),
  );

  function apply() {
    if (!pendingCount) return;
    queueSoundKit({ host, kit: edits, pending, notify: onNotice });
  }

  function removeWeapon() {
    void queueWeaponRemoval({ host, weaponId: weapon.id, notify: onNotice });
  }

  function removeMix() {
    void queueMixRemoval({ host, notify: onNotice });
  }

  const weaponName = (id) =>
    WEAPON_SOUND_MAP[id]?.title || installs.weapons[id]?.title || "";
  const pendingNames = [
    ...pending.weapons.map(weaponName),
    ...pending.removals.map((id) => tr("{name} — как в игре").replace("{name}", weaponName(id))),
    ...(pending.hits ? [tr("звуки попадания")] : []),
    ...(pending.mix === "install" ? [tr("звуки окружения")] : []),
    ...(pending.mix === "remove" ? [tr("звуки окружения — как в игре")] : []),
  ].filter(Boolean);

  const empty = soundKitIsEmpty(edits);

  /* --- Мои работы --- */

  /* Имя открытого кода: с ним «Сохранить» предлагает сохранить чужую работу. */
  const sourceName = useRef("");
  /* Редактор больше не правит сохранённую работу: открыт код или всё
     сброшено — «Сохранить» заведёт новую, а не перепишет прежнюю. */
  const openedElsewhere = (name = "") => {
    sourceName.current = name;
    unlinkEditorWork("sound");
  };
  const works = useWorkActions({
    kind: "sound",
    onNotice,
    linkedName: () => linkedEditorWork("sound")?.name || "",
    defaultName: () => sourceName.current,
    onSave: async ({ name, asNew }) => {
      if (empty) throw new WorksStoreError("empty");
      const { work, created } = saveEditorWorkToWorks(
        "sound",
        soundKitWorkState(edits),
        { name, asNew },
      );
      sourceName.current = "";
      return { name: work.name, created };
    },
    onCopy: () =>
      soundCode(soundKitWorkState(edits), {
        name: linkedEditorWork("sound")?.name || sourceName.current,
      }),
    /* Код ложится шагом истории: «Отменить» возвращает свои звуки. */
    onOpen: (result) => {
      const template = result.templates[0];
      const kit = soundKitFromWorkState(template.state);
      history.commit(() => kit, null);
      openedElsewhere(template.name);
      showOpened(kit);
    },
  });

  /* Открытый код виден сразу: если у ствола или части на кадре в нём звука
     нет — на кадре первые из кода, а код из одних попаданий открывает их
     вкладку. */
  function showOpened(kit) {
    const weaponIds = Object.keys(kit.weapons);
    const parts = HIT_SOUND_PART_IDS.filter((id) => kit.hits[id]);
    if (weaponIds.length && !kit.weapons[weapon.id]) setWeaponId(weaponIds[0]);
    if (parts.length && !kit.hits[part]) setPart(parts[0]);
    const mixOnly =
      !weaponIds.length && !parts.length && Object.keys(kit.mix?.levels || {}).length;
    if (tab === "hits" && !parts.length && weaponIds.length) setTab("weapons");
    if (tab === "weapons" && !weaponIds.length && parts.length) setTab("hits");
    if (mixOnly) setTab("mix");
  }

  /* Так же — работа, открытая из «Моих работ»: студия пришла на её снимок,
     а не на свой черновик. Один раз, на входе. */
  const openedWork = useRef(null);
  if (openedWork.current === null) openedWork.current = soundKitDraftIsWork();
  useEffect(() => {
    if (!openedWork.current) return;
    openedWork.current = false;
    showOpened(edits);
  });

  function resetEverything() {
    history.commit(
      () => ({
        weapons: {},
        hits: Object.fromEntries(HIT_SOUND_PART_IDS.map((id) => [id, null])),
        mix: { levels: {} },
      }),
      null,
    );
    openedElsewhere();
    onNotice?.(tr("Звуки возвращены к игре — «Применить» снимет свои из игры"));
  }

  /* --- Сцена --- */

  /* Стволы со своим звуком — точка на их плитке в выборе. */
  const marked = useMemo(
    () =>
      new Set([
        ...Object.keys(edits.weapons),
        ...Object.keys(installs.weapons),
      ]),
    [edits.weapons, installs.weapons],
  );

  const canHearGame = Boolean(host?.readSoundStream && gameRoot);
  const ownSound = Boolean(
    weaponDesign && weaponDesign.source.kind !== "original",
  );
  /* Выстрелы выключены: стрелять можно и без игры, и у ствола без голоса — слушать нечего, и это честно показано. */
  const muted = designIsSilent(weaponDesign);
  const mutedCount = WEAPON_SOUNDS.filter((item) => designIsSilent(edits.weapons[item.id])).length;
  /* Звучать есть чему: своему звуку или голосу из подключённой игры. */
  const canFire = muted || (voiced && (ownSound || canHearGame));
  /* Строка посреди кадра — только о том, почему стрелять нельзя или звук ещё
     готовится: что делать руками, говорят подсказки инструментов. */
  const weaponBusy =
    canFire && (audio.preparing === "fire" || audio.preparing === "single");
  const weaponHint = muted
    ? ""
    : !voiced
    ? tr("У «{title}» нет своего голоса в игре — выберите другой ствол").replace("{title}", weapon.title)
    : !canFire
      ? tr("Голос ствола читается из вашей GTA V — подключите игру или выберите готовый звук в «Шаблонах»")
      : weaponBusy
        ? tr("Готовим звук…")
        : "";
  const hitHint = audio.preparing === "hits" ? tr("Готовим звук…") : "";

  /* Вспышка, дым и гильзы — частицы игры; без её базы эффектов их в кадре нет. Строка состояния — в панели редактора. */
  const rangeEffects = useRangeEffects();
  const weaponVoiceLine = (
    muted
      ? tr("Выстрелы «{title}» выключены: в предпросмотре тишина, вспышка и гильзы остаются.")
      : !weaponDesign
      ? tr("Звучит голос «{title}» из вашей GTA V; ваш звук заменит выстрел целиком.")
      : weaponDesign.source.kind === "original"
        ? tr("Звучит голос «{title}» из вашей GTA V с вашей обработкой.")
        : tr("Звучит ваш звук в длинах дорожек «{title}», как его сыграет игра.")
  ).replace("{title}", weapon.title);

  const stageDrop = {
    onDragOver: (event) => {
      if ([...(event.dataTransfer?.types || [])].includes("Files"))
        event.preventDefault();
    },
    onDrop: (event) => {
      const files = event.dataTransfer?.files;
      if (!files?.length) return;
      event.preventDefault();
      void importFiles(files);
    },
  };

  const groupTitle = WEAPON_SOUND_GROUP_MAP[weapon.group]?.title || "";
  const anyHit = HIT_SOUND_PART_IDS.some((id) => edits.hits[id]);
  const status =
    pendingCount > 0
      ? tr("Ждут «Применить»: {count}").replace("{count}", pendingCount)
      : Object.keys(installs.weapons).length || installs.hits || installs.mix
        ? tr("Свои звуки в игре")
        : tr("Как в игре");

  /* Свой звук ствола стоит в игре — его можно снять и из «⋯», как установку
     любого редактора мастерской. Попадания снимаются «Штатным ударом» и
     «Применить»: у них один мод на обе части. */
  const removable =
    tab === "weapons" && Boolean(installs.weapons[weapon.id]) && Boolean(host);
  const mixRemovable = mixTab && Boolean(installs.mix?.modId) && Boolean(host);

  return (
    <EditorShell
      className="fx-editor snd-kit"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская звуков")}
      status={status}
      tabs={
        <PageTabs
          className="snd-kit-tabs"
          role="tablist"
          label={tr("Что звучит")}
          value={tab}
          options={tabs}
          onChange={setTab}
        />
      }
      tools={tools}
      tool={tool}
      onTool={setTool}
      guide={guide}
      /* У «Окружения» свой проход: инструменты у пульта другие. */
      guideKey={mixTab ? "sound-mix" : "sound-kit"}
      actions={
        <EditorActions
          onUndo={history.undo}
          canUndo={history.canUndo}
          onRedo={history.redo}
          canRedo={history.canRedo}
          more={[
            ...works.items,
            ...(onOpenLegacy
              ? [
                  {
                    value: "legacy",
                    label: tr("Музыка, сирены и все звуки игры"),
                    icon: <MusicNotes />,
                  },
                ]
              : []),
            {
              value: "reset",
              label: tr("Сбросить всё"),
              icon: <ArrowCounterClockwise />,
              disabled: empty,
            },
            ...(removable
              ? [
                  {
                    value: "remove",
                    label: tr("Снять «{title}» из игры").replace("{title}", weapon.title),
                    icon: <Trash />,
                  },
                ]
              : []),
            ...(mixRemovable
              ? [
                  {
                    value: "remove-mix",
                    label: tr("Снять окружение из игры"),
                    icon: <Trash />,
                  },
                ]
              : []),
          ]}
          onMore={(action) => {
            if (works.handle(action)) return;
            if (action === "legacy") onOpenLegacy?.();
            if (action === "reset") resetEverything();
            if (action === "remove") removeWeapon();
            if (action === "remove-mix") removeMix();
          }}
          apply={{
            label: tr("Применить"),
            busy: busy && !pendingCount ? tr("Идёт установка…") : "",
            disabled: !pendingCount || !host,
            title: !host
              ? tr("Звук ставится в игру из приложения Astral")
              : pendingCount
                ? tr("Поставить в игру: {names}").replace("{names}", pendingNames.join(", "))
                : /* Пустой набор — не «уже в игре»: в игру ещё ничего не ушло. */
                  empty
                  ? tr("Выберите звук оружия, сирены или окружения — ставить пока нечего")
                  : tr("Всё, что вы собрали, уже в игре"),
            onClick: apply,
          }}
        >
          {connectGame && (
            <Button variant="ghost" size="sm" onClick={connectGame}>
              {tr("Подключить GTA V")}
            </Button>
          )}
        </EditorActions>
      }
      inspector={
        mixTab ? (
          <MixInspector
            panel={tool}
            levels={edits.mix?.levels || {}}
            channel={mixChannel}
            presetId={soundMixPresetOf(edits.mix)}
            state={mixState}
            canRemove={Boolean(installs.mix?.modId) && Boolean(host)}
            onChange={onMixLevel}
            onToggle={onMixToggle}
            onGroupReset={onMixGroupReset}
            onPreset={onMixPreset}
            onRemove={removeMix}
          />
        ) : tab === "hits" ? (
          <HitInspector
            panel={tool}
            hits={edits.hits}
            part={part}
            states={hitStates}
            asset={assetHash ? assets[assetHash] : undefined}
            budget={hitTarget(part)}
            combat={combat?.key === `${part}|${hitDesignKey}` ? combat : null}
            importing={importing === target}
            importNotes={importNotes.target === target ? importNotes.notes : []}
            outdated={Boolean(installs.hits) && !hitsInstallCurrent(installs.hits)}
            onPart={setPart}
            onRevert={onHitRevert}
            onFiles={importFiles}
            onTrim={onHitTrim}
            need={need}
            onFit={openFit}
            onFx={onHitFx}
            onResetFx={onHitResetFx}
          >
            {tool === "templates" && (
              <SoundKitPresets
                title={tr("Готовые звуки: {group}").replace("{group}", soundLower(tr(PART_TITLES[part])))}
                presets={HIT_PRESETS[part]}
                selectedId={presetSelected(hitDesign, HIT_PRESETS[part])}
                onApply={onHitPreset}
              />
            )}
          </HitInspector>
        ) : (
          <WeaponInspector
            panel={tool}
            weapon={weapon}
            design={weaponDesign}
            asset={assetHash ? assets[assetHash] : undefined}
            state={currentWeaponState}
            importing={importing === target}
            importNotes={importNotes.target === target ? importNotes.notes : []}
            installed={Boolean(installs.weapons[weapon.id])}
            legacy={Boolean(installs.weapons[weapon.id]?.legacy)}
            outdated={
              Boolean(installs.weapons[weapon.id]) &&
              !weaponInstallCurrent(weapon.id, installs.weapons[weapon.id])
            }
            canRemove={Boolean(installs.weapons[weapon.id]) && Boolean(host)}
            muted={muted}
            mutedCount={mutedCount}
            mutedTotal={WEAPON_SOUNDS.length}
            onMute={onWeaponMute}
            onMuteAll={onWeaponMuteAll}
            onFiles={importFiles}
            onRevertSource={onWeaponRevertSource}
            onTrim={onWeaponTrim}
            need={need}
            onFit={openFit}
            onFx={onWeaponFx}
            onResetFx={onWeaponResetFx}
            onRemove={removeWeapon}
          >
            {tool === "templates" && (
              <SoundKitPresets
                title={tr("Готовые звуки: {group}").replace("{group}", soundLower(tr(groupTitle)))}
                presets={weaponPresets}
                selectedId={presetSelected(weaponDesign, weaponPresets)}
                onApply={onWeaponPreset}
                disabled={!voiced}
              />
            )}
          </WeaponInspector>
        )
      }
    >
      {/* Кадр — весь кадр каркаса: органы — в правом верхнем углу, честная
          подпись — в правом нижнем, файл можно бросить на любое место. */}
      <div
        className="snd-kit-stage"
        data-frost="off"
        {...(mixTab ? {} : stageDrop)}
      >
        {mixTab ? (
          <>
            <MixStage
              levels={edits.mix?.levels || {}}
              selected={mixChannel}
              onSelect={selectMixChannel}
              onChange={onMixLevel}
              onToggle={onMixToggle}
              onGroupToggle={onMixGroupToggle}
            />
            <StageBar label={tr("Окружение")}>
              <Button
                variant="ghost"
                size="sm"
                icon={<ArrowCounterClockwise />}
                disabled={!Object.keys(edits.mix?.levels || {}).length}
                title={tr("Все каналы — как в игре")}
                onClick={onMixReset}
              >
                {tr("Всё как в игре")}
              </Button>
            </StageBar>
            <StageNote>{tr("Здесь звук не играет: громкость каналов изменится в вашей GTA V после «Применить».")}</StageNote>
          </>
        ) : tab === "hits" ? (
          <HitStage
            parts={{
              head: { enabled: Boolean(edits.hits.head) },
              body: { enabled: Boolean(edits.hits.body) },
            }}
            selected={part}
            onSelect={setPart}
            onPlay={(id) => void hit(id)}
            feed={audio.hitFeed}
          >
            <StageBar label={tr("Попадания")}>
              {HIT_SOUND_PART_IDS.map((id) => (
                <Button
                  key={id}
                  variant="ghost"
                  size="sm"
                  icon={<Play weight="fill" />}
                  disabled={!edits.hits[id]}
                  title={tr("{part}: выбрать и прослушать").replace("{part}", tr(PART_TITLES[id]))}
                  onClick={() => {
                    setPart(id);
                    void hit(id);
                  }}
                >
                  {tr(PART_TITLES[id])}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                icon={
                  audio.series ? <Stop weight="fill" /> : <Play weight="fill" />
                }
                active={audio.series}
                disabled={!anyHit && !audio.series}
                title={tr("Попадания одно за другим, пока не остановите: правка слышна сразу")}
                onClick={toggleSeries}
              >
                {audio.series ? tr("Стоп") : tr("Серия")}
              </Button>
            </StageBar>
            {hitHint && <p className="snd-stage-hint is-busy">{hitHint}</p>}
            <StageNote>{tr("Звучит ваш звук: в игре он заменит штатный удар пули.")}</StageNote>
          </HitStage>
        ) : (
          <WeaponStage weapon={weapon} feed={audio.weaponFeed}>
            <StageBar label={tr("Стрельба")}>
              <WeaponChip
                weapon={weapon}
                open={pickerOpen}
                onToggle={() => setPickerOpen((open) => !open)}
              />
              <Button
                variant="ghost"
                size="sm"
                icon={
                  audio.firing ? <Stop weight="fill" /> : <Play weight="fill" />
                }
                active={audio.firing}
                disabled={!canFire && !audio.firing}
                title={tr("Стрельба, пока не остановите: правка звука слышна прямо в ней")}
                onClick={toggleFire}
              >
                {audio.firing ? tr("Стоп") : tr("Огонь")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Crosshair />}
                disabled={!canFire}
                title={tr("Один выстрел")}
                onClick={() => void shoot()}
              >
                {tr("Выстрел")}
              </Button>
            </StageBar>
            {pickerOpen && (
              <WeaponSheet
                weapon={weapon}
                marked={marked}
                onChange={setWeaponId}
                onClose={closePicker}
              />
            )}
            {weaponHint && !pickerOpen && (
              <p className={`snd-stage-hint${weaponBusy ? " is-busy" : ""}`}>
                {weaponHint}
              </p>
            )}
            <StageNote tone={rangeEffects ? undefined : "warning"}>
              {rangeEffects
                ? tr("Вспышка, дым и гильзы — частицы вашей GTA V.")
                : tr("Вспышку, дым и гильзы Astral берёт из вашей GTA V: подключите игру, и они появятся.")}
            </StageNote>
            <StageNote>{weaponVoiceLine}</StageNote>
          </WeaponStage>
        )}
      </div>
      {works.dialogs}
      {fitting?.target === target &&
        currentDesign?.source?.kind === "file" &&
        assets[assetHash] && (
          <SoundFitDialog
            key={`${target}|${assetHash}|${fitting.fresh}`}
            fileName={currentDesign.source.assetName}
            asset={assets[assetHash]}
            need={need}
            value={currentDesign.fx}
            fresh={fitting.fresh}
            render={renderFit}
            original={tab === "weapons" && canHearGame ? gameVoice : null}
            onApply={applyFit}
            onClose={() => setFitting(null)}
          />
        )}
    </EditorShell>
  );
}
