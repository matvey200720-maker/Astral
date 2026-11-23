/*
 * Панель зон каптов — настройки взятого инструмента (мастерская «как в
 * Photoshop»). Какую зону править, выбирают над кадром: «Все зоны» —
 * правка ложится на все четырнадцать сразу (и на те, у кого был свой облик),
 * зона — только на неё, поверх общего.
 *
 * «Цвет» — общее поле мастерской (`ColourEffectField`: ровный, градиент,
 * радуга, перелив, линия двумя цветами; направления — по кругу, с запада на
 * восток, снизу вверх) и список зон с их обликом. «Прозрачность» — от
 * сплошной до невидимой (невидимая в игру не едет). «Свечение» — яркость
 * шейдера у всех зон. «Стенка» — высота над серединой зоны и крыша.
 * «Дальность» — с какого расстояния зону видно. «Шаблоны» — готовые виды.
 * Под настройками — «Как в моде» (облик автора) и «Как в игре» (зон Astral в
 * игре нет).
 *
 * Органы — из словаря (`components/ui`): группа `ListGroup` без повторного
 * заголовка, ползунки одной группой, дальность строками (второй круг
 * 30.10.2026).
 */

import {
  CAPT_ZONES,
  CAPT_ZONES_DIRECTIONS,
  CAPT_ZONES_LIMITS,
  CAPT_ZONES_MOD,
  captZoneLook,
  captZoneTop,
  findCaptZone,
} from "@modovik/climb-contract/recolor/capt-zones";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ListGroup, { ListRow, ListSwatch } from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import EffectSegmentField from "../effect-segment-field.jsx";
import ChoiceRows from "../choice-rows.jsx";
import CaptZonesPresets from "./CaptZonesPresets.jsx";
import {
  ALL_ZONES,
  CAPT_ZONES_SWATCHES,
  DISTANCE_STOPS,
  distanceHint,
  distanceText,
  glowText,
  metresText,
  opacityOf,
  percentText,
  targetZone,
  transparencyHint,
  transparencyOf,
  zoneRow,
  zonesCountText,
  zonesWithOwn,
} from "./capt-zones-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

const namesOf = (zones) => zones.map((zone) => zone.label).join(", ");

/* Зоны списком: имя, кружок цвета и — только у зоны со своим обликом — что именно своё; нажал — правишь её. */
function ZoneRows({ project, target, onTarget }) {
  useTr();
  return (
    <ListGroup title={tr("Зоны каптов")}>
      {CAPT_ZONES.map((zone) => {
        const row = zoneRow(project, zone);
        const on = zone.id === target;
        return (
          <NavRow
            key={zone.id}
            className={on ? "is-selected" : ""}
            aria-pressed={on}
            title={tr(zone.label)}
            caption={row.state}
            trailing={<ListSwatch colour={row.swatch} />}
            onOpen={() => onTarget(zone.id)}
          />
        );
      })}
    </ListGroup>
  );
}

/* Назад к «Всем зонам» — строкой под настройками зоны. */
function AllZonesRow({ onTarget }) {
  return (
    <ListGroup>
      <ListRow title={tr("Все зоны")} onOpen={() => onTarget(ALL_ZONES)} />
    </ListGroup>
  );
}

