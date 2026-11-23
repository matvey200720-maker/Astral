/*
 * Тату на теле как части (голос владельца 01.11.2026): «поставить себе татуировку на руку, начать её редактировать, разрисовать руку как ему угодно, потом применить, и у него такие же вопросы появляются,
 * как он хочет заменить эти татуировки … каждая татуировка по отдельности».
 *
 * Выбранное тату игры — слой-картинка с ключом тату (`layer.tattoo`) на своей зоне и на своём месте, остальное на зоне — свой рисунок. «Применить» спрашивает про каждую часть отдельно:
 *  - тату игры — своей строкой (`tattoo:<ключ>`, с двойником за швом);
 *  - рисунок зоны — своей строкой на зону (`drawn:<материал>`): кисть, надписи, наклейки этой части тела.
 * Здесь — чистые функции: части проекта, рамка тату на холсте зоны, что с частью будет на выбранном тату (`partVerdict`) и что ушло в установку (`partPicks`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { TATTOO_ZONES, zoneOfMaterial } from "@modovik/clothing/tattoo-zones";
import { inkOutsideFrame, inkRegions, planTattooPlaces } from "@modovik/clothing/tattoo-place";
import { byCost, useFoundGameRoot, useGameTattooList } from "./tattoo-set.js";
import { sameInstalledWork } from "../workshop/install-queue/tasks/clothing-paint-slots.js";

/* Рамка в полторы трети обхвата или почти во всю высоту зоны: картинка тату растянется — в игре рисунок мягче. */
const bigFrame = (decoration) => decoration && (decoration.scale.x > 0.25 || decoration.scale.y > 0.4);

/* Допуск сравнения «слой стоит там, где его поставила игра»: проценты холста зоны и градусы. */
const NEAR = 0.05;
const near = (left, right) => Math.abs(Number(left) - Number(right)) <= NEAR;
/* До 01.11.2026 проект обрезал место слоя до −50…150: двойник рамки шире зоны лёг в черновик обрезанным, и это всё ещё нетронутое тату. */
const oldClamp = (value) => Math.min(150, Math.max(-50, value));

/** Запись памяти установок о теле: у каждого пола своя. */
export const tattooBodyKey = (gender) => (gender === "female" ? "tattoos:body:female" : "tattoos:body");

/** Какая это работа для памяти установок: сохранённая работа — своя, правка без сохранения — одна на тело (`linked` — `linkedEditorWork`). */
export const tattooWorkId = (linked) => linked?.id || "draft";

/**
 * Что уже стоит в игре от работ этого тела (`record` — запись памяти установок, `identity` — `{ workId, name }`): `own` — тату этой работы, `others` — тату чужих работ. `Map<ключ тату, { title, work }>`.
 */
export function tattooWorkMemo(record, identity = {}) {
  const own = new Map();
  const others = new Map();
  const chosen = new Map();
  for (const work of record ? (record.works?.length ? record.works : [record]) : []) {
    const mine = sameInstalledWork(work, identity);
    const list = mine ? own : others;
    const items = work.packages?.length ? work.packages : work.targets || [];
    for (const item of items) if (item?.key) list.set(item.key, { title: item.title || item.key, work: String(work.name || "") });
    /* Что на какое тату выбрали в прошлый раз: «Применить» открывается с этим выбором, а не с «?». */
    if (mine) for (const item of work.chosen || []) if (item?.part && item.target) chosen.set(item.part, item.target);
  }
  return { own, others, chosen };
}

/**
 * Где на детали зоны лежит рамка тату: центр слоя (`x`, `y` — проценты детали), ширина (`scale` — процент ширины детали), поворот слоя и двойники за швом (`twins` — `x` второго слоя).
 * `width`, `height` — размер детали в точках. `flipX`, `flipY` — рамка с отрицательным размером: игра рисует картинку зеркально («Акула», «Красивый глаз»).
 */
export function tattooDesignLayout(tattoo, { width, height }) {
  const frameWidth = 2 * Math.abs(Number(tattoo.scale?.x ?? 0.5)) * width;
  const frameHeight = 2 * Math.abs(Number(tattoo.scale?.y ?? 0.5)) * height;
  const centre = Number(tattoo.uv?.x ?? 0.5);
  const x = (centre - Math.floor(centre)) * 100;
  const y = (1 - Number(tattoo.uv?.y ?? 0.5)) * 100;
  /* Поворот игры — против часовой при V вверх; у холста V вниз. */
  const rotation = ((((-Number(tattoo.rotation || 0) + 180) % 360) + 360) % 360) - 180;
  const angle = (rotation * Math.PI) / 180;
  const reach = ((Math.abs(Math.cos(angle)) * frameWidth + Math.abs(Math.sin(angle)) * frameHeight) / 2 / width) * 100;
  const twins = [];
  if (x - reach < 0) twins.push(x + 100);
  if (x + reach > 100) twins.push(x - 100);
  return {
    x,
    y,
    scale: (frameWidth / width) * 100,
    rotation,
    twins,
    frameWidth,
    frameHeight,
    flipX: Number(tattoo.scale?.x ?? 0.5) < 0,
    flipY: Number(tattoo.scale?.y ?? 0.5) < 0,
  };
}

