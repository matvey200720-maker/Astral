import { useDeferredValue, useRef } from "react";
import { UploadSimple } from "../../../ui/icons.jsx";
import {
  GPS_LINE_LIMITS,
  GPS_LINE_STYLES,
  GPS_MARKER_HUD,
  GPS_MARKER_ICONS,
  GPS_MARKER_LIMITS,
  gpsLinePattern,
} from "@modovik/minimap-contract/gps-marker";
import Button from "../../../ui/Button.jsx";
import ChoiceRadioGroup from "../../../ui/ChoiceRadioGroup.jsx";
import ColorField from "../../../ui/ColorField.jsx";
import Slider from "../../../ui/Slider.jsx";
import GpsIconArt from "../../../../features/workshop/gps-editor/GpsIconArt.jsx";
import { GPS_ICON_PICTURE_TYPES } from "../../../../features/workshop/gps-editor/gps-icons.js";
import { gpsKilometres } from "../../../../features/workshop/gps-editor/gps-scene.js";
import { Section, Toggle } from "./parts.jsx";
import { Fine } from "./FineSettings.jsx";
import RouteFrame from "./RouteFrame.jsx";
import { useMarkerIcon, useRouteModel } from "./route-model.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { localKilometres, useMinimapCopy } from "../minimap-lang.js";

/*
 * «Метка GPS» и «Маршрут» мини-карты (задача 10 ТЗ 10.10.2026, вечер;
 * ползунки и редактор линии — задача 1 ТЗ 11.10.2026, утро). Владелец:
 * «оставить метку GPS и добавить редактор самой линии… шире, тоньше…
 * пунктирной, разрывчатой… всё ползунком… прозрачность метки ползуночком до
 * 100 %».
 *
 * Что уходит в игру и чем — `@modovik/minimap-contract/gps-marker`: метка —
 * hudcolor.dat, minimap.ytd и символ `radar_waypoint`; линия — перехват
 * команд рисования, которыми игра чертит путь (`minimap-gps-line.js`).
 * Чего перехват не меняет (маршруты других цветов — только толщина, вид и
 * прозрачность) и что в игре ещё не проверено, панель говорит прямо.
 */

const MARKER_SWATCHES = Object.freeze([
  GPS_MARKER_HUD.HUD_COLOUR_WAYPOINT,
  "#e8202a",
  "#ff7a00",
  "#ffc21a",
  "#2bd96b",
  "#22d3ee",
  "#2f6bff",
  "#ff2bd6",
  "#f0f0f0",
]);
const decimal = (value) => String(value).replace(".", ",");
const times = (value) => `×${decimal(value)}`;
/* Прозрачность в окне — проценты «насколько прозрачна»; в проекте — непрозрачность. */
const transparency = (opacity) => Math.round((1 - opacity) * 100);
const opacityOf = (percent) => Math.round(100 - percent) / 100;

