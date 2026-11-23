// Обработчики указателя холста: нажатие идёт по таблице правил, движение и отпускание - по
// таблице режимов перетаскивания. Собираются заново на каждую отрисовку: читают свежий env.
import { DRAW_MODES } from "./modes-draw.js";
import { EDIT_MODES } from "./modes-edit.js";
import { VIEW_MODES, startPan } from "./modes-view.js";
import { grabPointer, releasePointer } from "./use-pointer-state.js";
import { pressOnMap } from "./press-rules.js";

const MODES = { ...VIEW_MODES, ...EDIT_MODES, ...DRAW_MODES };

// Роутер живёт одну отрисовку: env, наведение и текстовые инструменты берёт из неё же
class PointerRouter {
  // Что делает нажатие: сдвиг рукой, пропуск, закрытие поля печати или обычное нажатие по карте
  #routes = {
    pan: (event, button) => {
      event.preventDefault();
      this.#take(event);
      startPan(this.env, event, button);
    },
    skip: () => {},
    close: (event) => {
      event.preventDefault();
      this.env.textEdit.onDone();
    },
    press: (event) => this.#pressOnMap(event),
  };

  constructor(env, hover, text) {
    Object.assign(this, { env, hover, text });
  }

  // Кнопка сдвига рукой: 1 или 2; null - левая с пробелом; undefined - не сдвиг
  #handButton({ button }) {
    if (button === 1 || button === 2) return button;
    if (button === 0 && this.env.spaceRef.current) return null;
    return undefined;
  }

  #routeOf(event) {
    const hand = this.#handButton(event);
    if (hand !== undefined) return ["pan", hand];
    if (event.button !== 0) return ["skip"];
    return [this.env.textEdit ? "close" : "press"];
  }

  // Кольцо ластика или кисти идёт за курсором (и с нажатой кнопкой тоже)
  #followRing({ clientX, clientY }) {
    const { ring } = this.env.nodes.current;
    if (!ring) return;
    const spot = this.env.projector.point(this.env.worldAt(clientX, clientY));
    const marks = { cx: spot.x, cy: spot.y, visibility: "visible" };
    Object.entries(marks).forEach(([name, value]) => ring.setAttribute(name, value));
  }

  // Указатель захвачен холстом, наведение сброшено
  #take(event) {
    grabPointer(event.currentTarget, event.pointerId);
    this.hover.reset();
  }

  #pressOnMap(event) {
    const { env } = this;
    const point = env.sceneAt(event.clientX, event.clientY);
    const world = env.toWorld(point);
    this.#take(event);
    pressOnMap(env, { event, point, world, shift: event.shiftKey, alt: event.altKey });
  }

  down = (event) => {
    this.env.ctl.halt();
    const [route, button] = this.#routeOf(event);
    this.#routes[route](event, button);
  };

  move = (event) => {
    this.#followRing(event);
    const mode = this.env.dragRef.current;
    return mode ? MODES[mode.kind].move(mode, this.env, event) : this.hover.track(this.env, event);
  };

  // Отпускание и отмена различаются только флагом для режима
  #release(event, cancelled) {
    const { env } = this;
    releasePointer(event.currentTarget, event.pointerId);
    const mode = env.dragRef.current;
    if (mode) {
      env.dragRef.current = null;
      env.setDragging(false);
      MODES[mode.kind].up?.(mode, env, event, cancelled);
    }
  }

  up = (event) => this.#release(event, false);

  cancel = (event) => this.#release(event, true);

  menu = (event) => event.preventDefault();

  leave = () => {
    this.hover.reset();
    const { ring } = this.env.nodes.current;
    ring?.setAttribute("visibility", "hidden");
  };

  // Двойной щелчок: правка надписи, затем табло, затем подписи, затем замыкание зоны
  double = ({ clientX, clientY }) => {
    const { env, text } = this;
    const point = env.sceneAt(clientX, clientY);
    const handled =
      text.editTextAt(env.toWorld(point)) || text.openBoardAt(point) || text.openLabelAt(point);
    if (!handled && env.tool === "zones" && env.shape === "free") env.onDraftPoint(null);
  };
}

export function pointerHandlers(env, hover, text) {
  const router = new PointerRouter(env, hover, text);
  return {
    onPointerDown: router.down,
    onPointerMove: router.move,
    onPointerUp: router.up,
    onPointerCancel: router.cancel,
    onContextMenu: router.menu,
    onPointerLeave: router.leave,
    onDoubleClick: router.double,
  };
}
