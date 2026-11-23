/*
 * Своя модель ствола из `.glb` (задача 6 ТЗ 17.10.2026).
 *
 * Владелец 17.10: «Добавить возможность чтобы люди могли грузить свою glb
 * для создания гана (они выбирают ган который будут редактировать…).
 * Главное понять как работает система, чтобы люди не крашили себе игру
 * ставив модельку огромную, чтобы все работало и запускалось в игру».
 *
 * КАК ЭТО ЕДЕТ В ИГРУ. Свою модель Astral не ставит «новым оружием» —
 * оружию игры нужен его скелет: кость рукояти (`Gun_GripR`), которой его
 * держит рука, точка выстрела (`gun_muzzle`), кости обвесов (`WAPClip`,
 * `WAPSupp`, `WAPScop`, `WAPFlsh`…), затвор. Поэтому модель встаёт ВНУТРЬ
 * модели выбранного ствола игры (`<ствол>.ydr` и `<ствол>_hi.ydr` из игры
 * игрока): её прежние геометрии убираются, на их место — сетки своей модели,
 * все — на несущую кость ствола; скелет, кости и их места не трогаются
 * (хост `decorate-drawable`, запрос версии 3, `replace`). Штатный магазин
 * (отдельная модель `<ствол>_mag1.ydr`) по желанию прячется — у своей
 * модели магазин свой.
 *
 * ПОДГОНКА. Оси своей модели — какие угодно (Blender пишет Y вверх, единицы —
 * метры, сантиметры…). Подгонка (`fit`) — масштаб, поворот и сдвиг из осей
 * GLB в оси модели ствола кадра (glTF модели игры: x — вдоль ствола, дуло
 * на +x, y — вверх). `autoFit` ставит модель по габариту штатного ствола:
 * длинная сторона — вдоль ствола, тонкий конец — к дулу, длина — как у
 * штатного; дальше человек правит её рукой. В игру модель едет в той же
 * подгонке, что в кадре: одна матрица (`fitMatrix`).
 *
 * ЧТОБЫ ИГРА НЕ ПАДАЛА — пределы (`OWN_MODEL_LIMITS`) и почему они такие.
 * Замер 37 штатных стволов игры (модель в руках `_hi` с магазином):
 * треугольников 1 646…13 445 (медиана ≈ 6 000), вершин до 30 469,
 * геометрий до 11, материалов до 7, ни одной геометрии больше 4 368 вершин,
 * длина 0,19…1,16 м.
 *   • Индексы геометрии в RAGE — 16 бит: больше 65 535 вершин в одной
 *     геометрии игра читает мусором и падает. Astral режет сетки на куски
 *     не больше 4 368 вершин — как Rockstar у своих стволов; хост к тому же
 *     сам отказывает куску больше 65 535.
 *   • Модель в руках — до 40 000 треугольников (втрое тяжелее самого
 *     тяжёлого штатного пулемёта), обычная `.ydr` (ствол вдали, у других
 *     игроков) — до 10 000. Тяжелее — Astral упрощает сам (стягиванием рёбер,
 *     `mesh-simplify.js`); больше 1 000 000 треугольников на входе — честный
 *     отказ: такую модель надо упростить в редакторе.
 *   • Стример игры держит модель в памяти целиком; модели больше 16 МБ
 *     физической памяти «не прогружаются» и роняют поток. Поэтому текстуры
 *     — DXT5 со всеми мипами, сторона не больше 1024 (у дальней модели —
 *     512), картинок не больше 8, а всех вместе — не больше четырёх 1024²;
 *     вершины — до 65 000 на модель: модель в руках выходит меньше 10 МБ.
 *   • Габарит — от 5 см до 2 м по длинной стороне (самый длинный штатный
 *     ствол — 1,16 м) и не дальше 1 м от начала осей ствола: иначе ствол
 *     пропадает из кадра по рамке модели или висит в метре от руки.
 *   • Файл `.glb` — до 32 МБ (транспорт окна — 64 МБ base64).
 * Собранная модель открывается заново и сверяется (хост): число геометрий,
 * листы, кости скелета — те же имена, что у штатной, маски корзин шейдеров
 * — по корзинам самих шейдеров.
 *
 * Модуль — чистые данные и арифметика: его читают окно (что будет с моделью
 * — до «Применить»), Astral Desktop (сборка) и тесты.
 */

import { simplifyMesh, smoothNormals, weld } from "./mesh-simplify.js";
import { toRageAxes } from "./decorations.js";
import { OWN_FIT_MAX_OFFSET, fitMatrix, normalizeOwnFit, rotationRows } from "./own-fit.js";

