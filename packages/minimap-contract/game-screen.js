/*
 * Экран игры игрока — одно место для всех редакторов экрана (ТЗ H1, 14.11.2026).
 *
 * Мини-карта, значки и GPS, групповые метки, прицел, счётчик патронов и счётчик
 * урона рисуются в окне на сцене, а игра раскладывает их по экрану игрока: по
 * форме (`AspectRatio` в settings.xml), разрешению и безопасной зоне профиля.
 * Здесь лежит то, что эти редакторы берут из экрана одинаково: таблица форм и
 * их холсты, названия кодов `AspectRatio`, «растянут ли» экран и версия формулы,
 * по которой Astral считает место. Читает экран главный процесс
 * (`apps/desktop/src/game-screen.js`), окно получает его одним запросом.
 *
 * Чистый модуль без зависимостей: на нём стоят и окно, и установка, и тесты.
 */

/**
 * Версия формулы «экран игрока → место на экране». Растёт, когда меняется
 * расчёт положения (`minimapPlacementForGame`, `gameEntryRect`, масштаб сцены
 * прицела). Её пишет метка «под какой экран поставлено» и журнал сверки:
 * перестановка при запуске срабатывает и на смену формулы.
 */
export const HUD_SCREEN_FORMULA = "hud-screen-1";

/** Безопасная зона по умолчанию (настройка 212 = 3 → размер 0,97), доля экрана с каждой стороны. */
export const GAME_SAFE_INSET_DEFAULT = 0.015;

/**
 * Формы экрана, которые знает таблица `AspectRatio` игры, и холст окна для
 * каждой. Холст — только размер картинки предпросмотра: места на экране
 * считаются в долях, и разрешение на них не влияет. Первые шесть формам
 * достались от прежних редакторов, остальные — от меню игры.
 */
export const GAME_SCREEN_FORMS = Object.freeze([
  Object.freeze({ name: "16:9", ratio: 16 / 9, width: 1920, height: 1080 }),
  Object.freeze({ name: "21:9", ratio: 21 / 9, width: 2560, height: 1080 }),
  Object.freeze({ name: "16:10", ratio: 16 / 10, width: 1920, height: 1200 }),
  Object.freeze({ name: "4:3", ratio: 4 / 3, width: 1440, height: 1080 }),
  Object.freeze({ name: "5:4", ratio: 5 / 4, width: 1350, height: 1080 }),
  Object.freeze({ name: "32:9", ratio: 32 / 9, width: 3840, height: 1080 }),
  Object.freeze({ name: "3:2", ratio: 3 / 2, width: 1620, height: 1080 }),
  Object.freeze({ name: "5:3", ratio: 5 / 3, width: 1800, height: 1080 }),
  Object.freeze({ name: "17:9", ratio: 17 / 9, width: 2040, height: 1080 }),
]);

/** Формы по возрастанию соотношения сторон — так их показывает список выбора. */
export const GAME_SCREEN_FORMS_BY_RATIO = Object.freeze(
  [...GAME_SCREEN_FORMS].sort((a, b) => a.ratio - b.ratio),
);

/**
 * Что значит число `AspectRatio` в settings.xml (порядок пунктов меню игры).
 * 0 — «Авто»: форма самого экрана. `verified` — сверено с живой игрой (`GET_ASPECT_RATIO`): 0, 2 (4:3 = 1,3333) и 5 (16:9 = 1,7778) —
 * замер H2 14.11.2026; остальные — по порядку меню и ждут замера.
 */
export const GAME_ASPECT_CODES = Object.freeze({
  0: Object.freeze({ form: null, verified: true }),
  1: Object.freeze({ form: "3:2", verified: false }),
  2: Object.freeze({ form: "4:3", verified: true }),
  3: Object.freeze({ form: "5:3", verified: false }),
  4: Object.freeze({ form: "5:4", verified: false }),
  5: Object.freeze({ form: "16:9", verified: true }),
  6: Object.freeze({ form: "16:10", verified: false }),
  7: Object.freeze({ form: "17:9", verified: false }),
  8: Object.freeze({ form: "21:9", verified: false }),
});

