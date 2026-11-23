import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  RELOAD_ICONS,
  RELOAD_IDLE,
  RELOAD_KINDS,
  RELOAD_LIMITS,
  RELOAD_LINE_FROM,
  RELOAD_PHASE,
  RELOAD_PLACES,
  RELOAD_PRESETS,
  RELOAD_SEGMENTS,
  RELOAD_STEPS,
  normalizeReloadIndicator,
  reloadAmmo,
  reloadBox,
  reloadFrameShapes,
  reloadIdle,
  reloadLook,
  reloadPlacement,
  reloadPresetConfig,
  reloadPresetOf,
  reloadTick,
  reloadWeapon,
} from "@modovik/reticle-contract";
import { ArrowClockwise } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import Checkbox from "../../../ui/Checkbox.jsx";
import ColorField from "../../../ui/ColorField.jsx";
import NavRow from "../../../ui/NavRow.jsx";
import PanelPage from "../../../ui/PanelPage.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import { RETICLE_SWATCHES } from "./ReticleInspector.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Индикатор перезарядки (владелец, 14.11.2026) — инструмент редактора прицела:
 * панель настроек и индикатор в кадре. Один на обе вкладки и все стволы, лежит в
 * модуле обычного прицела (`reloadIndicator`).
 *
 * Слова «перезарядка» игра фильмам HUD не шлёт — индикатор видит числа патронов
 * (`reticle-contract/reload.js`), и панель говорит об этом сразу. Кадр и файл
 * идут по одному автомату (`reloadAmmo`, `reloadTick`) и по часам, а не по
 * кадрам: файл читает `getTimer()`, кадр — время от нажатия кнопки. Рисуют одни и
 * те же кадры заливки (`reloadFrameShapes`); кнопки «Перезарядка», «Ручная» и
 * «По патрону» подают кадру те же числа, что подаёт игра. Длительность у ствола —
 * из таблицы, которую установка берёт из файлов игры (`reloadIdle(таблица)`); в
 * кадре редактора — пример `DEMO_TIMES`. Как это устроено в файле —
 * `apps/desktop/src/reticle-reload-gfx.js`.
 */

/* Пока панель открыта, а индикатор не играет, — заливка застыла на этой ступени: видно и залитую, и пустую часть. */
const STILL_STEP = Math.round(RELOAD_STEPS * 0.65);
/* Подложка плиток — та же матовая, что у плиток вида прицела (`RETICLE_PLATE`). */
const PLATE = "#141517";

/* Сценарии кнопок: [мс от нажатия, событие]; событие — ствол или числа патронов [запас, в обойме, размер]. */
const SCRIPTS = Object.freeze({
  auto: [
    [0, { weapon: 1 }],
    [0, [90, 30, 30]],
    [0, [90, 0, 30]],
    [2000, [60, 30, 30]],
  ],
  manual: [
    [0, { weapon: 2 }],
    [0, [90, 12, 30]],
    [0, [72, 30, 30]],
  ],
  shell: [
    [0, { weapon: 3 }],
    [0, [20, 1, 8]],
    [0, [20, 0, 8]],
    ...Array.from({ length: 8 }, (_, index) => [
      240 * (index + 1),
      [19 - index, index + 1, 8],
    ]),
  ],
});

/* Длительности стволов сценариев, мс: в игре они из файлов игры, здесь — пример. */
const DEMO_TIMES = Object.freeze({ 1: 2000, 3: 2000 });

