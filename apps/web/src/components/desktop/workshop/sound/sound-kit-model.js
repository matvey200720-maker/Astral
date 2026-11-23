/*
 * Правка студии звука: что человек сделал со стволами и с попаданиями.
 *
 * Правка — не набор дорожек, а замысел: у ствола — откуда звук (голос из
 * игры, свой файл, готовый синтез) и какие ручки на нём стоят; у попадания —
 * то же для головы и для тела. Замысел ствола хранится у самого ствола
 * (`weapons[<ствол>]`): в игру он ставится только ему, и у карабина и
 * карабина MK2 могут быть два разных звука.
 * Дорожки игры, частоты и длины решаются при рендере — из таблицы голоса
 * ствола (`@modovik/sound-studio`) и бюджета банка. Поэтому правка
 * переживает и обновление игры, и смену ствола в предпросмотре: в ней нет
 * ничего, что знает только сегодняшний банк.
 *
 * Хранится в localStorage окна, как черновики остальных редакторов; свой
 * файл человека лежит в хранилище ассетов мастерской под своим хешем.
 */

import {
  DEFAULT_WEAPON_SOUND,
  HIT_SOUND_PART_IDS,
  WEAPON_SOUND_MAP,
  weaponHasVoice,
} from "@modovik/sound-studio";
import {
  normalizeSoundMix,
  soundMixIsNeutral,
  soundMixSignature,
} from "@modovik/sound-studio/sound-mix";
import { fxKey, normalizeFx } from "./sound-fx.js";
import { SYNTH_RECIPES } from "./sound-synth.js";
import { findSoundPreset } from "./sound-presets.js";
import {
  SOUND_KIT_INSTALL_KEY,
  SOUND_KIT_KEY,
  readSoundKitInstalls,
  writeSoundKitInstalls,
} from "../../../../features/workshop/sound-kit-record.js";
import { tr } from "../../../../locales/ui.js";

export {
  SOUND_KIT_INSTALL_KEY,
  SOUND_KIT_KEY,
  readSoundKitInstalls,
  writeSoundKitInstalls,
};

export const SOUND_KIT_TABS = Object.freeze(["weapons", "hits", "mix"]);

const HASH = /^[a-f0-9]{16,128}$/;
// eslint-disable-next-line no-control-regex -- вырезаются именно они
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const text = (value, limit) =>
  String(value ?? "")
    .replace(CONTROL_CHARACTERS, "")
    .slice(0, limit);

/**
 * Источник звука: голос игры, свой файл, готовый синтез или тишина (30.10.2026, владелец: «отключить звуки от себя, звуки стрельбы, чтобы от других там было слышно»).
 * Тишина — только у ствола (`allowSilent`, по умолчанию как `allowOriginal`: у попаданий её нет): выстрел игрока выключен, звука и дорожек у неё нет.
 */
export function normalizeSource(value, { allowOriginal = true, allowSilent = allowOriginal } = {}) {
  const source = value && typeof value === "object" ? value : {};
  if (source.kind === "silent" && allowSilent) return { kind: "silent" };
  if (source.kind === "file" && HASH.test(String(source.assetHash || "")))
    return {
      kind: "file",
      assetHash: String(source.assetHash),
      assetName: text(source.assetName, 80) || tr("Свой звук"),
    };
  if (source.kind === "synth" && SYNTH_RECIPES[source.recipe])
    return { kind: "synth", recipe: String(source.recipe) };
  return allowOriginal ? { kind: "original" } : null;
}

/**
 * Замысел одного звука: источник, готовый звук, с которого начали, ручки.
 *
 * Голос ствола из игры не нормализуется: «Громкость −12 дБ» у него значит
 * «на 12 дБ тише, чем в игре», а подтянутый к пику выстрел стал бы громче
 * соседних стволов ещё до ручки. Свой файл и синтез — наоборот: записи
 * бывают любой громкости, и ручка считается от выровненного пика.
 */
