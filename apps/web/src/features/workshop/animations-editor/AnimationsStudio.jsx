import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import Button from "../../../components/ui/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState.jsx";
import FilterChips from "../../../components/ui/FilterChips.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import {
  ArrowCounterClockwise,
  Check,
  Clock,
  FilmSlate,
  Cube,
  FolderOpen,
  HandPalm,
  MagnifyingGlass,
  MaskHappy,
  Moon,
  MusicNotes,
  Package,
  PersonSimpleWalk,
  Plus,
  SquaresFour,
  Trash,
  User,
  Warning,
  X,
} from "../../../components/ui/icons.jsx";
import { usePanelHelp } from "../../../components/ui/panel-help.js";
import useHolds from "../../../components/ui/useHolds.js";
import { useRememberedState } from "../../../section-memory.js";
import {
  addAnimationSource,
  chooseAnimationSource,
  removeAnimationSource,
} from "../../../api.js";
import { tr, useTr } from "../../../locales/ui.js";
import AnimationGrid from "./AnimationGrid.jsx";
import AnimationStage from "./AnimationStage.jsx";
import {
  canWarm,
  filterAnimations,
  isProject,
  sectionCounts,
  sectionIds,
  sectionLabel,
  sectionName,
} from "./animation-library.js";
import {
  useAnimationList,
  useAnimationScene,
  usePoseShelf,
  warmTrack,
} from "./animation-data.js";
import { mainProcessText } from "./animation-errors.js";
import {
  detailText,
  failureText,
  installReplacement,
  installedIds,
  uninstallReplacement,
} from "./animation-install-flow.js";
import {
  markInstalled,
  removeReplacement,
  saveReplacement,
  syncInstalled,
  useReplacements,
} from "./replacements-store.js";
import "./animations.css";

/*
 * «Анимации» мастерской (ТЗ 29.10.2026-d): выбрать, какую анимацию заменить, и на что — с проигрыванием обеих на персонаже игры.
 *
 *   1. Слева — анимации игры и ваши файлы (`.ycd`, `dlc.rpf`): поиск по названию или номеру, разделы, плитка с позой клипа.
 *   2. «Что заменить» — выбранная играет в левом окне («На сервере»). «Выбрать замену» открывает ту же сетку: «Что играть
 *      вместо …». Выбранная замена играет в правом окне («У тебя»); обе идут по кругу и начинаются вместе.
 *   3. «Заменить» сохраняет пару в «Мои замены». Отсюда её можно открыть, сменить замену или убрать.
 *
 *   4. «Заменить» сразу ставит пару в игру: главный процесс собирает словарь цели с анимацией источника и ставит его в архив игры
 *      установщиком патчей, с точкой отката (`animation-install.js`). Пока идёт установка, окно говорит об этом; отказ (игра запущена,
 *      анимации не подходят друг другу) остаётся на паре с причиной и кнопкой «Поставить в игру». «Вернуть как было» возвращает подлинный
 *      словарь. Цель не из игры человека (его файл, не словарь GTA) поставить некуда — пара остаётся для просмотра.
 *
 * Раскладка — как у мастерской оружия (владелец 02.11.2026: «вкладку все разделы перенести в левую часть также как панель в мастерской
 * оружия слева, в центре сделай анимацию персонажа и то что оно заменяет, а справа все анимации»): каркас `EditorShell` с колонкой
 * `tools` — разделы («Все», «Эмоции», «Танцы»… «Свои файлы») значками с подписями вместо выпадающего «Все разделы»; в середине кадр
 * во всю высоту — «На сервере» → «У тебя»; справа панель — поиск, свои файлы и сетка всех анимаций (или «Мои замены»), листается сама.
 *
 * Кнопки действий стоят в шапке справа, как у мастерской одежды (30.10.2026); шапка — «Мастерская анимаций» одной строкой с числом клипов.
 * Переключателя «Анимации · Мои замены» в шапке нет (владелец 3.11.2026): свои замены — фильтр «Мои замены» рядом с поиском в панели справа; поиск работает и по ним.
 * Дорожки соседей выбранной записи и плитки под курсором читаются заранее (`warmTrack`), а пока клип читается, окно показывает запись
 * в позе её плитки: переключение между клипами не ждёт чтения.
 *
 * Привязки к меню конкретного сервера нет: список — анимации игры и файлы человека, имена из них (меню сервера появится, когда будет
 * список его названий).
 */

