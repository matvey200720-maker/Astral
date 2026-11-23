/*
 * Трассеры набора: кто какие стволы держит и как их передают друг другу.
 *
 * Трассеров в наборе несколько — зелёный для карабина, красный для
 * снайперки, — и у каждого ствола в игре один след: `weapons.meta` знает у
 * ствола одно правило. Поэтому правило здесь одно: ствол принадлежит одному
 * трассеру. Отметил карабин у второго — первый его отдал; «всё остальное» —
 * все стволы, которые никто не взял поимённо, и такой трассер в наборе один.
 *
 * Модуль чистый — только данные проекта, без React: окно, тесты и плитка
 * обложки считают одно и то же одними функциями.
 */

import {
  TRACER_PROFILE_LIMIT,
  defaultTracerProfile,
  tracerAssignments,
  tracerProfileActive,
  tracerProfileColour,
} from "@modovik/ptfx-studio";
import {
  STUDIO_TRACER_WEAPONS,
  STUDIO_TRACER_WEAPON_GROUPS,
  findStudioTracerWeapon,
} from "@modovik/tracer-contract";
import { tr } from "../../../locales/ui.js";
import { effectsCopyFor } from "./effects-lang.js";

/*
 * Цвет нового трассера — не такой, как у соседей: зелёный и красный в
 * списке различаются сразу, два оранжевых подряд — нет.
 */
const PROFILE_COLOURS = Object.freeze([
  "#ff7a1a",
  "#22c55e",
  "#ef4444",
  "#22d3ee",
  "#a855f7",
  "#facc15",
  "#f472b6",
  "#3b82f6",
]);

/** Номер трассера — его место в списке, с единицы. */
export const profileNumber = (tracer, id) =>
  (tracer?.profiles || []).findIndex((item) => item.id === id) + 1;

/** Подпись трассера в списке: «Трассер 2». */
export const profileTitle = (tracer, id) =>
  `${tr("Трассер")} ${profileNumber(tracer, id)}`;

/** Кто держит ствол поимённо: `Map<weapon, id трассера>`. */
export function weaponOwners(tracer) {
  const owners = new Map();
  for (const profile of tracer?.profiles || []) {
    if (profile.mode === "all") continue;
    for (const weapon of profile.weapons || []) owners.set(weapon, profile.id);
  }
  return owners;
}

/** Трассер «всё остальное» или `null`. */
export const everythingProfile = (tracer) =>
  (tracer?.profiles || []).find((profile) => profile.mode === "all") || null;

/** Стволы, на которые трассер ляжет в игре, — с учётом соседей. */
export function effectiveWeapons(tracer, id) {
  return (
    tracerAssignments(tracer).find((item) => item.profile.id === id)?.weapons ||
    []
  );
}

/** Новый трассер: свой идентификатор и цвет, отличный от соседей. */
export function addProfile(tracer) {
  const profiles = tracer?.profiles || [];
  if (profiles.length >= TRACER_PROFILE_LIMIT) return tracer;
  const ids = new Set(profiles.map((item) => item.id));
  let number = profiles.length + 1;
  while (ids.has(`tracer-${number}`)) number += 1;
  const taken = new Set(profiles.flatMap((item) => item.colours || []));
  const colour =
    PROFILE_COLOURS.find((item) => !taken.has(item)) ||
    PROFILE_COLOURS[profiles.length % PROFILE_COLOURS.length];
  const profile = {
    ...defaultTracerProfile(number - 1),
    id: `tracer-${number}`,
    colours: [colour],
  };
  return { ...tracer, profiles: [...profiles, profile] };
}

/** Убрать трассер. Последний не убирается — сбрасывается: править есть что. */
export function removeProfile(tracer, id) {
  const profiles = tracer?.profiles || [];
  if (profiles.length <= 1)
    return { ...tracer, profiles: [defaultTracerProfile(0)] };
  return { ...tracer, profiles: profiles.filter((item) => item.id !== id) };
}

/*
 * «Без трассера» у выбранного: у его стволов в игре не будет следа. Вид,
 * цвета и размер хранятся и вернутся вместе со следом; поле `off` есть
 * только у выключенного — у включённого его нет, как в разобранном проекте.
 */
