/*
 * Счётчик патронов (задача 12 ТЗ 10.10.2026): одно описание на редактор,
 * кадр и компилятор `hud.gfx`.
 *
 * ОТКУДА ЦИФРЫ. В `hud_reticle.gfx` патронов нет: класс прицела получает
 * тип, разброс, зум и попадание. Число патронов игра шлёт только блоку
 * оружия `HUD_WEAPON_ICON` в `hud.gfx` (scaleform_generic.rpf) —
 * `SET_AMMO_COUNT([запас, в обойме, размер обоймы, тип])`, на каждый выстрел,
 * перезарядку и смену ствола. Счётчик Astral — это этот блок, собранный
 * заново: своё положение, шрифт игры, цвета, размер и порядок цифр, а
 * числа по-прежнему считает игра — для любого ствола, со всеми дополнениями.
 *
 * ЧТО ЗА ЧИСЛА (разбор штатного `hud.gfx`, 10.11.2026). Игра кладёт `params[0]`
 * в поле `ammoText` и `params[1]` в `clipCountText` (`setTextFields(ammoCount,
 * clipCount, clipSize)`; обойма показывается только при `clipSize > 1`). Запас
 * `params[0]` — патроны ВНЕ обоймы: у серверов (GTA 5 RP, Majestic) вторая цифра
 * — «всего», то есть обойма плюс запас (`30 / 774` против нашего `30 / 744`).
 * Поэтому порядок «обойма / ...» теперь ставит через черту всего патронов
 * (`clip-total`), а «как в игре» остаётся штатным: запас, затем обойма.
 * Саму цифру обоймы игра берёт у оружия; если сервер держит свой счёт обоймы,
 * отличный от оружия игры, скрипт блока увидеть его не может.
 *
 * ГДЕ. Точка счётчика — доля экрана (`x`, `y` от 0 до 1, от левого верхнего
 * угла), без поля безопасной зоны: где поставил, там и стоит при любом
 * соотношении сторон. `align` — куда растёт строка от точки; по высоте
 * точка — середина строки. Блок выходит из списка правого верхнего угла
 * (деньги, розыск), иначе игра сдвигала бы его под деньги.
 *
 * РАЗМЕР. 100 % — штатный: поле игры 22 точки сцены HUD 1280×720 (33 px на
 * 1080p) шрифтом Pricedown. Размер — масштаб всего блока: цифры, обводка и
 * значок растут вместе.
 *
 * ПОДЛОЖКА (задача 7 ТЗ 17.10.2026, вечер): прямоугольник со скруглением под
 * цифрами и значком. У игры её нет («как в игре — без подложки»). Высота —
 * высота заглавных шрифта плюс два вертикальных отступа, середина — на точке
 * счётчика; ширина — строка вместе со значком плюс два горизонтальных отступа,
 * поэтому растёт и сжимается вместе с числом цифр. Цвет и непрозрачность — у
 * заливки; скругление не больше половины высоты и не больше, чем помещается в
 * самую короткую строку (`ammoPlateGeometry`).
 */

/** Сцена HUD (`hud.gfx`): по ней игра ставит блоки при 16:9. */
export const AMMO_HUD_STAGE = Object.freeze({ width: 1280, height: 720 });

/** Кегль штатных полей патронов в точках сцены HUD. */
export const AMMO_TEXT_SIZE = 22;

/** Промежуток между значком и цифрами (у игры — `setAmmoIcon`: `- 6`). */
export const AMMO_ICON_GAP = 6;

/*
 * Значок патронов — три пули, как на снимке владельца. Свой: у игры значок
 * типа патронов (`ammoIcon`, кадры AMMO1…6) в нынешнем hud.gfx пустой —
 * блок игры давно показывает одни цифры. Размеры — в точках сцены HUD при
 * 100 %: высота — заглавные Pricedown 22-го кегля. Обводка — те же пули,
 * шире на `outline` точки: шире промежутка нельзя, перекрытие одной
 * заливки Scaleform вырезал бы дырой.
 */
