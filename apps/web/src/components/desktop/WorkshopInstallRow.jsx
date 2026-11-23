import { useMemo, useRef, useState } from "react";
import Button from "../ui/Button.jsx";
import FailureDetails from "../../features/downloads/FailureDetails.jsx";
import { humanFailure } from "../../utils/installFailure.js";
import ForeignBuildChoice, {
  isForeignBuildFailure,
} from "../../features/downloads/ForeignBuildChoice.jsx";
import ForeignScatterChoice, {
  canRestoreScatter,
  restoreScatterTarget,
} from "../../features/downloads/ForeignScatterChoice.jsx";
import {
  ArrowClockwise,
  Check,
  Gauge,
  Warning,
  Wrench,
  X,
} from "../ui/icons.jsx";
import EditorCover from "../../features/workshop/covers/EditorCover.jsx";
import { hasEditorCover } from "../../features/workshop/covers/editor-covers.js";
import { workPhoto } from "../../features/downloads/ribbon/row-photo.js";
import {
  lastPercent,
  pacePercent,
  percentText,
  preparePercent,
  steadyPercent,
} from "../../features/downloads/ribbon/steady-percent.js";
import {
  describeWorkshopInstall,
  workshopInstallCancellable,
  workshopInstallShare,
} from "../../features/workshop/install-queue/index.js";
import Hero from "../../features/downloads/ribbon/Hero.jsx";
import { ribbonCopyFor } from "../../features/downloads/ribbon/ribbon-copy.js";
import {
  etaMsOf,
  prepareView,
} from "../../features/workshop/install-queue/prepare-progress.js";
import {
  DEPENDENT_WAIT,
  dependentFraction,
  dependentLabel,
  dependentStageLine,
} from "../../features/workshop/install-queue/dependent-words.js";
import { formatSize } from "../../catalog-utils.js";
import { trIn } from "../../locales/ui.js";
import {
  downloadsCopyFor,
  etaWords,
} from "../../features/downloads/downloads-copy.js";
import {
  estimateByHistory,
  expectedRunMs,
  roundedRemaining,
  runCount,
  workshopRunKind,
} from "../../features/downloads/eta.js";

/*
 * Работа мастерской в «Загрузках» v2-A «Лента»: идущая — герой на всю ширину (`hero`), остальные — строки списков:
 * ждущая в «Дальше в очереди», неудавшаяся там же (или героем, когда больше нечего показать), готовая в «Готово сегодня».
 * Слова, остаток и ход подготовки растительности — те же, что были в строке «В процессе».
 */

const noop = () => {};
const refuse = () => false;

// Ключ хода (шаг, доля шага, подпись), сменившийся недавно, считается «идёт заметно»:
// пока окно не вышло, слова «дольше обычного» не показываются.
const MOTION_WINDOW_MS = 90 * 1000;
// Этап упаковки пакета занимает на полосе фиксированную ширину, а не замеренную.
const PACK_STAGE_WEIGHT = 0.12;

// Признаки состояния работы; отмена считается только у идущей.
function statusFlags(job) {
  const running = job.status === "running";
  return {
    running,
    done: job.status === "done",
    failed: job.status === "failed",
    queued: job.status === "queued",
    cancelling: running && Boolean(job.cancelling),
  };
}

// Первое истинное значение; если все ложные — последнее (как цепочка ||).
const firstTruthy = (...values) =>
  values.reduce((found, next) => found || next);

const retryLabelOf = (copy, job) =>
  job.operation === "remove" ? copy.work.retryRemoval : copy.work.retryInstall;

// Свойства блока подробностей отказа; подробность движка показывается, только если она отличается от краткой.
const failureDetailsProps = (job, language, onOpenLogs) => ({
  detail:
    job.errorDetail && job.errorDetail !== job.error ? job.errorDetail : "",
  title: job.title || job.name || "",
  language,
  onOpenLogs,
});

function joinParts(parts) {
  return parts.filter(Boolean).join(" · ");
}

// Слово состояния для кикера: у идущей работы отмена сильнее «Удаления», чужой статус читается как ждущий.
const STATE_WORDS = new Map([
  [
    "running",
    (job, word) =>
      job.cancelling
        ? word.cancelling
        : job.operation === "remove"
          ? word.removing
          : word.running,
  ],
  ["done", (job, word) => word.done],
  ["failed", (job, word) => word.failed],
]);

