/*
 * Контракт системного Astral PTFX Core.
 *
 * Здесь описано ровно то, что ядро обязано содержать: сколько слотов
 * зарезервировано под трассеры и эффекты попадания, как называется правило и
 * текстура каждого слота и какой у текстуры layout. Один список на всех —
 * авторинг ядра, публикация, установщик и мастерская сверяются с ним, а не
 * договариваются в комментариях.
 */
export const ASTRAL_TRACER_SCHEMA = 1;
export const ASTRAL_PTFX_CORE_CHANNEL = "astral-ptfx-legacy";
export const ASTRAL_PTFX_CORE_VERSION = "1.1.0";
export const MAX_TRACER_DDS_BYTES = 8 * 1024 * 1024;
export const MAX_TRACER_COVER_BYTES = 8 * 1024 * 1024;
/*
 * Шесть mip, как у штатного ptfx_bullet_tracer (128×256 DXT5, 6 уровней).
 *
 * Седьмой уровень был бы 2×4 точки — меньше блока DXT по ширине. Помощник RPF
 * читает ядро CodeWalker'ом, а тот считает размер каждого уровня делением
 * предыдущего на четыре: у уровня 2×4 выходит 8 байт вместо 16. Ядро с такой
 * текстурой перечитывается на 8 байт короче записанного, и любой патч или
 * сверка после записи отказывает («YPT structure changed»). Шесть уровней —
 * последний 4×8, целый блок, — читаются ровно.
 */
export const ASTRAL_TRACER_TEXTURE_LAYOUT = Object.freeze({
  width: 128,
  height: 256,
  mipLevels: 6,
  format: "DXT5",
});

/*
 * Текстуры ядра, чей layout не совпадает с ванильным.
 *
 * Ядро Astral собирается из ядра игры, но `ptfx_blood_spray` в нём расширен
 * до 1024×1024 — под листы попаданий. Слой текстуры обязан совпасть с layout
 * ядра до байта, иначе патч откажет уже у игрока, поэтому сборщик слоя берёт
 * layout отсюда, а для остальных текстур — из ядра игры.
 */
export const ASTRAL_CORE_TEXTURE_LAYOUTS = Object.freeze({
  ptfx_blood_spray: Object.freeze({
    width: 1024,
    height: 1024,
    mipLevels: 9,
    format: "DXT5",
  }),
});

/*
 * Размер следа в игре.
 *
 * Правило слота клонировано с ванильного трассера, а у того размер спрайта
 * задают масштабы краёв `ptxu_Size:m_tblrScalarKFP`: верх и низ — вдоль
 * полёта, лево и право — поперёк. Ползунки «толщина» и «длина» переводятся
 * здесь в метры, и патч ядра выставляет масштабы так, чтобы спрайт получил
 * ровно эти размеры. Пока ползунки красили только текстуру, они были числом
 * без последствий: след летел той же длины, что у донора.
 *
 * Шкала показательная, а не линейная: у следа важнее разница между «нитью» и
 * «полосой», чем между тремя и четырьмя дециметрами. Ванильные 5 см × 0,7 м
 * лежат в первой трети обоих ползунков.
 */
export const ASTRAL_TRACER_SHAPE = Object.freeze({
  width: Object.freeze({ min: 0.015, max: 0.3 }),
  length: Object.freeze({ min: 0.3, max: 6 }),
});

/*
 * Единицы размера: установка и игра.
 *
 * Помощник RPF считает размер спрайта по `whd · (край₁ + край₂)` (`ReadTracerShape`), а игра ставит края от половины размера: сумма краёв в её единицах
 * даёт спрайт вдвое короче и уже, чем у помощника (`draw.js` рисует так же: вспышки и попадания на кадре игры сошлись с игрой с запасом на свечение, а штатный след на
 * прицельной камере вышел уже, чем дал бы полный размер — проба 25.10.2026, `docs/PTFX-TRACERS-EFFECTS.md`, перевес, а не бесспорное доказательство). Размер следа в проекте и в подписи «В игре ≈» — метры в игре, а помощнику
 * заказывается в его единицах: метры × `TRACER_INSTALL_UNITS_PER_METRE` (`yptRulePatch`). До 25.10.2026 заказ шёл без умножения, и «6 м» на деле были 3 м.
 */
export const TRACER_INSTALL_UNITS_PER_METRE = 2;

const unitAmount = (value, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
};

const scaleShape = (range, amount) =>
  Number((range.min * Math.pow(range.max / range.min, amount)).toFixed(3));

/** Размер спрайта следа в метрах по ползункам проекта (0…1). */
export function tracerShape({ thickness, length } = {}) {
  return Object.freeze({
    width: scaleShape(ASTRAL_TRACER_SHAPE.width, unitAmount(thickness, 0.45)),
    length: scaleShape(ASTRAL_TRACER_SHAPE.length, unitAmount(length, 0.6)),
  });
}

/*
 * Свои выстрелы без следа (задача 14 ТЗ 10.10.2026).
 *
 * Кто стрелял, файлы игры не знают: `TracerFx` и шансы у ствола в
 * `weapons.meta` одни на всех персонажей (у вспышки, дыма и гильз есть
 * варианты «от первого лица», у следа — нет). Ближайшее, что делается
 * файлом, — дальность LOD правила следа. Замер в игре 10.10.2026: игра
 * меряет её от камеры до ближайшей к ней точки следа, а не до стрелка.
 * Свой след начинается у своего дула — у камеры: от первого лица 0,5–0,7 м,
 * с прицелом из-за плеча 2,6–2,8 м, от бедра 3,0–3,1 м. «Только чужие» —
 * след, прошедший ближе `from` к камере, не рисуется и растёт до полного к
 * `to` (`from` + 3 м); `from` у трассера свой (`TRACER_OWN_RADIUS`, по
 * умолчанию 3,5 м — дальше своего дула). Цена: чужой выстрел, пролетевший
 * ближе `from` к камере (в том числе в вас), тоже без следа — у него
 * ближайшая точка там же, где ваше тело; дальний рост штатного следа
 * (×2 к 80 м) у такого трассера не работает.
 */
export const TRACER_OWN_SHOTS = Object.freeze(["show", "hide"]);
export const TRACER_OWN_RADIUS = Object.freeze({ min: 1.5, max: 15, step: 0.5, standard: 3.5, fade: 3 });

/** Дальность «вблизи следа нет» для радиуса своих выстрелов, метры. */
export function tracerNearHide(radius = TRACER_OWN_RADIUS.standard) {
  const value = Number(radius);
  const from = Number.isFinite(value)
    ? Math.min(TRACER_OWN_RADIUS.max, Math.max(TRACER_OWN_RADIUS.min, value))
    : TRACER_OWN_RADIUS.standard;
  return Object.freeze({ from, to: from + TRACER_OWN_RADIUS.fade });
}

export const TRACER_NEAR_HIDE = tracerNearHide(TRACER_OWN_RADIUS.standard);

/** Дальность «вблизи следа нет» перед патчем ядра: `{ from, to }` в метрах. */
export function normalizeTracerNearHide(input = {}) {
  const from = Number(input?.from);
  const to = Number(input?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0.5 || to > 100 || from >= to)
    throw new Error("Дальность «свои выстрелы без следа»: от 0,5 до 100 м, и «от» меньше «до».");
  return Object.freeze({ from: Number(from.toFixed(2)), to: Number(to.toFixed(2)) });
}

