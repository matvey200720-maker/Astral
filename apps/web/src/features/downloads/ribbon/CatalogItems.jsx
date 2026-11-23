import { memo } from "react";
import Button from "../../../components/ui/Button.jsx";
import {
  ArrowClockwise,
  GameController,
  GearSix,
  HardDrives,
  Package,
  Trash,
  Warning,
  WifiSlash,
  X,
} from "../../../components/ui/icons.jsx";
import { formatSize } from "../../../catalog-utils.js";
import { trIn } from "../../../locales/ui.js";
import { failureWords } from "../../../utils/installFailure.js";
import FailureDetails from "../FailureDetails.jsx";
import { newestWinsLine } from "../newest-wins.js";
import ForeignBuildChoice, {
  foreignFollowerNote,
  isForeignBuildFailure,
} from "../ForeignBuildChoice.jsx";
import {
  readQueueProgress,
  readQueueStart,
  useQueueProgress,
  withLiveProgress,
} from "../live-progress.js";
import {
  catalogMetrics,
  clampPercent,
  timing,
  metaLine,
  operationKey,
  phaseWord,
  sizeOfRow,
} from "./catalog-metrics.js";
import Hero from "./Hero.jsx";
import { catalogHeroPhoto, catalogRowPhoto } from "./row-photo.js";
import { lastPercent, steadyPercent } from "./steady-percent.js";
import {
  failStageIndex,
  failedStages,
  installStages,
  STAGE_COUNT,
} from "./ribbon-model.js";

/*
 * Очередь каталога в «Ленте»: герой идущей установки и отказа, строки «Дальше в очереди» (ждущие и неудавшиеся).
 * Логика строки — та же, что была в панели «В процессе»: ход мимо оболочки (`live-progress.js`), слова и остаток —
 * `catalog-metrics.js`, отказ — `failureWords`.
 */

const THUMB_GLYPH = new Map([
  ["install", Package],
  ["remove", Trash],
  ["reset", GearSix],
]);

/* Докачка: с этой доли скачивания строка началась — часть файлов уже лежала на диске. */
const RESUME_MIN = 0.05;

const FAIL_ICONS = new Map([
  ["game-running", GameController],
  ["no-space", HardDrives],
  ["network", WifiSlash],
]);

const editionKey = (game) => String(game?.edition || "").toLowerCase();

/** Обложка мода для плитки списка: картинка каталога, а у системных операций — знак. */
export function Thumb({ row }) {
  const picture = catalogRowPhoto(row);
  if (picture) {
    return (
      <div
        className="download-thumb"
        style={{ backgroundImage: `url("${picture}")` }}
      />
    );
  }
  const Glyph = THUMB_GLYPH.get(operationKey(row.operation));
  return (
    <div className="download-thumb download-thumb-work" aria-hidden="true">
      <span className="download-thumb-glyph">
        <Glyph />
      </span>
    </div>
  );
}

function gameLabel(rc, game) {
  return rc.inGame[editionKey(game)] || "";
}

function counterPill(copy, position, total) {
  return total > 1 ? [{ text: copy.of(position, total), tone: "soft" }] : [];
}

/* ---------- герой: идущая установка ---------- */

/* Подписи под этапами без байтов и файлов (владелец 18.11.2026: «гигабайты убери, оставь просто проценты»): остаётся только слово о записи в игру. */
function stageSubs({ stages, rc, locked }) {
  const [, , write] = stages;
  return ["", "", write.state === "active" && locked ? rc.stageLocked : ""];
}

function installRail({ stages, labels, subs }) {
  return {
    label: labels.overall,
    items: stages.map((stage, index) => ({
      ...stage,
      key: `stage-${index}`,
      label:
        stage.state === "active" ? labels.active[index] : labels.done[index],
      percent:
        stage.state === "active" && stage.measured
          ? Math.round(stage.fraction * 100)
          : null,
      sub: subs[index],
    })),
  };
}