export { readGlb } from "./glb-read.js";
export { toRageAxes };
export { OWN_FIT_MAX_OFFSET, OWN_FIT_STANDARD, OWN_MAGAZINE_MODES, fitMatrix, normalizeOwnFit, ownMagazineMode, projectOwnFit } from "./own-fit.js";

export const OWN_MODEL_LIMITS = Object.freeze({
  /* Файл .glb: транспорт окна — 64 МБ base64. */
  fileBytes: 32 * 1024 * 1024,
  /* Больше — не упрощаем: долго и тяжело по памяти, честный отказ. */
  inputTriangles: 1_000_000,
  /* Модель в руках (`_hi`) и кадр. */
  hiTriangles: 40_000,
  /* Обычная `.ydr`: ствол вдали, у других игроков. */
  lowTriangles: 10_000,
  /* Вершин в одной геометрии — как у стволов Rockstar (их предел 4 368). */
  pieceVertices: 4368,
  /* Вершин во всей модели после разрезки по кускам. */
  modelVertices: 65_000,
  /* Картинок (материалов с картинкой) в модели. */
  textures: 8,
  hiTexture: 1024,
  lowTexture: 512,
  /* Все картинки модели в руках вместе — не больше четырёх 1024². */
  hiTexels: 4 * 1024 * 1024,
  /* Цветов без картинки — в одном листе цветов 32×32 по 4×4. */
  colours: 64,
  minLength: 0.05,
  maxLength: 2,
  maxOffset: OWN_FIT_MAX_OFFSET,
});

/*
 * Обвесы игры, вшитые в модель ствола (задача 6 ТЗ 17.10.2026, вторая
 * половина): те же пределы, что у своей модели, — куски до 4 368 вершин,
 * в руках до 40 000 треугольников всех обвесов вместе, вдали — до 10 000,
 * вершин до 65 000, листы до 1024² (вдали — 512²) и все вместе не больше
 * четырёх 1024². Листов — до 10: у каждой кости свои (глушитель, прицел со
 * стеклом, фонарь, камуфляж…). Длины и сдвига нет: обвес стоит, где его
 * ставит игра.
 */
export const ATTACHMENT_LIMITS = Object.freeze({
  ...OWN_MODEL_LIMITS,
  textures: 10,
  minLength: 0,
  maxLength: 0,
  maxOffset: 0,
});

/* Своя модель на стволе (брелок, фигурка) — пределы украшения: маленькая. */
export const ATTACHED_MODEL_LIMITS = Object.freeze({
  fileBytes: 4 * 1024 * 1024,
  inputTriangles: 200_000,
  hiTriangles: 3000,
  lowTriangles: 800,
  pieceVertices: 4368,
  modelVertices: 6000,
  textures: 1,
  hiTexture: 256,
  lowTexture: 128,
  hiTexels: 256 * 256,
  colours: 64,
});

const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);
const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

/* ------------------------------ подгонка ------------------------------ */

/* Углы X·Y·Z из матрицы поворота по строкам (как `Euler.setFromRotationMatrix`). */
function eulerOf(rows) {
  const y = Math.asin(clamp(rows[0][2], -1, 1));
  let x;
  let z;
  if (Math.abs(rows[0][2]) < 0.9999999) {
    x = Math.atan2(-rows[1][2], rows[2][2]);
    z = Math.atan2(-rows[0][1], rows[0][0]);
  } else {
    x = Math.atan2(rows[2][1], rows[1][1]);
    z = 0;
  }
  const deg = (value) => round((value * 180) / Math.PI, 2) + 0;
  return { x: deg(x), y: deg(y), z: deg(z) };
}

const multiplyRows = (a, b) => a.map((row) => [0, 1, 2].map((column) => row[0] * b[0][column] + row[1] * b[1][column] + row[2] * b[2][column]));

/** Габарит сеток `[{ positions }]` (после матрицы `matrix`, если дана). */
export function meshBounds(meshes, matrix = null) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes || [])
    for (let k = 0; k < mesh.positions.length; k += 3) {
      let x = mesh.positions[k];
      let y = mesh.positions[k + 1];
      let z = mesh.positions[k + 2];
      if (matrix) {
        const tx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
        const ty = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
        const tz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
        x = tx;
        y = ty;
        z = tz;
      }
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }
  return { min, max, size: max.map((value, axis) => value - min[axis]) };
}

