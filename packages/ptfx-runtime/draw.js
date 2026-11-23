/*
 * Сборка спрайтов частиц под камеру — то, что в игре делает процессор перед
 * `ptfx_sprite`: оси спрайта по режиму выравнивания, края по `tblr`, растяжка
 * по скорости, кадр листа, параметры шейдера из переменных правила.
 *
 * Выход — пачки по событиям (одно правило частиц — одна текстура и одна
 * техника), с атрибутами экземпляров в `Float32Array` и частицами,
 * отсортированными от дальних к ближним, как требует обычное смешение.
 */

import { cross, normalize, rotationMatrix } from "./math.js";
import { unitHash } from "./random.js";

export const ATTRIBUTE_SIZES = Object.freeze({
  iCorner: 3,
  iEdgeU: 3,
  iEdgeV: 3,
  iNormal: 3,
  iUvA: 4,
  iUvB: 4,
  iColour: 4,
  iParams: 4,
  iShape: 4,
  iLight: 4,
});

const DEG = Math.PI / 180;

/*
 * Значения переменных `ptfx_sprite` по умолчанию — из аннотаций самого
 * шейдера игры (common.rpf/shaders/win32_40_final/ptfx_sprite.fxc). Пустая
 * дорожка или отсутствующая переменная означает именно их: у правила
 * `blood_entry_blood_dust` мягкость пуста, и с нулём частицы не было бы
 * видно вовсе, а в игре она видна. Отсюда же — что суперальфа по умолчанию
 * удваивает альфу, а загиб нормали полный.
 */
export const SHADER_DEFAULTS = Object.freeze({
  softness: 2,
  superalpha: 2,
  shadowamount: 1,
  camerashrink: 2,
  normalarc: 1,
  dirnormalbias: 0,
  wraplightingterm: 0,
  directionalmult: 1,
  ambientmult: 1,
  extralightmult: 1,
  camerabias: 0,
  softnesscurve: 0,
  softnessshadowmult: 0,
  softnessshadowoffset: 0,
  normalmapmult: 1,
});

/* Параметр шейдера правила: вектор (x) или дорожка по доле жизни. */
export function shaderValue(rule, name, t, fallback = SHADER_DEFAULTS[name] ?? 0) {
  const variable = rule.shaderVars.get(name);
  if (!variable) return fallback;
  if (variable.type === "Keyframe") {
    const keys = variable.keys;
    if (!keys?.length) return fallback;
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i += 1) {
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1];
        const [t1, v1] = keys[i];
        return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
      }
    }
    return keys[keys.length - 1][1];
  }
  return variable.value?.[0] ?? fallback;
}

function frameRect(frame, grid, flipU, flipV, out, offset) {
  const columns = Math.max(1, grid?.columns || 1);
  const rows = Math.max(1, grid?.rows || 1);
  const total = columns * rows;
  const index = ((frame % total) + total) % total;
  const column = index % columns;
  const row = Math.floor(index / columns);
  let u0 = column / columns;
  let u1 = (column + 1) / columns;
  let v0 = row / rows;
  let v1 = (row + 1) / rows;
  if (flipU) [u0, u1] = [u1, u0];
  if (flipV) [v0, v1] = [v1, v0];
  out[offset] = u0;
  out[offset + 1] = v0;
  out[offset + 2] = u1;
  out[offset + 3] = v1;
}

/**
 * Пачки спрайтов эффекта под камеру.
 *
 * `camera` — `{ position, right, up }` (мир); `textures` — функция
 * `(name) → { texture, columns, rows } | null`; `key` — префикс ключей пачек
 * (у сцены несколько эффектов разом).
 */
