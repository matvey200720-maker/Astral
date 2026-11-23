import { useEffect, useState, useSyncExternalStore } from "react";
import { desktopHost } from "./api.js";

// Внимание окна (24.09.2026): сцены и циклы кадров не должны рисовать в
// свёрнутом окне и пока человек отошёл. Правило 4 docs/3D.md: свой бесконечный
// цикл не заводить, подписываться на ворота отсюда. Порядок: от высшего к низшему.
const ORDER = ["active", "idle", "passive", "hidden"];
export const [ATTENTION_ACTIVE, ATTENTION_IDLE, ATTENTION_PASSIVE, ATTENTION_HIDDEN] = ORDER;
export const [POWER_NORMAL, POWER_SAVER, POWER_HOT] = ["normal", "saver", "hot"];
// SETTLE_MS с запасом над самым долгим появлением экрана (0,48 с); подъём при этом мгновенный.
export const IDLE_AFTER_MS = 60000, SETTLE_MS = 600;

// Две оси (внимание, питание) в массивах: значение, слушатели и имя атрибута на <html>.
const KEYS = ["attention", "power"];
const cur = [ATTENTION_ACTIVE, POWER_NORMAL];
const fans = [new Set(), new Set()];
let pin = null;
let live = null;
// Слежка одна на приложение, а заведших её несколько (оболочка и стенд замера): отписка
// одного не должна выключать её для другого.
const owners = new Set();

const push = (i, v) => {
  if (cur[i] === v) return;
  cur[i] = v;
  // Атрибуты для таблиц стилей пишутся только при слежке; без неё окно считается активным.
  if (live) document.documentElement.dataset[KEYS[i]] = v;
  [...fans[i]].forEach((f) => f(v)); // обход по снимку: подписки изнутри касаются следующего раза
};
const sub = (i) => (f) => {
  fans[i].add(f);
  return () => fans[i].delete(f);
};

export const subscribeAttention = sub(0);
export const subscribePower = sub(1);
export const getAttention = () => cur[0];
export const getPower = () => cur[1];
export const attentionAllowsMotion = (s = cur[0]) => s === ATTENTION_ACTIVE;
// draw (кадр по запросу) разрешён и в фоне ради macOS: колесо над неактивным окном
// туда всё равно доходит, и окно без ответного кадра выглядело бы сломанным.
export const attentionAllows = (kind, s = cur[0], p = cur[1]) =>
  kind === "draw" ? s !== ATTENTION_HIDDEN : attentionAllowsMotion(s) && (kind !== "decor" || p !== POWER_HOT);

export const resolveAttention = ({ visible = true, focused = true, locked, suspended, idle } = {}) =>
  ORDER[!visible || locked || suspended ? 3 : !focused ? 2 : idle ? 1 : 0];
// Перегрев сильнее батареи; сама батарея ничего не гасит, это сигнал потребителям.
export const resolvePower = ({ onBattery, thermal } = {}) =>
  ["serious", "critical"].includes(thermal) ? POWER_HOT : onBattery ? POWER_SAVER : POWER_NORMAL;

const on = (el, name, fn, opts) => {
  el.addEventListener(name, fn, opts);
  return () => el.removeEventListener(name, fn, opts);
};

