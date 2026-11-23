/*
 * Колонка правок «Интерьеров Majestic RP» — казино (Хелпер 7, 25.10.2026): «Покрытия» и «Подсветка».
 *
 * «Покрытия» — 27 листов стен, пола, потолка, обивки и металла: у взятого листа (щелчком по списку или нажатием колеса по залу)
 * режим «Как в игре / Перекрасить / Залить» и цвет; ниже — поиск и список с образцом цвета. «Подсветка» — пять светящихся листов
 * разом: «Как в игре / Свой цвет / Выключена». Правка — `casino.coverings[лист]` и `casino.glow` (`majestic-casino.js`): кадр и
 * установка читают её одним расчётом. Подписи листов — константы описи, на языке окна их показывают здесь (`tr`).
 *
 * Абзацев нет (ТЗ 29.10.2026, вечер: образец — страница вещи «Мастерской арены»): как ляжет вид — по «?» у заголовка, список покрытий —
 * строками группы (`ListGroup`), «Сбросить правки» и «Как в игре» — строкой внизу (`ActionRows`), и только когда есть что сбрасывать.
 */

import { useState } from "react";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import Button from "../../../components/ui/Button.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import ListGroup, { ListSwatch } from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import SectionHeading from "../section-help.jsx";
import { CASINO_COVERINGS, CASINO_GLOW_SHEETS, CASINO_SWATCHES } from "./majestic-interiors-data.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Цвет, с которого начинается правка покрытия, если своего ещё не было. */
const FILL_COLOUR = "#8a1c2b";

const COVERING_MODES = ["standard", "tint", "fill"];

const fill = (text, ...values) => values.reduce((out, value, index) => out.replace(`{${index}}`, String(value)), text);

/** Образец цвета в строке списка: цвет правки или штрих «как в игре». */
function Chip({ colour = "", large = false }) {
  const className = `majestic-chip${large ? " is-large" : ""}${colour ? "" : " is-stock"}`;
  return <span className={className} style={colour ? { background: colour } : undefined} aria-hidden="true" />;
}

/** Строка состояния покрытия в списке: как в игре, перекрашено или залито — с цветом. */
function coveringCaption(look) {
  if (!look) return tr("Как в игре");
  return `${look.mode === "fill" ? tr("Залито") : tr("Перекрашено")} · ${look.colour}`;
}

function modeLabel(mode) {
  if (mode === "tint") return tr("Перекрасить");
  if (mode === "fill") return tr("Залить");
  if (mode === "colour") return tr("Свой цвет");
  if (mode === "off") return tr("Выключена");
  return tr("Как в игре");
}

/* ------------------------------------------------------------------ *
 * Покрытия
 * ------------------------------------------------------------------ */

