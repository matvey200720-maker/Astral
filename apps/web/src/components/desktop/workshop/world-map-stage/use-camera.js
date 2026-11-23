// Проводка камеры к React: снимок последней отрисовки для контроллера, сообщения наверх,
// пробел, колесо, клавиши, команда панели «Зум карты», показ объекта.
import { FOCUS_FIELD, KEY_PAN, SPACE_TARGET_SKIP, ZOOM_STEP } from "./numbers.js";
import { motionOff } from "./motion-switch.js";
import { boundsInSight, viewAroundBounds } from "./frame-math.js";
import { createFloorSync } from "./camera-floor.js";
import { createCameraController } from "./camera-controller.js";
import { useSceneWheel } from "../../../ui/useSceneWheel.js";
import { objectBounds } from "../world-map-editing.js";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const NEVER = Symbol("never-ran");
const own = Object.hasOwn;
const STEP_BACK = 1 / ZOOM_STEP;
/* Листы поверх кадра, что листаются сами («Иконки», 16.11.2026: сетка «Все значки игры» не листалась): колесо над
   ними камера не берёт и не гасит. Лист помечается `data-wheel-own`. */
const OWN_WHEEL_SHEET = "[data-wheel-own]";

// Производное значение: make(input) пересчитывается, только когда сменился input
const useMade = (make, input) => useMemo(() => make(input), [make, input]);

// Есть ли у подписей меток этажи: тогда слою подписей нужна метка порога читаемости
function hasFloorLabels(scene) {
  const [labels] = (scene.layers ?? []).filter((layer) => layer.id === "marker-labels");
  return (labels?.items ?? []).some((item) => item.floor > 0);
}

// ——— клавиши: клавиша → действие; стрелки сдвигают, только если ничего не выбрано ———
const zoomKey = (factor) => (ctl, event) => {
  event.preventDefault();
  ctl.zoomBy(factor);
};

const arrowKey = (sx, sy) => (ctl, event, selection) => {
  if (selection) return;
  const reach = event.shiftKey ? KEY_PAN.fast : KEY_PAN.plain;
  event.preventDefault();
  ctl.nudge(sx * reach, sy * reach);
};

const KEY_ACTIONS = {
  "+": zoomKey(ZOOM_STEP),
  "=": zoomKey(ZOOM_STEP),
  "-": zoomKey(STEP_BACK),
  _: zoomKey(STEP_BACK),
  ArrowLeft: arrowKey(-1, 0),
  ArrowRight: arrowKey(1, 0),
  ArrowUp: arrowKey(0, -1),
  ArrowDown: arrowKey(0, 1),
};

// Клавиши на самом корне
function keyboardFor(ctl, selection) {
  return (event) => {
    const aimedHere = event.target === event.currentTarget;
    if (!aimedHere || event.ctrlKey || event.metaKey || event.altKey) return;
    if (own(KEY_ACTIONS, event.key)) KEY_ACTIONS[event.key](ctl, event, selection);
  };
}

// Команда панели «Зум карты» (неизвестный тип = шаг назад)
const COMMANDS = {
  fit: (ctl) => ctl.goHome(),
  frame: (ctl, cmd, around) =>
    cmd.world ? ctl.flyTo(around(cmd.world, FOCUS_FIELD.frame)) : ctl.goHome(),
  in: (ctl) => ctl.zoomBy(ZOOM_STEP),
};
const commandBack = (ctl) => ctl.zoomBy(STEP_BACK);

// Контроллер и слой подписей живут дольше любой отрисовки и читают её снимок через `read`
function makeRig(nodes, read) {
  const svg = () => nodes.svg.current;
  const floor = createFloorSync({ svg, snap: read, hasFloor: () => read().hasFloor });
  const ctl = createCameraController({
    snap: read,
    svg,
    stage: () => nodes.stage.current,
    writeView: (next) => read().setView(next),
    motionOff,
    floor,
    onView: (payload) => read().onViewChange?.(payload),
    onZoom: (zoom, dots) => read().onZoomChange?.(zoom, dots),
  });
  return { ctl, floor };
}

// Снимок последней отрисовки: ссылка обновляется до эффектов и читается контроллером
function useLatest(snapshot) {
  const latest = useRef(null);
  latest.current ??= snapshot;
  useLayoutEffect(() => {
    latest.current = snapshot;
  });
  return latest;
}

