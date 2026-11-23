import { useState } from "react";
import Button from "../../../components/ui/Button.jsx";
import { Lock } from "../../../components/ui/icons.jsx";

/*
 * Герой «Загрузок» v2-A «Лента»: одна установка на всю ширину — обложка, название, процент под ним, четыре этапа.
 * Тот же герой показывает отказ (карточка с «Повторить»), итог сессии и пустую страницу.
 * Модель героя собирает `DownloadsPanel.jsx` (`hero-models.jsx`); здесь только разметка.
 *
 * Движение — `transform` и `opacity` (бег по активному этапу и ширина полосы через `scaleX`), и оно стоит на месте,
 * когда движения нет (`ribbon.css`).
 */

const NBSP = " ";

function Pill({ pill }) {
  return (
    <span className={`dl-pill is-${pill.tone || "plain"}`}>
      {pill.dot ? <i aria-hidden="true" /> : null}
      {pill.text}
    </span>
  );
}

function StageIcon({ state }) {
  if (state === "done") {
    return (
      <span className="dl-stage-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    );
  }
  if (state === "bad") {
    return (
      <span className="dl-stage-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </span>
    );
  }
  return (
    <span className="dl-stage-icon" aria-hidden="true">
      {state === "active" ? <i /> : null}
    </span>
  );
}

/* Полоса этапа: сплошная по `scaleX`; штрих слева — что уже лежало на диске, сплошная часть правее него. */
function StageBar({ stage }) {
  const pre = stage.pre || 0;
  const share =
    pre > 0 ? Math.max(0, (stage.fraction - pre) / (1 - pre)) : stage.fraction;
  return (
    <div className="dl-bar">
      {pre > 0 ? (
        <b className="dl-bar-pre" style={{ width: `${pre * 100}%` }} />
      ) : null}
      {stage.measured ? (
        <b
          className={pre > 0 ? "is-after" : undefined}
          style={{ "--v": share.toFixed(3), "--l": `${pre * 100}%` }}
        />
      ) : null}
    </div>
  );
}

export function StageRail({ rail }) {
  return (
    <div
      className="dl-stages"
      role="progressbar"
      aria-label={rail.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={rail.valueNow ?? undefined}
    >
      {rail.items.map((stage) => (
        <div
          className={`dl-stage is-${stage.state}${stage.measured ? "" : " is-unmeasured"}`}
          key={stage.key}
          style={stage.weight ? { flexGrow: stage.weight } : undefined}
        >
          <StageBar stage={stage} />
          <div className="dl-stage-label">
            <StageIcon state={stage.state} />
            <span title={stage.label}>{stage.label}</span>
          </div>
          {stage.sub ? (
            <div className="dl-stage-sub" title={stage.sub}>
              {stage.sub}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function FailureCard({ failure }) {
  const { Icon } = failure;
  return (
    <div className="dl-fcard" role="group" aria-label={failure.title}>
      <div className="dl-fcard-title">
        <Icon aria-hidden="true" />
        <span>{failure.title}</span>
      </div>
      <p title={failure.detail || undefined}>{failure.text}</p>
      {failure.extra}
      <div className="dl-fcard-actions">{failure.actions}</div>
    </div>
  );
}

function CancelButton({ cancel }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      className={cancel.locked ? "dl-hero-btn is-locked" : "dl-hero-btn"}
      icon={cancel.locked ? <Lock aria-hidden="true" /> : null}
      aria-disabled={cancel.locked || cancel.disabled ? "true" : undefined}
      title={cancel.title}
      aria-label={cancel.ariaLabel}
      onClick={cancel.onPress}
    >
      {cancel.label}
    </Button>
  );
}

export default function Hero({ model }) {
  const {
    mode,
    title,
    pills,
    cancel,
    sub,
    rail,
    percent,
    percentNote,
    percentTitle,
    word,
    warning,
    failure,
    actions,
    thumbs,
    note,
  } = model;
  /* Картинка, что не загрузилась, не оставляет дыры: герой становится тёмным без обложки. */
  const [broken, setBroken] = useState("");
  const cover = model.cover && broken !== model.cover ? model.cover : "";
  const classes = ["dl-hero", `is-${mode}`, cover ? "" : "is-bare"]
    .filter(Boolean)
    .join(" ");
  return (
    <article className={classes} data-hero={mode} aria-label={title}>
      {cover ? (
        <img
          className="dl-hero-bg"
          src={cover}
          alt=""
          draggable="false"
          onError={() => setBroken(cover)}
        />
      ) : null}
      <div className="dl-hero-in">
        <div className="dl-hero-top">
          {pills.map((pill) => (
            <Pill pill={pill} key={pill.text} />
          ))}
          <span className="dl-hero-cancel">
            {cancel ? <CancelButton cancel={cancel} /> : null}
          </span>
        </div>
        <h2 className="dl-hero-title">{title}</h2>
        {/* Один процент на любой вид установки: под названием, от очереди до «Готово» (`steady-percent.js`). */}
        {percent == null ? null : (
          <div className="dl-hero-pc" data-hero-percent title={percentTitle || undefined}>
            <b>{`${percent}${NBSP}%`}</b>
            {percentNote ? <span>{percentNote}</span> : null}
          </div>
        )}
        <div className="dl-hero-sub">{sub}</div>
        {note ? <div className="dl-hero-note">{note}</div> : null}
        {/* Слово шага отдельной строкой ниже процента, если этап под полосой его не называет («Безопасная отмена», «Подготовка установки»). */}
        {word ? <div className="dl-hero-word">{word}</div> : null}
        {warning ? (
          <div className="dl-hero-warn" role="status">
            {warning}
          </div>
        ) : null}
        <div className="dl-hero-bottom">
          {actions ? <div className="dl-hero-actions">{actions}</div> : null}
          {rail ? <StageRail rail={rail} /> : null}
          {failure ? <FailureCard failure={failure} /> : null}
          {thumbs?.length ? (
            <div className="dl-hero-thumbs" aria-hidden="true">
              {thumbs.map((src) => (
                <span key={src}>
                  <img src={src} alt="" draggable="false" />
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
