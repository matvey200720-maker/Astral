/*
 * Комплект мастерской одежды (ТЗ 29.10.2026-d, голос владельца): человек собирает образ из вещей по слотам — шапка, верх, низ,
 * обувь, — каждую правит (цвет, кисть, наклейки). Правки каждого слота лежат в его черновике (`CLOTHING_DRAFTS_KEY`), поэтому
 * переключение слота их не сбрасывает; комплект — это черновики слотов, в которых что-то правили. «Применить» на комплекте
 * открывает окно со всеми изменёнными вещами (`WearOutfitDialog.jsx`), по строке на вещь: «?» → выбранная вещь GTA → наша заменёнка.
 *
 * Здесь — чистая часть без React и без сцены: какие вещи комплекта изменены, строки окна, память кадров вещей и расцветок.
 */

import { createGunProject, projectIsEmpty } from "@modovik/gun-studio";
import { variantGender } from "@modovik/clothing/gender";
import { CLOTHING_DRAFTS_KEY, draftOwner, draftSlot, readGunDraftEntries } from "../../../../../features/workshop/works/gun-draft-store.js";

export { draftOwner, draftSlot };
import { tr } from "../../../../../locales/ui.js";
import { BERD_RIVAL, WEAR_ARC_ORDER } from "./wear-slots.js";

const PREVIEWS_KEY = "astral.wear.previews.v1";
const COLOURS_KEY = "astral.wear.colours.v1";
const TEXTURES_KEY = "astral.wear.textures.v1";
/* Сколько расцветок вещи игры Desktop перебирает (`MAX_PICKS` в `clothing-models.js`): номер из этого круга. */
export const MAX_TEXTURES = 26;
/* Слоты, которые ставятся не строкой окна: у брони — цвета жилетов, свой выбор в «Применить» своей категории. Части тела окно спрашивает отдельно (`TattooPaintParts`), по части на строку. */
const SEPARATE = Object.freeze({
  armor: "бронежилет ставится из категории «Бронежилеты»: там выбирают цвета жилетов",
});

/** Черновик без единой правки (или битый) — не «изменённое». */
export function untouched(project) {
  try {
    return projectIsEmpty(project);
  } catch {
    return true;
  }
}

/** Что за вещь по её id в «Моделях»: вещь игры `game:<слот>-<номер>`, вещь каталога `catalog:<id>` или что-то своё. */
export function modelOfId(value) {
  const id = String(value || "");
  const game = /^game:([a-z-]+)-(\d+)$/.exec(id);
  if (game) return { source: "game", variant: Number(game[2]) };
  if (id.startsWith("catalog:")) return { source: "catalog", itemId: id.slice("catalog:".length) };
  return { source: id.split(":")[0] || "none" };
}

/** Что за вещь стоит в черновике (по `modelId` проекта). */
export const modelOfProject = (project) => modelOfId(project?.modelId);

const rank = (slot) => {
  const place = WEAR_ARC_ORDER.indexOf(slot);
  return place < 0 ? WEAR_ARC_ORDER.length : place;
};

/**
 * Изменённые вещи комплекта: по слоту — его черновик с правками. `live` — слот, открытый сейчас, с проектом из окна (он новее
 * записанного черновика). Порядок — по телу сверху вниз, как у дуги. Слот без правок в комплект не входит.
 */
export function changedItems({ live = null, gender = "male", storage = globalThis.localStorage } = {}) {
  let drafts = {};
  try {
    drafts = readGunDraftEntries(storage, CLOTHING_DRAFTS_KEY);
  } catch {
    drafts = {};
  }
  const sex = gender === "female" ? "female" : "male";
  const projects = new Map(
    Object.entries(drafts)
      .map(([key, entry]) => [draftOwner(key), entry?.project])
      .filter(([owner]) => owner.gender === sex)
      .map(([owner, project]) => [owner.slot, project]),
  );
  if (live?.slot) projects.set(live.slot, live.project);
  return [...projects]
    .filter(([, project]) => project && !untouched(project))
    .map(([slot, project]) => ({ slot, project, ...modelOfProject(project) }))
    .sort((a, b) => rank(a.slot) - rank(b.slot));
}

