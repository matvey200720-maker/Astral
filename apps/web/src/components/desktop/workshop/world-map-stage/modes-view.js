// Режимы, которые двигают взгляд, а не объекты: сдвиг карты рукой и рамка выделения.
import { hitTest, objectsInRect } from "../world-map-editing.js";
import { majesticHitAt, meshHitAt } from "./donor-hits.js";
import { CLICK_SLOP } from "./numbers.js";

// Сдвиг карты. `button`: 1 или 2 — кнопка мыши, `null` — левая с пробелом либо от пустого места
export function startPan(env, event, button) {
  const pan = env.ctl.beginPan(event.clientX, event.clientY);
  env.dragRef.current = { kind: "pan", pan, button };
}

// Правая кнопка без сдвига: попадание (в том числе по закреплённому) и меню действий
function openObjectMenu(env, event) {
  const world = env.worldAt(event.clientX, event.clientY);
  const hit = hitTest(env.config, "all", world, env.tolerance, env.preferLayer, { includeLocked: true });
  if (hit) env.onSelect(hit);
  env.onObjectMenu({ hit: hit || null, world, x: event.clientX, y: event.clientY });
}

// Левый щелчок без сдвига у «Подписей» и «Меток Majestic» выбирает метку под местом отпускания
const RELEASE_PICKS = {
  labels: (env, world) => {
    if (env.onMeshPick && env.config.markers?.enabled) env.onMeshPick(meshHitAt(env, world));
  },
  majestic: (env, world) => {
    if (env.onMajesticPick) env.onMajesticPick(majesticHitAt(env, world));
  },
};

const PAN_MODE = {
  move(mode, env, event) {
    env.ctl.dragPan(mode.pan, event.clientX, event.clientY);
  },
  up(mode, env, event, cancelled) {
    env.ctl.settle(true);
    const still = !mode.pan.moved;
    if (still && mode.button === 2 && env.onObjectMenu) openObjectMenu(env, event);
    const known = Object.prototype.hasOwnProperty.call(RELEASE_PICKS, env.tool);
    const pick = known ? RELEASE_PICKS[env.tool] : null;
    if (still && !cancelled && mode.button !== 2 && pick) {
      pick(env, env.worldAt(event.clientX, event.clientY));
    }
  },
};

// Рамка выделения (Shift у «Выбора»): в состоянии только два угла в мире
export function startMarquee(env, event, world, under) {
  env.dragRef.current = {
    kind: "marquee",
    a: world,
    b: world,
    from: { x: event.clientX, y: event.clientY },
    last: { x: event.clientX, y: event.clientY },
    under: under ? { kind: under.kind, id: under.id } : null,
  };
  env.setMarquee({ a: world, b: world });
}

const MARQUEE_MODE = {
  move(mode, env, event) {
    mode.b = env.worldAt(event.clientX, event.clientY);
    mode.last = { x: event.clientX, y: event.clientY };
    env.setMarquee({ a: mode.a, b: mode.b });
  },
  up(mode, env, event, cancelled) {
    env.setMarquee(null);
    const at = cancelled ? mode.last : { x: event.clientX, y: event.clientY };
    const dragged = Math.hypot(at.x - mode.from.x, at.y - mode.from.y) > CLICK_SLOP;
    if (dragged) {
      env.onSelectMany(objectsInRect(env.config, { a: mode.a, b: mode.b }), { additive: true });
    } else if (mode.under) {
      env.onSelect(mode.under, { additive: true });
    }
  },
};

export const VIEW_MODES = { pan: PAN_MODE, marquee: MARQUEE_MODE };
