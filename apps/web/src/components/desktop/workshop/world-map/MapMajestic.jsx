import { useEffect, useState } from "react";
import { CaretDown } from "../../../ui/icons.jsx";
import {
  MAJESTIC_CATALOG,
  MAJESTIC_SOURCE_DATE,
  loadMajesticMarks,
  majesticCount,
  majesticMarksData,
  majesticMarksEdited,
  normalizeWorldMap,
  patchMajesticMark,
} from "@modovik/vector-map";
import { counted } from "../../../../plural.js";
import Button from "../../../ui/Button.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import { Swatches, TextRow } from "../world-map-panel-parts.jsx";
import { PanelSection } from "./MapPanelParts.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { mapText, trForms } from "./map-copy.js";

/*
 * Инструмент «Метки Majestic» (ТЗ 18.10, задача 1.5): места сервера из вики
 * Majestic RP — тайники, ВЗА, клады, зелёные и красные зоны, охота, рыбалка,
 * дальнобойщики, камеры DMV, грибы, рубка леса, собирательство, мусорные баки,
 * счастливые телефоны. По умолчанию всё выключено. Категория включается
 * выключателем (рядом — сколько зон или точек в ней) и раскрывает свой вид:
 * цвет, заливка зон, толщина контура, размер значков. Общий «Размер» и «Заливка
 * зон» — внизу, как в эталонном редакторе. Метки рисуются сценой (`majestic-
 * marks.js`): видны в окне сразу и запекаются в плитки при установке.
 */

const WORDS = Object.freeze({
  zones: ["зона", "зоны", "зон"],
  points: ["точка", "точки", "точек"],
});

const GROUPS = Object.freeze([
  { id: "zones", title: "Зоны" },
  { id: "points", title: "Точки" },
]);

/* Вид одной включённой категории: цвет, заливка зон, контур, значки. */
function CategoryLook({ entry, own, onChange }) {
  useTr();
  const hasZones = entry.zones > 0;
  const hasIcons = Boolean(entry.glyph) && entry.points > 0;
  const title = tr(entry.title);
  return (
    <div className="wmc-majestic-look">
      <div className="wmc-field-block">
        <small className="wmc-field-caption">{own.color ? tr("Цвет") : tr("Цвет · как на вики")}</small>
        <Swatches
          label={mapText("Цвет: {title}", { title })}
          value={own.color}
          onChange={(color) => onChange({ color }, mapText("Цвет меток: {title}", { title }), `majestic.${entry.id}.color`)}
        />
        {own.color && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ color: "" }, mapText("Цвета как на вики: {title}", { title }), `majestic.${entry.id}.color`)}
          >
            {tr("Цвет как на вики")}
          </Button>
        )}
      </div>
      {hasZones && (
        <>
          <Slider
            label={tr("Заливка зон")}
            ariaLabel={mapText("Заливка зон: {title}", { title })}
            value={own.fill}
            min={0}
            max={300}
            step={5}
            unit="%"
            onChange={(fill) => onChange({ fill }, mapText("Заливка меток: {title}", { title }), `majestic.${entry.id}.fill`)}
          />
          <Slider
            label={tr("Контур")}
            ariaLabel={mapText("Толщина контура: {title}", { title })}
            value={own.line}
            min={0}
            max={300}
            step={5}
            unit="%"
            onChange={(line) => onChange({ line }, mapText("Контур меток: {title}", { title }), `majestic.${entry.id}.line`)}
          />
        </>
      )}
      {hasIcons && (
        <div className="wmc-field-block">
          <small className="wmc-field-caption">{own.ink ? tr("Цвет рисунка на значке") : tr("Цвет рисунка · по плашке")}</small>
          <Swatches
            label={mapText("Цвет рисунка на значке: {title}", { title })}
            value={own.ink}
            onChange={(ink) => onChange({ ink }, mapText("Рисунок значков: {title}", { title }), `majestic.${entry.id}.ink`)}
          />
          {own.ink && (
            <Button variant="ghost" size="sm" onClick={() => onChange({ ink: "" }, mapText("Рисунок значков как был: {title}", { title }), `majestic.${entry.id}.ink`)}>
              {tr("Цвет рисунка по плашке")}
            </Button>
          )}
        </div>
      )}
      {hasIcons && (
        <Slider
          label={tr("Значки")}
          ariaLabel={mapText("Размер значков: {title}", { title })}
          value={own.icon}
          min={20}
          max={300}
          step={5}
          unit="%"
          onChange={(icon) => onChange({ icon }, mapText("Значки меток: {title}", { title }), `majestic.${entry.id}.icon`)}
        />
      )}
    </div>
  );
}

