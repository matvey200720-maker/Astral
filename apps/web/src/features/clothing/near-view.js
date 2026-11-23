/*
 * «Плитка подъехала к краю» для картинок сетки «Сделать заменёнку» (ТЗ 14.11.2026, слова владельца: «чтобы фотки быстро прогружались, а не очень долго в непрогрузе»).
 *
 * Раньше у каждой плитки был свой `IntersectionObserver` без `root` и с запасом 600 px. Запас был пустым: у наблюдателя без `root` пересечение
 * обрезается каждым предком с прокруткой, и плитка, что лежит ниже видимой части сетки, «не пересекается» вовсе, как бы близко к окну она ни была. Картинка
 * просилась, только когда плитка уже въехала в кадр, и всё время, пока она шла (сеть, диск, обмен с Desktop, раскодирование), на плитке было пусто. Замер на
 * закрытой сборке ×4 (стенд `scripts/perf/baseline/clothing-photos.mjs`): запросов картинок за 30 с простоя — по числу плиток первого экрана, остальные
 * (видимые после небольшой прокрутки) стоят без запроса.
 *
 * Здесь запас считается от прокручиваемого предка (`root` — он, `rootMargin` по вертикали), а наблюдатель один на предка, а не по штуке на плитку (24–96 штук на
 * вход). Нет прокручиваемого предка — `root` пустой, запас по окну, как раньше. Нет `IntersectionObserver` (тесты, jsdom) — «подъехала» сразу.
 */

/** Запас по вертикали, px: картинка просится за полтора экрана сетки до плитки. */
export const NEAR_MARGIN_PX = 600;

const scrollers = new WeakMap();
const watchers = new WeakMap();
const NO_ROOT = {};

/** Ближайший предок с вертикальной прокруткой (по стилю) или `null`. Для плиток одной сетки ответ один — запоминается по родителю. */
export function scrollerOf(node) {
  const parent = node?.parentElement;
  if (!parent || typeof getComputedStyle !== "function") return null;
  if (scrollers.has(parent)) return scrollers.get(parent);
  let found = null;
  for (let at = parent; at && at !== document.documentElement; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      found = at;
      break;
    }
  }
  scrollers.set(parent, found);
  return found;
}

function watcherFor(root, margin) {
  const rootKey = root || NO_ROOT;
  let byMargin = watchers.get(rootKey);
  if (!byMargin) {
    byMargin = new Map();
    watchers.set(rootKey, byMargin);
  }
  let watcher = byMargin.get(margin);
  if (!watcher) {
    const callbacks = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) callbacks.get(entry.target)?.();
      },
      { root, rootMargin: `${margin}px 0px` },
    );
    watcher = { observer, callbacks };
    byMargin.set(margin, watcher);
  }
  return watcher;
}

/**
 * Позвать `onNear` один раз, когда узел подъехал к краю прокручиваемого предка ближе, чем `margin`. Возвращает «перестать следить». Без `IntersectionObserver` —
 * `onNear` сразу и пустая отписка.
 */
export function watchNear(node, onNear, margin = NEAR_MARGIN_PX) {
  if (!node || typeof IntersectionObserver === "undefined") {
    onNear();
    return () => {};
  }
  const watcher = watcherFor(scrollerOf(node), margin);
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    watcher.callbacks.delete(node);
    watcher.observer.unobserve?.(node);
  };
  watcher.callbacks.set(node, () => {
    stop();
    onNear();
  });
  watcher.observer.observe(node);
  return stop;
}