/** Размер, пришедший из проекта или чужого плана, перед патчем ядра. */
export function normalizeTracerShape(input = {}) {
  const shape = {};
  for (const axis of ["width", "length"]) {
    const value = Number(input?.[axis]);
    const range = ASTRAL_TRACER_SHAPE[axis];
    if (!Number.isFinite(value) || value < range.min || value > range.max) {
      throw new Error(
        `Размер следа (${axis}): допустимо от ${range.min} до ${range.max} м.`,
      );
    }
    shape[axis] = Number(value.toFixed(3));
  }
  return Object.freeze(shape);
}

/*
 * Слоты эффектов попадания.
 *
 * Слот занимает не зона, а внешний вид: зоны с одинаковым видом, цветом и
 * размером делят одну текстуру и одно правило, потому что различаются они уже
 * на уровне записи bloodfx.dat — там у каждой свой тон и свой масштаб. Шести
 * разных обликов хватает с запасом: обычный пресет использует два-три.
 *
 * Layout повторяет донора, с которого правило клонируется в сборщике ядра:
 * ванильную текстуру брызг 1024×1024 DXT5 с девятью mip. Своих размеров здесь
 * не выдумывается — расхождение с донором пришлось бы чинить переписыванием
 * полей ресурса, а это тот самый случай, когда ошибка видна только в игре.
 *
 * Каждый слот стоит около полутора мегабайт в каждом из трёх вариантов ядра.
 * Это осознанная плата за возможность развести голову и корпус.
 */
export const ASTRAL_IMPACT_TEXTURE_LAYOUT = Object.freeze({
  width: 1024,
  height: 1024,
  mipLevels: 9,
  format: "DXT5",
});
export const ASTRAL_IMPACT_SHEET = Object.freeze({ columns: 4, rows: 4 });
export const ASTRAL_IMPACT_SLOTS = Object.freeze(
  Array.from({ length: 6 }, (_, index) => {
    const suffix = String(index).padStart(3, "0");
    return Object.freeze({
      id: index,
      rule: `astral_impact_${suffix}`,
      texture: `astral_impact_tex_${suffix}`,
    });
  }),
);

/*
 * Сетка кадров текстуры следа.
 *
 * Игра берёт сетку листа не из core.ypt, а из таблицы
 * `common/data/effects/ptxclipregions.dat`: строка на текстуру — имя,
 * столбцы, строки и прямоугольник на каждый кадр. Текстуру, которой в таблице
 * нет, игра рисует одним кадром. Текстура следа — один кадр целиком, а лист
 * попаданий — 4×4 и обязан стоять в таблице: иначе в игре вспыхнут все
 * шестнадцать кадров сразу одной картинкой.
 */
export const ASTRAL_TRACER_SHEET = Object.freeze({ columns: 1, rows: 1 });

/*
 * Лист штатного следа.
 *
 * `ptfx_bullet_tracer` в ядре игры — лист 4×1, и частица штатного следа
 * рисует кадр 3: так в `ptxclipregions.dat` живого update.rpf Legacy
 * (строка `ptfx_bullet_tracer 4 1 …`). Слот Astral рисует свою текстуру одним
 * кадром, поэтому след из чужого редукса переносится в слот этим кадром,
 * растянутым на всю текстуру, — иначе в игре пролетели бы все четыре полосы
 * листа разом.
 */
export const VANILLA_TRACER_SHEET = Object.freeze({
  texture: "ptfx_bullet_tracer",
  columns: 4,
  rows: 1,
  frame: 3,
});

/* Точка листа видна, если её альфа больше этого (0–255): ниже — шум сжатия DXT5 у пустых полос. */
const VISIBLE_ALPHA = 8;

/** Кадры, которые рисует правило частицы следа (`TexFrameIDMin…Max` выгрузки `ypt-rule-export`), или `null`. */
export function tracerRuleFrames(particle) {
  const min = Number(particle?.TexFrameIDMin);
  const max = Number(particle?.TexFrameIDMax);
  if (!Number.isInteger(min) || min < 0) return null;
  return { min, max: Number.isInteger(max) && max >= min ? max : min };
}

/*
 * Кадр листа следа, который едет в слот Astral (30.10.2026, ночная проверка: у редукса 314 картинка только в кадре 0 листа
 * 512×1024, а штатный кадр 3 пуст — в игре следа не было). По порядку: кадр правила частицы автора (`rule` —
 * `tracerRuleFrames`; из диапазона — самый заполненный), иначе единственный непустой, иначе штатный кадр, если он не пуст,
 * иначе самый заполненный. `grid` — сетка листа: строка автора в `ptxclipregions.dat`, а нет её — штатная 4×1.
 * `rgba` — верхний уровень листа. Ответ — `{ columns, rows, frame, source, visible }` (`source`: `rule` | `single` | `stock` |
 * `fullest`, `visible` — видимые точки по кадрам) или `null`: видимых точек в листе нет — автор убрал след, это не трассер.
 */
export function tracerSheetFrame({ rgba, width, height, grid = VANILLA_TRACER_SHEET, rule = null }) {
  const columns = Math.max(1, Math.floor(Number(grid?.columns) || 1));
  const rows = Math.max(1, Math.floor(Number(grid?.rows) || 1));
  const cellWidth = Math.floor(width / columns);
  const cellHeight = Math.floor(height / rows);
  if (!cellWidth || !cellHeight) return null;
  const visible = new Array(columns * rows).fill(0);
  for (let y = 0; y < cellHeight * rows; y += 1)
    for (let x = 0; x < cellWidth * columns; x += 1)
      if (rgba[(y * width + x) * 4 + 3] > VISIBLE_ALPHA) visible[Math.floor(y / cellHeight) * columns + Math.floor(x / cellWidth)] += 1;
  const fullest = (frames) => frames.reduce((best, frame) => (visible[frame] > visible[best] ? frame : best), frames[0]);
  const answer = (frame, source) => ({ columns, rows, frame, source, visible });
  const all = visible.map((_, frame) => frame);
  if (!visible.some((count) => count > 0)) return null;
  if (rule) {
    const inRange = all.filter((frame) => frame >= rule.min && frame <= rule.max);
    const picked = inRange.length ? fullest(inRange) : null;
    if (picked != null && visible[picked] > 0) return answer(picked, "rule");
  }
  const filled = all.filter((frame) => visible[frame] > 0);
  if (filled.length === 1) return answer(filled[0], "single");
  const stock = Number(grid?.frame ?? VANILLA_TRACER_SHEET.frame);
  if (columns === VANILLA_TRACER_SHEET.columns && rows === VANILLA_TRACER_SHEET.rows && visible[stock] > 0) return answer(stock, "stock");
  return answer(fullest(filled), "fullest");
}

/** Есть ли в картинке видимые точки (альфа верхнего уровня): пустой слот — не трассер. */
export function tracerHasVisible(rgba) {
  for (let at = 3; at < rgba.length; at += 4) if (rgba[at] > VISIBLE_ALPHA) return true;
  return false;
}

/*
 * Доноры слотов.
 *
 * Если системного ядра Astral у игрока нет, слот строится из ядра его же
 * игры: правило-донор копируется целиком (эмиттер, частицы, физика,
 * эволюции), от него остаётся один эмиттер — тот, чьи частицы рисуют
 * текстуру слота, — и кадры переводятся на сетку текстуры слота. Доноры
 * сверены с живым ядром Legacy (964 правила, 107 текстур):
 *
 *  • bullet_tracer — штатный след. Его частица bullet_tracer берёт кадр 3
 *    листа 4×1 ptfx_bullet_tracer; слот берёт кадр 0 своей текстуры 1×1.
 *  • blood_entry — штатное попадание пули в тело (записи 101–106
 *    bloodfx.dat). Частица blood_entry_blood_dust смотрит в камеру и
 *    проигрывает лист ptfx_blood_spray 7×7; слот проигрывает свой лист 4×4
 *    один раз за жизнь частицы — от плотного кадра к разрежённому.
 */