/**
 * Пределы разрешения, которое человек вводит сам («Разрешение игры» в «Положении карты», 22.11.2026): от 640×480 до 7680×4320.
 * Разрешение — только размер монитора для предпросмотра (растяжение и зум «в размер игры»): места на экране считаются в долях
 * формы, и на них оно не влияет, поэтому в фильм мини-карты оно не попадает.
 */
export const SCREEN_RESOLUTION_LIMITS = Object.freeze({
  width: Object.freeze([640, 7680]),
  height: Object.freeze([480, 4320]),
});

/**
 * Разрешение монитора из проекта (`targetViewport.monitor`): `{ width, height }` целыми — или `null`, если поля нет или оно
 * вне пределов (проект без него открывается как раньше: экран берётся из игры).
 */
export function normalizeScreenResolution(value) {
  const width = Math.round(Number(value?.width));
  const height = Math.round(Number(value?.height));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const [minW, maxW] = SCREEN_RESOLUTION_LIMITS.width;
  const [minH, maxH] = SCREEN_RESOLUTION_LIMITS.height;
  if (width < minW || width > maxW || height < minH || height > maxH)
    return null;
  return { width, height };
}

/** Форма по имени («4:3») — или `null`. */
export function screenFormByName(name) {
  return GAME_SCREEN_FORMS.find((form) => form.name === name) || null;
}

/**
 * Ближайшая форма таблицы к числу: `{ form, exact, gap }`; `exact` — разница меньше сотой.
 * Не число или не положительное — `null`.
 */
export function nearestScreenForm(aspect) {
  const value = Number(aspect);
  if (!(value > 0)) return null;
  let best = null;
  let gap = Infinity;
  for (const form of GAME_SCREEN_FORMS) {
    const distance = Math.abs(form.ratio - value);
    if (distance < gap) {
      best = form;
      gap = distance;
    }
  }
  return { form: best, exact: gap < 0.01, gap };
}

/**
 * Холст предпросмотра для любой формы: `{ width, height, name }`. Известная форма
 * берёт холст из таблицы, чужая — высоту 1080 и ширину по числу. Падать на 16:9
 * нельзя: 5:4 и 32:9 рисуются своим холстом.
 */
export function canvasForAspect(aspect, { height = 1080 } = {}) {
  const near = nearestScreenForm(aspect);
  if (near?.exact)
    return {
      width: near.form.width,
      height: near.form.height,
      name: near.form.name,
    };
  const ratio = Number(aspect) > 0 ? Number(aspect) : 16 / 9;
  return { width: Math.round(height * ratio), height, name: null };
}

/** Название формы словами игры: «4:3», у чужой — число с запятой («2,37»). */
export function aspectLabel(aspect) {
  const near = nearestScreenForm(aspect);
  if (near?.exact) return near.form.name;
  const value = Number(aspect);
  return value > 0 ? value.toFixed(2).replace(".", ",") : "";
}

/** Допуск «растянут ли»: 21:9 игры на мониторе 2560×1080 (разница 1,6 %) растяжением не считается. */
const STRETCH_TOLERANCE = 0.03;

/**
 * Растянут ли экран: игра раскладывает HUD под форму `aspect`, а монитор другой формы
 * (4:3 на 1920×1080). Допуск — три процента: разрешение 2560×1080 и «21:9» — не растяжение.
 *
 * `{ stretched, monitorAspect, scaleX }` — `scaleX` во сколько раз картинка игры
 * растягивается по ширине, чтобы заполнить монитор (1 — не растянута).
 */
export function screenStretch({ aspect, width, height } = {}) {
  const game = Number(aspect);
  const monitor =
    Number(width) > 0 && Number(height) > 0
      ? Number(width) / Number(height)
      : null;
  if (!(game > 0) || !monitor)
    return { stretched: false, monitorAspect: monitor, scaleX: 1 };
  const scaleX = monitor / game;
  return {
    stretched: Math.abs(scaleX - 1) > STRETCH_TOLERANCE,
    monitorAspect: monitor,
    scaleX,
  };
}

