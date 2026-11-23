import { Heartbeat, Shield } from "../../../ui/icons.jsx";
import ChoiceRadioGroup from "../../../ui/ChoiceRadioGroup.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import {
  MINIMAP_ICON_SIZE_LIMITS,
  MINIMAP_RADAR,
  MINIMAP_SCENE,
  MINIMAP_STRIP,
  MINIMAP_VITALS_LAYOUTS,
  applyMinimapVitalsLayout,
  minimapIconSizeUnits,
  minimapIconWidgetSize,
  minimapLayoutBars,
} from "../minimap-layout.js";
import {
  MINIMAP_WIDGET_IDS,
  MINIMAP_WIDGET_LABELS,
  minimapWidgetKind,
} from "../MinimapPreview.jsx";
import { Section, Toggle } from "./parts.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { useMinimapCopy } from "../minimap-lang.js";

/*
 * «Структура» — первый инструмент мини-карты (задача 15 ТЗ 10.10.2026,
 * вечер): «первая кнопка позволяет человеку выбрать структуру — он
 * выстраивает эту штуку, включает то, что ему нужно, и всё чётко».
 *
 * Плитка структуры — рисунок мини-карты с полосами там, где их поставит
 * раскладка, теми же числами (`minimapLayoutBars`), что ставят их на карту и
 * в игру, и цветами самой работы. Полосы встают вплотную к краю карты при
 * любой толщине: толщина меняется — раскладка ставит полосы к краю заново, а
 * цифры и значки остаются, где их поставили.
 *
 * Процентов здесь нет (владелец: «убери возможность выставлять проценты»):
 * место — плиткой и мышью по карте, толщина — в точках, размер значка — в
 * точках.
 */

const edgeOptions = () => [
  { value: "health", label: "HP" },
  { value: "armor", label: tr("Броня") },
];

/* Полоса раскладки прямоугольником в точках сцены 191×136. */
function barRect(bar, thickness) {
  const along = bar.width * MINIMAP_RADAR.width;
  const across = bar.height * MINIMAP_RADAR.height * (thickness / 8);
  const vertical = Math.abs(Math.abs(bar.rotation || 0) - 90) < 1;
  const width = vertical ? across : along;
  const height = vertical ? along : across;
  return {
    x: MINIMAP_RADAR.x + bar.x * MINIMAP_RADAR.width - width / 2,
    y: MINIMAP_RADAR.y + bar.y * MINIMAP_RADAR.height - height / 2,
    width,
    height,
  };
}

/*
 * Рисунок плитки: карта и полосы. Это схема раскладки, а не кадр игры, —
 * подписывать её не нужно: на ней нет ничего, кроме прямоугольников.
 */
function StructureArt({ id, config }) {
  const { effects, layout } = config;
  const thickness = effects.barThickness;
  const bars =
    id === "independent"
      ? { healthBar: layout.widgets.healthBar, armorBar: layout.widgets.armorBar }
      : minimapLayoutBars(id, thickness, layout.vitalsEdge);
  const visible = (key) => layout.widgets[key].visible;
  return (
    <svg
      className="mmc-structure-art"
      viewBox={`0 0 ${MINIMAP_SCENE.width} ${MINIMAP_SCENE.height}`}
      aria-hidden="true"
    >
      <rect
        className="mmc-structure-map"
        x={MINIMAP_RADAR.x}
        y={MINIMAP_RADAR.y}
        width={MINIMAP_RADAR.width}
        height={MINIMAP_RADAR.height}
      />
      {id === "under-map" && (
        <rect
          className="mmc-structure-strip"
          x={MINIMAP_RADAR.x}
          y={MINIMAP_STRIP.top}
          width={MINIMAP_RADAR.width}
          height={MINIMAP_STRIP.bottom - MINIMAP_STRIP.top}
        />
      )}
      {bars &&
        ["healthBar", "armorBar"].map((key) => {
          if (!visible(key) || !bars[key]) return null;
          const rect = barRect(bars[key], thickness);
          return (
            <rect
              key={key}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              fill={key === "healthBar" ? effects.healthColor : effects.armorColor}
            />
          );
        })}
    </svg>
  );
}

/*
 * Список того, что на карте. Выключатель ставит элемент на карту и снимает
 * с неё; строка выбирает его, чтобы двигать стрелками. У значка — размер в
 * точках, у любого — «Зафиксировать»; процентов места и длины нет.
 */
