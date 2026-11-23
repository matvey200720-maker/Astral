/*
 * Работа редактора фонарей.
 *
 * Документ — не числа из файлов игры, а замысел: какого цвета свет, во
 * сколько раз ярче, есть ли луч и блик, какие частицы. Каждая настройка —
 * ПРЕОБРАЗОВАНИЕ того, что у лампы уже есть: «яркость 150 %» умножает силу
 * каждой лампы Rockstar, а не ставит всем одну; «дальность 80 %» сжимает
 * радиус каждой. Поэтому нейтральная настройка значит «не трогать», а один и
 * тот же вид ложится и на ваниль, и на уже поставленный мод фонарей.
 *
 * Цвет — исключение: он задаётся цветом (`#RRGGBB`), «радугой» (у каждого
 * вида фонаря свой цвет спектра) или `null` — «как в игре», у каждой лампы
 * свой.
 *
 * ФОНАРИ — ВСЕ СРАЗУ. Выбор групп («улицы / у зданий / прожекторы») снят
 * 28.09.2026 по просьбе владельца: настройка применяется ко всем фонарям.
 * Поле `groups` в документе осталось — его читают прежние коды и работы, — но
 * в нём всегда все группы.
 *
 * БЛИК ВЫКЛЮЧЕН С ПЕРВОГО ОТКРЫТИЯ. Ослепляющий ореол ламп — то, на что
 * жалуются в игре больше всего, и владелец попросил, чтобы у человека он был
 * выключен изначально. Поэтому свежая работа — это уже правка («без бликов»),
 * а «как в игре» — отдельный готовый вид с бликом. Так же устроено и небо:
 * новое небо Astral без бликов объектива.
 *
 * ЧАСТИЦЫ — ВЫКЛЮЧАТЕЛЬ. Шаблон («голубые бабочки», «сакура», своя картинка)
 * выбирается отдельно от того, включены ли они: выключил и включил — вернулся
 * тот же рой с теми же настройками.
 *
 * ВИД И ПОВЕДЕНИЕ — ОТДЕЛЬНО (схема 3, 29.09.2026). Шаблон — это вид частиц,
 * `motion` — как они летят: кружат, падают или парят; сочетать можно любые
 * (кроме листьев — они только падают). `speed` — темп полёта. В схеме 2 и
 * раньше движение было у шаблона своё, а поле `motion` значило что-то только
 * у своей картинки: такие работы и коды открываются с родным движением
 * шаблона — сакура по-прежнему падает, а не кружит.
 *
 * СТОЛБ (схема 4, 11.10.2026): цвет, блеск, прозрачность корпуса и
 * украшения — раздел `pole` (`pole.js`). Работа без него — столбы как в
 * игре.
 */

import { LAMP_GROUP_IDS } from "./families.js";
import { createPoleSection, normalizePoleSection, poleChanged } from "./pole.js";
import { normalizeHex, normalizeLightColour } from "./palette.js";
import {
  CUSTOM_MOTION_IDS,
  CUSTOM_TEMPLATE,
  DEFAULT_PARTICLE_TEMPLATE,
  PARTICLE_TEMPLATE_IDS,
  effectiveMotion,
  nativeMotion,
  particleTemplate,
} from "./particles.js";

export const LAMP_PROJECT_SCHEMA = 4;

/* Пределы — проценты от лампы игрока. Не «от нуля»: погашенный фонарь в
   игре не отличить от поломки. */
export const LAMP_LIMITS = Object.freeze({
  intensity: Object.freeze([20, 300]),
  range: Object.freeze([40, 250]),
  softness: Object.freeze([25, 300]),
  beamDensity: Object.freeze([5, 100]),
  beamWidth: Object.freeze([40, 200]),
  glareSize: Object.freeze([20, 300]),
  glareStrength: Object.freeze([10, 200]),
  particleSize: Object.freeze([40, 300]),
  particleOpacity: Object.freeze([15, 100]),
  particleDensity: Object.freeze([20, 300]),
  particleShare: Object.freeze([10, 100]),
  particleGlow: Object.freeze([0, 400]),
  particleSpeed: Object.freeze([25, 300]),
});

const NAME_LIMIT = 60;
const ASSET_NAME_LIMIT = 80;

const clampTo = ([low, high], value, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(high, Math.max(low, number)));
};

