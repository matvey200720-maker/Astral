/*
 * Зоны татуировок на теле (ТЗ 04.10.2026, задача 10).
 *
 * Как игра кладёт тату. Тату — наложение педа: картинка (`<txd>.ytd`) и
 * место в XML коллекции (`*_overlays.xml`): зона тела, центр `uvPos`,
 * размер `scale`, поворот `rotation`. Зона — не развёртка кожи, а своя
 * плоскость: у каждой модели тела есть вторая развёртка (UV1), и игра
 * рисует наложения по ней.
 *
 * Кодировка UV1 разобрана по моделям `mp_m_freemode_01` из игры игрока:
 * целая часть V — номер зоны (`V ∈ [−(2z+1), −2z)`: торс −1, голова −3,
 * левая рука −5, правая −7, левая нога −9, правая −11 — порядок зон
 * повреждений педа), U лежит в `[1, 2]`. Место в зоне — `(U − 1,
 * V + 2z + 1)`: U обходит часть тела по кругу, V идёт сверху вниз (у торса
 * — от шеи к поясу, у ноги — от бедра к стопе). Вершины с UV1 = (0, 1) —
 * вне зон (ткань одежды).
 *
 * Отсюда перенос рисунка: мастерская красит тело прямо в плоскостях зон
 * (`zoneBody`), а картинка тату берёт цвет из своей зоны: точка картинки →
 * место в зоне (по её `uvPos`/`scale`/`rotation`, `tattooPlacement`) →
 * цвет нарисованного там (`projectTattoo`).
 *
 * Чистый JS: работает в окне, в главном процессе и в тестах.
 */

/* Порядок — номер зоны во второй развёртке; `key` — как её зовёт разбор
   коллекций (`@modovik/clothing/decorations`); `material` — имя материала
   зоны у тела мастерской (`zoneBody`): по нему окно печёт нарисованное. */
export const TATTOO_ZONES = Object.freeze([
  Object.freeze({ id: "ZONE_TORSO", key: "torso", label: "Торс", material: "tattoo_torso" }),
  Object.freeze({ id: "ZONE_HEAD", key: "head", label: "Голова", material: "tattoo_head" }),
  Object.freeze({ id: "ZONE_LEFT_ARM", key: "left-arm", label: "Левая рука", material: "tattoo_arm_left" }),
  Object.freeze({ id: "ZONE_RIGHT_ARM", key: "right-arm", label: "Правая рука", material: "tattoo_arm_right" }),
  Object.freeze({ id: "ZONE_LEFT_LEG", key: "left-leg", label: "Левая нога", material: "tattoo_leg_left" }),
  Object.freeze({ id: "ZONE_RIGHT_LEG", key: "right-leg", label: "Правая нога", material: "tattoo_leg_right" }),
]);

/*
 * Грим или татуировка (голос владельца 01.11.2026). В коллекциях тату игры слова «грим» нет: у всех пресетов `TYPE_TATTOO`. Настоящий грим GTA V лежит в данных персонажа (`facial-overlays.js`), и он тоже в зоне головы. Поэтому:
 * «Грим» — зона головы (грим игры и тату лица и шеи), «Татуировки» — остальное тело. Заменёнка ищется внутри той же зоны. Подробно — `docs/clothing/tattoos.md`.
 */
export const tattooKindOf = (tattoo) => (tattoo?.zone === "head" ? "makeup" : "tattoo");

/** Номер зоны по имени её материала («tattoo_arm_left»); −1 — не зона. */
export const zoneOfMaterial = (name) => {
  const wanted = String(name || "").toLowerCase();
  return TATTOO_ZONES.findIndex((zone) => zone.material === wanted);
};

/** Номер зоны по имени из XML («ZONE_TORSO») или из разбора («torso»); −1 — не зона тела. */
export const zoneIndex = (name) => {
  const wanted = String(name || "");
  return TATTOO_ZONES.findIndex(
    (zone) => zone.id === wanted.toUpperCase() || zone.key === wanted.toLowerCase(),
  );
};

