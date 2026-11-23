import { createPortal } from "react-dom";

const OVERLAY_HOST_SELECTOR = "[data-desktop-overlay-host]";

/**
 * Renders viewport-level UI outside page animation and containment contexts.
 *
 * Desktop pages intentionally animate with transforms. A fixed descendant of
 * such a page is fixed to that page instead of the window, so dialogs and
 * toasts belong in the shell-level overlay host.
 */
export default function DesktopOverlayPortal({ children }) {
  if (typeof document === "undefined") return children;

  const host = document.querySelector(OVERLAY_HOST_SELECTOR) || document.body;
  return createPortal(children, host);
}