export const ASTRAL_CORE_SLOT_DONORS = Object.freeze({
  tracer: Object.freeze({
    effect: "bullet_tracer",
    particle: "bullet_tracer",
    sheet: ASTRAL_TRACER_SHEET,
    frames: Object.freeze({ min: 0, max: 0 }),
  }),
  impact: Object.freeze({
    effect: "blood_entry",
    particle: "blood_entry_blood_dust",
    sheet: ASTRAL_IMPACT_SHEET,
    frames: Object.freeze({
      min: 0,
      max: 0,
      last: ASTRAL_IMPACT_SHEET.columns * ASTRAL_IMPACT_SHEET.rows - 1,
      loopMode: 0,
      scaledOverLife: true,
    }),
  }),
});

/*
 * Слоты огня и взрывов.
 *
 * Огонь в GTA живёт листами кадров: `ptfx_fire_v2`, `ptfx_fire_v3`,
 * `ptfx_flipbook_fire_rgb`, `_explosion_fireball`. В чужих модах они бывают до
 * 2048×2048, поэтому слот здесь крупнее остальных — иначе от пламени осталась
 * бы четверть кадра.
 *
 * Слотов четыре: пламя, шлейф, угли и фаербол. Больше одновременно не нужно —
 * это не зоны тела, где каждая своя.
 */
export const ASTRAL_FIRE_TEXTURE_LAYOUT = Object.freeze({
  width: 1024,
  height: 1024,
  mipLevels: 9,
  format: "DXT5",
});
export const ASTRAL_FIRE_SLOTS = Object.freeze(
  Array.from({ length: 4 }, (_, index) => {
    const suffix = String(index).padStart(3, "0");
    return Object.freeze({
      id: index,
      rule: `astral_fire_${suffix}`,
      texture: `astral_fire_tex_${suffix}`,
    });
  }),
);

const weapon = (id, label, group) => Object.freeze({ id, label, group });

const KNOWN_TRACER_WEAPONS = Object.freeze([
  weapon("WEAPON_PISTOL", "Пистолет", "Пистолеты"),
  weapon("WEAPON_COMBATPISTOL", "Боевой пистолет", "Пистолеты"),
  weapon("WEAPON_APPISTOL", "Автоматический пистолет", "Пистолеты"),
  weapon("WEAPON_PISTOL50", "Пистолет .50", "Пистолеты"),
  weapon("WEAPON_SNSPISTOL", "Карманный пистолет", "Пистолеты"),
  weapon("WEAPON_HEAVYPISTOL", "Тяжёлый пистолет", "Пистолеты"),
  weapon("WEAPON_VINTAGEPISTOL", "Винтажный пистолет", "Пистолеты"),
  weapon("WEAPON_MARKSMANPISTOL", "Марксманский пистолет", "Пистолеты"),
  weapon("WEAPON_REVOLVER", "Револьвер", "Пистолеты"),
  weapon("WEAPON_DOUBLEACTION", "Двойной револьвер", "Пистолеты"),
  weapon("WEAPON_CERAMICPISTOL", "Керамический пистолет", "Пистолеты"),
  weapon("WEAPON_NAVYREVOLVER", "Флотский револьвер", "Пистолеты"),
  weapon("WEAPON_GADGETPISTOL", "Перико-пистолет", "Пистолеты"),
  weapon("WEAPON_PISTOLXM3", "WM 29", "Пистолеты"),
  weapon("WEAPON_MICROSMG", "Micro SMG", "Пистолеты-пулемёты"),
  weapon("WEAPON_SMG", "SMG", "Пистолеты-пулемёты"),
  weapon("WEAPON_ASSAULTSMG", "Assault SMG", "Пистолеты-пулемёты"),
  weapon("WEAPON_COMBATPDW", "Combat PDW", "Пистолеты-пулемёты"),
  weapon("WEAPON_MACHINEPISTOL", "Machine Pistol", "Пистолеты-пулемёты"),
  weapon("WEAPON_MINISMG", "Mini SMG", "Пистолеты-пулемёты"),
  weapon("WEAPON_TECPISTOL", "Tactical SMG", "Пистолеты-пулемёты"),
  weapon("WEAPON_ASSAULTRIFLE", "Штурмовая винтовка", "Винтовки"),
  weapon("WEAPON_CARBINERIFLE", "Карабин", "Винтовки"),
  weapon("WEAPON_ADVANCEDRIFLE", "Улучшенная винтовка", "Винтовки"),
  weapon("WEAPON_SPECIALCARBINE", "Специальный карабин", "Винтовки"),
  weapon("WEAPON_BULLPUPRIFLE", "Булл-пап винтовка", "Винтовки"),
  weapon("WEAPON_COMPACTRIFLE", "Компактная винтовка", "Винтовки"),
  weapon("WEAPON_MILITARYRIFLE", "Военная винтовка", "Винтовки"),
  weapon("WEAPON_HEAVYRIFLE", "Тяжёлая винтовка", "Винтовки"),
  weapon("WEAPON_TACTICALRIFLE", "Тактическая винтовка", "Винтовки"),
  weapon("WEAPON_SERVICECARBINE", "Служебный карабин", "Винтовки"),
  weapon("WEAPON_PUMPSHOTGUN", "Помповый дробовик", "Дробовики"),
  weapon("WEAPON_SAWNOFFSHOTGUN", "Обрез", "Дробовики"),
  weapon("WEAPON_ASSAULTSHOTGUN", "Штурмовой дробовик", "Дробовики"),
  weapon("WEAPON_BULLPUPSHOTGUN", "Булл-пап дробовик", "Дробовики"),
  weapon("WEAPON_HEAVYSHOTGUN", "Тяжёлый дробовик", "Дробовики"),
  weapon("WEAPON_DBSHOTGUN", "Двуствольный дробовик", "Дробовики"),
  weapon("WEAPON_AUTOSHOTGUN", "Автоматический дробовик", "Дробовики"),
  weapon("WEAPON_COMBATSHOTGUN", "Боевой дробовик", "Дробовики"),
  weapon("WEAPON_MG", "Пулемёт", "Пулемёты"),
  weapon("WEAPON_COMBATMG", "Боевой пулемёт", "Пулемёты"),
  weapon("WEAPON_GUSENBERG", "Gusenberg", "Пулемёты"),
  weapon("WEAPON_SNIPERRIFLE", "Снайперская винтовка", "Снайперские"),
  weapon("WEAPON_HEAVYSNIPER", "Тяжёлая снайперская винтовка", "Снайперские"),
  weapon("WEAPON_MARKSMANRIFLE", "Марксманская винтовка", "Снайперские"),
  weapon("WEAPON_PRECISIONRIFLE", "Высокоточная винтовка", "Снайперские"),
  weapon("WEAPON_RAILGUN", "Рельсотрон", "Особые"),
]);

