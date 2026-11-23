/*
 * Архивные компоненты редукса → заявки (пакет Р3а, проект `REDUX-SYSTEM-1011.md`, §4.4 и §6.1; Хелпер 28, 10.11.2026).
 *
 * Чистый модуль: из разбора `analyzeAnatomy` делает заявки того же вида, что отдаёт работник (`assembleDraft` в `intake-worker.js`):
 * `{ id, archive, kind, delivery, spec, files, card, domain, problems }`. Ничего не читает; откуда брать байты файла, говорит внедряемая
 * `sourceOf(путь записи update.rpf) → путь в дереве поста`.
 *
 * Компонент-архив — ОДНА заявка. Все файлы всех его единиц, без резки и отбора по расширению, записями слоя Astral:
 *   `x64/astral/astral_r<NNN>_part_<kk>.rpf/<файл>`
 * где `NNN` — место единицы в порядке включения автора × 10 (три цифры), `kk` — номер архива внутри компонента (01…99). Реестр движка
 * пишет строки по алфавиту, значит по `NNN`: порядок автора сохраняется. Хэш id мода в имя вставит движок (Р2, `withOwnMapsContainer`),
 * здесь имя «не итоговое», как `astral_m_part_<k>` у арен.
 *
 * Маршрутные компоненты (мини-карта, таймцикл, эффекты…) и компонент, в котором есть не-архив, — не здесь: они в `deferred` (Р3б, Р3в).
 */

import { latinSlug } from "@modovik/publishing";
import { CATALOG_PLACEMENT, CATALOG_SHELF } from "./card.js";
import { postKey } from "./post-key.js";

export const UPDATE_RPF = "update/update.rpf";
export const LAYER_STRATEGY = Object.freeze({ strategy: "rpf-resource-layer-v1" });
/* Те же возможности, что у мирового слоя `buildContentLayerSpec` (`spec.js`): тест держит равенство. */
export const ARCHIVE_CAPABILITIES = Object.freeze(["rpf-container-entry-v1", "astral-content-rpf-v1", "direct-update-rpf-v1", "direct-update-entries-v1"]);
/* Имя записи, как его принимает движок (`ASTRAL_CONTENT_ENTRY_PATTERN`): слово клипа `clip@имя.ycd` и `_manifest.ymf` допустимы. */
const SAFE_SEGMENT = /^(?:[a-z0-9_]{1,40}@)?[a-z0-9_][a-z0-9._+~-]{0,119}$/;
export const ID_LIMIT = 96;
/* Словарь текстур с хоть одной текстурой меньше 256 байт не бывает: меньше — подпись автора без текстур (`by otto.ytd`, 65 байт). Байтов записи здесь нет — судим по размеру из описи. */
export const EMPTY_DICTIONARY_MAX = 256;
const isEmptyDictionary = (file) => /\.ytd$/i.test(String(file.inner ?? file.path)) && Number(file.size) <= EMPTY_DICTIONARY_MAX;
const PARTS_MAX = 99;
const ORDER_MAX = 99;
export const NO_MEDIA = "Обложки нет: снимите кадр из обзора редукса.";

/** Вид компонента анатомии → вид заявки каталога (существующие, где они есть). */
export const DRAFT_KIND = Object.freeze({
  arena: "arenas",
  hangar: "hangar",
  climbs: "climbs",
  "climbs-vzh": "climbs",
  zones: "zones",
  schedule: "schedule",
  interior: "interiors",
  lanterns: "lanterns",
  vegetation: "vegetation-world",
  optimization: "redux-optimization",
  mapping: "mapping",
  font: "font",
});

/* Места в каталоге для видов, которых у разбора не было: полка берётся у ближайшего существующего вида, подпись — своя. */
const EXTRA_PLACEMENT = Object.freeze({
  /* Подраздел «Улучшений» окно берёт по слоту полки (`IMPROVEMENT_SLOT_LABELS`): фонари — `lights`, оптимизация — `optimization`. */
  lanterns: { like: "mapping", categoryLabel: "Фонари", slot: "lights", subcategory: "Фонари" },
  "redux-optimization": { like: "object-optimization", categoryLabel: "Оптимизация", slot: "optimization", subcategory: "Оптимизация" },
  /* Шрифт игры из архива автора: полка интерфейса, подраздел «HUD» (как у цветов интерфейса; своего подраздела в списке окна нет). */
  font: { like: "mapping", category: "graphics", categoryLabel: "Шрифт", slot: "font", catalogCategory: "interface", subcategory: "HUD" },
});

