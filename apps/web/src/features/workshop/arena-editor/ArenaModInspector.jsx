/*
 * Колонка правок арены мода (Хелпер 7, 25.10.2026): листы мода — каждый одной картинкой на все свои места в зале.
 *
 * Сверху взятый лист (щелчком по списку или нажатием колеса по залу): своя картинка первым делом (слово владельца 30.10.2026,
 * `design-qa.md`, п. 10 — рамка с листом, щелчок или брошенный файл), «Свой цвет» строкой, «Как у мода» и «Убрать лист» внизу; ниже — поиск и
 * список листов от самых заметных (по площади в зале, потом по числу деталей) с превью. Правка — `project.mod.sheets` (`arena-mod.js`); кадр и
 * установка читают её тем же расчётом.
 */

import { useMemo, useState } from "react";
import { normalizeArenaMod } from "@modovik/climb-contract/recolor/arena-mod";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import Button from "../../../components/ui/Button.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import ListGroup, { ListRow, ListSub, ListSwatch } from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import SectionHeading from "../section-help.jsx";
import { ImageField } from "./ArenaInspector.jsx";
import { ARENA_SWATCHES } from "./arena-text.js";
import { CaretDown, CaretRight, Palette } from "../../../components/ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

const PAGE = 40;
const NO_IMAGE = Object.freeze({ asset: "", name: "", width: 0, height: 0 });

/** Строка состояния листа: что на нём своё — цвет, картинка или «убрано»; без правки — пусто (в списке подпись только у изменённых). */
function sheetCaption(look) {
  if (!look) return "";
  if (look.mode === "hidden") return tr("Убрано");
  return look.mode === "image" ? look.image.name || tr("Своя картинка") : look.colour;
}

function Thumb({ url, size = 28 }) {
  const className = `arena-mod-thumb${size > 28 ? " is-large" : ""}`;
  return url ? <img className={className} src={url} alt="" width={size} height={size} /> : <span className={`${className} is-empty`} aria-hidden="true" />;
}

/**
 * `mod` — `project.mod`, `hall` — `{ named, thumbs }` из `useArenaModHall`, `selected` — взятый лист, `onSelect(имя)`,
 * `onChange(следующий mod, подпись правки)`.
 */
