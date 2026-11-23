import { useId } from "react";
import {
  MINIMAP_VITAL_PLATE_SHAPES,
  normalizeMinimapVitalPlate,
  vitalPlateActive,
  vitalPlateShapesFor,
} from "@modovik/minimap-contract";
import Slider from "../../../ui/Slider.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { ColorControl, Section, Toggle } from "./parts.jsx";
import { VitalPlateThumb } from "./VitalPlate.jsx";

/*
 * «Подложка и броня» в инструменте «Экран» (владелец, 21.11.2026: плашка индикатора HP и брони с кадра из TikTok — тёмная скруглённая «пилюля» с кольцами, без брони короче).
 *
 * Всё, что плашка читает из проекта: блок `vitalPlate` (вид, цвет, прозрачность, общая или у каждого блока своя, черта между блоками — `minimap-contract/vital-plate.js`) и три
 * поля эффектов — броня «только когда она есть», цвет пустой части шкалы значка и плавное убывание заливки. Панель только пишет их через `commit`: рисует плашку предпросмотр
 * (`VitalPlate.jsx`), кнопки жилета в кадре показывают, как она сжимается без брони.
 *
 * «Сердце» годится плашке HP, «щит» — плашке брони: у общей плашки на оба блока их нет, кнопки стоят бледными, пока плашка общая.
 */

/** Название вида. Слова читаются в момент показа — на языке окна. */
function shapeLabel(shape) {
  switch (shape) {
    case "pill":
      return tr("Пилюля");
    case "rect":
      return tr("Прямоугольник");
    case "square":
      return tr("Квадрат");
    case "triangle":
      return tr("Треугольник");
    case "heart":
      return tr("Сердце");
    case "shield":
      return tr("Щит");
    default:
      return tr("Нет");
  }
}

/**
 * Выбор вида плашки: кнопки с миниатюрой, как выбор вида значка. Вид, который стороне не годится, стоит бледной кнопкой.
 * @param {object} props
 * @param {string} [props.title] чья плашка: «HP» или «Броня»; без подписи — общая
 * @param {"shared" | "health" | "armour"} props.target
 * @param {string} props.value
 * @param {(shape: string) => void} props.onChange
 */