/*
 * Выбранная щелчком метка вики (задача 36): свой цвет и «спрятать» на одну метку. Цвет метки — поверх цвета её
 * категории; спрятанная остаётся на карте рамкой-призраком, отсюда же возвращается.
 */
function MarkPick({ config, pick, onConfig, onPick }) {
  useTr();
  const entry = MAJESTIC_CATALOG.find((item) => item.id === pick.id);
  if (!entry) return null;
  const marks = config.majestic;
  const own = marks.marks?.[pick.key] || {};
  const title = tr(entry.title);
  const kind = pick.kind === "zone" ? tr("Зона") : tr("Точка");
  const change = (next, label) =>
    onConfig(normalizeWorldMap({ ...config, majestic: patchMajesticMark(marks, pick.key, next) }), label, `majestic.mark.${pick.key}`);
  return (
    <PanelSection title={tr("Выбранная метка")}>
      <div className="wmc-majestic-pick" data-majestic-pick={pick.key}>
        <i className="wmc-majestic-dot" aria-hidden="true" style={{ background: own.color || marks.categories[pick.id].color || entry.color }} />
        <span className="wmc-majestic-copy">
          <b>{title}</b>
          <small>{mapText("{kind} № {number}", { kind, number: pick.index + 1 })}</small>
        </span>
      </div>
      {!own.hidden && (
        <div className="wmc-field-block">
          <small className="wmc-field-caption">{own.color ? tr("Цвет метки") : tr("Цвет метки · как у категории")}</small>
          <Swatches
            label={mapText("Цвет метки: {title}", { title })}
            value={own.color || ""}
            onChange={(color) => change({ color }, mapText("Цвет метки: {title}", { title }))}
          />
          {own.color && (
            <Button variant="ghost" size="sm" onClick={() => change({ color: "" }, mapText("Цвет метки как у категории: {title}", { title }))}>
              {tr("Как у категории")}
            </Button>
          )}
        </div>
      )}
      <div className="wmc-majestic-pick-actions">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            change({ hidden: !own.hidden }, own.hidden ? mapText("Метка показана: {title}", { title }) : mapText("Метка спрятана: {title}", { title }))
          }
        >
          {own.hidden ? tr("Показать метку") : tr("Спрятать метку")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onPick(null)}>
          {tr("Снять выбор")}
        </Button>
      </div>
    </PanelSection>
  );
}