/** Место во второй развёртке → `{ zone, u, v }` или `null` (вне зон). */
export function zoneUv(u, v) {
  if (!(v < 0) || !Number.isFinite(u)) return null;
  const zone = Math.floor(-v / 2);
  if (zone < 0 || zone >= TATTOO_ZONES.length) return null;
  return { zone, u: u - 1, v: v + 2 * zone + 1 };
}

/**
 * Кожа ли это со своими зонами: так у перчаток игры и модов лежит рука (`uppr_022_r`, V 0,22–0,68). Ткань зон не имеет
 * или у неё там случайные числа: автор скопировал вторую развёртку, и вершины попадают в голову и за край зоны.
 */
export function hasSkinZones(mesh) {
  const { uvs1, positions } = mesh;
  if (!uvs1 || !positions?.length) return false;
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const place = zoneUv(uvs1[vertex * 2], uvs1[vertex * 2 + 1]);
    if (!place || TATTOO_ZONES[place.zone].key === "head" || place.v < -0.001 || place.v > 1.001) return false;
  }
  return true;
}

/**
 * Место тату в зоне: точка картинки `(s, t)` (0…1, `t` вниз) → место в
 * зоне. `uvPos` — центр, `scale` — половина ширины и высоты рамки в долях
 * зоны, `rotation` — градусы.
 *
 * Обе поправки сверены с игрой (04.10):
 * - ось V у игры идёт снизу вверх, у второй развёртки — сверху вниз: центр
 *   тату на теле — `1 − uvPos.y`. Так стоят все группы салона: грудь
 *   (`y ≈ 0,61`) выше живота (0,32), плечо (0,90) выше кисти (0,25);
 * - картинка занимает `uvPos ± scale`, а не `uvPos ± scale / 2`: залитые
 *   целиком картинки «Байкера-демона» (`scale` 0,12) и «Монстра с когтями»
 *   (0,29) легли в игре рамками вдвое шире и выше, а «Крылатый череп» игры
 *   (`scale` 0,51) — во всю грудь;
 * - `rotation` поворачивает картинку против часовой стрелки, если смотреть
 *   на кожу (поворот в осях игры, где V вверх): надпись, перенесённая в
 *   «Монстра с когтями» (34,56°) с обратным знаком, легла в игре повёрнутой
 *   на 69° — вдвое.
 */
export function tattooPlacement({ uv, scale, rotation = 0 }) {
  const x = Number(uv?.x ?? 0.5);
  const y = 1 - Number(uv?.y ?? 0.5);
  const sx = 2 * Number(scale?.x ?? 0.5);
  const sy = 2 * Number(scale?.y ?? 0.5);
  /* V развёртки идёт вниз, поэтому поворот игры здесь — с обратным знаком. */
  const angle = (-Number(rotation) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return (s, t) => {
    const dx = (s - 0.5) * sx;
    const dy = (t - 0.5) * sy;
    return [x + dx * cos - dy * sin, y + dx * sin + dy * cos];
  };
}

/**
 * Картинка тату из рисунка по зонам: RGBA `width × height`. Мастерская
 * красит тело прямо в плоскостях зон (`zoneBody`), поэтому перенос точный и
 * без поиска по сетке: точка картинки → место в зоне → цвет нарисованного
 * там. `sample(zone, u, v)` — RGBA 0…255 или `null`; U по кругу части тела
 * замкнута (выборка сама берёт её по модулю). Вне зоны по V — прозрачно.
 */
export function projectTattoo({ decoration, width, height, sample }) {
  const zone =
    typeof decoration.zone === "number"
      ? decoration.zone
      : zoneIndex(decoration.zone);
  const out = new Uint8ClampedArray(width * height * 4);
  if (zone < 0) return out;
  const place = tattooPlacement(decoration);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [u, v] = place((x + 0.5) / width, (y + 0.5) / height);
      if (v < 0 || v > 1) continue;
      const colour = sample(zone, u, v);
      if (!colour) continue;
      const at = (y * width + x) * 4;
      out[at] = colour[0];
      out[at + 1] = colour[1];
      out[at + 2] = colour[2];
      out[at + 3] = colour[3];
    }
  }
  return out;
}