/**
 * Подгонка по штатному стволу: длинная сторона своей модели — вдоль ствола
 * (x), тонкий конец — к дулу (+x), длина и середина габарита — как у
 * штатного (`target` — `{ min, max }` в осях кадра). Без штатного — длина
 * 0,7 м и середина в начале осей.
 */
export function autoFit(model, target = null) {
  const raw = meshBounds(model.meshes);
  const axis = raw.size[0] >= raw.size[1] && raw.size[0] >= raw.size[2] ? 0 : raw.size[1] >= raw.size[2] ? 1 : 2;
  /* Длинная сторона — на x. */
  let rows =
    axis === 1
      ? rotationRows({ x: 0, y: 0, z: -90 })
      : axis === 2
        ? rotationRows({ x: 0, y: 90, z: 0 })
        : rotationRows({ x: 0, y: 0, z: 0 });
  /* Тонкий конец — к +x: поперечник крайних 15 % длины с обеих сторон. */
  const along = (point) => rows[0][0] * point[0] + rows[0][1] * point[1] + rows[0][2] * point[2];
  const across = (point) => [rows[1][0] * point[0] + rows[1][1] * point[1] + rows[1][2] * point[2], rows[2][0] * point[0] + rows[2][1] * point[1] + rows[2][2] * point[2]];
  let low = Infinity;
  let high = -Infinity;
  for (const mesh of model.meshes)
    for (let k = 0; k < mesh.positions.length; k += 3) {
      const a = along([mesh.positions[k], mesh.positions[k + 1], mesh.positions[k + 2]]);
      low = Math.min(low, a);
      high = Math.max(high, a);
    }
  const edge = (high - low) * 0.15;
  const ends = [
    { min: [Infinity, Infinity], max: [-Infinity, -Infinity] },
    { min: [Infinity, Infinity], max: [-Infinity, -Infinity] },
  ];
  for (const mesh of model.meshes)
    for (let k = 0; k < mesh.positions.length; k += 3) {
      const point = [mesh.positions[k], mesh.positions[k + 1], mesh.positions[k + 2]];
      const a = along(point);
      const end = a <= low + edge ? ends[0] : a >= high - edge ? ends[1] : null;
      if (!end) continue;
      const [b, c] = across(point);
      end.min[0] = Math.min(end.min[0], b);
      end.min[1] = Math.min(end.min[1], c);
      end.max[0] = Math.max(end.max[0], b);
      end.max[1] = Math.max(end.max[1], c);
    }
  const thickness = (end) => (Number.isFinite(end.min[0]) ? Math.hypot(end.max[0] - end.min[0], end.max[1] - end.min[1]) : Infinity);
  if (thickness(ends[0]) < thickness(ends[1]) * 0.9) rows = multiplyRows(rotationRows({ x: 0, y: 180, z: 0 }), rows);
  const rotation = eulerOf(rows);
  const wantedLength = target ? Math.max(0.05, target.max[0] - target.min[0]) : 0.7;
  const scale = clamp(wantedLength / Math.max(raw.size[axis], 1e-6), 0.0001, 1000);
  const turned = meshBounds(model.meshes, fitMatrix({ scale, rotation }));
  const centre = (bounds) => [0, 1, 2].map((k) => (bounds.min[k] + bounds.max[k]) / 2);
  const wanted = target ? centre(target) : [0, 0, 0];
  const have = centre(turned);
  return normalizeOwnFit({ scale, rotation, offset: { x: wanted[0] - have[0], y: wanted[1] - have[1], z: wanted[2] - have[2] } });
}

/* ------------------------------ сборка ------------------------------ */

const LODS = Object.freeze(["high", "low"]);

/*
 * Материалы для игры: с картинкой — каждый свой лист; без картинки — цветом
 * в общем листе цветов (по прозрачности — свой лист). `colourOf(index)` —
 * клетка листа цветов: 8×8 клеток по 4×4 точки в листе 32×32.
 */
