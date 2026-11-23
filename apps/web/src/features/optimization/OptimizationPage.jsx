import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Buildings,
  CheckCircle,
  CircleNotch,
  GameController,
  Gauge,
  Lightning,
  ShieldCheck,
  Warning,
  WarningCircle,
} from "../../components/ui/icons.jsx";
import Button from "../../components/ui/Button.jsx";
import Checkbox from "../../components/ui/Checkbox.jsx";
import PageHeading from "../../components/ui/PageHeading.jsx";
import SegmentedControl from "../../components/ui/SegmentedControl.jsx";
import { pluralWord } from "../../plural.js";
import OptimizationRig from "./OptimizationRig.jsx";
import OptimizationVerdict from "./OptimizationVerdict.jsx";
import {
  useRememberedScroll,
  useRememberedState,
} from "../../section-memory.js";
import {
  analyzeOptimization,
  applyOptimization,
  getOptimizationHistory,
  onOptimizationProgress,
  planOptimization,
  rollbackOptimization,
} from "../../api.js";
import { motionEnabled } from "../../motion-preference.js";
import { tr, useTr } from "../../locales/ui.js";
import useHolds from "../../components/ui/useHolds.js";
import { Skeleton } from "../../components/ui/Skeleton.jsx";

const GROUPS = [
  { id: "windows", label: "Windows", profileId: "windows-safe", icon: Gauge },
  {
    id: "gta",
    label: "GTA V",
    profileId: "gta-performance",
    icon: GameController,
  },
  {
    id: "world",
    label: "Мир и объекты",
    profileId: "world-lite",
    icon: Buildings,
  },
];

const STATUS_COPY = {
  healthy: "Готово",
  recommended: "Рекомендуется",
  advisory: "Информация",
  expert: "Экспертный выбор",
  blocked: "Недоступно",
  unsupported: "Безопасно заблокировано",
};

/* Порядок чтения, а не порядок разбора. Разбор выдаёт проверки так, как их
   удобно считать: первой идёт справка о железе, за ней питание, и уже под ними
   то, что действительно можно включить. Читают список сверху, поэтому наверх
   поднимается то, у чего есть переключатель, а справки уходят вниз. */
const STATUS_RANK = {
  recommended: 0,
  blocked: 1,
  expert: 2,
  advisory: 3,
  unsupported: 4,
  healthy: 5,
};

/*
 * Проверка, которую переключателем не починить, но чинить надо.
 *
 * Экран на 60 Гц из 144 — самая большая потеря кадров, какая вообще бывает, и
 * Astral её не переключает: режим экрана меняют в параметрах Windows, частоту
 * памяти — в UEFI, диск игры — переносом. По признаку `actionable` такие
 * проверки падали в конец списка, под заголовок «Проверено — вмешательство не
 * нужно», то есть ровно наоборот тому, что они говорят.
 */
export const needsPerson = (check) =>
  !check.actionable && check.severity === "important";

function readingOrder(check) {
  const bucket = check.actionable ? 0 : needsPerson(check) ? 10 : 20;
  return bucket + (STATUS_RANK[check.status] ?? 6);
}

/* Столько живёт уход заглушки: значение повторяет `optimization-boot-out`
   в optimization.css. Заглушка снимается по таймеру, а не по кадру с данными,
   иначе готовая страница возникает рывком посреди анимации. */
const REVEAL_MS = 360;
const SKELETON_ROWS = [0, 1, 2, 3];

/* Оборудование между заходами на страницу не меняется, а его определение — самая
   долгая часть разбора: запуск powershell.exe с запросами CIM. Последний ответ
   лежит в хранилище вкладки, поэтому при возврате на страницу характеристики
   стоят на месте сразу, а не через полторы секунды. Вкладки, а не диска: снимок
   не переживает перезапуск приложения и не может показать железо, которого в
   машине уже нет. Числа рядом с ним так не показываются — они относятся к
   конкретному разбору, и до его ответа их нет. */
const HARDWARE_CACHE_KEY = "astral-optimization-hardware";

function readCachedHardware() {
  try {
    return JSON.parse(sessionStorage.getItem(HARDWARE_CACHE_KEY) || "null");
  } catch {
    /* Приватный режим и заблокированное хранилище не повод падать на старте. */
    return null;
  }
}