/*
 * Что надето на персонажа (ТЗ 30.10.2026): человек выбирает вещь в списке слота — она сразу надета. Надетое помнится по слотам (`слот → id вещи`), отдельно от черновиков:
 * черновик слота хранит правки и последнюю открытую вещь, а надета она или нет, решает только выбор в списке («Снять» убирает).
 */
/* Надетое — по реестру на каждый пол (14.11.2026): мужской — прежний ключ (у не трогавших женского ничего не меняется), женский — свой; комплект и список «одеть» берут реестр пола фигуры. */
const WORN_KEYS = Object.freeze({ male: "astral.wear.worn.v1", female: "astral.wear.worn.f.v1" });
const wornKey = (gender) => WORN_KEYS[gender === "female" ? "female" : "male"];
const WORN_ID = /^(?:game:[a-z-]+-\d+|catalog:.{1,120})$/;

const GAME_NUMBER = /^game:[a-z-]+-(\d+)$/;
/** Вещь игры чужого пола в этом реестре не живёт (страховка для уже испорченных записей, ревью 14.11.2026 п. 2); у вещи каталога пола в id нет — она остаётся. */
export const wornOfGender = (id, gender) => {
  const game = GAME_NUMBER.exec(String(id));
  return !game || variantGender(Number(game[1])) === (gender === "female" ? "female" : "male");
};

/** Надетое на фигуре пола `gender` (по умолчанию мужского): `{ слот: id вещи }`; битые записи и вещи игры чужого пола отброшены. */
export function readWorn(storage = globalThis.localStorage, gender = "male") {
  const all = readJson(storage, wornKey(gender));
  return Object.fromEntries(Object.entries(all).filter(([slot, id]) => /^[a-z-]+$/.test(slot) && typeof id === "string" && WORN_ID.test(id) && wornOfGender(id, gender)));
}

/** Надеть вещь `id` в слот фигуры пола `gender` или (`id` пусто) снять; возвращает новое надетое этого пола. */
export function writeWorn(storage, slot, id, gender = "male") {
  const all = readWorn(storage, gender);
  if (id && WORN_ID.test(String(id))) all[slot] = String(id);
  else delete all[slot];
  writeJson(storage, wornKey(gender), all);
  return all;
}

/**
 * Надеть вещь в слот: запись в реестр пола; соперник слота `berd` (маска ↔ борода) снимается тем же движением. Возвращает надетое после записи и слот снятого соперника (пусто — снимать было нечего).
 * Пустой `id` — снять вещь слота, соперника это не трогает.
 */
export function wearInSlot(storage, slot, id, gender = "male") {
  const rival = BERD_RIVAL[slot];
  const removed = Boolean(rival && id && readWorn(storage, gender)[rival]);
  if (removed) writeWorn(storage, rival, "", gender);
  return { worn: writeWorn(storage, slot, id, gender), rival: removed ? rival : "" };
}

/**
 * Слова слота «Борода» (14.11.2026): у штатной бороды игры модели нет — рисунок на лице, поэтому «Из GTA 5» пусто; бороды каталога — маски с подвидом, и слот открывается по данным, а не по полу
 * фигуры: женских бород в данных пока нет — слова об этом, появятся карточки — плитки встанут сами. `{ game, empty }` — `slotWords` панели слота.
 */
export const beardSlotWords = (gender = "male") => ({
  game: tr("Штатная борода в игре — рисунок на лице, не модель. Бороду из каталога можно поставить вместо любой маски: место выбирается при установке."),
  empty: gender === "female" ? tr("Женских бород пока нет — слот откроется, когда они появятся.") : tr("Бород в каталоге пока нет."),
});

/**
 * Слова слота «Причёска» (14.11.2026): в «Из GTA 5» — штатные причёски основной игры; причёски дополнений красятся палитрой игры, окно красить так пока не умеет, поэтому их нет в списке (иначе они зелёные, как листья).
 * `{ gameNote }` — `slotWords` панели слота: подпись под плитками списка «Из GTA 5».
 */
export const hairSlotWords = () => ({
  gameNote: tr("Здесь штатные причёски игры. Причёски дополнений красятся палитрой игры — они появятся, когда окно научится красить волосы так же."),
});