export function spriteBatches(effect, camera, textures, key = "fx") {
  const batches = [];
  const toCamera = [0, 0, 0];
  const right = [0, 0, 0];
  const up = [0, 0, 0];
  for (const slot of effect.slots()) {
    const rule = slot.rule;
    /* Модели и ленты — своими сборками (`modelBatches`, `trailBatches`). */
    if (rule.drawType !== 0) continue;
    const sprite = rule.behaviours.find((item) => item.type === "Sprite");
    if (!sprite) continue;
    const textureName = rule.textures.diffuse;
    const found = textureName ? textures(textureName) : null;
    const texture = found || textures(null);
    if (!texture) continue;
    const particles = slot.particles
      .map((particle) => {
        const dx = particle.position[0] - camera.position[0];
        const dy = particle.position[1] - camera.position[1];
        const dz = particle.position[2] - camera.position[2];
        return { particle, distance: dx * dx + dy * dy + dz * dz };
      })
      .sort((a, b) => b.distance - a.distance);
    const count = particles.length;
    const attributes = {};
    for (const [name, size] of Object.entries(ATTRIBUTE_SIZES))
      attributes[name] = new Float32Array(count * size);
    const align = Number(sprite.AlignmentMode) || 0;
    const frame = effect.frame;
    /* Ось выравнивания режима 2 — из пространства эффекта в мир. */
    let axis = null;
    if (align === 2 && Array.isArray(sprite.AlignAxis)) {
      const [ax, ay, az] = sprite.AlignAxis.map(Number);
      const world = [
        frame.x[0] * ax + frame.y[0] * ay + frame.z[0] * az,
        frame.x[1] * ax + frame.y[1] * ay + frame.z[1] * az,
        frame.x[2] * ax + frame.y[2] * ay + frame.z[2] * az,
      ];
      if (Math.hypot(world[0], world[1], world[2]) > 1e-6) axis = normalize(world, world);
    }
    particles.forEach(({ particle }, index) => {
      const t = Math.min(particle.age / particle.life, 1);
      const [x, y, z] = particle.position;
      toCamera[0] = camera.position[0] - x;
      toCamera[1] = camera.position[1] - y;
      toCamera[2] = camera.position[2] - z;
      normalize(toCamera, toCamera);
      const speed = Math.hypot(particle.velocity[0], particle.velocity[1], particle.velocity[2]);
      if (align === 1 && speed > 1e-4) {
        /* По скорости: длинная ось спрайта — вдоль полёта, лицом к камере. */
        up[0] = particle.velocity[0] / speed;
        up[1] = particle.velocity[1] / speed;
        up[2] = particle.velocity[2] / speed;
        cross(right, up, toCamera);
        if (Math.hypot(right[0], right[1], right[2]) < 1e-5) {
          right[0] = camera.right[0];
          right[1] = camera.right[1];
          right[2] = camera.right[2];
        }
        normalize(right, right);
        /*
         * Поворот частицы (`Rotation`) — вокруг взгляда и в этом режиме. Все вспышки дула (`muz_assault_flare`, `muz_pistol_flare`, `muz_smg_flare_fp`,
         * `muz_minigun`, `muz_tank`) стоят в нём с начальным углом около −90° и длинным правым краем (`tblr` лево 0,3–0,45, право 1,15–2,1): поворот кладёт
         * этот край вдоль полёта, и пламя уходит вперёд по стволу, как в игре (проба 25.10.2026: с боку вспышка тянется вдоль ствола). Без поворота
         * длинная сторона вспышки шла поперёк ствола, вверх. Угол в игре считается по часовой, как видно с камеры: −90° ведёт правый край вперёд.
         */
        const turn = (particle.angle[0] || 0) * DEG;
        if (turn) {
          const c = Math.cos(turn);
          const s = Math.sin(turn);
          for (let k = 0; k < 3; k += 1) {
            const r = right[k];
            const u = up[k];
            right[k] = r * c - u * s;
            up[k] = r * s + u * c;
          }
        }
      } else if (align === 2 && axis) {
        /*
         * По оси правила (`AlignAxis`, пространство эффекта): длинная сторона
         * спрайта — вдоль оси, лицом к камере он поворачивается вокруг неё.
         */
        up[0] = axis[0];
        up[1] = axis[1];
        up[2] = axis[2];
        cross(right, up, toCamera);
        if (Math.hypot(right[0], right[1], right[2]) < 1e-5) {
          right[0] = camera.right[0];
          right[1] = camera.right[1];
          right[2] = camera.right[2];
        }
        normalize(right, right);
      } else {
        /* Лицом к камере, повёрнут на угол частицы вокруг взгляда. */
        const angle = (particle.angle[0] || 0) * DEG;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        for (let k = 0; k < 3; k += 1) {
          right[k] = camera.right[k] * c + camera.up[k] * s;
          up[k] = -camera.right[k] * s + camera.up[k] * c;
        }
      }
      /*
       * Ужатие у камеры (camerashrink, покадрово): спрайт вблизи камеры
       * сжимается к центру и во столько же раз бледнеет — в шейдере игры это
       * один множитель на отступ угла от центра и на альфу вершины.
       */
      const cameraDistance = Math.hypot(
        camera.position[0] - x,
        camera.position[1] - y,
        camera.position[2] - z,
      );
      /* Ноль у правила — ужатия нет вовсе: так заданы бабочки и лепестки
         Rockstar (`ent_amb_butterflys_swarm`, `ent_amb_cherry_bloss`), и в
         игре они видны на любом расстоянии. Множитель ноль сжал бы их в
         точку. */
      const shrinkFactor = shaderValue(rule, "camerashrink", t);
      const shrink = shrinkFactor > 0 ? Math.min(Math.max(cameraDistance * shrinkFactor, 0), 1) : 1;
      const width = particle.size[0] * shrink;
      const height = (particle.size[1] || particle.size[0]) * shrink;
      const [tt, tb, tl, tr] = particle.tblr;
      const [vt, vb, vl, vr] = particle.tblrVel;
      const top = (height / 2) * tt + speed * vt * shrink;
      const bottom = (height / 2) * tb + speed * vb * shrink;
      const left = (width / 2) * tl + speed * vl * shrink;
      const rightExtent = (width / 2) * tr + speed * vr * shrink;
      const o3 = index * 3;
      attributes.iCorner[o3] = x - right[0] * left - up[0] * bottom;
      attributes.iCorner[o3 + 1] = y - right[1] * left - up[1] * bottom;
      attributes.iCorner[o3 + 2] = z - right[2] * left - up[2] * bottom;
      attributes.iEdgeU[o3] = right[0] * (left + rightExtent);
      attributes.iEdgeU[o3 + 1] = right[1] * (left + rightExtent);
      attributes.iEdgeU[o3 + 2] = right[2] * (left + rightExtent);
      attributes.iEdgeV[o3] = up[0] * (top + bottom);
      attributes.iEdgeV[o3 + 1] = up[1] * (top + bottom);
      attributes.iEdgeV[o3 + 2] = up[2] * (top + bottom);
      attributes.iNormal[o3] = toCamera[0];
      attributes.iNormal[o3 + 1] = toCamera[1];
      attributes.iNormal[o3 + 2] = toCamera[2];
      const o4 = index * 4;
      const grid = found || { columns: 1, rows: 1 };
      frameRect(particle.frame, grid, particle.flipU, particle.flipV, attributes.iUvA, o4);
      frameRect(particle.frame + 1, grid, particle.flipU, particle.flipV, attributes.iUvB, o4);
      attributes.iColour[o4] = particle.colour[0];
      attributes.iColour[o4 + 1] = particle.colour[1];
      attributes.iColour[o4 + 2] = particle.colour[2];
      attributes.iColour[o4 + 3] = particle.colour[3];
      attributes.iParams[o4] = particle.frameBlend;
      attributes.iParams[o4 + 1] = particle.emissive;
      attributes.iParams[o4 + 2] = shaderValue(rule, "softness", t);
      /* Суперальфа — множитель альфы вершины; насыщение — после текстуры. */
      attributes.iParams[o4 + 3] = shaderValue(rule, "superalpha", t) * shrink;
      attributes.iShape[o4] = shaderValue(rule, "normalarc", t);
      attributes.iShape[o4 + 1] = shaderValue(rule, "camerabias", t);
      attributes.iShape[o4 + 2] = shaderValue(rule, "softnesscurve", t);
      attributes.iShape[o4 + 3] = 0;
      attributes.iLight[o4] = shaderValue(rule, "wraplightingterm", t);
      attributes.iLight[o4 + 1] = shaderValue(rule, "directionalmult", t);
      attributes.iLight[o4 + 2] = shaderValue(rule, "ambientmult", t);
      attributes.iLight[o4 + 3] = shaderValue(rule, "extralightmult", t);
    });
    const technique = rule.shader.technique || "";
    batches.push({
      key: `${key}:${slot.event.index}:${rule.name}`,
      texture: texture.texture,
      technique: {
        lit: rule.shader.lit,
        soft: rule.shader.soft,
        rgbOnly: /^RGB(_|$)/.test(technique),
      },
      additive: rule.render.blendSet === 1,
      softShadowMult: shaderValue(rule, "softnessshadowmult", 0),
      softShadowOffset: shaderValue(rule, "softnessshadowoffset", 0),
      alphaCutoff: rule.shaderVars.get("alphacutoffminmax")?.value?.slice(0, 3) || [0, 1, 1],
      count,
      attributes,
    });
  }
  return batches;
}

