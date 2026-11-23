import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import { readStoredJson } from "../../../stored-json.js";
import {
  forgetSection,
  remember,
  rememberedValue,
} from "../../../section-memory.js";
import { currentStudioProjectId } from "./studio-current.js";
import {
  EFFECTS_PART_KINDS,
  WORK_KINDS,
  gunSlotOf,
  linkKeyOf,
  studioKindOfModules,
  workKindOf,
} from "./work-kinds.js";
import {
  CLOTHING_DRAFTS_KEY,
  draftGenderOf,
  draftSlot,
  GUN_DRAFTS_KEY,
  putGunDraftEntry,
} from "./gun-draft-store.js";
import {
  SOUND_KIT_INSTALL_KEY,
  SOUND_KIT_KEY,
  soundKitInstalledState,
} from "../sound-kit-record.js";
import { installedOptimizationLayerIds } from "../optimization-layer-records.js";
import { OPTIMIZATION_SET_RECORD_KEY } from "@modovik/optimizer/layer-ids.js";
import { requestOptimizerFocus } from "../optimizer-focus.js";

/*
 * «Мои работы» — то, что человек в мастерской СОХРАНИЛ.
 *
 * Работа появляется здесь двумя путями и только ими:
 *
 *   • «Сохранить в мои работы» в меню «⋯» редактора;
 *   • «Добавить шаблон» — код, которым поделился друг или сам человек.
 *
 * «Применить» работ не заводит (владелец, 24.09.2026): прежде каждое
 * применение ложилось сюда само, и список набивался тем, что человек просто
 * пробовал в игре, — а то, что он хотел оставить, терялось среди этого.
 * Что стоит в игре — вопрос библиотеки, а не этого списка.
 *
 * Работы бывают двух родов:
 *
 *   • снимки отдельных редакторов (трейсеры, попадания, огонь, небо,
 *     килл-эффект, звуки) — лежат здесь целиком. Редактор держит свою
 *     правку в своём ключе хранилища, а работа — сохранённая копия правки.
 *     Правка, пока её не сохранили, работу не меняет: «Сохранить» обновляет
 *     работу, из которой редактор открыт (`linked`), или заводит новую;
 *   • проекты студии (мини-карта, прицел, большая карта, залазы) — лежат в
 *     хранилище проектов, как и лежали; здесь только отметка, что проект
 *     сохранён в «Мои работы» (`studio`). Проект студии — документ: её
 *     «Сохранить» и «Применить» пишут в него же.
 *
 * Трейсеры, попадания и огонь уезжают в игру одним патчем, но работа у
 * каждого своя (`part`): человек, сохранивший трассер, сохранил трассер, а не
 * заодно свою кровь и огонь.
 *
 * Всё лежит на этом компьютере: хранилище окна Astral переживает перезапуск,
 * а делятся работами кодом (`work-code.js`), а не облаком.
 */

export const WORKS_KEY = "astral.workshop.works.v1";
const PROJECTS_KEY = "astral-workshop-projects-v1";
/* «Мои пресеты» студии эффектов — до «Моих работ» они жили на полке
   редактора. Переезжают сюда один раз и насовсем. */
export const LEGACY_EFFECTS_PRESETS_KEY = "astral.ptfx.presets.v1";
const STORE_VERSION = 2;
const MAX_WORKS = 200;
/* Небо всех пятнадцати погод весит под мегабайт в развёрнутом виде; в
   работу ложится сжатая строка без отступов. */
const MAX_STATE_BYTES = 1024 * 1024;

/*
 * Большой снимок — сжатым (12.10, сквозная проверка редуксов; зона
 * мастерской, правка сессии редуксов по решению ведущего: владельца
 * «Моих работ» сейчас нет, а это блокер). Небо редукса — 0,88 млн символов
 * (15 погод × 2 региона × 424 параметра × 13 точек), и после трёх-четырёх
 * открытых редуксов `localStorage` окна переполнялся: «Редактировать» неба
 * отвечало «Операция не удалась». Сжатое — около 20 тысяч символов (в 44
 * раза меньше).
 *
 * Снимок больше `PACK_FROM` пишется как `z1:` + base64(deflate(UTF-8));
 * читаются оба вида, и прежние записи сжимаются при следующем сохранении
 * «Моих работ». Наружу снимок всегда выходит развёрнутым.
 */
const PACK_FROM = 64 * 1024;
const PACKED = "z1:";

function toBase64(bytes) {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1)
    bytes[at] = binary.charCodeAt(at);
  return bytes;
}

/** Снимок для хранилища: большой — сжатым, малый — как есть. */
export function packWorkState(state) {
  if (typeof state !== "string" || state.length < PACK_FROM) return state;
  return PACKED + toBase64(deflateSync(strToU8(state), { level: 6 }));
}

/*
 * Список работ читается заново при каждом входе в библиотеку и сборки (несколько раз за вход), а хранилище за это время
 * не меняется. На настоящем окне владельца (31.10.2026, beta.82) разжатие и сверка больших снимков неба стоили ~1,3 с на
 * вход: страница стояла 1,6 с при свободном процессоре и до 5 с под нагрузкой. Обе дорогие операции помнят последний ответ
 * по самим строкам: снимок сменился — считаем заново.
 */
const REMEMBERED_STATES = 64;
const unpackedStates = new Map();

/** Снимок из хранилища — развёрнутым; битый сжатый — `null`. */
export function unpackWorkState(stored) {
  if (typeof stored !== "string" || !stored.startsWith(PACKED)) return stored;
  if (unpackedStates.has(stored)) return unpackedStates.get(stored);
  let state = null;
  try {
    state = strFromU8(inflateSync(fromBase64(stored.slice(PACKED.length))));
  } catch {
    state = null;
  }
  if (unpackedStates.size >= REMEMBERED_STATES) unpackedStates.delete(unpackedStates.keys().next().value);
  unpackedStates.set(stored, state);
  return state;
}

/**
 * Есть ли в наборе трассер, который едет в игру.
 *
 * Снимок читается как есть, без разбора проекта: этот модуль стоит в
 * стартовом куске каталога, и тянуть сюда всю мастерскую эффектов ради одного
 * вопроса незачем. Пятая схема — список трассеров, едет тот, у кого есть
 * оружие; прежние — один след с выключателем.
 */