/** Слова о снятом сопернике: «Маска снята…» / «Борода снята…»; пусто, если никого не сняли. */
export const rivalNotice = (rival) =>
  rival === "masks"
    ? tr("Маска снята: в игре маска и борода — одно место.")
    : rival === "beards"
      ? tr("Борода снята: в игре маска и борода — одно место.")
      : "";

/**
 * Вещи комплекта для окна «Установить комплект»: всё, что надето, — а не только изменённое: заменёнкой может встать и вещь каталога как есть. Проект вещи — из живого слота или его
 * черновика; нет черновика или в нём другая вещь — чистый проект на эту вещь. Тату — только если на теле что-то нарисовано. Порядок — по телу сверху вниз.
 */
export function wornItems({ worn = {}, live = null, gender = "male", storage = globalThis.localStorage } = {}) {
  let drafts = {};
  try {
    drafts = readGunDraftEntries(storage, CLOTHING_DRAFTS_KEY);
  } catch {
    drafts = {};
  }
  const projectOf = (slot) => (live?.slot === slot ? live.project : drafts[draftSlot(slot, gender)]?.project);
  const items = Object.entries(worn)
    .filter(([slot]) => slot !== "tattoos")
    .map(([slot, id]) => {
      const project = projectOf(slot);
      return { slot, project: project && String(project.modelId) === id ? project : createGunProject({ modelId: id }), ...modelOfId(id) };
    });
  const tattoo = projectOf("tattoos");
  if (tattoo && !untouched(tattoo)) items.push({ slot: "tattoos", project: tattoo, ...modelOfProject(tattoo) });
  return items.sort((a, b) => rank(a.slot) - rank(b.slot));
}

/** Работа с тела, пусть и пустая: живой слот или его черновик. Нет ни того, ни другого — `null`. */
export function tattooDraft({ live = null, gender = "male", storage = globalThis.localStorage } = {}) {
  if (live?.slot === "tattoos") return live.project;
  try {
    return readGunDraftEntries(storage, CLOTHING_DRAFTS_KEY)[draftSlot("tattoos", gender)]?.project || null;
  } catch {
    return null;
  }
}

/** Сколько слоёв покраски у проекта вещи (сумма по деталям). */
export const layersOf = (project) => (project?.materials || []).reduce((sum, material) => sum + (material.layers?.length || 0), 0);

/** Почему вещь комплекта окно не ставит само, или пусто, если ставит. */
export function separateReason(item) {
  if (SEPARATE[item.slot]) return SEPARATE[item.slot];
  if (item.source !== "game" && item.source !== "catalog") return "своя модель в игру не ставится: Astral запекает покраску в текстуру вещи из игры или из каталога";
  return "";
}

/*
 * Строка окна «Применить» на комплекте. `describe(item)` отдаёт то, что знает студия о вещи (название, пол и вид для выбора
 * заменяемой вещи, можно ли её ставить); без неё строка собирается из черновика и названий не знает.
 */
export function outfitRows(items, { describe, previews = {}, title = (slot) => slot } = {}) {
  return items.map((item) => {
    const info = describe?.(item) || {};
    const reason = separateReason(item) || info.reason || "";
    const name = info.name || title(item.slot);
    return {
      slot: item.slot,
      title: title(item.slot),
      project: item.project,
      source: item.source,
      variant: item.variant ?? null,
      itemId: item.itemId || "",
      /* `name` — имя вещи для установки и крой (у вещи игры русское имя Desktop); `shown` — то, что видит человек: название на языке окна (17.11.2026). */
      name,
      shown: info.shown || name,
      layers: layersOf(item.project),
      wear: info.wear || null,
      base: info.base || null,
      names: info.names || [],
      cover: previews[item.slot] || info.cover || "",
      game: info.game || null,
      installable: !reason && Boolean(info.installable ?? true),
      reason,
    };
  });
}

/** Сколько вещей ждёт выбора, что она заменит: ставимые, не пропущенные и без выбора. */
export function outfitPending(rows, choices = {}, skipped = new Set()) {
  return rows.filter((row) => row.installable && !skipped.has(row.slot) && !choices[row.slot]?.targets?.length).length;
}

/** Что ставить: ставимые строки с выбором, не пропущенные; порядок — как в окне. */
export function outfitInstalls(rows, choices = {}, skipped = new Set()) {
  return rows
    .filter((row) => row.installable && !skipped.has(row.slot) && choices[row.slot]?.targets?.length)
    .map((row) => ({ row, choice: choices[row.slot] }));
}

