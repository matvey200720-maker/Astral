import { useId } from "react";
import * as look from "./look.js";

// 14 изогипс: каждая следующая кривая ровно на 70 ниже предыдущей
const CONTOURS = [...Array(14).keys()].map(
  (i) => `M -100 ${140 + 70 * i} C 300 ${70 * i} 620 ${260 + 70 * i} 980 ${80 + 70 * i} S 1500 ${70 * i - 80} 1600 ${40 + 70 * i}`,
);


const trace = (d) => <path d={d} key={d} />;

// uid входит в id градиентов: у фона окна и у миниатюры в «Настройках» они не должны совпасть
const waveLayer = (outline, order, uid) => {
  const id = `${uid}-wave-${order}`;
  return (
    <svg aria-hidden="true" className={`astral-wave is-${order + 1}`} key={id} preserveAspectRatio="none" viewBox="0 0 2880 400">
      <defs>
        <linearGradient x1={0} x2={0} y1={0} y2={1} id={id}>
          <stop className="astral-wave-top" offset={0} />
          <stop className="astral-wave-bottom" offset={1} />
        </linearGradient>
      </defs>
      <g fill={"url(#" + id + ")"}>
        <path d={outline} />
        <path d={outline} transform="translate(1440 0)" />
      </g>
    </svg>
  );
};

// «Свет» пустой — свечение рисует CSS. Любой другой фон (none, space, мусор) рисунка не имеет.
const DRAWERS = new Map([
  ["waves", (uid) => RIDGES.map((outline, order) => waveLayer(outline, order, uid))],
  [
    "lines",
    () => (
      <svg aria-hidden="true" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1440 900">
        {CONTOURS.map(trace)}
      </svg>
    ),
  ],
  ["light", () => null],
]);

// Контур гряды рисуется дважды (второй раз со сдвигом на ширину), чтобы дрейф слоя зацикливался без стыка.
// Каждая гряда — отдельный <svg>: сдвиг, «дыхание» и качка слоя идут на композиторе, а группа внутри одной
// картинки перерисовывалась бы главным потоком (23.10.2026). Менять путь d или сдвигать содержимое нельзя:
// форму волны меняет CSS (30.10.2026).
const RIDGES = [
  "M0 120 C 180 70 360 70 540 110 S 900 160 1080 110 S 1260 70 1440 120 L 1440 400 L 0 400 Z",
  "M0 170 C 200 130 380 140 560 175 S 920 215 1100 170 S 1280 130 1440 170 L 1440 400 L 0 400 Z",
  "M0 230 C 160 200 360 205 540 235 S 880 270 1080 230 S 1300 200 1440 230 L 1440 400 L 0 400 Z",
];
export const BackdropArt = ({ backdrop, mini = false }) => {
  const uid = useId();
  const draw = DRAWERS.get(backdrop);
  if (!draw) return null;
  return <span className={`astral-backdrop-art is-${backdrop}${mini ? " is-mini" : ""}`}>{draw(uid)}</span>;
};

// space убран 23.10.2026 (сцена «Живой космос»); look.js его не пропускает, ветка про запас
export default function AppBackdrop() {
  const { backdrop } = look.useLook();
  if (backdrop === "none" || backdrop === "space") return null;
  return (
    <div aria-hidden="true" className="astral-backdrop">
      <BackdropArt backdrop={backdrop} />
    </div>
  );
}
