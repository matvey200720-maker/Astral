import { useMemo, useState } from "react";
import Dialog from "../../ui/Dialog.jsx";
import Button from "../../ui/Button.jsx";
import ChoiceRadioGroup from "../../ui/ChoiceRadioGroup.jsx";
import { CaretRight, HandbagSimple } from "../../ui/icons.jsx";
import {
  MODES,
  colourSummary,
  itemColours,
  pickColour,
  toMapping,
  withMode,
} from "../../../features/clothing/colour-mapping.js";
import { itemColourPictureUrl } from "../../../features/clothing/item-picture.js";
import { pluralWord } from "../../../plural.js";
import { tr, useTr } from "../../../locales/ui.js";
import ProjectPicture from "./ProjectPicture.jsx";

/*
 * «Какая раскраска будет в игре» (владелец, 25.10.2026; слова и порядок — 27.10.2026): нажал вещь с несколькими раскрасками — человек решает, как
 * раскраски заменёнки лягут на раскраски вещи. Вверху — «вещь → заменёнка» с числом раскрасок; шаг 1 — «одна модель на все раскраски» или «своя на
 * каждую раскраску»; шаг 2 — пары картинками: слева раскраска вещи, справа — что увидит. Нажал на пару — ниже выбираешь другую раскраску мода (в
 * «своей на каждую» занятая другой парой меняется с ней местами: чёрной — синяя, красной — зелёная). Внизу — итог одной строкой и «Готово»: окно
 * выбора вещи запоминает ответ, а установку начинает «Сделать заменёнку» уже там. Сопоставление — `colour-mapping.js`: в установщик уходит `mapping`.
 */

const colourWord = (count) =>
  `${count} ${pluralWord(count, [tr("раскраска"), tr("раскраски"), tr("раскрасок")])}`;

/* Знак способа: все цвета вещи сходятся в один / идут каждый к своему. Свои линии, не набор значков окна. */
function ModeGlyph({ each }) {
  const rows = [6, 14, 22, 30];
  return (
    <svg
      viewBox="0 0 48 36"
      width="48"
      height="36"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      {rows.map((y) => (
        <g key={y}>
          <circle cx="6" cy={y} r="2.4" fill="currentColor" stroke="none" />
          {each ? (
            <line x1="12" y1={y} x2="36" y2={y} />
          ) : (
            <path d={`M12 ${y} L34 18`} />
          )}
        </g>
      ))}
      {rows.map((y) =>
        each ? (
          <rect
            key={y}
            x="38"
            y={y - 2.4}
            width="5"
            height="4.8"
            rx="1.2"
            fill="currentColor"
            stroke="none"
          />
        ) : null,
      )}
      {!each && (
        <rect
          x="36"
          y="14"
          width="7"
          height="8"
          rx="1.6"
          fill="currentColor"
          stroke="none"
        />
      )}
    </svg>
  );
}

/* Образец цвета мода: его картинка, а нет — кружок образца. */
function ModColourPic({ colour }) {
  return (
    <span className="colour-map-pic">
      {colour.image ? (
        <img src={colour.image} alt="" loading="lazy" decoding="async" />
      ) : (
        <i style={colour.swatch ? { background: colour.swatch } : undefined} />
      )}
    </span>
  );
}

/* Цвет вещи сервера: картинка этого цвета у Desktop; нет — значок вещи. */
export function ItemColourPic({ item, index, majesticImages }) {
  useTr();
  const src = itemColourPictureUrl(item, index, majesticImages);
  const [lost, setLost] = useState(false);
  return (
    /* Картинки нет или она не загрузилась (22.11.2026, видео первого запуска 1.0.0): значок не молчит — подсказка словами. */
    <span className="colour-map-pic" title={!src || lost ? tr("Картинки этой расцветки нет") : undefined}>
      {src ? (
        <ProjectPicture
          src={src}
          fallback={<HandbagSimple aria-hidden="true" />}
          onLost={setLost}
        />
      ) : (
        <HandbagSimple aria-hidden="true" />
      )}
    </span>
  );
}