/**
 * Билинейная выборка из RGBA-картинки по развёртке (U вправо, V вниз).
 * `wrap` — U замкнута (плоскость зоны обходит часть тела по кругу): соседний
 * столбец у правого края — левый край, а не он сам.
 */
export function rgbaSampler(image, { wrap = false } = {}) {
  const { width, height, data } = image;
  const at = (x, y) => {
    const cx = wrap
      ? ((x % width) + width) % width
      : Math.max(0, Math.min(width - 1, x));
    const cy = Math.max(0, Math.min(height - 1, y));
    return (cy * width + cx) * 4;
  };
  return (u, v) => {
    const fx = (u - Math.floor(u)) * width - 0.5;
    const fy = Math.max(0, Math.min(1, v)) * height - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const wx = fx - x0;
    const wy = fy - y0;
    const out = [0, 0, 0, 0];
    const corners = [
      [at(x0, y0), (1 - wx) * (1 - wy)],
      [at(x0 + 1, y0), wx * (1 - wy)],
      [at(x0, y0 + 1), (1 - wx) * wy],
      [at(x0 + 1, y0 + 1), wx * wy],
    ];
    for (const [index, weight] of corners)
      for (let channel = 0; channel < 4; channel += 1)
        out[channel] += data[index + channel] * weight;
    return out.map((value) => Math.round(value));
  };
}

/*
 * Тело для тату в плоскостях зон (ТЗ 04.10.2026, задача 10).
 *
 * У модели игры кожа обеих рук (и почти целиком ног) лежит в одном и том же
 * месте развёртки кожи (UV0): нарисованное на левом плече появлялось и на
 * правом. Поэтому мастерская красит не кожу, а сами зоны тату:
 *  - подложка — части тела как есть, со своими текстурами (`astralBody`:
 *    их не красят и в них не целятся);
 *  - поверх — прозрачный рисунок: у каждой зоны свой материал
 *    (`tattoo_torso`, `tattoo_arm_left`…), развёртка — место в зоне
 *    (`zoneUv` второй развёртки). Краска ложится сюда (`astralDrawing`), и
 *    левая рука — уже не правая.
 * Нарисованное в зоне переносится в картинку тату без поиска по сетке
 * (`projectTattoo`). Ткань с зоной (боксёры, шлёпанцы у игры её имеют)
 * получает краску так же, как в игре — тату там, где у игры есть зона.
 *
 * `parts`: `[{ name, drawable, picture, noZones, zonesOnly }]` — имя части (имя текстуры кожи),
 * модель `readDrawable`, картинка кожи `{ width, height, rgba }` и зоны, которых
 * у части нет (`noZones`, ключи зон): там она только подложка. `zonesOnly` — кожа
 * вещи (перчатки): сама вещь уже в кадре, поэтому от неё нужен только рисунок.
 * Возвращает модель для `clothingModelGlb` (у материалов `astralPart`).
 *
 * Части с весами костей (`mesh.skin`, живой персонаж мастерской одежды) остаются скинованными: подложка берёт веса сетки как есть, а вершины зоны — веса тех
 * вершин, из которых выросли, — рисунок идёт за кожей, когда кости двигаются.
 */
