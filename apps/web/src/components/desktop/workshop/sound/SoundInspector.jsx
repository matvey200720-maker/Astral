import { Trash } from "../../../ui/icons.jsx";
import { soundRightsNotice } from "./sound-apply.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { soundTitle } from "./sound-copy.js";

/*
 * Панель «В игре» студии звука: что уехало в игру и что там стоит.
 *
 * Сверху — итог последнего «Применить» открытого банка одной строкой («В
 * игре: Выстрел, Хвост и эхо»), а подробности — хеши, длины, с чем вышел
 * конфликт — за «Подробнее»: это ответ на «почему», а не на «что». Ниже —
 * всё, что студия поставила в игру, со снятием в одно нажатие.
 *
 * Правка своего звука — панель инструмента «Свой звук», готовый набор из
 * папки — «Готовые наборы» (мастерская «как в Photoshop», 03.10.2026): в
 * этой панели они больше не живут. Чего здесь нет и раньше: «Раздел
 * «Оружие»» с тремя строками про бету — это плашка «Бета» у кнопки
 * «Применить», с тем же текстом в подсказке.
 */

/* Секунды — для выстрелов, минуты — для музыки. */
const clock = (seconds) =>
  seconds >= 60
    ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`
    : `${Number(seconds).toFixed(2)} c`;

function Outcome({ plan, describeStream }) {
  useTr();
  const names = [
    ...new Set(
      (plan.tracks?.length
        ? plan.tracks.map((track) => track.stream)
        : plan.streams
      )
        .map((hash) => soundTitle(describeStream(hash)))
        .filter(Boolean),
    ),
  ];
  return (
    <section className="ui-panel snd-section snd-outcome">
      <header>
        <h3>{plan.applied ? tr("Уехало в игру") : tr("Собираем для игры")}</h3>
      </header>
      <p className="snd-outcome-line">
        {plan.applied ? tr("В игре") : tr("Уедет")}: {names.join(", ") || "—"}
      </p>
      <details className="snd-outcome-details">
        <summary>{tr("Подробнее")}</summary>
        {plan.tracks?.length > 0 && (
          <ul className="snd-tracks">
            {plan.tracks.map((track) => (
              <li key={track.stream}>
                <span title={track.stream}>
                  {soundTitle(describeStream(track.stream)) || track.stream}
                </span>
                <small>
                  {track.originalSeconds != null
                    ? `${clock(track.originalSeconds)} → `
                    : ""}
                  {clock(track.seconds)}
                  {track.channels
                    ? ` · ${track.channels === 2 ? tr("стерео") : tr("{count} каналов").replace("{count}", track.channels)}`
                    : ""}
                  {track.fixedLength ? tr(" · длина песни сохранена") : ""}
                  {track.loopTrimmed ? tr(" · цикл подрезан") : ""}
                  {/* Петля игры (задача 6): по кругу — целиком или с места. */}
                  {track.loop
                    ? track.loopPoint === 0
                      ? tr(" · по кругу целиком")
                      : tr(" · по кругу со вступлением")
                    : ""}
                </small>
              </li>
            ))}
          </ul>
        )}
        {plan.replaceModIds?.length > 0 && (
          <small className="snd-hint snd-conflict">
            {tr("Заменит установленное: {mods}").replace("{mods}", plan.replaceModIds.join(", "))}
          </small>
        )}
      </details>
      <small className="snd-hint">{tr(plan.rightsNotice)}</small>
    </section>
  );
}

export default function SoundInspector({
  plan = null,
  describeStream = (stream) => stream,
  pendingCount = 0,
  works = [],
  busy = false,
  onRemoveWork,
}) {
  useTr();
  return (
    <>
      {plan ? (
        <Outcome plan={plan} describeStream={describeStream} />
      ) : (
        pendingCount > 0 && (
          /* Права подтверждаются нажатием «Применить», и сказать это надо до
             нажатия — рядом с тем, что уедет, а не после записи. */
          <small className="snd-hint snd-rights">{soundRightsNotice()}</small>
        )
      )}
      {!plan && !pendingCount && !works.length && (
        <small className="snd-hint">
          {tr("Своих звуков в игре пока нет: поставьте свой звук на слой, дорожку или банк и нажмите «Применить».")}
        </small>
      )}
      {works.length > 0 && (
        <section className="ui-panel snd-section">
          <header>
            <h3>{tr("Установлено")} · {works.length}</h3>
          </header>
          <ul className="snd-works">
            {works.map((work) => (
              <li key={work.modId}>
                {/* Имя банка, а не код работы: список из строк вида
                    `local-sound-lmg-combat-9f2c…` не отвечает на вопрос,
                    ради которого его открывают, — «что я поставил». */}
                <span title={work.modId}>{work.title || work.modId}</span>
                <button
                  type="button"
                  aria-label={tr("Снять {title}").replace("{title}", work.title || work.modId)}
                  title={tr("Убрать из игры")}
                  disabled={busy}
                  onClick={() => onRemoveWork(work)}
                >
                  <Trash />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