function ColourSection({ project, target, onTarget, onAll, onZone }) {
  useTr();
  const zone = targetZone(target);
  if (!zone) {
    const own = zonesWithOwn(project, "look");
    return (
      <>
        <ListGroup
          plain
          label={tr("Цвет зон")}
          help={[
            project.look.mode === "solid" ? null : tr("«По кругу» — вдоль стенки вокруг зоны, «снизу вверх» — от земли до верха стенки."),
            trFill("Цвет ляжет на все {0} сразу.", zonesCountText(CAPT_ZONES.length)),
            own.length ? trFill(own.length === 1 ? "И на зону со своим цветом: {0}." : "И на зоны со своим цветом: {0}.", namesOf(own)) : null,
            tr("У мода — оранжевый, у Муравейника краснее. Свой цвет одной зоны — выберите её в списке или над кадром."),
          ]}
        >
          <EffectSegmentField
            label={tr("Цвет зон")}
            value={project.look}
            swatches={CAPT_ZONES_SWATCHES}
            directionLabels={CAPT_ZONES_DIRECTIONS}
            onChange={(look, step) => onAll({ look }, step)}
          />
        </ListGroup>
        <ZoneRows project={project} target={target} onTarget={onTarget} />
      </>
    );
  }
  const look = captZoneLook(project, zone);
  return (
    <>
      <ListGroup plain title={trFill("Зона «{0}»", tr(zone.label))} label={tr("Цвет зоны")} help={trFill("{0}. Свой цвет ляжет только на эту зону — поверх общего.", tr(zone.place))}>
        <EffectSegmentField
          label={tr("Цвет зоны")}
          value={look.effect}
          swatches={CAPT_ZONES_SWATCHES}
          directionLabels={CAPT_ZONES_DIRECTIONS}
          onChange={(next, step) => onZone(zone.id, { look: next }, step)}
        />
      </ListGroup>
      <AllZonesRow onTarget={onTarget} />
    </>
  );
}

/* Вид: прозрачность (у зоны в кадре — своя), свечение, стенка и крыша — одной группой ползунков без повторных заголовков; дальность — строками ниже. */
function LookSection({ project, target, onTarget, onAll, onZone }) {
  useTr();
  const zone = targetZone(target);
  const look = zone ? captZoneLook(project, zone) : null;
  const transparency = transparencyOf(zone ? look.opacity : project.opacity);
  const hint = transparencyHint(transparency);
  const alarming = Boolean(hint.warning) || transparency >= 100;
  const own = zonesWithOwn(project, "opacity");
  const setOpacity = (value) => {
    const next = opacityOf(value);
    if (zone) onZone(zone.id, { opacity: next }, `Прозрачность зоны «${zone.label}»`);
    else onAll({ opacity: next }, "Прозрачность всех зон");
  };
  const stopped = DISTANCE_STOPS.some((item) => item.value === project.distance);
  /* Дальность, которой нет среди быстрых (старая работа), остаётся отдельной взятой строкой: значение не теряется. */
  const distances = [
    ...DISTANCE_STOPS.map((item) => ({ value: item.value, label: tr(item.label) })),
    ...(stopped ? [] : [{ value: project.distance, label: trFill("Своя: {0}", distanceText(project.distance)) }]),
  ];
  const opacity = (
    <>
      <Slider label={tr("Прозрачность")} value={transparency} min={0} max={100} step={1} format={percentText} onChange={setOpacity} />
      {/* Предупреждение (зона не видна совсем, почти сплошной цвет) остаётся на виду; описание значения — под «?». */}
      {alarming && <p className="fx-hint is-warning">{hint.text}</p>}
    </>
  );
  const opacityHelp = [
    alarming ? null : hint.text,
    trFill("0 % — сплошной цвет, 100 % — зоны не видно. У мода — {0}, у Муравейника гуще.", percentText(transparencyOf(CAPT_ZONES_MOD.opacity))),
    !zone && own.length ? trFill(" Прозрачность ляжет на все зоны сразу — и на {0} со своей ({1}).", own.length === 1 ? tr("зону") : tr("зоны"), namesOf(own)).trim() : null,
  ];
  const wall = findCaptZone(zone ? zone.id : "farm");
  return (
    <>
      {zone && (
        <ListGroup plain title={trFill("Зона «{0}»", tr(zone.label))} label={tr("Прозрачность зоны")} help={opacityHelp}>
          {opacity}
        </ListGroup>
      )}
      <ListGroup
        plain
        title={zone ? tr("Все зоны") : ""}
        label={tr("Вид зон")}
        help={[
          ...(zone ? [] : opacityHelp),
          trFill("Насколько ярко зоны светятся сами — днём и особенно ночью; у всех зон одно. У мода — {0}. 0 — без свечения: стенка станет тёмной дымкой.", glowText(CAPT_ZONES_MOD.glow)),
          trFill("Доля высоты мода, у всех зон сразу: у зоны «{0}» верх стенки — {1} над серединой (у мода {2}). Под землёй стенка остаётся модовой — на склонах и в низинах край виден от любой точки земли.", tr(wall.label), metresText(captZoneTop(wall, project)), metresText(wall.top)),
          tr("Крыша — потолок зоны: изнутри небо видно сквозь дымку. Без крыши остаётся кольцо стенки."),
        ]}
      >
        {!zone && opacity}
        <Slider
          label={tr("Свечение")}
          value={project.glow}
          min={CAPT_ZONES_LIMITS.glow[0]}
          max={CAPT_ZONES_LIMITS.glow[1]}
          step={0.1}
          format={glowText}
          onChange={(glow) => onAll({ glow }, "Свечение зон")}
        />
        <Slider
          label={tr("Высота стенки")}
          value={project.height}
          min={CAPT_ZONES_LIMITS.height[0]}
          max={CAPT_ZONES_LIMITS.height[1]}
          step={5}
          format={percentText}
          onChange={(height) => onAll({ height }, "Высота стенки")}
        />
        <SwitchLine checked={project.roof} label={tr("Крыша")} onChange={(roof) => onAll({ roof }, roof ? tr("Крыша зон") : tr("Зоны без крыши"))} />
      </ListGroup>
      {/* Дальность — один орган, строками: пять быстрых значений в сегмент не влезали и переносились. */}
      <ChoiceRows
        title={tr("Дальность прорисовки")}
        label={tr("Дальность прорисовки")}
        help={distanceHint(project, zone)}
        options={distances}
        value={project.distance}
        onChange={(distance) => onAll({ distance }, "Дальность зон")}
      />
      {zone && <AllZonesRow onTarget={onTarget} />}
    </>
  );
}

