/*
 * Точка входа стенда превью.
 *
 * Держится в стороне от src/main.jsx намеренно: тот тянет desktop-entry.jsx, а
 * через него api.js, который без настольного моста обрывает запуск. Стенду
 * нужна только сцена, поэтому цепочка начинается и заканчивается здесь.
 *
 * Ни одной подмены браузерного окружения здесь больше нет. Раньше стояли две —
 * на видимость документа и на requestAnimationFrame, — потому что окно превью
 * не рисует кадров, пока вкладку не показали, а стенд открывают в том числе из
 * автоматики, которая вкладку не показывает. Теперь у окна есть
 * `ctx.renderFrame()`: синхронный кадр в обход цикла и проверок видимости.
 * Кадр берётся им, и врать браузеру больше незачем.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { keepDrawingBuffer } from "./capture.js";
/* Лист самого окна превью. В приложении он приезжает через
   styles/index.css вместе со всей мастерской, а стенд ту цепочку не
   тянет намеренно — в ней api.js и настольный мост. Поэтому лист
   подключается здесь поимённо: без него у окна нет ни пропорции кадра,
   ни минимальной высоты, и сцена схлопывается в полоску. */
import "../../src/components/desktop/workshop/preview/preview-window.css";
import PreviewLab from "./PreviewLab.jsx";
import "./preview-lab.css";

keepDrawingBuffer();

const container = document.getElementById("preview-lab-root");
const root = createRoot(container);

/* Без StrictMode. Двойной монтаж в разработке заставил бы адаптер сцены
   пройти mount → dispose → mount, и стенд проверял бы не картинку, а
   живучесть чужого кода при перезапуске. Это отдельная задача. */
root.render(<PreviewLab />);