/*
 * Полки каталога у маппинга с известным видом (`shelf` правила имени, `anatomy-names.js`): слот полки — id редактора «Для редуксов» (по нему окно кладёт
 * карточку на полку и не прячет её как безымянный маппинг), подпись — название полки.
 */
export const MAPPING_SHELVES = Object.freeze({
  wallbang: "Прострелы",
  "msl-zones": "МСЛ-зоны",
  "mega-mall": "Мегамолл",
  ashan: "Ашан / Икея",
  factory: "Завод",
  banners: "Баннеры",
  billboards: "Билборды",
  atms: "Банкоматы",
  busstops: "Остановки",
  flags: "Флаги",
});

/* Пояснения к слотам для описи заявки (`part.json`): чтобы читающий (обложки, окно) не гадал о конфликтах слотов. */
export const SLOT_NOTES = Object.freeze({
  lanterns: "Фонари автора (слот установки lanterns, полка lights) и фонари мастерской (street-lights) — разные вещи, конфликта слотов между ними нет.",
});

const SERVER_WORDS = Object.freeze({ gta5rp: "GTA 5 RP", majestic: "Majestic" });
const ZONE_KINDS = Object.freeze({ green: ["green"], forbidden: ["forbidden"], vzh: ["vzh"] });

/** Слот установки компонента бывает архивным, только если все его единицы — подключённые архивы автора. */
/**
 * Зависимости между пакетами одного редукса (verify-install hallowen, 10.11.2026: слой крови ставился РАНЬШЕ ядра автора — «В ядре эффектов игры нет правил blood_entryr»).
 *
 * Пакет, чьи правила или записи лежат в другом пакете, называет их ключи в `domain.anatomy.needs` (кровь и привязки трассеров ссылаются на правила ядра и словарей частиц
 * автора: `effects-core`, `particle-effects`). Здесь ключи становятся id заявок того же редукса и того же варианта поста: `domain.anatomy.requires`. Его читают порядок сборки
 * (требуемые встают раньше, `orderedParts`) и окно (группу ставят одной пачкой в этом порядке и не дают поставить зависимый пакет без требуемых). Повторный вызов даёт тот же
 * результат, после смены id у вариантов его зовут ещё раз.
 *
 * @param {object[]} drafts заявки одного разбора (любой набор: берутся только те, у кого есть `domain.anatomy`)
 */
export function resolveRequires(drafts) {
  for (const draft of drafts) {
    const anatomy = draft.domain?.anatomy;
    if (!anatomy?.needs?.length) continue;
    const mine = new Set((anatomy.variants ?? []).map((variant) => variant.key));
    const ids = drafts
      .filter((other) => {
        const block = other.domain?.anatomy;
        if (other === draft || !block || !anatomy.needs.includes(block.package)) return false;
        return mine.size === 0 || !block.variants?.length || block.variants.some((variant) => mine.has(variant.key));
      })
      .toSorted((left, right) => anatomy.needs.indexOf(left.domain.anatomy.package) - anatomy.needs.indexOf(right.domain.anatomy.package))
      .map((other) => other.id);
    if (ids.length) anatomy.requires = ids;
    else delete anatomy.requires;
  }
}

/** Пакеты компонента «Эффекты» (одна вещь с одной картинкой): ключи `domain.anatomy.package`. Привязки трейсеров (`tracer-bindings`) — отдельный компонент, в группу не входят. */
export const EFFECTS_PACKAGES = Object.freeze(["blood-routing", "particle-effects", "effects-tables", "effects-core"]);