export function zoneBody(parts, { size = 1024 } = {}) {
  const underlay = [];
  const blank = () => ({ positions: [], normals: [], uvs: [], indices: [], joints: [], weights: [], skinned: false });
  const zones = TATTOO_ZONES.map(blank);
  for (const part of parts) {
    const skin = {
      shader: part.name,
      textures: { diffuse: part.name },
      astralPart: { name: part.name, picture: part.picture || null, normal: null },
      extras: { astralBody: true, astralTattooBody: true },
    };
    for (const mesh of part.drawable?.meshes || []) {
      if (!mesh.positions || !mesh.indices) continue;
      if (!part.zonesOnly) underlay.push({
        positions: mesh.positions,
        normals: mesh.normals || null,
        uvs: mesh.uvs || null,
        indices: mesh.indices,
        material: skin,
        ...(mesh.skin ? { skin: mesh.skin } : {}),
      });
      const { positions, normals, uvs1, indices } = mesh;
      if (!uvs1) continue;
      const remaps = TATTOO_ZONES.map(() => new Map());
      for (let index = 0; index + 2 < indices.length; index += 3) {
        const corners = [indices[index], indices[index + 1], indices[index + 2]];
        const places = corners.map((corner) => zoneUv(uvs1[corner * 2], uvs1[corner * 2 + 1]));
        const zone = places[0]?.zone;
        /* Треугольник без зоны или на стыке зон — только в подложке. */
        if (!places.every((place) => place && place.zone === zone)) continue;
        if (part.noZones?.includes(TATTOO_ZONES[zone].key)) continue;
        /* Целиком за краем по U (спина через шов) — сдвигом на оборот в
           [0, 1): так его видит и кисть мастерской. */
        const turn = -Math.floor(Math.min(...places.map((place) => place.u)));
        const target = zones[zone];
        corners.forEach((corner, k) => {
          const key = `${corner}:${turn}`;
          let at = remaps[zone].get(key);
          if (at === undefined) {
            at = target.positions.length / 3;
            target.positions.push(
              positions[corner * 3],
              positions[corner * 3 + 1],
              positions[corner * 3 + 2],
            );
            if (normals)
              target.normals.push(
                normals[corner * 3],
                normals[corner * 3 + 1],
                normals[corner * 3 + 2],
              );
            target.uvs.push(places[k].u + turn, places[k].v);
            /* Веса — те же, что у исходной вершины; сетка без весов — вершина на корне (вес 1), чтобы у видеокарты не было нулевых весов. */
            if (mesh.skin) {
              target.skinned = true;
              for (let slot = 0; slot < 4; slot += 1) {
                target.joints.push(mesh.skin.joints[corner * 4 + slot]);
                target.weights.push(mesh.skin.weights[corner * 4 + slot]);
              }
            } else {
              target.joints.push(0, 0, 0, 0);
              target.weights.push(1, 0, 0, 0);
            }
            remaps[zone].set(key, at);
          }
          target.indices.push(at);
        });
      }
    }
  }
  const drawing = [];
  zones.forEach((target, zone) => {
    if (!target.indices.length) return;
    const { material, key } = TATTOO_ZONES[zone];
    const count = target.positions.length / 3;
    drawing.push({
      positions: new Float32Array(target.positions),
      normals:
        target.normals.length === target.positions.length
          ? new Float32Array(target.normals)
          : null,
      uvs: new Float32Array(target.uvs),
      indices: count > 65535 ? new Uint32Array(target.indices) : new Uint16Array(target.indices),
      ...(target.skinned ? { skin: { joints: new Uint16Array(target.joints), weights: new Float32Array(target.weights) } } : {}),
      material: {
        shader: material,
        textures: { diffuse: material },
        alphaMode: "blend",
        /* Рисунок по зоне начинается пустым: кожа — в подложке. */
        astralPart: {
          name: material,
          picture: { width: size, height: size, rgba: new Uint8ClampedArray(size * size * 4) },
          normal: null,
        },
        extras: { astralDrawing: true, astralTattooBody: true, astralTattooZone: key },
      },
    });
  });
  return { name: "tattoo-body", meshes: [...underlay, ...drawing], embeddedTextures: [] };
}