export const AMMO_ICON = Object.freeze({ count: 3, width: 4.4, gap: 1.8, height: 16, tip: 5.6, outline: 0.8 });
export const AMMO_ICON_WIDTH = AMMO_ICON.count * AMMO_ICON.width + (AMMO_ICON.count - 1) * AMMO_ICON.gap;

/**
 * Контуры пуль значка: `[[x, y]…]` по пуле, в точках сцены HUD, начало — у
 * левого края по середине высоты. `grow` — на сколько шире (обводка).
 */
export function ammoIconPolygons(grow = 0) {
  const { count, width, gap, height, tip } = AMMO_ICON;
  const top = -height / 2;
  const bottom = height / 2;
  const shoulder = top + tip;
  const polygons = [];
  for (let index = 0; index < count; index += 1) {
    const left = index * (width + gap) - grow;
    const right = index * (width + gap) + width + grow;
    const centre = (left + right) / 2;
    const half = (right - left) / 2;
    /* Носик пули — дугой: ширина как корень от доли пути до вершины. */
    const arc = [0.25, 0.55, 0.8, 0.95].map((share) => ({
      y: shoulder - share * (tip + grow),
      dx: half * Math.sqrt(1 - share),
    }));
    polygons.push([
      [left, bottom + grow],
      [right, bottom + grow],
      [right, shoulder],
      ...arc.map((point) => [centre + point.dx, point.y]),
      [centre, top - grow],
      ...[...arc].reverse().map((point) => [centre - point.dx, point.y]),
      [left, shoulder],
    ]);
  }
  return polygons;
}

/** Разделитель «в обойме / в запасе» и промежуток вида «как в игре». */
export const AMMO_SEPARATOR = " / ";
export const AMMO_GAME_GAP = "  ";

/*
 * Шрифты — шрифты игры по их именам в `fontmap.xml`: поле HUD берёт их
 * разметкой `<FONT FACE='…'>`, как это делает сама игра. Свой шрифт —
 * разделом «Шрифты»: он встаёт на место шрифтов игры, и счётчик возьмёт его.
 */
/*
 * Мерки — шрифтов игры при кегле 256 (`font_lib_efigs_pc.gfx`, те же, что у
 * раздела «Шрифты»): по ним строка ставится серединой цифр в точку, а
 * значок — на ту же середину.
 */
export const AMMO_FONTS = Object.freeze([
  Object.freeze({ id: "cash", face: "$gtaCash", label: "Pricedown", note: "как у счётчика игры и денег", metrics: Object.freeze({ cap: 202, ascent: 202, descent: 61, nominal: 256 }) }),
  Object.freeze({ id: "main", face: "$Font2", label: "Chalet London", note: "основной шрифт игры", metrics: Object.freeze({ cap: 179, ascent: 245, descent: 64, nominal: 256 }) }),
  Object.freeze({ id: "condensed", face: "$Font2_cond", label: "Chalet Comprime", note: "узкий шрифт игры", metrics: Object.freeze({ cap: 166, ascent: 223, descent: 50, nominal: 256 }) }),
  Object.freeze({ id: "script", face: "$Font5", label: "SignPainter", note: "рукописный шрифт игры", metrics: Object.freeze({ cap: 160, ascent: 195, descent: 100, nominal: 256 }) }),
]);

/** Поле Flash: по 2 точки полей с каждой стороны текста. */
export const AMMO_FIELD_GUTTER = 2;

/**
 * Верх поля строки относительно точки (до масштаба), чтобы середина цифр
 * (заглавных) пришлась на точку: поле 2 + подъём шрифта до линии, цифры —
 * высотой заглавных над ней.
 */
export function ammoFieldTop(fontId) {
  const { metrics } = ammoFont(fontId);
  const scale = AMMO_TEXT_SIZE / metrics.nominal;
  return -(AMMO_FIELD_GUTTER + metrics.ascent * scale - (metrics.cap * scale) / 2);
}

export const AMMO_ALIGNS = Object.freeze([
  Object.freeze({ id: "left", label: "Вправо", note: "строка растёт вправо от точки" }),
  Object.freeze({ id: "center", label: "По центру", note: "точка — середина строки" }),
  Object.freeze({ id: "right", label: "Влево", note: "строка растёт влево от точки" }),
]);

