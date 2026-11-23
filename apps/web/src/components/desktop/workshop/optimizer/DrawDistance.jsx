import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, DownloadSimple } from "../../../ui/icons.jsx";
import {
  DRAW_DISTANCE_DEFAULT,
  DRAW_DISTANCE_LIMITS,
  DRAW_DISTANCE_STOPS,
  drawDistanceSignature,
  drawDistanceStop,
  drawDistanceValues,
  normalizeDrawDistance,
} from "@modovik/optimizer/draw-distance.js";
import { OPTIMIZATION_RECORD_KEYS } from "@modovik/optimizer/layer-ids.js";
import { useWorkshopInstalls } from "../../../../features/workshop/install-queue/index.js";
import { useInstallRecords } from "../../../../features/workshop/useInstallRecord.js";
import ColourEffectField from "../../../../features/workshop/colour-effects/ColourEffectField.jsx";
import { failureWords } from "../../../../utils/installFailure.js";
import { useTr } from "../../../../locales/ui.js";
import Button from "../../../ui/Button.jsx";
import { drawDistanceCopyFor } from "./draw-distance-copy.js";
import {
  drawDistanceShotUrl,
  useCustomWallPicture,
  useDrawDistancePreview,
} from "./draw-distance-preview.js";
import {
  drawDistanceFailure,
  drawDistanceJob,
  drawDistanceTarget,
  installedDrawDistance,
  setDrawDistance,
} from "./draw-distance-sync.js";
import { FilmCard, FilmLabels, FilmRail, FilmTiles } from "./OptimizerFilm.jsx";
import { fillCopy } from "./optimizer-copy.js";
import OptimizerSlots from "./OptimizerSlots.jsx";
import OptimizerStage, { StageMissing } from "./OptimizerStage.jsx";
import {
  InstallProgress,
  InstallSteps,
  SelectedText,
  StatusLine,
} from "./OptimizerParts.jsx";

/*
 * Вкладка «Дальность прорисовки» раздела оптимизации (задача 7 ТЗ
 * 06.10.2026) — справа от «Ухудшения текстур», на тех же органах; вид — дизайн
 * 15.11.2026, вариант A «Сцена и плёнка».
 *
 * Ползунок режет дальность: дальше мир не рисуется, край закрывает стена
 * тумана. Он — плёнка под сценой: кадр «Как в игре» и по кадру на каждую
 * ступень дальности, ручка на рельсе с шагом 50 м; кадр сцены и подсвеченный
 * кадр плёнки — ближайший из снятых. Цвет стены — «Чернота», «Белый» или свой —
 * тремя кадрами в панели и общим полем цветовых эффектов в сплошном режиме:
 * туман игры красит стену одним цветом. Кадры — настоящие кадры из игры с одной
 * высокой точки по ступеням дальности (`draw-distance-preview.js`): меняется
 * только дальность. Ползунок и цвет только выбирают — в игру всё уходит
 * кнопкой «Установить» работой очереди; «Как в игре» + «Установить» снимают
 * пакет.
 */

const WALL_PRESETS = Object.freeze({
  black: Object.freeze({ mode: "solid", colour: "#000000" }),
  white: Object.freeze({ mode: "solid", colour: "#ffffff" }),
});
const WALLS = Object.freeze(["black", "white", "custom"]);
const SWATCHES = Object.freeze([
  "#000000",
  "#ffffff",
  "#9aa3ad",
  "#c9d6e3",
  "#7fa7c9",
  "#d8c3a5",
  "#2a2f3a",
  "#f2c94c",
  "#e8590c",
  "#9b51e0",
]);
/* Размеры маленьких кадров «Свой цвет»: вдвое больше показа, чтобы не мылились. */
const TILE_W = 288;
const TILE_H = 160;
const WALL_W = 328;
const WALL_H = 124;

function wallOf(look) {
  if (look.colour === "#000000") return "black";
  if (look.colour === "#ffffff") return "white";
  return "custom";
}