/** Ключи тату игры на теле: по слоям проекта, как их видит окно (отмена и возврат работают сами). */
export function pickedTattooKeys(project) {
  const keys = new Set();
  for (const material of project?.materials || []) for (const layer of material.layers || []) if (layer.tattoo) keys.add(layer.tattoo);
  return keys;
}

/**
 * Части работы: тату игры — каждое своей частью, остальные видимые слои зоны — одной частью этой зоны. `stickerMaterials` — на каких зонах лежат напечатанные наклейки (их знает только сцена витрины):
 * они едут с рисунком своей зоны. Наклейки есть, а где они — неизвестно (на персонаже или из другой категории они не печатаются) — часть `stickers` без зоны: окно говорит, откуда её ставить.
 */
export function tattooPartsOf(project, { stickerMaterials = null } = {}) {
  const parts = [];
  const known = stickerMaterials ? new Set(stickerMaterials) : new Set();
  for (const zone of TATTOO_ZONES) {
    const material = (project?.materials || []).find((item) => item.name === zone.material);
    const layers = (material?.layers || []).filter((layer) => layer.visible !== false);
    const games = new Map();
    const drawn = [];
    for (const layer of layers) {
      if (!layer.tattoo) {
        drawn.push(layer.id);
        continue;
      }
      if (!games.has(layer.tattoo)) games.set(layer.tattoo, []);
      games.get(layer.tattoo).push(layer.id);
    }
    for (const [tattoo, ids] of games) parts.push({ id: `tattoo:${tattoo}`, kind: "tattoo", tattoo, zone: zone.key, material: zone.material, layers: ids, stickers: false });
    const stickers = known.has(zone.material);
    if (drawn.length || stickers) parts.push({ id: `drawn:${zone.material}`, kind: "drawn", tattoo: "", zone: zone.key, material: zone.material, layers: drawn, stickers });
  }
  if (!stickerMaterials && (project?.stickers || []).some((sticker) => sticker.visible !== false))
    parts.push({ id: "stickers", kind: "stickers", tattoo: "", zone: "", material: "", layers: [], stickers: true });
  return parts;
}

/** Часть уже можно ставить: у неё есть зона. Наклейки неизвестной зоны — только словами. */
export const partPlaceable = (part) => Boolean(part?.zone);

const layersOf = (project, part) => {
  const material = (project?.materials || []).find((item) => item.name === part.material);
  return (material?.layers || []).filter((layer) => part.layers.includes(layer.id));
};

/**
 * Что сделали со слоями тату игры: `atHome` — стоит на месте игры, с её размером и поворотом; `asGame` — ещё и нетронут (прозрачность, режим, маска). Такое тату на своём же тату ставить незачем:
 * в игре оно уже такое.
 */
export function partStateOf(project, part, tattoo) {
  if (part?.kind !== "tattoo" || !tattoo) return { atHome: false, asGame: false };
  const width = 1024;
  const layout = tattooDesignLayout(tattoo, { width, height: 1024 });
  const layers = layersOf(project, part);
  const atHome =
    layers.length > 0 &&
    layers.every((layer) => (near(layer.x, layout.x) || layout.twins.some((twin) => near(layer.x, twin) || near(layer.x, oldClamp(twin)))) && near(layer.y, layout.y) && near(layer.scale, layout.scale) && near(layer.rotation, layout.rotation));
  const asGame = atHome && layers.every((layer) => Number(layer.opacity ?? 100) === 100 && (layer.blend || "source-over") === "source-over" && !layer.mask && !layer.clip);
  return { atHome, asGame };
}

/**
 * На какие тату игры может лечь часть: той же части тела и того же пола. У тату игры сначала оно само (исходное), дальше дешёвые — как у набора каталога (`targetsFor`), у рисунка — сразу дешёвые.
 */
export function partTargets(tattoos, part, { gender = "male", taken = new Set() } = {}) {
  const own = part?.kind === "tattoo" ? part.tattoo : "";
  return tattoos
    .filter((tattoo) => tattoo.zone === part?.zone && (!tattoo.gender || tattoo.gender === gender) && !taken.has(tattoo.key))
    .sort((left, right) => Number(right.key === own) - Number(left.key === own) || byCost(left, right));
}