export function GpsMarkerPanel({ gps, onGps, scene, pictureBusy, pictureError, onPicture }) {
  useTr();
  const fileRef = useRef(null);
  const { marker } = gps;
  /* Плитки значков догоняют цвет, когда рука на палитре остановилась: живым его ведёт значок в кадре. */
  const tileColor = useDeferredValue(marker.color);
  const { stockImage, picture } = scene;
  const options = [
    ...GPS_MARKER_ICONS.map((item) => ({
      value: item.id,
      title: tr(item.label),
      description: item.id === "stock" ? tr("Крест-цветок Rockstar") : tr("Белый силуэт, цвет даёт игра"),
      media: <GpsIconArt icon={item.id} color={tileColor} stockImage={stockImage} picture={picture} />,
    })),
    {
      value: "custom",
      title: tr("Своя картинка"),
      description: picture ? tr("Ваш файл силуэтом") : tr("PNG, JPG или WebP"),
      media: <GpsIconArt icon="custom" color={tileColor} stockImage={stockImage} picture={picture} />,
    },
  ];
  return (
    <>
      <Section title={tr("Цвет метки")}>
        {/* Подпись поля — «Цвет»: «Цвет метки» уже стоит заголовком раздела,
            вторым разом строкой ниже он читался повтором (дизайн 12.10). */}
        <ColorField
          label={tr("Цвет")}
          ariaLabel={tr("Цвет метки")}
          value={marker.color}
          swatches={MARKER_SWATCHES}
          editable
          onChange={(color) => onGps({ marker: { color } }, tr("Цвет метки GPS"))}
        />
        <p className="mmc-section-hint">
          {tr("Этим цветом игра красит и значок метки, и линию маршрута к ней — на радаре и на карте паузы. Свой цвет линии — в «Маршруте».")}
        </p>
      </Section>
      <Section title={tr("Значок")}>
        <ChoiceRadioGroup
          label={tr("Значок метки")}
          className="gps-icons"
          value={marker.icon}
          options={options}
          onChange={(icon) => {
            if (icon === "custom" && !marker.assetId) {
              fileRef.current?.click();
              return;
            }
            onGps({ marker: { icon } }, tr("Значок метки GPS"));
          }}
        />
        <input
          ref={fileRef}
          className="lamp-picture-input"
          type="file"
          accept={GPS_ICON_PICTURE_TYPES.join(",")}
          aria-label={tr("Своя картинка значка метки")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onPicture?.(file);
          }}
        />
        <div className="lamp-picture-row">
          <span className="lamp-note">
            {pictureError
              ? pictureError
              : marker.assetId
                ? picture
                  ? tr("Своя картинка выбрана")
                  : tr("Своей картинки нет на этом компьютере — выберите файл заново")
                : tr("Своя картинка: PNG с прозрачностью ложится силуэтом")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<UploadSimple />}
            disabled={pictureBusy}
            onClick={() => fileRef.current?.click()}
          >
            {pictureBusy ? tr("Читаем…") : marker.assetId ? tr("Другая картинка") : tr("Загрузить картинку")}
          </Button>
        </div>
      </Section>
      <Fine>
      <Section title={tr("Размер и прозрачность")}>
        <Slider
          label={tr("Размер метки")}
          value={marker.size}
          min={GPS_MARKER_LIMITS.size.min}
          max={GPS_MARKER_LIMITS.size.max}
          step={GPS_MARKER_LIMITS.size.step}
          format={times}
          onChange={(size) => onGps({ marker: { size } }, tr("Размер метки GPS"))}
        />
        <Slider
          label={tr("Прозрачность метки")}
          value={transparency(marker.opacity)}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(percent) => onGps({ marker: { opacity: opacityOf(percent) } }, tr("Прозрачность метки GPS"))}
        />
        <p className="mmc-section-hint">
          {tr("×1 и 0 % — как в игре; 100 % — метки не видно, линия к ней остаётся. Размер и прозрачность уходят в сам значок метки в minimap.gfx: им игра ставит метку на радар и на карту паузы.")}
        </p>
      </Section>
      </Fine>
    </>
  );
}

/* Образец вида линии на плитке — тем же узором, что уйдёт в игру. */
function LineArt({ style, colour }) {
  const width = 5;
  const pattern = gpsLinePattern({ ...style, style: style.id });
  return (
    <svg width="72" height="20" viewBox="0 0 72 20" aria-hidden="true">
      <line
        x1="6"
        y1="10"
        x2="66"
        y2="10"
        stroke={colour}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={pattern ? pattern.map((value) => value * width).join(" ") : undefined}
      />
    </svg>
  );
}