function gameMaterials(model, limits) {
  const textured = [];
  const out = [];
  const colourSheets = new Map();
  const slots = model.materials.map((material, index) => {
    const alpha = material.alpha !== "opaque" || material.colour[3] < 0.999;
    if (material.image !== null && material.image !== undefined) {
      const known = textured.findIndex((item) => item.image === material.image && item.alpha === alpha && item.colour.join() === material.colour.join());
      if (known >= 0) return { sheet: textured[known].sheet, cell: null };
      const sheet = out.length;
      out.push({ kind: "image", image: material.image, colour: material.colour, alpha, cutoff: material.cutoff, materials: [index] });
      textured.push({ image: material.image, alpha, colour: material.colour, sheet });
      return { sheet, cell: null };
    }
    const key = alpha ? "alpha" : "opaque";
    if (!colourSheets.has(key)) {
      colourSheets.set(key, out.length);
      out.push({ kind: "colours", colours: [], alpha, materials: [] });
    }
    const sheet = colourSheets.get(key);
    const entry = out[sheet];
    entry.materials.push(index);
    const hex = material.colour.map((value) => Math.round(value * 255)).join(",");
    let cell = entry.colours.findIndex((colour) => colour.map((value) => Math.round(value * 255)).join(",") === hex);
    if (cell < 0) {
      if (entry.colours.length >= limits.colours) {
        /* Больше 64 цветов — ближайший из уже взятых. */
        let best = 0;
        let distance = Infinity;
        entry.colours.forEach((colour, at) => {
          const d = colour.reduce((sum, value, k) => sum + (value - material.colour[k]) ** 2, 0);
          if (d < distance) {
            distance = d;
            best = at;
          }
        });
        cell = best;
      } else {
        cell = entry.colours.length;
        entry.colours.push(material.colour);
      }
    }
    return { sheet, cell };
  });
  return { sheets: out, slots, textures: textured.length };
}

/** Середина клетки `cell` листа цветов в развёртке. */
export const colourCellUv = (cell) => [((cell % 8) * 4 + 2) / 32, (Math.floor(cell / 8) * 4 + 2) / 32];

/**
 * Что будет со своей моделью в игре — до сборки, по одному разбору GLB:
 * `{ ok, refusal, triangles, vertices, materials, textures, length,
 * high: { triangles, simplified }, low: { triangles, simplified } }`.
 * `refusal` — почему не встанет (словами), иначе `null`.
 */
export function ownModelPlan(model, fit, limits = OWN_MODEL_LIMITS) {
  const triangles = model.stats.triangles;
  const { textures } = gameMaterials(model, limits);
  const bounds = fit ? meshBounds(model.meshes, fitMatrix(fit)) : meshBounds(model.meshes);
  const length = Math.max(...bounds.size);
  /* Причины отказа: `code` и числа — окну (переводит само), `text` — по-русски хосту. */
  const reasons = [];
  const say = (code, text, values = {}) => reasons.push({ code, text, ...values });
  if (triangles > limits.inputTriangles)
    say("triangles", `в модели ${triangles.toLocaleString("ru-RU")} треугольников — больше ${limits.inputTriangles.toLocaleString("ru-RU")}, такую Astral не упрощает; упрости её в редакторе (Blender: Decimate)`, { value: triangles, limit: limits.inputTriangles });
  if (textures > limits.textures) say("textures", `картинок у модели ${textures} — больше ${limits.textures}; объедини материалы в редакторе`, { value: textures, limit: limits.textures });
  if (fit && limits.maxLength && length > limits.maxLength) say("long", `длина в игре ${round(length, 2)} м — больше ${limits.maxLength} м: уменьши масштаб`, { value: round(length, 3), limit: limits.maxLength });
  if (fit && limits.minLength && length < limits.minLength) say("short", `длина в игре ${Math.round(length * 1000)} мм — меньше ${limits.minLength * 100} см: увеличь масштаб`, { value: round(length, 3), limit: limits.minLength });
  if (fit && limits.maxOffset) {
    const far = Math.max(...bounds.min.map(Math.abs), ...bounds.max.map(Math.abs));
    if (far > limits.maxOffset + limits.maxLength) say("far", "модель стоит слишком далеко от ствола — верни её к рукояти", { value: round(far, 2) });
  }
  return {
    ok: reasons.length === 0,
    refusal: reasons.length ? reasons.map((reason) => reason.text).join("; ") : null,
    reasons,
    triangles,
    vertices: model.stats.vertices,
    materials: model.stats.materials,
    textures,
    length: round(length, 3),
    high: { triangles: Math.min(triangles, limits.hiTriangles), simplified: triangles > limits.hiTriangles },
    low: { triangles: Math.min(triangles, limits.lowTriangles), simplified: triangles > limits.lowTriangles },
  };
}

/*
 * Куски по материалу: треугольники подряд, пока вершин в куске не больше
 * предела (`pieceVertices`); индексы — 16 бит.
 */