export function normalizeDesign(value, options = {}) {
  const design = value && typeof value === "object" ? value : null;
  if (!design) return null;
  const source = normalizeSource(design.source, options);
  if (!source) return null;
  /* Тишина: ни готового звука, ни ручек — «без обработки» нечего обрабатывать. */
  if (source.kind === "silent") return { source, preset: "", fx: normalizeFx(null) };
  const preset = findSoundPreset(design.preset) ? String(design.preset) : "";
  const fx = normalizeFx(design.fx);
  if (source.kind === "original") fx.normalize = false;
  return { source, preset, fx };
}

/*
 * Ствол без правки в проекте не хранится: «как в игре» — это его отсутствие.
 *
 * Черновик времён семей (до 26.09.2026) хранил замысел под id основного
 * ствола семьи — он и остаётся у этого ствола: соседи по семье снова звучат
 * как в игре, пока им не выберут свой звук.
 */
function normalizeWeapons(value) {
  const source = value && typeof value === "object" ? value : {};
  const weapons = {};
  for (const [id, design] of Object.entries(source)) {
    if (!WEAPON_SOUND_MAP[id]) continue;
    const normal = normalizeDesign(design);
    if (!normal) continue;
    /* Ствол без своего голоса (PDW) своего звука не получает, а выключить его выстрелы можно: тишине голос не нужен. */
    if (!weaponHasVoice(WEAPON_SOUND_MAP[id]) && normal.source.kind !== "silent") continue;
    weapons[id] = normal;
  }
  return weapons;
}

function normalizeHits(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    HIT_SOUND_PART_IDS.map((part) => [
      part,
      normalizeDesign(source[part], { allowOriginal: false }),
    ]),
  );
}

/*
 * Окружение (ТЗ 17.10.2026, задача 5) — третья часть правки: громкость
 * каналов «машины, улицы, природа, погода, люди» в дБ к игре
 * (`@modovik/sound-studio/sound-mix`). «Как в игре» — пустые `levels`.
 */
export function normalizeSoundKit(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    version: 1,
    tab: SOUND_KIT_TABS.includes(source.tab) ? source.tab : "weapons",
    weapon: WEAPON_SOUND_MAP[source.weapon] ? source.weapon : DEFAULT_WEAPON_SOUND,
    part: HIT_SOUND_PART_IDS.includes(source.part) ? source.part : "head",
    weapons: normalizeWeapons(source.weapons),
    hits: normalizeHits(source.hits),
    mix: normalizeSoundMix(source.mix),
  };
}

export function loadSoundKit(storage = globalThis.localStorage) {
  try {
    return normalizeSoundKit(JSON.parse(storage?.getItem(SOUND_KIT_KEY) || "null"));
  } catch {
    return normalizeSoundKit(null);
  }
}

export function storeSoundKit(kit, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SOUND_KIT_KEY, JSON.stringify(normalizeSoundKit(kit)));
  } catch {
    /* хранилище закрыто — правка живёт до закрытия студии */
  }
}

/* --- Работа: «Мои работы» и код -------------------------------------- */

/**
 * Снимок работы студии: замыслы стволов и частей попадания, без
 * вкладки и выбранного ствола — это вид, а не работа. Открытая работа
 * ложится в черновик (`SOUND_KIT_KEY`) как есть: разбор черновика дополнит
 * вид своими значениями.
 */
export function soundKitWorkState(kit) {
  const normal = normalizeSoundKit(kit);
  /* Окружение — только когда оно есть: снимки работ без него остаются
     прежними и совпадают с записью установки (`soundKitInstalledState`). */
  return JSON.stringify({
    version: 1,
    weapons: normal.weapons,
    hits: normal.hits,
    ...(soundMixIsNeutral(normal.mix) ? {} : { mix: normal.mix }),
  });
}

/*
 * Черновик без вида (вкладки и ствола) — снимок работы, который «Мои
 * работы» только что положили сюда: студия покажет то, что в нём звучит, а
 * не ствол, на котором её закрыли. Свой черновик студия пишет с видом.
 */
export function soundKitDraftIsWork(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage?.getItem(SOUND_KIT_KEY) || "null");
    return Boolean(raw && typeof raw === "object" && !("tab" in raw));
  } catch {
    return false;
  }
}

