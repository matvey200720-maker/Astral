/*
 * Лаборатория карточки загрузки (18.11.2026): настоящий `StageLoader`, ход загрузки — сценарий (`profiles.js`).
 *
 *   window.__loaderLab.run(имя) → Promise<{ frames, marks, blocks, profile }>
 *
 * Запись — на каждом кадре страницы: время от начала, показанное число (текст), положение полосы (`scaleX` из вычисленного стиля,
 * то есть вместе с анимацией на композиторе и переходом CSS), фаза карточки. Занятость главного потока (`blocks`) пишется как есть:
 * начало и конец каждого занятого куска, чтобы разбор отделял «ход встал сам» от «поток занят». Разбор — `loader-metrics.mjs`.
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles/index.css";
import StageLoader from "../../src/features/workshop/stage-loader/StageLoader.jsx";
import { PROFILES } from "./profiles.js";

const OUT_SETTLE_MS = 700;
const round1 = (v) => Math.round(v * 10) / 10;

function barScale(bar) {
  if (!bar) return null;
  const m = /matrix\(([^,]+),/.exec(getComputedStyle(bar).transform);
  if (m) return Math.round(parseFloat(m[1]) * 10000) / 10000;
  const s = /scaleX\(([^)]+)\)/.exec(bar.style.transform || "");
  return s ? parseFloat(s[1]) : 0;
}

function Lab() {
  const [view, setView] = useState(null);
  useEffect(() => {
    window.__loaderLab = {
      profiles: PROFILES,
      run(name) {
        const profile = PROFILES[name];
        if (!profile) return Promise.reject(new Error(`нет сценария ${name}`));
        return new Promise((resolve) => {
          const frames = [];
          const blocks = [];
          const marks = [];
          const t0 = performance.now();
          let run = true;
          const tick = (t) => {
            const card = document.querySelector(".stage-loader");
            const pct = card?.querySelector(".stage-loader-percent");
            const bar = card?.querySelector(
              ".stage-loader-bar:not(.is-unknown) > i",
            );
            frames.push([
              round1(t - t0),
              pct ? pct.textContent : null,
              barScale(bar),
              card?.getAttribute("data-phase") || null,
              card?.querySelector(".stage-loader-bar.is-unknown") ? 1 : 0,
            ]);
            if (run) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          const stamp = (label) =>
            marks.push([label, round1(performance.now() - t0)]);
          const set = (next, label) => {
            stamp(label);
            setView((prev) => ({ ...(prev || {}), ...next }));
          };
          const first =
            profile.mode === "stages"
              ? { stage: profile.events[0].stage, progress: null }
              : { stage: "", progress: null };
          set({ kit: profile.kit, phase: "in", ...first }, "start");
          for (const event of profile.events) {
            setTimeout(() => {
              if (profile.mode === "stages")
                set(
                  { stage: event.stage, progress: null },
                  `stage:${event.stage}`,
                );
              else
                set(
                  {
                    stage: "",
                    progress: { done: event.done, total: event.total },
                  },
                  `sheets:${event.done}/${event.total}`,
                );
            }, event.at);
          }
          for (const block of profile.blocks || []) {
            setTimeout(() => {
              const from = performance.now();
              performance.mark("loader-lab:block:start");
              while (performance.now() - from < block.ms);
              performance.mark("loader-lab:block:end");
              blocks.push([round1(from - t0), round1(performance.now() - t0)]);
            }, block.at);
          }
          setTimeout(() => {
            set({ phase: "out" }, "done");
            setTimeout(() => {
              run = false;
              setView(null);
              resolve({ frames, marks, blocks, profile: name });
            }, OUT_SETTLE_MS);
          }, profile.done);
        });
      },
    };
    return () => {
      delete window.__loaderLab;
    };
  }, []);
  return (
    <div
      className="loader-lab-stage"
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        background: "#050505",
      }}
    >
      {view ? <StageLoader {...view} /> : null}
    </div>
  );
}

createRoot(document.getElementById("loader-lab-root")).render(<Lab />);
