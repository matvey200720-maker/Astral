import { Heartbeat, Shield } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import Slider from "../../../ui/Slider.jsx";
import {
  MINIMAP_FRONTEND_STOCK,
  minimapScreenRect,
} from "../minimap-layout.js";
import {
  MINIMAP_WIDGET_LABELS,
  minimapWidgetKind,
} from "../MinimapPreview.jsx";
import { useMinimapCopy } from "../minimap-lang.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { Section } from "./parts.jsx";
import {
  applyIndicatorLayout,
  placeWidgetOnScreen,
  screenHandleIds,
  screenPointOf,
} from "./screen-indicator.js";
import { Fine } from "./FineSettings.jsx";

/*
 * «Где стоят HP и броня» в инструменте «Положение HP» (бывший «Экран») (владелец, 21.11.2026): выбранный элемент группы HP — по долям экрана, и готовые
 * раскладки индикатора рядом с прицелом.
 *
 * Список — те же строки, что «Что на карте» в «Полосках» (`.mmc-widget-*`), только видимые и без выключателей: взятый элемент раскрывает
 * два поля «По горизонтали» и «По вертикали» в процентах экрана. Они пишут то же, что ручка в кадре: центр в долях радара, зажатый краями
 * экрана (`placeWidgetOnScreen`), через `patchWidget` окна. Пока «HP отдельно от карты» выключено, поля стоят, но не работают: тянуть
 * элементы за пределы кадра мини-карты в игре нельзя.
 *
 * Готовые раскладки включают «HP отдельно от карты», ставят значки и цифры справа от середины экрана (где прицел) и полосы не трогают
 * (`screen-indicator.js`). Третья — «Плашка HP»: два кольца с числами внутри на общей тёмной плашке-пилюле с чертой, броня только когда она есть. Четвёртая — «Сердце и
 * жилет»: то же, но вместо колец сердце (HP) и щит (броня) с числами внутри их контуров.
 *
 * С 22.11.2026 (владелец: «всё просто»): сверху — готовые раскладки, список элементов с полями X/Y и прозрачностью лежит в «Тонкой настройке» (`FineSettings.jsx`).
 */

/* Прозрачность элемента в процентах: 0 — как есть, 90 — почти не видно (в договоре `opacity` 0…1). */
const transparencyOf = (widget) =>
  Math.min(90, Math.round((1 - (widget.opacity ?? 1)) * 100));

/* Доля экрана → проценты с одним знаком (шаг поля — 0,1). */
const toPercent = (fraction) => Math.round(fraction * 1000) / 10;

/**
 * @param {object} props
 * @param {object} props.config проект
 * @param {{aspect:number, inset:number}} props.screen экран, под которым показан кадр (`minimapPreviewScreen`)
 * @param {(next: object, label: string, property?: string) => void} props.commit запись в проект
 * @param {string|null} props.selected взятый элемент (общий с «Полосками»)
 * @param {(id: string) => void} props.onSelect
 * @param {(id: string, patch: object, label: string) => void} props.onPatchWidget правка элемента (`patchWidget` окна)
 */