/* Отказ словами очереди; «игра запущена» — словами раздела. */
function failureText(message, gameRunning) {
  const running = failureWords({ kind: "game-running" }, "ru").reason;
  const text = String(message || "");
  return text.startsWith(running) ? gameRunning : text;
}

/* Номер кадра плёнки: 0 — «Как в игре», дальше — снятые ступени от дальней к ближней. */
function frameIndex(distance) {
  return distance === null
    ? 0
    : 1 + DRAW_DISTANCE_STOPS.indexOf(drawDistanceStop(distance));
}

/* Где стоит ручка: между кадрами — по дальности (ступени неравномерные, внутри пролёта — линейно). */
function knobOf(distance) {
  if (distance === null) return 0;
  const stops = DRAW_DISTANCE_STOPS;
  if (distance >= stops[0]) return 1;
  for (let at = 0; at < stops.length - 1; at += 1) {
    if (distance >= stops[at + 1])
      return 1 + at + (stops[at] - distance) / (stops[at] - stops[at + 1]);
  }
  return stops.length;
}

/* Дальность по положению ручки; левее середины между «Как в игре» и первой ступенью — «Как в игре» (`null`). */
function distanceOf(fraction) {
  const stops = DRAW_DISTANCE_STOPS;
  if (fraction < 0.5) return null;
  if (fraction <= 1) return stops[0];
  const at = Math.min(stops.length - 2, Math.floor(fraction - 1));
  return (
    stops[at] -
    (Math.min(fraction, stops.length) - 1 - at) * (stops[at] - stops[at + 1])
  );
}

/* Кадр стены на ступени: чернота и белый — кадры игры, «Свой цвет» — расчёт по паре кадров. */
function WallPicture({ stop, wall, colour, width, height }) {
  const canvas = useRef(null);
  const custom = wall === "custom";
  const drawn = useCustomWallPicture(
    canvas,
    stop,
    colour,
    width,
    height,
    custom,
  );
  if (custom)
    return drawn ? (
      <canvas ref={canvas} width={width} height={height} aria-hidden="true" />
    ) : (
      <span />
    );
  const url = drawDistanceShotUrl(`${stop}-${wall}`);
  return url ? (
    <img src={url} alt="" loading="lazy" decoding="async" draggable={false} />
  ) : (
    <span />
  );
}