export default function CaptZonesInspector({
  tool = "colour",
  project,
  presetProject = project,
  target = ALL_ZONES,
  onTarget,
  onAll,
  onZone,
  onZoneReset,
  onPreset,
  onStandard,
  onEnable,
  onReset,
  isMod = false,
}) {
  useTr();
  const zone = targetZone(target);
  const zoneOwn = zone ? captZoneLook(project, zone).own : null;
  let body;
  if (tool === "colour") body = <ColourSection project={project} target={target} onTarget={onTarget} onAll={onAll} onZone={onZone} />;
  else if (tool === "look") body = <LookSection project={project} target={target} onTarget={onTarget} onAll={onAll} onZone={onZone} />;
  else body = <CaptZonesPresets project={presetProject} target={target} onApply={onPreset} />;
  return (
    <div className="fx-inspector recolor-inspector">
      {body}
      {/* Сброс — внизу одной карточкой и только когда он доступен (ТЗ 29.10.2026, вечер). */}
      {tool !== "templates" && (
        <ActionRows
          actions={[
            tool === "colour" && zoneOwn?.look && { id: "zone-look-reset", label: tr("Как у всех зон"), onClick: () => onZoneReset(zone.id, "look") },
            tool === "look" && zoneOwn?.opacity && { id: "zone-opacity-reset", label: tr("Как у всех зон"), onClick: () => onZoneReset(zone.id, "opacity") },
            !isMod && { id: "mod", label: tr("Облик мода"), title: tr("Облик автора мода: оранжевая дымка, у Муравейника гуще"), onClick: onReset },
            project.enabled
              ? { id: "no-zones", label: tr("Как в игре"), title: tr("Зон каптов Astral в игре не будет: «Применить» снимет их"), onClick: onStandard }
              : { id: "restore-zones", label: tr("Вернуть зоны"), title: tr("Зоны вернутся в облике работы"), onClick: onEnable },
          ]}
        />
      )}
    </div>
  );
}