/**
 * «Эффекты» у каждой версии свои (HALLOWEN 240, 13.11.2026: ядро у версий разное, а слой крови один на обе — в версии «без эффектов» страница показывала кадр попадания версии «с
 * эффектами»). Заявки версий сливаются по содержимому (`anatomyOf`), и общим оставался любой пакет группы с одинаковым содержимым. Если хотя бы один пакет группы у версий РАЗНЫЙ
 * (один ключ пакета — две заявки с разным содержимым: два ядра), вся группа становится своей у каждой версии: общий пакет разворачивается в копии по версиям. У первой версии пакета
 * прежний id, у остальных хвост `-<ключ версии>` (`-v2`), `domain.anatomy.variants` — одна версия и метка `domain.anatomy.versionCopy` (ключ версии): по ней политика импорта
 * не выбрасывает копию как дубль первой заявки (13.11.2026: без метки версия «без эффектов» HALLOWEN 240 осталась вовсе без слоя крови). Остальные компоненты (карта, арена, зоны…) остаются общими.
 * Пакет, которого в какой-то версии просто нет (кровь у одной из версий GODMODE), «разным» не считается: общее ядро таких версий остаётся общим.
 * Зависимости (`requires`) после этого пересчитывает `resolveRequires` — копия крови ссылается на ядро своей версии.
 *
 * @param {object[]} drafts заявки разбора всех версий; массив изменяется на месте (копия встаёт сразу за оригиналом)
 * @returns {{ split: boolean, created: string[], expanded: string[] }} `created` — id новых копий, `expanded` — id заявок, что развернулись
 */
export function splitEffectsByVersion(drafts, { idLimit = ID_LIMIT } = {}) {
  const inGroup = (draft) => EFFECTS_PACKAGES.includes(draft.domain?.anatomy?.package);
  const group = drafts.filter(inGroup);
  const perPackage = new Map();
  for (const draft of group) perPackage.set(draft.domain.anatomy.package, (perPackage.get(draft.domain.anatomy.package) ?? 0) + 1);
  const result = { split: false, created: [], expanded: [] };
  if (![...perPackage.values()].some((count) => count > 1)) return result;
  result.split = true;
  const taken = new Set(drafts.map((draft) => draft.id));
  for (const draft of group) {
    const variants = draft.domain.anatomy.variants ?? [];
    if (variants.length < 2) continue;
    const [first, ...others] = variants;
    const copies = others.map((variant) => {
      const tail = `-${variant.key}`;
      let id = `${draft.id.slice(0, idLimit - tail.length)}${tail}`;
      for (let copy = 2; taken.has(id); copy += 1) id = `${draft.id.slice(0, idLimit - tail.length - 2)}${tail}-${copy}`;
      taken.add(id);
      result.created.push(id);
      return {
        ...draft,
        id,
        spec: { ...draft.spec, id },
        files: [...(draft.files ?? [])],
        problems: [...(draft.problems ?? [])],
        /* `versionCopy` — метка копии: содержимое то же, что у заявки первой версии, но это не дубль (политика импорта, «одинаковое содержимое в посте»). */
        domain: { ...draft.domain, anatomy: { ...draft.domain.anatomy, variants: [{ ...variant }], versionCopy: variant.key } },
      };
    });
    draft.domain.anatomy.variants = [{ ...first }];
    drafts.splice(drafts.indexOf(draft) + 1, 0, ...copies);
    result.expanded.push(draft.id);
  }
  return result;
}

export const isArchiveComponent = (component, unitsById) =>
  Object.hasOwn(DRAFT_KIND, component.kind) && component.units.length > 0 && component.units.every((id) => unitsById.get(id)?.type === "container");

export const plural = (n, one, few, many) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

/* Приставка id из названия редукса: латиница и цифры через дефис до 24 знаков; названию без латиницы («Грустный редукс») — транслит (как `stable-ids.js`). */
/**
 * Подпись компонента для имени карточки: уточнение после « · » («МСЛ-зоны · bans_mcl», «Маппинг · kovaak») — в скобки. Правило имён каталога (`reduxPartName`) делит имя по « · »
 * на редукс и вид, и уточнение без скобок прилипало к названию редукса: «GODMODE · bans_mcl MSL Zones».
 */
export const partLabel = (text) => {
  const label = String(text ?? "");
  const at = label.indexOf(" · ");
  return at < 0 ? label : `${label.slice(0, at)} (${label.slice(at + 3)})`;
};

export const idPrefixOf = (label) => {
  const own = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return /[a-z]/.test(own) ? own : latinSlug(label, 24) || "redux";
};

/** `payload/<номер>-<имя>`: плоское безопасное имя файла пакета без совпадений внутри него (как `payloadName` в `spec.js`). */
export const payloadName = (name, index) => `payload/${String(index).padStart(3, "0")}-${name.replace(/[^a-z0-9._+-]/gi, "_")}`;

const pad = (value, width) => String(value).padStart(width, "0");