/**
 * Модели частиц (ptxd_Model) — экземпляры сеток словаря эффектов.
 *
 * Частица выбирает одну из моделей своего правила (случайно, по своему
 * зерну), стоит в своей точке, повёрнута на свои углы (градусы, как у
 * `ptxu_Rotation`) и растянута на свой размер `whd` (с множителем эмиттера и
 * масштабом эффекта). Цвет частицы красит текстуру модели так же, как
 * `colorize` в шейдере `ptfx_model` игры.
 *
 * Выход — пачки по правилу и модели: матрицы экземпляров (по столбцам, как
 * в WebGL) и цвет.
 */
export function modelBatches(effect, key = "fx") {
  const batches = [];
  for (const slot of effect.slots()) {
    const rule = slot.rule;
    if (rule.drawType !== 1 || !rule.drawables.length) continue;
    const groups = new Map();
    for (const particle of slot.particles) {
      if (!(particle.size[0] > 0)) continue;
      const pick = Math.floor(unitHash(particle.seed, 0x6d0d) * rule.drawables.length);
      const drawable = rule.drawables[Math.min(pick, rule.drawables.length - 1)].name;
      let group = groups.get(drawable);
      if (!group) groups.set(drawable, (group = []));
      group.push(particle);
    }
    for (const [drawable, particles] of groups) {
      const count = particles.length;
      const matrices = new Float32Array(count * 16);
      const colours = new Float32Array(count * 4);
      particles.forEach((particle, index) => {
        const r = rotationMatrix(particle.angle);
        const [sx, sy, sz] = [particle.size[0], particle.size[1] || particle.size[0], particle.size[2] || particle.size[0]];
        const o = index * 16;
        matrices[o] = r[0] * sx;
        matrices[o + 1] = r[3] * sx;
        matrices[o + 2] = r[6] * sx;
        matrices[o + 4] = r[1] * sy;
        matrices[o + 5] = r[4] * sy;
        matrices[o + 6] = r[7] * sy;
        matrices[o + 8] = r[2] * sz;
        matrices[o + 9] = r[5] * sz;
        matrices[o + 10] = r[8] * sz;
        matrices[o + 12] = particle.position[0];
        matrices[o + 13] = particle.position[1];
        matrices[o + 14] = particle.position[2];
        matrices[o + 15] = 1;
        colours.set(particle.colour.slice(0, 4), index * 4);
      });
      batches.push({
        key: `${key}:${slot.event.index}:${rule.name}:${drawable}`,
        drawable,
        count,
        matrices,
        colours,
        additive: rule.render.blendSet === 1,
        depthWrite: rule.render.depthWrite,
      });
    }
  }
  return batches;
}