export function effectsTracerActive(tracer) {
  if (Array.isArray(tracer?.profiles))
    return tracer.profiles.some(
      (profile) =>
        profile?.mode === "all" ||
        (Array.isArray(profile?.weapons) && profile.weapons.length > 0),
    );
  return tracer?.enabled === true;
}

const pluralRu = (count, one, few, many) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

const parseState = (state) => {
  try {
    return typeof state === "string" ? JSON.parse(state) : state;
  } catch {
    return null;
  }
};

/** Какие части набора эффектов в снимке не пусты. */
export function effectsPartsOf(state) {
  const project = parseState(state);
  if (!project || typeof project !== "object") return [];
  return [
    ...(effectsTracerActive(project.tracer) ? ["tracer"] : []),
    ...(project.impact?.enabled &&
    (project.impact.removeAll === true ||
      Object.values(project.impact.zones || {}).some((zone) => zone?.enabled))
      ? ["impact"]
      : []),
    ...(Object.values(project.environment || {}).some(
      (family) => family?.enabled,
    )
      ? ["environment"]
      : []),
  ];
}

/**
 * Что в наборе эффектов — словами: «2 трассера · попадания · огонь и
 * взрывы». Набор один на три редактора, и подпись «Эффекты» не говорила,
 * какой из трёх в нём есть.
 */
export function effectsWorkSummary(state) {
  const project = parseState(state);
  if (!project || typeof project !== "object") return "";
  const parts = [];
  /* «Без трассера» — не трассер, а его отсутствие: считается отдельно. */
  const riding = Array.isArray(project.tracer?.profiles)
    ? project.tracer.profiles.filter((profile) =>
        effectsTracerActive({ profiles: [profile] }),
      )
    : [];
  const profiles = Array.isArray(project.tracer?.profiles)
    ? riding.filter((profile) => profile.off !== true).length
    : project.tracer?.enabled === true
      ? 1
      : 0;
  if (profiles)
    parts.push(
      `${profiles} ${pluralRu(profiles, "трассер", "трассера", "трассеров")}`,
    );
  if (riding.some((profile) => profile.off === true)) parts.push("без трассера");
  const kinds = effectsPartsOf(project);
  if (kinds.includes("impact")) parts.push("попадания");
  if (kinds.includes("environment")) parts.push("огонь и взрывы");
  return parts.join(" · ");
}

/*
 * Отдельные редакторы. `storageKey` — где редактор держит правку между
 * запусками, `memoryKey` — память раздела, если правка живёт и там (у
 * килл-эффекта — вместе с историей `{ present, past, future }`).
 * `installKey` — запись установки `useInstallRecord`.
 */