/** Имя контейнера слоя для единицы: порядок автора (`NNN`) и номер архива в компоненте (`kk`). */
export function layerContainer(order, part) {
  return `x64/astral/astral_r${pad(order * 10, 3)}_part_${pad(part, 2)}.rpf`;
}

function describe(component, units, label) {
  const files = component.files;
  const archives = units.length;
  const from = label ? ` редукса ${label}` : "";
  const counts = `${archives} ${plural(archives, "архив", "архива", "архивов")} автора, ${files} ${plural(files, "файл", "файла", "файлов")} целиком`;
  const named = (component.servers?.length > 1 ? component.servers : [component.server]).filter(Boolean).map((name) => SERVER_WORDS[name] || name);
  const server = named.length ? ` для ${named.join(" и ")}` : "";
  const title = component.split ? component.label.replace(/ \([^)]*\)$/, "") : component.label;
  return `${title}${server}${from}: ${counts}, в порядке включения автора.`;
}

export function placementOf(kind) {
  const extra = EXTRA_PLACEMENT[kind];
  if (extra) {
    const { like, ...own } = extra;
    return { ...CATALOG_PLACEMENT[like], ...(CATALOG_SHELF[like] || {}), ...own };
  }
  return { ...(CATALOG_PLACEMENT[kind] || {}), ...(CATALOG_SHELF[kind] || {}) };
}

/**
 * Заявки архивных компонентов разбора.
 *
 * @param {object} anatomy результат `analyzeAnatomy`
 * @param {{ label?: string, author?: string, archive?: string, postUrl?: string, sourceOf?: (path: string) => string }} [context]
 *   `label` — название редукса (имя карточек), `archive` — имя архива поста, `postUrl` — адрес поста (хвост id), `sourceOf` — путь файла в дереве.
 * @returns {{ drafts: object[], problems: object[], deferred: { slot: string, kind: string, why: string }[] }}
 */