function cacheHardware(hardware) {
  try {
    sessionStorage.setItem(HARDWARE_CACHE_KEY, JSON.stringify(hardware));
  } catch {
    /* Показать характеристики мы уже показали; не сохранить их — не беда. */
  }
}

function CheckIcon({ status }) {
  if (status === "healthy") return <CheckCircle weight="fill" />;
  if (["blocked", "unsupported"].includes(status)) return <WarningCircle />;
  return <Warning />;
}

/*
 * Одна метка на строку.
 *
 * Строка проверки говорила о своей важности пятью способами разом: цветной
 * значок, цветная полоса слева, слово статуса, отдельная плашка с последствием
 * и разделитель над группой. Из пяти по делу высказывалось одно —
 * последствие: «потолок кадров 60 вместо 144» отвечает на вопрос, а
 * «Рекомендуется» повторяет то, что и так видно по галочке.
 *
 * Поэтому правило простое: есть последствие — показываем его, нет —
 * показываем слово статуса. Совпадающие («экспертный выбор» при статусе
 * «Экспертный выбор») сводятся к одному сами.
 */
function checkBadge(check) {
  const status = STATUS_COPY[check.status] || check.status;
  if (!check.effect) return status;
  return check.effect.toLowerCase() === String(status).toLowerCase()
    ? status
    : check.effect;
}

function CheckCopy({ check }) {
  return (
    <span className="optimization-check-copy">
      <b>{check.title}</b>
      <em>{checkBadge(check)}</em>
      <small>{check.detail}</small>
    </span>
  );
}

/*
 * Строка проверки.
 *
 * Отмечаемая — флажок, а не тумблер, и это не оформление: тумблер обещает, что
 * настройка меняется прямо сейчас, а здесь отмечают «это тоже возьми в план».
 * Мишенью служит вся строка, поэтому флажок держит её содержимое у себя.
 *
 * Неотмечаемая — та же геометрия, но на месте знака значок состояния. Подписи
 * «Только проверка» у неё больше нет: почему у строки нет флажка, сказано
 * один раз заголовком группы над ней, а не девять раз в каждой строке.
 *
 * У тихой группы знака нет вовсе. Треугольник над строкой «Проверено —
 * вмешательство не нужно» спорил сам с собой, а «Готово» и «Информация» и так
 * написаны словом рядом с заголовком. Место под знак при этом остаётся: без
 * него заголовки тихих строк уезжали бы на двадцать пикселей влево от
 * остальных.
 */
function CheckRow({ check, quiet, checked, disabled, onToggle }) {
  const className = `optimization-check status-${check.status}${
    quiet ? " is-quiet" : ""
  }`;

  if (!check.actionable) {
    return (
      <div className={className}>
        <span className="optimization-check-mark" aria-hidden="true">
          {quiet ? null : <CheckIcon status={check.status} />}
        </span>
        <CheckCopy check={check} />
      </div>
    );
  }

  return (
    <Checkbox
      className={className}
      checked={checked}
      disabled={disabled}
      onChange={onToggle}
      ariaLabel={`Выбрать: ${check.title}`}
    >
      <CheckCopy check={check} />
    </Checkbox>
  );
}

function humanDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

/* Заглушка повторяет геометрию готового экрана — те же две колонки и строки
   той же высоты. Ради этого она и существует: пустая рамка со словом
   «Анализируем» схлопывалась в момент ответа, и страница прыгала на полтора
   экрана. */
function ChecksSkeleton({ hardware }) {
  return (
    <div className="optimization-skeleton">
      <div className="ui-panel optimization-skeleton-checks" aria-hidden="true">
        {SKELETON_ROWS.map((row) => (
          <div className="optimization-skeleton-check" key={row}>
            <Skeleton className="optimization-skeleton-mark" delay={row * 90} />
            <span className="optimization-skeleton-copy">
              <Skeleton as="i" line style={{ width: `${72 - row * 9}%` }} delay={row * 90 + 40} />
              <Skeleton as="i" line style={{ width: `${54 - row * 6}%` }} delay={row * 90 + 80} />
            </span>
          </div>
        ))}
      </div>
      <div className="optimization-skeleton-side">
        {/* Не серая плашка, а та самая панель железа: слоты она называет до
            ответа, а на втором заходе показывает прошлые характеристики
            сразу — их опрос и есть самая долгая часть разбора. */}
        <OptimizationRig hardware={hardware} />
        <div
          className="ui-panel optimization-skeleton-card"
          aria-hidden="true"
        >
          <Skeleton fill delay={200} />
        </div>
      </div>
    </div>
  );
}

