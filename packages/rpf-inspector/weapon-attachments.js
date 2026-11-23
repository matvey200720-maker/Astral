/*
 * Обвесы ствола — что куда встаёт (задача 6 ТЗ 17.10.2026, вторая
 * половина: «редактировать внешний вид обвесов на оружие и устанавливать их
 * визуально на дефолтные ганы»).
 *
 * Таблица (`weapon-components.js`) снята с файлов игры: у ствола — кости
 * крепления (`WAPSupp`, `WAPScop_2`, `WAPClip`, `gun_root`…) и обвесы на
 * каждую, у обвеса — модель (`w_at_ar_supp`) и своя кость (`AAPSupp`),
 * которую игра совмещает с костью ствола. Здесь из неё — ответы окну и
 * установщику:
 *
 *  • у кости со штатным обвесом (магазин, ствол MK2, штатный прицел
 *    снайперки) игра ВСЕГДА вешает штатный. Выбранный обвес такой кости
 *    ставится ЗАМЕНОЙ: модель штатного (`w_ar_carbinerifle_mag1.ydr`) в пакете
 *    скина несёт геометрию выбранного (`mode: "replace"`). Двойного не бывает:
 *    купит игрок в игре другой магазин — встанет тот, штатный вид;
 *  • у кости без штатного (глушитель, прицел, фонарь, рукоять, камуфляж MK2)
 *    выбранный обвес ВШИВАЕТСЯ в модель самого ствола на эту кость
 *    (`mode: "embed"`): ствол в игре с обвесом и без покупки. Купит игрок
 *    в оружейной обвес на ту же кость — игра повесит свой поверх вшитого:
 *    окно предупреждает об этом словами (модели обвесов `w_at_*` общие у
 *    многих стволов, спрятать штатный значило бы снять его со всех).
 *
 * Модуль — чистые данные: окно, установщик и тесты.
 */

import {
  WEAPON_ATTACH_POINTS,
  WEAPON_COMPONENT_MODELS,
  WEAPON_HOME_PACKS,
} from "./weapon-components.js";
import {
  cleanWeaponModel,
  weaponById,
  weaponByModel,
} from "./weapon-identity.js";

/* Порядок разделов в окне: от магазина к камуфляжу. */
export const ATTACHMENT_KINDS = Object.freeze([
  "clip",
  "barrel",
  "supp",
  "muzzle",
  "scope",
  "flash",
  "grip",
  "cover",
  "camo",
  "other",
]);

/* Обвесов на ствол — не больше, чем костей у самых увешанных MK2. */
export const MAX_ATTACHMENTS = 8;

/** Пакет DLC ствола (`mpgunrunning`) или пусто — ствол основной игры. */
export const weaponHomePack = (id) =>
  WEAPON_HOME_PACKS[String(id || "").trim().toUpperCase()] || "";

/** Обвес по имени игры: `{ id, model, bone, kind, pack }` или `null`. */
export function componentInfo(id) {
  const name = String(id || "")
    .trim()
    .toUpperCase();
  const row = WEAPON_COMPONENT_MODELS[name];
  return row
    ? Object.freeze({
        id: name,
        model: row[0],
        bone: row[1],
        kind: row[2],
        pack: row[3] || "",
      })
    : null;
}

const weaponOf = (value) => weaponById(value) || weaponByModel(value) || null;

/* Вид кости — вид большинства её обвесов (у `WAPScop_2` пистолета MK2 —
   камуфляжи затвора, а не прицел). */
function pointKind(components) {
  const counts = new Map();
  for (const item of components)
    counts.set(item.kind, (counts.get(item.kind) || 0) + 1);
  let best = "other";
  let most = 0;
  for (const kind of ATTACHMENT_KINDS)
    if ((counts.get(kind) || 0) > most) {
      best = kind;
      most = counts.get(kind);
    }
  /* Глушитель и дульные тормоза — одна кость: «дуло». */
  return best === "muzzle" && counts.has("supp") ? "supp" : best;
}

const pointsCache = new Map();

/**
 * Кости крепления ствола (`WEAPON_PISTOL` или модель `w_pi_pistol`):
 * `[{ bone, kind, mode, default, components: [{ id, model, bone, kind,
 * pack, default }] }]`. `default` — имя штатного обвеса кости или `null`;
 * `mode` — `replace` (у кости есть штатный) или `embed`.
 */
export function weaponAttachPoints(value) {
  const weapon = weaponOf(value);
  if (!weapon) return [];
  if (pointsCache.has(weapon.id)) return pointsCache.get(weapon.id);
  const points = (WEAPON_ATTACH_POINTS[weapon.id] || [])
    .map(([bone, list]) => {
      const components = list
        .map(([id, isDefault]) => {
          const info = componentInfo(id);
          return info ? Object.freeze({ ...info, default: Boolean(isDefault) }) : null;
        })
        .filter(Boolean);
      const standard = components.find((item) => item.default) || null;
      return Object.freeze({
        bone,
        kind: pointKind(components),
        mode: standard ? "replace" : "embed",
        default: standard?.id || null,
        components: Object.freeze(components),
      });
    })
    .filter((point) => point.components.length);
  pointsCache.set(weapon.id, Object.freeze(points));
  return pointsCache.get(weapon.id);
}

const fitCache = new Map();

/**
 * Подходит ли обвес (модель `w_at_ar_supp` или имя его файла, регистр, `_hi` и
 * расширение не важны) стволу: он есть
 * среди обвесов костей этого ствола в таблице игры. Ствол — id, имя или модель.
 * Обвес, которого таблица не знает (своя модель автора), не подходит никому —
 * он едет только в пакете самого ганпака.
 */
