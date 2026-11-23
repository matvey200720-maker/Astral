import { useCallback, useEffect, useMemo, useState } from "react";

const LIMITS = {
  zoom: 1.5,
  pause: 50,
  margin: 0.25,
  side: 3200,
  stuck: 15000,
  screen: 1200,
  density: 2,
  revokeAfter: 1500,
};

const hundredths = (value) => Math.round(100 * (Number(value) || 0)) / 100;

// Ключ кадра: те же числа с точностью до сотых дают тот же кусок.
function frameKey(frame) {
  if (frame == null) return "";
  const { x, y, width, height, zoom, pixels } = frame;
  return [x, y, width, height, zoom, pixels?.width, pixels?.height].map(hundredths).join(":");
}

// Одна ось куска в долях сцены: начало и длина, с запасом по краям кадра.
function axisSpan(start, length, whole) {
  const from = Math.max(0, (start - length * LIMITS.margin) / whole);
  const to = Math.min(1, (start + length * (1 + LIMITS.margin)) / whole);
  return [from, to - from];
}

function pieceRect(frame, size) {
  const [u, width] = axisSpan(frame.x, frame.width, size.width);
  const [v, height] = axisSpan(frame.y, frame.height, size.height);
  return { u, v, width, height };
}

// Размер куска в точках экрана: большая сторона не длиннее LIMITS.side, пропорции те же.
function pieceDots(frame, size, rect) {
  const density = Math.min(LIMITS.density, globalThis.devicePixelRatio || 1);
  const perUnit = ((frame.pixels?.width || LIMITS.screen) * density) / frame.width;
  const sides = [rect.width * size.width, rect.height * size.height].map((units) =>
    Math.round(units * perUnit),
  );
  const shrink = Math.min(1, LIMITS.side / Math.max(...sides));
  return sides.map((side) => Math.max(1, Math.round(side * shrink)));
}

// Картинка встаёт раскодированной; сбой раскодирования кусок не отменяет.
function decoded(piece) {
  const Picture = globalThis.Image;
  if (!piece?.href || typeof Picture === "undefined") return piece;
  const picture = new Picture();
  picture.src = piece.href;
  if (!picture.decode) return piece;
  return Promise.resolve(picture.decode()).then(
    () => piece,
    () => piece,
  );
}

const revokeLater = (href) => {
  setTimeout(() => URL.revokeObjectURL(href), LIMITS.revokeAfter);
};

// Всё состояние одного хука: последний кадр, таймер, кусок на экране и идущий заказ.
class Slate {
  frame = null;
  drawnKey = "";
  timer = null;
  shown = null;
  alive = false;
  flight = null;
  again = false;
  base = undefined;
  size = undefined;

  constructor(publish) {
    this.publish = publish;
  }

  wake(run, delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(run, delay);
  }

  put(piece) {
    const before = this.shown;
    this.shown = piece;
    this.publish(piece);
    if (before?.href) revokeLater(before.href);
  }

  // Общий план: кусок убирается, идущий заказ устаревает.
  retire() {
    this.drawnKey = "";
    if (this.flight) this.flight.stale = true;
    if (this.shown) this.put(null);
  }

  // Заказ зависает не навсегда: через LIMITS.stuck рисуется новый.
  busy() {
    return this.flight !== null && performance.now() - this.flight.since < LIMITS.stuck;
  }

  launch(processor, frame, rect, redraw) {
    const [wide, high] = pieceDots(frame, this.size, rect);
    if (this.flight) this.flight.stale = true;
    const ticket = { stale: false, since: 0 };
    this.flight = ticket;
    this.drawnKey = frameKey(frame);
    ticket.since = performance.now();
    processor
      .detail(this.base, rect, wide, high)
      .catch(() => null)
      .then(decoded)
      .then((piece) => this.land(ticket, piece, redraw));
  }

  // Ответ заказа: свой кусок ложится, устаревший или пришедший после ухода отзывается сразу.
  land(ticket, piece, redraw) {
    if (this.flight === ticket) this.flight = null;
    if (this.alive && !ticket.stale) this.put(piece);
    else if (piece?.href) URL.revokeObjectURL(piece.href);
    if (this.alive && this.again && this.flight === null) {
      this.again = false;
      this.wake(redraw, 0);
    }
  }

  accept(frame, draw) {
    this.frame = frame;
    clearTimeout(this.timer);
    if (frameKey(frame) !== this.drawnKey) this.wake(draw, LIMITS.pause);
  }

  rearm(draw) {
    this.drawnKey = "";
    this.wake(draw, LIMITS.pause);
  }

  live() {
    this.alive = true;
    return () => {
      this.alive = false;
      clearTimeout(this.timer);
      if (this.shown?.href) URL.revokeObjectURL(this.shown.href);
    };
  }
}

// Функция рисования привязана к обработчику растра: сменился он — рисуется заново.
function drawerFor(slate, processor) {
  return function draw() {
    const { frame, size } = slate;
    const sharp =
      frame &&
      size?.width &&
      !(frame.zoom < LIMITS.zoom) &&
      processor?.vector &&
      processor.vector(slate.base);
    if (!sharp) return slate.retire();

    const rect = pieceRect(frame, size);
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    if (slate.busy()) {
      slate.again = true;
      return undefined;
    }
    return slate.launch(processor, frame, rect, draw);
  };
}

export function useVectorDetail(processor, base, rasterKey, stamp, sceneSize) {
  const [detail, setDetail] = useState(null);
  const [slate] = useState(() => new Slate(setDetail));
  slate.base = base;
  slate.size = sceneSize;

  const draw = useMemo(() => drawerFor(slate, processor), [slate, processor]);
  const onFrame = useCallback((frame) => slate.accept(frame, draw), [slate, draw]);

  useEffect(() => {
    slate.rearm(draw);
  }, [rasterKey, stamp, draw, slate]);

  useEffect(() => slate.live(), [slate]);

  return { detail, onFrame };
}
