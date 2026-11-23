import {
  Suspense,
  lazy,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Lightning } from "../ui/icons.jsx";
import { setDownloadsAccelerated as setDesktopDownloadsAccelerated } from "../../api.js";
import {
  setDownloadsAcceleratedNow,
  useDownloadsAccelerated,
} from "../../features/downloads/accelerated.js";
import FastInstallToggle from "../../features/downloads/FastInstallToggle.jsx";
import WorkshopInstallRow from "./WorkshopInstallRow.jsx";
import { installPhaseKey } from "../../install-phase.js";
import { downloadsCopyFor } from "../../features/downloads/downloads-copy.js";
import {
  doneToday,
  latestBatch,
  useDoneLog,
} from "../../features/downloads/done-log.js";
import { foreignHoldOf } from "../../features/downloads/foreign-hold.js";
import { useWorkshopInstallsLive } from "../../features/workshop/install-queue/useWorkshopInstalls.js";
import {
  describeWorkshopInstall,
  workshopInstallShare,
} from "../../features/workshop/install-queue/index.js";
import {
  CatalogFailedHero,
  CatalogHero,
  CatalogWaitHero,
  FailedRow,
  WaitingRow,
} from "../../features/downloads/ribbon/CatalogItems.jsx";
import DlToggle from "../../features/downloads/ribbon/DlToggle.jsx";
import {
  DoneHero,
  EmptyHero,
} from "../../features/downloads/ribbon/IdleHero.jsx";
import { Card, EmptyQueue } from "../../features/downloads/ribbon/Lists.jsx";
import { ribbonCopyFor } from "../../features/downloads/ribbon/ribbon-copy.js";
import { useSortableRows } from "../../features/downloads/ribbon/useSortableRows.js";
import { openCart } from "../../features/cart/cart-store.js";
import { useInstallWaits } from "../../features/downloads/prepare-wait.js";
import PrepareWaitHero from "../../features/downloads/ribbon/PrepareWaitHero.jsx";
import "./downloads-ribbon.css";

/* Библиотека справа едет отдельным куском: она тянет полку мастерской, а страница «Загрузки» открывается сразу и без неё (`DownloadsLibrary.jsx`). */
const DownloadsLibrary = lazy(
  () => import("../../features/downloads/DownloadsLibrary.jsx"),
);

/*
 * «Загрузки» — страница «Лента» (v2-A, владелец 15.11.2026; макет v2 от 16.11.2026): сверху идущая установка героем на всю ширину, ниже две колонки —
 * слева очередь (ручка переставляет строки, «×» снимает), справа библиотека: что стоит в игре, карандаш и корзина у строки. Очередь пуста — библиотека на
 * всю ширину в две колонки, над ней тонкая строка с корзиной покупок. Очередь, ход, пауза, отмена, повтор и работы мастерской те же, что были в панели
 * «В процессе»; здесь только вид и порядок показа.
 *
 * Страница лежит поверх рабочей области справа от рельса (`downloads-ribbon.css`), входит и уходит `transform` и `opacity`;
 * уход снимает таймер оболочки (`DOWNLOADS_CLOSE_MS` в `DesktopShell.jsx` обязан совпадать с `dl-page-out`).
 */

const noop = () => {};
const refuse = () => false;
const NO_JOBS = [];
const CLOCK_MS = 1000;
const STOPPED_NOTE_MS = 5000;
// Окно поверх страницы: пока оно есть, Escape принадлежит ему.
const FOREIGN_DIALOG = '[role="dialog"]:not(.dl-sheet)';
// Итог «Всё готово» держится так долго после последней установки; дальше страница пустая.
const DONE_HERO_MS = 20 * 60 * 1000;

// Подписка на документ и таймер: каждая возвращает функцию очистки для эффекта.
function listenOnDocument(type, handler) {
  document.addEventListener(type, handler);
  return () => document.removeEventListener(type, handler);
}