export default function OptimizationPage({ targetId, onNotice, onApplied }) {
  useTr();
  /* Окно знает, что открыта оптимизация, меткой на `.desktop-app` (`useHolds.js`), а не `:has()`. */
  const pageRef = useRef(null);
  useHolds(pageRef, "optimization-page", [".desktop-app"]);
  const resolvedTargetId =
    targetId || localStorage.getItem("modovik-game-target") || "";
  /*
   * Что человек здесь выбрал, переживает уход из раздела; чем ответила машина
   * — нет.
   *
   * Закладка и снятые галочки — это решения: «смотрю про игру», «эту проверку
   * не применять». Сам разбор в память не кладётся, и намеренно: он говорит о
   * состоянии компьютера прямо сейчас, а между заходами это состояние могло
   * поменяться — в том числе руками самого человека в соседнем разделе.
   * Показать прошлые числа как текущие значило бы соврать; поэтому железо
   * (оно не меняется) держится в хранилище вкладки, а числа рядом ждут
   * свежего ответа — так решено там же, у `HARDWARE_CACHE_KEY`.
   */
  const [activeGroup, setActiveGroup] = useRememberedState(
    "optimization:group",
    "windows",
  );
  const [scan, setScan] = useState(null);
  const [hardware, setHardware] = useState(readCachedHardware);
  /* `null` — «разбора ещё не было», пустой список — «человек снял все
     галочки». Различать их надо: первое разбор заполняет, второе обязан
     оставить как есть. */
  const [selectedIds, setSelectedIds] = useRememberedState(
    "optimization:selected",
    null,
  );
  const [history, setHistory] = useState([]);
  const [review, setReview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState("scan");
  const [error, setError] = useState("");
  /* loading → revealing → ready. Средний шаг нужен только анимации: в нём на
     экране одновременно живут уходящая заглушка и приходящий разбор. */
  const [reveal, setReveal] = useState("loading");
  useRememberedScroll("optimization:scroll");

  const chosenIds = useMemo(() => selectedIds || [], [selectedIds]);
  const updateSelection = useCallback(
    (update) => setSelectedIds((current) => update(current || [])),
    [setSelectedIds],
  );

  const rememberScan = useCallback((nextScan) => {
    setScan(nextScan);
    if (nextScan?.hardware) {
      cacheHardware(nextScan.hardware);
      setHardware(nextScan.hardware);
    }
  }, []);

  const refresh = useCallback(async () => {
    setBusy("scan");
    setError("");
    setReview(null);
    setConfirmed(false);
    setProgress(null);
    /* Журнал больше не задерживает разбор. Раньше обе просьбы стояли в одном
       `Promise.all`, и страница ждала обе: список операций читается из файла за
       миллисекунды, но появлялся вместе с разбором, который идёт секунду с
       лишним. Теперь каждая рисует своё, как только ответила. */
    getOptimizationHistory()
      .then((nextHistory) =>
        setHistory(Array.isArray(nextHistory) ? nextHistory : []),
      )
      .catch(() => setHistory([]));
    try {
      const nextScan = await analyzeOptimization({
        targetId: resolvedTargetId,
      });
      rememberScan(nextScan);
      /* Свежий разбор не переставляет галочки, если человек их уже трогал:
         снятая галочка — это решение «эту проверку не применять», и повторный
         разбор его не отменяет. Отмечается всё исправимое только на первом
         разборе, когда решать было нечего. */
      setSelectedIds((chosen) => {
        const actionable = (nextScan?.checks || [])
          .filter((check) => check.actionable)
          .map((check) => check.id);
        if (!chosen) return actionable;
        const known = new Set(actionable);
        return chosen.filter((id) => known.has(id));
      });
    } catch (nextError) {
      setError(nextError.message || tr("Не удалось проверить компьютер."));
    } finally {
      setBusy("");
    }
  }, [rememberScan, resolvedTargetId, setSelectedIds]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(
    () =>
      onOptimizationProgress((event) => {
        setProgress(event);
      }),
    [],
  );

  useEffect(() => {
    if (!scan) return;
    setReveal((current) => (current === "loading" ? "revealing" : current));
  }, [scan]);

  useEffect(() => {
    if (reveal !== "revealing") return undefined;
    /* Задержка держит экран пустым ровно на время анимации раскрытия. Без
       анимации ждать нечего. */
    const timer = window.setTimeout(
      () => setReveal("ready"),
      motionEnabled() ? REVEAL_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [reveal]);

  const checks = useMemo(() => scan?.checks || [], [scan]);
  const group = GROUPS.find((item) => item.id === activeGroup) || GROUPS[0];
  const groupChecks = useMemo(
    () => checks.filter((check) => check.group === activeGroup),
    [activeGroup, checks],
  );
  const visibleChecks = useMemo(
    () => [...groupChecks].sort((a, b) => readingOrder(a) - readingOrder(b)),
    [groupChecks],
  );
  /* Счётчик на закладке отвечает на вопрос, ради которого по ним и щёлкают:
     есть ли там вообще что применять. */
  const actionableByGroup = useMemo(() => {
    const counts = {};
    for (const check of checks) {
      if (!check.actionable) continue;
      counts[check.group] = (counts[check.group] || 0) + 1;
    }
    return counts;
  }, [checks]);
  const actionableCount = checks.filter((check) => check.actionable).length;
  const activeOperations = history.filter(
    (operation) => operation.status === "active",
  );
  const activeOperation = activeOperations[0];
  const scanning = busy === "scan";
  /* Приложение присылает `game: null`, когда цель выбрана, а папка не нашлась. */
  const installMissing = Boolean(scan && scan.targetId && !scan.game);
  const groupActionable = groupChecks.filter((check) => check.actionable);
  const groupSelected = groupActionable.filter((check) =>
    chosenIds.includes(check.id),
  ).length;
  /* Две границы вместо одной. Первая отделяет то, что Astral переключает, от
     того, что человек чинит сам; вторая — от того, что уже в порядке. Ниже
     второй карточки идут тише и плотнее, потому что делать с ними нечего. */
  const personFrom = visibleChecks.findIndex(needsPerson);
  const quietFrom = visibleChecks.findIndex(
    (check) => !check.actionable && !needsPerson(check),
  );
  const tabPanelId = `optimization-panel-${activeGroup}`;
  const summary = scan
    ? {
        checks: checks.length,
        actionable: actionableCount,
        active: activeOperations.length,
        scannedAt: humanDate(scan.createdAt),
      }
    : null;

  function selectGroup(nextGroup) {
    if (nextGroup === activeGroup) return;
    setActiveGroup(nextGroup);
    setReview(null);
    setConfirmed(false);
    /* Ошибка относилась к прежней закладке — на новой она просто врёт. */
    setError("");
  }

  function toggleCheck(checkId) {
    updateSelection((current) =>
      current.includes(checkId)
        ? current.filter((id) => id !== checkId)
        : [...current, checkId],
    );
    setReview(null);
    setConfirmed(false);
  }

  function toggleGroupSelection() {
    const ids = groupActionable.map((check) => check.id);
    const everySelected = groupSelected === ids.length;
    updateSelection((current) =>
      everySelected
        ? current.filter((id) => !ids.includes(id))
        : [...new Set([...current, ...ids])],
    );
    setReview(null);
    setConfirmed(false);
  }

  /* Снимок живёт на стороне приложения пять минут. Вкладку открывают и уходят,
     а вернувшись получают «Сканирование устарело» вместо плана — поэтому здесь
     молча перечитываем состояние и собираем план по свежему снимку. */
  async function requestPlan(scanId, profileId, selectedCheckIds) {
    try {
      return await planOptimization({ scanId, profileId, selectedCheckIds });
    } catch (nextError) {
      if (!/устарел/i.test(nextError.message || "")) throw nextError;
      const freshScan = await analyzeOptimization({
        targetId: resolvedTargetId,
      });
      rememberScan(freshScan);
      const stillActionable = new Set(
        (freshScan?.checks || [])
          .filter((check) => check.actionable)
          .map((check) => check.id),
      );
      const retryIds = selectedCheckIds.filter((id) => stillActionable.has(id));
      if (!retryIds.length) {
        throw new Error(
          "После повторной проверки выбранные улучшения уже не нужны.",
        );
      }
      updateSelection((current) =>
        current.filter((id) => stillActionable.has(id)),
      );
      return planOptimization({
        scanId: freshScan.scanId,
        profileId,
        selectedCheckIds: retryIds,
      });
    }
  }

  async function buildPlan(profileId = group.profileId, all = false) {
    if (!scan) return;
    /* Порядок берём из разбора, а не с экрана: список на экране отсортирован по
       читаемости, а план не должен зависеть от того, как он выглядит. */
    const selectedCheckIds = checks
      .filter(
        (check) =>
          check.actionable &&
          (all ||
            (check.group === activeGroup && chosenIds.includes(check.id))),
      )
      .map((check) => check.id);
    if (!selectedCheckIds.length) {
      setError(tr("Выберите хотя бы одну доступную оптимизацию."));
      return;
    }
    setBusy("plan");
    setError("");
    setConfirmed(false);
    setProgress(null);
    try {
      const nextPlan = await requestPlan(
        scan.scanId,
        profileId,
        selectedCheckIds,
      );
      if (!nextPlan.actions.length) {
        throw new Error("Для выбранных проверок изменения не требуются.");
      }
      setReview(nextPlan);
    } catch (nextError) {
      setError(nextError.message || tr("Не удалось собрать план."));
    } finally {
      setBusy("");
    }
  }

  async function applyPlan() {
    if (!review || !confirmed) return;
    setBusy("apply");
    setError("");
    setProgress({ progress: 0, message: tr("Подготовка резервной копии") });
    try {
      await applyOptimization({
        planId: review.planId,
        confirmationToken: review.confirmationToken,
      });
      onApplied?.();
      onNotice?.(
        tr("Оптимизация применена. Исходное состояние сохранено для отката."),
        "success",
      );
      await refresh();
    } catch (nextError) {
      setError(nextError.message || tr("Не удалось применить оптимизацию."));
      setProgress(null);
    } finally {
      setBusy("");
    }
  }

  async function rollbackLast() {
    if (!activeOperation) return;
    setBusy("rollback");
    setError("");
    setProgress(null);
    try {
      await rollbackOptimization({ operationId: activeOperation.operationId });
      onNotice?.(tr("Исходные настройки восстановлены."), "success");
      await refresh();
    } catch (nextError) {
      setError(nextError.message || tr("Не удалось выполнить откат."));
    } finally {
      setBusy("");
    }
  }

  return (
    <section ref={pageRef} className="optimization-page" aria-labelledby="optimization-title">
      {/* Шапка страницы — общая (`PageHeading`), как у «Сборок» и главной.
          Своей у этой страницы была ещё и надстрочная плашка «Безопасный
          режим»: она повторяла строку под заголовком, где про безопасность
          сказано словами и по делу. */}
      <PageHeading
        title={tr("Оптимизация")}
        titleId="optimization-title"
        description={tr("Реальные проверки Windows и GTA V: план перед применением, полный откат и никаких «магических» твиков.")}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={refresh}
              disabled={Boolean(busy)}
              icon={
                scanning ? (
                  <CircleNotch className="optimization-spin" />
                ) : (
                  <ArrowClockwise />
                )
              }
            >
              {scanning ? tr("Проверяем…") : tr("Проверить заново")}
            </Button>
            <Button
              variant={review || !actionableCount ? "secondary" : "primary"}
              onClick={() => buildPlan("all-safe", true)}
              disabled={Boolean(busy) || !actionableCount}
              icon={<Lightning weight="fill" />}
            >
              {tr("Безопасно оптимизировать всё")}
            </Button>
          </>
        }
      />

      <OptimizationVerdict
        summary={summary}
        scanning={scanning}
        activeCount={activeOperations.length}
      />

      <SegmentedControl
        className="optimization-tabs"
        role="tablist"
        label={tr("Разделы оптимизации")}
        value={activeGroup}
        onChange={selectGroup}
        options={GROUPS.map(({ id, label, icon: Icon }) => {
          const count = actionableByGroup[id] || 0;
          return {
            value: id,
            id: `optimization-tab-${id}`,
            controls: id === activeGroup ? tabPanelId : undefined,
            icon: <Icon aria-hidden="true" />,
            label: (
              <>
                {label}
                {count > 0 && (
                  <em aria-label={`доступных улучшений: ${count}`}>{count}</em>
                )}
              </>
            ),
          };
        })}
      />

      {error && (
        <p className="optimization-error" role="alert">
          <WarningCircle weight="fill" /> {error}
        </p>
      )}

      {/* Разбор пережил пропавшую установку — но молчать об этом нельзя:
          страница выглядела бы законченной, а вкладки игры и мира ничего бы
          не применили. Проверка об этом лежит во вкладке «GTA V», а открывается
          страница на «Windows», поэтому говорим ещё и здесь. */}
      {installMissing && (
        <p className="optimization-notice" role="status">
          <WarningCircle weight="fill" />
          <span>
            {tr("Выбранная установка GTA V не найдена — проверки Windows выполнены и применяются как обычно, а настройки игры и мира станут доступны после повторного поиска игры.")}
          </span>
        </p>
      )}

      <div className="optimization-stage" data-reveal={reveal}>
        {reveal !== "ready" && (
          <div className="optimization-boot">
            <p className="optimization-loading" role="status">
              <CircleNotch className="optimization-spin" /> Анализируем
              компьютер и настройки GTA V…
            </p>
            <ChecksSkeleton hardware={hardware} />
          </div>
        )}

        {reveal !== "loading" && (
          <div
            className="optimization-layout"
            id={tabPanelId}
            role="tabpanel"
            aria-labelledby={`optimization-tab-${activeGroup}`}
            aria-busy={scanning || undefined}
          >
            <div className="ui-panel optimization-checks">
              <header>
                <h2>
                  {groupActionable.length
                    ? tr("Выберите изменения")
                    : tr("Действий не требуется")}
                </h2>
                {/* Счёт отмеченного стоит один раз — в плане справа, там же,
                    где на него смотрят перед нажатием. */}
                {groupActionable.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleGroupSelection}
                    disabled={Boolean(busy)}
                  >
                    {groupSelected === groupActionable.length
                      ? tr("Снять все")
                      : tr("Выбрать все")}
                  </Button>
                )}
              </header>

              <div className="optimization-check-list" key={activeGroup}>
                {visibleChecks.map((check, index) => {
                  const person = needsPerson(check);
                  const quiet = !check.actionable && !person;
                  return (
                    <div
                      className="optimization-check-slot"
                      key={check.id}
                      /* Очередь появления — на обёртке строки: она же держит
                         разделитель над ней, и оба въезжают одним шагом. */
                      style={{ "--optimization-row": index }}
                    >
                      {person && index === personFrom && (
                        <p className="optimization-check-divider is-person">
                          {tr("Здесь теряются кадры — но чинится это не в Astral")}
                        </p>
                      )}
                      {quiet && index === quietFrom && index > 0 && (
                        <p className="optimization-check-divider">
                          {tr("Проверено — вмешательство не нужно")}
                        </p>
                      )}
                      <CheckRow
                        check={check}
                        quiet={quiet}
                        checked={chosenIds.includes(check.id)}
                        disabled={Boolean(busy)}
                        onToggle={() => toggleCheck(check.id)}
                      />
                    </div>
                  );
                })}

                {!visibleChecks.length && (
                  <p className="optimization-empty">
                    {tr("В этом разделе проверять нечего: Astral не нашёл ни одной настройки, к которой у него есть безопасный доступ.")}
                  </p>
                )}
              </div>
            </div>

            <aside className="optimization-side">
              {/* План — не всплывающая панель, а та же плашка, которая до
                  нажатия перечисляет отмеченное. Раньше на её месте стояла
                  справка о безопасности, и «собрать план» подменял один блок
                  другим: ответ появлялся не там, где был вопрос. */}
              <section className="ui-panel optimization-plan">
                <header>
                  <h2>{review ? tr("План перед применением") : tr("Что применим")}</h2>
                  <small>
                    {review
                      ? `${review.actions.length} ${pluralWord(review.actions.length, [tr("изменение"), tr("изменения"), tr("изменений")])}`
                      : `Выбрано ${groupSelected} из ${groupActionable.length}`}
                  </small>
                </header>

                {review ? (
                  <>
                    <ol className="optimization-plan-list">
                      {review.actions.map((action, index) => (
                        <li
                          key={action.id}
                          style={{ "--optimization-row": index }}
                        >
                          <CheckCircle weight="fill" aria-hidden="true" />
                          <span>
                            <b>{action.title}</b>
                            <small>
                              {action.risk === "opt-in"
                                ? tr("Изменит пользовательскую функцию Windows")
                                : tr("Безопасное обратимое действие")}
                            </small>
                          </span>
                        </li>
                      ))}
                    </ol>
                    <small className="optimization-plan-note">
                      {tr("Перед записью Astral создаст backup и журнал. GTA V должна быть закрыта; VBS, Defender, Firewall и игровые архивы не меняются.")}
                    </small>
                    {/* Согласие, а не настройка: знак стоит перед фразой, как
                        в любом «я прочитал и принимаю», а не у правого края
                        колонки, как значение поля. */}
                    <Checkbox
                      className="optimization-confirm"
                      ariaLabel={tr("Я проверил план и разрешаю эти изменения")}
                      checked={confirmed}
                      disabled={busy === "apply"}
                      onChange={setConfirmed}
                    >
                      <span>{tr("Я проверил план и разрешаю эти изменения")}</span>
                    </Checkbox>
                    {busy === "apply" && (
                      <p className="optimization-progress" role="status">
                        <span
                          style={{ width: `${progress?.progress || 0}%` }}
                          aria-hidden="true"
                        />
                        <small>{progress?.message || tr("Применяем план…")}</small>
                      </p>
                    )}
                    <div className="optimization-plan-actions">
                      <Button
                        variant="ghost"
                        onClick={() => setReview(null)}
                        disabled={busy === "apply"}
                      >
                        {tr("Назад")}
                      </Button>
                      <Button
                        variant="primary"
                        onClick={applyPlan}
                        disabled={!confirmed || busy === "apply"}
                        icon={
                          busy === "apply" ? (
                            <CircleNotch className="optimization-spin" />
                          ) : (
                            <Lightning weight="fill" />
                          )
                        }
                      >
                        {tr("Применить")}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Отмеченные строки здесь не перечисляются: они уже
                        перечислены слева, с галочками. Панель отвечает на
                        другое — что произойдёт после нажатия. */}
                    <small className="optimization-plan-note">
                      {!groupActionable.length
                        ? tr("В этом разделе применять нечего.")
                        : groupSelected
                          ? tr("Astral покажет точный список действий и создаст резервную копию — до записи в систему ничего не изменится.")
                          : tr("Отметьте слева то, что нужно применить.")}
                    </small>
                    {/* Не главная кнопка экрана: главная — «безопасно
                        оптимизировать всё» в шапке, и двух главных на одном
                        экране не бывает. Главной эта колонка становится
                        позже, когда план собран и его применяют. */}
                    <Button
                      variant="secondary"
                      block
                      onClick={() => buildPlan()}
                      disabled={
                        Boolean(busy) ||
                        !groupActionable.length ||
                        !groupSelected
                      }
                      icon={
                        busy === "plan" ? (
                          <CircleNotch className="optimization-spin" />
                        ) : null
                      }
                    >
                      {busy === "plan" ? tr("Собираем…") : tr("Собрать план")}
                    </Button>
                  </>
                )}
              </section>

              <OptimizationRig hardware={hardware} />

              <section className="ui-panel optimization-safety">
                <header>
                  <h2>
                    <ShieldCheck weight="regular" aria-hidden="true" /> Что
                    Astral не трогает
                  </h2>
                </header>
                <ul>
                  <li>{tr("Defender, Firewall, VBS и системные службы")}</li>
                  <li>{tr("разрешение экрана и частоту монитора")}</li>
                  <li>{tr("RPF-архивы и объекты без точного build-профиля")}</li>
                </ul>
              </section>

              <section className="ui-panel optimization-history">
                <header>
                  <h2>{tr("Последнее изменение")}</h2>
                </header>
                <small>
                  {history[0]
                    ? `${history[0].actionCount} ${pluralWord(history[0].actionCount, [tr("действие"), tr("действия"), tr("действий")])} · ${humanDate(history[0].createdAt)}`
                    : tr("Пока ничего не применялось — откат появится здесь после первой записи")}
                </small>
                {/* Кнопка приходит вместе с тем, что можно откатить. Навсегда
                    погашенная кнопка на свежей машине — это обещание, которое
                    нечем выполнить. */}
                {activeOperation && (
                  <Button
                    variant="secondary"
                    block
                    onClick={rollbackLast}
                    disabled={Boolean(busy)}
                    icon={
                      busy === "rollback" ? (
                        <CircleNotch className="optimization-spin" />
                      ) : (
                        <ArrowCounterClockwise />
                      )
                    }
                  >
                    {busy === "rollback" ? tr("Откатываем…") : tr("Откатить")}
                  </Button>
                )}
              </section>
            </aside>
          </div>
        )}
      </div>
    </section>
  );
}
