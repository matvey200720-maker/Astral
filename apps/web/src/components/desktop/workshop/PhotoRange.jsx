import { tr, useUiLanguage } from "../../../locales/ui.js";
import { ASTRAL_TRACER_SHAPE, tracerShape } from "@modovik/tracer-contract";
import { useStageLoop } from "./stage-loop.js";
import { memo, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import HudPreviewWindow from "./hud-preview/HudPreviewWindow.jsx";
import {
  PREVIEW_TRACER,
  context2d,
  layerBitmap,
  previewRatio,
  tracerPreviewCanvas,
  tracerTextureKey,
} from "./effects-preview.js";
import TracerRange, { frozenClock } from "./TracerRange.jsx";
import { StageNote } from "../../ui/StageOverlay.jsx";
import { HUD_STREET_SCENE } from "./hud-preview/hud-scenes.js";
import { useEffectsCopy } from "./effects-lang.js";

// Стрельбище на настоящем кадре игры: под слоем запись GTA V, вспышку, след пули,
// попадание и лёгкую тряску рисует Astral (CLAUDE.md, «Что показывать нельзя»;
// docs/DEMO-SCENES.md: «сцена мёртвая, эффекты наши»). Подписей-оговорок на кадре
// нет (решение владельца 25.10.2026), строки состояния живут в панели редактора.
// Нет кадра — переходим на нарисованное стрельбище: пуля обязана лететь при любой погоде.
// Кадры по требованию и предел 60 в секунду (npm run perf, 25.09.2026; docs/3D.md, правило 4);
// сон между очередями — таймером цикла, а не пустыми кадрами.

const TAU = Math.PI * 2;
const IDENTITY = [1, 0, 0, 1, 0, 0];
const scaledBy = (k) => [k, 0, 0, k, 0, 0];

// Времена в миллисекундах; первый выстрел через 600 мс после первого кадра цикла,
// а не после монтирования: часы идут с кадра.
const CLOCKWORK = Object.freeze({
  step: 100, // между выстрелами внутри очереди
  restBase: 1100, // пауза между очередями: 1100 + случайное × 1000
  restSpread: 1000,
  burstMin: 5, // длина очереди: 5 + round(случайное × 2)
  burstSpan: 2,
  flight: 150, // полёт до мишени
  fade: 200, // угасание следа после полёта
  hit: 260, // попадание после полёта
  flash: 70,
  shake: 70,
  first: 600,
  segments: 10,
  minWidth: 1.2,
});
// Размеры и яркости картинки: доли ширины кадра, где не сказано иное.
const LOOK = Object.freeze({
  flashRadius: 0.02,
  flashBase: 0.7,
  flashGrow: 0.6,
  flashCore: 0.95,
  flashTone: 0.6,
  shareBase: 0.12,
  shareGain: 0.8,
  shareCurve: 0.8,
  minSpan: 0.001,
  widthFrac: 0.024,
  widthCurve: 0.7,
  tipNear: 0.45,
  tipFar: 1.6,
  glowBase: 0.6,
  glowGain: 0.4,
  hitFrac: 0.012,
  hitBase: 1.4,
  hitDistance: 0.6,
  hitGrow: 0.4,
  hitAlpha: 0.85,
});
const SHOT_LIFE = CLOCKWORK.flight + CLOCKWORK.fade + CLOCKWORK.hit;
const DEFAULT_TONE = [255, 217, 168];
const DEFAULT_SHAKE = 1.5;
const HEX_DIGITS = "0123456789abcdef";

// Размер текстуры следа задаёт нарезку на сегменты.
const { width: TEX_W = 128, height: TEX_H = 256 } = PREVIEW_TRACER;

// Наибольшие значения шкалы следа берём из контракта; запасные цифры — те, что в описании.
const peakOf = (range, fallback) => {
  const top = Array.isArray(range) ? range[range.length - 1] : range?.max;
  return typeof top === "number" ? top : fallback;
};
const WIDTH_PEAK = peakOf(ASTRAL_TRACER_SHAPE?.width, 0.3);
const LENGTH_PEAK = peakOf(ASTRAL_TRACER_SHAPE?.length, 6);

const atLeast = (floor, value) => Math.max(floor, value);

function isPair(value) {
  return Array.isArray(value) && value.length === 2;
}

// Что должно лежать в комплекте; поля проверяются по порядку, первое негодное обрывает проверку.
const SCENE_SHAPE = {
  muzzle: isPair,
  targets: (list) => Array.isArray(list) && list.length !== 0 && list.every((spot) => isPair(spot.at)),
  video: (value) => typeof value === "string",
  size: isPair,
};

// Годится ли комплект сцены для стрельбы по кадру (всегда булево).
export function validScene(scene) {
  return Boolean(scene) && Object.entries(SCENE_SHAPE).every(([key, fits]) => fits(scene[key]));
}

// Тон вспышки: ровно шесть шестнадцатеричных цифр с необязательной решёткой.
function toneOf(tone) {
  const digits = String(tone).replace(/^#/, "");
  const fits = digits.length === 6 && [...digits.toLowerCase()].every((ch) => HEX_DIGITS.includes(ch));
  if (!fits) return DEFAULT_TONE;
  return [0, 1, 2].map((at) => parseInt(digits.slice(at * 2, at * 2 + 2), 16));
}

// Шанс 0 — следа нет совсем («Без трассера»); иначе виден хотя бы один из пятидесяти:
// ползунок на малых значениях не должен казаться сломанным.
const lucky = (chance) => chance > 0 && atLeast(0.02, chance) > Math.random();

// Очередь выстрелов: порядок вызовов случайного важен (длина, мишень, видимость, пауза).
function* volleys(targetCount, readChance) {
  const rest = () => CLOCKWORK.restBase + Math.random() * CLOCKWORK.restSpread;
  for (;;) {
    let remaining = CLOCKWORK.burstMin + Math.round(Math.random() * CLOCKWORK.burstSpan);
    const roll = Math.random();
    const target = Math.floor(roll * targetCount);
    while (remaining > 0) {
      const visible = lucky(readChance());
      remaining -= 1;
      yield { target, visible, wait: remaining > 0 ? CLOCKWORK.step : rest() };
    }
  }
}

// Имена в списке операций, которые присваиваются свойству контекста, а не вызываются как метод.
const SETTERS = new Set(["fillStyle", "strokeStyle", "lineWidth", "globalAlpha", "globalCompositeOperation"]);

// Кадр собирается списком операций «метод или свойство, аргументы» и проигрывается на контексте.
function play(g, script) {
  for (const [name, ...args] of script) {
    if (SETTERS.has(name)) g[name] = args[0];
    else g[name](...args);
  }
}

const stampDisc = (at, r) => [["beginPath"], ["arc", ...at, r, 0, TAU], ["fill"]];
// Радиальное свечение: вспышка на дуле и попадание.
function bloom(g, at, radius, stops) {
  const fill = g.createRadialGradient(...[...at, 0, ...at, radius]);
  stops.forEach(([where, colour]) => fill.addColorStop(where, colour));
  return [["fillStyle", fill], ...stampDisc(at, radius)];
}

const flashOps = (g, c, age) => {
  const life = 1 - age / CLOCKWORK.flash;
  if (!(life > 0)) return [];
  const radius = c.rect.width * LOOK.flashRadius * (LOOK.flashBase + LOOK.flashGrow * (1 - life));
  const [red, green, blue] = c.tone;
  return bloom(g, c.muzzle, radius, [
    [0, `rgba(255, 245, 220, ${LOOK.flashCore * life})`],
    [0.45, `rgba(${red}, ${green}, ${blue}, ${LOOK.flashTone * life})`],
    [1, "rgba(0, 0, 0, 0)"],
  ]);
};

// След: текстура режется на десять горизонтальных полос вдоль луча, голова сверху.
const trailOps = (c, age, since, goal, distance) => {
  const [mx, my] = c.muzzle;
  const way = [goal[0] - mx, goal[1] - my];
  const lead = Math.min(age / CLOCKWORK.flight, 1);
  const share = LOOK.shareBase + LOOK.shareGain * (c.shape.length / LENGTH_PEAK) ** LOOK.shareCurve;
  const tail = atLeast(0, lead - share);
  const fade = since <= 0 ? 1 : atLeast(0, 1 - since / CLOCKWORK.fade);
  if (!(fade > 0 && lead > tail)) return [];
  const span = atLeast(LOOK.minSpan, lead - tail);
  const girth = c.rect.width * LOOK.widthFrac * (c.shape.width / WIDTH_PEAK) ** LOOK.widthCurve;
  const tip = girth * (LOOK.tipNear / atLeast(LOOK.tipNear, distance * LOOK.tipFar));
  const tilt = Math.PI / 2 + Math.atan2(way[1], way[0]);
  const share01 = (p) => (p - tail) / span;
  const marks = Array.from({ length: CLOCKWORK.segments + 1 }, (_, i) => tail + (span * i) / CLOCKWORK.segments);
  const strips = marks.slice(1).flatMap((to, i) => {
    const from = marks[i];
    const width = atLeast(CLOCKWORK.minWidth, girth + (tip - girth) * ((from + to) / 2));
    const upper = (1 - share01(to)) * TEX_H;
    const lower = (1 - share01(from)) * TEX_H;
    const reach = Math.hypot(way[0] * (to - from), way[1] * (to - from)) + 0.5;
    return [
      ["save"],
      ["translate", mx + way[0] * to, my + way[1] * to],
      ["rotate", tilt],
      ["drawImage", c.texture, 0, upper, TEX_W, atLeast(1, lower - upper), width * -0.5, 0, width, reach],
      ["restore"],
    ];
  });
  return [["save"], ["globalAlpha", fade * (LOOK.glowBase + LOOK.glowGain * c.glow)], ...strips, ["restore"]];
};

const hitOps = (g, c, since, goal, distance) => {
  const life = 1 - since / CLOCKWORK.hit;
  if (!(since > 0 && life > 0)) return [];
  const radius = c.rect.width * LOOK.hitFrac * (LOOK.hitBase - distance * LOOK.hitDistance) * (LOOK.hitBase - life * LOOK.hitGrow);
  return bloom(g, goal, radius, [
    [0, `rgba(255, 230, 180, ${LOOK.hitAlpha * life})`],
    [1, "rgba(0, 0, 0, 0)"],
  ]);
};

class Gunfire {
  constructor(g, canvas, scene, live) {
    Object.assign(this, { g, canvas, scene, live });
    this.tone = toneOf(scene.ambient?.tone);
    this.shakeLimit = Number(scene.ambient?.shake) || DEFAULT_SHAKE;
    this.rolls = volleys(scene.targets.length, () => this.live.current.chance);
    this.shots = [];
    this.nextAt = null;
    this.shakeEnd = 0;
    this.shifted = false;
    this.dirty = false;
  }

  // Один кадр цикла; возвращает 0 (следующая развёртка) или число мс сна до выстрела.
  step(t, stopped) {
    this.nextAt ??= t + CLOCKWORK.first;
    if (!stopped && t >= this.nextAt) this.spawn(t);
    this.shots = this.shots.filter((shot) => t - shot.born <= SHOT_LIFE);
    this.shake(t, stopped);
    this.repaint(t, stopped);
    return this.shots.length > 0 || t < this.shakeEnd ? 0 : atLeast(0, this.nextAt - t);
  }

  // За один кадр рождается не больше одного выстрела.
  spawn(t) {
    const { target, visible, wait } = this.rolls.next().value;
    this.shots.push({ born: t, target, visible });
    this.nextAt = t + wait;
    this.shakeEnd = t + CLOCKWORK.shake;
  }

  // Тряска — дело окна: оно двигает кадр вместе со слоем, вспышка остаётся на дуле; на паузе
  // толчок снимается (кадр, застывший в сдвиге, читается как съехавшая вёрстка).
  // Порядок арифметики важен: строка transform сверяется буква в букву.
  shake(t, stopped) {
    const { nudge } = this.live.current.geometry;
    const left = this.shakeEnd - t;
    if (!stopped && left > 0) {
      const power = this.shakeLimit * (left / CLOCKWORK.shake);
      const jolt = () => {
        const spread = Math.random() - 0.5;
        return spread * 2 * power;
      };
      const [dx, dy] = [jolt(), jolt()];
      nudge(dx, dy);
      this.shifted = true;
    } else if (this.shifted) {
      this.shifted = false;
      nudge(0, 0);
    }
  }

  repaint(t, stopped) {
    const airborne = this.shots.length > 0;
    // Закрашенный холст, стоп-кадр и выстрелы в воздухе требуют очистки; пустая сцена холст не трогает.
    if (this.dirty || stopped || airborne) {
      play(this.g, [
        ["setTransform", ...IDENTITY],
        ["clearRect", 0, 0, this.canvas.width, this.canvas.height],
        ["setTransform", ...scaledBy(previewRatio())],
      ]);
    }
    this.dirty = airborne;
    if (airborne) play(this.g, this.script(t));
  }

  script(t) {
    const { geometry, tracer, texture } = this.live.current;
    const rect = geometry.frame;
    const spot = ([fx, fy]) => [rect.x + fx * rect.width, rect.y + fy * rect.height];
    const c = { rect, texture, tone: this.tone, muzzle: spot(this.scene.muzzle), shape: tracerShape(tracer), glow: tracer.glow };
    const perShot = (shot) => {
      const { born, visible } = shot;
      const age = t - born;
      const flash = flashOps(this.g, c, age);
      if (!visible) return flash;
      const aim = this.scene.targets[shot.target];
      const goal = spot(aim.at);
      const distance = aim.distance || 1;
      const since = age - CLOCKWORK.flight;
      return [
        ...flash,
        ...(texture ? trailOps(c, age, since, goal, distance) : []),
        ...hitOps(this.g, c, since, goal, distance),
      ];
    };
    return [
      ["globalCompositeOperation", "lighter"],
      ...this.shots.flatMap(perShot),
      ["globalCompositeOperation", "source-over"],
    ];
  }

  // Сброс сдвига при остановке цикла (на размонтировании узла уже нет, и это ни на что не влияет).
  release() {
    this.live.current.geometry.nudge(0, 0);
  }
}

// Кадр читает размеры, след и шанс из последней отрисовки: цикл из-за них не перезапускается.
function useLatest(value) {
  const box = useRef(value);
  useLayoutEffect(() => {
    box.current = value;
  });
  return box;
}

const bitmapAttrs = (layer) => {
  const { width, height } = layerBitmap(layer);
  return { className: "fx-range-canvas", width, height, role: "presentation" };
};

// Время сцены, а не показание часов: пока оно стоит, очередь не набегает и стоп-кадр выходит тем же.
function settingsFor(fire) {
  const frame = (time, info) => fire.step(time, info.stopped);
  const dispose = () => fire.release();
  return { clock: frozenClock(), frame, maxFps: 60, dispose };
}

// Фабрика настроек для useFrameLoop; нет холста или контекста — цикла нет.
const attachTo = (g, canvas, scene, live) => (g ? settingsFor(new Gunfire(g, canvas, scene, live)) : null);
const bootShots = (scene, live) => (canvas) => attachTo(context2d(canvas), canvas, scene, live);

// Слой стрельбы по кадру игры: холст поверх видео, кадры по требованию через цикл.
function ShotLayer(props) {
  const { geometry, scene, tracer, chance, texture } = props;
  const live = useLatest({ geometry, tracer, chance, texture });
  const surface = useRef(null);
  useStageLoop(surface, bootShots(scene, live), [scene]);
  return <canvas ref={surface} {...bitmapAttrs(geometry.layer)} />;
}

// Текстура одна на всё стрельбище; толщина и длина в ключ не входят — они правят размер спрайта, не пиксели.
function useTexture(tracer) {
  const key = tracerTextureKey(tracer);
  return useMemo(
    function build() {
      return tracerPreviewCanvas(tracer);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- пересборка только по ключу текстуры
    [key],
  );
}

// Кадр один («Ролик»): стоп-кадр из общего списка — картинка без дула и мишеней, стрелять по нему не из чего.
function useFrames(lang) {
  return useMemo(
    function list() {
      const street = Object.assign({ id: "street" }, { label: tr("Живой кадр"), scene: HUD_STREET_SCENE });
      return Object.freeze([Object.freeze(street)]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- язык — ключ пересборки: подпись берётся из tr()
    [lang],
  );
}

// Причина отказа кадра: окно сообщает её ошибкой, обратного хода нет.
const reasonOf = (_before, error) => error?.message || tr("кадр не загрузился");
const useFrameLoss = () => useReducer(reasonOf, "");

// Строка про флаги профиля: «Без трассера» важнее «Только чужие».
function flagsNote(tracerOff, ownShotsHidden) {
  if (tracerOff) {
    return tr("У выбранного трассера стоит «Без трассера»: выстрелы в кадре идут без следа — таким их увидите в игре.");
  }
  if (ownShotsHidden) {
    return tr(
      "В кадре стреляете вы, а у этого трассера стоит «Только чужие»: в игре у своих выстрелов следа не будет, у чужих поодаль он будет таким.",
    );
  }
  return "";
}

// Слой пуст, пока комплект в пути: нарисованное стрельбище включается только по слову окна «кадра не будет».
const layerFor = (state) => (geometry) => {
  const { source } = geometry;
  const common = { geometry, tracer: state.tracer, chance: state.chance, texture: state.texture };
  if (!state.lost) {
    if (!source) return null;
    if (validScene(source.manifest)) return <ShotLayer {...common} scene={source.manifest} />;
  }
  return <TracerRange {...common} />;
};

function PhotoRange(props) {
  const { tracer, chance = 1 } = props;
  const { ownShotsHidden = false, tracerOff = false } = props;
  const texture = useTexture(tracer);
  const [lost, onError] = useFrameLoss();
  const frames = useFrames(useUiLanguage());
  const copy = useEffectsCopy();
  const windowProps = { className: "fx-range-window", frames, onError };

  // Порядок строк в слоте — порядок монтирования: после отказа предупреждение встаёт последним.
  const notes = [
    { id: "lost", tone: "warning", text: lost ? copy.frameLost(lost) : "" },
    {
      id: "intro",
      text: lost
        ? ""
        : tr(
            "Под слоем — запись кадра GTA V. Вспышку, след и попадание рисует Astral: след — та же текстура слота, что уедет в игру, растянутая от дула к мишени, как это делает частица игры.",
          ),
    },
    { id: "flags", text: flagsNote(tracerOff, ownShotsHidden) },
  ];

  return (
    <div className="fx-range">
      <HudPreviewWindow {...windowProps}>{layerFor({ tracer, chance, texture, lost })}</HudPreviewWindow>
      {notes.map(({ id, text, ...extra }) => (
        <StageNote key={id} {...extra}>
          {text}
        </StageNote>
      ))}
    </div>
  );
}

// memo: редактор перерисовывается от каждого движения любого ползунка, а слой читает настройки
// из ссылок; tracer сравнивается по ссылке — редактор отдаёт новый объект, только когда след правили.
const PhotoRangeMemo = memo(PhotoRange);

export default PhotoRangeMemo;