export function setOff(tracer, id, on) {
  return {
    ...tracer,
    profiles: (tracer?.profiles || []).map((profile) => {
      if (profile.id !== id) return profile;
      const { off: _off, ...rest } = profile;
      return on ? { ...rest, off: true } : rest;
    }),
  };
}

/**
 * Сколько стволов трассера игра и так оставляет без следа (дробовики:
 * Rockstar дала им пустой `<TracerFx />`). «Без трассера» у них ничего не
 * меняет — окно говорит об этом, а не обещает лишнего: `{ total, silent }`.
 */
export function stockSilentWeapons(tracer, id) {
  const weapons = effectiveWeapons(tracer, id);
  const silent = weapons.filter(
    (weapon) => findStudioTracerWeapon(weapon)?.vanilla?.tracerFx === "",
  );
  return { total: weapons.length, silent: silent.length };
}

/** Поменять настройки одного трассера. */
export function updateProfile(tracer, id, values) {
  return {
    ...tracer,
    profiles: (tracer?.profiles || []).map((profile) =>
      profile.id === id ? { ...profile, ...values } : profile,
    ),
  };
}

/*
 * Отметить или снять стволы у трассера.
 *
 * Отмеченный ствол уходит от соседа, который держал его поимённо. У трассера
 * «всё остальное» списка нет: отметить ствол — значит забрать его у соседа
 * (он и так «остальное»), снять — перевести трассер на выбранные стволы, то
 * есть на всё, что он держал, кроме снятых.
 */
export function setWeapons(tracer, id, weapons, on) {
  const wanted = new Set(weapons);
  const target = (tracer?.profiles || []).find((item) => item.id === id);
  if (!target || !wanted.size) return tracer;
  if (on) {
    return {
      ...tracer,
      profiles: tracer.profiles.map((profile) => {
        if (profile.id === id)
          return profile.mode === "all"
            ? profile
            : {
                ...profile,
                weapons: orderWeapons([...profile.weapons, ...wanted]),
              };
        if (profile.mode === "all") return profile;
        return {
          ...profile,
          weapons: profile.weapons.filter((weapon) => !wanted.has(weapon)),
        };
      }),
    };
  }
  if (target.mode === "all") {
    const held = effectiveWeapons(tracer, id).filter(
      (weapon) => !wanted.has(weapon),
    );
    return updateProfile(tracer, id, { mode: "selected", weapons: held });
  }
  return updateProfile(tracer, id, {
    weapons: target.weapons.filter((weapon) => !wanted.has(weapon)),
  });
}

/**
 * Трассер ствола в наборе: `{ id, title, colour, everything }` или `null`,
 * если в игре у ствола останется штатный след. Ствол — `WEAPON_*`.
 */
export function weaponTracer(tracer, weapon) {
  if (!weapon) return null;
  const held = tracerAssignments(tracer).find((item) =>
    item.weapons.includes(weapon),
  );
  if (!held) return null;
  return {
    id: held.profile.id,
    title: profileTitle(tracer, held.profile.id),
    colour: tracerProfileColour(held.profile),
    everything: held.profile.mode === "all",
    /* «Без трассера»: у ствола в игре следа не будет — цвета и полосы нет. */
    off: held.profile.off === true,
    profile: held.profile,
  };
}

/** Один и тот же след: всё, что видно в игре, без списка стволов. */
export function sameTracerLook(left, right) {
  if (!left || !right) return false;
  const look = ({ id: _id, mode: _mode, weapons: _weapons, ...rest }) =>
    JSON.stringify(rest, Object.keys(rest).sort());
  return look(left) === look(right);
}

/*
 * Студию открыли на стволе («Трейсер для хевика» в своём ганпаке): открыт
 * трассер, который этот ствол держит. Если ствол ни у кого — новый трассер
 * с одним этим стволом: человек пришёл задать ему след, а не выбирать из
 * чужих. Это правка черновика набора — в игру она едет только по
 * «Применить». `{ tracer, id }`; `id` пуст, если ствола нет в таблице
 * трассеров или трассеров уже предельно много.
 */
export function focusWeapon(tracer, weapon) {
  const held = weaponTracer(tracer, weapon);
  if (held) return { tracer, id: held.id };
  if (!findStudioTracerWeapon(weapon)) return { tracer, id: "" };
  const next = addProfile(tracer);
  if (next === tracer) return { tracer, id: "" };
  const id = next.profiles.at(-1).id;
  return { tracer: setWeapons(next, id, [weapon], true), id };
}

