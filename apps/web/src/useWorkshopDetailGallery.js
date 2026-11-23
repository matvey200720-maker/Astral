import { useEffect } from "react";
import { motionEnabled } from "./motion-preference.js";

const PREVIEW_SCROLL_RANGE = 320;
const GALLERY_BOTTOM_GAP = 14;
// Keep a visible catalog cue above the fold without letting it overpower the
// hero. The catalog receives the released space as the hero collapses.
const MIN_CATALOG_HEIGHT = 112;
const DETAIL_ROW_GAP = 26;
const HERO_ROW_GAP = 12;
const COMPACT_PREVIEW_RATIO = 0.68;
const MIN_COMPACT_PREVIEW_HEIGHT = 210;
const COMPACT_DETAIL_ROW_GAP = 10;
const COMPACT_HERO_ROW_GAP = 4;
const EXPANDED_HEADER_PADDING = 10;
const CATALOG_SCROLL_DURATION = 110;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smoothStep = (value) => value * value * (3 - 2 * value);
const easeOutCubic = (value) => 1 - (1 - value) ** 3;

function getWheelDistance(event, viewportHeight) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * viewportHeight;
  }
  return event.deltaY;
}

/**
 * Keeps a Workshop detail inside the application viewport.
 *
 * The catalog owns the scrolling while the preview and product controls stay
 * above it. This avoids hiding partial rows or letting cards travel behind the
 * title/actions area. Scrolling outside the catalog is forwarded to it so the
 * whole detail still feels like one continuous surface.
 */
