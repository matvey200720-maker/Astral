import { createElement as h, useEffect, useState } from "react";
import { Pause, Play } from "../../../ui/icons.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

const FRAME_MS = 150;
const MINUTES_IN_DAY = 24 * 60;

// Адрес записи галереи: строка как есть, у объекта — url, иначе src.
const addressOf = (entry) => (typeof entry === "string" ? entry : entry?.url || entry?.src || "");

export function skyCycleOf(mod) {
  const cycle = mod?.domain?.timecycle?.cycle;
  const usable = cycle && cycle.sha256 && cycle.frames > 1 && cycle.columns > 0;
  if (!usable) return null;
  const sheet = (mod.gallery || []).map(addressOf).find((address) => address.includes(cycle.sha256));
  return sheet === undefined ? null : { ...cycle, url: sheet };
}

// Доля положения в сетке: первая клетка — 0 %, последняя — 100 %, одна клетка — 0.
const spread = (index, count) => (count > 1 ? (index / (count - 1)) * 100 : 0);

const twoDigits = (value) => String(value).padStart(2, "0");

function timeOfFrame({ startHour, stepMinutes }, index) {
  const total = Math.round(startHour * 60 + index * stepMinutes);
  const inDay = ((total % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  return `${twoDigits(Math.floor(inDay / 60))}:${twoDigits(inDay % 60)}`;
}

// Всё, что кадр листа берёт из описания и номера: размер и позиция фона, ширина полосы, время.
function sheetLook(cycle, index) {
  const { frames, columns } = cycle;
  const rows = Math.ceil(frames / columns);
  const place = [spread(index % columns, columns), spread(Math.floor(index / columns), rows)];
  return {
    size: `${columns * 100}% ${rows * 100}%`,
    position: place.map((share) => `${share}%`).join(" "),
    progress: `${((index + 1) / frames) * 100}%`,
    clock: timeOfFrame(cycle, index),
  };
}

// Лист грузится в фоне; готовым он считается, пока адрес тот же и плеер на месте.
function useSheetReady(url) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stale = false;
    const sheet = new Image();
    sheet.onload = () => {
      if (!stale) setReady(true);
    };
    sheet.src = url;
    return () => {
      stale = true;
    };
  }, [url]);
  return ready;
}

// Кадры идут по кругу, пока лист загружен и включена игра.
function useFrameTimer(running, frames) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      setFrame((at) => (at + 1) % frames);
    }, FRAME_MS);
    return () => window.clearInterval(timer);
  }, [running, frames]);
  return frame;
}

export default function SkyCyclePlayer({ cycle, autoPlay = false }) {
  useTr();
  const ready = useSheetReady(cycle.url);
  /* На сцене карточки сутки идут сами (`autoPlay`, владелец 15.11.2026: «сразу ролик, сутки проигрываются»). */
  const [playing, setPlaying] = useState(autoPlay);
  const frame = useFrameTimer(ready && playing, cycle.frames);
  const look = sheetLook(cycle, frame);

  const label = `${tr("Сутки неба мода")}: ${look.clock}`;
  const toggle = playing ? { Glyph: Pause, word: tr("Пауза") } : { Glyph: Play, word: tr("Смотреть") };
  const style = { backgroundSize: look.size, backgroundPosition: look.position };
  if (ready) style.backgroundImage = `url("${cycle.url}")`;

  const children = [
    playing && h("span", { key: "clock", className: "mod-sky-cycle-clock", "aria-hidden": "true" }, look.clock),
    h(
      "button",
      {
        key: "toggle",
        type: "button",
        className: "mod-sky-cycle-toggle",
        "aria-label": toggle.word,
        title: toggle.word,
        onClick: () => {
          setPlaying((on) => !on);
        },
      },
      h(toggle.Glyph, { weight: "fill" }),
    ),
    h("span", { key: "track", className: "mod-sky-cycle-track", "aria-hidden": "true" }, h("span", { style: { width: look.progress } })),
  ];

  return h(
    "figure",
    { className: "mod-card-frame mod-sky-cycle" },
    h("div", { className: "mod-sky-cycle-view", role: "img", "aria-label": label, style, "data-ready": ready ? "true" : undefined }, children),
  );
}