/**
 * Что именно растягивается на растянутом экране — ОДНО переключаемое место, два поля: по ПОВЕРХНОСТИ.
 *
 * Режимы:
 *  • `"stretch-all"` — игра растягивает весь кадр по ширине на монитор вместе с содержимым: кадр монитора 16:9 с холстом 4:3 внутри,
 *    `scaleX(4/3)`, круглое — овальное;
 *  • `"layout-only"` — места считаются по форме игры (доли экрана, `k` у frontend.xml), а круглое остаётся круглым: окно показывает
 *    кадр формы игры без растяжения.
 *
 * Поля:
 *  • `frontend` — то, что игра ставит рамкой frontend.xml: мини-карта, развёрнутый радар и всё внутри их фильма minimap.gfx
 *    (полосы HP и брони, цифры, значок). «stretch-all»: ИЗМЕРЕНО по кадрам 10.11 (работа «676» на растянутом 4:3 владельца) —
 *    рамка 0,2 ширины монитора при высоте 0,189 (на 1920×1080 это 384×204 px, а не 288×204), полосы HP и брони легли на расчёт
 *    «сцена 191×136 в рамку» в пределах 2 px (HP x 1882…1900 против 1883,6…1901,4) — 2,01 px/пт по X против 1,5 px/пт по Y;
 *  • `mode` — фильмы HUD (hud.gfx: счётчик патронов; hud_reticle.gfx: прицел; счётчик урона). Его читает стенд H2 (`promise.mjs`).
 *    «layout-only»: ИЗМЕРЕНО в игре (замер H2, 14.11.2026, растянутый 4:3 владельца, `AspectRatio = 2`, 1920×1080, и 16:9):
 *    квадрат прицела 16 пт = 24×24 px, кольцо 53 пт = 80×80 px, линии ±70 пт = 210 px по X и по Y, центр (960, 540), 1,503 px/пт
 *    по обеим осям; значок пуль 1,505 по X и 1,5 по Y; левый край счётчика патронов 482 px при обещанных 480 (x = 0,25) —
 *    круглое круглым, содержимое не растянуто (кадр стенда 11.11 дал то же: шаг пуль 6,0 px при 6,2 без растяжения и 8,3 с ним).
 *    Таблицы и кадры: .local/hud-1to1-1411/measure-1411/run2-16x9 и run3-owner-4x3 (docs/HUD-ONE-TO-ONE.md § 5).
 *
 * Каждое поле переключается одной правкой здесь; всё остальное (кадр окна, зум «в размер игры», обещание стенда) читает их отсюда.
 */
export const GAME_STRETCH_BEHAVIOUR = Object.freeze({
  mode: "layout-only",
  frontend: "stretch-all",
});

/** Поверхности, у которых свой режим растяжения: `"hud"` — фильмы HUD (поле `mode`), `"frontend"` — рамка frontend.xml (поле `frontend`). */
export const GAME_STRETCH_SURFACES = Object.freeze(["hud", "frontend"]);

/**
 * Масштаб по ширине для картинки игры внутри кадра монитора: 1, если растяжения нет или режим этой поверхности не растягивает
 * содержимое (`layout-only`). `surface` — `"hud"` (по умолчанию: фильмы HUD, поле `mode`) или `"frontend"` (мини-карта и радар,
 * поле `frontend`); поле, которого нет в `behaviour`, берётся из `GAME_STRETCH_BEHAVIOUR`.
 */
export function stretchContentScale(
  screen,
  behaviour = GAME_STRETCH_BEHAVIOUR,
  surface = "hud",
) {
  const { stretched, scaleX } = screenStretch(screen);
  const field = surface === "frontend" ? "frontend" : "mode";
  const mode = behaviour?.[field] ?? GAME_STRETCH_BEHAVIOUR[field];
  return stretched && mode === "stretch-all" ? scaleX : 1;
}

/** Источники, по которым экран собран. Ключи — для строки окна и журнала. */
export const GAME_SCREEN_SOURCES = Object.freeze({
  aspect: Object.freeze({
    settings: "AspectRatio из settings.xml",
    "auto-resolution": "Авто: по разрешению",
    default: "нет файла — по умолчанию",
    unknown: "не узнать",
  }),
  inset: Object.freeze({
    profile: "настройка 212 профиля",
    default: "профиля нет — по умолчанию",
    unknown: "не узнать",
  }),
});