function PlateShapePicker({ title = "", target, value, onChange }) {
  const captionId = useId();
  const allowed = vitalPlateShapesFor(target);
  return (
    <div
      className="mmc-vital-picker"
      role="group"
      aria-labelledby={captionId}
      data-plate-picker={target}
    >
      {/* Подпись — отдельными узлами, не склеенной строкой: слой перевода окна режет склейку на куски. */}
      <span id={captionId}>
        {tr("Вид плашки")}
        {title && (
          <>
            <i> · </i>
            {title}
          </>
        )}
      </span>
      <div>
        {MINIMAP_VITAL_PLATE_SHAPES.map((shape) => {
          const label = shapeLabel(shape);
          return (
            <button
              type="button"
              key={shape}
              className={value === shape ? "is-active" : ""}
              aria-pressed={value === shape}
              aria-label={title ? `${label} · ${title}` : label}
              title={label}
              disabled={!allowed.includes(shape)}
              onClick={() => onChange(shape)}
            >
              <VitalPlateThumb shape={shape} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* Какой вид останется общей плашке, когда плашки сведут в одну: первый выбранный у сторон; «сердце» и «щит» нормализатор сам заменит «пилюлей». */
const sharedShapeOf = (plate) =>
  [plate.plateHealth, plate.plateArmour].find((shape) => shape !== "none") ??
  "none";

/**
 * @param {object} props
 * @param {object} props.config проект
 * @param {(next: object, label: string, property?: string) => void} props.commit запись в проект
 */
export default function PlateSection({ config, commit }) {
  useTr();
  const plate = normalizeMinimapVitalPlate(config.vitalPlate);
  const { effects } = config;
  const writePlate = (patch, label) =>
    commit(
      { ...config, vitalPlate: { ...plate, ...patch } },
      label,
      "vitalPlate",
    );
  const writeEffects = (patch, label) =>
    commit({ ...config, effects: { ...effects, ...patch } }, label, "effects");
  const drawn = vitalPlateActive(plate);
  const anything = [
    "healthIcon",
    "armorIcon",
    "healthNumber",
    "armorNumber",
  ].some((id) => config.layout.widgets[id]?.visible);
  const share = (shared) =>
    writePlate(
      shared
        ? { shared: true, shape: sharedShapeOf(plate) }
        : { shared: false, plateHealth: plate.shape, plateArmour: plate.shape },
      shared ? tr("Плашка общая на оба блока") : tr("У HP и брони своя плашка"),
    );
  return (
    <Section title={tr("Подложка и броня")}>
      <Toggle
        label={tr("Показывать броню только когда она есть")}
        checked={effects.armourOnlyWhenPresent === true}
        onChange={(armourOnlyWhenPresent) =>
          writeEffects(
            { armourOnlyWhenPresent },
            armourOnlyWhenPresent
              ? tr("Броня показывается, только когда она есть")
              : tr("Броня показывается всегда"),
          )
        }
      />
      <Toggle
        label={tr("Общая плашка на оба блока")}
        checked={plate.shared}
        onChange={share}
      />
      {plate.shared ? (
        <>
          <PlateShapePicker
            target="shared"
            value={plate.shape}
            onChange={(shape) =>
              writePlate({ shape }, tr("Изменён вид плашки"))
            }
          />
          <p className="mmc-section-hint">
            {tr(
              "Сердце и щит подходят только плашке одного блока: выключите «Общая плашка на оба блока».",
            )}
          </p>
        </>
      ) : (
        <>
          <PlateShapePicker
            title="HP"
            target="health"
            value={plate.plateHealth}
            onChange={(plateHealth) =>
              writePlate({ plateHealth }, tr("Изменён вид плашки"))
            }
          />
          <PlateShapePicker
            title={tr("Броня")}
            target="armour"
            value={plate.plateArmour}
            onChange={(plateArmour) =>
              writePlate({ plateArmour }, tr("Изменён вид плашки"))
            }
          />
        </>
      )}
      {drawn && !anything && (
        <p className="mmc-section-hint" data-plate-empty>
          {tr(
            "Плашка встаёт вокруг значков и цифр HP и брони: включите их в «Значках» или нажмите «Плашка HP» выше.",
          )}
        </p>
      )}
      {drawn && (
        <>
          <ColorControl
            label={tr("Фон плашки")}
            value={plate.colour}
            onChange={(colour) =>
              writePlate({ colour }, tr("Изменён фон плашки"))
            }
          />
          <Slider
            editable
            label={tr("Непрозрачность плашки")}
            value={Math.round(plate.opacity * 100)}
            min={0}
            max={100}
            unit=" %"
            onChange={(percent) =>
              writePlate(
                { opacity: percent / 100 },
                tr("Изменена непрозрачность плашки"),
              )
            }
          />
        </>
      )}
      {drawn && plate.shared && (
        <>
          <Toggle
            label={tr("Черта между HP и бронёй")}
            checked={plate.divider.enabled}
            onChange={(enabled) =>
              writePlate(
                { divider: { ...plate.divider, enabled } },
                enabled
                  ? tr("Включена черта между HP и бронёй")
                  : tr("Выключена черта между HP и бронёй"),
              )
            }
          />
          {plate.divider.enabled && (
            <ColorControl
              label={tr("Цвет черты")}
              value={plate.divider.colour}
              onChange={(colour) =>
                writePlate(
                  { divider: { ...plate.divider, colour } },
                  tr("Изменён цвет черты"),
                )
              }
            />
          )}
        </>
      )}
      {/* Пустая часть шкалы значка: `vitalTrackColour` рисует предпросмотр, прежнее `vitalTrackColor` пишется тем же цветом, пока сборка игры читает его. */}
      <ColorControl
        label={tr("Цвет пустой части шкалы")}
        value={effects.vitalTrackColour}
        onChange={(vitalTrackColour) =>
          writeEffects(
            { vitalTrackColour, vitalTrackColor: vitalTrackColour },
            tr("Изменён цвет пустой части шкалы"),
          )
        }
      />
      <Toggle
        label={tr("Плавное убывание заливки")}
        checked={effects.vitalFillSmooth === true}
        onChange={(vitalFillSmooth) =>
          writeEffects(
            { vitalFillSmooth },
            vitalFillSmooth
              ? tr("Включено плавное убывание заливки")
              : tr("Выключено плавное убывание заливки"),
          )
        }
      />
      <Slider
        editable
        label={tr("Скорость анимации индикатора")}
        value={effects.vitalAnimSpeed}
        min={25}
        max={400}
        unit=" %"
        onChange={(vitalAnimSpeed) =>
          writeEffects(
            { vitalAnimSpeed },
            tr("Изменена скорость анимации индикатора"),
          )
        }
      />
    </Section>
  );
}