// Сообщения наверх и уборка: кадр - со сменой чисел кадра и окна,
// масштаб - когда нет жеста и перелёта
function useTellUp(parts) {
  const { ctl, floor, latest, frame, win } = parts;
  const { canvas, scene, view, hasFloor } = parts;
  // Трансформ живого кадра и метка подписей подстраиваются под новый холст
  useLayoutEffect(() => {
    ctl.sync();
  }, [ctl, view, canvas, scene, win, hasFloor]);

  const tellFrame = () => ctl.tellFrame(latest.current.frame);
  useEffect(tellFrame, [
    ctl,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    frame.zoom,
    win.width,
    win.height,
    latest,
  ]);

  const tellZoom = () => {
    if (ctl.isMoving()) return;
    ctl.tellZoomNow(latest.current.frame.zoom);
  };
  useEffect(tellZoom, [ctl, frame.zoom, scene.width, scene.height, win.height, latest]);

  useEffect(() => () => [ctl, floor].forEach((part) => part.dispose()), [ctl, floor]);
}

// Подписка на все события разом; возвращает отписку
function listenAll(target, handlers) {
  const pairs = Object.entries(handlers);
  pairs.forEach(([name, handler]) => target.addEventListener(name, handler));
  return () => pairs.forEach(([name, handler]) => target.removeEventListener(name, handler));
}

// Пробел не должен перехватываться в полях ввода и на кнопках
const spaceIsFree = ({ target }) =>
  Boolean(target) && !target.isContentEditable && !target.closest?.(SPACE_TARGET_SKIP);

// Пробел включает «руку»
function useSpaceHand() {
  const [space, setSpace] = useState(false);
  const spaceRef = useRef(false);
  useEffect(() => {
    const hold = (on) => {
      spaceRef.current = on;
      setSpace(on);
    };
    return listenAll(window, {
      keydown: (event) => {
        const pressed = event.code === "Space" && !event.repeat && spaceIsFree(event);
        if (!pressed) return;
        event.preventDefault();
        hold(true);
      },
      keyup: (event) => event.code === "Space" && hold(false),
      blur: () => hold(false),
    });
  }, []);
  return { space, spaceRef };
}

// Новая отметка команды или показа: первая запоминается и с undefined
function takeStamp(source, memo) {
  if (!source || source.stamp === memo.current) return false;
  memo.current = source.stamp;
  return true;
}

const sightOf = ({ projector, scene, win }) => ({ projector, scene, win });

// Команда панели: один раз на новый stamp
function usePanelCommand(ctl, zoomCommand, around) {
  const lastStamp = useRef(NEVER);
  useEffect(() => {
    if (!takeStamp(zoomCommand, lastStamp)) return;
    ctl.stopWheel();
    const run = own(COMMANDS, zoomCommand.type) ? COMMANDS[zoomCommand.type] : commandBack;
    run(ctl, zoomCommand, around);
  }, [ctl, zoomCommand, around]);
}

// Показ объекта: до отрисовки, чтобы перелёт успел сдвинуть появление нового к прилёту
function useFocusShow({ ctl, focus, around, latest }) {
  const lastFocus = useRef(NEVER);
  useLayoutEffect(() => {
    if (!takeStamp(focus, lastFocus)) return;
    const bounds = focus.object && objectBounds(focus.object, focus.kind);
    if (!bounds) return;
    const { ifHidden, object } = focus;
    const checkSight = Boolean(ifHidden) && Boolean(object.points);
    if (checkSight && boundsInSight(bounds, ctl.current(), latest.current.projector)) return;
    ctl.flyTo(around(bounds, ifHidden ? FOCUS_FIELD.hidden : FOCUS_FIELD.show));
  }, [ctl, focus, around, latest]);
}

export function useCamera(props) {
  const { scene, win, geo, svgRef, stageRef, zoomCommand, focus, selection } = props;
  const { frame, canvas, projector, view, setView } = geo;
  const { onViewChange, onZoomChange } = props.callbacks;

  const hasFloor = useMade(hasFloorLabels, scene);
  const latest = useLatest({
    frame, canvas, scene, win, projector, hasFloor, onViewChange, onZoomChange, setView,
  });
  const [{ ctl, floor }] = useState(() =>
    makeRig({ svg: svgRef, stage: stageRef }, () => latest.current),
  );

  useTellUp({ ctl, floor, latest, frame, win, canvas, scene, view, hasFloor });
  const { space, spaceRef } = useSpaceHand();

  // Колесо и щипок
  const onWheel = useCallback((intent, event) => ctl.onWheel(intent, event), [ctl]);
  useSceneWheel(stageRef, onWheel, { ignore: OWN_WHEEL_SHEET });

  const around = useCallback(
    (bounds, margin) => viewAroundBounds(bounds, margin, sightOf(latest.current)),
    [latest],
  );
  usePanelCommand(ctl, zoomCommand, around);
  useFocusShow({ ctl, focus, around, latest });

  return { ctl, space, spaceRef, onKeyDown: keyboardFor(ctl, selection), hasFloor };
}
