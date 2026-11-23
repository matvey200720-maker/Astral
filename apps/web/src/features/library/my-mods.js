import { modPicture } from "./mod-picture.js";
import { mergeWorkCards } from "./work-cards.js";
import { readWorkshopInstallUnits } from "../../workshop-library.js";
import {
  installedEditorState,
  installedEditorWorkState,
  listWorkshopWorks,
} from "../workshop/works/workshop-works.js";
import { WORK_KINDS } from "../workshop/works/work-kinds.js";
import { installedOptimizationLayerIds, optimizationLayerModIds } from "../workshop/optimization-layer-records.js";
import { WEAPON_SKIN_INSTALLS_KEY } from "../workshop/install-queue/tasks/weapon-skin-key.js";
import { CLOTHING_SKIN_INSTALLS_KEY, workModIds } from "../workshop/install-queue/tasks/clothing-paint-slots.js";
import { tr } from "../../locales/ui.js";

/*
 * Моды человека — одним списком (задачи 2–4 ТЗ 08.10, вечер).
 *
 * Сборки, окно новой сборки, полка библиотеки и карточки модов брали
 * картинку и имя каждая по-своему: сборка — `modPhoto` со снимком слота
 * мастерской вместо фото, каталог — `coverFor` с городским кадром по хешу id,
 * работа мастерской — обложку по коду, а то и пустую плашку. Хуже того,
 * `installed` оболочки — это все id профиля движка, в том числе установки
 * мастерской (`local-legacy-*`, `local-weapon-skin-*`, моды слоя): в
 * каталоге их нет, и сборка «Из установленного» показывала их «удалёнными
 * модами» без фото, а в обложку карточки попадала одна работа.
 *
 * Здесь один ответ на вопрос «что у человека стоит и как оно выглядит»:
 *
 *   • мод каталога — его имя и настоящая обложка: своя, первый кадр галереи
 *     или запомненная окном; ни снимков слота, ни городских кадров;
 *   • работа мастерской — то, что стоит в игре, сохранена она в «Мои
 *     работы» или нет: имя, которое дал ей человек, вид работы и снимок
 *     поставленного (из него рисуется та же обложка, что на полке);
 *   • id движка, которые держит работа, — при ней: сборка и полка сводят их
 *     к работе, а не к «удалённому моду».
 *
 * Элемент: `{ key, kind: "mod"|"work", name, slotId, section, mod?, work?,
 * engineIds, installedAt }`. `work` — то, что рисует `WorkCover`.
 */

const text = (value) => (typeof value === "string" ? value.trim() : "");

/* Все id движка от мастерской начинаются с `local-` (`local-legacy-*`,
   `local-weapon-skin-*`, `local-sound-*`, `local-clothing-*`,
   `local-gunpack-*`, `local-mega-mall-*` — см. проверки манифестов в
   `@modovik/install-engine`). У модов каталога — UUID или имя из каталога. */
const WORKSHOP_ENGINE_ID = /^local-/;

/** Установка мастерской, а не мод каталога. */
export function isWorkshopEngineId(id, modsById = null) {
  const value = text(id);
  if (!WORKSHOP_ENGINE_ID.test(value)) return false;
  return !modsById?.has?.(value);
}

/*
 * Плитка полки → вид работы. Уточняющие плитки карт и звуков ведут в тот же
 * редактор и рисуют ту же вещь.
 */
const KIND_BY_SLOT = Object.freeze({
  ...Object.fromEntries(
    Object.entries(WORK_KINDS)
      .filter(([, spec]) => spec.slotId)
      .map(([kind, spec]) => [spec.slotId, kind]),
  ),
  "minimap-zoom": "minimap",
  "minimap-position": "minimap",
  "large-map-zoom": "world-map",
  "sniper-crosshair": "reticle",
  "weapon-sounds": "sound",
  "hit-sounds": "sound",
  "hit-sounds-head": "sound",
  "hit-sounds-body": "sound",
  /* Окружение студии звуков (ТЗ 17.10.2026, задача 5). */
  "ambient-noise": "sound",
});

export const workKindOfSlot = (slotId) => KIND_BY_SLOT[text(slotId)] || "";

/* Установки, у которых своя память по предмету (`clothing-paint-slots.js`, `weapon-skin-items.js`). */
const SKIN_UNIT_ORIGINS = new Set(["clothing-paint", "weapon-skin"]);

