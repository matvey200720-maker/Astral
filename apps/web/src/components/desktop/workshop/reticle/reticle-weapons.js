import {
  MAX_WEAPON_RETICLES,
  normalizeOrdinaryReticle,
} from "@modovik/reticle-contract";
import {
  STUDIO_TRACER_WEAPONS,
  STUDIO_TRACER_WEAPON_GROUPS,
} from "@modovik/tracer-contract";

/*
 * Прицел на оружие — варианты, как у трассеров (задача 4 ТЗ 07.10.2026; варианты — владелец, 31.10.2026).
 *
 * Стволы — те же, что у мастерской трассеров (`STUDIO_TRACER_WEAPONS`): там
 * уже снято, где описан каждый ствол, включая дополнения, и установка
 * прицела пишет туда же. Снайперок здесь нет: их оптику игра берёт у насадки,
 * общей для нескольких стволов, — сетка снайперки одна на все (вкладка
 * «Снайперский»).
 *
 * Правило то же, что у трассеров: ствол принадлежит одному варианту. Первый
 * вариант — верх модуля `crosshair`, он стоит у всего остального оружия и не
 * убирается. Остальные варианты держат стволы поимённо.
 *
 * В игру идёт то же, что и раньше: `weapons` — `{ WEAPON_X: настройки }`.
 * `weaponVariants` — только то, чего в `weapons` не видно: какой ствол с каким
 * вместе, порядок строк и вид варианта, у которого стволы ещё не отмечены.
 * Работа без этого поля (сделанная раньше) раскладывается на варианты по
 * одинаковому рисунку, поэтому открывается без потерь. Первая правка ствола
 * пишет и `perWeapon: true`: работа прежнего режима «Один на всё»
 * (`perWeapon: false`, прицелы стволов спали) не будит спящие прицелы.
 *
 * Видимость (когда прицел гаснет) и отметка попадания — общие: их держат
 * кадры и методы игры, а не рисунок, — правка этих полей идёт в первый вариант,
 * какой бы ни был выбран.
 */

export const SNIPER_GROUP = "Снайперские";

/** Первый вариант — всё оружие, которое не отмечено у других. */
export const SHARED_VARIANT = "all";

export const RETICLE_WEAPONS = Object.freeze(
  STUDIO_TRACER_WEAPONS.filter((weapon) => weapon.group !== SNIPER_GROUP),
);

/** Снайперки — правятся во вкладке «Снайперский». */
export const RETICLE_SNIPERS = Object.freeze(
  STUDIO_TRACER_WEAPONS.filter((weapon) => weapon.group === SNIPER_GROUP),
);

export const RETICLE_WEAPON_GROUPS = Object.freeze(
  STUDIO_TRACER_WEAPON_GROUPS.filter((group) => group !== SNIPER_GROUP),
);

const byId = new Map(RETICLE_WEAPONS.map((weapon) => [weapon.id, weapon]));
const tableOrder = new Map(RETICLE_WEAPONS.map((weapon, index) => [weapon.id, index]));

/** Ствол редактора прицела по имени из игры или `null`. */
export const reticleWeapon = (id) => byId.get(String(id || "")) || null;

/** Поля, общие для всех стволов. */
export const SHARED_RETICLE_FIELDS = Object.freeze(
  new Set(["visibilityMode", "fadeDelaySeconds", "hitMarker"]),
);

const plainObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null;

/**
 * Свои прицелы стволов модуля — только известных стволов. У работы прежнего
 * режима «Один на всё» их нет: они спали и в игру не шли.
 */
export function weaponReticles(module) {
  if (module?.perWeapon === false) return {};
  const weapons = plainObject(module?.weapons) || {};
  return Object.fromEntries(
    Object.entries(weapons).filter(
      ([id, config]) => byId.has(id) && plainObject(config),
    ),
  );
}

/** Рисунок без полей стволов: по нему стволы узнают, что у них прицел один. */
const lookKey = (config) => JSON.stringify(normalizeOrdinaryReticle(config));

const inTableOrder = (ids) =>
  [...new Set(ids)].sort((left, right) => (tableOrder.get(left) ?? 999) - (tableOrder.get(right) ?? 999));

/**
 * Варианты модуля: `[{ id, everything, weapons, config }]`, первый — всё остальное оружие.
 * Сохранённая раскладка сверяется с `weapons`: ствол, которого там больше нет или чей рисунок разошёлся с вариантом
 * (работу правили не этим редактором), раскладывается заново.
 */