function cancelOf({ row, copy, rc, locked, onCancel, onNotice }) {
  const notice = row.cancelling ? copy.cancelRestoring : copy.cannotCancelNow;
  const caption = locked ? notice : copy.cancelActive;
  return {
    label: locked ? rc.lockedCancel : rc.cancel,
    ariaLabel: caption,
    title: caption,
    locked,
    onPress: locked ? () => onNotice(notice) : () => onCancel?.(row.queueId),
  };
}

/* Слова под названием героя: что сказал главный процесс и что заменено. */
const noteOf = (...parts) => parts.filter(Boolean).join(" · ");

function catalogHeroModel(props) {
  const { row, copy, rc, language, now, position, total, game, pre } = props;
  const percent = clampPercent(row.progress);
  const op = operationKey(row.operation);
  const locked = row.cancellable === false;
  const word = phaseWord(copy, row, percent);
  const where = gameLabel(rc, game);
  const resumed = pre > 0;
  /* Слова рядом с процентом, одной строкой: остаток по скорости; скорости, байтов и файлов нет. */
  /* «Считаю…» — не слово об установке, а про остаток: пока он не известен, рядом с процентом ничего нет. */
  const clock = timing(copy, row, language, now);
  const eta = clock.eta === copy.eta.counting ? "" : clock.eta;
  const note = noteOf(row.notice?.text ? trIn(language, row.notice.text) : "", newestWinsLine(row, language));
  const model = {
    mode: "run",
    title: row.name,
    cover: catalogHeroPhoto(row),
    /* Один процент под названием: не пропадает и не откатывается (`steady-percent.js`). */
    percent: steadyPercent(row.queueId, percent),
    cancel: cancelOf({ ...props, locked }),
    /* Слово о паре «редукс + мод каталога» (главный процесс шлёт его до первого байта; словарь — на шесть языков) и что заменено («новый мод старше», 18.11.2026). */
    ...(note ? { note } : {}),
    sub: [
      metaLine(row, language, 0),
      op === "install" ? where : "",
      resumed ? rc.onDisk(Math.round(pre * 100)) : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
  if (op !== "install") {
    return {
      ...model,
      percentNote: eta,
      pills: [
        { text: copy.kicker[op], tone: "solid", dot: true },
        ...counterPill(copy, position, total),
      ],
      rail: {
        label: word,
        valueNow: Math.round(percent),
        items: [
          {
            key: "op",
            label: word,
            state: "active",
            fraction: percent / 100,
            measured: true,
            pre: 0,
            percent: Math.round(percent),
            sub: "",
          },
        ],
      },
    };
  }
  const stages = installStages({
    phase: row.phase,
    percent,
    fraction: row.fraction,
    pre,
    pace: row.pace,
  });
  const current = stages.findIndex((stage) => stage.state === "active");
  const subs = stageSubs({ stages, rc, locked });
  const labels = { overall: word, active: rc.stagesActive, done: rc.stages };
  /* Слово шага («Безопасная отмена», «Подготовка установки») — отдельной строкой ниже, если его не называет сам этап под полосой; рядом с процентом — только остаток. */
  const said = [...labels.active, ...labels.done].includes(word) ? "" : word;
  return {
    ...model,
    percentNote: eta,
    ...(said ? { word: said } : {}),
    pills: [
      {
        text: resumed && current === 0 ? rc.resumeKicker : copy.kicker.install,
        tone: "solid",
        dot: true,
      },
      {
        text:
          resumed && current === 0
            ? rc.resumeNote
            : current < STAGE_COUNT - 1
              ? rc.gameUntouched
              : rc.writing,
        tone: "plain",
      },
      ...counterPill(copy, position, total),
    ],
    rail: {
      ...installRail({ stages, labels, subs }),
      valueNow: Math.round(percent),
    },
  };
}

/** Герой идущей строки каталога. Ход берёт сам из склада: перерисовывается он один, а не вся страница. */
export function CatalogHero({ row: queued, ...rest }) {
  const live = useQueueProgress(queued.queueId);
  const row = withLiveProgress(queued, live);
  const first = readQueueStart(row.queueId);
  const pre =
    row.operation === "install" && first !== null && first >= RESUME_MIN
      ? first
      : 0;
  return <Hero model={catalogHeroModel({ ...rest, row, pre })} />;
}

/* ---------- герой: строка ещё не началась (ждёт мастерскую или своей очереди) ---------- */

export function CatalogWaitHero({
  row,
  copy,
  rc,
  language,
  caption,
  position,
  total,
  game,
  onCancel,
}) {
  const op = operationKey(row.operation);
  const stages = installStages({ phase: "", percent: 0, fraction: 0 }).map(
    (stage, index) => ({
      ...stage,
      state: "waiting",
      key: `stage-${index}`,
      label: rc.stages[index],
      percent: null,
      sub: "",
    }),
  );
  const model = {
    mode: "wait",
    title: row.name,
    cover: catalogHeroPhoto(row),
    percent: steadyPercent(row.queueId, clampPercent(row.progress)),
    pills: [
      { text: copy.kicker.waiting, tone: "solid", dot: true },
      ...counterPill(copy, position, total),
    ],
    cancel: {
      label: copy.removeQueued,
      ariaLabel: copy.removeQueued,
      title: copy.removeQueued,
      onPress: () => onCancel?.(row.queueId),
    },
    sub: [
      metaLine(row, language, sizeOfRow(row)),
      op === "install" ? gameLabel(rc, game) : "",
    ]
      .filter(Boolean)
      .join(" · "),
    note: noteOf(caption, newestWinsLine(row, language)),
    rail:
      op === "install" ? { label: caption, valueNow: 0, items: stages } : null,
  };
  return <Hero model={model} />;
}

/* ---------- отказ ---------- */

/* «нужно 1,3 ГБ, свободно 0,6 ГБ»: числа берутся из текста движка («требуется N байт, доступно M байт»), своих не выдумывается. */
function spaceNote(detail, rc, language) {
  const found = /требуется\s+(\d+)\s+байт[^\d]+доступно\s+(\d+)\s+байт/i.exec(
    String(detail || ""),
  );
  if (!found) return "";
  return rc.needFree(
    formatSize(Number(found[1]), language),
    formatSize(Number(found[2]), language),
  );
}

/* `hold` — общий вопрос сборки (`foreignHoldOf`): у части, которая не отвечает сама, вместо совета «выбери ниже» — слово, где отвечать. */
function failureView(row, copy, language, onOpenLogs, hold = null) {
  const failed = row.failed;
  const follower = Boolean(hold) && !hold.lead;
  const said = failureWords(failed, language);
  const words = follower ? { ...said, advice: foreignFollowerNote(language) } : said;
  const engineText =
    failed.detail && failed.detail !== words.reason ? failed.detail : "";
  return {
    words,
    engineText,
    foreignBuild: isForeignBuildFailure(failed.detail) && !follower,
    detailsProps: {
      detail: engineText,
      kind: failed.kind,
      title: row.name,
      language,
      onOpenLogs,
    },
    dismissAria: copy.dismissFor(row.name),
  };
}

/* Пак звука, который не помещается и один (`sound-pack-slot-alone`): повтор ничего не изменит, поэтому не главное действие карточки. */
const NO_POINT_IN_RETRY = "sound-pack-slot-alone";

function RetryButton({ copy, row, onRetry, tone = "solid" }) {
  const quiet = tone !== "solid" || row?.failed?.kind === NO_POINT_IN_RETRY;
  return (
    <Button
      variant={quiet ? "secondary" : "primary"}
      size="sm"
      icon={<ArrowClockwise aria-hidden="true" />}
      title={copy.retry}
      aria-label={copy.retryFor(row.name)}
      onClick={() => onRetry(row.queueId)}
    >
      {copy.retry}
    </Button>
  );
}

/** Герой остановившейся установки: этапы показывают, где остановились; слова — приложения (`failureWords`). */
export function CatalogFailedHero({
  row,
  copy,
  rc,
  language,
  game,
  onRetry,
  onCancel,
  onOpenLogs,
  hold = null,
}) {
  const failed = row.failed;
  const op = operationKey(row.operation);
  const view = failureView(row, copy, language, onOpenLogs, hold);
  const last = readQueueProgress(row.queueId);
  const pre =
    failed.kind === "network" && last && last.fraction > 0
      ? Math.min(1, last.fraction)
      : 0;
  const index = failStageIndex(failed.kind, row.phase);
  const stages = failedStages(index, pre);
  const metrics = catalogMetrics(row, 0);
  const total =
    metrics.totalBytes > 0 ? formatSize(metrics.totalBytes, language) : "";
  const subs = stages.map((stage, at) => {
    if (stage.state === "bad") return rc.stageStopped;
    if (at === 0 && stage.state === "done") return total;
    if (at === 1 && stage.state === "done" && metrics.filesKnown)
      return rc.fileCount(metrics.totalFiles);
    return "";
  });
  if (pre > 0 && stages[0].state === "bad")
    subs[0] = rc.onDisk(Math.round(pre * 100));
  const Icon = FAIL_ICONS.get(failed.kind) || Warning;
  const space =
    failed.kind === "no-space" ? spaceNote(failed.detail, rc, language) : "";
  const model = {
    mode: "fail",
    title: row.name,
    cover: catalogHeroPhoto(row),
    /* Остановившаяся установка называет, докуда дошла: число не пропадает и здесь. */
    percent: lastPercent(row.queueId) || null,
    pills: [
      {
        text:
          failed.kind === "network" ? rc.connectionLost : copy.failedKicker[op],
        tone: "bad",
        dot: true,
      },
      { text: rc.nothingWritten, tone: "plain" },
    ],
    cancel: {
      label: copy.dismiss,
      ariaLabel: view.dismissAria,
      title: copy.dismiss,
      onPress: () => onCancel?.(row.queueId),
    },
    sub: [
      metaLine(row, language, metrics.totalBytes),
      op === "install" ? gameLabel(rc, game) : "",
      space,
    ]
      .filter(Boolean)
      .join(" · "),
    rail:
      op === "install"
        ? {
            label: view.words.reason,
            items: stages.map((stage, at) => ({
              ...stage,
              key: `stage-${at}`,
              label:
                stage.state === "done"
                  ? rc.stages[at]
                  : stage.state === "bad"
                    ? rc.stagesActive[at]
                    : rc.stages[at],
              percent: null,
              sub: subs[at],
            })),
          }
        : null,
    failure: {
      Icon,
      title: view.words.reason,
      text: view.words.advice,
      detail: failed.detail,
      extra: view.foreignBuild ? (
        <ForeignBuildChoice
          language={language}
          conflicts={hold?.conflicts}
          targetId={hold?.targetId}
          onDecided={() => onRetry(row.queueId)}
        />
      ) : null,
      actions: (
        <>
          <RetryButton copy={copy} row={row} onRetry={onRetry} />
          <FailureDetails {...view.detailsProps} />
        </>
      ),
    },
  };
  return <Hero model={model} />;
}

/* ---------- строки «Дальше в очереди» ---------- */

function RoundButton({ title, label, locked, onPress, children }) {
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

/** Ручка перестановки: шесть точек в два столбика, как на снимке владельца (16.11.2026). */
function GripDots() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="currentColor">
        <circle cx="9" cy="5.5" r="1.7" />
        <circle cx="15" cy="5.5" r="1.7" />
        <circle cx="9" cy="12" r="1.7" />
        <circle cx="15" cy="12" r="1.7" />
        <circle cx="9" cy="18.5" r="1.7" />
        <circle cx="15" cy="18.5" r="1.7" />
      </g>
    </svg>
  );
}

/**
 * Ждущая строка каталога (владелец, 16.11.2026): слева ручка из шести точек, превью, название жирным, под ним «тип · размер», справа тихий «×», что снимает с очереди.
 * Ручка переставляет строку (`useSortableRows.js`): мышью и клавишами ↑ и ↓. «Старт ≈ N» у строки больше нет; чего она ждёт — в подсказке и для чтеца экрана.
 * `grip` — свойства ручки от хука; `lifted` и `offset` — строку сейчас тянут и на сколько она сдвинута за указателем.
 */
export const WaitingRow = memo(function WaitingRow({
  row,
  copy,
  language,
  caption,
  gripLabel,
  grip = null,
  lifted = false,
  offset = 0,
  onCancel,
}) {
  const meta = metaLine(row, language, sizeOfRow(row));
  const replaces = newestWinsLine(row, language);
  /* Процент под названием от постановки в очередь: «0 %», пока строка ждёт (`steady-percent.js`). */
  const percent = steadyPercent(row.queueId, clampPercent(row.progress));
  return (
    <article
      className={lifted ? "dl-row is-lifted" : "dl-row"}
      data-row
      data-state="waiting"
      data-sort-id={row.queueId}
      title={caption || undefined}
      style={lifted ? { transform: `translateY(${offset}px)` } : undefined}
    >
      {grip ? (
        <button
          type="button"
          className="dl-grip"
          aria-label={gripLabel}
          title={gripLabel}
          {...grip}
        >
          <GripDots />
        </button>
      ) : (
        <span className="dl-grip-slot" aria-hidden="true" />
      )}
      <Thumb row={row} />
      <div className="dl-row-name">
        <h3 data-audit-ignore="caps">{row.name}</h3>
        {meta ? <small>{meta}</small> : null}
        <small className="dl-row-pc" data-row-percent>{`${percent}\u00a0%`}</small>
        {replaces ? <small className="dl-row-replaces" title={replaces}>{replaces}</small> : null}
        {caption ? <span className="dl-sr">{caption}</span> : null}
      </div>
      <div className="download-actions">
        <RoundButton
          title={copy.removeQueued}
          label={copy.removeQueued}
          onPress={() => onCancel?.(row.queueId)}
        >
          <X />
        </RoundButton>
      </div>
    </article>
  );
});

/** Неудавшаяся строка в списке, когда рядом идёт другая установка: причина, что делать, «Повторить» и подробности. */
export const FailedRow = memo(function FailedRow({
  row,
  copy,
  language,
  onCancel,
  onRetry,
  onOpenLogs,
  hold = null,
}) {
  const view = failureView(row, copy, language, onOpenLogs, hold);
  const retry = () => onRetry(row.queueId);
  return (
    <article className="dl-row is-failed" data-row data-queue-failed="true">
      <span className="dl-no is-bad" aria-hidden="true">
        <Warning weight="fill" />
      </span>
      <Thumb row={row} />
      <div className="dl-row-name">
        <h3>{row.name}</h3>
        <small className="is-bad" title={row.failed.detail}>
          {view.words.reason}
        </small>
      </div>
      <div className="download-actions">
        <RetryButton copy={copy} row={row} onRetry={onRetry} tone="ghost" />
        <RoundButton
          title={copy.dismiss}
          label={view.dismissAria}
          onPress={() => onCancel?.(row.queueId)}
        >
          <X />
        </RoundButton>
      </div>
      <div className="dl-row-more">
        <p>{view.words.advice}</p>
        {view.foreignBuild ? (
          <ForeignBuildChoice
            language={language}
            conflicts={hold?.conflicts}
            targetId={hold?.targetId}
            onDecided={retry}
          />
        ) : null}
        <FailureDetails {...view.detailsProps} />
      </div>
    </article>
  );
});