function splitPieces(corners, limit) {
  const pieces = [];
  let current = null;
  const flush = () => {
    if (current?.indices.length) pieces.push(current);
    current = null;
  };
  for (const triangle of corners) {
    if (!current) current = { keys: new Map(), positions: [], normals: [], uvs: [], indices: [] };
    const fresh = triangle.filter((corner) => !current.keys.has(corner.key)).length;
    if (current.positions.length / 3 + fresh > limit) {
      flush();
      current = { keys: new Map(), positions: [], normals: [], uvs: [], indices: [] };
    }
    for (const corner of triangle) {
      let at = current.keys.get(corner.key);
      if (at === undefined) {
        at = current.positions.length / 3;
        current.keys.set(corner.key, at);
        current.positions.push(...corner.p);
        current.normals.push(...corner.n);
        current.uvs.push(...corner.uv);
      }
      current.indices.push(at);
    }
  }
  flush();
  return pieces.map((piece) => ({
    positions: Float32Array.from(piece.positions),
    normals: Float32Array.from(piece.normals),
    uvs: Float32Array.from(piece.uvs),
    indices: Uint16Array.from(piece.indices),
  }));
}

/**
 * Сетки своей модели для игры в осях модели ствола кадра (glTF): подгонка
 * применена, тяжёлая — упрощена до предела детализации `lod`, разрезана на
 * куски. `{ pieces: [{ sheet, positions, normals, uvs, indices }], sheets,
 * triangles, vertices, simplified, bounds }`; `sheets` — листы
 * (`{ kind: "image", image, colour, alpha }` или `{ kind: "colours",
 * colours, alpha }`). Отказ — исключение с `code` и словами.
 */
export function ownModelMeshes(model, fit, { lod = "high", limits = OWN_MODEL_LIMITS } = {}) {
  const quality = LODS.includes(lod) ? lod : "high";
  const plan = ownModelPlan(model, fit, limits);
  if (!plan.ok) {
    const error = new Error(`Своя модель не встанет в игру: ${plan.refusal}.`);
    error.code = "OWN_MODEL_LIMIT";
    throw error;
  }
  const matrix = fit ? fitMatrix(fit) : null;
  const { sheets, slots } = gameMaterials(model, limits);
  const target = quality === "low" ? limits.lowTriangles : limits.hiTriangles;
  const transform = (x, y, z) =>
    matrix
      ? [
          matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
          matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
          matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
        ]
      : [x, y, z];
  const turn = (x, y, z) => {
    if (!matrix) return [x, y, z];
    const n = [matrix[0] * x + matrix[4] * y + matrix[8] * z, matrix[1] * x + matrix[5] * y + matrix[9] * z, matrix[2] * x + matrix[6] * y + matrix[10] * z];
    const length = Math.hypot(...n) || 1;
    return n.map((value) => value / length);
  };
  const uvOf = (mesh, index, slot) =>
    slot.cell !== null ? colourCellUv(slot.cell) : mesh.uvs ? [mesh.uvs[index * 2], mesh.uvs[index * 2 + 1]] : [0, 0];

  /* Углы треугольников по листам: `{ key, p, n, uv }`. */
  const bySheet = sheets.map(() => []);
  const simplified = plan.triangles > target;
  let triangles = 0;
  if (!simplified) {
    for (const [meshIndex, mesh] of model.meshes.entries()) {
      const slot = slots[mesh.material];
      const normals = mesh.normals || smoothNormalsIndexed(mesh.positions, mesh.indices);
      for (let k = 0; k + 2 < mesh.indices.length; k += 3) {
        const corners = [0, 1, 2].map((j) => {
          const index = mesh.indices[k + j];
          return {
            key: `${meshIndex}:${index}`,
            p: transform(mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]),
            n: turn(normals[index * 3], normals[index * 3 + 1], normals[index * 3 + 2]),
            uv: uvOf(mesh, index, slot),
          };
        });
        bySheet[slot.sheet].push(corners);
        triangles += 1;
      }
    }
  } else {
    /* Тяжёлая модель: вся вместе — сварка по точке, упрощение, нормали заново. */
    const all = [];
    const triangleList = [];
    const uvList = [];
    const materialList = [];
    for (const mesh of model.meshes) {
      const base = all.length / 3;
      for (let k = 0; k < mesh.positions.length; k += 3) all.push(...transform(mesh.positions[k], mesh.positions[k + 1], mesh.positions[k + 2]));
      const slot = slots[mesh.material];
      for (let k = 0; k + 2 < mesh.indices.length; k += 3) {
        for (let j = 0; j < 3; j += 1) {
          const index = mesh.indices[k + j];
          triangleList.push(base + index);
          uvList.push(...uvOf(mesh, index, slot));
        }
        materialList.push(mesh.material);
      }
    }
    const welded = weld(Float64Array.from(all));
    const reduced = simplifyMesh(
      { positions: welded.positions, triangles: Int32Array.from(triangleList, (index) => welded.map[index]), uvs: Float32Array.from(uvList), materials: Int32Array.from(materialList) },
      target,
    );
    const normals = smoothNormals(reduced.positions, reduced.triangles);
    for (let t = 0; t < reduced.triangles.length / 3; t += 1) {
      const slot = slots[reduced.materials[t]];
      const corners = [0, 1, 2].map((j) => {
        const index = reduced.triangles[t * 3 + j];
        const uv = slot.cell !== null ? colourCellUv(slot.cell) : [reduced.uvs[t * 6 + j * 2], reduced.uvs[t * 6 + j * 2 + 1]];
        const n = [normals[t * 9 + j * 3], normals[t * 9 + j * 3 + 1], normals[t * 9 + j * 3 + 2]];
        return {
          key: `${index}:${n.map((value) => Math.round(value * 1000)).join(",")}:${uv.map((value) => Math.round(value * 1e5)).join(",")}`,
          p: [reduced.positions[index * 3], reduced.positions[index * 3 + 1], reduced.positions[index * 3 + 2]],
          n,
          uv,
        };
      });
      bySheet[slot.sheet].push(corners);
      triangles += 1;
    }
  }
  const pieces = [];
  for (const [sheet, corners] of bySheet.entries())
    for (const piece of splitPieces(corners, limits.pieceVertices)) pieces.push({ sheet, ...piece });
  const vertices = pieces.reduce((sum, piece) => sum + piece.positions.length / 3, 0);
  if (vertices > limits.modelVertices) {
    const error = new Error(
      `Своя модель не встанет в игру: после разрезки у неё ${vertices.toLocaleString("ru-RU")} вершин — больше ${limits.modelVertices.toLocaleString("ru-RU")}. Много швов развёртки: упрости модель или её развёртку в редакторе.`,
    );
    error.code = "OWN_MODEL_LIMIT";
    throw error;
  }
  const usedSheets = new Set(pieces.map((piece) => piece.sheet));
  return {
    pieces,
    sheets: sheets.map((sheet, index) => ({ ...sheet, used: usedSheets.has(index) })),
    triangles,
    vertices,
    simplified,
    bounds: meshBounds(pieces),
  };
}

