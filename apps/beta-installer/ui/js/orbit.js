import { motionOff } from "./motion.js";
import { h, icon, svgNode } from "./dom.js";

// «Орбита»: звезда Astral в кольце хода (макет обновления 16.11.2026, вариант А1: белая дуга по тёмной дорожке, звезда по центру). Ход дуги —
// пружина без перелёта (затухание 1), а не CSS-переход: цель можно менять на лету без рывка, «бегущая дуга» перетекает в долю с той же
// скоростью (решение 14.10.2026, cee9d7fc1). Кадры просит только пока пружина не улеглась или дуга бежит: ровный ход без событий не греет окно.
// Всё, что движется само по себе (дыхание звезды, волны ожидания, праздник «Готово»), — только transform и opacity, без фильтров в цикле.
// Системная настройка «уменьшить движение» не читается: гасит движение только data-motion="off" (504694f65).

const [MID, RADIUS, TOP] = [32, 30, -90];
const CENTER = { cx: MID, cy: MID };
const TAU = Math.PI * 2;
const PERIMETER = TAU * RADIUS;
const [SHUT_GAP, RESERVE_MS] = [0.5, 1200];
const [RUN_SPEED, SUBSTEP, MAX_DT, BEGIN_REST, SPAN_REST] = [300, 1 / 240, 0.05, 0.05, 0.065];
const BADGES = new Map([["done", "check"], ["error", "alert"]]);
const GLIDING = new Set(["progress", "done", "error"]);

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const fix = (value, digits) => value.toFixed(digits);
const turn = (len) => 360 * (len / PERIMETER); // длина дуги в единицах рисунка → градусы
const rot = (deg) => `rotate(${fix(deg, 3)} ${MID} ${MID})`;
const dash = (len) => `${fix(len, 2)} ${fix(PERIMETER, 2)}`;
const put = (node, attrs) => Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, value));
const lay = (node, startDeg, dashText) => put(node, { transform: rot(startDeg), "stroke-dasharray": dashText });

// Пружина с затуханием 1: k = (2π/отзывчивость)², c = 2·√k, масса 1; полунеявный Эйлер с шагом 1/240 с.
function retune(sp, response) {
  const w = TAU / response;
  const k = w * w;
  return Object.assign(sp, { k, c: 2 * Math.sqrt(k) });
}
const spring = (at, response) => retune({ at, goal: at, vel: 0 }, response);
const snap = (sp, to) => {
  sp.at = sp.goal = to;
  sp.vel = 0;
  return sp;
};
const settled = (sp, eps) => Math.abs(sp.at - sp.goal) < eps && Math.abs(sp.vel) < 4 * eps;

function advance(sp, dt) {
  // Из остатка вычитается полный шаг, а не взятый кусок: float может дать лишний микрошаг (так и было).
  let left = dt;
  while (left > 0) {
    const piece = Math.min(left, SUBSTEP);
    const vel = sp.vel + (-sp.k * (sp.at - sp.goal) - sp.c * sp.vel) * piece;
    sp.at += vel * piece;
    sp.vel = vel;
    left -= SUBSTEP;
  }
}

const ring = (cls, r = RADIUS) => svgNode("circle", { class: cls, ...CENTER, r });

