/*
 * Панель «Меток и GPS» — настройки взятого инструмента (мастерская «как в
 * Photoshop»): метка, маршрут сервера, точность и шаблоны со «Стандартом».
 *
 * Органы — из словаря (`components/ui`): цвет — `ColorField` с образцами и
 * полем для числа, значок — `ChoiceRadioGroup` (одно из), цвета маршрутов
 * сервера — плитки `ChoiceTile` (сколько угодно из многих), точность —
 * `ChoiceRadioGroup`, готовые виды — `PresetShelf`.
 */

import { useDeferredValue, useRef, useState } from "react";
import { UploadSimple } from "../../../components/ui/icons.jsx";
import { GPS_MARKER_HUD, GPS_MARKER_ICONS, GPS_ROUTE_COLOURS } from "@modovik/minimap-contract/gps";
import Button from "../../../components/ui/Button.jsx";
import ChoiceRadioGroup from "../../../components/ui/ChoiceRadioGroup.jsx";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import PresetShelf, { PresetMarks } from "../../../components/ui/PresetShelf.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { GPS_PRESETS, gpsProjectIsStock, matchingGpsPreset } from "./gps-project.js";
import GpsIconArt from "./GpsIconArt.jsx";
import { GPS_ICON_PICTURE_TYPES } from "./gps-icons.js";
import { gpsKilometres } from "./gps-scene.js";
import { tr, useTr } from "../../../locales/ui.js";

const MARKER_SWATCHES = Object.freeze([GPS_MARKER_HUD.HUD_COLOUR_WAYPOINT, "#e8202a", "#ff7a00", "#ffc21a", "#2bd96b", "#22d3ee", "#2f6bff", "#ff2bd6", "#f0f0f0"]);
const SERVER_SWATCHES = Object.freeze(["#f0c850", "#2bff88", "#22d3ee", "#2f6bff", "#ff2bd6", "#ff7a00", "#e8202a", "#ffffff"]);
const ROUTE_VIEWS = Object.freeze([
  Object.freeze({ value: "main", label: "Частые" }),
  Object.freeze({ value: "all", label: `Все ${GPS_ROUTE_COLOURS.length}` }),
]);