/* Предчтение дорожек: сколько записей после выбранной и перед ней, через сколько после выбора, и задержка наведения. */
const WARM_AFTER = 4;
const WARM_BEFORE = 2;
const WARM_DELAY = 250;
const WARM_HOVER = 120;

/* Значок раздела в колонке слева. */
const SECTION_ICONS = Object.freeze({
  "project:gta5rp": Cube,
  "project:novarp": Cube,
  all: SquaresFour,
  emotes: MaskHappy,
  dances: MusicNotes,
  gestures: HandPalm,
  scenarios: FilmSlate,
  rest: Moon,
  poses: User,
  other: Package,
  own: FolderOpen,
});

/* Откуда названия и кто видит замену — к «?» у имени панели, а не абзацем в колонке (design-qa.md, «Правая колонка 3D-редакторов», п. 1). */
function LibraryHelp() {
  useTr();
  usePanelHelp([
    tr("Замену видишь только ты: на сервере анимация включается как обычно."),
    tr(
      "Названия — из файлов игры и ваших файлов. Меню конкретного сервера пока не подключено.",
    ),
  ]);
  return null;
}

function SourcesRow({ sources, onChanged, onNotice }) {
  useTr();
  const add = async (kind) => {
    try {
      const chosen = await chooseAnimationSource({ kind });
      if (!chosen?.path) return;
      const answer = await addAnimationSource({ path: chosen.path });
      if (answer?.reason) onNotice?.(tr(answer.reason), "error");
      onChanged();
    } catch (error) {
      onNotice?.(String(error?.message || error), "error");
    }
  };
  const forget = async (id) => {
    await removeAnimationSource({ id }).catch(() => {});
    onChanged();
  };
  return (
    <div className="animations-sources">
      {sources.map((source) => (
        <span className="animations-source" key={source.id} title={source.path}>
          <FolderOpen aria-hidden="true" />
          <b>{source.label}</b>
          <Button
            variant="ghost"
            size="sm"
            icon={<X />}
            aria-label={tr("Убрать источник")}
            title={tr("Убрать источник")}
            onClick={() => forget(source.id)}
          />
        </span>
      ))}
      <Button
        variant="ghost"
        size="sm"
        icon={<Plus />}
        onClick={() => add("file")}
        title={tr("Словарь .ycd или архив .rpf со своими анимациями")}
      >
        {tr("Свой файл")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon={<Plus />}
        onClick={() => add("folder")}
        title={tr("Папка со словарями .ycd")}
      >
        {tr("Своя папка")}
      </Button>
    </div>
  );
}

/* Строка состояния установки под шапкой: ставится, стоит, не поставилась (с причиной и подсказкой с подробностями), только для просмотра. */
function InstallLine({ item, install }) {
  useTr();
  const lines = (install?.notes || []).map((line) => (
    <small key={line}>{line}</small>
  ));
  if (install?.phase === "busy")
    return (
      <p className="animations-soon is-busy" role="status">
        <Clock aria-hidden="true" />
        <span>
          <b>
            {install.removing
              ? tr("Возвращаю как было…")
              : tr("Ставлю в игру…")}
          </b>{" "}
          {install.heavy
            ? tr(
                "Это большой архив игры: установка займёт несколько минут. Не запускайте игру.",
              )
            : tr(
                "Перепишется архив игры, это занимает меньше минуты. Не запускайте игру.",
              )}
        </span>
      </p>
    );
  if (install?.phase === "failed")
    return (
      <p
        className="animations-soon is-failed"
        role="alert"
        title={install.detail || undefined}
      >
        <Warning aria-hidden="true" />
        <span>
          <b>{tr("Не поставилась.")}</b> {install.reason}
        </span>
      </p>
    );
  if (item.installed)
    return (
      <p className="animations-soon is-done" role="status">
        <Check aria-hidden="true" />
        <span>
          <b>{tr("Стоит в игре.")}</b>{" "}
          {tr("Когда сервер включает эту анимацию, играет выбранная.")}
          {lines}
        </span>
      </p>
    );
  if (item.target.source !== "game")
    return (
      <p className="animations-soon" role="note">
        <Clock aria-hidden="true" />
        <span>
          {tr(
            "Этой анимации нет в вашей игре: ставить некуда, замена — только для просмотра.",
          )}
        </span>
      </p>
    );
  return (
    <p className="animations-soon" role="note">
      <Clock aria-hidden="true" />
      <span>{tr("Замена сохранена, но в игре её пока нет.")}</span>
    </p>
  );
}

function ReplacementRow({ item, selected, onPick, onRemove, install }) {
  useTr();
  const state =
    install?.phase === "busy"
      ? tr("Ставится…")
      : install?.phase === "failed"
        ? tr("Не поставилась")
        : item.installed
          ? tr("В игре")
          : tr("Не в игре");
  return (
    <li className="animation-row" data-selected={selected ? "" : undefined}>
      <button
        type="button"
        className="animation-row-main"
        onClick={() => onPick(item)}
        aria-pressed={selected}
      >
        <span className="animation-row-pair">
          <b>{item.target.name}</b>
          <i aria-hidden="true">→</i>
          <b>{item.replacement.name}</b>
        </span>
        <small>
          {sectionName(item.target.section)} · {state}
        </small>
      </button>
      <Button
        variant="ghost"
        size="sm"
        icon={<Trash />}
        aria-label={tr("Убрать замену")}
        title={tr("Убрать замену")}
        onClick={() => onRemove(item)}
      />
    </li>
  );
}

export default function AnimationsStudio({ onExit, onNotice = null }) {
  useTr();
  const library = useAnimationList();
  const replacements = useReplacements();
  const [tab, setTab] = useRememberedState("workshop:animations:tab", "all");
  const [section, setSection] = useRememberedState(
    "workshop:animations:section",
    "all",
  );
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState("target");
  const [target, setTarget] = useState(null);
  const [candidate, setCandidate] = useState(null);
  /* Ход установки по номеру пары: `busy` (с архивом и «тяжёлый» ли он), `done` (с заметками), `failed` (с причиной словами). */
  const [installs, setInstalls] = useState({});
  const setInstall = useCallback(
    (id, next) =>
      setInstalls((current) =>
        next
          ? { ...current, [id]: next }
          : Object.fromEntries(
              Object.entries(current).filter(([key]) => key !== id),
            ),
      ),
    [],
  );

  const ready = library.status === "ready";
  /* Сцена и персонаж собираются, пока читается список: папка игры известна раньше него. */
  const { scene, status: sceneStatus } = useAnimationScene(
    library.gameRoot,
    ready || Boolean(library.gameRoot),
  );
  const shelf = usePoseShelf(scene, library.gameRoot);

  const counts = useMemo(
    () => sectionCounts(library.entries),
    [library.entries],
  );
  /* Колонка слева — разделы: подпись (русская строка, переводит колонка), значок, число — в подсказке. */
  const sections = useMemo(
    () =>
      sectionIds(counts).map((id) => {
        const Icon = SECTION_ICONS[id] || PersonSimpleWalk;
        return {
          id,
          label: sectionLabel(id),
          icon: <Icon />,
          group:
            id === "all"
              ? "all"
              : id === "own" || id.startsWith("project:")
                ? "own"
                : "game",
        };
      }),
    [counts],
  );
  const shownSection = section !== "all" && !counts[section] ? "all" : section;
  const deferredQuery = useDeferredValue(query);
  const shown = useMemo(
    () =>
      filterAnimations(library.entries, {
        section: shownSection,
        query: deferredQuery,
      }),
    [library.entries, shownSection, deferredQuery],
  );
  const markedIds = useMemo(
    () => new Set(replacements.map((item) => item.id)),
    [replacements],
  );
  const saved = target
    ? replacements.find((item) => item.id === target.id) || null
    : null;
  const picking = phase === "replacement" && target;

  /*
   * Вход без выбора (владелец 3.11.2026: «оба окна пустые — „Здесь сыграет анимация…“ и „Здесь сыграет замена“, а справа позы»): окно ждало щелчка по плитке, и
   * до него на сцене не было никого. Теперь, как только список прочитан, на сцене та анимация, что стояла в прошлый раз, а нет её — первая в сетке: окно «На сервере»
   * играет сразу. Один раз на вход: снятый выбор («Отмена», смена раздела) окно назад не ставит.
   */
  const [lastTarget, setLastTarget] = useRememberedState(
    "workshop:animations:target",
    "",
  );
  const autoPicked = useRef(false);
  useEffect(() => {
    if (!ready || autoPicked.current) return;
    autoPicked.current = true;
    if (target) return;
    const first =
      (lastTarget && library.entries.find((item) => item.id === lastTarget)) ||
      shown[0] ||
      null;
    if (first) setTarget(first);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (target?.id) setLastTarget(target.id);
  }, [target?.id, setLastTarget]);

  /* Соседи записи на сцене по порядку сетки: их дорожки читаются, пока человек смотрит на выбранную. Один за другим, не гурьбой. */
  const current = picking ? candidate : target;
  useEffect(() => {
    if (!ready || !library.gameRoot || !current) return undefined;
    const at = shown.findIndex((item) => item.id === current.id);
    if (at < 0) return undefined;
    /* Записи проектов и клипы дольше 16 с заранее не читаются — только по выбору (`canWarm`). */
    const near = [
      ...shown.slice(at + 1, at + 1 + WARM_AFTER),
      ...shown.slice(Math.max(0, at - WARM_BEFORE), at).reverse(),
    ].filter(canWarm);
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const entry of near) {
        if (cancelled) return;
        await warmTrack(entry, library.gameRoot);
      }
    }, WARM_DELAY);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, library.gameRoot, current?.id, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Плитка под курсором: рука ещё идёт к щелчку, а дорожка уже читается. */
  const warmTimer = useRef(0);
  const warmUnder = useCallback(
    (entry) => {
      clearTimeout(warmTimer.current);
      if (!entry || !library.gameRoot || !canWarm(entry)) return;
      warmTimer.current = setTimeout(
        () => void warmTrack(entry, library.gameRoot),
        WARM_HOVER,
      );
    },
    [library.gameRoot],
  );
  useEffect(() => () => clearTimeout(warmTimer.current), []);

  /* Что из замен стоит в игре на самом деле: окно помнит отметку, правду говорит файл в игре. */
  useEffect(() => {
    if (
      !ready ||
      !library.gameRoot ||
      !replacements.some((item) => item.installed)
    )
      return undefined;
    let cancelled = false;
    installedIds(library.gameRoot).then((present) => {
      if (!cancelled && present) syncInstalled(present);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, library.gameRoot]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Поставить пару в игру: отказ вызова — причина на паре, а не красный тост на каждый щелчок. */
  const runInstall = useCallback(
    async (item) => {
      if (!library.gameRoot) {
        setInstall(item.id, {
          phase: "failed",
          reason: tr("Нужна GTA V Legacy: замены ставятся в вашу игру."),
        });
        return;
      }
      setInstall(item.id, { phase: "busy", archive: "", heavy: false });
      try {
        const result = await installReplacement(item, library.gameRoot, {
          onPlan: ({ archive, heavy }) =>
            setInstall(item.id, { phase: "busy", archive, heavy }),
        });
        if (result.status === "refused") {
          setInstall(item.id, {
            phase: "failed",
            reason: result.reason,
            detail: result.detail,
          });
          return;
        }
        markInstalled(item.id, true);
        setInstall(item.id, { phase: "done", notes: result.notes });
        onNotice?.(tr("Замена стоит в игре"), "success");
      } catch (error) {
        setInstall(item.id, {
          phase: "failed",
          reason: failureText(error),
          detail: detailText(error),
        });
      }
    },
    [library.gameRoot, onNotice, setInstall],
  );

  /* Снять замену с игры; `dropPair` — ещё и убрать пару из списка. Не снялась с игры — пара остаётся и говорит почему. */
  const runUninstall = useCallback(
    async (item, dropPair) => {
      if (item.installed) {
        setInstall(item.id, {
          phase: "busy",
          archive: "",
          heavy: false,
          removing: true,
        });
        try {
          await uninstallReplacement(item, library.gameRoot);
          markInstalled(item.id, false);
        } catch (error) {
          setInstall(item.id, {
            phase: "failed",
            reason: failureText(error),
            detail: detailText(error),
          });
          return;
        }
      }
      setInstall(item.id, null);
      if (dropPair) removeReplacement(item.id);
    },
    [library.gameRoot, setInstall],
  );

  const pickTarget = useCallback((entry) => {
    setTarget(entry);
    setCandidate(null);
    setPhase("target");
  }, []);
  /* Щелчок по плитке — стабильная функция: плитки сетки не перерисовываются все разом на каждый выбор, а только та, что поменяла отметку. */
  const pickingRef = useRef(false);
  /* Метка страницы: студия живёт в высоте окна и при ширине до 1100 px (`animations.css`, `data-holds`, не `:has()`). */
  const roomRef = useRef(null);
  useHolds(roomRef, "animations-studio", [
    ".desktop-content",
    ".workshop-studio",
  ]);
  pickingRef.current = Boolean(picking);
  const pickInList = useCallback(
    (entry) => (pickingRef.current ? setCandidate(entry) : pickTarget(entry)),
    [pickTarget],
  );
  /* Раздел в колонке слева: из «Моих замен» — назад к сетке этого раздела. Стабильная функция: колонка не перерисовывается на каждый выбор плитки. */
  const pickSection = useCallback(
    (id) => {
      setSection(id);
      setTab("all");
    },
    [setSection, setTab],
  );
  const openReplacement = (item) => {
    setTarget(item.target);
    setCandidate(null);
    setPhase("target");
  };
  const cancelPick = () => {
    setPhase("target");
    setCandidate(null);
  };
  const confirm = () => {
    if (!target || !candidate) return;
    const item = saveReplacement(target, candidate);
    setPhase("target");
    setCandidate(null);
    void runInstall(item);
  };
  const forget = (item) => {
    void runUninstall(item, true);
    if (target?.id === item.id && phase !== "replacement") setCandidate(null);
  };

  const sceneNote =
    sceneStatus === "nogame"
      ? tr("Нужна GTA V Legacy: персонажа и анимации читаем из вашей игры.")
      : sceneStatus === "nogl"
        ? tr("Предпросмотру нужен WebGL — он не запустился.")
        : sceneStatus === "error"
          ? tr("Персонаж из игры не прочитался.")
          : "";

  const server = target;
  const mine = picking ? candidate : saved?.replacement || null;
  const minePicking = picking && !candidate;

  /* В шапке — анимации игры и свои файлы: записи проектов («GTA 5 RP», «Nova RP») живут в своих разделах и в счёт не входят. */
  const listCount = useMemo(
    () => library.entries.filter((entry) => !isProject(entry)).length,
    [library.entries],
  );
  const status = ready ? `${listCount} ${tr("анимаций")}` : null;
  /* Свои замены под тем же поиском, что и анимации: по названию цели или замены. */
  const shownReplacements = useMemo(() => {
    const word = deferredQuery.trim().toLowerCase();
    if (!word) return replacements;
    return replacements.filter((item) =>
      `${item.target?.name || ""} ${item.replacement?.name || ""}`
        .toLowerCase()
        .includes(word),
    );
  }, [replacements, deferredQuery]);

  let library_;
  if (tab === "mine") {
    library_ = shownReplacements.length ? (
      <ul className="animation-rows">
        {shownReplacements.map((item) => (
          <ReplacementRow
            key={item.id}
            item={item}
            selected={item.id === target?.id}
            onPick={openReplacement}
            onRemove={forget}
            install={installs[item.id]}
          />
        ))}
      </ul>
    ) : replacements.length ? (
      <EmptyState
        size="panel"
        icon={MagnifyingGlass}
        title={tr("Ничего не нашлось")}
        text={tr("Попробуйте другое слово, номер или раздел.")}
      />
    ) : (
      <EmptyState
        size="panel"
        icon={PersonSimpleWalk}
        title={tr("Замен пока нет")}
        text={tr(
          "Выберите анимацию, которую хотите заменить, и ту, что играть вместо неё.",
        )}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setTab("all")}>
            {tr("К анимациям")}
          </Button>
        }
      />
    );
  } else if (library.status === "unavailable") {
    library_ = (
      <EmptyState
        size="panel"
        icon={PersonSimpleWalk}
        title={tr("Анимации читает Astral Desktop")}
        text={tr("В окне без приложения клипы игры не прочитать.")}
      />
    );
  } else if (library.status === "loading") {
    library_ = (
      <div className="animations-loading" role="status">
        <i aria-hidden="true" />
        <b>{tr("Читаю анимации игры…")}</b>
        <small>
          {tr(
            "В первый раз это занимает до минуты, дальше список берётся из кэша.",
          )}
        </small>
      </div>
    );
  } else if (library.status === "error") {
    library_ = (
      <EmptyState
        size="panel"
        tone="warning"
        icon={PersonSimpleWalk}
        title={tr("Анимации не прочитались")}
        text={mainProcessText(library.error)}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => library.reload(true)}
          >
            {tr("Повторить")}
          </Button>
        }
      />
    );
  } else if (!shown.length) {
    library_ = (
      <EmptyState
        size="panel"
        icon={MagnifyingGlass}
        title={
          library.entries.length ? tr("Ничего не нашлось") : tr("Анимаций нет")
        }
        text={
          library.entries.length
            ? tr("Попробуйте другое слово, номер или раздел.")
            : library.hasGame
              ? tr(
                  "В игре не нашлось подходящих словарей. Можно добавить свои файлы.",
                )
              : tr("Нужна GTA V Legacy или свои файлы анимаций.")
        }
      />
    );
  } else {
    library_ = (
      <AnimationGrid
        entries={shown}
        shelf={shelf}
        selectedId={picking ? candidate?.id : target?.id}
        markedIds={markedIds}
        lockedId={picking ? target.id : null}
        onPick={pickInList}
        onWarm={warmUnder}
      />
    );
  }

  /* Шапка панели справа: что сейчас выбирают в сетке, под ней — раздел и число. */
  const panelHead =
    tab === "mine"
      ? { label: tr("Мои замены") }
      : picking
        ? {
            label: (
              <>
                {tr("Что играть вместо")} <b>«{target.name}»</b>
              </>
            ),
            note: `${sectionName(shownSection)} · ${shown.length}`,
          }
        : {
            label: tr("Что заменить"),
            note: ready ? `${sectionName(shownSection)} · ${shown.length}` : "",
          };

  /* Кнопки шапки: что делать с выбранной записью. Редкое — под «⋯». */
  const busy = Boolean(saved && installs[saved.id]?.phase === "busy");
  let headerActions = null;
  if (picking) {
    headerActions = (
      <>
        <Button variant="ghost" size="sm" onClick={cancelPick}>
          {tr("Отмена")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!candidate}
          onClick={confirm}
        >
          {candidate ? tr("Заменить") : tr("Выбери справа анимацию")}
        </Button>
      </>
    );
  } else if (target && saved) {
    headerActions = (
      <>
        <EditorActions
          more={[
            ...(saved.installed
              ? [
                  {
                    value: "uninstall",
                    label: tr("Вернуть как было"),
                    icon: <ArrowCounterClockwise />,
                    disabled: busy,
                  },
                ]
              : []),
            {
              value: "remove",
              label: tr("Убрать замену"),
              icon: <Trash />,
              disabled: busy,
            },
          ]}
          onMore={(action) =>
            action === "uninstall" ? runUninstall(saved, false) : forget(saved)
          }
        >
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => setPhase("replacement")}
          >
            {tr("Заменить на другую")}
          </Button>
        </EditorActions>
        {!saved.installed && target.source === "game" && (
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() => runInstall(saved)}
          >
            {tr("Поставить в игру")}
          </Button>
        )}
      </>
    );
  } else if (target) {
    headerActions = (
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          setTab("all");
          setPhase("replacement");
        }}
      >
        {tr("Выбрать замену")}
      </Button>
    );
  }

  return (
    <EditorShell
      className="animations-studio"
      title={tr("Мастерская анимаций")}
      status={status}
      onBack={onExit}
      backLabel="Редакторы"
      actions={headerActions}
      /* Колонка слева — разделы, как колонка мастерской оружия (02.11.2026). Раздел из «Моих замен» возвращает к сетке. */
      tools={sections}
      tool={tab === "mine" ? null : shownSection}
      onTool={pickSection}
      toolShortcuts={false}
      /* Над сеткой нет рисованной карточки: картинка — это кадр (design-qa.md, п. 9). */
      toolCards={false}
      panelHead={panelHead}
      inspector={
        <section className="animations-library" aria-label={tr("Анимации")}>
          <LibraryHelp />
          <div className="animations-filters">
            <TextField
              className="animations-search"
              value={query}
              onChange={(value) =>
                setQuery(
                  typeof value === "string"
                    ? value
                    : (value?.target?.value ?? ""),
                )
              }
              placeholder={tr("Название или номер")}
              aria-label={tr("Название или номер")}
            />
            {/* «Мои замены» — фильтр рядом с поиском, не вкладка в шапке: нажат — в списке свои пары, ещё раз — снова все анимации. */}
            <FilterChips
              className="animations-mine-filter"
              label={tr("Мои замены")}
              options={[
                {
                  value: "mine",
                  label: tr("Мои замены"),
                  count: replacements.length,
                },
              ]}
              value={tab === "mine" ? "mine" : null}
              onChange={() => setTab(tab === "mine" ? "all" : "mine")}
            />
          </div>
          {tab === "all" && (
            <>
              <SourcesRow
                sources={library.sources}
                onChanged={() => library.reload(true)}
                onNotice={onNotice}
              />
              {library.problems.map((problem) => (
                <p
                  className="animations-problem"
                  role="note"
                  key={`${problem.id}:${problem.reason}`}
                >
                  <b>{problem.label}</b> {tr(problem.reason)}
                </p>
              ))}
            </>
          )}
          {/* Своя прокрутка (`data-scroll-own`): сетка находит коробку без обхода предков, а края панели не перемеряются на каждую плитку. */}
          <div
            className="animation-grid-scroll"
            data-mode={tab}
            data-scroll-own=""
          >
            {library_}
          </div>
        </section>
      }
    >
      <div className="animations-room" ref={roomRef}>
        <header className="animations-detail-head">
          <div className="animations-detail-copy">
            <h2>{target ? target.name : tr("Выберите анимацию")}</h2>
            <p className="animations-detail-meta">
              {target
                ? `${sectionName(target.section)} · ${tr("по кругу")}`
                : tr(
                    "Справа — анимации игры и ваши файлы. Выберите ту, что хотите заменить.",
                  )}
            </p>
          </div>
        </header>
        {saved && !picking && (
          <InstallLine item={saved} install={installs[saved.id]} />
        )}
        <div className="animations-detail-stage">
          <AnimationStage
            scene={scene}
            shelf={shelf}
            gameRoot={library.gameRoot}
            server={server}
            mine={mine}
            serverHint={
              sceneNote || tr("Здесь сыграет анимация, как её включает сервер")
            }
            mineHint={
              sceneNote ||
              (minePicking
                ? tr("Выберите справа, что играть вместо неё")
                : tr("Здесь сыграет замена"))
            }
          />
        </div>
      </div>
    </EditorShell>
  );
}
