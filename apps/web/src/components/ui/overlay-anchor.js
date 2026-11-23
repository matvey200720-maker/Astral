// Положение выпадающего списка у кнопки и узел страницы, куда его вставить.

export const OVERLAY_GAP = 6;
export const OVERLAY_EDGE = 8;

const MIN_LIST_HEIGHT = 120;

// Единственное место, где решается, известен ли размер списка. Ноль, минус,
// NaN, null и нечисловая строка значат «ещё не измерен»; "300" — это 300.
const isKnownSize = (size) => size > 0;

// Зажим в [low, high]. Если границы разошлись, побеждает low: поле у края
// окна сильнее, чем желание уместить список справа.
const clamp = (value, low, high = Infinity) =>
  Math.max(low, Math.min(value, high));

// Сколько места остаётся списку, если до края окна distance пикселей:
// от него отнимаются зазор до кнопки и поле у самого края.
const roomWithin = (distance) => distance - OVERLAY_GAP - OVERLAY_EDGE;

function horizontalPlacement(align, anchorRect, viewportWidth, listWidth) {
  if (align === "end") {
    return { right: clamp(viewportWidth - anchorRect.right, OVERLAY_EDGE) };
  }
  // Ширина окна нужна, только когда известна ширина списка.
  const rightmostLeft = isKnownSize(listWidth)
    ? viewportWidth - listWidth - OVERLAY_EDGE
    : Infinity;
  return { left: clamp(anchorRect.left, OVERLAY_EDGE, rightmostLeft) };
}

function verticalPlacement(anchorRect, viewportHeight, listHeight) {
  const below = roomWithin(viewportHeight - anchorRect.bottom);
  const above = roomWithin(anchorRect.top);

  // Вверх уходим, только если внизу тесно и сверху строго просторнее.
  const squeezed = isKnownSize(listHeight) && listHeight > below;
  if (squeezed && above > below) {
    return {
      bottom: clamp(
        viewportHeight - anchorRect.top + OVERLAY_GAP,
        OVERLAY_EDGE,
      ),
      maxHeight: clamp(above, MIN_LIST_HEIGHT),
    };
  }
  return {
    top: anchorRect.bottom + OVERLAY_GAP,
    maxHeight: clamp(below, MIN_LIST_HEIGHT),
  };
}

export function placeBelowAnchor(
  anchorRect,
  align,
  listHeight = 0,
  listWidth = 0,
) {
  // Окно читаем первым: без него падаем раньше, чем смотрим на прямоугольник.
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  return {
    ...horizontalPlacement(align, anchorRect, viewportWidth, listWidth),
    ...verticalPlacement(anchorRect, viewportHeight, listHeight),
  };
}

const queryDocument = (selector) => document.querySelector(selector);

export function resolveOverlayHost() {
  if (typeof document === "undefined") return null;
  // Атрибут раньше класса: в окне узел desktop-app стоит в документе раньше
  // хоста, и один общий запрос вернул бы его. Второй запрос — по нужде.
  return (
    queryDocument("[data-desktop-overlay-host]") ||
    queryDocument(".desktop-app") ||
    document.body
  );
}