const plain = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

export function createLampProject() {
  return {
    schema: LAMP_PROJECT_SCHEMA,
    name: "",
    light: {
      colour: null,
      groups: [...LAMP_GROUP_IDS],
      intensity: 100,
      range: 100,
      softness: 100,
      /* «Убрать свет совсем» (ТЗ 17.10.2026, вечер): свет фонарей выключен
         целиком — пятно, ореол, луч и огни вдали; остальные настройки света
         остаются в работе и вернутся, когда свет включат обратно. */
      off: false,
    },
    /* Лампы под мостами и в тоннелях (`bridges.js`): по умолчанию берут цвет
       фонарей (`follow`); свой цвет — `follow: false`; выключено — как в
       игре. */
    bridge: { on: true, follow: true, colour: null },
    beam: { on: false, density: 55, width: 100 },
    /* Свежая работа — вид игры, с бликами Rockstar (задача 5 ТЗ
       05.10.2026: «ванильный вид по умолчанию для всех»). */
    glare: { on: true, size: 100, strength: 100 },
    particles: {
      on: false,
      template: DEFAULT_PARTICLE_TEMPLATE,
      colour: null,
      size: 100,
      opacity: 100,
      density: 100,
      share: 100,
      glow: 100,
      night: true,
      motion: nativeMotion(particleTemplate(DEFAULT_PARTICLE_TEMPLATE)),
      speed: 100,
      custom: { asset: "", name: "" },
    },
    pole: createPoleSection(),
  };
}

/*
 * Движение частиц в документе. У своей картинки поле значило движение
 * всегда. У остальных шаблонов — только со схемы 3: прежние работы и коды
 * несли там «swarm» по умолчанию, и читать его буквально значило бы пустить
 * сакуру и снег кружить. Документ без номера схемы — это заготовка кода
 * (готовые виды, тесты): в ней движение, если оно есть, заказано явно.
 */
function normalizeMotion(source, particles, template) {
  const legacy = Number.isFinite(Number(source.schema)) && Number(source.schema) < 3;
  if (template === CUSTOM_TEMPLATE)
    return CUSTOM_MOTION_IDS.includes(particles.motion) ? particles.motion : nativeMotion(particleTemplate(template));
  const current = particleTemplate(template);
  if (legacy || particles.motion == null) return nativeMotion(current);
  return effectiveMotion(current, particles.motion);
}

/*
 * Лампы под мостами. До 05.10.2026 в работе было только `{ on, colour }`:
 * выключатель значил «свой цвет», а выключено — «как в игре», и так
 * открывалась любая работа — лампы под мостами оставались штатными, даже
 * когда фонари красились (владелец: «под мостами лампы тоже остаются
 * стандартными»). Работа без `follow` — прежняя: свой цвет остаётся своим,
 * всё остальное начинает брать цвет фонарей.
 */
function normalizeBridge(bridge) {
  const colour = bridge.colour == null ? null : normalizeHex(bridge.colour);
  if (!("follow" in bridge)) {
    if (bridge.on === true && colour) return { on: true, follow: false, colour };
    return { on: true, follow: true, colour };
  }
  return { on: bridge.on !== false, follow: bridge.follow !== false, colour };
}

/* Своя картинка: отпечаток SHA-256 файла в хранилище окна и имя для подписи. */
function normalizeCustom(input) {
  const source = plain(input);
  const asset = String(source.asset || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(asset)) return { asset: "", name: "" };
  return { asset, name: String(source.name || "картинка").trim().slice(0, ASSET_NAME_LIMIT) || "картинка" };
}

/**
 * Приводит документ в порядок: пределы, известные шаблоны, все группы.
 * Лишние поля отбрасываются молча — код из более новой версии Astral
 * открывается в старой тем, что она понимает, а не отказом.
 *
 * Прежний документ (схема 1) выключал частицы шаблоном «none»: он читается
 * как выключенные частицы с шаблоном по умолчанию.
 */