function runLater(task, ms) {
  const timer = setTimeout(task, ms);
  return () => clearTimeout(timer);
}

function runEvery(task, ms) {
  const timer = setInterval(task, ms);
  return () => clearInterval(timer);
}

const isLive = (row) => !row.failed;

/* ---------- работы мастерской ---------- */

// Общий список, идущая работа и та, что держит каталог.
function sortOutWorks(external, jobs) {
  const all = external ? [external, ...jobs] : jobs;
  const withStatus = (status) =>
    all.find((job) => job.status === status) ?? null;
  const running = withStatus("running");
  return { all, ahead: running, holder: running ?? withStatus("queued") };
}

function waitsForHolder(copy, holder) {
  const title = holder?.title || holder?.name;
  if (!title) return copy.waitsForWorkshop;
  const phase = installPhaseKey(holder.phase);
  const view = describeWorkshopInstall(holder);
  const measured = !view.waiting && view.measured != null;
  const info = { title };
  info.stage = phase ? copy.phases[phase] : "";
  info.percent = measured
    ? Math.round(workshopInstallShare(holder, view) * 100)
    : null;
  return copy.waitsForWorkshopDetail(info);
}

function waitingCaption(copy, place, holder) {
  switch (place) {
    case 0:
      return waitsForHolder(copy, holder);
    case 1:
      return copy.startsAfterCurrent;
    default:
      return copy.startsAfter(place);
  }
}

/* ---------- состав страницы ---------- */

/* Что стоит в герое: идущая работа мастерской, идущая строка каталога, первая ждущая, первый отказ, итог сессии или пустота. */
function pickHero({
  ahead,
  catalogActive,
  queuedJobs,
  waitingRows,
  failedJobs,
  failedRows,
  doneJobs = [],
}) {
  if (ahead) return { kind: "job", job: ahead };
  if (catalogActive) return { kind: "row", row: catalogActive };
  if (queuedJobs.length) return { kind: "job-wait", job: queuedJobs[0] };
  if (waitingRows.length) return { kind: "row-wait", row: waitingRows[0] };
  if (failedJobs.length) return { kind: "job-failed", job: failedJobs[0] };
  if (failedRows.length) return { kind: "row-failed", row: failedRows[0] };
  /* Готовая работа со словами про GTA 5 RP (`rpNote`) остаётся героем, пока её ряд живёт в очереди (30 с): иначе «Пока тихо» гасило её в тот же момент, как кончалась установка. */
  if (doneJobs.length) return { kind: "job-done", job: doneJobs[doneJobs.length - 1] };
  return { kind: "idle" };
}

/* ---------- шапка ---------- */

function PanelHeader({ copy, rc, count, accelProps, language }) {
  return (
    <header className="dl-head">
      <h1 id={accelProps.titleId}>{rc.title}</h1>
      <div className="dl-tabs">
        <span className="is-on">{rc.tabNow(count)}</span>
      </div>
      <div className="dl-head-r">
        <DlToggle
          icon={Lightning}
          label={copy.accel.label}
          on={accelProps.accelerated}
          note={accelProps.noteText}
          shown={accelProps.stopped}
          onToggle={accelProps.onToggle}
        />
        <FastInstallToggle language={language} />
      </div>
    </header>
  );
}

/* ---------- страница ---------- */