/* Нормали сетки без своих: гладкие внутри 50°. */
function smoothNormalsIndexed(positions, indices) {
  const welded = weld(positions);
  const triangles = Int32Array.from(indices, (index) => welded.map[index]);
  const corner = smoothNormals(welded.positions, triangles);
  const out = new Float32Array(positions.length);
  for (let t = 0; t < indices.length / 3; t += 1)
    for (let j = 0; j < 3; j += 1) {
      const index = indices[t * 3 + j];
      out[index * 3] = corner[t * 9 + j * 3];
      out[index * 3 + 1] = corner[t * 9 + j * 3 + 1];
      out[index * 3 + 2] = corner[t * 9 + j * 3 + 2];
    }
  return out;
}

/**
 * Сторона листа картинки в игре: степень двойки не больше предела
 * детализации; все картинки модели в руках вместе — не больше `hiTexels`.
 * `sizes` — `[{ width, height }]` картинок по порядку листов.
 */
export function sheetSizes(sizes, { lod = "high", limits = OWN_MODEL_LIMITS } = {}) {
  const cap = lod === "low" ? limits.lowTexture : limits.hiTexture;
  const pow2 = (value) => 2 ** Math.max(2, Math.min(Math.log2(cap), Math.round(Math.log2(Math.max(4, value)))));
  const out = sizes.map(({ width, height }) => ({ width: pow2(width), height: pow2(height) }));
  const budget = lod === "low" ? limits.hiTexels / 4 : limits.hiTexels;
  for (let guard = 0; guard < 32 && out.reduce((sum, item) => sum + item.width * item.height, 0) > budget; guard += 1) {
    const biggest = out.reduce((best, item, index) => (item.width * item.height > out[best].width * out[best].height ? index : best), 0);
    out[biggest] = { width: Math.max(4, out[biggest].width / 2), height: Math.max(4, out[biggest].height / 2) };
  }
  return out;
}