export function GpsRoutePanel({ gps, onGps, scene }) {
  useTr();
  const copy = useMinimapCopy();
  const model = useRouteModel(scene);
  const icon = useMarkerIcon(gps, scene);
  const { distances } = model;
  const { line } = gps.route;
  const lineColour = line.colorMode === "custom" ? line.color : gps.marker.color;
  const patchLine = (patch, label) => onGps({ route: { line: { ...line, ...patch } } }, label);
  const dashed = ["dashed", "broken", "dashdot"].includes(line.style);
  /* Две готовые картинки вместо перестановки метки (ТЗ 22.10): у каждого варианта — свой путь на одной и той же карте. */
  const saved = distances?.stock > distances?.direct ? distances.stock - distances.direct : 0;
  const accuracyOptions = [
    {
      value: "stock",
      title: tr("Как в игре"),
      description: tr("GPS Rockstar: объезжает односторонние улицы, участки без GPS и закрытые дороги"),
      meta: distances?.stock ? localKilometres(copy, gpsKilometres(distances.stock)) : null,
      media: <RouteFrame model={model} variant="stock" gps={gps} icon={icon} thumb />,
    },
    {
      value: "direct",
      title: tr("Улучшенный"),
      description: tr("Короче и быстрее: все дороги в обе стороны, без запретов GPS"),
      meta: distances?.direct
        ? copy.routeShorter(localKilometres(copy, gpsKilometres(distances.direct)), saved ? localKilometres(copy, gpsKilometres(saved)) : "")
        : null,
      media: <RouteFrame model={model} variant="direct" gps={gps} icon={icon} thumb />,
    },
  ];
  return (
    <>
      <Section title={tr("Точность маршрута")}>
        <ChoiceRadioGroup
          label={tr("Точность маршрута")}
          className="gps-accuracy"
          value={gps.route.accuracy}
          options={accuracyOptions}
          onChange={(accuracy) =>
            onGps(
              { route: { accuracy } },
              accuracy === "direct" ? tr("Маршрут улучшенный") : tr("Маршрут как в игре"),
            )
          }
        />
        <p className="mmc-section-hint">
          {tr("Проверено в игре от площади Легион: с улучшенным маршрутом все шесть путей нашлись и не длиннее штатных — Форт-Занкудо 7,10 → 6,01 км, Палето-Бэй 10,53 → 9,48 км.")}
        </p>
        <p className="mmc-section-hint">
          {tr("Узлы дорог общие у GPS и у машин прохожих: в сюжете и на серверах с трафиком машины поедут по ним в обе стороны в одну полосу. Улицы и их названия остаются вашими.")}
        </p>
      </Section>
      <Fine>
      <Section title={tr("Линия маршрута")}>
        <ChoiceRadioGroup
          label={tr("Вид линии")}
          className="gps-icons gps-line-styles"
          value={line.style}
          options={GPS_LINE_STYLES.map((style) => ({
            value: style.id,
            title: copy.lineStyles[style.id]?.label ?? tr(style.label),
            description: copy.lineStyles[style.id]?.note ?? tr(style.note),
            media: <LineArt style={style} colour={lineColour} />,
          }))}
          onChange={(id) => {
            const style = GPS_LINE_STYLES.find((item) => item.id === id);
            patchLine(
              { style: id, ...(style.dash ? { dash: style.dash } : {}), ...(style.gap ? { gap: style.gap } : {}) },
              copy.lineStyleStep(copy.lineStyles[style.id]?.label ?? tr(style.label)),
            );
          }}
        />
        <Slider
          label={tr("Толщина")}
          value={line.width}
          min={GPS_LINE_LIMITS.width.min}
          max={GPS_LINE_LIMITS.width.max}
          step={GPS_LINE_LIMITS.width.step}
          format={times}
          onChange={(width) => patchLine({ width }, tr("Толщина линии маршрута"))}
        />
        {dashed && (
          <Slider
            label={tr("Длина штриха")}
            value={line.dash}
            min={GPS_LINE_LIMITS.dash.min}
            max={GPS_LINE_LIMITS.dash.max}
            step={GPS_LINE_LIMITS.dash.step}
            format={times}
            onChange={(dash) => patchLine({ dash }, tr("Длина штриха линии маршрута"))}
          />
        )}
        {line.style !== "solid" && (
          <Slider
            label={tr("Промежуток")}
            value={line.gap}
            min={GPS_LINE_LIMITS.gap.min}
            max={GPS_LINE_LIMITS.gap.max}
            step={GPS_LINE_LIMITS.gap.step}
            format={times}
            onChange={(gap) => patchLine({ gap }, tr("Промежуток линии маршрута"))}
          />
        )}
        <Slider
          label={tr("Прозрачность линии")}
          value={transparency(line.opacity)}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(percent) => patchLine({ opacity: opacityOf(percent) }, tr("Прозрачность линии маршрута"))}
        />
        <Toggle
          label={tr("Свой цвет линии")}
          checked={line.colorMode === "custom"}
          onChange={(custom) =>
            patchLine(
              { colorMode: custom ? "custom" : "marker", color: custom && line.color === gps.marker.color ? "#22d3ee" : line.color },
              custom ? tr("Свой цвет линии маршрута") : tr("Линия маршрута — цветом метки"),
            )
          }
        />
        {line.colorMode === "custom" && (
          <ColorField
            label={tr("Цвет линии")}
            value={line.color}
            swatches={MARKER_SWATCHES}
            editable
            onChange={(color) => patchLine({ color }, tr("Цвет линии маршрута"))}
          />
        )}
        <p className="mmc-section-hint" data-gps-route-limits>
          {/* Без внутренностей (18.10.2026, владелец: «тяжёлый текст пугает»):
              что меняется — словами человека, без слоёв и файлов игры. */}
          {tr("Толщина, вид и прозрачность — у всех линий GPS: к метке, заданий и сервера. Свой цвет — только у линии к вашей метке.")}
        </p>
      </Section>
      </Fine>
    </>
  );
}
