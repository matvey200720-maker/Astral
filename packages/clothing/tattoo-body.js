/*
 * Тату на теле персонажа для обложки (29.10.2026, владелец, `ref/28`: «там не персонаж, а просто текстурка»).
 *
 * Игра кладёт тату на кожу сама: картинка `<txd>.ytd` встаёт в плоскость зоны тела (`tattoo-zones.js`) в своём месте — центр `uvPos`, размер `scale`,
 * поворот `rotation` из коллекции наложений (`*_overlays.xml`). `zoneBody` строит тело с прозрачным слоем на каждую зону; здесь этот слой заполняется
 * рисунками тату по их месту — в ту сторону, в какую `tattooPlacement` считает перенос рисунка с тела в картинку тату (`projectTattoo`). Место и размер берутся
 * из игры, а не на глаз; съёмщик (`clothing-shot.js`) кладёт слой поверх кожи как есть, с альфой.
 *
 * Чистый JS: работает в главном процессе, в окне и в тестах.
 */

import { TATTOO_ZONES, rgbaSampler, zoneBody, zoneIndex, zoneUv } from "./tattoo-zones.js";

/**
 * Рисунок `picture` (`{ width, height, rgba }`, альфа — сам рисунок) — в слой зоны `target` по месту `decoration` (`{ uv, scale, rotation }`, как у
 * `tattooPlacement`): точка слоя → точка рисунка (обратный перенос) → цвет, «поверх» уже нарисованного. U замкнута по кругу части тела: рисунок через шов
 * ложится и с той стороны. Возвращает число закрашенных точек слоя (0 — рисунок в слой не попал).
 */
