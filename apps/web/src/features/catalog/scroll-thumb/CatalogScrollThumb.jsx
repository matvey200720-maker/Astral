import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { scrollTopForDrag, thumbMetrics } from "./scroll-thumb-math.js";

/*
 * Бегунок прокрутки каталога (владелец, 24.11.2026): тонкий полупрозрачный, без стрелок, справа и только на странице «Каталог».
 * Нативной полосы в лаунчере нет (`test/no-scrollbars.test.js`), поэтому это наш элемент поверх `.desktop-main` — единственного
 * прокручиваемого контейнера страницы (`desktop.css`: `.desktop-main { overflow-y: auto }`). Он стоит в `.desktop-app` рядом с
 * ним, а не внутри: внутри он уезжал бы вместе с содержимым.
 *
 * Скорость: никакого состояния React на событие прокрутки. `scroll` — пассивный, перерасчёт один раз за кадр (`requestAnimationFrame`),
 * положение пишется прямо в стиль (`transform` и `height`). Состояние меняется, только когда бегунок появляется или исчезает.
 */

const INSET_EDGE = 3;
const INSET_BLOCK = 6;

export default function CatalogScrollThumb({ scrollerSelector = ".desktop-main", hostSelector = ".desktop-app" }) {
  const [scene, setScene] = useState(null);
  const [shown, setShown] = useState(false);
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const paintRef = useRef(null);

  useLayoutEffect(() => {
    const scroller = document.querySelector(scrollerSelector);
    if (!scroller) return undefined;
    setScene({ scroller, host: scroller.closest(hostSelector) ?? document.body });
    return () => setScene(null);
  }, [scrollerSelector, hostSelector]);

  useEffect(() => {
    if (!scene) return undefined;
    const { scroller } = scene;
    let frame = 0;
    let trackHeight = 0;
    let visible = false;
    let drag = null;
    let observed = new Set();

    const layoutTrack = () => {
      const track = trackRef.current;
      if (!track) return;
      const rect = scroller.getBoundingClientRect();
      trackHeight = Math.max(0, rect.height - INSET_BLOCK * 2);
      track.style.top = `${rect.top + INSET_BLOCK}px`;
      track.style.height = `${trackHeight}px`;
      track.style.right = `${Math.max(0, document.documentElement.clientWidth - rect.right) + INSET_EDGE}px`;
    };

    const paint = () => {
      frame = 0;
      const metrics = thumbMetrics({
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        trackHeight,
      });
      /*
       * Каталог оболочка при уходе не разбирает, а прячет (`KeptPage` — `Activity`): эффект на возврате встаёт заново и своего
       * `visible` не помнит, а состояние `shown` и вместе с ним узел бегунка могли остаться. Поэтому здесь смотрим и на узел.
       */
      if (!metrics) {
        if (visible || thumbRef.current) {
          visible = false;
          setShown(false);
        }
        return;
      }
      if (!visible) {
        visible = true;
        setShown(true);
      }
      /* Узла ещё нет (первое появление) — место и перетаскивание поставит эффект `[shown]` после отрисовки. */
      const thumb = thumbRef.current;
      if (!thumb) return;
      syncBinding();
      thumb.style.height = `${metrics.height}px`;
      thumb.style.transform = `translate3d(0, ${metrics.offset}px, 0)`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const onResize = () => {
      layoutTrack();
      schedule();
    };

    const resizeObserver = new ResizeObserver(onResize);
    const watchChildren = () => {
      const next = new Set(scroller.children);
      for (const child of observed) if (!next.has(child)) resizeObserver.unobserve(child);
      for (const child of next) if (!observed.has(child)) resizeObserver.observe(child);
      observed = next;
    };
    resizeObserver.observe(scroller);
    watchChildren();
    const childObserver = new MutationObserver(() => {
      watchChildren();
      schedule();
    });
    childObserver.observe(scroller, { childList: true });
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    layoutTrack();
    schedule();

    /* Перетаскивание: слушатели вешаются на сам бегунок через захват указателя, поэтому после его появления. */
    const onDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const thumb = event.currentTarget;
      thumb.setPointerCapture?.(event.pointerId);
      drag = { id: event.pointerId, startY: event.clientY, startScrollTop: scroller.scrollTop };
      thumb.dataset.drag = "true";
      document.addEventListener("selectstart", stopSelection);
    };
    const onMove = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      scroller.scrollTop = scrollTopForDrag({
        startScrollTop: drag.startScrollTop,
        deltaY: event.clientY - drag.startY,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        trackHeight,
      });
    };
    const onEnd = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      delete event.currentTarget.dataset.drag;
      document.removeEventListener("selectstart", stopSelection);
    };
    const stopSelection = (event) => event.preventDefault();

    const bind = (thumb) => {
      thumb.addEventListener("pointerdown", onDown);
      thumb.addEventListener("pointermove", onMove);
      thumb.addEventListener("pointerup", onEnd);
      thumb.addEventListener("pointercancel", onEnd);
      thumb.addEventListener("lostpointercapture", onEnd);
      return () => {
        thumb.removeEventListener("pointerdown", onDown);
        thumb.removeEventListener("pointermove", onMove);
        thumb.removeEventListener("pointerup", onEnd);
        thumb.removeEventListener("pointercancel", onEnd);
        thumb.removeEventListener("lostpointercapture", onEnd);
      };
    };
    let unbind = null;
    let boundThumb = null;
    const syncBinding = () => {
      const thumb = thumbRef.current;
      if (thumb === boundThumb) return;
      unbind?.();
      boundThumb = thumb;
      unbind = thumb ? bind(thumb) : null;
    };
    paintRef.current = paint;

    return () => {
      if (frame) cancelAnimationFrame(frame);
      paintRef.current = null;
      resizeObserver.disconnect();
      childObserver.disconnect();
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("selectstart", stopSelection);
      unbind?.();
    };
  }, [scene]);

  /* Бегунок только что появился: ставим ему место и вешаем перетаскивание. */
  useLayoutEffect(() => {
    if (shown) paintRef.current?.();
  }, [shown]);

  if (!scene) return null;
  return createPortal(
    <div className="catalog-scroll-track" ref={trackRef} aria-hidden="true">
      {shown ? <div className="catalog-scroll-thumb" ref={thumbRef} /> : null}
    </div>,
    scene.host,
  );
}