// The current Legacy compositor patches common/data/ai/weapons.meta.  DLC
// weapons live in separate metadata files and must not be advertised until the
// managed WEAPONINFO_FILE_PATCH DLC is released.  Keeping this allowlist exact
// makes the "all weapons" option portable across the tested Legacy baseline.
const LEGACY_COMMON_WEAPON_IDS = new Set([
  "WEAPON_PISTOL",
  "WEAPON_COMBATPISTOL",
  "WEAPON_APPISTOL",
  "WEAPON_PISTOL50",
  "WEAPON_MICROSMG",
  "WEAPON_SMG",
  "WEAPON_ASSAULTSMG",
  "WEAPON_ASSAULTRIFLE",
  "WEAPON_CARBINERIFLE",
  "WEAPON_ADVANCEDRIFLE",
  "WEAPON_PUMPSHOTGUN",
  "WEAPON_SAWNOFFSHOTGUN",
  "WEAPON_ASSAULTSHOTGUN",
  "WEAPON_BULLPUPSHOTGUN",
  "WEAPON_MG",
  "WEAPON_COMBATMG",
  "WEAPON_SNIPERRIFLE",
  "WEAPON_HEAVYSNIPER",
]);

export const TRACER_WEAPONS = Object.freeze(
  KNOWN_TRACER_WEAPONS.filter((item) => LEGACY_COMMON_WEAPON_IDS.has(item.id)),
);

export const TRACER_WEAPON_IDS = Object.freeze(
  TRACER_WEAPONS.map((item) => item.id),
);
export const ASTRAL_TRACER_SLOTS = Object.freeze(
  Array.from({ length: 16 }, (_, index) => {
    const suffix = String(index).padStart(3, "0");
    return Object.freeze({
      id: index,
      rule: `astral_tracer_${suffix}`,
      texture: `astral_tracer_tex_${suffix}`,
    });
  }),
);

/*
 * Ядро игрока — путь установки трассеров и текстур ядра из каталога
 * (29.10.2026).
 *
 * Раньше слои каталога ложились на системное ядро `astral-ptfx-core-base` —
 * целый `core.ypt`, а это файл Rockstar, и раздавать его нельзя. Теперь
 * «наше ядро» — слоты Astral в ядре самого игрока: недостающий слот следа
 * установка строит из штатного донора тем же проходом помощника, что и
 * мастерская, а перерисованная штатная текстура ложится в его же ядро, в его
 * же раскладке. Канал и версия — это версия пути установки: ворота публикации
 * открываются отметкой о проверке именно этой версии в игре
 * (`apps/api/src/ptfx-core-release.js`), и новая версия пути снова закрыта.
 *
 * Канал `astral-ptfx-legacy` остаётся как был: им подписан вывод мастерской
 * (`compile.js`) и слои поверх системного ядра.
 */
export const ASTRAL_PTFX_PLAYER_CORE_CHANNEL = "astral-ptfx-player";
export const ASTRAL_PTFX_PLAYER_CORE_VERSION = "2.0.0";

/** Слой ядра на пути «ядро игрока». */
export const isPlayerCoreLayer = (merge) =>
  merge?.coreChannel === ASTRAL_PTFX_PLAYER_CORE_CHANNEL &&
  merge?.coreVersion === ASTRAL_PTFX_PLAYER_CORE_VERSION;

/** Канал и версия ядра, которые принимает установщик. */
export function knownPtfxCore(channel, version) {
  return (
    (channel === ASTRAL_PTFX_CORE_CHANNEL &&
      version === ASTRAL_PTFX_CORE_VERSION) ||
    (channel === ASTRAL_PTFX_PLAYER_CORE_CHANNEL &&
      version === ASTRAL_PTFX_PLAYER_CORE_VERSION)
  );
}

/*
 * Слоты следа каталога — свой диапазон, `astral_tracer_100…115`.
 *
 * Мастерская занимает слоты с нуля, по месту трассера в проекте, и при
 * «Применить» возвращает штатный след стволам, привязанным к её слоту без
 * журнала (`tracer-weapons.js`, сироты 000…015). Каталог в этом диапазоне
 * перетёр бы её картинку, а она — его привязки. Сотня — вне досягаемости
 * мастерской: её предел — 16 трассеров. Лист слота — один кадр, как у
 * мастерской; строки в `ptxclipregions.dat` ему не нужно (текстуру без строки
 * игра рисует одним кадром).
 */
export const ASTRAL_CATALOG_TRACER_SLOTS = Object.freeze(
  Array.from({ length: 16 }, (_, index) => {
    const suffix = String(100 + index).padStart(3, "0");
    return Object.freeze({
      id: 100 + index,
      kind: "tracer",
      rule: `astral_tracer_${suffix}`,
      texture: `astral_tracer_tex_${suffix}`,
    });
  }),
);
export const isCatalogTracerRule = (name) =>
  ASTRAL_CATALOG_TRACER_SLOTS.some(
    (slot) => slot.rule === String(name || "").toLowerCase(),
  );

/*
 * Вспышка выстрела — клон штатной вспышки ствола.
 *
 * У каждого ствола в `weapons.meta` своя вспышка у дула — `<FlashFx>`, правило
 * ядра `muz_*` из нескольких частей (факел, ядро, звёзды, свечение, дым).
 * Своя вспышка — копия ЭТОГО правила целиком (клоны эффектов, как у
 * попаданий): форма остаётся штатной, а цвет, число частиц и их скорость —
 * свои. `<FlashFx>` ствола переводится на копию.
 *
 * Донор записан в имени копии: `astral_muzzle_003__muz_assault_rifle`. Так
 * снятие знает, что вернуть, даже без журнала прошлой установки, — таблицы
 * штатных вспышек, снятой с игры, как у следа, пока нет. Номер — место ствола
 * в `STUDIO_TRACER_WEAPON_IDS`: у ствола одно имя клона, и установка
 * пересобирает ровно клоны тех стволов, чьи файлы прочла, не трогая чужие
 * (на них может ссылаться файл, которого эта установка не читала).
 */
export const ASTRAL_MUZZLE_PREFIX = "astral_muzzle_";
/* Имя клона — `astral_` и не больше 48 знаков после (помощник RPF). */
const MUZZLE_NAME_LIMIT = 55;
const MUZZLE_DONOR = /^[a-z0-9_]{1,64}$/;
/* Форма — код другой вспышки ядра между номером и донором:
   `astral_muzzle_003_laser__muz_assault_rifle` снят с `muz_laser`, а вернуть
   ствол снятие должно к `muz_assault_rifle`. */
const MUZZLE_RULE = /^astral_muzzle_(\d{3})(?:_([a-z]{2,12}))?__([a-z0-9_]+)$/;
const SHAPE_CODE = /^[a-z]{2,12}$/;

/**
 * Имя клона вспышки: номер ствола, код формы (если вспышка снята с другого
 * правила ядра) и штатное правило ствола — то, что вернёт снятие.
 */
export function muzzleCloneName(index, donor, shape = "") {
  const name = String(donor || "").toLowerCase();
  if (!MUZZLE_DONOR.test(name) || name.startsWith("astral_"))
    throw new Error(`Непонятная штатная вспышка: ${donor}`);
  const code = String(shape || "").toLowerCase();
  if (code && !SHAPE_CODE.test(code))
    throw new Error(`Непонятная форма вспышки: ${shape}`);
  const rule = `${ASTRAL_MUZZLE_PREFIX}${String(index).padStart(3, "0")}${code ? `_${code}` : ""}__${name}`;
  if (rule.length > MUZZLE_NAME_LIMIT)
    throw new Error(`Имя штатной вспышки слишком длинное: ${donor}`);
  return rule;
}