function stateWord(job, copy) {
  const word = copy.work;
  const choose = STATE_WORDS.get(job.status);
  return choose ? choose(job, word) : word.queued;
}

// Слова отказа заново на языке окна — если известны и семейство отказа, и текст движка.
function failureText(job, language) {
  if (!job.errorKind || !job.errorDetail) return job.error;
  return humanFailure(job.errorDetail, language);
}

// Хвост «…, ещё примерно N» про работу впереди; пусто, пока остаток неизвестен.
function throughPhrase(copy, ahead, now) {
  if (!ahead.progress || !Number.isFinite(now)) return "";
  const ms = etaMsOf(ahead.progressTrail, ahead.progress, now);
  return Number.isFinite(ms)
    ? copy.prepare.through(copy.eta.time(roundedRemaining(ms)))
    : "";
}

function afterAheadText(copy, aheadName, ahead, now) {
  return copy.prepare.waitingAfter(aheadName, throughPhrase(copy, ahead, now));
}

// Подпись ждущей работы: имя впереди идущей важнее её собственного note.
function queuedText(job, { copy, ahead, heldBy, now }) {
  const aheadName = ahead ? ahead.editor || ahead.title : "";
  if (aheadName) return afterAheadText(copy, aheadName, ahead, now);
  return (
    job.note || (heldBy ? copy.work.waitsFor(heldBy) : copy.work.waitsCurrent)
  );
}

const LINE_RULES = new Map([
  ["failed", (job, ctx) => failureText(job, ctx.language)],
  [
    "done",
    (job, ctx) =>
      job.operation === "remove"
        ? ctx.copy.work.doneRemoved
        : ctx.copy.work.doneInstalled,
  ],
  ["queued", queuedText],
]);

// Единственная строка состояния: сначала отмена, затем правило по статусу.
function statusLine(job, ctx) {
  if (ctx.cancelling) return ctx.copy.work.cancellingLine;
  /* Идёт пересборка пакета поверх (растительность над дорогами и т. п.): строка называет её, а не прежнюю ступень записи. */
  if (job.dependent && job.status === "running") return trIn(ctx.language, dependentLabel(job.dependent));
  const rule = LINE_RULES.get(job.status);
  return rule ? rule(job, ctx) : job.note || ctx.hint;
}

function bytesNote(job, copy, language) {
  if (!(job.totalBytes > 0)) return "";
  const size = (bytes) => formatSize(bytes, language);
  return copy.of(size(job.copiedBytes) || "0", size(job.totalBytes));
}

// Помнит, когда ключ хода менялся в последний раз, и отвечает, идёт ли работа заметно.
function useRecentMotion(key, startAt, now) {
  const mark = useRef(null);
  if (!Number.isFinite(now)) return false;
  const last = mark.current;
  const next =
    last === null
      ? { key, at: startAt }
      : last.key !== key
        ? { key, at: now }
        : last;
  mark.current = next;
  return now - next.at < MOTION_WINDOW_MS;
}

// Слова остатка по записям прошлых работ того же вида; у снятия оценки нет.
function historyWords(job, copy, { now, startAt, moving }) {
  if (job.operation === "remove" || !Number.isFinite(now)) return "";
  const kind = workshopRunKind(job);
  const history = {
    elapsedMs: now - startAt,
    expectedMs: expectedRunMs(kind),
    runs: runCount(kind),
    advancing: moving,
  };
  return etaWords(copy, estimateByHistory(history));
}

function prepareLabel(view, copy) {
  const words = copy.prepare;
  if (view.reading)
    return words.archives(view.archivesDone, view.archivesTotal);
  const stage = view.stages[view.index];
  if (view.counting || !stage) return words.counting;
  const name = words.stages[stage.id];
  if (!name) return words.title;
  return words.progress(view.index + 1, view.count, name);
}

function stageState(position, current) {
  if (position === current) return "active";
  return position < current ? "done" : "waiting";
}

// Шаг полосы подготовки; упаковка пакета берёт фиксированную ширину.
function stepOf(stage, state) {
  const step = { id: stage.id, state, fraction: stage.fraction };
  step.weight = stage.id === "pack" ? PACK_STAGE_WEIGHT : stage.weight;
  return step;
}

function prepareSteps(view) {
  if (view.reading) {
    const known = view.archivesTotal > 0;
    const fraction = known ? view.archivesDone / view.archivesTotal : 0;
    return [{ id: "read", state: "active", fraction, unmeasured: !known }];
  }
  if (!view.stages.length)
    return [{ id: "count", state: "active", fraction: 0, unmeasured: true }];
  return view.stages.map((stage, position) =>
    stepOf(stage, stageState(position, view.index)),
  );
}

