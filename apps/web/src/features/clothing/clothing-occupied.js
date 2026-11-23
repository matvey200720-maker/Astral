/*
 * Занятые вещи сервера (задача 4 ТЗ 05.10.2026): на какой вещи уже стоит
 * заменёнка Astral и чья она.
 *
 * Две заменёнки на одной вещи не уживаются: вторая перепишет первую. Прежде
 * движок молча снимал прежнюю, и человек терял поставленное, не зная об
 * этом. Теперь «На что поставить?» видит занятую вещь заранее и спрашивает:
 * заменить то, что стоит, или выбрать другую вещь.
 *
 * Источник — записи установки движка (`installed[].slots`, тот же слот, что
 * считает `assortmentSlot`), название — из записи установки (`origin.title`)
 * или из записи покраски мастерской (`astral.clothing-studio.install.v1`).
 */

import { useEffect, useMemo, useState } from "react";
import { assortmentSlot } from "@modovik/clothing/assortment";
import { getLocalInstallProfile } from "../../api.js";
import { CLOTHING_SKIN_INSTALLS_KEY } from "../workshop/install-queue/tasks/clothing-paint-slots.js";
import { tr } from "../../locales/ui.js";

const EMPTY = new Map();

/* Названия покрасок мастерской по их пакетам. */
function paintTitles(storage = globalThis.localStorage) {
  const titles = new Map();
  let raw = null;
  try {
    raw = JSON.parse(storage?.getItem(CLOTHING_SKIN_INSTALLS_KEY) || "null");
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object") return titles;
  for (const record of Object.values(raw))
    for (const modId of [record?.modId, ...(record?.modIds || [])])
      if (modId && record?.name) titles.set(modId, String(record.name));
  return titles;
}

/**
 * Слот → `{ modId, title }` для всех заменёнок одежды на этой установке
 * игры. `targetId` пуст — все установки.
 */
export function occupiedClothing(installed = [], { targetId = "", titles = new Map() } = {}) {
  const occupied = new Map();
  for (const item of installed || []) {
    if (targetId && item?.targetId && item.targetId !== targetId) continue;
    for (const slot of item?.slots || []) {
      if (!/^clothing-/.test(String(slot))) continue;
      occupied.set(slot, {
        modId: String(item.modId || ""),
        title: String(item.origin?.title || titles.get(item.modId) || tr("другая заменёнка")),
      });
    }
  }
  return occupied;
}

/* Занятая вещь с несколькими записями: `also` — их modId (снимаются вместе), `alsoTitles` — названия. Одна и та же пара записей отдаёт один и тот же объект: плитка (`memo`) не перерисовывается зря. */
const combos = new WeakMap();
function withAlso(first, others) {
  const key = others.map((entry) => entry.modId).join("|");
  let byKey = combos.get(first);
  if (!byKey) combos.set(first, (byKey = new Map()));
  if (!byKey.has(key))
    byKey.set(key, { ...first, also: others.map((entry) => entry.modId), alsoTitles: others.map((entry) => entry.title) });
  return byKey.get(key);
}

/**
 * Занятость без записей той же работы (`own` — пакеты прежней установки этой покраски: их замена своя). Своя первая запись не прячет чужую вторую (`also`): остаются только чужие;
 * ничего не отфильтровано — тот же объект (memo у плитки).
 */
export function foreignOccupant(occupant, own = []) {
  if (!occupant) return null;
  const all = [
    { modId: occupant.modId, title: occupant.title },
    ...(occupant.also || []).map((modId, at) => ({ modId, title: occupant.alsoTitles?.[at] ?? "" })),
  ];
  const foreign = all.filter((entry) => !own.includes(entry.modId));
  if (foreign.length === all.length) return occupant;
  if (!foreign.length) return null;
  const [first, ...rest] = foreign;
  return rest.length ? withAlso({ ...occupant, modId: first.modId, title: first.title }, rest) : { ...occupant, modId: first.modId, title: first.title, also: undefined, alsoTitles: undefined };
}

/**
 * Кто стоит на вещи ассортимента: `{ modId, title, also? }` или `null`. `route` — вкладка выбора («gta», «majestic», «gta5rp»; `docs/clothing/server-routes.md`):
 *  - «majestic» — замена в паке игры, слот с хвостом `-majestic` (`clothing-replace-manifest-trust.js`): только он, если вещь — вещь проекта (`item.server`); у штатной вещи без проекта — оба слота;
 *  - остальные («gta», «gta5rp», вызов без вкладки) — смотрятся оба слота: вещь, что лежит в файлах игры, ставится на месте в паке игры (слот с хвостом), любая другая — в Astral Clothing DLC
 *    (обычный слот); вещь GTA 5 RP бывает и той и другой (≈ 21 из 5187 лежат в паках игры), и прежняя заменёнка на ней может стоять в любом слоте. Стоят обе — `also` несёт вторую:
 *    «Заменить её» снимает обе (находка 2 ревью, 14.11.2026: без этого движок отказывал `CLOTHING_SLOT_TAKEN`, а окно кнопки не показывало).
 */
export const occupantOf = (occupied, item, route = "") => {
  if (!occupied?.size || !item) return null;
  const slot = assortmentSlot(item);
  if (!slot) return null;
  const packed = occupied.get(`${slot}-majestic`) || null;
  /* Вкладка «Majestic» смотрит один слот, пока вещь — вещь проекта (`item.server`). Штатная вещь без проекта, что оказалась на этой вкладке, ставится на месте в паке игры, как на «GTA», и
     движок видит на ней прежнюю заменёнку из Astral Clothing DLC (`crossSlotOf` по проекту вещи, а не вкладки): окно смотрит оба слота, чтобы показать её и дать «Заменить её», а не оставить отказ без кнопки (ревью 15.11). */
  if (route === "majestic" && item.server) return packed;
  const plain = occupied.get(slot) || null;
  const first = packed || plain;
  if (!first) return null;
  const second = packed && plain && plain.modId !== packed.modId ? plain : null;
  return second ? withAlso(first, [second]) : first;
};

/*
 * Что стоит на цвете вещи (бронежилет: `{ folder, component, drawables, letter }`, находка 2 перепроверки, 14.11.2026). Цвет пишет одну букву у каждой модели кроя — те же файлы
 * `<вид>_diff_NNN_<буква>`, что пишет замена вещи целиком у своего номера, и цвет той же буквы, поставленный раньше. Слоты у них разные (`…-colour-b`, `…-task-001`), но движок видит
 * пересечение по записям и отказывает; окно же советовало «Заменить её», а кнопки у цвета не было. Занято — любой из слотов, что цвет задевает: свой слот цвета и вещь целиком у каждой модели.
 * Правило вкладок то же, что у вещи: «majestic» — только слоты пака (хвост `-majestic`), остальные — оба слота.
 */
export function colourSlots(target) {
  const slots = [];
  const drawables = Array.isArray(target?.drawables) ? target.drawables : [];
  for (const drawable of drawables) {
    const slot = assortmentSlot({ folder: target.folder, component: target.component, drawable });
    if (slot) slots.push(slot);
  }
  if (slots.length && /^[a-z]$/.test(String(target?.letter || ""))) {
    const colour = `${slots[0].replace(/-[0-9]{3}$/, "")}-colour-${target.letter}`;
    slots.push(colour);
  }
  return slots;
}

/** Кто стоит на цвете вещи: `{ modId, title, also? }` или `null`; несколько — `also` несёт остальные, «Заменить её» снимает все. */
export function colourOccupantOf(occupied, target, route = "") {
  if (!occupied?.size) return null;
  const found = new Map();
  for (const slot of colourSlots(target)) {
    const packed = occupied.get(`${slot}-majestic`);
    if (packed) found.set(packed.modId, packed);
    if (route === "majestic") continue;
    const plain = occupied.get(slot);
    if (plain) found.set(plain.modId, plain);
  }
  if (!found.size) return null;
  const [first, ...rest] = [...found.values()];
  return rest.length ? withAlso(first, rest) : first;
}

/**
 * Занятые вещи текущей установки и «прочитано ли». Записи читаются при монтировании и каждый раз, когда меняется `version` (страница вещи передаёт ключ, который меняется при установке и снятии этой вещи):
 * цель по умолчанию, посчитанная по устаревшему списку, ставила вещь на запасную цель, хотя прежняя освободилась (ревью 14.11, №5). Пока идёт перечитывание, `ready` — `false`: пустой список до ответа
 * неотличим от «ничего не занято», и окно «сразу» не должно нажимать «Сделать заменёнку» раньше ответа.
 * `enabled` — читать ли вообще: страница мода не одежды стоит на том же потоке установки, и без условия каждая (ролик, пак звуков) ходила бы за профилем в Desktop. Выключен — `occupied` пуст, `ready` истинно (ждать нечего).
 */
export function useOccupiedClothingState(targetId = "", version = "", enabled = true) {
  const [loaded, setLoaded] = useState({ version: null, installed: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    Promise.resolve()
      .then(() => getLocalInstallProfile())
      .then((profile) => {
        if (alive) setLoaded({ version, installed: Array.isArray(profile?.installed) ? profile.installed : [] });
      })
      .catch(() => {
        if (alive) setLoaded({ version, installed: [] });
      });
    return () => {
      alive = false;
    };
  }, [version, enabled]);
  const occupied = useMemo(
    () => (enabled && loaded.installed ? occupiedClothing(loaded.installed, { targetId, titles: paintTitles() }) : EMPTY),
    [enabled, loaded.installed, targetId],
  );
  return { occupied, ready: !enabled || (loaded.installed !== null && loaded.version === version) };
}

/** Занятые вещи текущей установки (карта слот → кто стоит); читается при монтировании. Кому нужно знать, прочитано ли, и перечитывать — `useOccupiedClothingState`. */
export function useOccupiedClothing(targetId = "") {
  return useOccupiedClothingState(targetId).occupied;
}
