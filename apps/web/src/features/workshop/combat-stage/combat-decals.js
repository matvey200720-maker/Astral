/*
 * Раны и кровь в 3D-сцене боя (ТЗ 18.10.2026, задача 4А, декали): что остаётся от
 * выстрела на теле жертвы и на земле за ней.
 *
 * На теле — как в системе повреждений педа игры (`peddamage.xml`): у входного и
 * выходного отверстий рана (лист `pd_wound_sheet`), подтёк, растущий за
 * `SoakScaleTime` (лист `pd_soak_splat`; на отвесной стене тела он тянется вниз), и брызги
 * на коже. Вид повреждения называет запись bloodfx.dat на кость и класс оружия
 * (`damageName`), размеры, интенсивности «мокро → сухо» и время исчезновения — его
 * числа. Декаль проецируется на настоящую сетку тела (`DecalGeometry`) и становится
 * ребёнком тела: при падении она едет вместе с ним.
 *
 * На земле — брызги `fxdecal_splatter_mist` по номерам декалей записи bloodfx.dat
 * (1010 — брызги, 1015 — направленные, 1017 — взвесь; клетки — `decals.dat`), размеры
 * записи, оттенок — её же. Расстановка упрощена: несколько лучей от выхода пули вниз
 * и вперёд до земли — пробы игры (число, дальность) Astral не разбирал. Стен у сцены
 * в этих режимах нет. Время жизни — как у крови на теле: у брызг на земле своего в
 * разобранных файлах нет.
 *
 * Листы игры — маски в каналах (`combat-decals-data.js`): у раны синий — тело, красный —
 * ободок; у подтёка зелёный — пятно, у брызг на коже синий; у брызг на земле — альфа.
 * Каналами их красит это окно: шейдер игры (`damage_blits`) не разобран.
 */

import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { seededUnit } from "./combat-schedule.js";
import {
  bloodLife,
  damageByName,
  decalCell,
  dryness,
  fadeFactor,
  frameUv,
  groundSize,
  parseDecals,
  parsePedDamage,
  sheetFrame,
  soakSize,
  splatterOnBodySize,
  woundRecord,
  woundSize,
} from "./combat-decals-data.js";

/* Сколько декалей живёт разом: старейшие уходят первыми. */
const MAX_BODY = 48;
const MAX_GROUND = 90;
/* Лучи брызг на землю от выхода пули. */
const GROUND_PROBES = Object.freeze({ splat: 1, spray: 1, mist: 1 });
/* Дальность луча, м, и угол вниз у его разброса: простая расстановка (проб игры нет в файлах). */
const PROBE_REACH = 4;
const FLOOR_LIFT = 0.004;
/* Глубина проекции декали на тело: тоньше — на выпуклости не ложится, толще — захватывает спину. */
const BODY_DEPTH = 0.09;
/* Ближе этого к живому подтёку (м) новый подтёк не ставится: это то же пятно. */
const SOAK_MERGE = 0.045;
const DOWN = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 0, 1);