export function normalizeLampProject(input) {
  const base = createLampProject();
  const source = plain(input);
  const light = plain(source.light);
  const bridge = plain(source.bridge);
  const beam = plain(source.beam);
  const glare = plain(source.glare);
  const particles = plain(source.particles);
  const legacyOff = particles.template === "none";
  const template = PARTICLE_TEMPLATE_IDS.includes(particles.template)
    ? particles.template
    : base.particles.template;
  const on = particles.on === undefined ? !legacyOff && PARTICLE_TEMPLATE_IDS.includes(particles.template) : particles.on === true;
  return {
    schema: LAMP_PROJECT_SCHEMA,
    name: String(source.name ?? "").trim().slice(0, NAME_LIMIT),
    light: {
      colour: normalizeLightColour(light.colour),
      groups: [...LAMP_GROUP_IDS],
      intensity: clampTo(LAMP_LIMITS.intensity, light.intensity, 100),
      range: clampTo(LAMP_LIMITS.range, light.range, 100),
      softness: clampTo(LAMP_LIMITS.softness, light.softness, 100),
      off: light.off === true,
    },
    bridge: normalizeBridge(bridge),
    beam: {
      on: beam.on === true,
      density: clampTo(LAMP_LIMITS.beamDensity, beam.density, base.beam.density),
      width: clampTo(LAMP_LIMITS.beamWidth, beam.width, base.beam.width),
    },
    glare: {
      /* Нет поля — как у свежей работы (вид игры); есть — только «да». */
      on: glare.on === undefined ? base.glare.on : glare.on === true,
      size: clampTo(LAMP_LIMITS.glareSize, glare.size, 100),
      strength: clampTo(LAMP_LIMITS.glareStrength, glare.strength, 100),
    },
    particles: {
      on,
      template,
      colour: particles.colour == null ? null : normalizeHex(particles.colour),
      size: clampTo(LAMP_LIMITS.particleSize, particles.size, 100),
      opacity: clampTo(LAMP_LIMITS.particleOpacity, particles.opacity, 100),
      density: clampTo(LAMP_LIMITS.particleDensity, particles.density, 100),
      share: clampTo(LAMP_LIMITS.particleShare, particles.share, 100),
      glow: clampTo(LAMP_LIMITS.particleGlow, particles.glow, 100),
      night: particles.night !== false,
      motion: normalizeMotion(source, particles, template),
      speed: clampTo(LAMP_LIMITS.particleSpeed, particles.speed, 100),
      custom: normalizeCustom(particles.custom),
    },
    pole: normalizePoleSection(source.pole),
  };
}

export function serializeLampProject(project) {
  return JSON.stringify(normalizeLampProject(project));
}

export function parseLampProject(text) {
  try {
    return normalizeLampProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createLampProject();
  }
}

/** Вид самой игры: всё нейтрально, блик — как у Rockstar. */
export function vanillaLampProject() {
  const project = createLampProject();
  project.glare.on = true;
  return project;
}

/**
 * Есть ли у работы частицы, которые можно поставить: включены, и у своей
 * картинки выбран файл.
 */
export function lampParticlesActive(input) {
  const { particles } = normalizeLampProject(input);
  if (!particles.on) return false;
  return particles.template !== CUSTOM_TEMPLATE || Boolean(particles.custom.asset);
}

/*
 * Что правка делает с игрой. Работа, которая ничего не меняет (цвет «как в
 * игре», яркость 100 %, блик как у игры, без частиц), — это «как в игре»:
 * ставить её незачем, и «Применить» гаснет.
 */
export function lampProjectChanges(input) {
  const project = normalizeLampProject(input);
  const { light, beam, glare, bridge } = project;
  return {
    off: light.off,
    colour: light.colour !== null,
    /* «Как фонари» — не своя правка: лампы под мостами едут вместе с цветом
       фонарей. Своя правка — только свой цвет. */
    bridge: bridge.on && !bridge.follow && bridge.colour !== null,
    light: light.intensity !== 100 || light.range !== 100 || light.softness !== 100,
    beam: beam.on,
    glare: !glare.on || glare.size !== 100 || glare.strength !== 100,
    particles: lampParticlesActive(project),
    pole: poleChanged(project.pole),
  };
}

export function lampProjectIsVanilla(input) {
  return !Object.values(lampProjectChanges(input)).some(Boolean);
}

/** Отпечаток для очереди «Применить»: та же работа — тот же отпечаток. */
export function lampProjectSignature(input) {
  const { name: _name, ...rest } = normalizeLampProject(input);
  return JSON.stringify(rest);
}