/** Чернила части: пятна и картинка зоны — из того, что отдал холст (`{ width, height, data }`). */
export function inkOf(part, image) {
  const zone = zoneOfMaterial(part.material);
  if (!image || zone < 0) return null;
  const { regions } = inkRegions([{ zone, width: image.width, height: image.height, data: image.data }]);
  return { regions, image };
}

/**
 * Что будет с частью на выбранном тату — то, что считает и Desktop при сборке (`planTattooPlaces`):
 *  - `same` — исходное тату нетронутым на своём месте: ставить нечего;
 *  - `restore` — то же, но в игре на нём стоит прежняя правка этой работы: она снимется (`memo` — `tattooWorkMemo`);
 *  - `empty` — чернил нет (слой скрыт маской, картинка пуста);
 *  - `none` — нет цели или чернила не прочитались: неизвестно, что ставить;
 *  - `keep` — рисунок лежит в рамке тату, тату остаётся на месте;
 *  - `move` — рисунок не лежит в рамке: рамка тату в игре переедет под рисунок; `outside` — сколько рисунка за нынешней рамкой;
 *  - `lost` — тату не переносится (его коллекцию игры правка не берёт): `outside` рисунка в игру не попадёт.
 */
export function partVerdict({ part, target, ink, state = {}, memo = null }) {
  if (!target) return { action: "none", outside: 0, soft: false };
  if (part.kind === "tattoo" && part.tattoo === target.key && state.asGame) return { action: memo?.own?.has(target.key) ? "restore" : "same", outside: 0, soft: false };
  if (part.kind === "tattoo" && part.tattoo === target.key && state.atHome) return { action: "keep", outside: 0, soft: false };
  if (!ink?.regions?.length) return { action: ink ? "empty" : "none", outside: 0, soft: false };
  const { places } = planTattooPlaces({ targets: [{ ...target, movable: Boolean(target.xml?.patch) }], regions: ink.regions });
  const place = places[0];
  const outside = place.action === "keep" ? 0 : inkOutsideFrame(ink.image, target);
  if (place.action === "keep") return { action: "keep", outside: 0, soft: false };
  if (place.action === "move") return { action: "move", outside, soft: Boolean(bigFrame(place.decoration)) };
  return { action: "lost", outside, soft: false };
}

/**
 * Выбор при открытии окна (голос владельца 01.11.2026: «идут со знаком вопроса: на какую татуировку хотят поставить заменёнку, это выбирают»): на строке «?», тату выбирает человек. Исключение — прошлая установка этой работы:
 * та же часть открывается с прежним тату (`memo.chosen`), если оно ещё свободно, — иначе повторное «Применить» с «?» снимало бы всё, что уже стоит. Части без тату этой части тела ставить не на что — строка без отметки.
 */
export function defaultPartChoices(tattoos, parts, gender = "male", memo = null) {
  const taken = new Set();
  const choices = {};
  for (const part of parts) {
    const options = partTargets(tattoos, part, { gender, taken });
    /* Работа, поставленная до этой записи памяти: тату игры на своём же месте узнаётся и так. */
    const earlier = memo?.chosen?.get(part.id) || (part.kind === "tattoo" && memo?.own?.has(part.tattoo) ? part.tattoo : "");
    const target = earlier ? options.find((item) => item.key === earlier) : null;
    choices[part.id] = { on: options.length > 0, target: target?.key || "" };
    if (target) taken.add(target.key);
  }
  return choices;
}

/** Сколько строк ещё ждут выбора: отметка стоит, а тату — «?». Пока такие есть, «Установить» не нажать. */
export function waitingParts(parts, choices) {
  return parts.filter((part) => partPlaceable(part) && choices?.[part.id]?.on && !choices[part.id].target).length;
}

/**
 * Что выбрано на деле: цель одна на часть. Часть, чья цель уже занята частью выше (выбрали, пока она была выключена), считается выключенной — и в строке, и в счётчике кнопки, и в установке.
 */
export function effectivePartChoices(parts, choices) {
  const taken = new Set();
  const out = {};
  for (const part of parts) {
    const choice = choices?.[part.id];
    const on = Boolean(choice?.on && choice.target && !taken.has(choice.target));
    if (on) taken.add(choice.target);
    out[part.id] = { on, target: choice?.target || "" };
  }
  return out;
}

/**
 * Что уходит в установку: включённые части на выбранном тату, кроме нетронутых на своём же месте. `stay` — тату на своём же месте, рамку не трогать: у повёрнутой рамки прямоугольник чернил в неё не
 * вписывается, и план счёл бы, что тату надо двигать.
 */