export function reticleVariants(module) {
  const weapons = weaponReticles(module);
  const list = [{ id: SHARED_VARIANT, everything: true, weapons: [], config: module || {} }];
  const claimed = new Set();
  for (const entry of Array.isArray(module?.weaponVariants) ? module.weaponVariants : []) {
    if (!plainObject(entry) || typeof entry.id !== "string" || !entry.id || entry.id === SHARED_VARIANT) continue;
    if (list.some((item) => item.id === entry.id)) continue;
    const listed = Array.isArray(entry.weapons) ? entry.weapons : [];
    const held = listed.filter((id) => weapons[id] && !claimed.has(id));
    if (held.length) {
      const key = lookKey(weapons[held[0]]);
      const same = inTableOrder(held.filter((id) => lookKey(weapons[id]) === key));
      same.forEach((id) => claimed.add(id));
      list.push({ id: entry.id, everything: false, weapons: same, config: weapons[same[0]] });
    } else if (!listed.length && plainObject(entry.config)) {
      list.push({ id: entry.id, everything: false, weapons: [], config: entry.config });
    }
  }
  /* Работа, сделанная до вариантов: стволы с одинаковым рисунком — один вариант. */
  const looks = new Map();
  for (const id of inTableOrder(Object.keys(weapons))) {
    if (claimed.has(id)) continue;
    const key = lookKey(weapons[id]);
    if (!looks.has(key)) looks.set(key, []);
    looks.get(key).push(id);
  }
  for (const held of looks.values())
    list.push({ id: `weapon:${held[0]}`, everything: false, weapons: held, config: weapons[held[0]] });
  return list;
}

/** Что пишется в проект о раскладке: у варианта без стволов — ещё и его вид. */
const storedVariants = (list) =>
  list
    .filter((item) => !item.everything)
    .map(({ id, weapons, config }) => (weapons.length ? { id, weapons } : { id, weapons: [], config }));

/** Новый вариант — копия `look`: дальше ему отмечают стволы. `{ patch, id }`. */
export function addVariantPatch(module, look) {
  const list = reticleVariants(module);
  const ids = new Set(list.map((item) => item.id));
  let number = list.length + 1;
  while (ids.has(`reticle-${number}`)) number += 1;
  const id = `reticle-${number}`;
  const added = { id, everything: false, weapons: [], config: normalizeOrdinaryReticle(look || module || {}) };
  return { id, patch: { weaponVariants: storedVariants([...list, added]) } };
}

/** Убрать вариант: его стволы возвращаются к первому. Первый не убирается. */
export function removeVariantPatch(module, id) {
  const list = reticleVariants(module);
  const target = list.find((item) => item.id === id);
  if (!target || target.everything) return {};
  const weapons = { ...weaponReticles(module) };
  for (const weapon of target.weapons) delete weapons[weapon];
  return { weapons, weaponVariants: storedVariants(list.filter((item) => item.id !== id)) };
}

/*
 * Отметить или снять стволы у варианта. Отмеченный ствол уходит от соседа: у ствола в игре один прицел. Вариант,
 * отдавший последний ствол, остаётся в списке со своим видом. Сверх предела игры стволов не бывает — лишние отбрасываются.
 */
export function variantWeaponsPatch(module, id, ids, on) {
  const list = reticleVariants(module);
  const target = list.find((item) => item.id === id);
  if (!target || target.everything) return {};
  const weapons = { ...weaponReticles(module) };
  const wanted = ids.filter((weapon) => byId.has(weapon));
  const look = normalizeOrdinaryReticle(target.config);
  const taken = new Set();
  for (const weapon of wanted) {
    if (on) {
      if (!weapons[weapon] && Object.keys(weapons).length >= MAX_WEAPON_RETICLES) continue;
      weapons[weapon] = { ...look };
      taken.add(weapon);
    } else {
      delete weapons[weapon];
      taken.add(weapon);
    }
  }
  const next = list.map((item) => {
    if (item.everything) return item;
    if (item.id === id)
      return {
        ...item,
        weapons: on ? inTableOrder([...item.weapons, ...taken]) : item.weapons.filter((weapon) => !taken.has(weapon)),
      };
    return on ? { ...item, weapons: item.weapons.filter((weapon) => !taken.has(weapon)) } : item;
  });
  return { perWeapon: true, weapons, weaponVariants: storedVariants(next) };
}

/**
 * Правка вида выбранного варианта — правкой модуля. Первый вариант правит верх модуля, как раньше; поля видимости и
 * отметки попадания уходят туда всегда.
 */
export function variantLookPatch(module, id, patch) {
  const list = reticleVariants(module);
  const target = list.find((item) => item.id === id);
  if (!target || target.everything) return patch;
  const shared = {};
  const own = {};
  for (const [key, value] of Object.entries(patch || {}))
    (SHARED_RETICLE_FIELDS.has(key) ? shared : own)[key] = value;
  if (!Object.keys(own).length) return shared;
  const config = normalizeOrdinaryReticle({ ...target.config, ...own });
  const next = list.map((item) => (item.id === id ? { ...item, config } : item));
  if (!target.weapons.length) return { ...shared, weaponVariants: storedVariants(next) };
  const weapons = { ...weaponReticles(module) };
  for (const weapon of target.weapons) weapons[weapon] = { ...config };
  return { ...shared, perWeapon: true, weapons, weaponVariants: storedVariants(next) };
}