export const EDITOR_WORKS = Object.freeze({
  timecycle: Object.freeze({
    section: "redux",
    storageKey: "astral.timecycle.project.v1",
    installKey: "astral.timecycle.install.v1",
  }),
  "kill-effect": Object.freeze({
    section: "redux",
    memoryKey: "killEffect:project",
    storageKey: "astral.kill-effect.project.v1",
    installKey: "astral.kill-effect.install.v1",
  }),
  /* След на экране: нативный патч (visualsettings.dat и graphics.ytd). */
  "screen-hits": Object.freeze({
    section: "redux",
    storageKey: "astral.screen-hits.project.v1",
    installKey: "astral.screen-hits.install.v1",
  }),
  /* Метки и GPS: нативный патч (hudcolor.dat, minimap.ytd, paths.rpf). */
  gps: Object.freeze({
    section: "redux",
    storageKey: "astral.gps.project.v1",
    installKey: "astral.gps.install.v1",
  }),
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026): нативный патч mp_gamer_info.gfx. */
  "target-hp": Object.freeze({
    section: "redux",
    storageKey: "astral.target-hp.project.v1",
    installKey: "astral.target-hp.install.v1",
  }),
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер): нативный патч листов script_txds.rpf. */
  "group-markers": Object.freeze({
    section: "redux",
    storageKey: "astral.group-markers.project.v1",
    installKey: "astral.group-markers.install.v1",
  }),
  /* «Дым из-под колёс» (ТЗ 11.10.2026, вечер): нативный патч ядра и wheelfx.dat. */
  "wheel-smoke": Object.freeze({
    section: "redux",
    storageKey: "astral.wheel-smoke.project.v1",
    installKey: "astral.wheel-smoke.install.v1",
  }),
  /* Фонари: запись установки бывает и без точки отката — одним модом слоя
     (`layerModId`), когда файлы update.rpf работе не понадобились. */
  lamps: Object.freeze({
    section: "redux",
    storageKey: "astral.lamps.project.v1",
    installKey: "astral.lamp-studio.install.v1",
  }),
  /* Прострелы: запись установки — один мод слоя (`layerModId`). */
  wallbang: Object.freeze({
    section: "redux",
    storageKey: "astral.wallbang.project.v1",
    installKey: "astral.wallbang.install.v1",
  }),
  /* Наборы перекраски: запись установки — один мод слоя (`layerModId`)
     в своём контейнере, как у прострелов. */
  zones: Object.freeze({
    section: "redux",
    storageKey: "astral.zones.project.v1",
    installKey: "astral.zones.install.v1",
  }),
  factory: Object.freeze({
    section: "redux",
    storageKey: "astral.factory.project.v1",
    installKey: "astral.factory.install.v1",
  }),
  hangar: Object.freeze({
    section: "redux",
    storageKey: "astral.hangar.project.v1",
    installKey: "astral.hangar.install.v1",
  }),
  mapping: Object.freeze({
    section: "redux",
    storageKey: "astral.mapping.project.v1",
    installKey: "astral.mapping.install.v1",
  }),
  water: Object.freeze({
    section: "redux",
    storageKey: "astral.water.project.v1",
    installKey: "astral.water.install.v1",
  }),
  vegetation: Object.freeze({
    section: "redux",
    storageKey: "astral.vegetation.project.v1",
    installKey: "astral.vegetation.install.v1",
  }),
  arenas: Object.freeze({
    section: "redux",
    storageKey: "astral.arenas.project.v1",
    installKey: "astral.arenas.install.v1",
  }),
  /* Мегамолл: запись установки — один мод слоя (`layerModId`). */
  megamall: Object.freeze({
    section: "redux",
    storageKey: "astral.megamall.project.v1",
    installKey: "astral.megamall.install.v1",
  }),
  /* «Ашан / Икея»: запись установки — один мод слоя (`layerModId`). */
  youtool: Object.freeze({
    section: "redux",
    storageKey: "astral.youtool.project.v1",
    installKey: "astral.youtool.install.v1",
  }),
  /* «Вайнвуд»: запись установки — один мод слоя (`layerModId`). */
  vinewood: Object.freeze({
    section: "redux",
    storageKey: "astral.vinewood.project.v1",
    installKey: "astral.vinewood.install.v1",
  }),
  /* «Остановки»: запись установки — один мод слоя (`layerModId`). */
  busstops: Object.freeze({
    section: "redux",
    storageKey: "astral.busstops.project.v1",
    installKey: "astral.busstops.install.v1",
  }),
  /* «МСЛ-зоны»: запись установки — один мод слоя (`layerModId`). */
  mslzones: Object.freeze({
    section: "redux",
    storageKey: "astral.mslzones.project.v1",
    installKey: "astral.mslzones.install.v1",
  }),
  /* «Летающее лого»: запись установки — один мод слоя (`layerModId`). */
  floatlogo: Object.freeze({
    section: "redux",
    storageKey: "astral.floatlogo.project.v1",
    installKey: "astral.floatlogo.install.v1",
  }),
  /* «Дирижабли» (ТЗ 11.10.2026): запись установки — один мод слоя (`layerModId`). */
  airships: Object.freeze({
    section: "redux",
    storageKey: "astral.airships.project.v1",
    installKey: "astral.airships.install.v1",
  }),
  /* «Интерьеры»: запись установки — один мод слоя (`layerModId`). */
  shops: Object.freeze({
    section: "redux",
    storageKey: "astral.shops.project.v1",
    installKey: "astral.shops.install.v1",
  }),
  /* «Билборды»: запись установки — один мод слоя (`layerModId`). */
  billboards: Object.freeze({
    section: "redux",
    storageKey: "astral.billboards.project.v1",
    installKey: "astral.billboards.install.v1",
  }),
  /* «Зоны каптов»: запись установки — один мод слоя (`layerModId`). */
  captzones: Object.freeze({
    section: "redux",
    storageKey: "astral.captzones.project.v1",
    installKey: "astral.captzones.install.v1",
  }),
  /* «Расписание»: запись установки — один мод слоя (`layerModId`). */
  schedule: Object.freeze({
    section: "redux",
    storageKey: "astral.schedule.project.v1",
    installKey: "astral.schedule.install.v1",
  }),
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер): запись установки — один мод слоя (`layerModId`). */
  flags: Object.freeze({
    section: "redux",
    storageKey: "astral.flags.project.v1",
    installKey: "astral.flags.install.v1",
  }),
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026): запись установки — один мод слоя (`layerModId`). */
  atms: Object.freeze({
    section: "redux",
    storageKey: "astral.atms.project.v1",
    installKey: "astral.atms.install.v1",
  }),
  /* «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер): запись установки — один мод слоя (`layerModId`). */
  projectinteriors: Object.freeze({
    section: "redux",
    storageKey: "astral.projectinteriors.project.v1",
    installKey: "astral.projectinteriors.install.v1",
  }),
  /* «Интерьеры Majestic RP» (25.10.2026): запись установки — один мод слоя (`layerModId`). */
  majesticinteriors: Object.freeze({
    section: "redux",
    storageKey: "astral.majesticinteriors.project.v1",
    installKey: "astral.majesticinteriors.install.v1",
  }),
  /* «Дороги»: запись установки — один мод слоя (`layerModId`). */
  roads: Object.freeze({
    section: "redux",
    storageKey: "astral.roads.project.v1",
    installKey: "astral.roads.install.v1",
  }),
  /* Шрифты: запись установки — один мод слоя (`layerModId`). */
  fonts: Object.freeze({
    section: "redux",
    storageKey: "astral.fonts.project.v1",
    installKey: "astral.fonts.install.v1",
  }),
  effects: Object.freeze({
    section: "redux",
    storageKey: "astral.ptfx.project.v1",
    installKey: "astral.effects-studio.install.v1",
  }),
  /* Черновик у мастерской оружия свой у каждого ствола: снимок работы
     ложится в черновик того ствола, который в нём записан. */
  gun: Object.freeze({
    section: "gunpacks",
    storageKey: GUN_DRAFTS_KEY,
    installKey: "astral.gun-studio.install.v1",
  }),
  "clothing-paint": Object.freeze({
    section: "clothing",
    storageKey: CLOTHING_DRAFTS_KEY,
    installKey: "astral.clothing-studio.install.v1",
  }),
  /* «Оптимизация» (ТЗ 24.10.2026): слои оптимизации Astral. Черновика у неё нет — слои ставит сам раздел «Оптимизация»;
     «стоит» — по записи набора слоёв. */
  optimization: Object.freeze({
    section: "optimization",
    storageKey: "astral.optimization.work-draft.v1",
    installKey: OPTIMIZATION_SET_RECORD_KEY,
  }),
  /* Звуки: в черновике студии ещё вкладка и выбранный ствол — снимок работы
     их не несёт, и черновик, в который легла работа, дополняет их сам. */
  "sound-kit": Object.freeze({
    section: "redux",
    storageKey: SOUND_KIT_KEY,
    installKey: SOUND_KIT_INSTALL_KEY,
  }),
});

/* Ключи связи по стволу: `gun:revolver`. Список фиксированных ключей их не
   знает — стволов десятки, и каждый заводит свой ключ при первом сохранении. */
const PER_SLOT_LINK = /^(gun|cloth):[a-z0-9_-]{1,48}$/;

const EFFECTS_PARTS = Object.freeze(["tracer", "impact", "environment"]);
const LINK_KEYS = Object.freeze(
  Object.values(WORK_KINDS)
    .map((spec) => spec.linkKey)
    .filter(Boolean),
);

const text = (value) => (typeof value === "string" ? value : "");
const now = () => new Date().toISOString();

