// Рисование на карте: значки, перо и фигуры, ластик, мазки, кисть, вид фигуры
// и надписи, размер и форма выбранной зоны.
import { useRef, useMemo } from "react";
import { tr } from "../../../../locales/ui.js";
import { addMarker, addZone, addShapeZone, eraseObjects, findObject, addStroke, resizeZoneShape, reshapeZone } from "../world-map-editing.js";
import { mapText } from "../world-map/map-copy.js";
import { nextLabel, roundPoint } from "./map-helpers.js";

// Зон на карте, начиная с которых неудачная фигура объясняется пределом (не 600!)
const SHAPE_LIMIT_HINT = 240;
const PEN_MIN_POINTS = 3;

// Режим кисти по инструменту: «Линия» и «Стрелка» рисуют той же кистью
const BRUSH_MODES = new Map([
  ["line", () => "line"],
  ["arrow", (both) => (both ? "arrows" : "arrow")],
]);

export const brushModeOf = (tool, arrowBoth) => BRUSH_MODES.get(tool)?.(arrowBoth) ?? "free";

// Подпись шага истории для мазка: свободный, прямая, всё остальное — стрелка
const strokeLabel = (mode) =>
  mode === "free" ? tr("Мазок кистью") : mode === "line" ? tr("Линия") : tr("Стрелка");

// Все команды рисования собираются заново на каждой отрисовке и читают свежее состояние
function makeCommands(d) {
  const { config } = d;

  const zoneLook = () => {
    const { line, fill, width, color } = d.shapeTool;
    const look = { line, fill, width };
    return color ? { ...look, color } : look;
  };

  // Значок текущей категории с подписью из памяти; подпись растёт на единицу
  const placeMarker = (world) => {
    const name = d.markerLabel.trim();
    const made = addMarker(config, world, { category: d.markerCategory, name: name || undefined });
    d.apply(made.config, tr("Добавлено обозначение"));
    d.setMarkerLabel(nextLabel(d.markerLabel));
    d.setPicked([made.selection]);
  };

  const places = new Map([
    ["text", (world) => {
      if (d.placeWouldOverflow) d.notify(tr("На карте уже предельное число надписей и картинок"));
      else d.beginPrint(world);
    }],
    ["images", (world) => d.askForPicture(world)],
    ["markers", placeMarker],
  ]);

  // Замыкание пера: меньше трёх вершин зоны не даёт, черновик очищается всегда
  const closeDraft = () => {
    if (d.draft.length >= PEN_MIN_POINTS) {
      const made = addZone(config, d.draft, undefined, zoneLook());
      if (made.selection) {
        d.apply(made.config, tr("Добавлена зона"));
        d.setPicked([made.selection]);
      } else {
        d.notify(tr("На карте уже предельное число зон"));
      }
    }
    d.setDraft([]);
  };

  const zoneChosen = d.selection?.kind === "zone";

  return {
    placeMarker,
    placeMarkerAndTake: (world) => {
      placeMarker(world);
      d.chooseTool("markers");
    },
    onPlace: (which, world) => places.get(which)?.(world),
    closeDraft,
    onDraftPoint: (world) => (world ? d.setDraft([...d.draft, roundPoint(world)]) : closeDraft()),
    onShape: (box) => {
      const made = addShapeZone(config, d.shapeTool.shape, box, zoneLook());
      if (made.selection) {
        d.apply(made.config, tr("Добавлена фигура"));
        d.setPicked([made.selection]);
        return;
      }
      const crowded = config.zones.items.length >= SHAPE_LIMIT_HINT;
      d.notify(
        crowded ? tr("На карте уже предельное число зон") : tr("Фигура слишком маленькая — растяните её побольше"),
      );
    },
    onErase: (points) => {
      if (!points?.length) return;
      const erased = eraseObjects(config, points, d.eraserSize / 2, { textAdvance: d.textAdvance });
      if (!erased.removed) return;
      d.apply(erased.config, mapText("Стёрто: {count}", { count: erased.removed }));
      if (d.selection && !findObject(erased.config, d.selection)) d.setPicked([]);
    },
    onStroke: (points, fit, mode = brushModeOf(d.tool, d.arrowBoth)) => {
      const made = addStroke(config, points, config.paint.brush, fit, mode);
      if (made.selection) d.apply(made.config, strokeLabel(mode));
      else if (!made.tooShort) d.notify(tr("Кисть уже нарисовала предельное число мазков"));
    },
    onBrush: (patch) => {
      const brush = { ...config.paint.brush, ...patch };
      const key = Object.keys(patch)[0] || "brush";
      d.apply({ ...config, paint: { ...config.paint, enabled: true, brush } }, tr("Кисть"), `paint.brush.${key}`);
    },
    onShapeTool: (patch) => {
      d.setShapeTool({ ...d.shapeTool, ...patch });
      if ("shape" in patch) d.setDraft([]);
    },
    onTextStyle: (patch) => d.setTextStyle({ ...d.textStyle, ...patch }),
    onZoneBox: (box, label) => {
      if (zoneChosen) d.apply(resizeZoneShape(config, d.selection, box), label, `zone.box.${d.selection.id}`);
    },
    onReshape: (shape) => {
      if (zoneChosen) d.apply(reshapeZone(config, d.selection, shape), tr("Форма зоны"), "zone.shape");
    },
  };
}

const COMMAND_NAMES = [
  "placeMarker", "placeMarkerAndTake", "onPlace", "closeDraft", "onDraftPoint", "onShape", "onErase",
  "onStroke", "onBrush", "onShapeTool", "onTextStyle", "onZoneBox", "onReshape",
];

export function usePlacing(deps) {
  const latest = useRef(null);
  latest.current = makeCommands(deps);

  // Наружу уходят устойчивые обёртки: меню в колонке и кадр живут дольше одной отрисовки
  const commands = useMemo(
    () =>
      Object.fromEntries(
        COMMAND_NAMES.map((name) => [name, (...args) => latest.current[name](...args)]),
      ),
    [],
  );

  return { brushMode: brushModeOf(deps.tool, deps.arrowBoth), ...commands, onBrushLatest: commands.onBrush };
}