// Слежка: все сигналы страницы и моста сводятся в check(). Спуск вниз идёт через
// единственное ожидание (новые сигналы его не продлевают, итог берётся заново на
// его исходе), подъём мгновенный. Простой считает один таймер по отметке ввода:
// мышь шлёт сотни событий в секунду, перезаводить таймер на каждое дорого.
function track(idleMs, settleMs) {
  const root = document.documentElement;
  const clock = () => (performance?.now ? performance.now() : Date.now());
  // Фокус страницы по умолчанию «есть», document.hasFocus() не читаем: в jsdom
  // он отвечает про элемент, и все тесты окна стартовали бы как окно в фоне.
  let focus = true;
  let snap = {};
  let idle = false;
  let seen = true;
  let last = clock();
  let tIdle = 0;
  let tSettle = 0;
  let bridgeOff;

  // Поле снимка мешает только при строгом совпадении с «плохим» значением.
  const field = (k, bad) => snap[k] !== bad;
  const view = () => ({
    visible: document.visibilityState !== "hidden" && field("visible", false) && field("minimized", true),
    focused: focus && field("focused", false),
    locked: !field("locked", true),
    suspended: !field("suspended", true),
    idle,
  });
  const settle = () => {
    tSettle = 0;
    push(0, pin || resolveAttention(view()));
  };

  function onIdle() {
    const left = idleMs - (clock() - last);
    if (left > 0) {
      tIdle = setTimeout(onIdle, left);
      return;
    }
    tIdle = 0;
    idle = true;
    check();
  }

  function check() {
    const v = view();
    const here = v.visible && v.focused;
    if (here && !seen) {
      // Окно снова на виду и в фокусе: признак жизни, простой отсчитываем заново.
      last = clock();
      idle = v.idle = false;
    }
    seen = here;
    if (!here) {
      clearTimeout(tIdle);
      tIdle = 0;
    } else if (!idle && !tIdle) {
      tIdle = setTimeout(onIdle, Math.max(0, idleMs - (clock() - last)));
    }
    const want = pin || resolveAttention(v);
    if (pin || ORDER.indexOf(want) <= ORDER.indexOf(cur[0])) {
      clearTimeout(tSettle);
      tSettle = 0;
      push(0, want);
    } else if (!tSettle) {
      tSettle = setTimeout(settle, settleMs);
    }
  }

  // Снимок главного процесса заменяет предыдущий целиком; не объект значит «снимка нет».
  const onSnap = (v) => {
    snap = v && typeof v === "object" ? v : {};
    push(1, resolvePower(snap));
    check();
  };
  const touch = () => {
    last = clock();
    if (idle) {
      idle = false;
      check();
    }
  };
  const focusTo = (v) => () => {
    focus = v;
    check();
  };

  // Мост ищется один раз; старая сборка без канала или с бросающей подпиской
  // не должна ронять окно: живём на сигналах страницы (Т-104).
  try {
    bridgeOff = desktopHost()?.attention?.subscribe?.(onSnap);
  } catch {
    // оставляем слежку на сигналах страницы
  }
  const offs = [
    on(document, "visibilitychange", check),
    on(window, "focus", focusTo(true)),
    on(window, "blur", focusTo(false)),
    // Фаза перехвата: ввод в любом вложенном элементе доходит до окна.
    ...["pointerdown", "pointermove", "keydown", "wheel", "touchstart"].map((n) =>
      on(window, n, touch, { capture: true, passive: true }),
    ),
  ];
  KEYS.forEach((k, i) => {
    root.dataset[k] = cur[i];
  });

  return {
    check,
    stop() {
      clearTimeout(tIdle);
      clearTimeout(tSettle);
      // Если отписка моста бросит, остановка обрывается здесь (отписка приложения не бросает).
      if (typeof bridgeOff === "function") bridgeOff();
      offs.forEach((off) => off());
      KEYS.forEach((k) => {
        delete root.dataset[k];
      });
    },
  };
}

export const startAttention = ({ idleAfterMs = IDLE_AFTER_MS, settleMs = SETTLE_MS } = {}) => {
  if (!globalThis.document || !globalThis.window) return () => {};
  // Настройки берёт первый заведший; у остальных они игнорируются.
  if (!live) {
    live = track(idleAfterMs, settleMs);
    live.check();
  }
  const me = {};
  owners.add(me);
  return () => {
    if (!owners.delete(me) || owners.size) return;
    const closing = live;
    live = null;
    closing.stop();
    push(0, ATTENTION_ACTIVE);
    push(1, POWER_NORMAL);
  };
};

// Рычаг стендов замера (scene-flight.cjs, editors-probe.cjs): окно прогона без
// фокуса считалось бы фоновым. Закреп переживает слежку; недопустимое значение снимает его.
export const pinAttention = (state) => {
  pin = ORDER[ORDER.indexOf(state)] ?? null;
  if (!live) push(0, pin ?? ATTENTION_ACTIVE);
  else live.check();
};

// Ворота кадров: внимание полное и элемент хоть частично на экране. Порядок
// операндов важен: в onChange приходит само ложное значение записи наблюдателя.
export const watchFrameGate = (el, onChange) => {
  const gate = { onScreen: true, last: {} };
  const poke = () => {
    const open = gate.onScreen && attentionAllowsMotion();
    if (open !== gate.last) onChange((gate.last = open));
  };
  const off = subscribeAttention(poke);
  const io =
    el && typeof IntersectionObserver === "function"
      ? new IntersectionObserver((rows) => {
          if (rows.length) gate.onScreen = rows.at(-1).isIntersecting;
          poke();
        })
      : null;
  io?.observe(el);
  poke();
  return () => {
    off();
    io?.disconnect();
  };
};

const subBoth = (f) => {
  const offs = [subscribeAttention(f), subscribePower(f)];
  return () => offs.forEach((off) => off());
};

export const useAttention = () => useSyncExternalStore(subscribeAttention, getAttention, () => ATTENTION_ACTIVE);
export const usePower = () => useSyncExternalStore(subscribePower, getPower, () => POWER_NORMAL);
// Готовый ответ, а не оба источника: компонент перерисовывается только на его смену.
export const useAttentionAllows = (kind) =>
  useSyncExternalStore(
    subBoth,
    () => attentionAllows(kind),
    () => attentionAllows(kind, ATTENTION_ACTIVE, POWER_NORMAL),
  );

export const useFrameGate = (ref) => {
  const [open, setOpen] = useState(attentionAllowsMotion);
  useEffect(() => {
    const el = ref.current;
    return watchFrameGate(el, setOpen);
  }, [ref]);
  return open;
};