export default function ArenaModInspector({ mod, hall, areas = null, selected = "", onSelect, onChange, onNotice = null }) {
  useTr();
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const sheets = useMemo(() => mod.sheets || {}, [mod.sheets]);
  const edited = Object.keys(sheets).length;
  const named = useMemo(() => hall?.named || [], [hall?.named]);
  /* Что видно в списке: по важности, поиск по имени; правленые листы, которых зал не знает, тоже видны (работа открылась на другой версии). */
  const rows = useMemo(() => {
    const known = new Set(named.map((entry) => entry.name));
    const extra = Object.keys(sheets).filter((name) => !known.has(name)).map((name) => ({ name, uses: 0 }));
    const text = query.trim().toLowerCase();
    const size = (entry) => areas?.get(entry.name) || 0;
    return [...named, ...extra]
      .filter((entry) => !text || entry.name.includes(text))
      .sort((left, right) => size(right) - size(left) || (right.uses || 0) - (left.uses || 0) || left.name.localeCompare(right.name));
  }, [named, sheets, query, areas]);
  const look = selected ? sheets[selected] || null : null;
  const mode = look?.mode || "standard";
  const [palette, setPalette] = useState(false);

  const put = (name, next, label) => {
    const copy = { ...sheets };
    if (next) copy[name] = next;
    else delete copy[name];
    onChange(normalizeArenaMod({ ...mod, sheets: copy }), label);
  };

  return (
    <div className="fx-inspector recolor-inspector">
      {selected && (
        <section className="ui-panel fx-section recolor-section arena-mod-selected" aria-label={tr("Взятый лист")} data-arena-section="mod-selected">
          <header className="fx-section-head">
            <h3 className="arena-mod-name">
              <Thumb url={hall?.thumbs?.get(selected)} size={32} />
              <span>{selected}</span>
            </h3>
            <Button size="sm" variant="ghost" onClick={() => onSelect("")}>
              {tr("Снять выбор")}
            </Button>
          </header>
          {/* Своя картинка первым делом: в рамке — лист как у мода или своё; щелчок или брошенный файл — картинкой на все места листа. */}
          <ImageField
            label={trFill("Лист {0}: картинка", selected)}
            image={mode === "image" ? look.image : NO_IMAGE}
            still={mode === "standard" ? hall?.thumbs?.get(selected) || "" : ""}
            fill={mode === "colour" ? look.colour : ""}
            /* Под рамкой — только имя своего файла (или код своего цвета); «Как в игре» и «Убрано» подписью не пишутся (слово владельца 31.10.2026). */
            caption={mode === "image" ? null : mode === "colour" ? sheetCaption(look) : ""}
            hint={tr("Лист целиком заменится вашей картинкой: она растянется по листу и встанет на всех местах, где он стоит. Картинка остаётся на этом компьютере.")}
            onNotice={onNotice}
            onImage={(image) => put(selected, image.asset ? { mode: "image", image } : null, tr("Лист мода: своя картинка"))}
            /* «×» — лист как у мода (своё — всегда с «×», п. 21). */
            onClear={look ? () => put(selected, null, tr("Лист мода: как у мода")) : null}
            clearLabel={tr("Как в игре")}
          />
          {/* Имя группы — по тому, что в ней (критик 30.10.2026: «Ещё» ничего не говорит). */}
          <ListGroup title={tr("Цвет")} help={tr("Цвет ложится тоном по светотени листа: узор и швы остаются, меняется оттенок.")}>
            <ListRow
              icon={<Palette />}
              title={tr("Свой цвет")}
              caption={mode === "colour" ? look.colour.toUpperCase() : null}
              trailing={
                <>
                  <ListSwatch colour={mode === "colour" ? look.colour : null} />
                  {palette ? <CaretDown aria-hidden="true" /> : <CaretRight aria-hidden="true" />}
                </>
              }
              expanded={palette}
              onOpen={() => setPalette(!palette)}
            />
            {palette && (
              <ListSub>
                <ColorField label={tr("Цвет листа")} value={look?.colour || ARENA_SWATCHES[4]} swatches={ARENA_SWATCHES} editable onChange={(colour) => put(selected, { mode: "colour", colour }, tr("Лист мода: цвет"))} />
              </ListSub>
            )}
          </ListGroup>
          {/* Вернуть и убрать — строками внизу, только доступные (п. 4). */}
          <ActionRows
            label={tr("Взятый лист")}
            actions={[
              look && { id: "sheet-standard", label: tr("Как в игре"), onClick: () => put(selected, null, tr("Лист мода: как у мода")) },
              mode !== "hidden" && { id: "sheet-hidden", label: tr("Убрать лист"), title: tr("Лист пропадёт со всех мест, где он стоит: поверхность станет прозрачной."), danger: true, onClick: () => put(selected, { mode: "hidden" }, tr("Лист мода: убрать")) },
            ]}
          />
        </section>
      )}
      <section className="ui-panel fx-section recolor-section" aria-label={tr("Листы мода")} data-arena-section="mod-sheets">
        <SectionHeading
          title={tr("Листы мода")}
          help={[
            tr("Каждый лист — одна картинка мода, она лежит на всех своих местах в зале. Выберите лист в списке или нажмите колесом по залу."),
            tr("Листов: {0} · изменено: {1}").replace("{0}", String(rows.length)).replace("{1}", String(edited)),
          ]}
        />
        <TextField label={tr("Найти лист")} value={query} placeholder={tr("Название листа")} onChange={(value) => {
            setQuery(value);
            setShown(PAGE);
          }} />
        {rows.length ? (
          <ul className="arena-mod-sheets">
            {rows.slice(0, shown).map((entry) => (
              <li key={entry.name}>
                <NavRow
                  className={entry.name === selected ? "is-selected" : ""}
                  aria-pressed={entry.name === selected}
                  icon={<Thumb url={hall?.thumbs?.get(entry.name)} />}
                  title={entry.name}
                  caption={sheetCaption(sheets[entry.name]) || null}
                  onOpen={() => onSelect(entry.name === selected ? "" : entry.name)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="fx-hint">{named.length ? tr("Листов с таким названием нет.") : tr("В зале нет листов мода, которые можно менять.")}</p>
        )}
        {rows.length > shown && (
          <Button size="sm" variant="secondary" onClick={() => setShown((count) => count + PAGE)}>
            {tr("Показать ещё")}
          </Button>
        )}
        {/* Сбросить — строкой внизу (`ActionRows`) и только когда есть правки: погашенной кнопки в заголовке нет. */}
        <ActionRows label={tr("Листы мода")} actions={[edited > 0 && { id: "reset", label: tr("Сбросить правки"), onClick: () => onChange(normalizeArenaMod({ ...mod, sheets: {} }), tr("Листы мода: как у мода")) }]} />
      </section>
    </div>
  );
}