function SummaryText({ summary }) {
  useTr();
  if (summary.kind === "all")
    return tr("Все {count} {word} вещи станут раскраской «{name}»")
      .replace("{count}", summary.total)
      .replace(
        "{word}",
        pluralWord(summary.total, [
          tr("раскраска"),
          tr("раскраски"),
          tr("раскрасок"),
        ]),
      )
      .replace("{name}", summary.name);
  if (summary.kind === "rest")
    return tr(
      "{paired} из {total} раскрасок вещи получат свою раскраску заменёнки, остальные — «{name}»",
    )
      .replace("{paired}", summary.paired)
      .replace("{total}", summary.total)
      .replace("{name}", summary.name);
  return tr(
    "Заменятся все {count} {word} вещи, у каждой своя раскраска заменёнки",
  )
    .replace("{count}", summary.total)
    .replace(
      "{word}",
      pluralWord(summary.total, [
        tr("раскраска"),
        tr("раскраски"),
        tr("раскрасок"),
      ]),
    );
}

/** Итог одной строкой под выбором («Все 10 раскрасок вещи станут раскраской «…»»). */
export function ColourSummary({ state, colours }) {
  const names = useMemo(
    () =>
      Object.fromEntries(colours.map((colour) => [colour.letter, colour.name])),
    [colours],
  );
  return <SummaryText summary={colourSummary(state, colours, names)} />;
}

/** Первое состояние выбора для вещи сервера с `itemCount` цветами. */
export const initialColourState = (itemCount, colours) => {
  const mode = itemCount > 1 && colours.length > 1 ? MODES.EACH : MODES.ALL;
  return withMode(
    { mode, assignment: [], fallback: colours[0]?.letter || "a" },
    itemCount,
    colours,
    mode,
  );
};

/**
 * Само содержимое «Какая раскраска будет в игре»: способ (одна модель на все / своя на каждую) и пары картинками. Выбор — снаружи (`state`, `onState`): окно ниже держит его само,
 * а второй шаг «Сделать заменёнку» (путь «Витрина», 15.11.2026) — в состоянии окна установки. `heads: false` убирает верхнюю строку «вещь → заменёнка»: в шаге 2 слева и так стоит вещь.
 */
