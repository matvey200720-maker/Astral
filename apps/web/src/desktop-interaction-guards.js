export const DESKTOP_INTERACTION_ROOT_SELECTOR =
  ".desktop-app, .product-onboarding";

export const DESKTOP_SELECTABLE_CONTENT_SELECTOR = [
  "input",
  "textarea",
  "[contenteditable]:not([contenteditable='false'])",
  "[data-ui-selectable='true']",
  ".ui-selectable-text",
  "p",
  "pre",
  "code",
  "[class*='description']",
].join(", ");

function closest(target, selector) {
  return typeof target?.closest === "function"
    ? target.closest(selector)
    : null;
}

function interactionRootFor(target) {
  return closest(target, DESKTOP_INTERACTION_ROOT_SELECTOR);
}

export function shouldPreventDesktopSelection(target) {
  return Boolean(
    interactionRootFor(target) &&
    !closest(target, DESKTOP_SELECTABLE_CONTENT_SELECTOR),
  );
}

export function shouldPreventDesktopImageDrag(target) {
  const image = closest(target, "img");
  return Boolean(image && interactionRootFor(image));
}

export function installDesktopInteractionGuards(eventTarget = document) {
  const preventUiSelection = (event) => {
    if (shouldPreventDesktopSelection(event.target)) event.preventDefault();
  };
  const preventImageDrag = (event) => {
    if (shouldPreventDesktopImageDrag(event.target)) event.preventDefault();
  };

  eventTarget.addEventListener("selectstart", preventUiSelection, true);
  eventTarget.addEventListener("dragstart", preventImageDrag, true);

  return () => {
    eventTarget.removeEventListener("selectstart", preventUiSelection, true);
    eventTarget.removeEventListener("dragstart", preventImageDrag, true);
  };
}