/**
 * Ленты частиц (ptxd_Trail) — полоса через частицы одного события в порядке
 * рождения, лицом к камере.
 *
 * Ширина ленты — высота размера частицы (`whd` по Y: у лент игры X пуст),
 * цвет — цвет частицы в её точке. Лист идёт вдоль ленты по доле жизни точки
 * (`WrapTextureOverParticleLife`) или по порядку точек; поперёк — от края до
 * края.
 */
export function trailBatches(effect, camera, textures, key = "fx") {
  const batches = [];
  for (const slot of effect.slots()) {
    const rule = slot.rule;
    if (rule.drawType !== 2) continue;
    const trail = rule.behaviours.find((item) => item.type === "Trail");
    if (!trail || Number(trail.DisableDraw) === 1) continue;
    const points = slot.particles.filter((particle) => particle.alive).sort((a, b) => a.id - b.id);
    if (points.length < 2) continue;
    const found = rule.textures.diffuse ? textures(rule.textures.diffuse) : null;
    const texture = found || textures(null);
    if (!texture) continue;
    const count = points.length;
    const positions = new Float32Array(count * 2 * 3);
    const uvs = new Float32Array(count * 2 * 2);
    const colours = new Float32Array(count * 2 * 4);
    const wrap = Number(trail.WrapTextureOverParticleLife) === 1;
    const side = [0, 0, 0];
    const tangent = [0, 0, 0];
    const toCamera = [0, 0, 0];
    points.forEach((particle, index) => {
      const previous = points[Math.max(0, index - 1)].position;
      const next = points[Math.min(count - 1, index + 1)].position;
      tangent[0] = next[0] - previous[0];
      tangent[1] = next[1] - previous[1];
      tangent[2] = next[2] - previous[2];
      normalize(tangent, tangent);
      toCamera[0] = camera.position[0] - particle.position[0];
      toCamera[1] = camera.position[1] - particle.position[1];
      toCamera[2] = camera.position[2] - particle.position[2];
      normalize(toCamera, toCamera);
      cross(side, tangent, toCamera);
      if (Math.hypot(side[0], side[1], side[2]) < 1e-5) {
        side[0] = camera.up[0];
        side[1] = camera.up[1];
        side[2] = camera.up[2];
      }
      normalize(side, side);
      const half = (particle.size[1] || particle.size[0]) / 2;
      for (let edge = 0; edge < 2; edge += 1) {
        const sign = edge === 0 ? -1 : 1;
        const o = (index * 2 + edge) * 3;
        positions[o] = particle.position[0] + side[0] * half * sign;
        positions[o + 1] = particle.position[1] + side[1] * half * sign;
        positions[o + 2] = particle.position[2] + side[2] * half * sign;
        const u = wrap ? Math.min(particle.age / particle.life, 1) : index / (count - 1);
        uvs[(index * 2 + edge) * 2] = Number(trail.FlipU) === 1 ? 1 - u : u;
        uvs[(index * 2 + edge) * 2 + 1] = Number(trail.FlipV) === 1 ? 1 - edge : edge;
        colours.set(particle.colour.slice(0, 4), (index * 2 + edge) * 4);
      }
    });
    const indices = [];
    for (let index = 0; index < count - 1; index += 1) {
      const a = index * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    batches.push({
      key: `${key}:${slot.event.index}:${rule.name}:trail`,
      texture: texture.texture,
      count,
      positions,
      uvs,
      colours,
      indices,
      additive: rule.render.blendSet === 1,
      lit: rule.shader.lit,
    });
  }
  return batches;
}