export function archiveComponentDrafts(anatomy, context = {}) {
  const { label = "", author = "", archive = "", postUrl = "", sourceOf = (path) => path } = context;
  const unitsById = new Map(anatomy.units.map((unit) => [unit.id, unit]));
  const drafts = [];
  const problems = [];
  const deferred = [];

  const chosen = anatomy.components.filter((component) => {
    if (isArchiveComponent(component, unitsById)) return true;
    deferred.push({ slot: component.slot, kind: component.kind, why: Object.hasOwn(DRAFT_KIND, component.kind) ? "в компоненте есть не-архивные единицы (Р3б)" : "маршрутный компонент (Р3б, Р3в)" });
    return false;
  });

  /* Одноимённые карточки одной полки отличает подпись компонента: «<редукс> · Интерьер 7». */

  for (const component of chosen) {
    const members = component.units.map((id) => unitsById.get(id));
    const kind = DRAFT_KIND[component.kind];
    const draftProblems = [];
    if (members.length > PARTS_MAX) {
      draftProblems.push({ code: "parts-limit", message: `${component.label}: архивов ${members.length}, номер архива двузначный — больше ${PARTS_MAX} не помещается.`, severity: "block" });
      problems.push(...draftProblems);
      continue;
    }
    const files = [];
    const mapping = [];
    /* Откуда запись у автора (`covers[].author`/`inventory` описи части): путь файла в архиве автора и его отпечаток из описи. */
    const sources = {};
    const unsafe = [];
    let unsafeReal = false;
    members.forEach((unit, at) => {
      if (unit.order === null || unit.order === undefined) {
        draftProblems.push({ code: "unit-order", message: `${unit.path}: у архива нет места в порядке включения автора.`, severity: "block" });
        return;
      }
      if (unit.order > ORDER_MAX) {
        draftProblems.push({ code: "unit-order", message: `${unit.path}: место в порядке включения ${unit.order} не помещается в три цифры (×10).`, severity: "block" });
        return;
      }
      const container = layerContainer(unit.order, at + 1);
      for (const file of unit.files) {
        const inner = String(file.inner).toLowerCase();
        if (!inner.split("/").every((segment) => SAFE_SEGMENT.test(segment))) {
          unsafe.push(file.path);
          if (!isEmptyDictionary(file)) unsafeReal = true;
          continue;
        }
        const index = files.length;
        const source = payloadName(inner.split("/").pop(), index);
        files.push({ source, target: UPDATE_RPF, entry: `${container}/${inner}`, merge: { ...LAYER_STRATEGY }, action: "import" });
        mapping.push({ path: source, source: sourceOf(file.path), sha256: file.sha256, size: file.size });
        sources[`${container}/${inner}`] = { author: file.path, inventory: file.sha256 };
      }
    });
    if (unsafe.length) {
      draftProblems.push({
        code: "files-omitted",
        message: `${component.label}: в пакет не вошли файлы автора (${unsafe.length}): ${unsafe.slice(0, 6).map((path) => path.split("/").pop()).join(", ")}${unsafe.length > 6 ? "…" : ""} — имя, которое установщик не примет${unsafeReal ? "" : " (пустой словарь текстур, игре не нужен)"}.`,
        severity: unsafeReal ? "block" : "warn",
      });
    }
    if (draftProblems.some((item) => item.severity === "block" && item.code === "unit-order")) {
      problems.push(...draftProblems);
      continue;
    }

    /* Слот установки берёт имя архива автора как есть (`mapping-bans_mcl`), а id заявки — он же slug каталога: только латиница, цифры и дефис. */
    const baseId = [idPrefixOf(label), component.slot.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""), component.split ?? ""].filter(Boolean).join("-");
    const id = [baseId, postKey(postUrl)].filter(Boolean).join("-").slice(0, ID_LIMIT);
    const shelfLabel = component.shelf ? MAPPING_SHELVES[component.shelf] : "";
    const placement = shelfLabel ? { ...placementOf(kind), categoryLabel: shelfLabel, slot: component.shelf, subcategory: shelfLabel } : placementOf(kind);
    /* Шрифт и остаток подключённого архива («Прочее · …») всегда с подписью компонента: карточка редукса без неё была бы не отличима от основной. */
    /* Имя — «<редукс> · <компонент>» у каждой заявки (12.11.2026): карточка «просто <редукс>» не отличима от сборки, а вид в имени нужен правилу имён каталога
       («GODMODE · Прострелы» → «GODMODE Wallbangs»). Раньше вид дописывал сборщик партии — и терял его у заявок, чьё имя уже прошло это правило. */
    const name = label ? `${label} · ${partLabel(component.label)}` : partLabel(component.label);
    const card = {
      name,
      description: describe(component, members, label),
      author: String(author || "").trim(),
      ...placement,
      catalogSubcategory: placement.subcategory ?? "",
      ...(component.server ? { platforms: component.servers?.length > 1 ? component.servers : [component.server] } : {}),
    };
    delete card.subcategory;
    if (!card.catalogSubcategory) delete card.catalogSubcategory;

    const domain = {
      anatomy: {
        schema: 1,
        redux: label,
        slot: component.slot,
        slots: component.slots,
        /* Арена двух серверов — две заявки с одним слотом разбора (`arenas`): сервер части отличает их при поиске компонента (сцена обложки). */
        ...(component.split ? { split: component.split } : {}),
        kind: component.kind,
        label: component.label,
        order: component.order,
        build: anatomy.build.key,
        stock: "container",
        ...(SLOT_NOTES[component.slot] ? { slotNote: SLOT_NOTES[component.slot] } : {}),
        units: members.map((unit, at) => ({ id: unit.id, path: unit.path, order: unit.order, part: at + 1, container: layerContainer(unit.order, at + 1), files: unit.files.length, kindBy: unit.kindBy, kindNote: unit.kindNote })),
        sources,
      },
      ...(component.kind === "zones" ? { zones: { kinds: ZONE_KINDS[component.zone] ?? [] } } : {}),
    };
    if (component.kind === "zones" && !domain.zones.kinds.length) delete domain.zones;

    drafts.push({
      id,
      archive,
      kind,
      delivery: "package",
      spec: {
        id,
        version: "1.0.0",
        adapter: "rpf-entry",
        editions: ["Legacy"],
        requiresLoader: false,
        scope: "game-root",
        gameplayChanges: true,
        ...(author ? { author } : {}),
        capabilities: [...ARCHIVE_CAPABILITIES],
        slots: [...component.slots],
        files,
      },
      files: mapping,
      card,
      domain,
      problems: [...draftProblems, { code: "needs-media", message: NO_MEDIA, severity: "warn" }],
    });
  }
  return { drafts, problems, deferred };
}
