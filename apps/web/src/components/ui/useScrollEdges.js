/*
 * Есть ли куда листать — и в какую сторону.
 *
 * Колонка правок в редакторе, который помещается в окно, обрывается ровно по
 * нижнему краю своей рамки: последняя видимая строка стоит там же, где стояла
 * бы последняя строка короткого списка. Получается закрытая коробка, и человек
 * читает её как «здесь всё» — хотя под ней ещё десяток ползунков. В редакторе
 * с прокручивающейся страницей этой беды нет: рамка уходит за нижний край
 * окна, и то, что список продолжается, видно само.
 *
 * Хук отвечает на один вопрос: остался ли контент выше и ниже видимого. Дальше
 * лист по этому ответу распускает край — там, где есть продолжение, содержимое
 * буквально уходит за границу, а не упирается в неё.
 *
 * Считается по трём событиям: прокрутка, изменение размера самой колонки и
 * изменение её содержимого. Последнее обязательно: разделы в инспекторе
 * раскрываются и сворачиваются, и подсказка, оставшаяся от прежнего состава,
 * врёт ровно так же, как её отсутствие.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/* Дребезг субпиксельной прокрутки: без запаса нижний край не гаснет в самом
   конце — `scrollTop` не дотягивает до максимума долей пикселя. */
const EDGE = 2;

/**
 * @returns {[import("react").RefObject<HTMLElement>, string]} ссылка на
 * прокручиваемый элемент и строка краёв: `""`, `"top"`, `"bottom"` или
 * `"top bottom"` — в том виде, в каком её принимает селектор `[data-scroll~=]`.
 */
export default function useScrollEdges() {
  const ref = useRef(null);
  const [edges, setEdges] = useState("");

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const overflow = node.scrollHeight - node.clientHeight;
    const next =
      overflow <= EDGE
        ? ""
        : [
            node.scrollTop > EDGE ? "top" : "",
            node.scrollTop < overflow - EDGE ? "bottom" : "",
          ]
            .filter(Boolean)
            .join(" ");
    /*
     * Край ставится прямо на узел, а состояние React догоняет: замер идёт в начале кадра (`schedule`), и состояние дошло бы до разметки только после его отрисовки — тень появилась бы кадром позже.
     * Атрибут — то же слово, что потом запишет React (при равенстве он ничего не тронет); пустой край — пустой атрибут, как в разметке с первого кадра.
     */
    if ((node.getAttribute("data-scroll") ?? "") !== next) node.setAttribute("data-scroll", next);
    setEdges((current) => (current === next ? current : next));
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    /*
     * Замер — один на кадр, сколько бы поводов ни пришло.
     *
     * `scrollHeight` и `clientHeight` заставляют браузер досчитать раскладку
     * прямо сейчас. Прокрутка шлёт событие на каждый шаг колеса, наблюдатель
     * содержимого — на каждую пачку правок разметки (плитка сменила картинку,
     * раздел раскрылся), и каждый повод раньше мерил тут же, посреди кадра, —
     * а на следующем шаге ту же раскладку считали заново. Край нужен к
     * отрисовке, не раньше: все поводы кадра сходятся в один замер перед ней.
     */
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      if (typeof requestAnimationFrame !== "function") {
        measure();
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    /*
     * Первый замер — тоже в начале ближайшего кадра, а не тут же (31.10.2026, «Редактировать» мастерской одежды на ×4): `scrollHeight` посреди фиксации досчитывает всю раскладку, после чего React
     * правит разметку и раскладку считают второй раз. Эффекты из щелчка идут до отрисовки, и замер в начале следующего кадра всё равно раньше неё: край ставится прямо на узел (`measure`), и
     * на первом кадре он уже стоит. Наблюдатель размера для этого поздно: он приходит после раскладки кадра и отправил бы замер на кадр дальше.
     */
    schedule();
    node.addEventListener("scroll", schedule, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (frame) cancelAnimationFrame(frame);
        node.removeEventListener("scroll", schedule);
      };
    }
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    /* Разделы инспектора раскрываются и сворачиваются: без наблюдения за
       содержимым подсказка осталась бы от прежней высоты. */
    /* Правки внутри вложенной коробки со своей прокруткой (`data-scroll-own`: сетка анимаций в панели) высоту панели не меняют — коробка
       тянется по месту, а не по содержимому. Без этого каждая снятая плитка (замена значка картинкой) и каждый смонтированный ряд будили
       замер, а он — пересчёт стилей в начале следующего кадра (трасса входа в «Анимации», 2.11.2026: шесть лишних пересчётов, первый — 30 мс при ×4). */
    const contents = new MutationObserver((records) => {
      if (records.every((record) => record.target !== node && record.target.closest?.("[data-scroll-own]"))) return;
      schedule();
    });
    contents.observe(node, { childList: true, subtree: true });
    for (const child of node.children) observer.observe(child);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      node.removeEventListener("scroll", schedule);
      observer.disconnect();
      contents.disconnect();
    };
  }, [measure]);

  return [ref, edges];
}