/* --- Память: кадры вещей и расцветки каталога --- */

const readJson = (storage, key) => {
  try {
    const value = JSON.parse(storage?.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};
const writeJson = (storage, key, value) => {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

/**
 * Чья вещь на кадре: id вещи и её расцветка (номер текстуры у вещи игры, буква у вещи каталога) — сменили вещь или цвет, кадр прежней в строке комплекта больше не показывается
 * (31.10.2026: надели другой верх — в строке стоял кадр покрашенного прежнего).
 */
export const wearPreviewId = (id, { texture = null, colour = "" } = {}) => `${id}${Number.isInteger(texture) ? `#t${texture}` : ""}${colour ? `#c${colour}` : ""}`;

/**
 * Кадры покрашенных вещей по слотам: `data:`-адрес, снятый, когда слот покидали или нажимали «Применить». Запись `{ id, url }` помнит, чья вещь на кадре: `now` — `слот → wearPreviewId` того, что надето
 * сейчас, и кадр чужой вещи не отдаётся. Прежняя запись просто адресом не знает, чья она, — при `now` она не берётся (из неё и пришёл чужой кадр в строке); без `now` отдаётся как есть.
 */
export const readPreviews = (storage = globalThis.localStorage, now = null, gender = "male") => {
  const all = readJson(storage, PREVIEWS_KEY);
  const sex = gender === "female" ? "female" : "male";
  const out = {};
  for (const [key, entry] of Object.entries(all)) {
    const owner = draftOwner(key);
    if (owner.gender !== sex) continue;
    const slot = owner.slot;
    const url = typeof entry === "string" ? entry : entry?.url;
    if (typeof url !== "string" || !url.startsWith("data:image/")) continue;
    if (now && (typeof entry === "string" || !entry.id || now[slot] !== entry.id)) continue;
    out[slot] = url;
  }
  return out;
};
/** Кадр слота пола `gender` (мужской — под прежним именем слота, женский — `слот.f`, как черновик). */
export function writePreview(storage, slot, url, id = "", gender = "male") {
  const all = readJson(storage, PREVIEWS_KEY);
  slot = draftSlot(slot, gender);
  if (typeof url === "string" && url.startsWith("data:image/")) all[slot] = id ? { id: String(id), url } : url;
  else delete all[slot];
  return writeJson(storage, PREVIEWS_KEY, all);
}

/** Выбранная расцветка вещей каталога: `id вещи → буква`. Переживает смену слота: студия собирается заново. */
export const readColours = (storage = globalThis.localStorage) => {
  const all = readJson(storage, COLOURS_KEY);
  return Object.fromEntries(Object.entries(all).filter(([, letter]) => /^[a-z]$/.test(String(letter))));
};
export function writeColour(storage, itemId, letter) {
  const all = readJson(storage, COLOURS_KEY);
  if (/^[a-z]$/.test(String(letter))) all[itemId] = letter;
  else delete all[itemId];
  return writeJson(storage, COLOURS_KEY, all);
}

/** Выбранная расцветка вещей игры: `id вещи → номер текстуры` (`game:accessories-13` → 2). Нет записи — у вещи её лицо. Переживает смену слота: студия собирается заново. */
export const readTextures = (storage = globalThis.localStorage) => {
  const all = readJson(storage, TEXTURES_KEY);
  return Object.fromEntries(Object.entries(all).filter(([id, index]) => /^game:[a-z-]+-\d+$/.test(id) && Number.isInteger(index) && index >= 0 && index < MAX_TEXTURES));
};
export function writeTexture(storage, modelId, index) {
  const all = readJson(storage, TEXTURES_KEY);
  if (Number.isInteger(index) && index >= 0 && index < MAX_TEXTURES) all[modelId] = index;
  else delete all[modelId];
  return writeJson(storage, TEXTURES_KEY, all);
}

/** Запись вещи игры в одной расцветке — «плитка варианта» (30.10.2026): тот же ключ вещи, свой id и номер текстуры; снимок и чтение модели берут номер из записи. */
export const wearTextureEntry = (entry, texture) => ({ ...entry, id: `${entry.id}#t${texture}`, texture, preview: "" });