export const AMMO_FORMATS = Object.freeze([
  Object.freeze({ id: "clip-total", label: "25 / 696", note: "сначала обойма, через черту всего патронов, как показывают серверы" }),
  Object.freeze({ id: "game", label: "671  25", note: "как в игре: запас, затем обойма" }),
]);

export const AMMO_ICONS = Object.freeze([
  Object.freeze({ id: "after", label: "После", note: "три пули после цифр" }),
  Object.freeze({ id: "before", label: "Перед", note: "три пули перед цифрами" }),
  Object.freeze({ id: "none", label: "Нет", note: "без значка — одни цифры" }),
]);

export const AMMO_VISIBILITY = Object.freeze([
  Object.freeze({ id: "armed", label: "Пока в руках ствол", note: "не гаснет, пока ствол в руках" }),
  Object.freeze({ id: "game", label: "Как в игре", note: "при стрельбе и прицеливании, гаснет через 5 с" }),
]);

/**
 * Пределы ползунков: у каждого — поле числом с теми же пределами.
 * Размер — от 10 % (владелец, 16.11.2026: «уменьшать вообще маленьким, а не просто 50 %»): в игре зажима нет (`xscale/yscale = size`), нижний предел стоял только в договоре.
 * Шаг 1: прежние значения (кратные 5) остаются как были.
 */
export const AMMO_LIMITS = Object.freeze({
  x: Object.freeze({ min: 0, max: 100, step: 0.1, unit: "%", label: "По горизонтали" }),
  y: Object.freeze({ min: 0, max: 100, step: 0.1, unit: "%", label: "По вертикали" }),
  size: Object.freeze({ min: 10, max: 300, step: 1, unit: "%", label: "Размер" }),
});

/** Пределы подложки: у каждого ползунка — поле числом с теми же пределами. */
export const AMMO_PLATE_LIMITS = Object.freeze({
  opacity: Object.freeze({ min: 0, max: 100, step: 5, unit: "%", label: "Непрозрачность" }),
  padX: Object.freeze({ min: 0, max: 24, step: 1, unit: " пт", label: "Отступ по горизонтали" }),
  padY: Object.freeze({ min: 0, max: 12, step: 1, unit: " пт", label: "Отступ по вертикали" }),
  radius: Object.freeze({ min: 0, max: 16, step: 1, unit: " пт", label: "Скругление" }),
});

/** Самая короткая строка счётчика — одна цифра (точки блока): по ней скругление не заходит за середину. */
export const AMMO_PLATE_MIN_TEXT = 6;

/*
 * Новый счётчик — как на снимке владельца: справа под прицелом, белая
 * обойма и серый запас, значок патронов после цифр.
 */
export const AMMO_COUNTER_DEFAULTS = Object.freeze({
  enabled: false,
  visibility: "armed",
  showOverHide: true,
  x: 0.515,
  y: 0.53,
  align: "left",
  font: "cash",
  size: 100,
  format: "clip-total",
  clipColor: "#ffffff",
  reserveColor: "#9a9a9a",
  outline: true,
  icon: "after",
  plate: false,
  plateColor: "#000000",
  plateOpacity: 55,
  platePadX: 6,
  platePadY: 3,
  plateRadius: 4,
});

/*
 * «Стандарт» — вид блока игры: Pricedown, запас белым и обойма серым
 * (цвета полей `ammo` и `clipCounter` штатного файла), значок перед
 * цифрами, правый верхний угол, гаснет как в игре.
 */
export const AMMO_COUNTER_STOCK = Object.freeze({
  visibility: "game",
  x: 0.962,
  y: 0.082,
  align: "right",
  font: "cash",
  size: 100,
  format: "game",
  clipColor: "#999999",
  reserveColor: "#ffffff",
  outline: true,
  icon: "before",
  plate: false,
});

const ids = (list) => new Set(list.map((item) => item.id));
const FONT_IDS = ids(AMMO_FONTS);
const ALIGN_IDS = ids(AMMO_ALIGNS);
const FORMAT_IDS = ids(AMMO_FORMATS);
const ICON_IDS = ids(AMMO_ICONS);
const VISIBILITY_IDS = ids(AMMO_VISIBILITY);
const HEX = /^#[0-9a-f]{6}$/i;