export function paintTattoo(target, picture, decoration) {
  const { width, height, rgba } = target;
  const x = Number(decoration?.uv?.x ?? 0.5);
  const y = 1 - Number(decoration?.uv?.y ?? 0.5);
  const sx = 2 * Number(decoration?.scale?.x ?? 0.5);
  const sy = 2 * Number(decoration?.scale?.y ?? 0.5);
  if (!(sx > 0) || !(sy > 0)) return 0;
  const angle = (-Number(decoration?.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const sample = rgbaSampler({ width: picture.width, height: picture.height, data: picture.rgba });
  let painted = 0;
  for (let row = 0; row < height; row += 1) {
    const v = (row + 0.5) / height;
    for (let column = 0; column < width; column += 1) {
      const u0 = (column + 0.5) / width;
      for (let turn = -1; turn <= 1; turn += 1) {
        const du = u0 + turn - x;
        const dv = v - y;
        const s = (du * cos + dv * sin) / sx + 0.5;
        const t = (-du * sin + dv * cos) / sy + 0.5;
        if (s < 0 || s > 1 || t < 0 || t > 1) continue;
        const [r, g, b, a] = sample(s, t);
        if (a > 0) {
          const at = (row * width + column) * 4;
          const top = a / 255;
          const below = rgba[at + 3] / 255;
          const alpha = top + below * (1 - top);
          for (const [channel, colour] of [r, g, b].entries())
            rgba[at + channel] = Math.round((colour * top + rgba[at + channel] * below * (1 - top)) / alpha);
          rgba[at + 3] = Math.round(alpha * 255);
          painted += 1;
        }
        break;
      }
    }
  }
  return painted;
}

/**
 * Тело тату (`zoneBody`) с рисунками на своих местах: `tattoos` — `[{ decoration: { zone, uv, scale, rotation }, picture }]`, `zone` — «torso» или
 * «ZONE_TORSO». Меняет слои зон модели на месте и возвращает её вместе со счётом: `{ model, placed, missed }` — сколько рисунков легло и какие нет
 * (`zone` не из зон тела, у тела нет такой зоны или рисунок в слой не попал).
 */
export function tattooedBody(model, tattoos) {
  const layers = new Map();
  for (const mesh of model?.meshes || []) {
    const key = mesh.material?.extras?.astralTattooZone;
    const picture = mesh.material?.astralPart?.picture;
    if (key && picture) layers.set(zoneIndex(key), picture);
  }
  let placed = 0;
  const missed = [];
  for (const tattoo of tattoos || []) {
    const zone = zoneIndex(tattoo.decoration?.zone);
    const layer = layers.get(zone);
    if (!layer || !tattoo.picture) {
      missed.push({ zone: TATTOO_ZONES[zone]?.key || String(tattoo.decoration?.zone || ""), reason: layer ? "нет картинки" : "у тела нет такой зоны" });
      continue;
    }
    if (paintTattoo(layer, tattoo.picture, tattoo.decoration)) placed += 1;
    else missed.push({ zone: TATTOO_ZONES[zone].key, reason: "рисунок в слой не попал" });
  }
  return { model, placed, missed };
}

/**
 * Тело персонажа с тату: штатные части `stock` (`readStockBody`: `[{ name, zone, drawable, picture }]`), кожа мода `skins` (`skinsOf`: зона части → картинка) вместо штатной,
 * рисунки `tattoos` — на своих местах (`tattooedBody`). Одно и то же тело идёт и в кадры, и в GLB карточки («3D»): рисунки на руках, а не плоский лист (владелец, 29.10.2026:
 * «присобачить на руки, а не PNG»). Возвращает `{ parts, body, placed, missed }`; `parts` — чтобы собрать то же тело заново (кадр на одно тату).
 */
export function tattooBodyOf(stock, tattoos, { skins = {}, size = 1024 } = {}) {
  const parts = (stock || []).map((part) => ({ name: part.name, drawable: part.drawable, picture: skins[part.zone] || part.picture }));
  const body = zoneBody(parts, { size });
  return { parts, body, ...tattooedBody(body, tattoos) };
}

/*
 * Кадр одного тату (29.10.2026, владелец, `ref/34`: в галерее Blackwork — плоские текстуры): тело с одним рисунком на своём месте, а в кадре — только та часть тела,
 * где он лежит (торс с руками, ноги, голова), чтобы рисунок не терялся на фигуре в полный рост; ракурс — тот, с которого рисунка видно больше всего.
 */
const PART_OF_ZONE = Object.freeze({
  torso: "torso",
  "left-arm": "torso",
  "right-arm": "torso",
  head: "head",
  "left-leg": "legs",
  "right-leg": "legs",
});

/** Тело тату (`zoneBody`) только с той частью, где лежит зона `zone` (`"torso"` или `"ZONE_TORSO"`): подложка части и слой этой зоны. Нет такой зоны у тела — `null`. */
export function tattooFrameModel(model, zone) {
  const index = zoneIndex(zone);
  const key = TATTOO_ZONES[index]?.key;
  const part = PART_OF_ZONE[key];
  if (!part) return null;
  const meshes = (model?.meshes || []).filter((mesh) =>
    mesh.material?.extras?.astralTattooZone
      ? mesh.material.extras.astralTattooZone === key
      : mesh.material?.extras?.astralBody && mesh.material.astralPart?.name === part,
  );
  return meshes.some((mesh) => mesh.material?.extras?.astralTattooZone) ? { ...model, meshes } : null;
}

/* Рука в позе привязки лежит горизонтально: на квадратной плитке она висит, как на человеке. */
function hanging(mesh, side) {
  const turned = (values) => {
    if (!values) return values;
    const out = new Float32Array(values.length);
    for (let at = 0; at + 2 < values.length; at += 3) {
      out[at] = side * values[at + 2];
      out[at + 1] = values[at + 1];
      out[at + 2] = -side * values[at];
    }
    return out;
  };
  return { ...mesh, positions: turned(mesh.positions), normals: turned(mesh.normals) };
}

/* С какого V часть тела идёт на плитку: у руки выше лежат ключица и плечевой сустав с дырой на стыке с торсом, у ноги — трусы; с ними плитка читается хуже. */
const SHOWCASE_FROM = Object.freeze({ "left-arm": 0.27, "right-arm": 0.27, "left-leg": 0.19, "right-leg": 0.19 });

/**
 * Настоящая часть тела для плитки блэкворка (02.11.2026, владелец: «чтобы отображалась реальная просто рука»): из частей тела остаются
 * только треугольники зоны `zone`, поверх — её пустой слой рисунка. Чернила кладёт окно. `null` — у частей нет такой зоны.
 */
export function zoneShowcase(parts, zone) {
  const index = zoneIndex(zone);
  if (index < 0) return null;
  const key = TATTOO_ZONES[index].key;
  const from = SHOWCASE_FROM[key] ?? -Infinity;
  const kept = (parts || []).filter((part) => !part.noZones?.includes(key)).map((part) => ({
    ...part,
    drawable: {
      ...part.drawable,
      meshes: (part.drawable?.meshes || []).flatMap((mesh) => {
        if (!mesh.uvs1 || !mesh.indices) return [];
        const inZone = (corner) => {
          const place = zoneUv(mesh.uvs1[corner * 2], mesh.uvs1[corner * 2 + 1]);
          return place?.zone === index && place.v >= from;
        };
        const indices = [];
        for (let at = 0; at + 2 < mesh.indices.length; at += 3)
          if (inZone(mesh.indices[at]) && inZone(mesh.indices[at + 1]) && inZone(mesh.indices[at + 2]))
            indices.push(mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]);
        return indices.length ? [{ ...mesh, indices: new mesh.indices.constructor(indices) }] : [];
      }),
    },
  }));
  const body = zoneBody(kept, { size: 4 });
  if (!body.meshes.some((mesh) => mesh.material?.extras?.astralTattooZone)) return null;
  if (!key.endsWith("-arm")) return body;
  let reach = 0;
  for (const mesh of body.meshes) for (let at = 0; at < mesh.positions.length; at += 3) reach += mesh.positions[at];
  const side = reach < 0 ? -1 : 1;
  return { ...body, meshes: body.meshes.map((mesh) => hanging(mesh, side)) };
}

/* Ракурсы кадра: спереди, сзади, с боков и три четверти — рисунок на боку руки виден только сбоку. */
export const TATTOO_YAWS = Object.freeze([0, 180, 90, -90, 35, -35, 145, -145]);

/**
 * Лучший кадр модели `drawable`: снимается с каждого ракурса, берётся тот, где съёмщик нашёл больше рисунка (`detail`, перепад яркости у соседних пикселей:
 * чёрные чернила на коже его поднимают). `render` — как у работника одежды (`ctx.render`). Равные — первый ракурс. Ни один не снялся — `null`.
 */
export async function bestTattooShot(render, drawable, { yaws = TATTOO_YAWS, pitch = 4 } = {}) {
  let best = null;
  for (const yaw of yaws) {
    const shot = await render({ kind: "clothing", drawable, texture: null, category: "body", component: "body", gender: "male", side: "front", view: { yaw, pitch } }).catch(() => null);
    if (shot?.cover && (!best || (shot.detail || 0) > (best.detail || 0))) best = { ...shot, yaw };
  }
  return best;
}