export default function DownloadsPanel({
  queue,
  onCancel,
  onRetry = noop,
  onClose = noop,
  closing = false,
  works = null,
  onRetryWork = noop,
  onDismissWork = noop,
  onCancelWork = refuse,
  onNotice = noop,
  onOpenLogs,
  onOpenCatalog,
  onReorder = noop,
  library = null,
  game = null,
  language = "ru",
}) {
  const titleId = useId();
  const panelRef = useRef(null);
  const copy = useMemo(() => downloadsCopyFor(language), [language]);
  const rc = useMemo(() => ribbonCopyFor(language), [language]);
  const accelerated = useDownloadsAccelerated();
  // Новый объект при каждом выключении: так пять секунд отсчитываются заново.
  const [stoppedNote, setStoppedNote] = useState(null);
  const [now, setNow] = useState(Date.now);
  const doneLog = useDoneLog();
  /* Установка ждёт подготовку игры (T-0001): очереди у неё ещё нет, страница показывает её героем. */
  const waits = useInstallWaits();

  const liveWorks = useWorkshopInstallsLive();
  const source = works ?? liveWorks;
  const { external } = source;
  const jobs = source.jobs ?? NO_JOBS;
  const sorted = useMemo(() => sortOutWorks(external, jobs), [external, jobs]);
  const { all: workList, ahead, holder } = sorted;
  const heldBy = source.held || "";

  const hasLiveRow = queue.some(isLive);
  const needsClock = hasLiveRow || holder !== null;

  useEffect(() => {
    const before = document.activeElement;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      const stillThere =
        before && before !== document.body && document.contains(before);
      if (stillThere) before.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape" && !document.querySelector(FOREIGN_DIALOG))
        onClose();
    }
    return listenOnDocument("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!stoppedNote) return undefined;
    return runLater(() => setStoppedNote(null), STOPPED_NOTE_MS);
  }, [stoppedNote]);

  useEffect(() => {
    if (!needsClock) return undefined;
    setNow(Date.now());
    return runEvery(() => setNow(Date.now()), CLOCK_MS);
  }, [needsClock]);

  function toggleAccelerated() {
    const next = !accelerated;
    setDownloadsAcceleratedNow(next);
    setStoppedNote(next ? null : {});
    try {
      Promise.resolve(setDesktopDownloadsAccelerated(next)).catch(noop);
    } catch {
      // Мост недоступен: выбор уже принят окном.
    }
  }

  let noteText = copy.accel.off;
  if (accelerated) noteText = copy.accel.on;
  else if (stoppedNote) noteText = copy.accel.stopped;

  /* Разбор очереди: идущая строка, ждущие и отказы — отдельно для каталога и мастерской. */
  const liveRows = queue.filter(isLive);
  const failedRows = queue.filter((row) => row.failed);
  const catalogActive =
    liveRows[0] && (liveRows[0].started || holder === null)
      ? liveRows[0]
      : null;
  const waitingRows = liveRows.filter((row) => row !== catalogActive);
  const placeOf = (row) => liveRows.indexOf(row);
  const queuedJobs = workList.filter((job) => job.status === "queued");
  const failedJobs = workList.filter((job) => job.status === "failed");
  const doneJobs = workList.filter((job) => job.status === "done" && job.rpNote);
  const hero = pickHero({
    doneJobs,
    ahead,
    catalogActive,
    queuedJobs,
    waitingRows,
    failedJobs,
    failedRows,
  });
  const running = hero.kind === "job" || hero.kind === "row";

  const liveCount = liveRows.length + queuedJobs.length + (ahead ? 1 : 0);
  const heroRowOf = (kind) => hero.kind === kind;
  const restJobs = queuedJobs.filter(
    (job) => !(heroRowOf("job-wait") && hero.job === job),
  );
  const restWaiting = waitingRows.filter(
    (row) => !(heroRowOf("row-wait") && hero.row === row),
  );
  const restFailedJobs = failedJobs.filter(
    (job) => !(heroRowOf("job-failed") && hero.job === job),
  );
  const restFailedRows = failedRows.filter(
    (row) => !(heroRowOf("row-failed") && hero.row === row),
  );

  /* Итог: что уже готово в этой сессии (журнал + готовые работы), для героя «Всё готово» и строки «Последняя установка». */
  const liveQueuedAts = [
    ...liveRows.map((row) => row.queuedAt),
    ...queuedJobs.map((job) => job.queuedAt),
  ].filter(Number.isFinite);
  const batch = latestBatch(doneLog, liveQueuedAts);
  const today = doneToday(doneLog, now);
  const last = today[0] || null;
  const showDone =
    hero.kind === "idle" &&
    batch.length > 0 &&
    Date.now() - batch[0].at < DONE_HERO_MS;
  /* Вкладка «Сейчас N» считает и остановившиеся: страница показывает отказ героем, и «Сейчас 0» рядом с ним читалось как «всё чисто». */
  /* Ожидание подготовки (T-0001) — героем, только когда страница иначе пуста; при живой очереди героя не видно, и вкладка его не считает.
     Запись, у которой подготовка уже кончилась (идёт план), уступает герою «Всё готово»: он и так не пустая страница. */
  const waitHero = hero.kind === "idle" && waits.length > 0 && (!showDone || waits.some((wait) => wait.phase === "preparing"));
  const tabCount = liveCount + failedRows.length + failedJobs.length + (waitHero ? waits.length : 0);

  const failedExtras = { copy, rc, language, onCancel, onRetry, onOpenLogs };
  const rowProps = (row) => ({ row, copy, language, onCancel });
  const jobProps = (job) => ({
    job,
    now,
    heldBy,
    ahead,
    language,
    onRetry: onRetryWork,
    onDismiss: onDismissWork,
    onCancel: onCancelWork,
    onNotice,
    onOpenLogs,
  });

  /* Герой. */
  const total = liveCount;
  let heroNode;
  if (hero.kind === "row") {
    heroNode = (
      <CatalogHero
        row={hero.row}
        copy={copy}
        rc={rc}
        language={language}
        now={now}
        position={1}
        total={total}
        game={game}
        onCancel={onCancel}
        onNotice={onNotice}
      />
    );
  } else if (hero.kind === "job") {
    heroNode = (
      <WorkshopInstallRow
        key={hero.job.id}
        {...jobProps(hero.job)}
        hero
        position={1}
        total={total}
      />
    );
  } else if (hero.kind === "job-wait") {
    heroNode = (
      <WorkshopInstallRow
        key={hero.job.id}
        {...jobProps(hero.job)}
        hero
        position={1}
        total={total}
      />
    );
  } else if (hero.kind === "row-wait") {
    heroNode = (
      <CatalogWaitHero
        row={hero.row}
        copy={copy}
        rc={rc}
        language={language}
        game={game}
        caption={waitingCaption(copy, placeOf(hero.row), holder)}
        position={1}
        total={total}
        onCancel={onCancel}
      />
    );
  } else if (hero.kind === "job-done") {
    heroNode = (
      <WorkshopInstallRow key={hero.job.id} {...jobProps(hero.job)} hero position={1} total={total} />
    );
  } else if (hero.kind === "job-failed") {
    heroNode = (
      <WorkshopInstallRow key={hero.job.id} {...jobProps(hero.job)} hero />
    );
  } else if (hero.kind === "row-failed") {
    heroNode = (
      <CatalogFailedHero
        row={hero.row}
        game={game}
        hold={foreignHoldOf(hero.row, failedRows)}
        {...failedExtras}
      />
    );
  } else if (waitHero) {
    heroNode = <PrepareWaitHero wait={waits[0]} copy={copy} language={language} />;
  } else if (showDone) {
    heroNode = (
      <DoneHero
        batch={batch}
        copy={copy}
        rc={rc}
        language={language}
        onOpenCatalog={onOpenCatalog}
      />
    );
  } else {
    heroNode = (
      <EmptyHero
        last={last}
        copy={copy}
        rc={rc}
        onOpenCatalog={onOpenCatalog}
      />
    );
  }

  /* Очередь слева: остановившиеся, работы мастерской и ждущие строки каталога. Ждущие строки переставляются ручкой и стрелками. */
  const waitingIds = restWaiting.map((row) => row.queueId);
  const sortable = useSortableRows({ ids: waitingIds, onOrder: onReorder });
  const waitingById = new Map(restWaiting.map((row) => [row.queueId, row]));
  const placeNote = sortable.moved.match(/^(\d+)\/(\d+):(.*)$/);
  const movedRow = placeNote ? waitingById.get(placeNote[3]) : null;
  const movedWords = movedRow
    ? rc.movedTo(movedRow.name, placeNote[1], placeNote[2])
    : "";

  const queueRows = [];
  restFailedJobs.forEach((job) =>
    queueRows.push(
      <WorkshopInstallRow key={`f-${job.id}`} {...jobProps(job)} />,
    ),
  );
  restFailedRows.forEach((row) =>
    queueRows.push(
      <FailedRow
        key={row.queueId}
        {...rowProps(row)}
        hold={foreignHoldOf(row, failedRows)}
        onRetry={onRetry}
        onOpenLogs={onOpenLogs}
      />,
    ),
  );
  let number = 0;
  restJobs.forEach((job) => {
    number += 1;
    queueRows.push(
      <WorkshopInstallRow
        key={`q-${job.id}`}
        {...jobProps(job)}
        index={number}
      />,
    );
  });
  const waitingList = restWaiting.length ? (
    <div className="dl-sortable" ref={sortable.listRef} key="waiting">
      {sortable.order.map((id) => {
        const row = waitingById.get(id);
        if (!row) return null;
        return (
          <WaitingRow
            key={id}
            {...rowProps(row)}
            caption={waitingCaption(copy, placeOf(row), holder)}
            gripLabel={rc.gripLabel(row.name)}
            grip={restWaiting.length > 1 ? sortable.gripProps(id) : null}
            lifted={sortable.draggingId === id}
            offset={sortable.offsetOf(id)}
          />
        );
      })}
      <p className="dl-sr" role="status" aria-live="polite">
        {movedWords}
      </p>
    </div>
  ) : null;
  if (waitingList) queueRows.push(waitingList);

  const idle = hero.kind === "idle";
  const queueCard = (
    <Card
      title={rc.queueTitle}
      count={
        restWaiting.length +
        restJobs.length +
        restFailedRows.length +
        restFailedJobs.length
      }
      className={queueRows.length ? "dl-queue is-fit" : "dl-queue"}
      /* Карточка очереди по содержимому ниже библиотеки намеренно (17.11.2026): аудит «одинаковая высота в ряду» тут не про дефект. */
      auditIgnore={queueRows.length ? "row-height" : undefined}
      signal={queueRows.length}
    >
      {queueRows.length ? (
        queueRows
      ) : (
        <EmptyQueue
          rc={rc}
          onOpenCatalog={onOpenCatalog}
          onOpenCart={openCart}
          running={running}
          idle={idle}
        />
      )}
    </Card>
  );

  /* Библиотека справа: то, что стоит в игре (`DownloadsLibrary.jsx`, едет отдельным куском). */
  const libraryCard = library ? (
    <Suspense
      fallback={
        <section className="dl-card dl-library" aria-label={rc.libraryTitle}>
          <header className="dl-card-head">
            <span>{rc.libraryTitle}</span>
          </header>
          <p className="dl-card-note">{rc.libraryLoading}</p>
        </section>
      }
    >
      <DownloadsLibrary {...library} language={language} />
    </Suspense>
  ) : null;

  const panelState = closing ? "closing" : "open";
  const accelProps = {
    titleId,
    accelerated,
    noteText,
    stopped: Boolean(stoppedNote),
    onToggle: toggleAccelerated,
  };

  return (
    <div className={`dl-page is-${panelState}`} data-panel-state={panelState}>
      <section
        aria-labelledby={titleId}
        className="dl-sheet"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <PanelHeader
          copy={copy}
          rc={rc}
          count={tabCount}
          accelProps={accelProps}
          language={language}
        />
        {heroNode}
        <div className="dl-grid">
          {queueCard}
          {libraryCard}
        </div>
      </section>
    </div>
  );
}