/** Панель инструмента «Метки Majestic». */
export default function MapMajestic({ config, onConfig, pick = null, onPick = null }) {
  useTr();
  const marks = config.majestic;
  const [opened, setOpened] = useState("");
  const [ready, setReady] = useState(Boolean(majesticMarksData()));

  /* Данные — отдельным куском сборки: подгружаются, когда инструмент открыт. */
  useEffect(() => {
    let alive = true;
    loadMajesticMarks()
      .then(() => alive && setReady(true))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const patch = (change, label, property) =>
    onConfig(normalizeWorldMap({ ...config, majestic: { ...marks, ...change } }), label, property);
  const patchCategory = (id, change, label, property) =>
    patch({ categories: { ...marks.categories, [id]: { ...marks.categories[id], ...change } } }, label, property);
  const anyOn = MAJESTIC_CATALOG.some((entry) => marks.categories[entry.id].on);
  const edited = majesticMarksEdited(marks);

  return (
    <div className="wmc-majestic" data-majestic-ready={ready ? "" : undefined}>
      <small className="wmc-hint">
        {mapText("Места сервера с вики Majestic RP на {date}: включите нужные — они лягут на карту и уйдут в игру вместе с ней.", {
          date: MAJESTIC_SOURCE_DATE.split("-").reverse().join("."),
        })}
      </small>
      {onPick && anyOn && !pick && <small className="wmc-hint">{tr("Щёлкните метку на карте — её можно перекрасить или спрятать отдельно.")}</small>}
      {onPick && pick && <MarkPick config={config} pick={pick} onConfig={onConfig} onPick={onPick} />}
      {GROUPS.map((group) => (
        <PanelSection key={group.id} title={tr(group.title)}>
          <ul className="wmc-majestic-list" aria-label={tr(group.title)}>
            {MAJESTIC_CATALOG.filter((entry) => entry.group === group.id).map((entry) => {
              const own = marks.categories[entry.id];
              const count = majesticCount(entry);
              const title = tr(entry.title);
              const open = opened === entry.id && own.on;
              return (
                <li key={entry.id} className={own.on ? "is-on" : ""} data-majestic={entry.id}>
                  <div className="wmc-majestic-row">
                    <i className="wmc-majestic-dot" aria-hidden="true" style={{ background: own.color || entry.color }} />
                    <span className="wmc-majestic-copy">
                      <b>{title}</b>
                      <small>{counted(count, trForms(WORDS[entry.group]))}</small>
                    </span>
                    {own.on && (
                      <button
                        type="button"
                        className="wmc-majestic-more"
                        aria-expanded={open}
                        aria-label={mapText("Вид меток: {title}", { title })}
                        title={tr("Цвет, заливка, контур, значки")}
                        onClick={() => setOpened(open ? "" : entry.id)}
                      >
                        <CaretDown aria-hidden="true" />
                      </button>
                    )}
                    <Switch
                      checked={own.on}
                      label={title}
                      onChange={(on) =>
                        patchCategory(
                          entry.id,
                          { on },
                          on ? mapText("Метки на карте: {title}", { title }) : mapText("Метки убраны: {title}", { title }),
                          `majestic.${entry.id}.on`,
                        )
                      }
                    />
                  </div>
                  {open && (
                    <CategoryLook
                      entry={entry}
                      own={own}
                      onChange={(change, label, property) => patchCategory(entry.id, change, label, property)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </PanelSection>
      ))}
      <PanelSection title={tr("Весь слой")}>
        <Slider
          label={tr("Размер")}
          ariaLabel={tr("Размер значков и контура")}
          value={marks.size}
          min={0}
          max={1000}
          step={10}
          unit={tr(" м")}
          onChange={(size) => patch({ size }, tr("Размер меток"), "majestic.size")}
        />
        <Slider
          label={tr("Заливка зон")}
          ariaLabel={tr("Заливка зон всех меток")}
          value={marks.fill}
          min={0}
          max={300}
          step={5}
          unit="%"
          onChange={(fill) => patch({ fill }, tr("Заливка меток"), "majestic.fill")}
        />
        {edited > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onPick?.(null);
              onConfig(normalizeWorldMap({ ...config, majestic: { ...marks, marks: {} } }), tr("Метки Majestic как на вики"), "majestic.marks");
            }}
          >
            {mapText("Вернуть правки меток ({count})", { count: edited })}
          </Button>
        )}
        {anyOn && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onConfig(
                normalizeWorldMap({
                  ...config,
                  majestic: {
                    ...marks,
                    categories: Object.fromEntries(
                      MAJESTIC_CATALOG.map((entry) => [entry.id, { ...marks.categories[entry.id], on: false }]),
                    ),
                  },
                }),
                tr("Метки Majestic убраны"),
                "majestic.off",
              )
            }
          >
            {tr("Выключить все")}
          </Button>
        )}
      </PanelSection>
    </div>
  );
}