const pick = (value, allowed, fallback) => (allowed.has(value) ? value : fallback);
const fraction = (value, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(1, Math.max(0, number)) * 10000) / 10000;
};
const bounded = (value, { min, max, step }, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const stepped = Math.round(number / step) * step;
  return Math.min(max, Math.max(min, Math.round(stepped * 100) / 100));
};
const colour = (value, fallback) =>
  HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback;

/** Счётчик в границах договора; чужие поля отбрасываются. */
export function normalizeAmmoCounter(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const base = AMMO_COUNTER_DEFAULTS;
  return {
    enabled: source.enabled === true,
    visibility: pick(source.visibility, VISIBILITY_IDS, base.visibility),
    showOverHide: source.showOverHide !== false,
    x: fraction(source.x, base.x),
    y: fraction(source.y, base.y),
    align: pick(source.align, ALIGN_IDS, base.align),
    font: pick(source.font, FONT_IDS, base.font),
    size: bounded(source.size, AMMO_LIMITS.size, base.size),
    /* Прежний «обойма / запас» (`clip-reserve`, до 10.11.2026) — теперь «обойма / всего»: сервер показывает так, и у владельца числа расходились. */
    format: pick(source.format === "clip-reserve" ? "clip-total" : source.format, FORMAT_IDS, base.format),
    clipColor: colour(source.clipColor, base.clipColor),
    reserveColor: colour(source.reserveColor, base.reserveColor),
    outline: source.outline !== false,
    icon: pick(source.icon, ICON_IDS, base.icon),
    plate: source.plate === true,
    plateColor: colour(source.plateColor, base.plateColor),
    plateOpacity: bounded(source.plateOpacity, AMMO_PLATE_LIMITS.opacity, base.plateOpacity),
    platePadX: bounded(source.platePadX, AMMO_PLATE_LIMITS.padX, base.platePadX),
    platePadY: bounded(source.platePadY, AMMO_PLATE_LIMITS.padY, base.platePadY),
    plateRadius: bounded(source.plateRadius, AMMO_PLATE_LIMITS.radius, base.plateRadius),
  };
}

/**
 * Правка счётчика из редактора: любая его настройка включает его, выключает
 * только сам выключатель (`change.enabled`).
 *
 * 11.10.2026 владелец настроил счётчик (место, цвета, значок, «как в
 * игре»), но выключатель «Счётчик в игре» остался выключенным — три
 * «Применить» подряд ушли без hud.gfx, и в игре счётчика не было. Кадр при
 * этом рисовал его (бледно), а настройки правились как ни в чём не бывало.
 * Настроил — значит, хочешь видеть в игре.
 */
export function editAmmoCounter(current, change = {}) {
  const next = { ...normalizeAmmoCounter(current), ...change };
  next.enabled = typeof change.enabled === "boolean" ? change.enabled : true;
  return normalizeAmmoCounter(next);
}

/** Настроен ли счётчик (хоть одна настройка не как у нового). */
export function ammoCounterConfigured(input) {
  const counter = normalizeAmmoCounter(input);
  return Object.entries(AMMO_COUNTER_DEFAULTS).some(
    ([key, value]) => key !== "enabled" && counter[key] !== value,
  );
}

/** Высота заглавных шрифта счётчика в точках блока (цифры стоят серединой на точке). */
export function ammoCapHeight(fontId) {
  const { metrics } = ammoFont(fontId);
  return (metrics.cap * AMMO_TEXT_SIZE) / metrics.nominal;
}

/**
 * Подложка по настройкам: `{ top, height, radius, padX }` в точках блока (до
 * масштаба), середина — на точке. Скругление — меньше половины высоты (иначе у
 * сетки масштабирования нет середины по вертикали) и не больше, чем
 * помещается в самую короткую строку (одна цифра): иначе середина
 * растянулась бы «в минус», а кадр и игра разошлись бы.
 */
