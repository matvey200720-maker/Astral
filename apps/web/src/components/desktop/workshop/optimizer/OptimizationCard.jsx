/*
 * Карточка раздела оптимизации.
 *
 * Плитка как у полки редакторов мастерской: кадр во всю ширину, имя и
 * строка поверх его низа. Кадр здесь — сравнение «до/после» с ползунком, а
 * в углу, где у редактора карандаш, — переключатель: включил — карточка
 * уходит в игру, выключил — снимается. Под плиткой — что сейчас с ней
 * (в игре, ставится, отказ), честная метка FPS и «Что входит» — окно с
 * составом карточки, у каждой части свой тумблер (`OptimizationPartsDialog`).
 *
 * `readOnly` — та же карточка в «Библиотеке» (ТЗ 10.10): показать, что стоит,
 * без тумблера на карточке и в окне «Что входит». Менять ходят в мастерскую
 * или в настройки графики.
 */

import { memo, useState } from "react";
import { CircleNotch, Lightning, Warning } from "../../../ui/icons.jsx";
import { localizedText } from "@modovik/optimizer";
import { optimizationCardShotFiles } from "@modovik/optimizer/cards.js";
import Button from "../../../ui/Button.jsx";
import Switch from "../../../ui/Switch.jsx";
import { useTr } from "../../../../locales/ui.js";
import OptimizationShots from "../../../../features/workshop/OptimizationShots.jsx";
import OptimizationPartsDialog from "./OptimizationPartsDialog.jsx";
import { optimizationCardView } from "./optimization-view.js";

/**
 * @param {{
 *   card: object,
 *   locale: string,
 *   copy: object,
 *   state: { on: boolean, partial: boolean, count: number, total: number },
 *   partOn: (part: { kind: string, id: string }) => boolean,
 *   pending: ""|"installing"|"removing"|"queued",
 *   failure: string,
 *   onRestoreScatter?: (() => void) | null,
 *   supported: boolean,
 *   onToggle: (card: object, on: boolean, parts?: object[]) => void,
 *   readOnly?: boolean,
 * }} props
 */
function OptimizationCard({
  card,
  locale,
  copy,
  state,
  partOn,
  pending,
  failure,
  onRestoreScatter = null,
  supported,
  onToggle,
  readOnly = false,
  /* «Редактировать» с оптимизации мода: окно «Что входит» — сразу открыто,
     слои мода помечены (`optimizer-focus.js`). */
  focus = null,
}) {
  const tr = useTr();
  const [open, setOpen] = useState(Boolean(focus?.open));
  const id = `optimization-${card.id}`;
  const { title, shot, fps, busy, status, tone, dataState } = optimizationCardView({
    card,
    locale,
    copy,
    state,
    pending,
    failure,
    supported,
    readOnly,
  });

  return (
    <article
      className="optimization-card"
      data-card={card.id}
      data-state={dataState}
      aria-labelledby={`${id}-title`}
      aria-busy={busy || undefined}
    >
      <div className="optimization-card-media">
        <OptimizationShots
          files={optimizationCardShotFiles(card.id)}
          title={title}
          caption={shot}
          copy={copy}
        />
        <span className="optimization-card-shade" aria-hidden="true" />
        <div className="optimization-card-copy">
          <h3 id={`${id}-title`}>{title}</h3>
          <p>{localizedText(card.summary, locale)}</p>
        </div>
        {!readOnly && (
        <Switch
          className="optimization-card-switch"
          checked={state.on}
          label={`${state.on ? copy.disable : copy.enable}: ${title}`}
          disabled={!supported || busy}
          onChange={(next) => onToggle(card, next)}
        />
        )}
      </div>
      <footer className="optimization-card-foot">
        <span
          className="optimization-card-status"
          data-tone={tone}
          role="status"
        >
          {busy ? (
            <CircleNotch className="optimization-card-spin" aria-hidden="true" />
          ) : tone === "error" ? (
            <Warning aria-hidden="true" />
          ) : null}
          <span>{status}</span>
        </span>
        {onRestoreScatter && !readOnly && !busy && (
          <Button
            className="optimization-card-restore"
            size="sm"
            variant="primary"
            onClick={onRestoreScatter}
          >
            {tr("Вернуть россыпь штатной")}
          </Button>
        )}
        {fps ? (
          <em className="optimization-card-fps" data-fps={card.fps}>
            <Lightning weight="fill" aria-hidden="true" />
            {fps}
          </em>
        ) : (
          <small className="optimization-card-nofps">{copy.noFps}</small>
        )}
        <button
          type="button"
          className="optimization-card-more"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          {copy.more}
        </button>
      </footer>
      {open && (
        <OptimizationPartsDialog
          card={card}
          title={title}
          locale={locale}
          copy={copy}
          shot={shot}
          status={status}
          partOn={partOn}
          busy={busy}
          supported={supported}
          onToggle={onToggle}
          readOnly={readOnly}
          focus={focus}
          onClose={() => setOpen(false)}
        />
      )}
    </article>
  );
}

export default memo(OptimizationCard);
