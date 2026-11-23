import { useEffect, useRef, useState } from "react";
import { motionEnabled } from "../../../motion-preference.js";
import { isTextEntry } from "../../../utils/hotkeys.js";

/*
 * Словарь и моторика левой панели. Отдельно от разметки, потому что разметка
 * рельса — двадцать строк, а подписи на шести языках и правила движения — вдвое
 * больше, и вместе они прятали одно за другим.
 *
 * Вид и сами росчерки живут в navigation-rail.css; здесь только то, что должен
 * знать JavaScript: как назвать раздел, когда перезапустить росчерк и в каком
 * слоте стоит подсветка.
 */

/* Длиннее самого длинного росчерка в navigation-rail.css (0.7s у шестерни). */
const NAV_MOTION_MS = 760;

/*
 * Раздел графики называется «Графика», а не «Настройки».
 *
 * «Настройками» назывались сразу два места: этот раздел и шестерёнка внизу.
 * Две одинаковые подписи на одном рельсе — это не подписи: наведя на любую,
 * человек узнавал ровно то, что знал до наведения. За этой стоят готовые
 * наборы качества картинки для самой GTA — качество текстур, теней, воды, —
 * и слово для них есть.
 *
 * «Библиотека» — то, что уже стоит в игре. Стоит сразу за мастерской, и
 * порядок подписей здесь тот же, что у разделов в `DesktopNavigation.jsx`.
 */
export const navigationLabels = {
  ru: [
    "Главная",
    "Каталог",
    "Мастерская",
    "Библиотека",
    "Графика",
    "Оптимизация",
    "Сборки",
  ],
  uk: [
    "Головна",
    "Каталог",
    "Майстерня",
    "Бібліотека",
    "Графіка",
    "Оптимізація",
    "Збірки",
  ],
  en: [
    "Home",
    "Catalog",
    "Workshop",
    "Library",
    "Graphics",
    "Optimization",
    "Builds",
  ],
  de: [
    "Start",
    "Katalog",
    "Werkstatt",
    "Bibliothek",
    "Grafik",
    "Optimierung",
    "Sammlungen",
  ],
  pl: [
    "Główna",
    "Katalog",
    "Warsztat",
    "Biblioteka",
    "Grafika",
    "Optymalizacja",
    "Zestawy",
  ],
  fr: [
    "Accueil",
    "Catalogue",
    "Atelier",
    "Bibliothèque",
    "Graphismes",
    "Optimisation",
    "Builds",
  ],
};

export const utilityLabels = {
  ru: ["Загрузки", "Настройки"],
  uk: ["Завантаження", "Налаштування"],
  en: ["Downloads", "Settings"],
  de: ["Downloads", "Einstellungen"],
  pl: ["Pobieranie", "Ustawienia"],
  fr: ["Téléchargements", "Paramètres"],
};

/*
 * Значки рейки залиты у всех разделов (итог F, 15.11.2026): выбранный раздел
 * отличает плашка со светлой полоской слева, а не начертание значка. Прежнее
 * «контур → заливка» (`railGlyphWeight`) ушло вместе с набором Phosphor.
 */

/*
 * Ctrl+1…7 открывают разделы рейки по порядку, как подсказывает наведение
 * (имя + «Ctrl N»). Горячая клавиша молчит там, где её не ждут: в поле ввода,
 * в окне поверх страницы и в открытом редакторе мастерской (рейка там спрятана,
 * а уход из редактора — решение человека, не случайное нажатие).
 */
export const RAIL_SHORTCUTS = 7;

export function useRailShortcuts(ids, onNavigate) {
  const latest = useRef({ ids, onNavigate });
  latest.current = { ids, onNavigate };
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return;
      }
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      const id =
        digit && digit <= RAIL_SHORTCUTS && latest.current.ids[digit - 1];
      if (!id || isTextEntry(event.target)) return;
      if (
        document.querySelector(
          '.desktop-app[data-holds~="editor-layout"], [aria-modal="true"]',
        )
      ) {
        return;
      }
      event.preventDefault();
      latest.current.onNavigate(id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/*
 * Таймер росчерка живёт рядом с кнопкой, а не НА кнопке: своё поле на узле DOM
 * переживало и размонтирование, и смену языка, и никто его не убирал.
 */
const motionTimers = new WeakMap();

export function replayMotionClass(button, className) {
  if (!button || !motionEnabled()) return;
  window.clearTimeout(motionTimers.get(button));
  button.classList.remove(className);
  /* Снятый класс вступает в силу только после пересчёта стилей — без этого
     чтения второе нажатие подряд не перезапускает росчерк. */
  void button.offsetWidth;
  button.classList.add(className);
  motionTimers.set(
    button,
    window.setTimeout(() => {
      button.classList.remove(className);
      motionTimers.delete(button);
    }, NAV_MOTION_MS),
  );
}

/*
 * Подсветка навигации — одна плашка на весь столбец, и ехать ей есть куда
 * только между слотами этого столбца. Когда выбранного слота нет (открыты
 * загрузки или настройки приложения), плашка гаснет там, где стояла, а не
 * уезжает в нулевой слот: иначе каждый заход в загрузки прогонял бы её через
 * весь рельс и обратно.
 */
export function useRailSlot(activeIndex) {
  const [slot, setSlot] = useState(Math.max(activeIndex, 0));
  useEffect(() => {
    if (activeIndex >= 0) setSlot(activeIndex);
  }, [activeIndex]);
  return { slot, visible: activeIndex >= 0 };
}