/*
 * Подпись работы, у которой человек не дал имени: вид работы словами — то же,
 * что на плитке редактора, а не «стандартное описание раздела».
 */
const KIND_TITLES = Object.freeze({
  tracer: "Трейсеры",
  impact: "Эффекты попадания",
  fire: "Огонь и взрывы",
  sky: "Небо и таймциклы",
  kill: "Килл-эффект",
  "screen-hits": "Эффекты на экране",
  gps: "Метки и GPS",
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026). */
  "target-hp": "Полоска HP",
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер). */
  "group-markers": "Групповые метки",
  /* «Дым из-под колёс» (ТЗ 11.10.2026, вечер). */
  "wheel-smoke": "Настройка автомобиля",
  lamps: "Фонари",
  wallbang: "Прострелы",
  zones: "Зоны",
  factory: "Завод",
  hangar: "Ангар",
  mapping: "Маппинг",
  water: "Вода",
  vegetation: "Растительность",
  arenas: "Арена",
  megamall: "Мегамолл",
  youtool: "Ашан / Икея",
  vinewood: "Вайнвуд",
  busstops: "Остановки",
  mslzones: "МСЛ-зоны",
  floatlogo: "Летающее лого",
  /* Дирижабли (ТЗ 11.10.2026). */
  airships: "Дирижабли",
  shops: "Интерьеры",
  billboards: "Билборды",
  captzones: "Зоны каптов",
  schedule: "Расписание",
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер). */
  flags: "Флаги",
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026). */
  atms: "Банкоматы",
  /* «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер). */
  projectinteriors: "Интерьеры проектов",
  majesticinteriors: "Интерьеры Majestic RP",
  roads: "Дороги",
  fonts: "Шрифты",
  sound: "Звуки",
  minimap: "Мини-карта",
  reticle: "Прицел",
  "world-map": "Большая карта",
  climbs: "Залазы",
  weapon: "Скин оружия",
  clothing: "Покраска одежды",
  /* Слои оптимизации — работа «Оптимизация» (ТЗ 24.10.2026). */
  optimization: "Оптимизация",
});

export const workKindTitle = (kind) => tr(KIND_TITLES[kind] || "Работа мастерской");

export { modPicture };