export default function DrawDistance({
  locale = "ru",
  supported,
  editor,
  gameRunning = "",
  onNotice,
  slots = null,
}) {
  const tr = useTr();
  const copy = drawDistanceCopyFor(locale);
  const queue = useWorkshopInstalls();
  const records = useInstallRecords(OPTIMIZATION_RECORD_KEYS);
  const target = useMemo(
    () => drawDistanceTarget(queue),
    // `records` — сигнал: запись читается из хранилища внутри.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, records],
  );
  const installed = useMemo(
    () => installedDrawDistance(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, records],
  );
  const job = drawDistanceJob(queue);
  const failure = drawDistanceFailure(queue);
  /* Выбор под рукой; `null` — показываем цель очереди. */
  const [draft, setDraft] = useState(null);
  const shown = normalizeDrawDistance(draft ?? target);
  /* Цвет помнится и при «Как в игре»: вернул дальность — стена та же. */
  const [lastLook, setLastLook] = useState(null);
  const look =
    shown.distance === null
      ? normalizeDrawDistance({ look: lastLook ?? target.look }).look
      : shown.look;
  const canvasRef = useRef(null);
  const preview = useDrawDistancePreview(canvasRef, shown);

  const metres = (value) =>
    fillCopy(copy.metres, { value: String(Math.round(Number(value) || 0)) });
  const wallName = (value) =>
    ({ black: copy.wallBlack, white: copy.wallWhite, custom: copy.wallCustom })[
      wallOf(value.look)
    ];
  const describe = (value) =>
    value.distance === null
      ? copy.valueStock
      : fillCopy(copy.valueSet, {
          distance: value.distance,
          wall: wallName(value).toLowerCase(),
        });

  const choose = useCallback(
    (patch) =>
      setDraft((current) =>
        normalizeDrawDistance({ ...(current ?? target), ...patch }),
      ),
    [target],
  );
  const chooseDistance = useCallback(
    (value) => {
      const distance = Math.max(
        DRAW_DISTANCE_LIMITS.min,
        Math.min(
          DRAW_DISTANCE_LIMITS.max,
          Math.round(
            (Number(value) || DRAW_DISTANCE_DEFAULT) /
              DRAW_DISTANCE_LIMITS.step,
          ) * DRAW_DISTANCE_LIMITS.step,
        ),
      );
      choose({ distance, look });
    },
    [choose, look],
  );
  const chooseLook = useCallback(
    (next) => {
      setLastLook(next);
      choose({ distance: shown.distance ?? DRAW_DISTANCE_DEFAULT, look: next });
    },
    [choose, shown.distance],
  );
  const standard = useCallback(() => {
    setLastLook(look);
    choose({ distance: null });
  }, [choose, look]);

  const install = useCallback(() => {
    const settings = normalizeDrawDistance(shown);
    const outcome = setDrawDistance({
      settings,
      snapshot: queue,
      title: `${copy.title}: ${describe(settings)}`,
      editor,
      copy,
    });
    setDraft(null);
    void outcome?.then((result) => {
      if (result.cancelled) return;
      if (!result.ok) {
        onNotice?.(
          fillCopy(copy.failed, {
            reason: failureText(result.message, gameRunning),
          }),
          "error",
        );
        return;
      }
      onNotice?.(
        settings.distance === null
          ? copy.doneOff
          : fillCopy(copy.doneOn, { distance: settings.distance }),
        "success",
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copy, editor, gameRunning, onNotice, queue, shown]);

  const pending =
    drawDistanceSignature(shown) !== drawDistanceSignature(target);
  const status = !supported
    ? copy.desktopOnly
    : job
      ? fillCopy(job.status === "queued" ? copy.queued : copy.installing, {
          value: describe(normalizeDrawDistance(job.saved)),
        })
      : pending
        ? fillCopy(copy.selected, {
            value: describe(shown),
            installed: describe(installed),
          })
        : fillCopy(copy.inGame, { value: describe(installed) });
  const statusTone = !supported
    ? "off"
    : job
      ? "busy"
      : pending
        ? "info"
        : "on";
  const values = drawDistanceValues(shown);
  const wall = wallOf(look);
  const pictureLabel = fillCopy(copy.picture, { value: describe(shown) });
  const selectedIndex = frameIndex(shown.distance);
  const installedIndex = frameIndex(installed.distance);
  /* Кадры стен — на ступени выбора (при «Как в игре» — на тысяче метров, как в макете). */
  const wallStop =
    shown.distance === null ? 1000 : drawDistanceStop(shown.distance);
  const wallLabels = {
    black: copy.wallBlack,
    white: copy.wallWhite,
    custom: copy.wallCustom,
  };

  const frame = preview.missing.length ? (
    <StageMissing
      title={copy.shotMissing}
      files={preview.missing.map((file) => `${file}.jpg`).join(", ")}
    />
  ) : (
    <canvas
      ref={canvasRef}
      width={1280}
      height={720}
      role="img"
      aria-label={pictureLabel}
    />
  );
  const stage = (
    <OptimizerStage
      kind="distance"
      data={{ "data-distance": shown.distance ?? "stock" }}
      position="50% 62%"
      frame={frame}
      pill={shown.distance === null ? copy.standard : metres(shown.distance)}
      title={tr("Кадр из игры с одной высокой точки")}
      desc={
        <>
          {tr("Меняется только дальность, камера стоит на месте.")}{" "}
          {preview.kind === "custom" && <span>{copy.captionCustom}</span>}
        </>
      }
    />
  );

  /* Линейка: туман с `fog_start`, к дальности сплошной, дальше `far_clip` мир не рисуется. */
  const wallColour =
    wall === "white" ? "#f7f7f7" : wall === "custom" ? look.colour : "#000";
  const fogAt = values ? (values.fog_start / values.far_clip) * 100 : 0;
  const solidAt = values ? (shown.distance / values.far_clip) * 100 : 0;
  const ruler = values ? (
    <div className="opf-ruler">
      <div className="opf-ruler-bar" aria-hidden="true">
        <i
          style={{ width: `${fogAt}%`, background: "rgba(255,255,255,.55)" }}
        />
        <i
          style={{
            width: `${solidAt - fogAt}%`,
            background: `linear-gradient(90deg, rgba(255,255,255,.55), ${wallColour})`,
          }}
        />
        <i style={{ width: `${100 - solidAt}%`, background: wallColour }} />
      </div>
      <div className="opf-ruler-marks">
        <i
          className="opf-ruler-tick"
          style={{ left: `${fogAt}%` }}
          aria-hidden="true"
        />
        <i
          className="opf-ruler-tick"
          style={{ left: `calc(${solidAt}% - 1px)` }}
          aria-hidden="true"
        />
        <span className="opf-ruler-mark" style={{ marginLeft: `${fogAt}%` }}>
          <b>{tr("с {0} м").replace("{0}", String(values.fog_start))}</b>
          {tr("туман")}
        </span>
        <span
          className="opf-ruler-mark is-end"
          style={{ marginRight: `${100 - solidAt}%` }}
        >
          <b>{metres(shown.distance)}</b>
          {tr("сплошной · дальше {0} м мир не рисуется").replace(
            "{0}",
            String(values.far_clip),
          )}
        </span>
      </div>
    </div>
  ) : (
    <p className="opf-sel-text">{copy.factStock}</p>
  );

  const panel = (
    <div className="texture-downgrade-panel opf-pane">
      <h3>{copy.title}</h3>
      <p className="opf-lead">{copy.lead}</p>
      <div className="opf-walls" role="radiogroup" aria-label={copy.wall}>
        {WALLS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            className="opf-wall-card"
            aria-checked={wall === id}
            disabled={!supported}
            onClick={() =>
              chooseLook(
                id === "custom"
                  ? { mode: "solid", colour: "#9aa3ad" }
                  : WALL_PRESETS[id],
              )
            }
          >
            <span className="opf-wall-pic">
              <WallPicture
                stop={wallStop}
                wall={id}
                colour={
                  id === "custom"
                    ? wall === "custom"
                      ? look.colour
                      : "#9aa3ad"
                    : ""
                }
                width={WALL_W}
                height={WALL_H}
              />
            </span>
            <span className="opf-wall-label">
              <i className="opf-radio" aria-hidden="true" />
              {wallLabels[id]}
            </span>
          </button>
        ))}
      </div>
      {wall === "custom" && (
        <div className="opf-custom">
          <ColourEffectField
            label={copy.wallColour}
            value={{
              ...look,
              colour2: look.colour,
              direction: "along",
              width: 2,
              shift: 0,
            }}
            swatches={SWATCHES}
            modes={["solid"]}
            directions={false}
            note={copy.wallColourNote}
            onChange={(next) =>
              chooseLook({ mode: "solid", colour: next.colour })
            }
          />
        </div>
      )}
      <div className="opf-sel">
        <div className="opf-sel-head">
          <span className="opf-sel-big">
            {shown.distance === null ? copy.standard : metres(shown.distance)}
          </span>
          {shown.distance === null ? null : (
            <span className="opf-sel-side">
              {tr("стена: {0}").replace("{0}", wallName(shown).toLowerCase())}
            </span>
          )}
        </div>
        {ruler}
      </div>
      <StatusLine tone={statusTone} failed={Boolean(failure)}>
        {failure ? (
          fillCopy(copy.failed, { reason: failureText(failure, gameRunning) })
        ) : pending && !job && supported ? (
          <SelectedText text={status} />
        ) : (
          status
        )}
      </StatusLine>
      <div className="opf-acts">
        <Button
          icon={<DownloadSimple />}
          variant="primary"
          title={pending ? copy.installHint : copy.installedSame}
          disabled={!supported || !pending}
          onClick={install}
        >
          {copy.install}
        </Button>
        <Button
          icon={<ArrowCounterClockwise />}
          title={copy.standardHint}
          disabled={shown.distance === null}
          onClick={standard}
        >
          {copy.standardButton}
        </Button>
      </div>
      {job ? (
        <InstallProgress job={job} lockLabel={tr("прервать нельзя")} />
      ) : (
        <InstallSteps
          steps={[copy.stepPrepare, copy.stepCompose, copy.stepCommit]}
          lockLabel={tr("прервать нельзя")}
        />
      )}
    </div>
  );

  /* Плёнка: «Как в игре» и по кадру на ступень; у кадра стоящей в игре дальности — галочка. */
  const fileOf = (index) =>
    index === 0
      ? "stock"
      : `${DRAW_DISTANCE_STOPS[index - 1]}-${wall === "white" ? "white" : "black"}`;
  const nameOf = (index) =>
    index === 0 ? copy.standard : metres(DRAW_DISTANCE_STOPS[index - 1]);
  const count = DRAW_DISTANCE_STOPS.length + 1;
  const items = Array.from({ length: count }, (_, index) => {
    let thumb;
    if (index > 0 && wall === "custom")
      thumb = (
        <WallPicture
          stop={DRAW_DISTANCE_STOPS[index - 1]}
          wall="custom"
          colour={look.colour}
          width={TILE_W}
          height={TILE_H}
        />
      );
    else {
      const url = drawDistanceShotUrl(fileOf(index));
      thumb = url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : (
        <span />
      );
    }
    return {
      key: index,
      label: nameOf(index),
      on: index === selectedIndex,
      inGame: index === installedIndex,
      disabled: !supported,
      thumb,
    };
  });
  const nudge = (direction) => {
    if (shown.distance === null) {
      if (direction > 0) chooseDistance(DRAW_DISTANCE_LIMITS.max);
      return;
    }
    const next = shown.distance - direction * DRAW_DISTANCE_LIMITS.step;
    if (next > DRAW_DISTANCE_LIMITS.max) standard();
    else chooseDistance(next);
  };
  const strip = (
    <FilmCard
      title={copy.stops}
      hint={tr(
        "Нажмите на кадр или тяните ползунок · шаг 50 м, кадр — ближайший из снятых",
      )}
      notes={{
        title: copy.notesTitle,
        count: copy.notes.length,
        content: (
          <ul>
            {copy.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ),
      }}
    >
      <FilmTiles
        items={items}
        gap={14}
        tileHeight={80}
        onPick={(index) =>
          index === 0
            ? standard()
            : chooseDistance(DRAW_DISTANCE_STOPS[index - 1])
        }
      />
      <FilmRail
        count={count}
        gap={14}
        value={knobOf(shown.distance)}
        label={copy.distance}
        valueText={
          shown.distance === null ? copy.standard : metres(shown.distance)
        }
        disabled={!supported}
        onChange={(fraction) => {
          const distance = distanceOf(fraction);
          if (distance === null) standard();
          else chooseDistance(distance);
        }}
        onNudge={nudge}
        onJump={(edge) =>
          edge === "start"
            ? standard()
            : chooseDistance(DRAW_DISTANCE_LIMITS.min)
        }
      />
      <FilmLabels
        gap={14}
        items={items.map((item, index) => ({
          label: item.label,
          on: index === selectedIndex,
        }))}
      />
    </FilmCard>
  );

  return (
    <OptimizerSlots
      className="draw-distance"
      label={copy.title}
      slots={slots}
      stage={stage}
      panel={panel}
      strip={strip}
    />
  );
}