export const createOrbit = (options = {}) => {
  const { onClosed = () => {} } = options;
  const begin = spring(TOP, 0.6);
  const span = spring(0, 0.55);
  const st = { kind: "idle", clock: 0, running: false, runAngle: TOP, stamp: 0, badge: "", waiting: false, shut: false, reserve: 0 };

  const arc = ring("orbit-arc");
  const art = svgNode("svg", { viewBox: "0 0 64 64", "aria-hidden": "true" });
  art.append(ring("orbit-track"), ring("orbit-pulse"), ring("orbit-pulse"), ring("orbit-flash"), ring("orbit-ripple"), arc);
  const badge = Object.assign(document.createElement("span"), { className: "orbit-badge" });
  const star = h("img", { class: "orbit-star", src: "img/astral-star-ring.webp", alt: "", ["draggable"]: "false" });
  const el = h("div", { class: "orbit", ["data-kind"]: "idle", role: "presentation" }, star, art, badge);

  const paint = () => {
    const len = clamp(span.at, 0, PERIMETER);
    lay(arc, begin.at, dash(len));
    arc.style.opacity = len <= 0.2 ? "0" : "";
  };

  const seal = () => {
    if (st.shut || st.kind !== "done" || span.at < PERIMETER - SHUT_GAP) return;
    st.shut = true;
    el.setAttribute("data-closed", "true");
    onClosed(true);
  };

  const tick = (now) => {
    st.waiting = false;
    const dt = st.stamp ? Math.min(MAX_DT, (now - st.stamp) / 1000) : 1 / 60;
    st.stamp = now;
    st.clock += dt;
    if (st.running) {
      st.runAngle += RUN_SPEED * dt;
      snap(span, PERIMETER * (0.13 + 0.05 * Math.sin(2.4 * st.clock)));
      snap(begin, st.runAngle - turn(span.at));
    } else {
      [begin, span].forEach((sp) => advance(sp, dt));
    }
    paint(motionOff());
    seal();
    const goOn = st.running || !settled(begin, BEGIN_REST) || !settled(span, SPAN_REST);
    if (goOn) wantFrame();
    else st.stamp = 0;
  };

  function wantFrame() {
    if (st.waiting) return;
    st.waiting = true;
    requestAnimationFrame(tick);
  }

  // Если окно свёрнуто или панель скрыта, кадров нет и пружина стоит, а галочка обязана появиться:
  // через 1,2 с круг достраивается без хода. Таймер не снимается при замыкании по кадрам — срабатывает вхолостую.
  const finishUnseen = () => {
    if (st.shut || st.kind !== "done") return;
    snap(span, PERIMETER);
    paint(motionOff());
    seal();
  };
  const armReserve = () => {
    if (st.shut) return;
    st.reserve = window.setTimeout(finishUnseen, RESERVE_MS);
  };

  const showBadge = () => {
    const wanted = BADGES.get(st.kind) ?? "";
    if (wanted === st.badge) return;
    st.badge = wanted;
    badge.replaceChildren(...[wanted].filter(Boolean).map((name) => icon(name, { strokeWidth: 2.6 })));
  };

  // Правила «что делать с пружинами при новом виде»: побеждает первое подошедшее.
  const MOVES = [
    [
      (move) => move.off,
      (move) => {
        st.running = false;
        snap(begin, TOP);
        snap(span, PERIMETER * move.filled);
        paint(true);
      },
    ],
    [
      (move) => move.kind === "progress" && move.share === 0,
      (move) => {
        if (st.running) return;
        st.running = true;
        st.runAngle = move.entering || span.at < 1 ? TOP : begin.at + turn(clamp(span.at, 0, PERIMETER));
      },
    ],
    [
      (move) => GLIDING.has(move.kind),
      (move) => {
        if (st.running) {
          // Бег переходит в долю без рывка: начало докатывается вперёд до «12 часов».
          const lap = Math.ceil((begin.at - TOP) / 360);
          st.running = false;
          Object.assign(begin, { vel: RUN_SPEED, goal: TOP + 360 * lap });
          span.vel = 0;
        } else if (move.entering && span.at < 1) {
          snap(begin, TOP);
        }
        span.goal = PERIMETER * move.filled;
      },
    ],
    [
      () => true,
      () => {
        st.running = false;
        snap(begin, TOP);
        snap(span, 0);
        paint(false);
      },
    ],
  ];

  function update({ kind = "idle", value = 0 } = {}) {
    const entering = kind !== st.kind;
    const share = Number.isFinite(value) ? clamp(value, 0, 1) : 0;
    let filled = 0;
    if (kind === "progress") filled = share;
    else if (kind === "done" || kind === "error") filled = 1;
    st.kind = kind;
    el.setAttribute("data-kind", kind);
    if (kind !== "done") {
      if (st.shut) {
        st.shut = false;
        el.removeAttribute("data-closed");
        onClosed(false);
      }
      window.clearTimeout(st.reserve);
    }
    if (entering) retune(span, kind === "done" ? 0.32 : 0.55);
    const move = { entering, filled, kind, off: motionOff(), share };
    MOVES.find(([matches]) => matches(move))[1](move);
    seal();
    wantFrame();
    if (entering && kind === "done") armReserve();
    showBadge();
  }

  paint(motionOff());
  return { el, update };
};