function readJson(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/* Имя проекта студии по его id — у установок студии своего имени нет. */
function projectsById(storage) {
  const list = readJson(storage, "astral-workshop-projects-v1");
  return new Map(
    (Array.isArray(list) ? list : [])
      .filter((project) => text(project?.id))
      .map((project) => [project.id, project]),
  );
}

/*
 * Сохранённая работа, которая стоит в игре этой же версией, — по виду: её
 * имя главнее имени записи установки (так называет полка «Моих работ»).
 */
function savedNameOf(kind, savedWorks) {
  return (
    savedWorks.find((work) => work.installed && work.workKind === kind)?.name ||
    ""
  );
}

/**
 * Работы мастерской, что стоят в игре, — элементами списка.
 *
 * @param {{
 *   units?: ReturnType<typeof readWorkshopInstallUnits>,
 *   savedWorks?: ReturnType<typeof listWorkshopWorks>,
 *   storage?: Storage,
 * }} [input]
 */
export function installedWorkItems({
  units = null,
  savedWorks = null,
  storage = globalThis.localStorage,
} = {}) {
  const list = units || readWorkshopInstallUnits(storage);
  const works = savedWorks || listWorkshopWorks(storage);
  const projects = projectsById(storage);
  const items = new Map();

  for (const unit of list) {
    /* Скин оружия и покраска одежды — своя память по предмету, разбирается
       ниже: у карточки полки слот `weapon-skin:…` / `clothing-item:…`, вида
       работы по нему не узнать. */
    if (SKIN_UNIT_ORIGINS.has(unit.origin?.type)) continue;
    for (const slotId of unit.slots || []) {
      const workKind = workKindOfSlot(slotId);
      const origin = unit.origin || {};
      /* Одна установка — одна работа на плитку; её моды слоя (фонари:
         точка + пакет моделей) — при ней же. */
      const key =
        origin.type === "project"
          ? `work:project:${origin.projectId}:${slotId}`
          : origin.type === "key"
            ? `work:${origin.key}:${slotId}`
            : `work:${unit.key}:${slotId}`;
      const existing = items.get(key);
      const engineIds = unit.modId ? [unit.modId] : [];
      if (existing) {
        existing.engineIds = [...new Set([...existing.engineIds, ...engineIds])];
        existing.units.push(unit);
        continue;
      }
      const project =
        origin.type === "project" ? projects.get(origin.projectId) : null;
      /* Снимок поставленного: у отдельного редактора — из записи установки,
         у звуков — из их записи (стволы и попадания одним снимком). */
      const state =
        workKind === "sound"
          ? installedEditorWorkState("sound-kit", storage)
          : origin.type === "key" && workKind
            ? installedEditorState(slotId, storage)
            : null;
      const name =
        text(unit.slotNames?.[slotId]) ||
        text(unit.name) ||
        text(project?.name) ||
        savedNameOf(workKind, works) ||
        workKindTitle(workKind);
      items.set(key, {
        key,
        kind: "work",
        name,
        slotId,
        section: WORK_KINDS[workKind]?.section || "redux",
        workKind,
        work: {
          key,
          workKind,
          slotId,
          section: WORK_KINDS[workKind]?.section || "redux",
          projectId: project ? project.id : "",
          state: typeof state === "string" ? state : null,
          updatedAt: text(unit.installedAt),
          /* Обложка — та же, что в библиотеке: снимок поставленного (`work-cover-keys.js`). */
          installed: true,
        },
        engineIds,
        installedAt: text(unit.installedAt),
        units: [unit],
      });
    }
  }

  /* Скины оружия и покраска одежды — своя память по предмету: на каждом
     стволе и каждой вещи свой. Полка библиотеки их не показывает, а в сборку
     и в её обложку они входят. */
  for (const [storageKey, workKind] of [
    [WEAPON_SKIN_INSTALLS_KEY, "weapon"],
    [CLOTHING_SKIN_INSTALLS_KEY, "clothing"],
  ]) {
    const records = readJson(storage, storageKey);
    if (!records || typeof records !== "object" || Array.isArray(records))
      continue;
    for (const [owner, record] of Object.entries(records)) {
      const modIds = (
        record?.works?.length
          ? record.works.flatMap(workModIds)
          : record?.modIds?.length
            ? record.modIds
            : [record?.modId]
      ).filter((id) => WORKSHOP_ENGINE_ID.test(text(id)));
      if (!modIds.length) continue;
      const key = `work:${storageKey}:${owner}`;
      if ([...items.values()].some((item) => item.engineIds.some((id) => modIds.includes(id))))
        continue;
      items.set(key, {
        key,
        kind: "work",
        name: text(record.name) || workKindTitle(workKind),
        slotId: owner,
        section: WORK_KINDS[workKind].section,
        workKind,
        work: {
          key,
          workKind,
          slotId: owner,
          section: WORK_KINDS[workKind].section,
          projectId: "",
          state: typeof record.installedState === "string" ? record.installedState : null,
          updatedAt: text(record.installedAt),
          installed: true,
        },
        engineIds: modIds,
        installedAt: text(record.installedAt),
        units: [],
      });
    }
  }

  /* Слои оптимизации, что стоят в игре, — одна работа «Оптимизация» (ТЗ 24.10.2026): в сборку она идёт кодом слоёв,
     а получатель находит её в «Моих работах». Ступени «Ухудшения текстур» и профиль настроек игры в неё не входят —
     у них свои пакеты и свои записи. */
  const layers = installedOptimizationLayerIds(storage);
  if (layers.length) {
    const key = "work:optimization";
    const record = readJson(storage, "astral.optimization.set.install.v1");
    const section = WORK_KINDS.optimization.section;
    items.set(key, {
      key,
      kind: "work",
      name: savedNameOf("optimization", works) || workKindTitle("optimization"),
      slotId: "",
      section,
      workKind: "optimization",
      work: {
        key,
        workKind: "optimization",
        slotId: "",
        section,
        projectId: "",
        state: JSON.stringify({ layers }),
        updatedAt: text(record?.installedAt),
      },
      engineIds: optimizationLayerModIds(storage),
      installedAt: text(record?.installedAt),
      units: [],
    });
  }

  /* Сохранённая работа, которая стоит в игре этой же версией, а записи
     установки под неё полка не нашла (запись прежних версий): она тоже в
     игре — тем же элементом, что видят «Мои работы». */
  const covered = new Set(
    [...items.values()].map(
      (item) =>
        `${item.workKind}:${WORK_KINDS[item.workKind]?.perSlot ? item.slotId : ""}`,
    ),
  );
  for (const work of works) {
    if (!work.installed || !WORK_KINDS[work.workKind]) continue;
    const spec = WORK_KINDS[work.workKind];
    const coverKey = `${work.workKind}:${spec.perSlot ? work.slotId : ""}`;
    if (covered.has(coverKey)) continue;
    covered.add(coverKey);
    const key = `work:saved:${work.key}`;
    items.set(key, {
      key,
      kind: "work",
      name: text(work.name) || workKindTitle(work.workKind),
      slotId: work.slotId,
      section: work.section || spec.section || "redux",
      workKind: work.workKind,
      work: {
        key,
        workKind: work.workKind,
        slotId: work.slotId,
        section: work.section || spec.section || "redux",
        projectId: work.projectId || "",
        state: typeof work.state === "string" ? work.state : null,
        updatedAt: text(work.updatedAt),
        coverKey: work.key,
        installed: true,
      },
      engineIds: [],
      installedAt: text(work.updatedAt),
      units: [],
      /* Сохранённую работу код сборки берёт из «Моих работ» сам. */
      saved: true,
    });
  }

  /* `codable` — работу можно унести кодом в сборку: она сохранена в «Мои
     работы» или у неё есть снимок поставленного (у студии — проект). Запись
     старше «Моих работ» без снимка и без черновика редактора в игре стоит, но
     перенести её нечем. */
  return [...items.values()].map((item) => ({
    ...item,
    codable: Boolean(
      WORK_KINDS[item.workKind] &&
        (item.saved ||
          (WORK_KINDS[item.workKind].studio
            ? item.work.projectId
            : item.work.state)),
    ),
  }));
}

/** Мод каталога элементом списка (запись с запомненным фото — тоже). */
export function modItem(mod, face = null) {
  return {
    key: `mod:${mod.id}`,
    kind: "mod",
    name: text(mod.name),
    slotId: text(mod.catalogSlot),
    section: text(mod.catalogSection) || text(mod.category),
    mod,
    picture: modPicture(mod, face),
    engineIds: [mod.id],
    pending: Boolean(mod.pending),
    missing: Boolean(mod.missing),
  };
}

/**
 * Что из id профиля — моды каталога: установки мастерской отсюда уходят к
 * своим работам. Порядок — как в профиле.
 */
export function catalogIdsOf(ids = [], modsById = null) {
  return ids.filter((id) => !isWorkshopEngineId(id, modsById));
}

/**
 * Работа, которой принадлежит id движка (`local-…`), — или `null`.
 * @param {string} id
 * @param {ReturnType<typeof installedWorkItems>} workItems
 */
export function workOfEngineId(id, workItems = []) {
  return workItems.find((item) => item.engineIds.includes(id)) || null;
}

/**
 * Состав сборки одним списком: моды каталога (найденные и заготовки),
 * работы из кода сборки и установки мастерской из `modIds` старых сборок,
 * сведённые к своим работам. Работа, которая уже есть в коде сборки,
 * второй раз не считается; id движка, у которого работы не нашлось (снята
 * из игры), в состав не идёт — ставить и показывать по нему нечего.
 *
 * @returns {{ mods: object[], works: object[], engineWorks: object[] }}
 *   `mods` — записи модов (как `openedBuildMods`), `works` — записи кода
 *   сборки, `engineWorks` — элементы работ для id движка.
 */
export function buildContents(profile, { mods = [], workItems = [], modsById = null } = {}) {
  const codeWorks = profile?.works || [];
  const catalogMods = mods.filter((mod) => !isWorkshopEngineId(mod?.id, modsById));
  const engineWorks = [];
  const seen = new Set();
  for (const id of profile?.modIds || []) {
    if (!isWorkshopEngineId(id, modsById)) continue;
    const item = workOfEngineId(id, workItems);
    if (!item || seen.has(item.key)) continue;
    seen.add(item.key);
    const sameKind = codeWorks.some(
      (entry) =>
        entry.workKind === item.workKind &&
        (!WORK_KINDS[item.workKind]?.perSlot || entry.slotId === item.slotId),
    );
    if (!sameKind) engineWorks.push(item);
  }
  /* Одна вещь — одна карточка, как на полке библиотеки (`work-cards.js`). */
  return { mods: catalogMods, works: codeWorks, engineWorks: mergeWorkCards(engineWorks) };
}