/** Штатная вспышка ствола, записанная в клоне, — или `null`, если это не клон. */
export function muzzleDonorOf(rule) {
  return MUZZLE_RULE.exec(String(rule || "").toLowerCase())?.[3] || null;
}

/** Правило вспышки Astral (клон), а не штатное. */
export const isAstralMuzzle = (rule) =>
  String(rule || "")
    .toLowerCase()
    .startsWith(ASTRAL_MUZZLE_PREFIX);

/*
 * Дым из ствола — клон штатного `<MuzzleSmokeFx>` ствола
 * (`muz_smoking_barrel`) с цветом, числом и скоростью частиц, по тому же
 * правилу имён: `astral_smoke_003__muz_smoking_barrel` — донор в имени,
 * чтобы снятие вернуло штатный дым и без журнала.
 */
export const ASTRAL_SMOKE_PREFIX = "astral_smoke_";
const SMOKE_RULE = /^astral_smoke_(\d{3})__([a-z0-9_]+)$/;

/** Имя клона дыма: номер ствола и штатное правило дыма. */
export function smokeCloneName(index, donor) {
  const name = String(donor || "").toLowerCase();
  if (!MUZZLE_DONOR.test(name) || name.startsWith("astral_"))
    throw new Error(`Непонятный штатный дым: ${donor}`);
  const rule = `${ASTRAL_SMOKE_PREFIX}${String(index).padStart(3, "0")}__${name}`;
  if (rule.length > MUZZLE_NAME_LIMIT)
    throw new Error(`Имя штатного дыма слишком длинное: ${donor}`);
  return rule;
}

/** Штатный дым, с которого снят клон, — или `null`, если это не клон. */
export function smokeDonorOf(rule) {
  return SMOKE_RULE.exec(String(rule || "").toLowerCase())?.[2] || null;
}

/** Правило дыма Astral (клон), а не штатное. */
export const isAstralSmoke = (rule) =>
  String(rule || "")
    .toLowerCase()
    .startsWith(ASTRAL_SMOKE_PREFIX);

/*
 * Стволы мастерской трассеров — все пули игры, а не восемнадцать базовых.
 *
 * Список каталога выше (`TRACER_WEAPONS`) ограничен `weapons.meta` из
 * update.rpf, потому что опубликованный трассер ставится слоями композитора
 * и правит только этот файл. Мастерская пишет в игру сама и умеет больше: у
 * оружия дополнений (MK2, тяжёлая винтовка, служебный карабин…) описание
 * лежит в своём файле пакета, и игра читает его не из `dlc.rpf` пакета, а
 * из `update.rpf/dlc_patch/<пакет>/<путь>`, если такой файл есть, — так
 * Rockstar и правит оружие дополнений после выпуска. Мастерская кладёт
 * правленый файл по тому же адресу: игра берёт его первым.
 *
 * Где какой ствол описан, снято с живой Steam-сборки Legacy 23.09.2026:
 * порядок `dlclist.xml`, `content.xml` каждого пакета (записи
 * WEAPONINFO_FILE_PATCH), последний по порядку побеждает. Пакеты первого
 * года (`platform:/dlcPacks/`) лежат вложенными в `x64w.rpf`; у всех их
 * стволов есть `dlc_patch` в update.rpf. Стволов без пули здесь нет:
 * электрошокер, ракетница, лучевое оружие Arena War и приборы (сканер,
 * металлоискатель) — не трассеры.
 */
export const TRACER_BASE_WEAPONS_ENTRY = "common/data/ai/weapons.meta";

const dlc = (pack, entry) => Object.freeze({ pack, entry });
/* Штатный след ствола: правило и шансы, как у Rockstar. Пустое правило —
   ствол без следа (дробовики). */
const vanilla = (tracerFx, chanceSP, chanceMP) =>
  Object.freeze({ tracerFx, chanceSP, chanceMP });
/*
 * `en` — имя ствола в самой игре (Carbine Rifle MK2): на серверах его
 * так и зовут, и поиск в мастерской находит ствол по обоим именам.
 * `popular` — у ствола есть полка в мастерской оружия: самые ходовые на
 * RP-серверах, в списке они идут первыми.
 */
const studioWeapon = (
  id,
  label,
  group,
  source,
  original,
  en,
  popular = false,
) =>
  Object.freeze({ id, label, group, source, vanilla: original, en, popular });

export const STUDIO_TRACER_WEAPON_GROUPS = Object.freeze([
  "Пистолеты",
  "Пистолеты-пулемёты",
  "Винтовки",
  "Дробовики",
  "Пулемёты",
  "Снайперские",
]);