export function partPicks({ parts, choices, tattoos, project, inks = new Map(), memo = null }) {
  const out = [];
  const actual = effectivePartChoices(parts, choices);
  for (const part of parts) {
    const choice = actual[part.id];
    if (!choice.on || !partPlaceable(part)) continue;
    const target = tattoos.find((tattoo) => tattoo.key === choice.target);
    if (!target) continue;
    const state = partStateOf(project, part, tattoos.find((tattoo) => tattoo.key === part.tattoo));
    const verdict = partVerdict({ part, target, ink: inks.get(part.id), state, memo });
    /* Ставить нечего: как в игре, нет чернил или они не прочитались, а рисунок вне рамки тату, которое не переносится, Desktop отложил бы в «не легло». */
    if (["same", "restore", "empty", "none", "lost"].includes(verdict.action)) continue;
    out.push({
      part: { id: part.id, kind: part.kind, material: part.material, layers: part.layers, stickers: part.stickers },
      target: { key: target.key, title: target.title, name: target.title },
      stay: part.kind === "tattoo" && part.tattoo === target.key && state.atHome,
    });
  }
  return out;
}

/**
 * Что от этой работы снимется из игры: тату, где стоит её прежняя правка, а новая установка на них ничего не кладёт (цель сменили, тату сняли с тела или вернули к исходному, «Не ставить»).
 */
export function retiredTattoos(memo, picks, tattoos = []) {
  const staying = new Set(picks.map((pick) => pick.target.key));
  const byKey = new Map((tattoos || []).map((tattoo) => [tattoo.key, tattoo]));
  /* Тату из списка игры называется на языке окна (`tattooTitle`, 17.11.2026); нет в списке — запомненное имя, как было. */
  return [...(memo?.own || [])].filter(([key]) => !staying.has(key)).map(([key, item]) => ({ key, title: item.title, ...(byKey.has(key) ? { tattoo: byKey.get(key) } : {}) }));
}

/** Тату, чья картинка общая у мужского и женского тела (`txd` есть у обеих версий): заменишь — изменится у обоих. */
export function sharedTattooKeys(tattoos) {
  const sides = new Map();
  for (const tattoo of tattoos) {
    const id = String(tattoo.txd || "").toLowerCase();
    if (!id || !tattoo.gender) continue;
    if (!sides.has(id)) sides.set(id, new Set());
    sides.get(id).add(tattoo.gender);
  }
  return new Set(tattoos.filter((tattoo) => sides.get(String(tattoo.txd || "").toLowerCase())?.size > 1).map((tattoo) => tattoo.key));
}

/**
 * Окну установки: тату игры, выбор по частям, чернила и что уходит в установку. `readInks(parts)` отдаёт `Map<id части, { width, height, data, thumb }>`: картинку части с холста (`thumb` — кадр строки).
 * Пиксели живут только здесь, в состоянии: в пропсы строк идут адрес кадра и готовые слова. `memo` — что уже стоит в игре (`tattooWorkMemo`); `retired` — что снимется.
 */
export function useTattooPartChoices({ parts, gameRoot = "", gender = "male", project, readInks = null, memo = null }) {
  const { root, detecting } = useFoundGameRoot(gameRoot);
  const { status, tattoos, error } = useGameTattooList(root);
  const [inks, setInks] = useState(null);
  useEffect(() => {
    let alive = true;
    void Promise.resolve(readInks ? readInks(parts) : new Map())
      .catch(() => new Map())
      .then((images) => {
        if (!alive) return;
        const read = new Map();
        for (const part of parts) {
          const image = images?.get(part.id);
          const ink = image ? inkOf(part, image) : null;
          if (ink) read.set(part.id, { ...ink, thumb: image.thumb || "" });
        }
        setInks(read);
      });
    return () => {
      alive = false;
    };
  }, [parts, readInks]);
  const [choices, setChoices] = useState(null);
  useEffect(() => {
    if (status === "ready" && inks) setChoices((current) => current || defaultPartChoices(tattoos, parts, gender, memo));
  }, [status, tattoos, parts, inks, gender, memo]);
  const picks = useMemo(() => (choices && inks ? partPicks({ parts, choices, tattoos, project, inks, memo }) : []), [parts, choices, tattoos, project, inks, memo]);
  const retired = useMemo(() => retiredTattoos(memo, picks, tattoos), [memo, picks, tattoos]);
  const set = useCallback((id, patch) => setChoices((current) => ({ ...current, [id]: { ...current?.[id], ...patch } })), []);
  const shared = useMemo(() => sharedTattooKeys(tattoos), [tattoos]);
  return { root, status, error, pending: detecting || status === "idle" || status === "loading" || (status === "ready" && !choices), waiting: waitingParts(parts, choices), tattoos, choices, inks, picks, retired, memo, set, shared };
}
