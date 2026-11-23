import { memo } from "react";
import {
  Check,
  CircleNotch,
  Clock,
  Lightning,
  Prohibit,
  Stack,
  Warning,
} from "../../../ui/icons.jsx";
import { localizedText } from "@modovik/optimizer";
import {
  optimizationCardParts,
  optimizationCardShotFiles,
} from "@modovik/optimizer/cards.js";
import Button from "../../../ui/Button.jsx";
import OptimizationShots, {
  optimizationShotUrl,
} from "../../../../features/workshop/OptimizationShots.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { optimizationCardView } from "./optimization-view.js";
import "./optimizer-frame.css";

/*
 * «Карточки» оптимизации — сцена «кино» (дизайн 15.11.2026, макет r6/workshop/optimization-a): большой кадр «до/после» выбранной
 * карточки, поверх — её имя, суть, метка FPS, состояние и два действия, внизу справа — плёнка из всех карточек.
 * Данные и действия прежние: состояние — то, что стоит в игре (`optimizationCardView`), «Включить в игру» — тот же переключатель очереди.
 */

/* Плёнка: одна плитка — кадр «после» карточки, имя, отметка «стоит» или точка «часть». */
function Film({ entries, pickedId, onPick, locale, label }) {
  return (
    <div className="opf-film" role="group" aria-label={label}>
      {entries.map(({ card, state }) => {
        const url = optimizationShotUrl(
          optimizationCardShotFiles(card.id).after,
        );
        const title = localizedText(card.title, locale);
        return (
          <button
            key={card.id}
            type="button"
            className={`opf-film-tile${card.id === pickedId ? " is-on" : ""}`}
            data-card={card.id}
            data-state={state.on ? "on" : state.partial ? "partial" : "off"}
            aria-pressed={card.id === pickedId}
            title={title}
            onClick={() => onPick(card.id)}
          >
            {url && <img src={url} alt="" loading="lazy" draggable={false} />}
            <span className="opf-film-name">{title}</span>
            {state.on ? (
              <span className="opf-film-mark is-on" aria-label={tr("В игре")}>
                <Check weight="bold" aria-hidden="true" />
              </span>
            ) : state.partial ? (
              <span className="opf-film-mark is-part" aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function OptimizationHero({
  entry,
  entries,
  index,
  locale,
  copy,
  supported,
  onToggle,
  onPick,
  onMore,
}) {
  useTr();
  const { card, state, pending, failure, restore } = entry;
  const { title, shot, fps, busy, status, tone } = optimizationCardView({
    card,
    locale,
    copy,
    state,
    pending,
    failure,
    supported,
  });
  const summary = localizedText(card.summary, locale);
  return (
    <section
      className="opf-hero"
      data-picked={card.id}
      data-state={state.on ? "on" : state.partial ? "partial" : "off"}
      aria-label={title}
    >
      <OptimizationShots
        key={card.id}
        files={optimizationCardShotFiles(card.id)}
        title={title}
        caption={shot}
        copy={copy}
      />
      <div className="opf-hero-shade" aria-hidden="true" />
      <div className="opf-hero-copy">
        <span className="opf-kicker">
          {tr("Оптимизация · карточка {n} из {total}")
            .replace("{n}", String(index + 1))
            .replace("{total}", String(entries.length))}
        </span>
        <h2>{title}</h2>
        <p>{summary}</p>
        <div className="opf-hero-meta">
          {fps ? (
            <em className="opf-fps" data-fps={card.fps}>
              <Lightning weight="fill" aria-hidden="true" />
              {fps}
            </em>
          ) : (
            <small className="opf-nofps">{copy.noFps}</small>
          )}
          <span className="opf-status" data-tone={tone} role="status">
            {busy ? (
              <CircleNotch
                className="optimization-card-spin"
                aria-hidden="true"
              />
            ) : tone === "error" ? (
              <Warning aria-hidden="true" />
            ) : null}
            {status}
          </span>
          {/* Отказ из-за чужой россыпи: прямо на карточке — «Вернуть россыпь штатной» (бета 15.10), той же работой с forceScatter. */}
          {restore && !busy && (
            <Button
              className="optimization-card-restore"
              size="sm"
              variant="primary"
              onClick={restore}
            >
              {tr("Вернуть россыпь штатной")}
            </Button>
          )}
        </div>
        <div className="opf-hero-actions">
          <Button
            variant="primary"
            role="switch"
            aria-checked={state.on}
            aria-label={`${state.on ? copy.disable : copy.enable}: ${title}`}
            icon={state.on ? <Prohibit /> : <Check weight="bold" />}
            disabled={!supported || busy}
            onClick={() => onToggle(card, !state.on)}
          >
            {state.on ? copy.disable : tr("Включить в игру")}
          </Button>
          <Button
            variant="secondary"
            icon={<Stack />}
            onClick={() => onMore(card.id)}
          >
            {`${copy.more} · ${optimizationCardParts(card).length}`}
          </Button>
        </div>
        <p className="opf-hint">
          <Clock aria-hidden="true" />
          {tr("В игру за 5–15 секунд, потом перезапустите GTA V")}
        </p>
      </div>
      <Film
        entries={entries}
        pickedId={card.id}
        onPick={onPick}
        locale={locale}
        label={copy.cards}
      />
    </section>
  );
}

export default memo(OptimizationHero);