/* Лист → текстура: строки снизу вверх (так их ждёт UV), цвет и альфа из каналов. */
function sheetTexture({ width, height, channels, data }, painter) {
  const per = channels === "a" ? 1 : 3;
  const source = new Uint8Array(data);
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = (height - 1 - y) * width;
    for (let x = 0; x < width; x += 1) {
      const pixel = (from + x) * per;
      const target = (y * width + x) * 4;
      painter(source, pixel, out, target);
    }
  }
  const texture = new THREE.DataTexture(out, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

const channelMask = (channel) => (source, at, out, to) => {
  out[to] = out[to + 1] = out[to + 2] = 255;
  out[to + 3] = source[at + channel];
};

function buildTextures(sheets, colours) {
  const textures = {};
  const blood = colours.blood.map((value) => Math.round(clampByte(value * BLOOD_BRIGHTNESS) * 255));
  if (sheets.pd_wound_sheet)
    textures.wound = sheetTexture(sheets.pd_wound_sheet, (source, at, out, to) => {
      /* Ободок (красный) — кровь поярче, тело раны (синий) — тёмная. */
      const rim = source[at] / 255;
      const body = source[at + 2] / 255;
      const alpha = Math.max(rim, body);
      const shade = 0.4 + 0.6 * (alpha > 0 ? rim / alpha : 0);
      out[to] = Math.round(blood[0] * shade);
      out[to + 1] = Math.round(blood[1] * shade);
      out[to + 2] = Math.round(blood[2] * shade);
      out[to + 3] = Math.round(alpha * 255);
    });
  if (sheets.pd_soak_splat) {
    textures.soak = sheetTexture(sheets.pd_soak_splat, channelMask(1));
    textures.skinSplatter = sheetTexture(sheets.pd_soak_splat, channelMask(2));
  }
  if (sheets.fxdecal_splatter_mist) textures.ground = sheetTexture(sheets.fxdecal_splatter_mist, channelMask(0));
  return textures;
}

const clampByte = (value) => Math.min(Math.max(value, 0), 1);

/** Повернуть геометрию в систему тела, сдвинуть начало в точку и вернуть сдвиг. */
function recentre(geometry, to, point) {
  geometry.applyMatrix4(to);
  geometry.computeBoundingSphere();
  const centre = point.clone().applyMatrix4(to);
  geometry.translate(-centre.x, -centre.y, -centre.z);
  return centre;
}

/** UV кадра листа поверх 0…1 геометрии декали. */
function remapUv(geometry, uv) {
  const attribute = geometry.getAttribute("uv");
  const base = new Float32Array(attribute.array);
  for (let i = 0; i < attribute.count; i += 1) {
    attribute.setXY(i, uv.offset[0] + base[i * 2] * uv.repeat[0], uv.offset[1] + base[i * 2 + 1] * uv.repeat[1]);
  }
  attribute.needsUpdate = true;
  return base;
}

function decalMaterial(map) {
  return new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    /* Мокрая кровь блестит, но на складках ткани блик солнца ложился бледными косыми плитами: матовее. */
    roughness: 0.8,
    metalness: 0,
    envMapIntensity: 0,
    side: THREE.FrontSide,
  });
}

/**
 * @param {object} options
 * @param {THREE.Scene} options.scene — мир сцены: брызги на земле кладутся сюда
 */