/** Правка из снимка работы: `{ weapons, hits, mix }` для истории студии. */
export function soundKitFromWorkState(state) {
  let parsed = null;
  try {
    parsed = typeof state === "string" ? JSON.parse(state) : state;
  } catch {
    parsed = null;
  }
  const normal = normalizeSoundKit(parsed);
  return { weapons: normal.weapons, hits: normal.hits, mix: normal.mix };
}

/** В правке нет ни одного своего звука — сохранять и передавать нечего. */
export const soundKitIsEmpty = (kit) =>
  !Object.keys(kit?.weapons || {}).length &&
  !HIT_SOUND_PART_IDS.some((part) => kit?.hits?.[part]) &&
  soundMixIsNeutral(kit?.mix);

/**
 * Правка для друга. Свой файл лежит в хранилище этого окна, и ссылка на него
 * у друга указывала бы в пустоту, — замысел со своим файлом из кода уходит,
 * а `lost` называет, какие именно: `{ kind: "weapon", id, title }` — ствол,
 * `{ kind: "hit", part }` — часть попадания. Готовые звуки и
 * обработка голоса игры уезжают целиком: их у друга соберёт его Astral.
 */
export function shareableSoundKit(kit) {
  const normal = normalizeSoundKit(kit);
  const lost = [];
  const weapons = {};
  for (const [id, design] of Object.entries(normal.weapons)) {
    if (design.source.kind === "file")
      lost.push({ kind: "weapon", id, title: WEAPON_SOUND_MAP[id].title });
    else weapons[id] = design;
  }
  const hits = {};
  for (const part of HIT_SOUND_PART_IDS) {
    const design = normal.hits[part];
    if (design?.source.kind === "file") lost.push({ kind: "hit", part });
    hits[part] = design?.source.kind === "file" ? null : design;
  }
  /* Окружение — одни числа: уезжает целиком. */
  return { kit: { version: 1, weapons, hits, mix: normal.mix }, lost };
}

/** Замысел из готового звука: его источник и ручки. */
export function designFromPreset(preset) {
  return normalizeDesign({
    source: preset.source,
    preset: preset.id,
    fx: preset.fx,
  });
}

/* FNV-1a, 32 бита: отпечаток для сравнения, а не для защиты. */
function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Выстрелы выключены: замысел — тишина, звука у него нет. */
export const designIsSilent = (design) => design?.source?.kind === "silent";

/** Тишина как замысел ствола: одна на все стволы. */
export const SILENT_DESIGN = Object.freeze({
  source: Object.freeze({ kind: "silent" }),
  preset: "",
  fx: Object.freeze(normalizeFx(null)),
});

/** Отпечаток звука: источник и все ручки — то, от чего зависят сэмплы. */
export function designSignature(design) {
  if (!design) return "";
  const source = design.source;
  /* Тишина: ручек нет, отпечаток один (не `v1:…` — он у звуков). */
  if (source.kind === "silent") return "silent:1";
  const origin =
    source.kind === "file"
      ? `file:${source.assetHash}`
      : source.kind === "synth"
        ? `synth:${source.recipe}`
        : "original";
  return `v1:${fnv1a(`${origin}|${fxKey(design.fx)}`)}`;
}

/** Отпечаток окружения: каналы со сдвигом по порядку пульта. */
export const mixSignature = (mix) => soundMixSignature(mix);

/** Отпечаток набора попаданий: обе части по порядку. */
export const hitsSignature = (hits) =>
  HIT_SOUND_PART_IDS.map((part) => `${part}=${designSignature(hits?.[part])}`).join(";");

/** Как звук называется на карточке библиотеки: готовый звук или свой файл. */
export function designTitle(design) {
  if (!design) return "";
  if (designIsSilent(design)) return tr("Без своих выстрелов");
  if (design.source?.kind === "file") return design.source.assetName;
  const preset = findSoundPreset(design.preset);
  if (preset) return preset.title;
  return design.source?.kind === "original" ? tr("Голос игры с обработкой") : tr("Свой звук");
}