function CoveringsTool({ casino, selected, onSelect, onCovering, onCoveringsReset }) {
  useTr();
  const [query, setQuery] = useState("");
  const coverings = casino.coverings;
  const edited = Object.keys(coverings).length;
  const item = selected ? CASINO_COVERINGS.find((entry) => entry.tex === selected) || null : null;
  const look = item ? coverings[item.tex] || null : null;
  const mode = look?.mode || "standard";

  /* Подписи — на языке окна: список короткий, считается заново при каждой перерисовке. */
  const text = query.trim().toLowerCase();
  const rows = CASINO_COVERINGS.filter((entry) => !text || tr(entry.label).toLowerCase().includes(text) || entry.tex.includes(text));

  const onMode = (value) => {
    if (!item) return;
    if (value === "standard") onCovering(item.tex, null, `${tr(item.label)}: ${modeLabel(value)}`);
    else onCovering(item.tex, { mode: value, colour: look?.colour || FILL_COLOUR }, `${tr(item.label)}: ${modeLabel(value)}`);
  };

  return (
    <>
      {item && (
        <section className="ui-panel fx-section recolor-section majestic-selected" aria-label={tr("Взятое покрытие")} data-majestic-section="covering">
          <header className="fx-section-head">
            <h3 className="majestic-name">
              <Chip colour={look?.colour} large />
              <span>{tr(item.label)}</span>
            </h3>
            <Button size="sm" variant="ghost" onClick={() => onSelect("")}>
              {tr("Снять выбор")}
            </Button>
          </header>
          {/* Как ляжет вид и какой это лист — по «?», а не абзацами под органами. */}
          <ListGroup
            plain
            title={tr("Вид покрытия")}
            help={[
              mode === "fill"
                ? tr("Покрытие станет ровным цветом: узор и швы пропадут. Мелкие плашки красятся только так.")
                : mode === "tint"
                  ? tr("Цвет ложится тоном по светотени листа: узор и швы остаются, меняется оттенок.")
                  : tr("Покрытие такое же, как в самой игре."),
              fill(tr("Лист {0}×{1} пикселей. Покрытие лежит на всех своих местах во всех залах."), item.width, item.height),
            ]}
          >
            {/* Вид покрытия и подсветки — строками (п. 13 `design-qa.md`): по-французски три варианта сегментом не вставали в строку.
                «Как в игре» — откат, строкой внизу, пока покрытие своё (разбор 30.10.2026). */}
            {/* Цвет покрытия — тем же органом, что «Свой цвет» везде (п. 16 `design-qa.md`): сегмент «Как в игре | Перекрасить | Залить», цвет под ним. */}
            <SegmentedControl label={tr("Вид покрытия")} size="sm" options={COVERING_MODES.map((value) => ({ value, label: modeLabel(value) }))} value={mode} onChange={onMode} />
            {mode !== "standard" && (
              <ColorField
                label={tr("Цвет покрытия")}
                value={look.colour}
                swatches={CASINO_SWATCHES}
                editable
                onChange={(colour) => onCovering(item.tex, { mode, colour }, `${tr(item.label)}: ${tr("цвет")}`)}
              />
            )}
          </ListGroup>
        </section>
      )}
      <section className="ui-panel fx-section recolor-section" aria-label={tr("Покрытия")} data-majestic-section="coverings">
        {/* Имени у заголовка нет: оно повторило бы имя панели «Покрытия» (п. 8 разбора 30.10.2026) — остаётся «?». */}
        <SectionHeading
          title=""
          help={[
            tr("Каждое покрытие — один лист казино, он лежит на всех своих местах. Выберите покрытие в списке или нажмите колесом по залу."),
            fill(tr("Покрытий: {0} · изменено: {1}"), CASINO_COVERINGS.length, edited),
          ]}
        />
        {/* Поиск — полем во всю ширину без подписи над ним; что ищет — словом в поле и для читалки. */}
        <TextField label="" aria-label={tr("Найти покрытие")} value={query} placeholder={tr("Найти покрытие")} onChange={setQuery} />
        {rows.length ? (
          <ListGroup label={tr("Покрытия")}>
            {rows.map((entry) => (
              <NavRow
                key={entry.tex}
                className={entry.tex === selected ? "is-selected" : ""}
                aria-pressed={entry.tex === selected}
                title={tr(entry.label)}
                /* Подпись и кружок цвета — только у изменённых: «Как в игре» у всех двадцати семи ничего не говорит. */
                caption={coverings[entry.tex] ? coveringCaption(coverings[entry.tex]) : null}
                {...(coverings[entry.tex] ? { trailing: <ListSwatch colour={coverings[entry.tex].colour} /> } : {})}
                onOpen={() => onSelect(entry.tex === selected ? "" : entry.tex)}
              />
            ))}
          </ListGroup>
        ) : (
          <p className="fx-hint">{tr("Покрытий с таким названием нет.")}</p>
        )}
        <ActionRows label={tr("Покрытия")} actions={[edited > 0 && { id: "reset", label: tr("Сбросить правки"), onClick: onCoveringsReset }]} />
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Подсветка
 * ------------------------------------------------------------------ */

function GlowTool({ casino, onGlow }) {
  useTr();
  const glow = casino.glow;
  const onMode = (mode) => onGlow({ mode, colour: glow.colour }, `${tr("Подсветка зала")}: ${modeLabel(mode)}`);
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={tr("Подсветка зала")} data-majestic-section="glow">
      <SectionHeading
        title=""
        help={[
          glow.mode === "off"
            ? tr("Светящиеся листы станут чёрными: подсветка погаснет, а вместе с ней и лампы.")
            : glow.mode === "colour"
              ? tr("Светящиеся листы получат свой цвет тоном по светотени: свечение остаётся, меняется оттенок.")
              : tr("Подсветка такая же, как в самой игре."),
          fill(tr("Светящихся листов в казино: {0} — правка идёт на все сразу."), CASINO_GLOW_SHEETS.length),
        ]}
      />
      {/* Подсветка — выключателем (горит или погашена вместе с лампами), её цвет — общим органом «Свой цвет»: сегмент «Как в игре | Свой цвет»
          и цвет под ним (п. 16 `design-qa.md`). */}
      <SwitchLine label={tr("Подсветка горит")} checked={glow.mode !== "off"} onChange={(on) => onMode(on ? "standard" : "off")} />
      {glow.mode !== "off" && (
        <SegmentedControl
          label={tr("Вид подсветки")}
          size="sm"
          options={["standard", "colour"].map((value) => ({ value, label: modeLabel(value) }))}
          value={glow.mode}
          onChange={onMode}
        />
      )}
      {glow.mode === "colour" && (
        <ColorField label={tr("Цвет подсветки")} value={glow.colour} swatches={CASINO_SWATCHES} editable onChange={(colour) => onGlow({ mode: "colour", colour }, `${tr("Подсветка зала")}: ${tr("цвет")}`)} />
      )}
    </section>
  );
}

/**
 * `tool` — «coverings» или «glow»; `casino` — часть казино работы; `selected` — взятое покрытие;
 * `onSelect(лист)`, `onCovering(лист, правка | null, подпись)`, `onCoveringsReset()`, `onGlow(правка, подпись)`.
 */
export default function MajesticInteriorsInspector({ tool, casino, selected = "", onSelect, onCovering, onCoveringsReset, onGlow }) {
  useTr();
  return (
    <div className="fx-inspector recolor-inspector majestic-inspector">
      {tool === "glow" ? (
        <GlowTool casino={casino} onGlow={onGlow} />
      ) : (
        <CoveringsTool casino={casino} selected={selected} onSelect={onSelect} onCovering={onCovering} onCoveringsReset={onCoveringsReset} />
      )}
    </div>
  );
}