/* Кадры заливки индикатора: считаются один раз на вид, а не на каждый кадр анимации. */
function useFrames(config) {
  const key = JSON.stringify({
    ...config,
    enabled: true,
    opacity: 0,
    manualFlash: true,
    x: 0,
    y: 0,
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cache = useMemo(() => new Map(), [key]);
  return (step) => {
    if (!cache.has(step)) cache.set(step, reloadFrameShapes(config, step));
    return cache.get(step);
  };
}

const pathOf = (contours) =>
  contours
    .map(
      (loop) =>
        `M${loop.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`,
    )
    .join("");

/** Один кадр индикатора: пустая часть и заливка с цветами и прозрачностью файла. */
export const ReloadArt = memo(function ReloadArt({
  config,
  shapes,
  alpha = 100,
}) {
  return (
    <g opacity={alpha / 100}>
      {shapes.track.length && config.trackOpacity > 0 ? (
        <path
          d={pathOf(shapes.track)}
          fill={config.trackColor}
          fillOpacity={config.trackOpacity / 100}
          fillRule="evenodd"
        />
      ) : null}
      {shapes.fill.length ? (
        <path d={pathOf(shapes.fill)} fill={config.color} fillRule="evenodd" />
      ) : null}
    </g>
  );
});

/**
 * Индикатор в кадре. Состояние автомата живёт здесь, чтобы кадры анимации не
 * перерисовывали весь редактор; запуск снаружи — `ref.current.play(сценарий)`.
 */
export const ReloadLayer = forwardRef(function ReloadLayer(
  { config: input, editing = false, onMove = null },
  ref,
) {
  useTr();
  const config = normalizeReloadIndicator(input);
  const [run, setRun] = useState({
    state: RELOAD_IDLE,
    ms: 0,
    script: null,
  });
  const live = useRef(config);
  live.current = config;
  const frames = useFrames(config);

  useImperativeHandle(
    ref,
    () => ({
      play: (name) => {
        const script = SCRIPTS[name];
        if (!script) return;
        setRun({
          state: feed(reloadIdle(DEMO_TIMES), script, -1, 0, live.current),
          ms: 0,
          script,
        });
      },
    }),
    [],
  );

  /*
   * Кадры — пока индикатор играет; время — часы от нажатия кнопки (`run.ms`), как
   * `getTimer()` в файле: сколько кадров успел браузер, на заливку не влияет.
   */
  const playing =
    run.state.phase !== RELOAD_PHASE.idle ||
    Boolean(run.script && run.ms < lastAt(run.script));
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let last = performance.now();
    const step = (now) => {
      const passed = Math.max(0, now - last);
      last = now;
      if (passed > 0)
        setRun((current) => {
          const ms = current.ms + passed;
          const fed = current.script
            ? feed(current.state, current.script, current.ms, ms, live.current)
            : current.state;
          return { ...current, ms, state: reloadTick(fed, ms) };
        });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const box = useRef(null);
  const drag = useRef(null);
  const look = reloadLook(run.state, config);
  if (!look.visible && !editing) return null;
  const step = look.visible ? look.step : STILL_STEP;
  const alpha = look.visible ? look.alpha : config.opacity;
  const { width, height } = reloadBox(config);

  const pointAt = (event) => {
    const svg = box.current?.ownerSVGElement;
    const matrix = svg?.getScreenCTM?.();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  };
  const clamp = (value, limit) =>
    Math.round(Math.min(limit.max, Math.max(limit.min, value)));
  const onPointerDown = (event) => {
    if (!editing || !onMove) return;
    const point = pointAt(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { dx: config.x - point.x, dy: config.y - point.y };
  };
  const onPointerMove = (event) => {
    if (!drag.current) return;
    const point = pointAt(event);
    if (!point) return;
    onMove({
      x: clamp(point.x + drag.current.dx, RELOAD_LIMITS.x),
      y: clamp(point.y + drag.current.dy, RELOAD_LIMITS.y),
    });
  };
  const onPointerUp = (event) => {
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <g
      ref={box}
      className={`reticle-reload-art${editing ? " is-editing" : ""}${config.enabled ? "" : " is-off"}`}
      data-reload-step={step}
      data-reload-phase={run.state.phase}
      transform={`translate(${config.x} ${config.y})`}
      aria-label={tr("Индикатор перезарядки")}
    >
      {editing && (
        <rect
          className="reticle-ammo-frame"
          x={-width / 2 - 4}
          y={-height / 2 - 4}
          width={width + 8}
          height={height + 8}
          rx={3}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      )}
      <g pointerEvents="none">
        <ReloadArt config={config} shapes={frames(step)} alpha={alpha} />
      </g>
    </g>
  );
});

const lastAt = (script) => script.reduce((most, [at]) => Math.max(most, at), 0);

/*
 * События сценария после `from` и до `to` мс включительно — тем же автоматом, которым
 * файл встречает числа игры, каждое в свой миг; перед ним — кадр в тот же миг.
 */
function feed(state, script, from, to, config) {
  let next = state;
  for (const [at, event] of script) {
    if (!(at > from && at <= to)) continue;
    next = reloadTick(next, at);
    next = Array.isArray(event)
      ? reloadAmmo(
          next,
          config,
          { reserve: event[0], clip: event[1], size: event[2] },
          at,
        )
      : reloadWeapon(next, event.weapon);
  }
  return next;
}

/* --------------------------- панель --------------------------- */

function Section({ title, children }) {
  return (
    <section
      className="ui-panel fx-section reticle-ammo-section"
      aria-label={title}
    >
      {children}
    </section>
  );
}

/* Плитка готового индикатора или значка: тот же кадр заливки, что в игре, застывший на двух третях. */
const ReloadTile = memo(function ReloadTile({
  config,
  label,
  note,
  active,
  onSelect,
}) {
  useTr();
  const shapes = useMemo(() => reloadFrameShapes(config, STILL_STEP), [config]);
  const { width, height } = reloadBox(config);
  const reach = Math.max(width, height, 8) * 0.62;
  return (
    <button
      type="button"
      className={`fx-style reticle-style${active ? " is-active" : ""}`}
      aria-pressed={active}
      onClick={onSelect}
    >
      <svg
        className="reticle-style-preview"
        viewBox={`${-reach} ${-reach} ${reach * 2} ${reach * 2}`}
        aria-hidden="true"
        focusable="false"
      >
        <rect
          x={-reach}
          y={-reach}
          width={reach * 2}
          height={reach * 2}
          fill={PLATE}
        />
        <ReloadArt config={{ ...config, x: 0, y: 0 }} shapes={shapes} />
      </svg>
      <span className="fx-style-copy">
        <b>{label}</b>
        {note ? <small>{note}</small> : null}
      </span>
    </button>
  );
});

const PAGES = Object.freeze([
  { id: "look", title: "Вид" },
  { id: "colour", title: "Цвет" },
  { id: "place", title: "Где" },
  { id: "manual", title: "Ручная перезарядка" },
]);

const labelOf = (list, id) =>
  tr(list.find((item) => item.id === id)?.label || "");

function captions(config) {
  const kind =
    config.kind === "icon"
      ? `${labelOf(RELOAD_KINDS, "icon")} · ${labelOf(RELOAD_ICONS, config.icon)}`
      : labelOf(RELOAD_KINDS, config.kind);
  return {
    look: `${kind} · ${config.size}`,
    colour: `${config.color} · ${config.opacity} ${tr("%")}`,
    place: `${config.x} · ${config.y}`,
    manual: config.manualFlash ? tr("Вспышка в конце") : tr("Без вспышки"),
  };
}

/**
 * Панель инструмента «Перезарядка». `onPatch(change, label, property)` — правка
 * индикатора (`change` — его поля); `onPlay(сценарий)` — показать в кадре.
 */
export function ReticleReloadPanel({ config: input, onPatch, onPlay = null }) {
  useTr();
  const [page, setPage] = useState("");
  const config = normalizeReloadIndicator(input);
  const set = (field, label) => (value) =>
    onPatch({ [field]: value }, label, field);
  const limit = (name) => RELOAD_LIMITS[name];
  const slider = (name, history) => (
    <Slider
      editable
      label={tr(limit(name).label)}
      value={config[name]}
      min={limit(name).min}
      max={limit(name).max}
      step={limit(name).step}
      unit={limit(name).unit ? tr(limit(name).unit) : undefined}
      onChange={set(name, tr(history))}
    />
  );
  const presetId = reloadPresetOf(config);

  function reloadPage(id) {
    if (id === "look")
      return (
        <Section title={tr("Вид")}>
          <SegmentedControl
            label={tr("Вид индикатора")}
            size="sm"
            value={config.kind}
            onChange={set("kind", tr("Перезарядка: вид"))}
            options={RELOAD_KINDS.map((item) => ({
              value: item.id,
              label: tr(item.label),
              title: tr(item.note),
            }))}
          />
          {config.kind === "icon" ? (
            <div
              className="fx-style-grid reticle-style-grid"
              role="group"
              aria-label={tr("Значок")}
            >
              {RELOAD_ICONS.map((item) => (
                <ReloadTile
                  key={item.id}
                  config={{ ...config, icon: item.id }}
                  label={tr(item.label)}
                  active={config.icon === item.id}
                  onSelect={() =>
                    onPatch(
                      { icon: item.id },
                      tr("Перезарядка: значок"),
                      "icon",
                    )
                  }
                />
              ))}
            </div>
          ) : null}
          {config.kind === "ring" ? (
            <SegmentedControl
              label={tr("Дуги кольца")}
              size="sm"
              value={String(config.segments)}
              onChange={(value) =>
                onPatch(
                  { segments: Number(value) },
                  tr("Перезарядка: дуги"),
                  "segments",
                )
              }
              options={RELOAD_SEGMENTS.map((count) => ({
                value: String(count),
                label: count ? String(count) : tr("Целое"),
              }))}
            />
          ) : null}
          {config.kind === "line" ? (
            <SegmentedControl
              label={tr("Откуда заливка")}
              size="sm"
              value={config.lineFrom}
              onChange={set("lineFrom", tr("Перезарядка: откуда заливка"))}
              options={RELOAD_LINE_FROM.map((item) => ({
                value: item.id,
                label: tr(item.label),
              }))}
            />
          ) : null}
          {slider("size", "Перезарядка: размер")}
          {config.kind === "icon"
            ? null
            : slider("thickness", "Перезарядка: толщина")}
        </Section>
      );
    if (id === "colour")
      return (
        <Section title={tr("Цвет")}>
          <ColorField
            label={tr("Цвет заливки")}
            value={config.color}
            swatches={RETICLE_SWATCHES}
            editable
            onChange={set("color", tr("Перезарядка: цвет"))}
          />
          <ColorField
            label={tr("Цвет пустой части")}
            value={config.trackColor}
            swatches={RETICLE_SWATCHES}
            editable
            onChange={set("trackColor", tr("Перезарядка: цвет пустой части"))}
          />
          {slider("trackOpacity", "Перезарядка: пустая часть")}
          {slider("opacity", "Перезарядка: прозрачность")}
        </Section>
      );
    if (id === "place")
      return (
        <Section title={tr("Где")}>
          <p className="fx-hint">
            {tr(
              "Перетащите индикатор в кадре или задайте сдвиг от середины прицела в точках экрана 1280×720. Прицел игра ставит в середину экрана.",
            )}
          </p>
          <div
            className="reticle-reload-places"
            role="group"
            aria-label={tr("Быстрое место")}
          >
            {RELOAD_PLACES.map((item) => (
              <Button
                key={item.id}
                variant="secondary"
                size="sm"
                data-reload-place={item.id}
                onClick={() =>
                  onPatch(
                    reloadPlacement(config, item.id),
                    tr("Перезарядка: место"),
                    "position",
                  )
                }
              >
                {tr(item.label)}
              </Button>
            ))}
          </div>
          {slider("x", "Перезарядка: место")}
          {slider("y", "Перезарядка: место")}
        </Section>
      );
    if (id === "manual")
      return (
        <Section title={tr("Ручная перезарядка")}>
          <Checkbox
            label={tr("При ручной перезарядке вспыхивает в конце")}
            hint={tr(
              "Индикатор быстро дозаливается, когда обойма снова полная",
            )}
            checked={config.manualFlash}
            onChange={set("manualFlash", tr("Перезарядка: вспышка в конце"))}
          />
          <p className="fx-hint is-open">
            {tr(
              "Когда вы перезаряжаете неполную обойму сами, игра присылает только новые числа в конце: начала Astral не видит, поэтому заливки по ходу нет.",
            )}
          </p>
        </Section>
      );
    return null;
  }

  const open = PAGES.find((item) => item.id === page);
  if (open)
    return (
      <PanelPage
        label={tr(open.title)}
        note={tr("Перезарядка")}
        backLabel={tr("Перезарядка")}
        onBack={() => setPage("")}
      >
        {reloadPage(open.id)}
      </PanelPage>
    );
  const shown = captions(config);
  return (
    <>
      <section
        className="ui-panel fx-section reticle-ammo-head"
        aria-label={tr("Индикатор перезарядки")}
      >
        <label className="ui-field reticle-toggle">
          <span>{tr("Индикатор в игре")}</span>
          <Switch
            checked={config.enabled}
            label={
              config.enabled
                ? tr("Убрать индикатор перезарядки")
                : tr("Поставить индикатор перезарядки")
            }
            onChange={(on) =>
              onPatch(
                { enabled: on },
                on
                  ? tr("Индикатор перезарядки включён")
                  : tr("Индикатор перезарядки выключен"),
                "enabled",
              )
            }
          />
        </label>
        {config.enabled ? null : (
          <p className="fx-hint reticle-ammo-off" role="status">
            {tr(
              "Выключен: «Применить» поставит прицел без индикатора, а в кадре он бледный. Любая настройка ниже включит его.",
            )}
          </p>
        )}
        {/* Те же числа, что шлёт игра: обойма пустеет и наполняется. */}
        <div className="reticle-ammo-actions reticle-reload-actions">
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowClockwise />}
            title={tr(
              "Обойма опустела: заливка идёт, пока игра не пришлёт полную обойму",
            )}
            onClick={() => onPlay?.("auto")}
          >
            {tr("Перезарядка")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            title={tr(
              "Вы перезарядили неполную обойму сами: индикатор вспыхивает в конце",
            )}
            onClick={() => onPlay?.("manual")}
          >
            {tr("Ручная")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            title={tr("Дробовик заряжается патрон за патроном")}
            onClick={() => onPlay?.("shell")}
          >
            {tr("По патрону")}
          </Button>
        </div>
      </section>
      <section
        className="ui-panel fx-section reticle-ammo-section"
        aria-label={tr("Готовые")}
      >
        <h3 className="reticle-damage-group-title">{tr("Готовые")}</h3>
        <div className="fx-style-grid reticle-style-grid">
          {RELOAD_PRESETS.map((item) => (
            <ReloadTile
              key={item.id}
              config={reloadPresetConfig(item, config)}
              label={tr(item.label)}
              active={presetId === item.id}
              onSelect={() =>
                onPatch(
                  reloadPresetConfig(item, config),
                  `${tr("Готовый индикатор")}: ${tr(item.label)}`,
                  "preset",
                )
              }
            />
          ))}
        </div>
      </section>
      <section
        className="ui-panel fx-section reticle-ammo-section"
        aria-label={tr("Как работает")}
      >
        <h3 className="reticle-damage-group-title">{tr("Как работает")}</h3>
        <p className="fx-hint is-open">
          {tr(
            "Слова «перезарядка» игра прицелу не шлёт. Astral смотрит на числа патронов: обойма опустела, а запас есть — заливка пошла; обойма снова полная — заливка закончилась.",
          )}
        </p>
        <p className="fx-hint is-open">
          {tr(
            "Длительность перезарядки каждого ствола Astral берёт при установке из файлов игры: weapons.meta и клипа перезарядки. Не успела — заливка ждёт на 95 %. Если у ствола длительность не нашлась, заливки по ходу нет: индикатор дозаливается, когда приходит полная обойма.",
          )}
        </p>
        <p className="fx-hint is-open">
          {tr(
            "У гранат, РПГ и оружия без обоймы индикатора нет. Если сервер прячет прицел целиком, индикатор прячется вместе с ним.",
          )}
        </p>
      </section>
      <section
        className="ui-panel fx-section reticle-ammo-pages"
        aria-label={tr("Настройки индикатора")}
      >
        <div className="fx-nav-rows">
          {PAGES.map((item) => (
            <NavRow
              key={item.id}
              title={tr(item.title)}
              caption={shown[item.id]}
              data-reload-page={item.id}
              onOpen={() => setPage(item.id)}
            />
          ))}
        </div>
      </section>
    </>
  );
}
