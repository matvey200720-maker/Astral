/*
 * Ворота движения фона-холста: одна пара слушателей на окно, сколько бы холстов ни стояло (общий фон и копия в окне настроек).
 * Читаются не на каждом кадре, а по событиям, и кэшируются:
 *   - атрибуты корня и оболочки: `data-editor-room` (открыт редактор), `data-power="hot"` (перегрев), `data-settings-open` (открыты настройки),
 *     `data-motion="off"` («Анимации интерфейса» выключены) — один `MutationObserver`;
 *   - «меньше движения» системы (`prefers-reduced-motion`) — `matchMedia(...).addEventListener("change")`: сменили на лету — холст оживает сам;
 *   - колесо и прокрутка (пассивные слушатели в фазе захвата): пока листают и 400 мс после, холст не перерисовывается (на слабом ПК перерисовка
 *     в потоке окна ложилась на кадры прокрутки: offscreen 60 Гц ×4, p95 кадра каталога 16,8 → 33 мс).
 * Подписчик получает вызов, когда что-то из этого сменилось. Слушатели заводятся с первым подписчиком и снимаются с последним.
 */
const SCROLL_QUIET_MS = 400;
const WATCHED_ROOT = ["data-editor-room", "data-power", "data-settings-open"];

const subscribers = new Set();
let teardown = null;
let quietUntil = 0;
let state = { still: false, settingsOpen: false };

/** Пока листают (и 400 мс после), фон не перерисовывается. */
export const isScrolling = () => performance.now() < quietUntil;

/** Движение вообще разрешено окном (редактор, перегрев, «Анимации интерфейса», «меньше движения»); `settingsOpen` — открыты настройки. */
export const gateState = () => state;

const read = () => {
  const root = document.documentElement;
  const motionOff = Boolean(document.querySelector(".desktop-app[data-motion='off']"));
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  state = {
    still: root.hasAttribute("data-editor-room") || root.dataset.power === "hot" || motionOff || reduced,
    settingsOpen: root.hasAttribute("data-settings-open"),
  };
};

const notify = () => {
  read();
  [...subscribers].forEach((callback) => callback());
};

const hush = () => {
  quietUntil = performance.now() + SCROLL_QUIET_MS;
};

const attach = () => {
  read();
  const watcher = typeof MutationObserver === "function" ? new MutationObserver(notify) : null;
  watcher?.observe(document.documentElement, { attributes: true, attributeFilter: WATCHED_ROOT });
  const shell = document.querySelector(".desktop-app");
  if (shell) watcher?.observe(shell, { attributes: true, attributeFilter: ["data-motion"] });
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  media?.addEventListener?.("change", notify);
  window.addEventListener("wheel", hush, { passive: true, capture: true });
  window.addEventListener("scroll", hush, { passive: true, capture: true });
  return () => {
    watcher?.disconnect();
    media?.removeEventListener?.("change", notify);
    window.removeEventListener("wheel", hush, { capture: true });
    window.removeEventListener("scroll", hush, { capture: true });
    quietUntil = 0;
  };
};

/** Подписка на смену ворот; возвращает отписку. */
export function subscribeBackdropGate(callback) {
  if (subscribers.size === 0) teardown = attach();
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0) {
      teardown?.();
      teardown = null;
    }
  };
}