function Section({ id, title, children }) {
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={title} data-gps-section={id}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function MarkerTool({ project, stockImage, picture, pictureBusy, pictureError, onPicture, onMarker }) {
  useTr();
  const fileRef = useRef(null);
  /* Плитки значков догоняют цвет, когда рука на палитре остановилась: живым его ведёт значок в кадре. */
  const tileColor = useDeferredValue(project.marker.color);
  const options = [
    ...GPS_MARKER_ICONS.map((item) => ({
      value: item.id,
      title: item.label,
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
      <Section id="marker-colour" title={tr("Цвет метки")}>
        <ColorField
          label={tr("Цвет метки")}
          value={project.marker.color}
          swatches={MARKER_SWATCHES}
          editable
          onChange={(color) => onMarker({ color }, "Цвет метки")}
        />
        <p className="fx-hint">{tr("Этим цветом игра красит и значок метки, и линию маршрута к ней — на радаре и на карте паузы: отдельного цвета у линии в игре нет.")}</p>
      </Section>
      <Section id="marker-icon" title={tr("Значок")}>
        <ChoiceRadioGroup
          label={tr("Значок метки")}
          className="gps-icons"
          value={project.marker.icon}
          options={options}
          onChange={(icon) => {
            if (icon === "custom" && !project.marker.assetId) {
              fileRef.current?.click();
              return;
            }
            onMarker({ icon }, "Значок метки");
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
              : project.marker.assetId
                ? picture
                  ? tr("Своя картинка выбрана")
                  : tr("Своей картинки нет на этом компьютере — выберите файл заново")
                : tr("Своя картинка: PNG с прозрачностью ложится силуэтом")}
          </span>
          <Button variant="ghost" size="sm" icon={<UploadSimple />} disabled={pictureBusy} onClick={() => fileRef.current?.click()}>
            {pictureBusy ? tr("Читаем…") : project.marker.assetId ? tr("Другая картинка") : tr("Загрузить картинку")}
          </Button>
        </div>
        <p className="fx-hint">{tr("Игра красит значок метки сама: своя картинка становится белым силуэтом с тёмным контуром, цвет — из «Цвета метки».")}</p>
      </Section>
    </>
  );
}

function RouteSwatch({ colour }) {
  return <span className="gps-route-swatch" style={{ background: colour }} />;
}

function ServerTool({ project, baseColours, onServer }) {
  useTr();
  const [view, setView] = useState("main");
  const chosen = new Set(project.server.routes);
  const shown = GPS_ROUTE_COLOURS.filter((item) => view === "all" || item.main || chosen.has(item.hud));
  const shared = GPS_ROUTE_COLOURS.filter((item) => chosen.has(item.hud) && item.shared).map((item) => `${item.label.toLowerCase()} — ${item.shared}`);
  const toggle = (hud) => {
    const next = chosen.has(hud) ? project.server.routes.filter((item) => item !== hud) : [...project.server.routes, hud];
    onServer({ routes: next }, "Маршруты сервера");
  };
  return (
    <>
      <Section id="server-routes" title={tr("Какой маршрут у сервера")}>
        <p className="fx-hint">{tr("Маршрут к значку сервера игра красит цветом этого значка. Отметьте цвет, которым ваш сервер рисует GPS, — он станет своим.")}</p>
        <SegmentedControl label={tr("Какие цвета показать")} size="sm" options={ROUTE_VIEWS} value={view} onChange={setView} />
        <div className="gps-route-grid">
          {shown.map((item) => (
            <ChoiceTile
              key={item.hud}
              className="gps-route-tile"
              media={<RouteSwatch colour={baseColours?.[item.hud] || item.stock} />}
              title={item.label}
              description={`Значки ${item.blips.join(", ")}`}
              selected={chosen.has(item.hud)}
              onClick={() => toggle(item.hud)}
            />
          ))}
        </div>
      </Section>
      <Section id="server-colour" title={tr("Свой цвет маршрута")}>
        <ColorField
          label={tr("Цвет маршрута сервера")}
          value={project.server.color}
          swatches={SERVER_SWATCHES}
          editable
          disabled={!project.server.routes.length}
          onChange={(color) => onServer({ color }, "Цвет маршрута сервера")}
        />
        <p className="fx-hint">
          {project.server.routes.length
            ? `Тем же цветом игра рисует и значки сервера этого цвета.${shared.length ? ` Заодно поменяются: ${shared.join("; ")}.` : ""}`
            : tr("Отметьте выше хотя бы один цвет маршрута сервера.")}
        </p>
        <p className="fx-hint">{tr("Если сервер ведёт к цели меткой (фиолетовая линия), её цвет — в «Метке».")}</p>
      </Section>
    </>
  );
}

function AccuracyTool({ project, distances, onAccuracy }) {
  useTr();
  const options = [
    {
      value: "stock",
      title: tr("Как в игре"),
      description: tr("GPS Rockstar: объезжает односторонние улицы, участки без GPS и закрытые дороги"),
      meta: distances?.stock ? `На кадре: ${gpsKilometres(distances.stock)}` : null,
    },
    {
      value: "direct",
      title: tr("Напрямую — как в paths.rpf"),
      description: tr("Все дороги двусторонние, без запретов GPS: маршрут короче и без петель"),
      meta: distances?.direct ? `На кадре: ${gpsKilometres(distances.direct)}` : null,
    },
  ];
  return (
    <>
      <Section id="accuracy" title={tr("Точность маршрута")}>
        <ChoiceRadioGroup label={tr("Точность маршрута")} className="gps-accuracy" value={project.route.accuracy} options={options} onChange={(accuracy) => onAccuracy(accuracy)} />
        <p className="fx-hint">{tr("Проверено в игре от площади Легион: с «Напрямую» все шесть маршрутов нашлись и не длиннее штатных — Форт-Занкудо 7,10 → 6,01 км, Палето-Бэй 10,53 → 9,48 км, остальные почти те же.")}</p>
        <p className="fx-hint">{tr("Узлы дорог общие у GPS и у машин прохожих: в сюжете и на серверах с трафиком машины поедут по ним в обе стороны в одну полосу. Улицы и их названия остаются вашими.")}</p>
      </Section>
    </>
  );
}

function TemplatesTool({ project, onPreset, onStandard }) {
  useTr();
  const matching = matchingGpsPreset(project);
  return (
    <>
      <Section id="standard" title={tr("Стандарт")}>
        <p className="fx-hint">{tr("Метка, маршруты сервера и узлы дорог — как в игре одним шагом.")}</p>
        <div className="recolor-actions">
          <Button size="sm" variant="secondary" disabled={gpsProjectIsStock(project)} onClick={onStandard}>
            {tr("Стандарт")}
          </Button>
        </div>
      </Section>
      <PresetShelf title={tr("Готовые виды")} label={tr("Готовые виды метки и GPS")} collapsible={false}>
        {GPS_PRESETS.map((preset) => (
          <ChoiceTile
            key={preset.id}
            media={<PresetMarks marks={preset.colours.map((colour, index) => ({ key: `${preset.id}-${index}`, colour, label: colour }))} />}
            title={preset.label}
            description={preset.note}
            selected={matching === preset.id}
            onClick={() => onPreset(preset)}
          />
        ))}
      </PresetShelf>
    </>
  );
}

export default function GpsInspector({
  tool,
  project,
  baseColours,
  distances,
  stockImage,
  picture,
  pictureBusy,
  pictureError,
  onPicture,
  onMarker,
  onServer,
  onAccuracy,
  onPreset,
  onStandard,
}) {
  if (tool === "server") return <ServerTool project={project} baseColours={baseColours} onServer={onServer} />;
  if (tool === "accuracy") return <AccuracyTool project={project} distances={distances} onAccuracy={onAccuracy} />;
  if (tool === "templates") return <TemplatesTool project={project} onPreset={onPreset} onStandard={onStandard} />;
  return (
    <MarkerTool
      project={project}
      stockImage={stockImage}
      picture={picture}
      pictureBusy={pictureBusy}
      pictureError={pictureError}
      onPicture={onPicture}
      onMarker={onMarker}
    />
  );
}