function readJson(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function newWorkId() {
  const random =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `work-${random}`;
}

/* Ключи объектов по порядку: одна и та же правка, записанная двумя
   сериализаторами, обязана сравниться как одна. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/* Небо игра читает с четырьмя знаками после запятой (`keyframe-xml.js`):
   всё, что дальше, в игру не доезжает, а работу раздувает вдвое. */
export function roundSkyNumbers(project) {
  return JSON.parse(JSON.stringify(project), (key, value) =>
    typeof value === "number" && Number.isFinite(value)
      ? Number(value.toFixed(4))
      : value,
  );
}

/**
 * Снимок работы в том виде, в каком он хранится: строка JSON без отступов,
 * у набора эффектов — только своя часть, у неба — с числами той точности,
 * что читает игра.
 */
export function workStateFor(kind, state) {
  const parsed = parseState(state);
  if (!parsed || typeof parsed !== "object") return null;
  const spec = WORK_KINDS[kind];
  if (!spec) return null;
  if (spec.type === "effects")
    return JSON.stringify({
      ...(parsed.schema !== undefined ? { schema: parsed.schema } : {}),
      name: text(parsed.name),
      [spec.part]: parsed[spec.part] ?? null,
    });
  if (spec.type === "timecycle") return JSON.stringify(roundSkyNumbers(parsed));
  return JSON.stringify(parsed);
}

function normalizeWork(raw) {
  if (!raw || typeof raw !== "object") return null;
  const editor = text(raw.editor);
  if (!EDITOR_WORKS[editor]) return null;
  const id = text(raw.id);
  if (!/^work-[A-Za-z0-9-]{4,80}$/.test(id)) return null;
  const part =
    editor === "effects" && EFFECTS_PARTS.includes(raw.part) ? raw.part : "";
  return {
    id,
    editor,
    part,
    name: text(raw.name).slice(0, 120),
    createdAt: text(raw.createdAt) || now(),
    updatedAt: text(raw.updatedAt) || text(raw.createdAt) || now(),
    /* Пусто у снимков прежних версий: их заводило «Применить», и в список
       они не попадают. Держатся, пока на них ссылается запись установки. */
    savedAt: text(raw.savedAt),
    origin: text(raw.origin),
    appliedAt: text(raw.appliedAt),
    state: typeof raw.state === "string" ? unpackWorkState(raw.state) : null,
  };
}

function normalizeStudio(raw) {
  const projectId = text(raw?.projectId);
  if (!projectId) return null;
  return {
    projectId,
    savedAt: text(raw.savedAt) || now(),
    origin: text(raw.origin),
  };
}

function writeWorksStore(storage, store) {
  try {
    storage?.setItem(
      WORKS_KEY,
      JSON.stringify({
        version: STORE_VERSION,
        works: store.works
          .slice(0, MAX_WORKS)
          .map((work) => ({ ...work, state: packWorkState(work.state) })),
        studio: store.studio,
        linked: store.linked,
        current: store.current,
        migrated: store.migrated,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/* Снимки прежних версий, на которые больше не ссылается ни одна запись
   установки, не нужны никому: в список они не попадают, а место в
   хранилище занимают. */
function pruneHiddenWorks(storage, store) {
  const referenced = new Set(
    Object.values(EDITOR_WORKS)
      .map((spec) => text(readJson(storage, spec.installKey)?.workId))
      .filter(Boolean),
  );
  const keepCurrent = new Set(Object.values(store.current || {}));
  store.works = store.works.filter(
    (work) =>
      work.savedAt || referenced.has(work.id) || keepCurrent.has(work.id),
  );
}

/*
 * «Мои пресеты» студии эффектов — в «Мои работы».
 *
 * Пресет хранил весь набор, а работа — одну часть: пресет, в котором были
 * и трассер, и кровь, становится двумя работами. Пустые части работами не
 * становятся. Старый ключ после переезда стирается: полки «Мои пресеты»
 * больше нет, и вторая копия только разошлась бы с первой.
 */
function migrateEffectsPresets(storage, store) {
  const presets = readJson(storage, LEGACY_EFFECTS_PRESETS_KEY);
  if (Array.isArray(presets)) {
    const known = new Set(
      store.works
        .filter((work) => work.savedAt && work.editor === "effects")
        .map(
          (work) => `${work.part}:${stableStringify(parseState(work.state))}`,
        ),
    );
    for (const preset of presets.slice(0, 50)) {
      const project = preset?.project;
      if (!project || typeof project !== "object") continue;
      const stamp = Number(String(preset.id || "").replace(/^user-/, ""));
      const createdAt = Number.isFinite(stamp)
        ? new Date(stamp).toISOString()
        : now();
      for (const part of effectsPartsOf(project)) {
        const kind = EFFECTS_PART_KINDS[part];
        const state = workStateFor(kind, project);
        const fingerprint = `${part}:${stableStringify(parseState(state))}`;
        if (!state || known.has(fingerprint)) continue;
        known.add(fingerprint);
        store.works.push({
          id: newWorkId(),
          editor: "effects",
          part,
          name: text(preset.label || project.name).slice(0, 120),
          createdAt,
          updatedAt: createdAt,
          savedAt: createdAt,
          origin: "preset",
          appliedAt: "",
          state,
        });
      }
    }
  }
  store.migrated = { ...store.migrated, effectsPresets: true };
  const written = writeWorksStore(storage, store);
  if (written && Array.isArray(presets)) {
    try {
      storage?.removeItem(LEGACY_EFFECTS_PRESETS_KEY);
    } catch {
      /* ключ остался — переезд второй раз его не удвоит: отметка стоит */
    }
  }
}

export function readWorksStore(storage = globalThis.localStorage) {
  const raw = readStoredJson(storage, WORKS_KEY);
  const works = (Array.isArray(raw?.works) ? raw.works : [])
    .map(normalizeWork)
    .filter(Boolean);
  const ids = new Set(works.map((work) => work.id));
  const savedIds = new Set(
    works.filter((work) => work.savedAt).map((work) => work.id),
  );
  const store = {
    version: STORE_VERSION,
    works,
    studio: (Array.isArray(raw?.studio) ? raw.studio : [])
      .map(normalizeStudio)
      .filter(Boolean)
      .filter(
        (item, index, list) =>
          list.findIndex((other) => other.projectId === item.projectId) ===
          index,
      ),
    linked: Object.fromEntries(
      [
        ...LINK_KEYS,
        ...Object.keys(raw?.linked || {}).filter((key) =>
          PER_SLOT_LINK.test(key),
        ),
      ]
        .map((key) => [key, text(raw?.linked?.[key])])
        .filter(([, id]) => savedIds.has(id)),
    ),
    /* Текущая работа прежних версий — только для чтения: по ней килл-эффект
       однажды восстанавливает свою правку после обновления. */
    current: Object.fromEntries(
      Object.keys(EDITOR_WORKS)
        .map((editor) => [editor, text(raw?.current?.[editor])])
        .filter(([, id]) => ids.has(id)),
    ),
    migrated:
      raw?.migrated && typeof raw.migrated === "object" ? { ...raw.migrated } : {},
  };
  if (!store.migrated.effectsPresets) migrateEffectsPresets(storage, store);
  return store;
}

/** Правка, которую отдельный редактор держит сейчас, — строкой или null. */
export function editorStateOf(editor, storage = globalThis.localStorage) {
  const spec = EDITOR_WORKS[editor];
  if (!spec) return null;
  if (spec.memoryKey) {
    const value = rememberedValue(spec.memoryKey, null);
    if (value?.present) return JSON.stringify(value.present);
  }
  try {
    return storage?.getItem(spec.storageKey) || null;
  } catch {
    return null;
  }
}

function writeEditorState(editor, state, storage) {
  const spec = EDITOR_WORKS[editor];
  if (spec.memoryKey) {
    if (!state) forgetSection(spec.memoryKey);
    else {
      try {
        remember(spec.memoryKey, {
          present: JSON.parse(state),
          past: [],
          future: [],
        });
      } catch {
        forgetSection(spec.memoryKey);
      }
    }
  }
  try {
    if (state) storage?.setItem(spec.storageKey, state);
    else storage?.removeItem(spec.storageKey);
  } catch {
    /* Хранилище переполнено — редактор откроется со своей прежней правкой. */
  }
}

/**
 * Текущая работа прежних версий — снимок, с которым килл-эффект открывался
 * после перезапуска, пока у него не было своего черновика.
 */
export function currentEditorWorkState(
  editor,
  storage = globalThis.localStorage,
) {
  const store = readWorksStore(storage);
  const id = store.current[editor];
  return store.works.find((work) => work.id === id)?.state || null;
}

const tooLarge = (state) =>
  typeof state === "string" && state.length > MAX_STATE_BYTES;

/** Ошибка сохранения — со словом для окна: `full` или `too-large`. */
export class WorksStoreError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "WorksStoreError";
    this.reason = reason;
  }
}

function commitStore(storage, store) {
  pruneHiddenWorks(storage, store);
  if (!writeWorksStore(storage, store)) throw new WorksStoreError("full");
}

/**
 * Сохранённая работа, из которой открыт редактор вида `kind`, или `null`.
 * `slot` — ствол у вида, который связывается по стволу.
 */
export function linkedEditorWork(
  kind,
  storage = globalThis.localStorage,
  slot = "",
) {
  const linkKey = linkKeyOf(kind, null, slot);
  if (!linkKey) return null;
  const store = readWorksStore(storage);
  const id = store.linked[linkKey];
  return store.works.find((work) => work.id === id && work.savedAt) || null;
}

/**
 * Редактор больше не правит сохранённую работу: в нём открыт код друга,
 * готовый пресет или правка с нуля. «Сохранить» после этого заведёт новую
 * работу, а не перепишет ту, из которой редактор открывали.
 */
export function unlinkEditorWork(
  kind,
  storage = globalThis.localStorage,
  slot = "",
) {
  const linkKey = linkKeyOf(kind, null, slot);
  if (!linkKey) return;
  const store = readWorksStore(storage);
  if (!store.linked[linkKey]) return;
  delete store.linked[linkKey];
  writeWorksStore(storage, store);
}

/**
 * «Сохранить в мои работы» из редактора вида `kind`.
 *
 * `asNew: false` обновляет работу, из которой редактор открыт, а если её
 * нет — заводит новую; `asNew: true` заводит новую всегда. Редактор после
 * этого правит сохранённую работу: следующее «Сохранить» обновит её же.
 */
export function saveEditorWorkToWorks(
  kind,
  state,
  { name = "", asNew = false } = {},
  storage = globalThis.localStorage,
) {
  const spec = WORK_KINDS[kind];
  if (!spec?.linkKey) throw new Error(`Вид не сохраняется снимком: ${kind}`);
  const snapshot = workStateFor(kind, state);
  if (!snapshot) throw new WorksStoreError("empty");
  if (tooLarge(snapshot)) throw new WorksStoreError("too-large");
  const linkKey = linkKeyOf(kind, snapshot);
  if (!linkKey) throw new WorksStoreError("empty");
  const store = readWorksStore(storage);
  const stamp = now();
  const linkedId = store.linked[linkKey];
  const existing = asNew
    ? null
    : store.works.find((work) => work.id === linkedId && work.savedAt);
  let work;
  if (existing) {
    Object.assign(existing, {
      state: snapshot,
      updatedAt: stamp,
      ...(text(name).trim() ? { name: text(name).trim().slice(0, 120) } : {}),
    });
    work = existing;
  } else {
    work = {
      id: newWorkId(),
      editor: spec.type,
      part: spec.part || "",
      name: text(name).trim().slice(0, 120),
      createdAt: stamp,
      updatedAt: stamp,
      savedAt: stamp,
      origin: "editor",
      appliedAt: "",
      state: snapshot,
    };
    store.works.unshift(work);
  }
  store.linked[linkKey] = work.id;
  commitStore(storage, store);
  return { work, created: !existing };
}

/**
 * Шаблон по коду — в «Мои работы» отдельных редакторов. Редактор не
 * трогается: человек добавил шаблон, а не открыл его.
 */
export function addTemplateWork(
  { kind, name = "", state },
  storage = globalThis.localStorage,
) {
  const spec = WORK_KINDS[kind];
  if (!spec?.linkKey) throw new Error(`Вид не сохраняется снимком: ${kind}`);
  const snapshot = workStateFor(kind, state);
  if (!snapshot) throw new WorksStoreError("empty");
  if (tooLarge(snapshot)) throw new WorksStoreError("too-large");
  const store = readWorksStore(storage);
  const stamp = now();
  const work = {
    id: newWorkId(),
    editor: spec.type,
    part: spec.part || "",
    name: text(name).trim().slice(0, 120),
    createdAt: stamp,
    updatedAt: stamp,
    savedAt: stamp,
    origin: "code",
    appliedAt: "",
    state: snapshot,
  };
  store.works.unshift(work);
  commitStore(storage, store);
  return work;
}

function mergeEffectsPart(draft, work) {
  const current = parseState(draft);
  const saved = parseState(work.state) || {};
  const base =
    current && typeof current === "object"
      ? current
      : { ...(saved.schema !== undefined ? { schema: saved.schema } : {}) };
  return JSON.stringify({ ...base, [work.part]: saved[work.part] ?? null });
}

/**
 * Открыть сохранённую работу: её снимок ложится туда, откуда редактор
 * читает правку, и редактор начинает править эту работу.
 *
 * У набора эффектов снимок — одна часть: она ложится в общий черновик на
 * своё место, а трассеры, кровь или огонь, настроенные в соседних
 * редакторах, остаются как были. Часть приводится к нынешней схеме набора
 * разбором студии эффектов — работа могла быть сохранена прежней версией.
 */
export async function openEditorWork(
  workId,
  storage = globalThis.localStorage,
) {
  const store = readWorksStore(storage);
  const work = store.works.find((item) => item.id === workId && item.savedAt);
  if (!work) return null;
  const kind =
    workKindOf(work.editor, work.part) ||
    workKindOf("effects", effectsPartsOf(work.state)[0]);
  const spec = WORK_KINDS[kind];
  if (!spec) return null;
  if (work.editor === "optimization") {
    /* У оптимизации нет черновика: её слои раздел «Оптимизация» открывает на своих карточках (как «Редактировать» у
       оптимизации части редукса) и ничего не включает сам. */
    requestOptimizerFocus({ layers: parseState(work.state)?.layers || [], source: work.name });
    store.linked[spec.linkKey] = work.id;
    writeWorksStore(storage, store);
    return { slotId: "", section: spec.section, work };
  }
  if (work.editor === "effects") {
    const { parseProject, serializeProject } =
      await import("@modovik/ptfx-studio");
    /* Обе стороны — к нынешней схеме до склейки: часть одной схемы в наборе
       другой разбор прочёл бы не по той схеме. */
    const saved = serializeProject(parseProject(parseState(work.state) || {}));
    let base;
    try {
      base = serializeProject(
        parseProject(parseState(editorStateOf("effects", storage)) || {}),
      );
    } catch {
      /* Черновик не читается — работа ложится на пустой набор. */
      base = serializeProject(parseProject({}));
    }
    const draft = serializeProject(
      parseProject(
        parseState(
          mergeEffectsPart(JSON.stringify(base), {
            part: spec.part,
            state: JSON.stringify(saved),
          }),
        ),
      ),
    );
    writeEditorState("effects", JSON.stringify(draft), storage);
  } else if (spec.perSlot) {
    /* Скин оружия ложится в черновик своего ствола, а не поверх всех. */
    const slot = gunSlotOf(work.state);
    const project = parseState(work.state)?.project;
    if (!slot || !project) return null;
    const storageKey = EDITOR_WORKS[work.editor].storageKey;
    /* Одежда: женская работа — в женский черновик слота (ревью п. 4), мужская — под прежним именем. */
    putGunDraftEntry(
      storageKey === CLOTHING_DRAFTS_KEY
        ? draftSlot(slot, draftGenderOf(project.modelId))
        : slot,
      project,
      storage,
      storageKey,
    );
    store.linked[linkKeyOf(kind, work.state)] = work.id;
    writeWorksStore(storage, store);
    return { slotId: slot, section: spec.section, work };
  } else {
    writeEditorState(work.editor, work.state, storage);
  }
  store.linked[spec.linkKey] = work.id;
  writeWorksStore(storage, store);
  return { slotId: spec.slotId, section: "redux", work };
}

/** Копия работы — чтобы попробовать вариант, не трогая сохранённое. */
export function duplicateEditorWork(
  workId,
  { suffix = "копия" } = {},
  storage = globalThis.localStorage,
) {
  const store = readWorksStore(storage);
  const work = store.works.find((item) => item.id === workId && item.savedAt);
  if (!work) return null;
  const stamp = now();
  const copy = {
    ...work,
    id: newWorkId(),
    name: `${work.name || ""}${work.name ? " — " : ""}${suffix}`.slice(0, 120),
    createdAt: stamp,
    updatedAt: stamp,
    savedAt: stamp,
    origin: "copy",
    appliedAt: "",
  };
  store.works.unshift(copy);
  commitStore(storage, store);
  return copy;
}

export function renameEditorWork(
  workId,
  name,
  storage = globalThis.localStorage,
) {
  const store = readWorksStore(storage);
  const work = store.works.find((item) => item.id === workId && item.savedAt);
  if (!work) return null;
  work.name = text(name).trim().slice(0, 120);
  work.updatedAt = now();
  writeWorksStore(storage, store);
  return work;
}

/**
 * Удалить работу из «Моих работ». Правка в редакторе и то, что стоит в
 * игре, остаются как были: работа — сохранённая копия, а не сама правка.
 */
export function deleteEditorWork(workId, storage = globalThis.localStorage) {
  const store = readWorksStore(storage);
  const work = store.works.find((item) => item.id === workId && item.savedAt);
  if (!work) return false;
  store.works = store.works.filter((item) => item.id !== workId);
  for (const [key, id] of Object.entries(store.linked))
    if (id === workId) delete store.linked[key];
  pruneHiddenWorks(storage, store);
  writeWorksStore(storage, store);
  forgetWorkCover(`work:${workId}`);
  return true;
}

/* Работу убрали — её обложка (снимок кадра при «Сохранить», `work-covers.js`) уходит вместе с ней. */
function forgetWorkCover(key) {
  void import("./work-covers.js").then((covers) => covers.deleteWorkCover(key)).catch(() => {});
}

/* --- Проекты студии в «Моих работах» -------------------------------- */

/** Сохранён ли проект студии в «Мои работы». */
export function isStudioWork(projectId, storage = globalThis.localStorage) {
  return readWorksStore(storage).studio.some(
    (item) => item.projectId === projectId,
  );
}

/**
 * Отметить проект студии сохранённым в «Мои работы». `origin`: `editor` —
 * человек сохранил проект, над которым работал; `code` и `copy` — проект
 * заведён самими «Моими работами» (шаблон по коду, копия).
 */
export function addStudioWork(
  projectId,
  { origin = "editor" } = {},
  storage = globalThis.localStorage,
) {
  if (!projectId) return;
  const store = readWorksStore(storage);
  if (store.studio.some((item) => item.projectId === projectId)) return;
  store.studio.unshift({ projectId, savedAt: now(), origin });
  commitStore(storage, store);
}

/**
 * Убрать проект студии из «Моих работ».
 *
 * Возвращает, можно ли стереть и сам проект: да — если его завели «Мои
 * работы» (шаблон, копия), он не стоит в игре и плитка студии не работает
 * над ним. Проект, над которым человек работал в редакторе, остаётся
 * редактору: из «Моих работ» уходит отметка, а не его правка.
 */
export function removeStudioWork(projectId, storage = globalThis.localStorage) {
  const store = readWorksStore(storage);
  const entry = store.studio.find((item) => item.projectId === projectId);
  if (!entry) return { removed: false, deleteProject: false };
  store.studio = store.studio.filter((item) => item.projectId !== projectId);
  writeWorksStore(storage, store);
  const projects = readJson(storage, PROJECTS_KEY);
  const project = Array.isArray(projects)
    ? projects.find((item) => item?.id === projectId)
    : null;
  const inGame = (project?.installations || []).some(
    (installation) => installation?.status === "active",
  );
  const tileProject =
    project?.sourceModId &&
    currentStudioProjectId(project.sourceModId, storage) === projectId;
  return {
    removed: true,
    deleteProject:
      Boolean(project) &&
      ["code", "copy"].includes(entry.origin) &&
      !inGame &&
      !tileProject,
  };
}

/* --- Что стоит в игре ---------------------------------------------- */

/* Стоит ли установка по записи: точка отката или мод слоя (у фонарей). */
const installedRecord = (record) =>
  Boolean(text(record?.restorePointId) || text(record?.layerModId));

/*
 * Снимок того, что редактор поставил в игру.
 *
 * Новые записи установки несут его сами (`installedState`, у эффектов —
 * `installedProject`). Записи прежних версий вместо снимка ссылались на
 * работу, заведённую «Применить» (`workId`); такая работа хранится, пока на
 * неё есть ссылка.
 */
function installedSnapshot(editor, storage, store) {
  /* Звуки ставятся модом на семью стволов и модом попаданий, одной точки
     установки у них нет: снимок собирается из их записи. */
  if (editor === "sound-kit") return soundKitInstalledState(storage);
  /* Оптимизация: что стоит — слои набора и прежних записей слоёв; снимок — ровно их список. */
  if (editor === "optimization") {
    const layers = installedOptimizationLayerIds(storage);
    return layers.length ? JSON.stringify({ layers }) : null;
  }
  const spec = EDITOR_WORKS[editor];
  const record = readStoredJson(storage, spec.installKey);
  if (!installedRecord(record)) return null;
  if (
    editor === "effects" &&
    record.installedProject &&
    typeof record.installedProject === "object"
  )
    return JSON.stringify(record.installedProject);
  if (typeof record.installedState === "string") return record.installedState;
  const workId = text(record.workId);
  if (workId)
    return store.works.find((work) => work.id === workId)?.state || null;
  /* Запись старше «Моих работ» не знает ни снимка, ни работы: в игре
     считается последняя работа, существовавшая к установке. */
  const installedAt = text(record.installedAt);
  if (!installedAt) return null;
  return (
    store.works
      .filter(
        (work) =>
          work.editor === editor && work.state && work.createdAt <= installedAt,
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
      ?.state || null
  );
}

/**
 * Снимок, стоящий в игре, — строго по записи установки, без подмены
 * черновиком: `null`, если узнать не из чего. Нужен тем, кто собирает
 * следующую установку поверх стоящей (эффекты: редакторов три, патч один).
 */
export function installedEditorWorkState(
  editor,
  storage = globalThis.localStorage,
) {
  if (!EDITOR_WORKS[editor]) return null;
  return installedSnapshot(editor, storage, readWorksStore(storage));
}

/* Слот плитки → отдельный редактор, чья правка за ней стоит. */
const EDITOR_BY_SLOT = Object.freeze({
  timecycle: "timecycle",
  "kill-effects": "kill-effect",
  "screen-hits": "screen-hits",
  blips: "gps",
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026). */
  "target-hp": "target-hp",
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер). */
  "group-markers": "group-markers",
  /* «Дым из-под колёс» (ТЗ 11.10.2026, вечер). */
  "wheel-smoke": "wheel-smoke",
  tracers: "effects",
  "hit-effects": "effects",
  "fire-explosions": "effects",
  lights: "lamps",
  wallbang: "wallbang",
  "forbidden-zones": "zones",
  factory: "factory",
  hangar: "hangar",
  mapping: "mapping",
  water: "water",
  vegetation: "vegetation",
  arenas: "arenas",
  fonts: "fonts",
  "mega-mall": "megamall",
  ashan: "youtool",
  vinewood: "vinewood",
  busstops: "busstops",
  "msl-zones": "mslzones",
  "float-logo": "floatlogo",
  /* Дирижабли (ТЗ 11.10.2026). */
  airships: "airships",
  shops: "shops",
  billboards: "billboards",
  "capt-zones": "captzones",
  schedule: "schedule",
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер). */
  flags: "flags",
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026). */
  atms: "atms",
  "project-interiors": "projectinteriors",
  "majestic-interiors": "majesticinteriors",
  roads: "roads",
});

/**
 * Снимок, стоящий в игре, — для обложки плитки. Установка есть, а снимка
 * нет (запись старше «Моих работ») — берётся то, что редактор держит
 * сейчас: ближе к правде, чем стандартная обложка при живой установке.
 */
export function installedEditorState(
  slotId,
  storage = globalThis.localStorage,
) {
  /* Слот без своей записи в таблице работ — стандартная обложка, а не
     падение полки: обложка одна у мастерской и библиотеки. */
  const editor = EDITOR_BY_SLOT[slotId];
  if (!editor || !EDITOR_WORKS[editor]) return null;
  const record = readJson(storage, EDITOR_WORKS[editor].installKey);
  if (!installedRecord(record)) return null;
  return (
    installedSnapshot(editor, storage, readWorksStore(storage)) ||
    editorStateOf(editor, storage)
  );
}

/* Сверка большого снимка — память по работе: те же две строки дают тот же ответ. */
const installedChecks = new Map();

/* Одна и та же ли правка у работы и у того, что стоит в игре. */
function sameAsInstalled(work, kind, installed) {
  if (!installed || !work.state) return false;
  const key = `${kind}:${work.id}`;
  const known = installedChecks.get(key);
  if (known && known.state === work.state && known.installed === installed) return known.same;
  const same = compareWithInstalled(work, kind, installed);
  if (installedChecks.size >= REMEMBERED_STATES * 4) installedChecks.clear();
  installedChecks.set(key, { state: work.state, installed, same });
  return same;
}

function compareWithInstalled(work, kind, installed) {
  const saved = parseState(work.state);
  const inGame = parseState(installed);
  if (!saved || !inGame) return false;
  const spec = WORK_KINDS[kind];
  if (spec.type === "effects")
    return (
      effectsPartsOf({ [spec.part]: inGame[spec.part] }).length > 0 &&
      stableStringify(saved[spec.part]) === stableStringify(inGame[spec.part])
    );
  if (spec.type === "timecycle")
    return (
      stableStringify(roundSkyNumbers(saved)) ===
      stableStringify(roundSkyNumbers(inGame))
    );
  /* Оптимизация добавляет свои слои к тому, что уже стоит: работа «стоит», когда все её слои уже включены. */
  if (spec.type === "optimization")
    return (
      Array.isArray(saved.layers) &&
      saved.layers.length > 0 &&
      saved.layers.every((layerId) => (inGame.layers || []).includes(layerId))
    );
  return stableStringify(saved) === stableStringify(inGame);
}

/**
 * Все сохранённые работы одним списком, новые сверху.
 *
 * `workKind` — вид работы (`work-kinds.js`): по нему карточка берёт подпись,
 * обложку и код. `installed` — стоит ли в игре ровно эта работа.
 */
export function listWorkshopWorks(storage = globalThis.localStorage) {
  const store = readWorksStore(storage);
  const works = [];

  const projects = readStoredJson(storage, PROJECTS_KEY);
  const projectsById = new Map(
    (Array.isArray(projects) ? projects : [])
      .filter((project) => text(project?.id))
      .map((project) => [project.id, project]),
  );
  for (const entry of store.studio) {
    const project = projectsById.get(entry.projectId);
    if (!project) continue;
    const kind = studioKindOfModules(
      Array.isArray(project.enabledModules)
        ? project.enabledModules
        : Object.keys(project.modules || {}),
    );
    if (!kind) continue;
    const spec = WORK_KINDS[kind];
    works.push({
      key: `project:${project.id}`,
      kind: "project",
      type: spec.type,
      workKind: kind,
      projectId: project.id,
      sourceModId: text(project.sourceModId),
      name: text(project.name),
      createdAt: text(project.createdAt),
      updatedAt: text(project.updatedAt) || text(project.createdAt),
      savedAt: entry.savedAt,
      installed: (project.installations || []).some(
        (installation) => installation?.status === "active",
      ),
      slotId: spec.slotId,
      section: "redux",
    });
  }

  const installed = Object.fromEntries(
    Object.keys(EDITOR_WORKS).map((editor) => [
      editor,
      installedSnapshot(editor, storage, store),
    ]),
  );
  for (const work of store.works) {
    if (!work.savedAt) continue;
    const kind =
      workKindOf(work.editor, work.part) ||
      workKindOf("effects", effectsPartsOf(work.state)[0] || "impact");
    const spec = WORK_KINDS[kind];
    if (!spec) continue;
    works.push({
      key: `work:${work.id}`,
      kind: "editor",
      type: work.editor,
      part: spec.part || "",
      workKind: kind,
      workId: work.id,
      name: work.name,
      createdAt: work.createdAt,
      updatedAt: work.updatedAt,
      savedAt: work.savedAt,
      installed: sameAsInstalled(work, kind, installed[work.editor]),
      /* Снимок — обложке: она рисует саму работу, а не снимок слота. */
      state: work.state,
      slotId: spec.perSlot ? gunSlotOf(work.state) : spec.slotId,
      section: spec.section || "redux",
    });
  }

  return works.sort((left, right) =>
    String(right.updatedAt).localeCompare(String(left.updatedAt)),
  );
}

/** Переименовать проект студии прямо в хранилище проектов. */
export function renameStudioProject(
  projectId,
  name,
  storage = globalThis.localStorage,
) {
  const projects = readJson(storage, PROJECTS_KEY);
  if (!Array.isArray(projects)) return false;
  let found = false;
  const next = projects.map((project) => {
    if (project?.id !== projectId) return project;
    found = true;
    return {
      ...project,
      name: text(name).trim().slice(0, 120) || project.name,
      updatedAt: now(),
    };
  });
  if (!found) return false;
  try {
    storage.setItem(PROJECTS_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/**
 * Удалить проект студии из хранилища. Возвращает удалённый проект и те, что
 * остались, — чтобы вызывающий почистил картинки, на которые больше никто не
 * ссылается (`deleteUnreferencedWorkshopAssets`).
 */
export function removeStudioProject(
  projectId,
  storage = globalThis.localStorage,
) {
  const projects = readJson(storage, PROJECTS_KEY);
  if (!Array.isArray(projects)) return null;
  const removed = projects.find((project) => project?.id === projectId);
  if (!removed) return null;
  const remaining = projects.filter((project) => project?.id !== projectId);
  storage.setItem(PROJECTS_KEY, JSON.stringify(remaining));
  forgetSection(`workshop:studio:project:${projectId}`);
  forgetWorkCover(`project:${projectId}`);
  return { removed, remaining };
}