export function ColourMappingBody({
  modName,
  modCover = "",
  colours,
  item,
  itemName,
  majesticImages = null,
  state,
  onState,
  heads = true,
  rows = false,
}) {
  useTr();
  const pairs = useMemo(() => itemColours(item?.textures), [item?.textures]);
  /* Какая пара выбрана для смены цвета; «на всех» — любая: цвет один. */
  const [active, setActive] = useState(null);
  const byLetter = useMemo(
    () => new Map(colours.map((colour) => [colour.letter, colour])),
    [colours],
  );
  const picking = state.mode === MODES.ALL ? 0 : active;
  const current = picking === null ? null : state.assignment[picking];

  const setMode = (mode) => {
    onState(withMode(state, pairs.length, colours, mode));
    setActive(null);
  };
  const modes = [
    {
      value: MODES.ALL,
      media: <ModeGlyph each={false} />,
      title: tr("Одна модель на все раскраски"),
      description: tr("Какой бы раскраски ни была вещь на вас — в игре видна одна раскраска заменёнки"),
    },
    {
      value: MODES.EACH,
      media: <ModeGlyph each />,
      title: tr("Своя на каждую раскраску"),
      description: tr("У каждой раскраски вещи своя раскраска заменёнки: чёрной — синяя, красной — зелёная. Пары можно переставлять"),
    },
  ];
  /* Палитра мода под выбранной парой (или под единственной строкой «на все»). */
  const strip =
    picking !== null ? (
      <div className="colour-map-strip" role="group" aria-label={tr("Раскраска заменёнки")}>
        <div className="colour-map-options">
          {colours.map((colour) => (
            <button
              key={colour.letter}
              type="button"
              className={`colour-map-option${current === colour.letter ? " is-selected" : ""}`}
              aria-pressed={current === colour.letter}
              onClick={() => onState(pickColour(state, picking, colour.letter))}
              title={colour.name}
            >
              <ModColourPic colour={colour} />
              <span>{colour.name}</span>
            </button>
          ))}
        </div>
      </div>
    ) : null;
  /*
   * Макет «Витрина» (16.11.2026): два способа — карточками в ряд, ниже строки «расцветка вещи → раскраска заменёнки» (нажатая раскрывает палитру под собой); «одна модель на все» — одна строка:
   * стопка расцветок вещи → выбранная раскраска, палитра под ней.
   */
  if (rows) {
    const mod = byLetter.get(state.assignment[0]);
    return (
      <div className="colour-map-body is-rows">
        <ChoiceRadioGroup label={tr("Как раскрасить заменёнку")} value={state.mode} onChange={setMode} className="colour-map-modes" options={modes} />
        {state.mode === MODES.ALL ? (
          <div className="colour-map-list">
            <div className="colour-map-row is-all">
              <span className="colour-map-stack">
                {pairs.slice(0, 5).map((pair, index) => (
                  <ItemColourPic key={pair.letter} item={item} index={index} majesticImages={majesticImages} />
                ))}
              </span>
              <span className="colour-map-pair-arrow" aria-hidden="true">
                <CaretRight weight="bold" />
              </span>
              {mod ? <ModColourPic colour={mod} /> : <span className="colour-map-pic" />}
              <span className="colour-map-row-name">
                <small>{tr("Раскраска заменёнки")}</small>
                {mod?.name}
              </span>
            </div>
            {strip}
          </div>
        ) : (
          <div className="colour-map-list" role="group" aria-label={tr("Проверьте")}>
            {pairs.map((pair, index) => {
              const colour = byLetter.get(state.assignment[index]);
              const selected = active === index;
              return (
                <div key={pair.letter} className="colour-map-line">
                  <button
                    type="button"
                    className={`colour-map-row${selected ? " is-active" : ""}`}
                    aria-pressed={selected}
                    onClick={() => setActive(selected ? null : index)}
                    title={`${tr("Расцветка {n}").replace("{n}", index + 1)} → ${colour?.name || ""}`}
                  >
                    <ItemColourPic item={item} index={index} majesticImages={majesticImages} />
                    <span className="colour-map-row-name">{tr("Расцветка {n}").replace("{n}", index + 1)}</span>
                    <span className="colour-map-pair-arrow" aria-hidden="true">
                      <CaretRight weight="bold" />
                    </span>
                    {colour ? <ModColourPic colour={colour} /> : <span className="colour-map-pic" />}
                    <span className="colour-map-row-name">{colour?.name}</span>
                  </button>
                  {selected ? strip : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="colour-map-body">
      {heads && (
        <div className="colour-map-heads">
          <div className="colour-map-head">
            <ItemColourPic
              item={item}
              index={0}
              majesticImages={majesticImages}
            />
            <span>
              <small>{tr("Вещь — носите на сервере")}</small>
              <b>{itemName}</b>
              <em>{colourWord(pairs.length)}</em>
            </span>
          </div>
          <span className="colour-map-head-arrow" aria-hidden="true">
            <CaretRight weight="bold" />
          </span>
          <div className="colour-map-head">
            <span className="colour-map-pic">
              {modCover ? (
                <img src={modCover} alt="" />
              ) : (
                <HandbagSimple aria-hidden="true" />
              )}
            </span>
            <span>
              <small>{tr("Заменёнка — видите вместо неё")}</small>
              <b>{modName}</b>
              <em>{colourWord(colours.length)}</em>
            </span>
          </div>
        </div>
      )}

      <section
        className="colour-map-step"
        aria-label={tr("Как раскрасить заменёнку")}
      >
        <h4>
          <i>1</i>
          {tr("Как раскрасить заменёнку")}
        </h4>
        <ChoiceRadioGroup
          label={tr("Как раскрасить заменёнку")}
          value={state.mode}
          onChange={setMode}
          className="colour-map-modes"
          options={[
            {
              value: MODES.ALL,
              media: <ModeGlyph each={false} />,
              title: tr("Одна модель на все раскраски"),
              description: tr(
                "Какой бы раскраски ни была вещь на вас — в игре видна одна раскраска заменёнки",
              ),
            },
            {
              value: MODES.EACH,
              media: <ModeGlyph each />,
              title: tr("Своя на каждую раскраску"),
              description: tr(
                "У каждой раскраски вещи своя раскраска заменёнки: чёрной — синяя, красной — зелёная. Пары можно переставлять",
              ),
            },
          ]}
        />
      </section>

      <section className="colour-map-step" aria-label={tr("Проверьте")}>
        <h4>
          <i>2</i>
          {tr("Проверьте: слева раскраска вещи, справа — что увидите")}
          {state.mode === MODES.EACH && (
            <small>{tr("нажмите на пару, чтобы поменять")}</small>
          )}
        </h4>
        <div className="colour-map-pairs">
          {pairs.map((pair, index) => {
            const colour = byLetter.get(state.assignment[index]);
            const selected = state.mode === MODES.EACH && active === index;
            return (
              <button
                key={pair.letter}
                type="button"
                className={`colour-map-pair${selected ? " is-active" : ""}`}
                aria-pressed={state.mode === MODES.EACH ? selected : undefined}
                onClick={() =>
                  state.mode === MODES.EACH &&
                  setActive(selected ? null : index)
                }
                title={`${tr("Раскраска {n}").replace("{n}", index + 1)} → ${colour?.name || ""}`}
              >
                <span className="colour-map-pair-pics">
                  <ItemColourPic
                    item={item}
                    index={index}
                    majesticImages={majesticImages}
                  />
                  <span className="colour-map-pair-arrow" aria-hidden="true">
                    <CaretRight weight="bold" />
                  </span>
                  {colour ? (
                    <ModColourPic colour={colour} />
                  ) : (
                    <span className="colour-map-pic" />
                  )}
                </span>
                <span className="colour-map-pair-name">
                  <small>{tr("Раскраска {n}").replace("{n}", index + 1)}</small>
                  {colour?.name}
                </span>
              </button>
            );
          })}
        </div>
        {picking !== null && (
          <div
            className="colour-map-strip"
            role="group"
            aria-label={tr("Раскраска заменёнки")}
          >
            <p>
              {state.mode === MODES.ALL
                ? tr("Раскраска заменёнки на всех раскрасках вещи")
                : tr("Раскраска заменёнки для раскраски {n} вещи").replace(
                    "{n}",
                    picking + 1,
                  )}
            </p>
            <div className="colour-map-options">
              {colours.map((colour) => (
                <button
                  key={colour.letter}
                  type="button"
                  className={`colour-map-option${current === colour.letter ? " is-selected" : ""}`}
                  aria-pressed={current === colour.letter}
                  onClick={() =>
                    onState(pickColour(state, picking, colour.letter))
                  }
                  title={colour.name}
                >
                  <ModColourPic colour={colour} />
                  <span>{colour.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default function ColourMappingDialog({
  modName,
  modCover = "",
  colours,
  item,
  itemName,
  majesticImages = null,
  onCancel,
  onConfirm,
}) {
  useTr();
  const pairs = useMemo(() => itemColours(item?.textures), [item?.textures]);
  const [state, setState] = useState(() =>
    initialColourState(pairs.length, colours),
  );
  const confirm = () =>
    onConfirm({
      mapping: toMapping(state),
      /* Выбранная расцветка — запасная: её получат цвета вещи, которых нет в записи (в записи есть все). */
      variant: state.fallback,
    });

  return (
    <Dialog
      open
      onClose={onCancel}
      size="lg"
      /* Окно стоит поверх «Сделать заменёнку»: общий id заголовка у двух окон делал бы второе безымянным. */
      titleId="colour-map-dialog-title"
      className="colour-map-dialog"
      title={tr("Какая раскраска будет в игре")}
      description={tr(
        "Вы носите на сервере одну вещь, а в игре видна другая. Осталось решить, какая раскраска заменёнки встанет на какую раскраску вещи.",
      )}
      status={
        <span className="colour-map-summary" role="status">
          <ColourSummary state={state} colours={colours} />
        </span>
      }
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {tr("Отмена")}
          </Button>
          <Button variant="primary" onClick={confirm}>
            {tr("Готово")}
          </Button>
        </>
      }
    >
      <ColourMappingBody
        modName={modName}
        modCover={modCover}
        colours={colours}
        item={item}
        itemName={itemName}
        majesticImages={majesticImages}
        state={state}
        onState={setState}
      />
    </Dialog>
  );
}