/**
 * Экран игры, приведённый к одному виду. `raw` — ответ главного процесса
 * (`readGameScreen`) или `null`. Неизвестный экран — `known: false` и причина.
 *
 * @returns {{
 *   known: boolean, reason: string|null,
 *   aspect: number|null, inset: number, form: string|null, formExact: boolean,
 *   width: number|null, height: number|null, resolution: string|null,
 *   stretched: boolean, scaleX: number, safeZoneStep: number|null, safeZone: number|null,
 *   sources: { aspect: string, inset: string },
 * }}
 */
export function describeGameScreen(raw) {
  const screen = raw && typeof raw === "object" ? raw : null;
  const aspect = Number(screen?.aspect) > 0 ? Number(screen.aspect) : null;
  const known = screen?.known !== false && aspect !== null;
  const width = Number(screen?.width) > 0 ? Number(screen.width) : null;
  const height = Number(screen?.height) > 0 ? Number(screen.height) : null;
  const inset =
    Number.isFinite(Number(screen?.inset)) && Number(screen?.inset) >= 0
      ? Number(screen.inset)
      : GAME_SAFE_INSET_DEFAULT;
  const near = known ? nearestScreenForm(aspect) : null;
  const stretch = known
    ? screenStretch({ aspect, width, height })
    : { stretched: false, scaleX: 1 };
  const step = screen?.raw?.safeZoneStep ?? screen?.safeZoneStep ?? null;
  return {
    known,
    reason: known
      ? null
      : screen?.reason || (screen ? "unreadable" : "no-file"),
    aspect: known ? aspect : null,
    inset,
    form: known ? aspectLabel(aspect) : null,
    formExact: Boolean(near?.exact),
    width,
    height,
    resolution: width && height ? `${width}×${height}` : null,
    stretched: stretch.stretched,
    scaleX: stretch.scaleX,
    safeZoneStep: Number.isInteger(step) ? step : null,
    safeZone: Number(screen?.safeZone) > 0 ? Number(screen.safeZone) : null,
    sources: {
      aspect: known
        ? screen?.sources?.aspect || "settings"
        : screen?.reason === "enhanced" || screen?.reason === "unreadable"
          ? "unknown"
          : "default",
      inset:
        screen?.sources?.inset ||
        (Number.isInteger(step) ? "profile" : known ? "default" : "unknown"),
    },
  };
}

/** Прямоугольник в долях экрана → в пикселях экрана `{ width, height }` (округление до пикселя). */
export function rectInPixels(rect, { width, height }) {
  const w = Number(width);
  const h = Number(height);
  return {
    left: Math.round(rect.left * w),
    top: Math.round(rect.top * h),
    width: Math.round(rect.width * w),
    height: Math.round(rect.height * h),
    of: `${w}×${h}`,
  };
}

/* Безопасная зона игры и коды AspectRatio — здесь, а не в `index.js`: главный процесс читает экран при старте (`game-screen.js` в `apps/desktop`) и не должен тянуть весь контракт мини-карты (21.11.2026). */
export const MINIMAP_GAME_SAFE_INSET = 0.015;

/**
 * Значения AspectRatio в settings.xml GTA V: порядок пунктов меню игры.
 * 2 = 4:3 сверено с игрой (GET_ASPECT_RATIO 1,3333); 0 — «Авто», форма
 * самого экрана.
 */
export const GTA_ASPECT_RATIO_SETTING = Object.freeze({
  1: 3 / 2,
  2: 4 / 3,
  3: 5 / 3,
  4: 5 / 4,
  5: 16 / 9,
  6: 16 / 10,
  7: 17 / 9,
  8: 21 / 9,
});

/**
 * Форма экрана, под которую игра раскладывает HUD, по settings.xml:
 * `AspectRatio` (0 — «Авто») и разрешение. `null` — не узнать.
 */
export function gameScreenAspect({ aspectRatio, width, height } = {}) {
  const fixed = GTA_ASPECT_RATIO_SETTING[Number(aspectRatio)];
  if (fixed) return fixed;
  const w = Number(width);
  const h = Number(height);
  return w > 0 && h > 0 ? w / h : null;
}