/** Порядок стволов — порядок таблицы: так их видно в списке и в заказе. */
const tableOrder = new Map(
  STUDIO_TRACER_WEAPONS.map((weapon, index) => [weapon.id, index]),
);
export const orderWeapons = (weapons) =>
  [...new Set(weapons)].sort(
    (left, right) =>
      (tableOrder.get(left) ?? 999) - (tableOrder.get(right) ?? 999),
  );

/**
 * Перевести трассер на «всё остальное» или на выбранные стволы. «Всё
 * остальное» бывает у одного трассера; выбранные начинаются с тех стволов,
 * что трассер держал до этого, — отметки не пропадают от переключения.
 */
export function setMode(tracer, id, mode) {
  const profile = (tracer?.profiles || []).find((item) => item.id === id);
  if (!profile) return tracer;
  if (mode === "all") {
    const everything = everythingProfile(tracer);
    if (everything && everything.id !== id) return tracer;
    return updateProfile(tracer, id, { mode: "all", weapons: [] });
  }
  /* У «всего остального» списка не было — выбор начинается с чистого. */
  return updateProfile(tracer, id, {
    mode: "selected",
    weapons: profile.mode === "all" ? [] : profile.weapons,
  });
}

/**
 * Что трассер берёт — одной строкой для списка: «Карабин MK2, Служебный
 * карабин», «Всё остальное оружие», «Оружие не выбрано».
 */
export function profileSummary(tracer, id, copy = effectsCopyFor("ru")) {
  const profile = (tracer?.profiles || []).find((item) => item.id === id);
  if (!profile) return "";
  if (!tracerProfileActive(profile))
    return tr("Оружие не выбрано — в игру не едет");
  const weapons = profileWeapons(tracer, profile, copy);
  /* «Без трассера» — первым словом: строка списка сразу говорит, что следа не будет. */
  return profile.off === true ? `${tr("Без трассера")} · ${weapons}` : weapons;
}

function profileWeapons(tracer, profile, copy) {
  if (profile.mode === "all") {
    const others = weaponOwners(tracer).size;
    return others ? tr("Всё остальное оружие") : tr("Всё оружие");
  }
  const names = profile.weapons.map((weapon) => {
    const label = findStudioTracerWeapon(weapon)?.label;
    return label ? tr(label) : weapon;
  });
  return names.length <= 2
    ? names.join(", ")
    : copy.andMore(names.slice(0, 2).join(", "), names.length - 2);
}

/*
 * Список стволов для окна: по видам, в каждом виде сначала ходовые на
 * серверах (у них есть полка в мастерской оружия), дальше по таблице.
 * `query` ищет по русскому и игровому имени: «мк2», «heavy», «карабин».
 */
/*
 * Как стволы зовут на серверах: «хеви», «спешл», «ревик». Слово из запроса
 * заменяется игровым — и находит ствол по его английскому имени.
 */
const SLANG = Object.freeze([
  [/хеви|хэви/g, "heavy"],
  [/спешл|спешиал|спешал/g, "special"],
  [/булл?пап/g, "bullpup"],
  [/ревик/g, "revolver"],
  [/шотган|дробаш/g, "shotgun"],
  [/снайперк\S*/g, "sniper"],
  [/марксман\S*/g, "marksman"],
  [/гусенберг|гузенберг/g, "gusenberg"],
]);

const normalize = (text) => {
  let result = String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/мк\s*2|мк\s*ii|mk\s*ii|mk\s+2/g, "mk2");
  for (const [pattern, word] of SLANG) result = result.replace(pattern, word);
  return result.replace(/\s+/g, " ").trim();
};

export function weaponGroups(query = "") {
  const needle = normalize(query);
  return STUDIO_TRACER_WEAPON_GROUPS.map((group) => ({
    group,
    weapons: STUDIO_TRACER_WEAPONS.filter(
      (weapon) =>
        weapon.group === group &&
        (!needle ||
          normalize(`${weapon.label} ${weapon.en}`).includes(needle) ||
          normalize(weapon.id.replace(/^WEAPON_/, "")).includes(
            needle.replace(/\s/g, ""),
          )),
    ).sort((left, right) => Number(right.popular) - Number(left.popular)),
  })).filter((item) => item.weapons.length > 0);
}