export function ammoPlateGeometry(input) {
  const counter = normalizeAmmoCounter(input);
  const height = ammoCapHeight(counter.font) + 2 * counter.platePadY;
  const radius = Math.max(0, Math.min(counter.plateRadius, height / 2 - 0.5, (AMMO_PLATE_MIN_TEXT + 2 * counter.platePadX) / 2));
  return { top: -height / 2, height, radius: Math.round(radius * 100) / 100, padX: counter.platePadX };
}

/** Шрифт счётчика: запись из `AMMO_FONTS`. */
export const ammoFont = (id) => AMMO_FONTS.find((item) => item.id === id) || AMMO_FONTS[0];

/** Совпадает ли вид счётчика со «Стандартом» (кнопка тогда неактивна). */
export function ammoCounterIsStock(input) {
  const counter = normalizeAmmoCounter(input);
  return Object.entries(AMMO_COUNTER_STOCK).every(([key, value]) => counter[key] === value);
}

/**
 * Всего патронов у оружия: обойма плюс запас. Нет обоймы (РПГ, гранаты, миниган) —
 * запас и есть всё; не числа — запас как есть. Та же арифметика, что у кода в `hud.gfx`.
 */
export function ammoTotalText(clip, reserve) {
  const clipText = String(clip ?? "");
  const reserveText = String(reserve ?? "");
  if (clipText === "" || reserveText === "") return reserveText;
  const total = Number(clipText) + Number(reserveText);
  return Number.isFinite(total) ? String(total) : reserveText;
}

/**
 * Куски строки счётчика по порядку: `[{ text, role }]`, `role` — `clip`,
 * `reserve` или `separator` (красится цветом запаса). Пустое число игра
 * не показывает — у ствола без обоймы (РПГ, гранаты, миниган) остаётся
 * один запас, у безлимитного — ничего. Вторая цифра «обойма / всего» — всего
 * патронов (`ammoTotalText`), «как в игре» — штатный запас.
 */
export function ammoCounterParts(input, { clip = "", reserve = "" } = {}) {
  const counter = normalizeAmmoCounter(input);
  const clipText = String(clip ?? "");
  const reserveText = String(reserve ?? "");
  const first = counter.format === "game"
    ? { text: reserveText, role: "reserve" }
    : { text: clipText, role: "clip" };
  const second = counter.format === "game"
    ? { text: clipText, role: "clip" }
    : { text: ammoTotalText(clipText, reserveText), role: "reserve" };
  const parts = [];
  if (first.text) parts.push(first);
  if (first.text && second.text)
    parts.push({ text: counter.format === "game" ? AMMO_GAME_GAP : AMMO_SEPARATOR, role: "separator" });
  if (second.text) parts.push(second);
  return parts;
}

/** Доля ширины строки, на которую она сдвинута влево от точки. */
export const ammoAlignShift = (align) => (align === "right" ? 1 : align === "center" ? 0.5 : 0);

/**
 * Где лежит строка счётчика в точках сцены HUD (1280×720 при 16:9):
 * `{ x, y, scale, textX, iconX, fieldTop, width, icon }` — точка, масштаб,
 * начало цифр и значка относительно точки (в точках блока, до масштаба),
 * верх поля строки при ширине цифр `textWidth`. Значок — только когда есть
 * цифры. Та же арифметика, что у кода в `hud.gfx`.
 */
export function ammoCounterLayout(input, { textWidth = 0, stage = AMMO_HUD_STAGE } = {}) {
  const counter = normalizeAmmoCounter(input);
  const icon = counter.icon !== "none" && textWidth > 0 ? AMMO_ICON_WIDTH + AMMO_ICON_GAP : 0;
  const width = textWidth + icon;
  const start = -width * ammoAlignShift(counter.align);
  const textX = counter.icon === "before" ? start + icon : start;
  const iconX = counter.icon === "before" ? start : start + textWidth + AMMO_ICON_GAP;
  const plate = counter.plate && textWidth > 0 ? { ...ammoPlateGeometry(counter), x: start - counter.platePadX, width: width + 2 * counter.platePadX } : null;
  return {
    plate,
    x: counter.x * stage.width,
    y: counter.y * stage.height,
    scale: counter.size / 100,
    textX,
    iconX,
    fieldTop: ammoFieldTop(counter.font),
    width,
    icon: icon > 0,
  };
}