// Ход подготовки пакета растительности и дорог.
function prepareBar(view, copy, language) {
  const roads = view.stages[view.index]?.id === "roads";
  let files = "";
  if (view.total > 0 && roads)
    files = copy.prepare.dictionaries(view.done, view.total);
  else if (view.total > 0) files = copy.files(view.done, view.total);
  const bar = {};
  bar.label = prepareLabel(view, copy);
  // Без этапов (счёт, чтение, этапов нет) процент не показываем, даже если файлы известны.
  bar.percent = view.stages.length > 0 ? view.percent : null;
  if (Number.isFinite(view.eta)) bar.eta = etaWords(copy, { ms: view.eta });
  else bar.eta = "";
  const bytesText = view.bytes > 0 ? formatSize(view.bytes, language) : "";
  bar.detail = joinParts([files, bytesText]);
  /* Счёт файлов и имя последнего — в подсказку процента, без байтов (владелец 18.11.2026: «гигабайты убери»). */
  bar.files = files;
  bar.steps = prepareSteps(view);
  bar.sub = view.lastName;
  bar.warning = view.stalled ? copy.prepare.stalled(view.stalledSeconds) : "";
  return bar;
}

// Ход пересборки пакета поверх работы: своя ступень, доля — только у сборки файлов, иначе бегущая полоса; прежние проценты не показываются.
function dependentBar(job, language) {
  const fraction = dependentFraction(job.dependent);
  const label = trIn(language, dependentLabel(job.dependent));
  const bar = {};
  bar.label = label;
  bar.percent = fraction === null ? null : Math.round(fraction * 100);
  bar.eta = "";
  bar.detail = trIn(language, DEPENDENT_WAIT);
  bar.steps = [{ id: `rebuild-${job.dependent.set}`, label: dependentLabel(job.dependent), state: "active", fraction: fraction ?? 0, unmeasured: fraction === null }];
  bar.byteNote = "";
  bar.stageLine = trIn(language, dependentStageLine(job.dependent));
  return bar;
}

// Ход из шагов очереди: идущая работа без хода подготовки.
function stepsBar(job, plan, copy, env) {
  const { running, cancelling, line, language } = env;
  if (running && !cancelling && job.dependent) return dependentBar(job, language);
  const bar = {};
  bar.label = cancelling ? line : trIn(language, plan.step.label);
  if (plan.indeterminate) bar.percent = null;
  else bar.percent = Math.round(workshopInstallShare(job) * 100);
  bar.eta = running && !cancelling ? historyWords(job, copy, env) : "";
  bar.detail = running
    ? joinParts([cancelling ? "" : line, bytesNote(job, copy, language)])
    : "";
  bar.steps = plan.steps;
  bar.byteNote = bytesNote(job, copy, language);
  return bar;
}

// Пара «подсказка, подпись для экранного чтения» у крестика: оба говорят то, что кнопка делает сейчас.
function crossCaptions(copy, { running, queued, canStop, cancelling }) {
  const twice = (text) => [text, text];
  if (canStop) return twice(copy.work.cancelInstall);
  if (running)
    return twice(
      cancelling ? copy.work.cancellingLine : copy.work.cannotInterrupt,
    );
  return twice(queued ? copy.removeQueued : copy.dismiss);
}

function isOptimization(editor) {
  return String(editor || "")
    .toLowerCase()
    .includes("оптимиз");
}

const coverProps = (job, slot) => ({
  slotId: slot,
  projectId: job.coverProjectId || "",
  state: job.coverState || null,
});

const thumbCover = (job, slot) => <EditorCover {...coverProps(job, slot)} />;

const thumbPicture = (job, onBroken) => (
  <img
    className="download-thumb-image"
    alt=""
    draggable="false"
    src={job.coverImage}
    onError={() => onBroken(job.coverImage)}
  />
);

const thumbGlyph = (editor) => (
  <span className="download-thumb-glyph" aria-hidden="true">
    {isOptimization(editor) ? <Gauge /> : <Wrench />}
  </span>
);