export const STUDIO_TRACER_WEAPONS = Object.freeze([
  /* Пистолеты */
  studioWeapon(
    "WEAPON_PISTOL",
    "Пистолет",
    "Пистолеты",
    null,
    vanilla("bullet_tracer", 0.2, 0.75),
    "Pistol",
  ),
  studioWeapon(
    "WEAPON_PISTOL_MK2",
    "Пистолет MK2",
    "Пистолеты",
    dlc("mpgunrunning", "common/data/ai/weapons_pistol_mk2.meta"),
    vanilla("bullet_tracer", 0.2, 0.75),
    "Pistol Mk II",
  ),
  studioWeapon(
    "WEAPON_COMBATPISTOL",
    "Боевой пистолет",
    "Пистолеты",
    null,
    vanilla("bullet_tracer", 0.2, 0.75),
    "Combat Pistol",
  ),
  studioWeapon(
    "WEAPON_APPISTOL",
    "Автоматический пистолет",
    "Пистолеты",
    null,
    vanilla("bullet_tracer", 0.2, 0.75),
    "AP Pistol",
  ),
  studioWeapon(
    "WEAPON_PISTOL50",
    "Пистолет .50",
    "Пистолеты",
    null,
    vanilla("bullet_tracer", 0.2, 0.75),
    "Pistol .50",
  ),
  studioWeapon(
    "WEAPON_SNSPISTOL",
    "Карманный пистолет",
    "Пистолеты",
    dlc("mpbeach", "common/data/ai/weaponSNSPistol.meta"),
    vanilla("bullet_tracer", 0.2, 0.75),
    "SNS Pistol",
  ),
  studioWeapon(
    "WEAPON_SNSPISTOL_MK2",
    "Карманный пистолет MK2",
    "Пистолеты",
    dlc("mpchristmas2017", "common/data/ai/weapons_snspistol_mk2.meta"),
    vanilla("bullet_tracer", 0.2, 0.75),
    "SNS Pistol Mk II",
  ),
  studioWeapon(
    "WEAPON_HEAVYPISTOL",
    "Тяжёлый пистолет",
    "Пистолеты",
    dlc("mpbusiness", "common/data/ai/weaponHeavyPistol.meta"),
    vanilla("bullet_tracer", 0.2, 0.75),
    "Heavy Pistol",
    true,
  ),
  studioWeapon(
    "WEAPON_VINTAGEPISTOL",
    "Винтажный пистолет",
    "Пистолеты",
    dlc("mphipster", "common/data/ai/weaponVintagePistol.meta"),
    vanilla("bullet_tracer", 0.2, 0.75),
    "Vintage Pistol",
  ),
  studioWeapon(
    "WEAPON_MARKSMANPISTOL",
    "Марксманский пистолет",
    "Пистолеты",
    dlc("mpluxe2", "common/data/ai/weaponMarksmanPistol.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Marksman Pistol",
  ),
  studioWeapon(
    "WEAPON_REVOLVER",
    "Револьвер",
    "Пистолеты",
    dlc("mpapartment", "common/data/ai/weaponRevolver.meta"),
    vanilla("bullet_tracer", 0.2, 0.75),
    "Heavy Revolver",
    true,
  ),
  studioWeapon(
    "WEAPON_REVOLVER_MK2",
    "Револьвер MK2",
    "Пистолеты",
    dlc("mpchristmas2017", "common/data/ai/weapons_revolver_mk2.meta"),
    vanilla("bullet_tracer", 0.2, 0.75),
    "Heavy Revolver Mk II",
  ),
  studioWeapon(
    "WEAPON_DOUBLEACTION",
    "Револьвер двойного действия",
    "Пистолеты",
    dlc("mpchristmas2017", "common/data/ai/weapons_doubleaction.meta"),
    vanilla("bullet_tracer", 0.2, 0.75),
    "Double Action Revolver",
  ),
  studioWeapon(
    "WEAPON_NAVYREVOLVER",
    "Флотский револьвер",
    "Пистолеты",
    dlc("mpheist3", "common/data/ai/weapon_navyrevolver.meta"),
    vanilla("bullet_tracer", 0.2, 0.75),
    "Navy Revolver",
  ),
  studioWeapon(
    "WEAPON_CERAMICPISTOL",
    "Керамический пистолет",
    "Пистолеты",
    dlc("mpheist3", "common/data/ai/weapon_ceramicpistol.meta"),
    vanilla("bullet_tracer", 0.2, 0.75),
    "Ceramic Pistol",
  ),
  studioWeapon(
    "WEAPON_GADGETPISTOL",
    "Перико-пистолет",
    "Пистолеты",
    dlc("mpheist4", "common/data/ai/weapon_gadgetpistol.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Perico Pistol",
  ),
  studioWeapon(
    "WEAPON_PISTOLXM3",
    "Пистолет WM 29",
    "Пистолеты",
    dlc("mpchristmas3", "common/data/ai/weapon_pistolxm3.meta"),
    vanilla("bullet_tracer", 0.2, 0.75),
    "WM 29 Pistol",
  ),
  /* Пистолеты-пулемёты */
  studioWeapon(
    "WEAPON_MICROSMG",
    "Микро ПП",
    "Пистолеты-пулемёты",
    null,
    vanilla("bullet_tracer", 0.15, 0.75),
    "Micro SMG",
    true,
  ),
  studioWeapon(
    "WEAPON_SMG",
    "Пистолет-пулемёт",
    "Пистолеты-пулемёты",
    null,
    vanilla("bullet_tracer", 0.15, 0.75),
    "SMG",
    true,
  ),
  studioWeapon(
    "WEAPON_SMG_MK2",
    "ПП MK2",
    "Пистолеты-пулемёты",
    dlc("mpgunrunning", "common/data/ai/weapons_smg_mk2.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "SMG Mk II",
    true,
  ),
  studioWeapon(
    "WEAPON_ASSAULTSMG",
    "Штурмовой ПП",
    "Пистолеты-пулемёты",
    null,
    vanilla("bullet_tracer", 0.15, 0.75),
    "Assault SMG",
    true,
  ),
  studioWeapon(
    "WEAPON_COMBATPDW",
    "Боевой PDW",
    "Пистолеты-пулемёты",
    dlc("mpluxe", "common/data/ai/weaponCombatPDW.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Combat PDW",
    true,
  ),
  studioWeapon(
    "WEAPON_MACHINEPISTOL",
    "Автоматический пистолет-пулемёт",
    "Пистолеты-пулемёты",
    dlc("mplowrider", "common/data/ai/weaponMachinePistol.meta"),
    vanilla("bullet_tracer", 0.2, 0.75),
    "Machine Pistol",
  ),
  studioWeapon(
    "WEAPON_MINISMG",
    "Мини ПП",
    "Пистолеты-пулемёты",
    dlc("mpbiker", "common/data/ai/weaponMiniSMG.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Mini SMG",
    true,
  ),
  studioWeapon(
    "WEAPON_TECPISTOL",
    "Тактический ПП",
    "Пистолеты-пулемёты",
    dlc("mp2023_01", "common/data/ai/weapon_tecpistol.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Pistol SMG",
  ),
  /* Винтовки */
  studioWeapon(
    "WEAPON_ASSAULTRIFLE",
    "Штурмовая винтовка",
    "Винтовки",
    null,
    vanilla("bullet_tracer", 0.15, 0.75),
    "Assault Rifle",
    true,
  ),
  studioWeapon(
    "WEAPON_ASSAULTRIFLE_MK2",
    "Штурмовая винтовка MK2",
    "Винтовки",
    dlc("mpgunrunning", "common/data/ai/weapons_assaultrifle_mk2.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Assault Rifle Mk II",
  ),
  studioWeapon(
    "WEAPON_CARBINERIFLE",
    "Карабин",
    "Винтовки",
    null,
    vanilla("bullet_tracer", 0.15, 0.75),
    "Carbine Rifle",
    true,
  ),
  studioWeapon(
    "WEAPON_CARBINERIFLE_MK2",
    "Карабин MK2",
    "Винтовки",
    dlc("mpgunrunning", "common/data/ai/weapons_carbinerifle_mk2.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Carbine Rifle Mk II",
    true,
  ),
  studioWeapon(
    "WEAPON_ADVANCEDRIFLE",
    "Улучшенная винтовка",
    "Винтовки",
    null,
    vanilla("bullet_tracer", 0.15, 0.75),
    "Advanced Rifle",
    true,
  ),
  studioWeapon(
    "WEAPON_SPECIALCARBINE",
    "Специальный карабин",
    "Винтовки",
    dlc("mpbusiness", "common/data/ai/weaponSpecialCarbine.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Special Carbine",
    true,
  ),
  studioWeapon(
    "WEAPON_SPECIALCARBINE_MK2",
    "Специальный карабин MK2",
    "Винтовки",
    dlc("mpchristmas2017", "common/data/ai/weapons_specialcarbine_mk2.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Special Carbine Mk II",
    true,
  ),
  studioWeapon(
    "WEAPON_BULLPUPRIFLE",
    "Булл-пап винтовка",
    "Винтовки",
    dlc("mpbusiness2", "common/data/ai/weaponBullpupRifle.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Bullpup Rifle",
    true,
  ),
  studioWeapon(
    "WEAPON_BULLPUPRIFLE_MK2",
    "Булл-пап винтовка MK2",
    "Винтовки",
    dlc("mpchristmas2017", "common/data/ai/weapons_bullpuprifle_mk2.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Bullpup Rifle Mk II",
  ),
  studioWeapon(
    "WEAPON_COMPACTRIFLE",
    "Компактная винтовка",
    "Винтовки",
    dlc("mplowrider2", "common/data/ai/weaponCompactRifle.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Compact Rifle",
  ),
  studioWeapon(
    "WEAPON_MILITARYRIFLE",
    "Военная винтовка",
    "Винтовки",
    dlc("mpheist4", "common/data/ai/weapon_militaryrifle.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Military Rifle",
  ),
  studioWeapon(
    "WEAPON_HEAVYRIFLE",
    "Тяжёлая винтовка",
    "Винтовки",
    dlc("mpsecurity", "common/data/ai/weapons_heavyrifle.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Heavy Rifle",
  ),
  studioWeapon(
    "WEAPON_TACTICALRIFLE",
    "Служебный карабин",
    "Винтовки",
    dlc("mpsum2", "common/data/ai/weapon_tacticalrifle.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Service Carbine",
    true,
  ),
  studioWeapon(
    "WEAPON_BATTLERIFLE",
    "Боевая винтовка",
    "Винтовки",
    dlc("mp2023_02", "common/data/ai/weapon_battlerifle.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Battle Rifle",
  ),
  studioWeapon(
    "WEAPON_MUSKET",
    "Мушкет",
    "Винтовки",
    dlc("mpindependence", "common/data/ai/weaponMusket.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Musket",
  ),
  /* Дробовики */
  studioWeapon(
    "WEAPON_PUMPSHOTGUN",
    "Помповый дробовик",
    "Дробовики",
    null,
    vanilla("", 0.15, 0.75),
    "Pump Shotgun",
    true,
  ),
  studioWeapon(
    "WEAPON_PUMPSHOTGUN_MK2",
    "Помповый дробовик MK2",
    "Дробовики",
    dlc("mpchristmas2017", "common/data/ai/weapons_pumpshotgun_mk2.meta"),
    vanilla("", 1, 1),
    "Pump Shotgun Mk II",
  ),
  studioWeapon(
    "WEAPON_SAWNOFFSHOTGUN",
    "Обрез",
    "Дробовики",
    null,
    vanilla("", 0.15, 0.75),
    "Sawed-Off Shotgun",
    true,
  ),
  studioWeapon(
    "WEAPON_ASSAULTSHOTGUN",
    "Штурмовой дробовик",
    "Дробовики",
    null,
    vanilla("", 0.15, 0.75),
    "Assault Shotgun",
    true,
  ),
  studioWeapon(
    "WEAPON_BULLPUPSHOTGUN",
    "Булл-пап дробовик",
    "Дробовики",
    null,
    vanilla("bullet_shotgun_tracer", 0.15, 0.75),
    "Bullpup Shotgun",
    true,
  ),
  studioWeapon(
    "WEAPON_HEAVYSHOTGUN",
    "Тяжёлый дробовик",
    "Дробовики",
    dlc("mplts", "common/data/ai/weaponHeavyShotgun.meta"),
    vanilla("", 0.15, 0.75),
    "Heavy Shotgun",
    true,
  ),
  studioWeapon(
    "WEAPON_DBSHOTGUN",
    "Двуствольный дробовик",
    "Дробовики",
    dlc("mplowrider2", "common/data/ai/weaponDBShotgun.meta"),
    vanilla("", 0.15, 0.75),
    "Double Barrel Shotgun",
    true,
  ),
  studioWeapon(
    "WEAPON_AUTOSHOTGUN",
    "Автоматический дробовик",
    "Дробовики",
    dlc("mpbiker", "common/data/ai/weaponAutoShotgun.meta"),
    vanilla("", 0.15, 0.75),
    "Sweeper Shotgun",
  ),
  studioWeapon(
    "WEAPON_COMBATSHOTGUN",
    "Боевой дробовик",
    "Дробовики",
    dlc("mpheist4", "common/data/ai/weapon_combatshotgun.meta"),
    vanilla("", 0.15, 0.75),
    "Combat Shotgun",
  ),
  /* Пулемёты */
  studioWeapon(
    "WEAPON_MG",
    "Пулемёт",
    "Пулемёты",
    null,
    vanilla("bullet_tracer", 0.15, 0.75),
    "MG",
    true,
  ),
  studioWeapon(
    "WEAPON_COMBATMG",
    "Боевой пулемёт",
    "Пулемёты",
    null,
    vanilla("bullet_tracer_mg", 0.15, 0.75),
    "Combat MG",
    true,
  ),
  studioWeapon(
    "WEAPON_COMBATMG_MK2",
    "Боевой пулемёт MK2",
    "Пулемёты",
    dlc("mpgunrunning", "common/data/ai/weapons_combatmg_mk2.meta"),
    vanilla("bullet_tracer_mg", 0.15, 0.75),
    "Combat MG Mk II",
  ),
  studioWeapon(
    "WEAPON_GUSENBERG",
    "Гузенберг",
    "Пулемёты",
    dlc("mpvalentines", "common/data/ai/weaponGusenberg.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Gusenberg",
    true,
  ),
  studioWeapon(
    "WEAPON_MINIGUN",
    "Миниган",
    "Пулемёты",
    null,
    vanilla("bullet_tracer", 0.15, 0.75),
    "Minigun",
  ),
  /* Снайперские */
  studioWeapon(
    "WEAPON_SNIPERRIFLE",
    "Снайперская винтовка",
    "Снайперские",
    null,
    vanilla("bullet_tracer", 0.15, 0.75),
    "Sniper Rifle",
    true,
  ),
  studioWeapon(
    "WEAPON_HEAVYSNIPER",
    "Тяжёлая снайперская винтовка",
    "Снайперские",
    null,
    vanilla("bullet_tracer", 0.15, 0.75),
    "Heavy Sniper",
    true,
  ),
  studioWeapon(
    "WEAPON_HEAVYSNIPER_MK2",
    "Тяжёлая снайперская винтовка MK2",
    "Снайперские",
    dlc("mpgunrunning", "common/data/ai/weapons_heavysniper_mk2.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Heavy Sniper Mk II",
    true,
  ),
  studioWeapon(
    "WEAPON_MARKSMANRIFLE",
    "Марксманская винтовка",
    "Снайперские",
    dlc("mplts", "common/data/ai/weaponMarksmanRifle.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Marksman Rifle",
    true,
  ),
  studioWeapon(
    "WEAPON_MARKSMANRIFLE_MK2",
    "Марксманская винтовка MK2",
    "Снайперские",
    dlc("mpchristmas2017", "common/data/ai/weapons_marksmanrifle_mk2.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Marksman Rifle Mk II",
  ),
  studioWeapon(
    "WEAPON_PRECISIONRIFLE",
    "Высокоточная винтовка",
    "Снайперские",
    dlc("mpsum2", "common/data/ai/weapon_precisionrifle.meta"),
    vanilla("bullet_tracer", 0.15, 0.75),
    "Precision Rifle",
  ),
]);

export const STUDIO_TRACER_WEAPON_IDS = Object.freeze(
  STUDIO_TRACER_WEAPONS.map((item) => item.id),
);

/** Имя клона вспышки ствола: его номер в таблице, форма и штатная вспышка. */
export function muzzleRuleFor(weapon, donor, shape = "") {
  const index = STUDIO_TRACER_WEAPON_IDS.indexOf(weapon);
  if (index < 0) throw new Error(`Неизвестный ствол для вспышки: ${weapon}`);
  return muzzleCloneName(index, donor, shape);
}

/** Имя клона дыма ствола: его номер в таблице и штатный дым-донор. */
export function smokeRuleFor(weapon, donor) {
  const index = STUDIO_TRACER_WEAPON_IDS.indexOf(weapon);
  if (index < 0) throw new Error(`Неизвестный ствол для дыма: ${weapon}`);
  return smokeCloneName(index, donor);
}

const studioWeaponById = new Map(
  STUDIO_TRACER_WEAPONS.map((item) => [item.id, item]),
);

export const findStudioTracerWeapon = (id) =>
  studioWeaponById.get(String(id || "")) || null;

/*
 * Пакеты первого года лежат не папками в `update/x64/dlcpacks/`, а вложены в
 * `x64w.rpf` (`dlcpacks/<пакет>/dlc.rpf`): `platform:/dlcPacks/` в
 * dlclist.xml. Нужны только как запасной источник файла — у всех их стволов
 * есть `dlc_patch` в update.rpf.
 */
const PLATFORM_DLC_PACKS = new Set([
  "mpbeach",
  "mpbusiness",
  "mpchristmas",
  "mpvalentines",
  "mpbusiness2",
  "mphipster",
  "mpindependence",
  "mppilot",
  "spupgrade",
  "mplts",
]);

/**
 * Откуда установка берёт описание ствола и куда кладёт правленое.
 *
 *  • `kind: "base"` — `weapons.meta` в update.rpf, как у каталога;
 *  • `kind: "dlc"` — файл пакета: `patch` — адрес в update.rpf, который игра
 *    читает первым (его и пишем); `archive` и `packEntry` — где лежит сам
 *    файл пакета, если в update.rpf его ещё нет.
 */
export function tracerWeaponSource(id) {
  const weapon = findStudioTracerWeapon(id);
  if (!weapon) return null;
  if (!weapon.source)
    return Object.freeze({ kind: "base", entry: TRACER_BASE_WEAPONS_ENTRY });
  const { pack, entry } = weapon.source;
  const platform = PLATFORM_DLC_PACKS.has(pack);
  return Object.freeze({
    kind: "dlc",
    pack,
    entry,
    patch: `dlc_patch/${pack}/${entry}`,
    archive: platform ? "x64w.rpf" : `update/x64/dlcpacks/${pack}/dlc.rpf`,
    packEntry: platform ? `dlcpacks/${pack}/dlc.rpf/${entry}` : entry,
  });
}

const weaponIds = new Set(TRACER_WEAPON_IDS);

function boundedText(value, label, min, max) {
  const result = String(value || "").trim();
  if (result.length < min || result.length > max) {
    throw new Error(`${label}: допустимо от ${min} до ${max} символов.`);
  }
  return result;
}

export function normalizeTracerWeapons(mode, values = []) {
  if (mode === "all")
    return [...TRACER_WEAPON_IDS].sort((a, b) => a.localeCompare(b));
  const source = (Array.isArray(values) ? values : []).map(String);
  const result = [...new Set(source)].filter((item) => weaponIds.has(item));
  if (!result.length) throw new Error("Выберите хотя бы одно оружие.");
  if (result.length !== new Set(source).size) {
    throw new Error("Список оружия содержит неизвестные идентификаторы.");
  }
  return result.sort((a, b) => a.localeCompare(b));
}

export function inspectDds(input) {
  const bytes =
    input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (bytes.byteLength < 128 || bytes.byteLength > MAX_TRACER_DDS_BYTES) {
    throw new Error("DDS должен занимать от 128 байт до 8 МБ.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint8(0) !== 0x44 ||
    view.getUint8(1) !== 0x44 ||
    view.getUint8(2) !== 0x53 ||
    view.getUint8(3) !== 0x20 ||
    view.getUint32(4, true) !== 124 ||
    view.getUint32(76, true) !== 32
  ) {
    throw new Error("Файл не является корректным DDS.");
  }
  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  const mipLevels = Math.max(1, view.getUint32(28, true));
  if (!width || !height || width > 4096 || height > 4096 || mipLevels > 16) {
    throw new Error("DDS содержит неподдерживаемые размеры или mip-уровни.");
  }
  const fourCC = String.fromCharCode(
    view.getUint8(84),
    view.getUint8(85),
    view.getUint8(86),
    view.getUint8(87),
  ).replace(/\0/g, "");
  const allowed = new Set([
    "DXT1",
    "DXT3",
    "DXT5",
    "ATI1",
    "ATI2",
    "BC4U",
    "BC5U",
    "DX10",
    "",
  ]);
  if (!allowed.has(fourCC))
    throw new Error(`DDS FourCC ${fourCC} не поддерживается.`);
  return Object.freeze({
    width,
    height,
    mipLevels,
    format: fourCC || `RGBA-${view.getUint32(88, true)}`,
    bytes: bytes.byteLength,
  });
}

export function assertTracerDdsLayout(inspection) {
  for (const [field, expected] of Object.entries(
    ASTRAL_TRACER_TEXTURE_LAYOUT,
  )) {
    if (inspection?.[field] !== expected) {
      throw new Error(
        `DDS трассера должен иметь ${field}=${expected}; получено ${inspection?.[field] ?? "неизвестно"}.`,
      );
    }
  }
  return inspection;
}

export function inspectCover(input) {
  const bytes =
    input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (!bytes.byteLength || bytes.byteLength > MAX_TRACER_COVER_BYTES) {
    throw new Error("Обложка должна занимать не более 8 МБ.");
  }
  const png =
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47].every((v, i) => bytes[i] === v);
  const jpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const webp =
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!png && !jpeg && !webp)
    throw new Error("Обложка должна быть PNG, JPEG или WebP.");
  return Object.freeze({
    extension: png ? "png" : jpeg ? "jpg" : "webp",
    bytes: bytes.byteLength,
  });
}

export function normalizeTracerDraft(input = {}) {
  const targetMode = input.targetMode === "all" ? "all" : "selected";
  const weapons = normalizeTracerWeapons(targetMode, input.weapons);
  const chanceSP = Number(input.chanceSP ?? 1);
  const chanceMP = Number(input.chanceMP ?? 1);
  if (
    ![chanceSP, chanceMP].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    )
  ) {
    throw new Error("Шанс трассера должен находиться в диапазоне 0…1.");
  }
  return Object.freeze({
    name: boundedText(input.name, "Название", 3, 80),
    description: boundedText(input.description, "Описание", 10, 500),
    author: boundedText(input.author, "Автор", 2, 80),
    version: /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(
      String(input.version || ""),
    )
      ? String(input.version)
      : "1.0.0",
    targetMode,
    weapons,
    chanceSP,
    chanceMP,
    rightsSource: ["owner", "permission", "license"].includes(
      input.rightsSource,
    )
      ? input.rightsSource
      : "owner",
    rightsConfirmed: input.rightsConfirmed === true,
  });
}

export function tracerSlots(weapons) {
  return weapons.map((id) => `tracer-${id.toLowerCase()}`);
}

export const TRACER_RPF_ENTRIES = Object.freeze([
  Object.freeze({
    role: "core",
    entry: "x64/patch/data/effects/ptfx.rpf/core.ypt",
  }),
  Object.freeze({
    role: "core",
    entry: "x64/patch/data/effects/ptfx_hi.rpf/core.ypt",
  }),
  Object.freeze({
    role: "core",
    entry: "x64/patch/data/effects/ptfx_lo.rpf/core.ypt",
  }),
  Object.freeze({ role: "weapons", entry: "common/data/ai/weapons.meta" }),
]);

/* `core` — путь установки: ядро игрока (каталог) или системное ядро. */
export function tracerMergeDescriptor(draft, role, core = "player") {
  const player = core === "player";
  return Object.freeze({
    strategy: "astral-tracer-v1",
    role,
    schemaVersion: ASTRAL_TRACER_SCHEMA,
    coreChannel: player
      ? ASTRAL_PTFX_PLAYER_CORE_CHANNEL
      : ASTRAL_PTFX_CORE_CHANNEL,
    coreVersion: player
      ? ASTRAL_PTFX_PLAYER_CORE_VERSION
      : ASTRAL_PTFX_CORE_VERSION,
    weapons: [...draft.weapons],
    chanceSP: draft.chanceSP,
    chanceMP: draft.chanceMP,
  });
}