export default function IndicatorSection({
  config: savedConfig,
  screen,
  commit,
  selected,
  onSelect,
  onPatchWidget,
}) {
  useTr();
  const copy = useMinimapCopy();
  const detached = savedConfig.layout.vitalsDetached === true;
  const frame = minimapScreenRect(
    savedConfig.layout.map,
    MINIMAP_FRONTEND_STOCK,
    screen,
  );
  /* На увеличенном радаре элементы стоят на своих местах (или там же, где в обычной мини-карте). */
  const config = savedConfig;
  const ids = screenHandleIds(config);
  /* Взятый и ещё видимый; иначе — первый видимый. */
  const current = ids.includes(selected) ? selected : (ids[0] ?? null);
  const move = (id, axis, value) => {
    const widget = config.layout.widgets[id];
    const at = screenPointOf(frame, widget.x, widget.y);
    const place = placeWidgetOnScreen(config, id, frame, {
      ...at,
      [axis]: value / 100,
    });
    onPatchWidget(id, place, copy.widgetMoved(MINIMAP_WIDGET_LABELS[id]));
  };
  const layouts = [
    {
      kind: "numbers",
      label: tr("Числа со значком"),
      title: tr(
        "Значки и цифры HP и брони столбцом справа от середины экрана, где прицел; полосы остаются на месте",
      ),
      done: tr("Индикатор HP: числа со значком"),
    },
    {
      kind: "gauge",
      label: tr("Шкала"),
      title: tr(
        "Значки-шкалы HP и брони справа от середины экрана, где прицел, без цифр; полосы остаются на месте",
      ),
      done: tr("Индикатор HP: шкала"),
    },
    {
      kind: "plate",
      label: tr("Плашка HP"),
      title: tr(
        "Тёмная плашка с кольцами HP и брони и числами внутри, справа от середины экрана: броня появляется, когда она есть; полосы остаются на месте",
      ),
      done: tr("Индикатор HP: плашка"),
    },
    {
      kind: "heartplate",
      label: tr("Сердце и жилет"),
      title: tr(
        "Тёмная плашка с сердцем HP и щитом брони, справа от середины экрана: броня появляется, когда она есть; полосы остаются на месте",
      ),
      done: tr("Индикатор HP: сердце и жилет"),
    },
  ];
  return (
    <Section title={tr("Где стоят HP и броня")}>
      <div className="mmc-indicator-presets">
        {layouts.map(({ kind, label, title, done }) => (
          <Button
            key={kind}
            variant="secondary"
            size="sm"
            title={title}
            onClick={() =>
              commit(applyIndicatorLayout(config, kind, frame), done, "layout")
            }
          >
            {label}
          </Button>
        ))}
      </div>
      {!detached && ids.length > 0 && (
        <p className="mmc-section-hint" data-indicator-detach>
          {tr("Включите «HP отдельно от карты»")}
        </p>
      )}
      {ids.length > 0 && (
      <Fine>
        <div className="mmc-widget-list">
          {ids.map((id) => {
            const active = id === current;
            const Icon = id.startsWith("health") ? Heartbeat : Shield;
            const at = screenPointOf(
              frame,
              config.layout.widgets[id].x,
              config.layout.widgets[id].y,
            );
            return (
              <div
                key={id}
                className={`mmc-widget-row${active ? " is-active" : ""}`}
                data-kind={minimapWidgetKind(id)}
              >
                <div className="mmc-widget-head">
                  {/* Строка списка, как в «Что на карте»: подпись со значком внутри кнопки. */}
                  <button
                    type="button"
                    className="mmc-widget-pick"
                    aria-pressed={active}
                    onClick={() => onSelect(id)}
                  >
                    <span>
                      <Icon />
                      {MINIMAP_WIDGET_LABELS[id]}
                    </span>
                  </button>
                </div>
                {active && (
                  <div className="mmc-widget-fields">
                    <Slider
                      editable
                      label={tr("По горизонтали, % экрана")}
                      value={toPercent(at.x)}
                      min={0}
                      max={100}
                      step={0.1}
                      disabled={!detached}
                      onChange={(value) => move(id, "x", value)}
                    />
                    <Slider
                      editable
                      label={tr("По вертикали, % экрана")}
                      value={toPercent(at.y)}
                      min={0}
                      max={100}
                      step={0.1}
                      disabled={!detached}
                      onChange={(value) => move(id, "y", value)}
                    />
                    {/* Полосы красит общая прозрачность полос из «Полосок»; у цифр и значков она своя (`widgets[id].opacity`). */}
                    {minimapWidgetKind(id) !== "bar" && (
                      <Slider
                        editable
                        label={tr("Прозрачность")}
                        value={transparencyOf(config.layout.widgets[id])}
                        min={0}
                        max={90}
                        step={1}
                        onChange={(percent) =>
                          onPatchWidget(
                            id,
                            { opacity: (100 - percent) / 100 },
                            `${tr("Прозрачность")}: ${MINIMAP_WIDGET_LABELS[id]}`,
                          )
                        }
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Fine>
      )}
    </Section>
  );
}