function ElementList({ widgets, selected, onSelect, onToggle, onPatch }) {
  useTr();
  const copy = useMinimapCopy();
  return (
    <div className="mmc-widget-list">
      {MINIMAP_WIDGET_IDS.map((id) => {
        const widget = widgets[id];
        const { visible } = widget;
        const Icon = id.startsWith("health") ? Heartbeat : Shield;
        const active = visible && selected === id;
        const label = MINIMAP_WIDGET_LABELS[id];
        return (
          <div
            key={id}
            className={`mmc-widget-row${active ? " is-active" : ""}${visible ? "" : " is-hidden"}`}
            data-kind={minimapWidgetKind(id)}
          >
            <div className="mmc-widget-head">
              {/* Строка списка, а не кнопка продукта: подпись со значком
                  лежит внутри, как у остальных строк лаунчера. */}
              <button
                type="button"
                className="mmc-widget-pick"
                disabled={!visible}
                aria-pressed={active}
                onClick={() => onSelect(id)}
              >
                <span>
                  <Icon />
                  {label}
                </span>
              </button>
              <Switch
                checked={visible}
                label={label}
                onChange={(next) => onToggle(id, next)}
              />
            </div>
            {active && (
              <div className="mmc-widget-fields">
                {minimapWidgetKind(id) === "icon" && (
                  <Slider
                    editable
                    label={tr("Размер")}
                    value={Math.round(minimapIconSizeUnits(widget))}
                    min={MINIMAP_ICON_SIZE_LIMITS[0]}
                    max={MINIMAP_ICON_SIZE_LIMITS[1]}
                    unit=" px"
                    onChange={(size) =>
                      onPatch(
                        id,
                        minimapIconWidgetSize(size),
                        copy.iconSize(label),
                        { clamp: true },
                      )
                    }
                  />
                )}
                <Toggle
                  label={tr("Зафиксировать")}
                  checked={widget.locked}
                  onChange={(locked) =>
                    onPatch(
                      id,
                      { locked },
                      copy.widgetLocked(label, locked),
                    )
                  }
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/*
 * Раскладка и «Что на карте» — два раздела: с ТЗ 22.10.2026 они стоят в инструменте «Полоски» (раскладка — первым,
 * список элементов — последним, `ToolPanels.jsx`).
 */
export function StructureSection({ config, commit }) {
  useTr();
  const { layout, effects } = config;
  const current = MINIMAP_VITALS_LAYOUTS.find((item) => item.id === layout.vitalsLayout);
  /* Структура ставит полосы к краю карты — HP снова при карте (задача 1 ТЗ
     17.10.2026: выключатель «HP отдельно от карты» выключается). */
  const place = (id, label, options = {}) =>
    commit(
      {
        ...config,
        layout: {
          ...applyMinimapVitalsLayout(config, id, options),
          ...(id === "independent" ? {} : { vitalsDetached: false }),
        },
      },
      label,
      "layout.vitalsLayout",
    );
  /* Толщина — в точках. Раскладка, если она не «Свободно», ставит полосы к
     краю заново: тоньше или толще, полоса у края не отходит от него. */
  const setThickness = (barThickness) => {
    const next = { ...config, effects: { ...effects, barThickness } };
    commit(
      layout.vitalsLayout === "independent"
        ? next
        : {
            ...next,
            layout: applyMinimapVitalsLayout(next, layout.vitalsLayout, {
              barsOnly: true,
            }),
          },
      tr("Изменена толщина полосок"),
      "effects",
    );
  };

  return (
    <>
      <Section title={tr("Структура")}>
        <ChoiceRadioGroup
          label={tr("Структура мини-карты")}
          className="mmc-structures"
          value={layout.vitalsLayout}
          onChange={(id) => {
            const item = MINIMAP_VITALS_LAYOUTS.find((entry) => entry.id === id);
            place(id, `${tr("Структура")}: ${item?.label || id}`);
          }}
          options={MINIMAP_VITALS_LAYOUTS.map((item) => ({
            value: item.id,
            title: item.label,
            description: item.description,
            media: <StructureArt id={item.id} config={config} />,
          }))}
        />
        {current?.edge && (
          <div className="mmc-choice-row">
            <span>{tr("У края карты")}</span>
            <SegmentedControl
              label={tr("У края карты")}
              size="sm"
              value={layout.vitalsEdge}
              onChange={(edge) =>
                place(layout.vitalsLayout, `${tr("У края карты")} — ${edge === "armor" ? tr("броня") : "HP"}`, { edge })
              }
              options={edgeOptions()}
            />
          </div>
        )}
        <Slider
          label={tr("Толщина полосок")}
          value={effects.barThickness}
          min={2}
          max={24}
          unit=" px"
          onChange={setThickness}
        />
        <p className="mmc-section-hint">
          {tr("Полосы встают вплотную к краю самой карты, во всю её сторону. Тяните любой элемент по карте — структура станет «Свободно».")}
        </p>
      </Section>
    </>
  );
}

export function ElementsSection({ config, selected, onSelect, onToggleWidget, onPatchWidget, mapToggle }) {
  useTr();
  const { layout } = config;
  return (
    <>
      <Section title={tr("Что на карте")}>
        {mapToggle}
        <ElementList
          widgets={layout.widgets}
          selected={selected}
          onSelect={onSelect}
          onToggle={onToggleWidget}
          onPatch={onPatchWidget}
        />
        {/* Задача 8 ТЗ 10.10.2026, проверено в игре: всё, что за кадром
            мини-карты (frontend.xml), игра не рисует. */}
        <p className="mmc-section-hint">
          {tr("HP, броня и цифры тянутся по карте и по краю её кадра: дальше кадра игра мини-карту не рисует. В любое место экрана HP ставится так: выключите «Карту» и двигайте его «Положением».")}
        </p>
      </Section>
    </>
  );
}