// Плитка: обложка слота, иначе картинка вещи, иначе знак. Отказ запоминается за адресом картинки.
function WorkThumb({ job }) {
  const [failedImage, setFailedImage] = useState(null);
  const slot = job.coverSlotId;
  const content =
    slot && hasEditorCover(slot)
      ? thumbCover(job, slot)
      : job.coverImage && failedImage !== job.coverImage
        ? thumbPicture(job, setFailedImage)
        : thumbGlyph(job.editor);
  return <div className="download-thumb download-thumb-work">{content}</div>;
}

function ActionButton({ title, label, locked, onPress, children }) {
  return (
    <button
      type="button"
      aria-disabled={locked ? "true" : undefined}
      title={title}
      aria-label={label}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

/* ---------- этапы героя ---------- */

// Этапы идущей работы: шаги очереди с их словами или этапы подготовки пакета (слова — из `copy.prepare.stages`).
function heroItems(bar, copy, language) {
  return bar.steps.map((step, index) => {
    const state =
      step.state === "done"
        ? "done"
        : step.state === "active"
          ? "active"
          : "waiting";
    const named = step.label
      ? trIn(language, step.label)
      : copy.prepare.stages[step.id];
    const measured = !step.unmeasured;
    const share = Number.isFinite(step.fraction) ? step.fraction : 0;
    return {
      key: step.id ?? index,
      state,
      measured,
      fraction:
        state === "done" ? 1 : state === "active" && measured ? share : 0,
      pre: 0,
      weight: step.weight,
      label: named || bar.label,
      percent:
        state === "active" && measured && share > 0 && share < 1
          ? Math.round(share * 100)
          : null,
      /* Байтов под этапом нет: только проценты (владелец 18.11.2026). */
      sub: "",
    };
  });
}

// Шаги отказавшей работы: до остановки — готово, шаг отказа — красный, дальше не дошли.
function failedItems(plan, language) {
  const at = Math.max(
    0,
    plan.steps.findIndex((step) => step.state === "active"),
  );
  return plan.steps.map((step, index) => ({
    key: step.id,
    state: index < at ? "done" : index === at ? "bad" : "skip",
    measured: true,
    fraction: index < at ? 1 : 0,
    pre: 0,
    label: trIn(language, step.label),
    percent: null,
    sub: "",
  }));
}

/* ---------- одна работа ---------- */

export default function WorkshopInstallRow({
  job,
  now,
  heldBy = "",
  ahead = null,
  onRetry = noop,
  onDismiss = noop,
  onCancel = refuse,
  onNotice = noop,
  onOpenLogs,
  language = "ru",
  hero = false,
  index = 0,
  position = 1,
  total = 1,
  start = "",
}) {
  const copy = downloadsCopyFor(language);
  const rc = useMemo(() => ribbonCopyFor(language), [language]);
  const plan = describeWorkshopInstall(job);
  const hint = plan.step.hint;
  const id = job.id;

  const { running, done, failed, queued, cancelling } = statusFlags(job);

  const startAt = firstTruthy(job.startedAt, job.queuedAt, now);
  const motionKey = `${plan.step.id}|${plan.measured ?? ""}|${job.note || ""}`;
  const moving = useRecentMotion(motionKey, startAt, now);

  const line = statusLine(job, {
    copy,
    language,
    ahead,
    heldBy,
    now,
    hint,
    cancelling,
  });
  const env = {
    running,
    done,
    failed,
    cancelling,
    line,
    language,
    now,
    startAt,
    moving,
  };

  const canStop =
    running && !job.cancelling ? workshopInstallCancellable(job) : false;
  const [crossTitle, crossLabel] = crossCaptions(copy, {
    running,
    queued,
    canStop,
    cancelling,
  });
  const retryLabel = retryLabelOf(copy, job);

  const foreignBuild =
    failed && isForeignBuildFailure(job.errorDetail || job.error);
  const restorable = failed && canRestoreScatter(job);

  const restoreSaved = () => onRetry(id, { saved: restoreScatterTarget(job) });
  const retry = () => onRetry(id);
  const pressCross = () => {
    if (running) {
      if (job.cancelling) return;
      if (!canStop || !onCancel(id)) onNotice(copy.work.cannotInterruptLong);
      return;
    }
    onDismiss(id);
  };
  const choices = (
    <>
      {foreignBuild && (
        <ForeignBuildChoice language={language} onDecided={retry} />
      )}
      {restorable && <ForeignScatterChoice onRestore={restoreSaved} />}
    </>
  );
  const detailsProps = failureDetailsProps(job, language, onOpenLogs);

  if (hero) {
    return (
      <Hero
        model={heroModel({
          job,
          plan,
          copy,
          rc,
          language,
          env,
          flags: { running, failed, queued, cancelling },
          cancel: {
            label:
              canStop || !running
                ? crossLabelShort(copy, rc, {
                    running,
                    queued,
                    canStop,
                    cancelling,
                  })
                : rc.lockedCancel,
            ariaLabel: crossLabel,
            title: crossTitle,
            locked: running && !canStop,
            disabled: cancelling,
            onPress: pressCross,
          },
          position,
          total,
          retry,
          retryLabel,
          choices,
          detailsProps,
        })}
      />
    );
  }

  const kicker = joinParts([stateWord(job, copy), job.editor]);
  const cross = (
    <ActionButton
      title={crossTitle}
      label={crossLabel}
      locked={running && !canStop}
      onPress={pressCross}
    >
      <X />
    </ActionButton>
  );

  if (failed) {
    return (
      <article
        className="dl-row is-failed"
        data-row
        data-workshop-install={job.status}
      >
        <span className="dl-no is-bad" aria-hidden="true">
          <Warning weight="fill" />
        </span>
        <WorkThumb job={job} />
        <div className="dl-row-name">
          <h3>{job.title}</h3>
          <small className="is-bad">{line}</small>
        </div>
        <div className="download-actions">
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowClockwise aria-hidden="true" />}
            title={retryLabel}
            aria-label={retryLabel}
            onClick={retry}
          >
            {copy.retry}
          </Button>
          {cross}
        </div>
        <div className="dl-row-more">
          {choices}
          <FailureDetails {...detailsProps} />
        </div>
      </article>
    );
  }

  if (done) {
    return (
      <article className="dl-row" data-row data-workshop-install={job.status}>
        <span className="dl-check" aria-hidden="true">
          <Check weight="bold" />
        </span>
        <WorkThumb job={job} />
        <div className="dl-row-name">
          <h3>{job.title}</h3>
          <small>{joinParts([kicker ? `${kicker} · ${line}` : line, job.rpNote])}</small>
        </div>
        <div className="download-actions">{cross}</div>
      </article>
    );
  }

  return (
    <article className="dl-row" data-row data-workshop-install={job.status}>
      <span className="dl-no">{index}</span>
      <WorkThumb job={job} />
      <div className="dl-row-name">
        <h3>{job.title}</h3>
        <small>{job.editor || stateWord(job, copy)}</small>
        {/* «0 %» с постановки в очередь: число не появляется вдруг, когда работа начнётся. */}
        <small className="dl-row-pc" data-row-percent>
          {percentText(steadyPercent(percentKey(job), 0))}
        </small>
      </div>
      <span className="dl-row-eta" title={line}>
        {start || line}
        {start ? <span className="dl-sr">{line}</span> : null}
      </span>
      <div className="download-actions">{cross}</div>
    </article>
  );
}

// Короткая подпись кнопки героя: «Отменить», «Убрать из очереди», «Убрать из списка» — то, что кнопка делает сейчас.
function crossLabelShort(copy, rc, { running, queued, canStop }) {
  if (canStop || running) return rc.cancel;
  return queued ? copy.removeQueued : copy.dismiss;
}

/* ---------- модель героя работы ---------- */

function heroModel({
  job,
  plan,
  copy,
  language,
  env,
  flags,
  cancel,
  position,
  total,
  retry,
  retryLabel,
  choices,
  detailsProps,
}) {
  const { running, failed, queued, cancelling } = flags;
  const counter =
    total > 1 ? [{ text: copy.of(position, total), tone: "soft" }] : [];
  /* Раздел мастерской второй плашкой — если он не повторяет название работы (у «Мини-карты» они совпадают). */
  const editor =
    job.editor && job.editor !== job.title
      ? [{ text: job.editor, tone: "plain" }]
      : [];
  const base = {
    title: job.title,
    cover: workPhoto(job, language),
    cancel,
    sub: env.line,
  };
  if (failed) {
    return {
      ...base,
      mode: "fail",
      percent: lastPercent(percentKey(job)) || null,
      pills: [{ text: copy.work.failed, tone: "bad", dot: true }, ...editor],
      sub: job.editor && job.editor !== job.title ? job.editor : "",
      rail: { label: env.line, items: failedItems(plan, language) },
      failure: {
        Icon: Warning,
        title: copy.work.failed,
        text: env.line,
        detail: job.errorDetail || "",
        extra: choices,
        actions: (
          <>
            <Button
              variant="primary"
              size="sm"
              icon={<ArrowClockwise aria-hidden="true" />}
              title={retryLabel}
              aria-label={retryLabel}
              onClick={retry}
            >
              {retryLabel}
            </Button>
            <FailureDetails {...detailsProps} />
          </>
        ),
      },
    };
  }
  if (queued) {
    return {
      ...base,
      mode: "wait",
      percent: steadyPercent(percentKey(job), 0),
      pills: [
        { text: copy.work.queued, tone: "solid", dot: true },
        ...editor,
        ...counter,
      ],
      sub: job.editor && job.editor !== job.title ? job.editor : "",
      note: env.line,
      rail: {
        label: env.line,
        valueNow: 0,
        items: heroItems(stepsBar(job, plan, copy, env), copy, language),
      },
    };
  }
  const bar = barOf(job, plan, copy, env, running && !cancelling);
  const items = heroItems(bar, copy, language);
  const stepWord = items.some((item) => item.label === bar.label) ? "" : bar.label;
  return {
    ...base,
    mode: "run",
    /* Один процент под названием (`steady-percent.js`): без гигабайт, скорости и второй подписи «общий ход» (владелец 18.11.2026). */
    percent: bar.percent,
    /* Рядом с процентом — только остаток по записям прошлых работ; слово шага — строкой ниже, если его не называет сам этап под полосой. */
    percentNote: bar.eta,
    percentTitle: [bar.files, bar.sub].filter(Boolean).join(" · "),
    pills: [
      { text: stateWord(job, copy), tone: "solid", dot: true },
      ...editor,
      ...counter,
    ],
    sub: cancelling ? env.line : job.dependent ? joinParts([bar.stageLine, bar.detail]) : plan.step.hint || "",
    /* Слова про GTA 5 RP (`job.rpNote`) — отдельной строкой рядом с подписью этапа и после «Готово»: подпись этапа их не затирает. */
    ...(job.rpNote ? { note: job.rpNote } : {}),
    rail: { label: bar.label, valueNow: bar.percent ?? undefined, items },
    ...(stepWord ? { word: stepWord } : {}),
    /* «Нет движения N с» — янтарная строка с `role="status"` под процентом: человеку нужно знать, что идёт, а что встало («крутится и непонятно ничего»). */
    ...(bar.warning ? { warning: bar.warning } : {}),
  };
}

// Строка работы в очереди «Загрузок» помнит свой процент под этим ключом (`steady-percent.js`).
const percentKey = (job) => `${job.id}:${job.attempt}`;

/*
 * Процент работы: виден всегда и не откатывается (владелец 18.11.2026). На «Подготовке» число берётся из события хода — доля `fraction`
 * (растительность), иначе `done / total` (дороги); вода, текстуры и здания чисел не дают — тогда ровный ход по времени по записям прошлых работ
 * того же вида. Ход шагов очереди (запись в игру) число даёт сам.
 */
function workPercent(job, current, env, prepared) {
  const fromEvent = prepared ? preparePercent(job.progress) : null;
  const known = fromEvent ?? (Number.isFinite(current) ? current : null);
  const started = job.startedAt || env.now;
  const paced =
    known === null && job.status === "running"
      ? pacePercent(env.now - started, expectedRunMs(workshopRunKind(job)))
      : null;
  return steadyPercent(percentKey(job), known ?? paced);
}

// Ход подготовки пакета включается только у идущей работы без отмены; иначе — шаги очереди.
function barOf(job, plan, copy, env, live) {
  const view =
    live && job.progress
      ? prepareView(job.progress, job.progressTrail, env.now)
      : null;
  const bar = view
    ? prepareBar(view, copy, env.language)
    : stepsBar(job, plan, copy, env);
  /* Пересборка поверх: число — только настоящая доля сборки, без ровного хода по времени и без запомненных процентов прежней ступени. */
  if (!view && live && job.dependent) return bar;
  bar.percent = workPercent(job, bar.percent, env, Boolean(view));
  /* Полоса «Подготовки» идёт вместе с процентом (владелец: «чтобы как будто заполняешь»): у единственного этапа она и есть весь ход. */
  if (view && bar.steps.length <= 1)
    bar.steps = [{ ...(bar.steps[0] || { id: "prepare", state: "active" }), fraction: bar.percent / 100, unmeasured: false }];
  return bar;
}