export function attachmentFitsWeapon(weapon, model) {
  const info = weaponOf(weapon);
  if (!info) return false;
  let models = fitCache.get(info.id);
  if (!models) {
    models = new Set(
      weaponAttachPoints(info.id).flatMap((point) =>
        point.components.map((item) => item.model.toLowerCase()),
      ),
    );
    fitCache.set(info.id, models);
  }
  return models.has(cleanWeaponModel(model));
}

/** Есть ли у ствола обвесы, которые можно выбрать (не только штатные). */
export const hasAttachments = (value) =>
  weaponAttachPoints(value).some((point) =>
    point.components.some((item) => !item.default),
  );

const findPoint = (points, bone) =>
  points.find(
    (point) => point.bone.toLowerCase() === String(bone || "").trim().toLowerCase(),
  ) || null;

/**
 * Выбор обвесов, приведённый к стволу: `{ [кость]: имя обвеса }` — только
 * кости этого ствола, только его обвесы, без штатных (они и так стоят) и
 * без пустых. Кривой ввод молча отбрасывается — как и прочие поля проекта.
 */
export function normalizeAttachments(value, selection) {
  const points = weaponAttachPoints(value);
  const result = {};
  if (!selection || typeof selection !== "object" || Array.isArray(selection))
    return result;
  for (const [bone, id] of Object.entries(selection)) {
    const point = findPoint(points, bone);
    if (!point) continue;
    const name = String(id || "")
      .trim()
      .toUpperCase();
    const chosen = point.components.find((item) => item.id === name);
    if (!chosen || chosen.default) continue;
    result[point.bone] = chosen.id;
    if (Object.keys(result).length >= MAX_ATTACHMENTS) break;
  }
  return result;
}

/**
 * Что ставится: `[{ bone, mode, component, replaces }]` по порядку костей
 * ствола. `replaces` — штатный обвес кости, модель которого несёт выбранный
 * (`mode: "replace"`), иначе `null`.
 */
export function resolveAttachments(value, selection) {
  const points = weaponAttachPoints(value);
  const chosen = normalizeAttachments(value, selection);
  return points
    .filter((point) => chosen[point.bone])
    .map((point) => ({
      bone: point.bone,
      mode: point.mode,
      component: point.components.find((item) => item.id === chosen[point.bone]),
      replaces: point.default
        ? point.components.find((item) => item.id === point.default)
        : null,
    }));
}

/**
 * Штатные обвесы ствола, которые игра вешает всегда: `[{ bone, component }]`
 * (магазин, ствол MK2, штатный прицел). Ствол «как в игре» — с ними.
 */
export function defaultAttachments(value) {
  return weaponAttachPoints(value)
    .filter((point) => point.default)
    .map((point) => ({
      bone: point.bone,
      component: point.components.find((item) => item.id === point.default),
    }));
}

/**
 * Обвесы модели ствола «как в игре» с выбором человека: на каждой кости —
 * выбранный, иначе штатный. Штатный магазин с моделью `skipModel` не
 * нужен — его ведёт своя роль (`magazine`): `[{ bone, component, chosen,
 * mode }]`.
 */
export function modelAttachments(value, selection, { skipModel = null } = {}) {
  const chosen = normalizeAttachments(value, selection);
  return weaponAttachPoints(value)
    .map((point) => {
      const id = chosen[point.bone] || point.default;
      if (!id) return null;
      const component = point.components.find((item) => item.id === id);
      if (!component) return null;
      if (!chosen[point.bone] && skipModel && component.model === skipModel)
        return null;
      return {
        bone: point.bone,
        component,
        chosen: Boolean(chosen[point.bone]),
        mode: point.mode,
      };
    })
    .filter(Boolean);
}

/**
 * Другие стволы, у которых штатный обвес этой кости — та же модель (магазин
 * карабина — и у служебного карабина): замена штатного сменит его и там.
 */
export function sharedDefaultUsers(value, bone) {
  const weapon = weaponOf(value);
  const point = findPoint(weaponAttachPoints(value), bone);
  const model = point?.default ? componentInfo(point.default)?.model : null;
  if (!weapon || !model) return [];
  const users = [];
  for (const id of Object.keys(WEAPON_ATTACH_POINTS)) {
    if (id === weapon.id) continue;
    if (defaultAttachments(id).some((item) => item.component.model === model))
      users.push(weaponById(id));
  }
  return users.filter(Boolean);
}

/**
 * Записи штатных обвесов, которые пакет скина ствола вправе занять: модели
 * (обычная и `_hi`) — для замены выбранным, словари — для покраски штатного
 * обвеса (как словарь магазина).
 */
export function defaultAttachmentEntries(value) {
  const models = [
    ...new Set(defaultAttachments(value).map((item) => item.component.model)),
  ];
  return models.flatMap((model) => [
    `${model}.ydr`,
    `${model}_hi.ydr`,
    `${model}.ytd`,
    `${model}+hi.ytd`,
  ]);
}

/** Файлы обвеса в игре: модель, её `_hi` и словари. */
export function componentFiles(model) {
  const base = String(model || "")
    .trim()
    .toLowerCase();
  return {
    model: `${base}.ydr`,
    modelHi: `${base}_hi.ydr`,
    textures: `${base}.ytd`,
    texturesHi: `${base}+hi.ytd`,
  };
}