export function useWorkshopDetailGallery({ pageRef, active, resetKey }) {
  useEffect(() => {
    const page = pageRef.current;
    const surface = page?.closest(".desktop-main");
    const gallery = page?.querySelector(
      ".workshop-library-catalog.is-unified-gallery",
    );
    const grid = gallery?.querySelector(".workshop-local-grid");

    if (!active || !page || !surface || !gallery || !grid) {
      /* Блокировка не должна пережить галерею, ради которой её ставили.
         Эффект перезапускается не на каждое изменение разметки, поэтому
         класс мог остаться на .desktop-main поверх экрана, где галереи уже
         нет, — и страница переставала прокручиваться совсем. */
      surface?.classList.remove("workshop-detail-scroll-locked");
      return undefined;
    }

    let frame = 0;
    let wheelFrame = 0;
    let wheelStart = 0;
    let wheelTarget = 0;
    let collapseOffset = 0;
    let collapseStart = 0;
    let collapseTarget = 0;
    let wheelStartedAt = 0;
    let resetFrame = 0;
    let resetTimer = 0;
    let hasWheelInput = false;
    let surfaceResetFrame = 0;
    surface.classList.add("workshop-detail-scroll-locked");
    surface.scrollTo({ top: 0, left: 0 });
    grid.scrollTo({ top: 0, left: 0 });
    wheelTarget = grid.scrollTop;

    const updateLayout = () => {
      const surfaceRect = surface.getBoundingClientRect();
      const galleryRect = gallery.getBoundingClientRect();
      const availableHeight = Math.max(
        320,
        surfaceRect.bottom - galleryRect.top - GALLERY_BOTTOM_GAP,
      );
      const availableWidth = Math.max(0, page.clientWidth - 72);
      const header = gallery.querySelector(".workshop-local-hero-header");
      const tools = gallery.querySelector(".workshop-local-catalog-tools");
      const reservedHeight =
        (header?.offsetHeight || 88) +
        (tools?.offsetHeight || 48) +
        DETAIL_ROW_GAP +
        HERO_ROW_GAP * 2 +
        MIN_CATALOG_HEIGHT;
      const expandedHeight = Math.min(
        500,
        availableWidth * (9 / 16),
        Math.max(210, availableHeight - reservedHeight),
      );
      const compactHeight = Math.min(
        expandedHeight,
        Math.max(
          MIN_COMPACT_PREVIEW_HEIGHT,
          expandedHeight * COMPACT_PREVIEW_RATIO,
        ),
      );
      const expandedWidth = Math.min(
        1180,
        availableWidth || 1180,
        expandedHeight * (16 / 9),
      );
      const compactWidth = Math.min(expandedWidth, compactHeight * (16 / 9));
      const progress = smoothStep(
        clamp(collapseOffset / PREVIEW_SCROLL_RANGE, 0, 1),
      );
      const previewWidth =
        expandedWidth - (expandedWidth - compactWidth) * progress;
      const detailRowGap =
        DETAIL_ROW_GAP - (DETAIL_ROW_GAP - COMPACT_DETAIL_ROW_GAP) * progress;
      const heroRowGap =
        HERO_ROW_GAP - (HERO_ROW_GAP - COMPACT_HERO_ROW_GAP) * progress;
      const headerPadding = EXPANDED_HEADER_PADDING * (1 - progress);
      const previewHeight = previewWidth * (9 / 16);
      const gridHeight = Math.max(
        MIN_CATALOG_HEIGHT,
        availableHeight -
          previewHeight -
          (header?.offsetHeight || 88) -
          (tools?.offsetHeight || 48) -
          heroRowGap * 2 -
          detailRowGap,
      );

      page.style.setProperty("--workshop-gallery-progress", String(progress));
      page.style.setProperty(
        "--workshop-gallery-preview-width",
        `${previewWidth}px`,
      );
      page.style.setProperty(
        "--workshop-gallery-height",
        `${availableHeight}px`,
      );
      page.style.setProperty(
        "--workshop-gallery-grid-min-height",
        `${MIN_CATALOG_HEIGHT}px`,
      );
      page.style.setProperty(
        "--workshop-gallery-grid-height",
        `${gridHeight}px`,
      );
      page.style.setProperty("--workshop-gallery-row-gap", `${detailRowGap}px`);
      page.style.setProperty("--workshop-gallery-hero-gap", `${heroRowGap}px`);
      page.style.setProperty(
        "--workshop-gallery-header-padding",
        `${headerPadding}px`,
      );
    };

    const scheduleLayout = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateLayout);
    };

    // The detail surface is deliberately not the scroll owner. Electron can
    // preserve or restore an old outer scroll offset while navigating between
    // Workshop slots, which lets the hero travel underneath the fixed context
    // bar. Keep that surface pinned at the origin; the catalog grid below is
    // the only element that is allowed to scroll.
    const keepSurfaceAtOrigin = () => {
      if (surface.scrollTop === 0 && surface.scrollLeft === 0) return;
      window.cancelAnimationFrame(surfaceResetFrame);
      surfaceResetFrame = window.requestAnimationFrame(() => {
        surface.scrollTo({ top: 0, left: 0 });
      });
    };

    const animateCatalogScroll = (timestamp) => {
      const progress = clamp(
        (timestamp - wheelStartedAt) / CATALOG_SCROLL_DURATION,
        0,
        1,
      );
      grid.scrollTop =
        wheelStart + (wheelTarget - wheelStart) * easeOutCubic(progress);
      collapseOffset =
        collapseStart +
        (collapseTarget - collapseStart) * easeOutCubic(progress);
      updateLayout();

      const maxScrollTop = Math.max(0, grid.scrollHeight - grid.clientHeight);
      if (grid.scrollTop > maxScrollTop) {
        grid.scrollTop = maxScrollTop;
      }

      if (progress < 1) {
        wheelFrame = window.requestAnimationFrame(animateCatalogScroll);
        return;
      }

      grid.scrollTop = wheelTarget;
      collapseOffset = collapseTarget;
      wheelFrame = 0;
      updateLayout();
    };

    const forwardWheelToCatalog = (event) => {
      if (event.ctrlKey) return;
      hasWheelInput = true;

      const distance = getWheelDistance(event, grid.clientHeight);
      if (!distance) return;

      const currentScrollTarget = wheelFrame ? wheelTarget : grid.scrollTop;
      const currentCollapseTarget = wheelFrame
        ? collapseTarget
        : collapseOffset;
      let nextScrollTop = currentScrollTarget;
      let nextCollapseOffset = currentCollapseTarget;
      let remainingDistance = distance;

      if (remainingDistance > 0) {
        const collapseDistance = Math.min(
          remainingDistance,
          PREVIEW_SCROLL_RANGE - nextCollapseOffset,
        );
        nextCollapseOffset += collapseDistance;
        remainingDistance -= collapseDistance;

        if (remainingDistance > 0) {
          const maxScrollTop = Math.max(
            0,
            grid.scrollHeight - grid.clientHeight,
          );
          nextScrollTop = clamp(
            nextScrollTop + remainingDistance,
            0,
            maxScrollTop,
          );
        }
      } else {
        const catalogDistance = Math.max(remainingDistance, -nextScrollTop);
        nextScrollTop += catalogDistance;
        remainingDistance -= catalogDistance;

        if (remainingDistance < 0) {
          nextCollapseOffset = clamp(
            nextCollapseOffset + remainingDistance,
            0,
            PREVIEW_SCROLL_RANGE,
          );
        }
      }

      if (
        nextScrollTop === currentScrollTarget &&
        nextCollapseOffset === currentCollapseTarget
      ) {
        return;
      }

      event.preventDefault();
      if (!motionEnabled()) {
        wheelTarget = nextScrollTop;
        collapseTarget = nextCollapseOffset;
        grid.scrollTop = nextScrollTop;
        collapseOffset = nextCollapseOffset;
        updateLayout();
        return;
      }

      wheelStart = grid.scrollTop;
      wheelTarget = nextScrollTop;
      collapseStart = collapseOffset;
      collapseTarget = nextCollapseOffset;
      wheelStartedAt = window.performance.now();
      if (!wheelFrame) {
        wheelFrame = window.requestAnimationFrame(animateCatalogScroll);
      }
    };

    const resizeObserver = new ResizeObserver(scheduleLayout);
    resizeObserver.observe(page);
    resizeObserver.observe(surface);
    surface.addEventListener("scroll", keepSurfaceAtOrigin, { passive: true });
    grid.addEventListener("scroll", scheduleLayout, { passive: true });
    page.addEventListener("wheel", forwardWheelToCatalog, { passive: false });
    updateLayout();
    resetFrame = window.requestAnimationFrame(() => {
      resetTimer = window.setTimeout(() => {
        if (hasWheelInput) return;
        grid.scrollTo({ top: 0, left: 0 });
        collapseOffset = 0;
        collapseTarget = 0;
        updateLayout();
      }, 50);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(wheelFrame);
      window.cancelAnimationFrame(resetFrame);
      window.cancelAnimationFrame(surfaceResetFrame);
      window.clearTimeout(resetTimer);
      resizeObserver.disconnect();
      surface.removeEventListener("scroll", keepSurfaceAtOrigin);
      grid.removeEventListener("scroll", scheduleLayout);
      page.removeEventListener("wheel", forwardWheelToCatalog);
      surface.classList.remove("workshop-detail-scroll-locked");
      page.style.removeProperty("--workshop-gallery-progress");
      page.style.removeProperty("--workshop-gallery-preview-width");
      page.style.removeProperty("--workshop-gallery-height");
      page.style.removeProperty("--workshop-gallery-grid-min-height");
      page.style.removeProperty("--workshop-gallery-grid-height");
      page.style.removeProperty("--workshop-gallery-row-gap");
      page.style.removeProperty("--workshop-gallery-hero-gap");
      page.style.removeProperty("--workshop-gallery-header-padding");
    };
  }, [active, pageRef, resetKey]);
}
