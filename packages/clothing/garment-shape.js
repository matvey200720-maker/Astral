/*
 * Крой вещи по её модели (фикс 5 ТЗ 07.10.2026).
 *
 * Название вещи говорит о крое не всегда: у вещей игры без ярлыка магазина
 * имя — «Верх №212», у модов — что придумал автор. А крой — это то, что
 * ломает заменёнку: футболка на месте худи ляжет на руки и нижний слой,
 * которые сервер выдал к худи («Замена», `garment-kinds.js`). Поэтому крой
 * снимается и с самой модели — она есть и у вещи из игры, и у вещи
 * каталога, и у своей модели человека.
 *
 * Модель — в осях показа (glTF: X — вбок, Y — вверх, Z — вперёд), в позе
 * привязки свободного персонажа: начало координат у таза, ворот верха — на
 * высоте ~0,57–0,63 м. Замерено по вещам игры с известным кроем:
 *   футболка «Happy Moon»   — размах рукавов 0,33 м, верх 0,57 м;
 *   рубашка с коротким рук. — 0,33 м, 0,61 м;
 *   спортивная майка        — 0,445 м (рукав до середины плеча);
 *   водолазка, олимпийки    — 0,52–0,54 м, 0,61–0,63 м;
 *   худи с надетым капюшоном — 0,56 м, верх 0,84–0,85 м: 250–470 вершин выше
 *   0,66 м (у остальных — 0–8).
 * Лежащий на спине капюшон по геометрии от воротника олимпийки не отличить —
 * его узнаёт название («толстовка», «с капюшоном», `garment-kinds.js`).
 *
 *   garmentShape(drawable, component) → {
 *     vertices, placeholder,             // пустышка: четырёхугольник в стороне от тела
 *     reach, top, bottom,                // размах рукавов, верх и низ, м
 *     sleeve: "none" | "short" | "long", // у верха
 *     hood: boolean,                     // у верха
 *   }
 */

/* Пустышка: у настоящей вещи сотни вершин, у пустышки — одна плашка (4
   вершины) далеко от тела (x, z ≈ 2,4–4,9 м). */
const MIN_VERTICES = 12;
const FAR_FROM_BODY = 1.0;

/* Рукава по размаху |X|: майка — плечи, футболка — до локтя, длинный — до кисти. */
const SLEEVE_SHORT = 0.28;
const SLEEVE_LONG = 0.48;

/* Капюшон: вершины позади шеи выше ворота. Ворот самой высокой рубашки и
   водолазки — до ~0,63 м, капюшон (лежащий или надетый) — выше и сзади. */
const HOOD_MIN_Y = 0.66;
const HOOD_BEHIND_Z = -0.02;
const HOOD_MIN_SHARE = 0.01;

const TOPS = new Set(["jbib", "accs", "task"]);

export function garmentShape(drawable, component = "") {
  let vertices = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of drawable?.meshes || []) {
    const p = mesh.positions || [];
    for (let i = 0; i + 2 < p.length; i += 3) {
      vertices += 1;
      for (let k = 0; k < 3; k += 1) {
        if (p[i + k] < min[k]) min[k] = p[i + k];
        if (p[i + k] > max[k]) max[k] = p[i + k];
      }
    }
  }
  if (!vertices) return { vertices: 0, placeholder: true };
  const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const placeholder = vertices < MIN_VERTICES || Math.hypot(centre[0], centre[2]) > FAR_FROM_BODY;
  const round = (value) => Math.round(value * 1000) / 1000;
  const shape = {
    vertices,
    placeholder,
    reach: round(Math.max(Math.abs(min[0]), Math.abs(max[0]))),
    top: round(max[1]),
    bottom: round(min[1]),
  };
  if (placeholder || !TOPS.has(String(component))) return shape;
  shape.sleeve = shape.reach < SLEEVE_SHORT ? "none" : shape.reach < SLEEVE_LONG ? "short" : "long";
  let hooded = 0;
  for (const mesh of drawable.meshes || []) {
    const p = mesh.positions || [];
    for (let i = 0; i + 2 < p.length; i += 3)
      if (p[i + 1] > HOOD_MIN_Y && p[i + 2] < HOOD_BEHIND_Z && Math.abs(p[i]) < 0.16) hooded += 1;
  }
  shape.hood = hooded / vertices >= HOOD_MIN_SHARE;
  return shape;
}

const SLEEVE_WORDS = Object.freeze({ none: "без рукавов", short: "короткий рукав", long: "длинный рукав" });

/**
 * Совместимость кроя по моделям: `"yes" | "no" | "unknown"`. Разный рукав
 * (сервер к вещи выдаёт свои руки) или капюшон у одной из двух — «нет».
 */
export function shapeFit(source, target) {
  if (!source || !target || source.placeholder || target.placeholder) return "unknown";
  if (!source.sleeve || !target.sleeve) return "unknown";
  if (source.sleeve !== target.sleeve) return "no";
  if (Boolean(source.hood) !== Boolean(target.hood)) return "no";
  return "yes";
}

/** Почему нельзя — словами для строки списка (пусто, если можно). */
export function shapeRefusal(source, target) {
  if (shapeFit(source, target) !== "no") return "";
  if (source.sleeve !== target.sleeve)
    return `У вещи на сервере ${SLEEVE_WORDS[target.sleeve]}, а у твоей — ${SLEEVE_WORDS[source.sleeve]}: руки под ней будут чужие и «забагаются».`;
  return target.hood
    ? "У вещи на сервере капюшон, а у твоей его нет: капюшон и волосы лягут неправильно."
    : "У твоей вещи капюшон, а у вещи на сервере его нет: капюшон пройдёт сквозь голову.";
}

/** Крой словами для подписи: «длинный рукав, капюшон». */
export function shapeLabel(shape) {
  if (!shape?.sleeve) return "";
  return [SLEEVE_WORDS[shape.sleeve], shape.hood && "капюшон"].filter(Boolean).join(", ");
}