export function createCombatDecals({ scene }) {
  const ground = new THREE.Group();
  ground.name = "combat-ground-decals";
  scene.add(ground);

  let pedDamage = null;
  let decals = null;
  let textures = {};
  let bloodfx = "";
  const records = new Map();
  let now = 0;
  /** `{ object, host, born, damage, update(age) → settled? }` */
  let live = [];
  let seq = 0;
  const helper = new THREE.Object3D();

  const ready = () => Boolean(pedDamage?.damages.size && textures.wound && textures.soak);

  function dispose(item) {
    item.mesh.removeFromParent();
    item.mesh.geometry.dispose();
    item.mesh.material.dispose();
  }

  function trim(kind, limit) {
    const mine = live.filter((item) => item.kind === kind);
    for (const item of mine.slice(0, Math.max(0, mine.length - limit))) {
      dispose(item);
      live = live.filter((other) => other !== item);
    }
  }

  function record(zone) {
    const key = `${zone}|${bloodfx.length}`;
    if (!records.has(key)) records.set(key, woundRecord(bloodfx, { zone }));
    return records.get(key);
  }

  /* Декаль на сетке тела: проекция по нормали, верх листа — вверх мира. */
  function bodyDecal({ victim, hit, size, map, uv, centreShift = 0, depth = BODY_DEPTH }) {
    const object = hit.object;
    if (!object?.isMesh) return null;
    victim.placement.updateMatrixWorld(true);
    const point = new THREE.Vector3(...hit.point);
    const normal = new THREE.Vector3(...hit.normal).normalize();
    const up = Math.abs(normal.z) > 0.95 ? new THREE.Vector3(0, 1, 0) : UP;
    helper.position.copy(point);
    helper.up.copy(up);
    helper.lookAt(point.clone().add(normal));
    helper.updateMatrixWorld(true);
    /* Тянущийся вниз подтёк висит под раной: центр проекции — ниже точки на долю размера. */
    const centre = centreShift ? point.clone().addScaledVector(DOWN, centreShift * size) : point;
    let geometry;
    try {
      geometry = new DecalGeometry(object, centre, helper.rotation.clone(), new THREE.Vector3(size, size, Math.max(depth, size)));
    } catch {
      return null;
    }
    if (!geometry.getAttribute("position")?.count) {
      geometry.dispose();
      return null;
    }
    const to = new THREE.Matrix4().copy(victim.placement.matrixWorld).invert();
    const origin = recentre(geometry, to, point);
    const baseUv = remapUv(geometry, uv);
    const mesh = new THREE.Mesh(geometry, decalMaterial(map));
    mesh.position.copy(origin);
    mesh.renderOrder = 4;
    mesh.receiveShadow = true;
    victim.placement.add(mesh);
    return { mesh, baseUv, geometry };
  }

  /*
   * Состояние на нулевой секунде — сразу: материал у декали заводится белым и непрозрачным, а цвет, прозрачность
   * и размер ставит `update`, который иначе первый раз зовётся с шагом времени. Кадр без шага (пауза, стоп-кадр,
   * снимок) показывал бы свежий выстрел белой кляксой.
   */
  function addBody(item) {
    item.update(0);
    live.push(item);
    trim("body", MAX_BODY);
  }

  /* --- Рана: вход и выход --- */

  function wound({ victim, hit, damage, seed, born }) {
    const sheet = damage.wound;
    const frame = sheetFrame(sheet, 0, seed);
    const flip = { u: sheet.flipU && seededUnit(seed + 3) > 0.5, v: sheet.flipV && seededUnit(seed + 5) > 0.5 };
    const size = Math.max(woundSize(damage, seed), 0.012);
    const made = bodyDecal({ victim, hit, size, map: textures.wound, uv: frameUv(frame, sheet, flip) });
    if (!made) return;
    addBody({
      kind: "body",
      mesh: made.mesh,
      born,
      damage,
      update(age) {
        const intensity = dryness(age, damage.woundIntensity) * fadeFactor(age, damage);
        made.mesh.material.opacity = intensity;
        made.mesh.material.color.setRGB(1, 1, 1);
        made.mesh.material.roughness = 0.6 + 0.3 * Math.min(age / Math.max(damage.woundIntensity.dryingTime, 1e-3), 1);
        return age > bloodLife(damage);
      },
    });
  }

  /* --- Подтёк на одежде/коже --- */

  function soak({ victim, hit, damage, seed, born }) {
    /* Очередь бьёт в одно место: подтёк там уже есть — второй поверх него слоями гнал бы розовую вуаль с дырами на складках ткани. */
    const spot = victim.placement.worldToLocal(new THREE.Vector3(...hit.point));
    if (live.some((item) => item.role === "soak" && item.victim === victim && item.mesh.position.distanceTo(spot) < SOAK_MERGE)) return;
    const gravity = Math.abs(new THREE.Vector3(...hit.normal).z) < 0.7;
    const sheet = gravity ? damage.soakGravity || damage.soak : damage.soak;
    const end = soakSize(damage, damage.soakSize.scaleTime, { gravity });
    const frame0 = sheetFrame(sheet, 0, seed + 31);
    const flip = { u: sheet.flipU && seededUnit(seed + 7) > 0.5, v: sheet.flipV && seededUnit(seed + 9) > 0.5 };
    const grid = { rows: sheet.rows, cols: sheet.cols };
    const made = bodyDecal({
      victim,
      hit,
      size: end,
      map: textures.soak,
      uv: frameUv(frame0, grid, flip),
      centreShift: gravity ? sheet.centre[1] : 0,
    });
    if (!made) return;
    const colour = new THREE.Color().setRGB(...pedDamage.soak, THREE.LinearSRGBColorSpace);
    let shown = frame0;
    addBody({
      kind: "body",
      role: "soak",
      victim,
      mesh: made.mesh,
      born,
      damage,
      update(age) {
        /* Растёт от `Start` к `End`; кадры листа идут один раз и стоят. */
        const scale = soakSize(damage, age, { gravity }) / Math.max(end, 1e-6);
        made.mesh.scale.setScalar(scale);
        const frame = sheetFrame(sheet, age, seed + 31);
        if (frame !== shown) {
          shown = frame;
          const uv = frameUv(frame, grid, flip);
          const attribute = made.geometry.getAttribute("uv");
          for (let i = 0; i < attribute.count; i += 1) attribute.setXY(i, uv.offset[0] + made.baseUv[i * 2] * uv.repeat[0], uv.offset[1] + made.baseUv[i * 2 + 1] * uv.repeat[1]);
          attribute.needsUpdate = true;
        }
        const dry = dryness(age, damage.soakIntensity);
        made.mesh.material.opacity = dry * fadeFactor(age, damage);
        made.mesh.material.color.copy(colour).multiplyScalar((1.2 - 0.5 * Math.min(age / Math.max(damage.soakIntensity.dryingTime, 1e-3), 1)) * BLOOD_BRIGHTNESS);
        made.mesh.material.roughness = 0.7 + 0.25 * Math.min(age / Math.max(damage.soakIntensity.dryingTime, 1e-3), 1);
        return age > bloodLife(damage);
      },
    });
  }

  /* --- Брызги на коже --- */

  function skinSplatter({ victim, hit, damage, blood, seed, born }) {
    const sheet = damage.splatter;
    if (!sheet || !textures.skinSplatter) return;
    const frame = sheetFrame(sheet, 0, seed + 41);
    const flip = { u: sheet.flipU && seededUnit(seed + 13) > 0.5, v: sheet.flipV && seededUnit(seed + 15) > 0.5 };
    const size = splatterOnBodySize(damage, seed);
    const made = bodyDecal({ victim, hit, size, map: textures.skinSplatter, uv: frameUv(frame, sheet, flip) });
    if (!made) return;
    const colour = new THREE.Color().setRGB(blood[0] * BLOOD_BRIGHTNESS, blood[1] * BLOOD_BRIGHTNESS, blood[2] * BLOOD_BRIGHTNESS, THREE.LinearSRGBColorSpace);
    addBody({
      kind: "body",
      mesh: made.mesh,
      born,
      damage,
      update(age) {
        made.mesh.material.opacity = dryness(age, damage.splatterIntensity) * fadeFactor(age, damage) * 2.2;
        made.mesh.material.color.copy(colour);
        return age > bloodLife(damage);
      },
    });
  }

  /* --- Брызги на землю --- */

  function groundSplat({ point, kind, id, side, damage, blood, seed, born, floorZ }) {
    const cell = decalCell(decals, id, seed + 51);
    if (!cell || !textures.ground) return;
    const size = Math.max(groundSize(side.sizes, kind, seed), 0.12);
    const geometry = new THREE.PlaneGeometry(size, size);
    remapUv(geometry, frameUv(cell.cell, cell, { u: seededUnit(seed + 53) > 0.5, v: seededUnit(seed + 55) > 0.5 }));
    const material = decalMaterial(textures.ground);
    /* Оттенок записи bloodfx — проценты красного, зелёного и синего. */
    const tint = side.tint.map((value) => value / 100);
    const base = new THREE.Color().setRGB(
      blood[0] * Math.max(tint[0], 0.35) * GROUND_BRIGHTNESS,
      blood[1] * (tint[1] || 1) * GROUND_BRIGHTNESS,
      blood[2] * (tint[2] || 1) * GROUND_BRIGHTNESS,
      THREE.LinearSRGBColorSpace,
    );
    material.color.copy(base);
    material.roughness = 0.6;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(point.x, point.y, floorZ + FLOOR_LIFT + (seq % 7) * 0.0004);
    mesh.rotation.z = seededUnit(seed + 57) * Math.PI * 2;
    mesh.renderOrder = 2;
    mesh.receiveShadow = true;
    ground.add(mesh);
    const item = {
      kind: "ground",
      mesh,
      born,
      damage,
      update(age) {
        material.opacity = (kind === "mist" ? 0.45 : kind === "spray" ? 0.7 : 0.8) * fadeFactor(age, damage);
        return age > bloodLife(damage);
      },
    };
    item.update(0);
    live.push(item);
    trim("ground", MAX_GROUND);
  }

  /** Лучи от выхода пули: вперёд по полёту и вниз, до земли в пределах дальности. */
  function groundSplatters({ origin, direction, rec, damage, blood, seed, born, floorZ }) {
    const side = rec.exit || rec.entry;
    if (!side) return;
    const from = new THREE.Vector3(...origin);
    const forward = new THREE.Vector3(...direction).normalize();
    const kinds = [
      ["splat", side.decals.splat, GROUND_PROBES.splat],
      ["spray", side.decals.spray, GROUND_PROBES.spray],
      ["mist", side.decals.mist, GROUND_PROBES.mist],
    ];
    for (const [kind, id, count] of kinds) {
      if (!id) continue;
      for (let probe = 0; probe < count; probe += 1) {
        const salt = seed + probe * 101 + kind.length * 17;
        const spread = new THREE.Vector3(seededUnit(salt) - 0.5, seededUnit(salt + 1) - 0.5, 0).multiplyScalar(0.5);
        const ray = forward.clone().multiplyScalar(0.8).add(spread).addScaledVector(DOWN, 0.5 + seededUnit(salt + 2) * 0.9).normalize();
        if (ray.z >= -0.05) continue;
        const reach = (from.z - floorZ) / -ray.z;
        if (reach <= 0 || reach > PROBE_REACH) continue;
        const point = from.clone().addScaledVector(ray, reach);
        groundSplat({ point, kind, id, side, damage, blood, seed: salt, born, floorZ });
      }
    }
  }

  return {
    /** Данные игры: `{ pedDamage, decals, sheets }` (`readCombatDecals`) — разбираются и красятся здесь. */
    setData(raw) {
      for (const texture of Object.values(textures)) texture.dispose();
      textures = {};
      pedDamage = null;
      decals = null;
      if (!raw) return;
      pedDamage = parsePedDamage(raw.pedDamage);
      decals = parseDecals(raw.decals);
      if (pedDamage && raw.sheets) textures = buildTextures(raw.sheets, pedDamage);
    },
    /** Текст `bloodfx.dat` из базы эффектов: запись на попадание берётся из него. */
    setBloodfx(text) {
      bloodfx = String(text || "");
      records.clear();
    },
    get ready() {
      return ready();
    },
    /**
     * Что остаётся от выстрела. `through` — луч сквозь тело (`actor.pierce`) с точками и сетками входа и
     * выхода; `direction` — полёт пули; `floorZ` — высота земли.
     */
    strike({ victim, through, direction, zone = "body", seed = 1, floorZ = 0 }) {
      if (!ready() || !victim || !through?.entry) return false;
      const rec = record(zone);
      if (!rec) return false;
      seq += 1;
      const damageIn = damageByName(pedDamage, rec.entry?.damage);
      const damageOut = damageByName(pedDamage, rec.exit?.damage || rec.entry?.damage);
      if (!damageIn) return false;
      const blood = pedDamage.blood;
      const born = now;
      if (seededUnit(seed + 61) < (rec.entry?.woundProbability ?? 1)) {
        wound({ victim, hit: through.entry, damage: damageIn, seed, born });
        soak({ victim, hit: through.entry, damage: damageIn, seed: seed + 1, born });
        skinSplatter({ victim, hit: through.entry, damage: damageIn, blood, seed: seed + 2, born });
      }
      if (through.exit) {
        wound({ victim, hit: through.exit, damage: damageOut, seed: seed + 3, born });
        skinSplatter({ victim, hit: through.exit, damage: damageOut, blood, seed: seed + 4, born });
      }
      const origin = through.exit?.point || through.entry.point;
      groundSplatters({ origin, direction, rec, damage: damageOut, blood, seed: seed + 5, born, floorZ });
      return true;
    },
    /** Время идёт: подтёк растёт, кровь сохнет и в срок исчезает. Истина — кадр изменился. */
    step(dt) {
      now += dt;
      let changed = false;
      const kept = [];
      for (const item of live) {
        const age = now - item.born;
        const expired = item.update(age);
        if (expired) {
          dispose(item);
          changed = true;
        } else {
          kept.push(item);
          /* Пока подтёк растёт и кровь сохнет, кадр меняется; потом стоит. */
          if (age < SETTLE_SECONDS) changed = true;
        }
      }
      live = kept;
      return changed;
    },
    get active() {
      return live.some((item) => now - item.born < SETTLE_SECONDS);
    },
    get count() {
      return live.length;
    },
    /** Убрать всё: новый ролик, смена зоны, другие тела. */
    clear() {
      for (const item of live) dispose(item);
      live = [];
    },
    /** Брызги на земле — только когда земля в кадре. */
    setGroundVisible(on) {
      ground.visible = Boolean(on);
    },
    dispose() {
      this.clear();
      ground.removeFromParent();
      for (const texture of Object.values(textures)) texture.dispose();
      textures = {};
    },
  };
}

/*
 * Яркость крови в кадре: числа игры (`BloodColor` 0,8; 0,05; 0,05) — альбедо в её шейдере повреждений, со
 * своим светом и экспозицией. В кадре сцены Astral тот же цвет под солнцем горит алым и ярче кожи, поэтому
 * кровь на теле и на земле темнее: подбор по глазу, не число из файла.
 */
const BLOOD_BRIGHTNESS = 0.5;
/* На земле кровь темнее: асфальт и сухая кровь днём не светятся алым, как мокрая на коже. */
const GROUND_BRIGHTNESS = 0.3;
/* Сколько секунд после попадания кадр меняется сам (рост подтёка, высыхание). */
const SETTLE_SECONDS = 25;
