/*
 * Семейства находок — то, как мод называется в каталоге.
 *
 * Разбор по файлам честен, но модератору он мелковат: «Оружие · w_pi_revolver»,
 * «Оружие · w_ar_carbinerifle», «Оружие · …» — восемь карточек там, где человек
 * видит один ганпак. Семейство собирает находки одной сути в одну карточку:
 * ганпак, одежда, трассеры, мини-карта, большая карта, таймцикл, арена,
 * залазы, маппинг. Находки при этом никуда не деваются — они остаются
 * составом семейства, и снять галочку с одного ствола по-прежнему можно.
 *
 * Семейство — это ещё и способ сборки. Ганпак и мир собираются одним
 * манифестом на всё семейство, оптимизация — по манифесту на каждый
 * переключатель, трассеры — не манифестом вовсе, а DDS и черновиком для
 * мастера трассеров: целый `core.ypt` заменой не публикуется, он перетёр бы
 * подписанное ядро.
 *
 * Порядок семейств — порядок, в котором о редуксе рассказывает человек:
 * сначала ганпак и одежда, потом трассеры и карты, потом мир. Внутри порядка
 * готовое стоит выше требующего проверки.
 */

import { FINDING_CATEGORIES } from "./rules.js";
import { describeWeaponSlot } from "./weapon-slots.js";
import { identifyPlaces, stemOf } from "./place-fingerprints.js";

/**
 * Семейства, у которых есть своё имя и свой способ сборки.
 *
 * `categories` — какие находки в него попадают; `build` — как собирается;
 * `preview` — чем рисуется обложка. Категория, не названная ни в одном
 * семействе, образует семейство сама по себе.
 */
export const FAMILY_KINDS = Object.freeze({
  gunpack: {
    title: "Ганпак",
    categories: ["weapon-model"],
    build: "single-manifest",
    preview: "weapons",
    /* Обвесы `w_at_*` — не стволы, а детали ствола едут с ним: «31 ствол»
       там, где семь стволов и 24 детали, был бы неправдой. */
    count: (n, members = []) => {
      const guns = new Set();
      let attachments = 0;
      for (const member of members) {
        if (!member.group) continue;
        const place = describeWeaponSlot(member.group);
        if (place.kind === "attachment") attachments += 1;
        else guns.add(place.model);
      }
      const total = members.length ? guns.size : n;
      const line = `${total} ${plural(total, "ствол", "ствола", "стволов")}`;
      return attachments
        ? `${line} и ${attachments} ${plural(attachments, "обвес", "обвеса", "обвесов")}`
        : line;
    },
  },
  clothing: {
    title: "Одежда",
    categories: ["clothing"],
    build: "single-manifest",
    preview: "clothing",
    count: (n) => `${n} ${plural(n, "предмет", "предмета", "предметов")}`,
  },
  /* Эффекты — одна заявка на всё, что автор сделал с частицами: его ядро,
     его кровь и привязки следов к оружию. Целиком ни один из этих файлов не
     ставится, заявка вынимает из них то, что ставится честно. */
  tracers: {
    title: "Эффекты и трассеры",
    categories: ["tracers", "particle-effects", "blood-effects"],
    build: "effects-request",
    preview: "tracers",
    /* Привязка трассеров к оружию живёт в weapons.meta. Файл сам по себе —
       игровые данные и в семейство не переезжает, но модератору важно видеть,
       что он тронут: это признак, что автор трогал и привязки. */
    related: [/^common\/data\/ai\/weapons\.meta$/i],
  },
  minimap: {
    title: "Мини-карта",
    categories: ["minimap"],
    build: "per-member",
    preview: "minimap",
  },
  "large-map": {
    title: "Большая карта",
    categories: ["large-map"],
    build: "per-member",
    preview: "large-map",
  },
  /* Векторная карта — тайлы-модели в `minimap.rpf`. Другой формат, другой
     файл, другая обложка; в каталоге она отдельной карточкой. */
  "large-map-vector": {
    title: "Большая карта · векторная",
    categories: [],
    build: "per-member",
    preview: "large-map-vector",
  },
  "large-map-zoom": {
    title: "Отдаление большой карты",
    categories: ["large-map-zoom"],
    build: "per-member",
    preview: "large-map-zoom",
  },
  timecycle: {
    title: "Таймцикл",
    categories: ["timecycle"],
    build: "per-member",
    preview: "timecycle",
  },
  arenas: {
    title: "Арена",
    categories: ["arenas"],
    build: "single-manifest",
    preview: "world",
  },
  climbs: {
    title: "Залазы",
    categories: ["climbs"],
    build: "single-manifest",
    preview: "world",
  },
  /* Места мастерской из редукса (16.10, `workshop-places.js`). */
  hangar: {
    title: "Ангар",
    categories: ["hangar"],
    build: "single-manifest",
    preview: "world",
  },
  zones: {
    title: "Зоны",
    categories: ["zones"],
    build: "single-manifest",
    preview: "world",
  },
  schedule: {
    title: "Расписание",
    categories: ["schedule"],
    build: "single-manifest",
    preview: "world",
  },
  mapping: {
    title: "Маппинг",
    categories: ["mapping"],
    build: "single-manifest",
    preview: "world",
    count: (n) => `${n} ${plural(n, "контейнер", "контейнера", "контейнеров")}`,
  },
  "object-optimization": {
    title: "Оптимизация объектов",
    categories: ["object-optimization"],
    build: "single-manifest",
    preview: "world",
    slot: "optimization-objects",
    count: (n) => `${n} ${plural(n, "контейнер", "контейнера", "контейнеров")}`,
  },
  /* Деревья — тот же слой мира, что и маппинг, но в каталоге и в голове у
     человека это отдельный мод: «поставил новые деревья», а не «маппинг».
     Категория та же (`mapping`), семейство выбирается по подсказке находки. */
  trees: {
    title: "Деревья",
    categories: [],
    build: "single-manifest",
    preview: "world",
    slot: "vegetation-trees",
    count: (n) => `${n} ${plural(n, "контейнер", "контейнера", "контейнеров")}`,
  },
  /* Трава газонов и сорняки (карты травы кварталов) — четвёртый мод мира
     рядом с деревьями, землёй и дорогами: свой слот, чтобы «убрать траву»
     не вытесняло чужие деревья (11.10, COMPETITIVE V2 REDUX). */
  grass: {
    title: "Трава и кусты",
    categories: [],
    build: "single-manifest",
    preview: "world",
    slot: "vegetation-grass",
    count: (n) => `${n} ${plural(n, "контейнер", "контейнера", "контейнеров")}`,
  },
  /* Земля — тот же слой мира, но третий мод рядом с деревьями и травой:
     «зелёный Сенди» ставится отдельно, и чужие деревья встают поверх него.
     Свой слот — чтобы земля, деревья и трава не вытесняли друг друга. */
  terrain: {
    title: "Поверхность земли",
    categories: [],
    build: "single-manifest",
    preview: "world",
    slot: "vegetation-ground",
    count: (n) => `${n} ${plural(n, "контейнер", "контейнера", "контейнеров")}`,
  },
  /* Дороги — тот же слой мира: асфальт и разметка ставятся слоем Astral
     поверх штатных словарей и снимаются, не трогая землю и деревья. */
  "roads-layer": {
    title: "Дороги",
    categories: [],
    build: "single-manifest",
    preview: "world",
    slot: "roads",
    count: (n) => `${n} ${plural(n, "контейнер", "контейнера", "контейнеров")}`,
  },
  interiors: {
    title: "Интерьеры",
    categories: ["interiors"],
    build: "single-manifest",
    preview: "world",
  },
  reticle: {
    title: "Прицел",
    categories: ["reticle"],
    build: "per-member",
    preview: "reticle",
  },
  "kill-effects": {
    title: "Килл-эффект",
    categories: ["kill-effects"],
    build: "per-member",
    preview: "card",
  },
  optimization: {
    title: "Оптимизация",
    categories: ["optimization"],
    build: "per-member",
    preview: "card",
    count: (n) =>
      `${n} ${plural(n, "переключатель", "переключателя", "переключателей")}`,
  },
  sounds: {
    title: "Звуки",
    categories: ["sounds"],
    build: "per-member",
    preview: "sounds",
    count: (n) => `${n} ${plural(n, "банк", "банка", "банков")}`,
  },
});

/** Порядок семейств на экране: так о редуксе рассказывает человек. */
export const FAMILY_ORDER = Object.freeze([
  "gunpack",
  "clothing",
  "tracers",
  "minimap",
  "large-map-vector",
  "large-map",
  "large-map-zoom",
  "timecycle",
  "arenas",
  "climbs",
  "hangar",
  "zones",
  "schedule",
  "mapping",
  "trees",
  "grass",
  "terrain",
  "roads-layer",
  "object-optimization",
  "interiors",
  "reticle",
  "kill-effects",
  "blood-effects",
  "optimization",
  "minimap-position",
  "vegetation",
  "water",
  "fast-entry",
  "roads",
  "world-objects",
  "sounds",
]);

const PREVIEW_BY_CATEGORY = Object.freeze({
  "minimap-position": "card",
  "fast-entry": "card",
  vegetation: "card",
  water: "card",
  vehicles: "card",
  interface: "card",
  textures: "card",
  "game-data": "card",
  roads: "card",
  "world-objects": "card",
});

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

const VERDICT_RANK = { ready: 0, review: 1, no: 2 };

/** Лучший вердикт среди участников: семейство собираемо, если хоть кто-то. */
function familyVerdict(members) {
  let best = "no";
  let reason = "";
  for (const member of members) {
    if (VERDICT_RANK[member.publishable] < VERDICT_RANK[best]) {
      best = member.publishable;
      reason = member.reason;
    }
  }
  return { publishable: best, reason };
}

function kindFor(finding) {
  if (finding.category === "mapping" && finding.hint === "деревья")
    return { id: "trees", ...FAMILY_KINDS.trees };
  if (finding.category === "mapping" && finding.hint === "трава")
    return { id: "grass", ...FAMILY_KINDS.grass };
  if (finding.category === "mapping" && finding.hint === "земля")
    return { id: "terrain", ...FAMILY_KINDS.terrain };
  if (finding.category === "mapping" && finding.hint === "дороги")
    return { id: "roads-layer", ...FAMILY_KINDS["roads-layer"] };
  if (finding.category === "large-map" && finding.variant === "vector")
    return { id: "large-map-vector", ...FAMILY_KINDS["large-map-vector"] };
  for (const [id, kind] of Object.entries(FAMILY_KINDS))
    if (kind.categories.includes(finding.category)) return { id, ...kind };
  return null;
}

const rankOf = (id) => {
  const index = FAMILY_ORDER.indexOf(id);
  return index < 0 ? FAMILY_ORDER.length : index;
};

/**
 * Раскладывает находки по семействам.
 *
 * Собираемое выше несобираемого; внутри — порядок рассказа о редуксе
 * (`FAMILY_ORDER`), потом крупное выше. Непубликуемое (следы установки,
 * отличия сборки, неопознанное) уходит в `rejected`: это видно, но не мешает.
 */
export function groupFamilies(findings) {
  const byId = new Map();
  const rejected = [];

  for (const finding of findings) {
    if (
      finding.publishable === "no" &&
      !FINDING_CATEGORIES[finding.category]?.section
    ) {
      rejected.push(finding);
      continue;
    }
    const kind = kindFor(finding);
    const id = kind ? kind.id : finding.category;
    if (!byId.has(id))
      byId.set(id, {
        id,
        kind: kind ? kind.id : "single",
        title: kind ? kind.title : finding.label,
        build: kind ? kind.build : "per-member",
        preview: kind
          ? kind.preview
          : PREVIEW_BY_CATEGORY[finding.category] || "card",
        ...(kind?.slot ? { slot: kind.slot } : {}),
        members: [],
        related: [],
      });
    byId.get(id).members.push(finding);
  }

  /* Плитки карты паузы и векторный радар `minimap.rpf` одного редукса —
     одна «Большая карта»: у обеих слот `large-map`, и двумя частями сборка
     ставила одну поверх другой — карта автора вставала наполовину
     (COMPETITIVE V2 REDUX, 11.10). Векторная карта без плиток остаётся
     своей карточкой. */
  const tiles = byId.get("large-map");
  const vector = byId.get("large-map-vector");
  if (tiles && vector) {
    tiles.members.push(...vector.members);
    byId.delete("large-map-vector");
  }

  /* Сопутствующие файлы: тронутый weapons.meta рядом с трассерами. Он не
     становится участником — его не собирают — но он виден. */
  for (const family of byId.values()) {
    const patterns = FAMILY_KINDS[family.kind]?.related || [];
    if (!patterns.length) continue;
    for (const finding of findings)
      for (const entry of finding.entries)
        if (patterns.some((pattern) => pattern.test(entry.path)))
          family.related.push({
            path: entry.path,
            change: entry.change,
            finding: finding.id,
          });
  }

  const families = [...byId.values()].map((family) => {
    const files = family.members.reduce((total, item) => total + item.files, 0);
    const bytes = family.members.reduce((total, item) => total + item.bytes, 0);
    const kind = FAMILY_KINDS[family.kind];
    const count = family.members.length;
    const verdict = familyVerdict(family.members);
    /* Откуда семейство: авторские контейнеры, если находки оттуда. */
    const containers = [];
    for (const member of family.members)
      if (
        member.container?.path &&
        !containers.some((item) => item.path === member.container.path)
      )
        containers.push(member.container);
    const deliveries = [
      ...new Set(family.members.map((item) => item.delivery).filter(Boolean)),
    ];
    return {
      ...family,
      subtitle:
        count > 1 && kind?.count
          ? `${kind.count(count, family.members)} · ${files} ${plural(files, "файл", "файла", "файлов")}`
          : `${files} ${plural(files, "файл", "файла", "файлов")}`,
      files,
      bytes,
      containers,
      deliveries,
      origin: family.members.every((item) => item.origin === "container")
        ? "container"
        : family.members.every((item) => item.origin === "diff")
          ? "diff"
          : "mixed",
      uncertain: family.members.every((item) => item.uncertain === true),
      ...verdict,
      confidence: family.members.some((item) => item.confidence === "exact")
        ? "exact"
        : family.members.every((item) => item.confidence === "unknown")
          ? "unknown"
          : "likely",
    };
  });

  families.sort(
    (left, right) =>
      Number(left.publishable === "no") - Number(right.publishable === "no") ||
      rankOf(left.id) - rankOf(right.id) ||
      right.bytes - left.bytes ||
      left.title.localeCompare(right.title, "ru"),
  );

  return {
    families,
    rejected: rejected.sort((left, right) => right.bytes - left.bytes),
  };
}

/*
 * Маппинг редукса — группами по контейнерам автора (11.10, «Объекты мода»).
 *
 * COMPETITIVE V2 REDUX после разблокировки замка «mirz» приносит в
 * маппинге шесть контейнеров: whitelight, kifinzz, kifinangar (ангар),
 * kifinmall (молл), kifinvzh (ВЗХ), kifintime — 458 файлов одной частью.
 * Поставить ангар без молла было нельзя. Теперь каждый контейнер — своё
 * подсемейство: своя часть каталога, свой пакет и свой слот установки
 * (`mapping-<контейнер>`, иначе части сменяли бы друг друга). Слот витрины —
 * прежний «Маппинг». Один контейнер — как раньше, одной частью.
 */
const GROUP_WORDS = Object.freeze([
  [/angar|hangar/i, "Ангар"],
  [/mall/i, "Молл"],
  [/vzh/i, "ВЗХ"],
]);

/*
 * Подпись группы по отпечаткам (план Б, 24.10): ангар, банкоматы, остановки, будки, ганшоп — по моделям, которые
 * правит мастерская, а не по слову в имени контейнера. Группа — это место, когда его модели — не меньше трети её
 * файлов: один банкомат среди сотни чужих файлов группу «Банкоматами» не делает.
 */
const PLACE_GROUPS = Object.freeze({
  hangar: "Ангар",
  atm: "Банкоматы",
  busstop: "Остановки",
  booth: "Парковочные будки",
  gunshop: "Ганшоп",
});
const PLACE_SHARE = 1 / 3;

function placeGroupLabel(members = []) {
  const names = members.flatMap((member) => (member.entries || []).map((entry) => String(entry.path).split("/").pop()));
  const stems = new Set(names.map(stemOf));
  const found = identifyPlaces({ names })
    .filter((place) => place.status === "known" && PLACE_GROUPS[place.kind] && place.matched >= stems.size * PLACE_SHARE)
    .sort((left, right) => right.matched - left.matched)[0];
  return found ? PLACE_GROUPS[found.kind] : "";
}

const containerStem = (finding) =>
  String(finding?.container?.path || finding?.path || "")
    .split("/")
    .pop()
    .replace(/\.rpf$/i, "");

/* Карты размещения и модели группы — имена файлов. */
const placedOf = (members = []) =>
  members
    .flatMap((member) => member.entries || [])
    .map((entry) => String(entry.path).split("/").pop().toLowerCase())
    .filter((name) => /\.(ymap|ydr|ydd|yft)$/.test(name));

/**
 * Подпись группы: по содержимому — больше половины карт и моделей зовутся
 * `zz` / `zz_…` — «Зелёные зоны» (отметки у бизнесов RP-серверов:
 * `zz_24_7`, `zz_zapravka`, `zz_fleeca_bank`); иначе известное слово имени
 * контейнера по-русски; иначе пусто — имя контейнера автора в названии части
 * не показываем (17.10, ведущая: «Маппинг «Optimization»» у bakugam — это
 * десять постеров), группа получает номер (`splitMappingFamilies`).
 */
export function mappingGroupLabel(stem, members = []) {
  const placed = placedOf(members);
  const zones = placed.filter((name) => /^zz([_.]|$)/.test(name)).length;
  if (placed.length && zones * 2 > placed.length) return "Зелёные зоны";
  const byContent = placeGroupLabel(members);
  if (byContent) return byContent;
  const known = GROUP_WORDS.find(([pattern]) => pattern.test(stem));
  return known ? known[1] : "";
}

/** Семейства, где «Маппинг» из нескольких контейнеров разрезан на группы. */
export function splitMappingFamilies(families = []) {
  return families.flatMap((family) => {
    if (family.kind !== "mapping") return [family];
    const groups = new Map();
    for (const member of family.members || []) {
      const stem = containerStem(member);
      if (!groups.has(stem)) groups.set(stem, []);
      groups.get(stem).push(member);
    }
    if (groups.size < 2 || [...groups.keys()].some((stem) => !stem))
      return [family];
    /* Группы без подписи — номерами по числу файлов: крупная — «1». */
    const files = (members) =>
      members.reduce((sum, member) => sum + (member.entries?.length || 0), 0);
    const numbers = new Map(
      [...groups]
        .filter(([stem, members]) => !mappingGroupLabel(stem, members))
        .sort((left, right) => files(right[1]) - files(left[1]))
        .map(([stem], index) => [stem, String(index + 1)]),
    );
    return [...groups].map(([stem, members]) => {
      const label = mappingGroupLabel(stem, members) || numbers.get(stem);
      const key = stem
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24);
      return {
        ...family,
        id: `mapping-${key}`,
        title: `${family.title} «${label}»`,
        slot: `mapping-${key}`,
        idSuffix: key,
        group: { stem, label },
        members,
      };
    });
  });
}

/*
 * Арены по серверам (16.10). Арена — зал своего сервера: `v_62_*` у
 * GTA 5 RP, `mj_ma_*` у Majestic (`workshop-places.js`). У kray v2 redux их
 * две, и одной частью «Арена» их не поставить: человек играет на одном
 * сервере. Доказанный сервер — в имени части и в `arena.server`; две арены —
 * два своих слота установки (`arenas-<сервер>`), полка каталога общая.
 */
export const ARENA_SERVER_LABELS = Object.freeze({
  gta5rp: "GTA 5 RP",
  majestic: "Majestic",
});

/* Арена без доказанного сервера: «новая» (своих моделей автора не из известных арен) или «не доказана» (общий квартал). */
function unprovenArena(members = []) {
  const marks = members.map((member) => member.arena).filter((arena) => arena && !arena.server);
  const fresh = marks.find((arena) => arena.status === "new");
  const mark = fresh || marks[0];
  return { status: fresh ? "new" : "unproven", evidence: mark?.evidence || "" };
}

/** Папка контейнера автора: `halloween/arena.rpf` → `halloween`. */
const containerFolder = (finding) =>
  String(finding?.container?.path || finding?.path || "")
    .split("/")
    .slice(0, -1)
    .join("/")
    .toLowerCase();

/*
 * Экстерьер и дальние модели арены (`arena_exterior.rpf`, `arena_lod.rpf`) сервера не называют: своих `v_62_*`/`mj_ma_*` у них нет. Лежат они в
 * папке автора рядом с залом, и это части ОДНОЙ арены (hallowen, 10.11.2026: «Вариант 2» из экстерьера и LOD ломал арену выбором варианта).
 * Если в посте ровно одна арена с доказанным сервером, безымянные контейнеры её папки идут с ней.
 */
function attachArenaCompanions(servers) {
  const named = [...servers.keys()].filter(Boolean);
  const loose = servers.get("");
  if (named.length !== 1 || !loose?.length) return;
  const folders = new Set(servers.get(named[0]).map(containerFolder));
  const stay = loose.filter((member) => !folders.has(containerFolder(member)));
  servers.get(named[0]).push(...loose.filter((member) => folders.has(containerFolder(member))));
  if (stay.length) servers.set("", stay);
  else servers.delete("");
}

export function splitArenaFamilies(families = []) {
  return families.flatMap((family) => {
    if (family.kind !== "arenas") return [family];
    const servers = new Map();
    for (const member of family.members || []) {
      const server = ARENA_SERVER_LABELS[member.arena?.server]
        ? member.arena.server
        : "";
      if (!servers.has(server)) servers.set(server, []);
      servers.get(server).push(member);
    }
    attachArenaCompanions(servers);
    if (servers.size === 1 && servers.has("")) return [{ ...family, arena: unprovenArena(family.members) }];
    return [...servers].map(([server, members]) =>
      server
        ? {
            ...family,
            id: servers.size > 1 ? `arenas-${server}` : family.id,
            title: `${family.title} ${ARENA_SERVER_LABELS[server]}`,
            ...(servers.size > 1
              ? { slot: `arenas-${server}`, idSuffix: server }
              : {}),
            arena: { server },
            members,
          }
        : { ...family, members, arena: unprovenArena(members) },
    );
  });
}

/*
 * Зоны по контейнерам (16.10): у kray v2 redux запретные зоны (`mcl.rpf`,
 * набор мастерской) и зелёные зоны автора (`zz.rpf`) — разные моды, каждый
 * своей частью: «Запретные зоны» и «Зелёные зоны» (оба вида — «Зоны»).
 * Несколько контейнеров — свой слот установки у каждого.
 */
const ZONE_TITLES = Object.freeze({
  green: "Зелёные зоны",
  forbidden: "Запретные зоны",
  bizwar: "Зона бизвара",
  vzh: "Зона ВЗХ",
  port: "Зона порта",
  /* Зоны каптов и МСЛ-зоны (Хелпер 19, 27.10.2026): `workshop-places.js`. */
  capt: "Зоны каптов",
  msl: "МСЛ-зоны",
});

const zoneTitle = (members) => {
  const kinds = new Set(members.flatMap((member) => member.zones || []));
  return kinds.size === 1 ? ZONE_TITLES[[...kinds][0]] || "Зоны" : "Зоны";
};

export function splitZoneFamilies(families = []) {
  return families.flatMap((family) => {
    if (family.kind !== "zones") return [family];
    const groups = new Map();
    for (const member of family.members || []) {
      const stem = containerStem(member);
      if (!groups.has(stem)) groups.set(stem, []);
      groups.get(stem).push(member);
    }
    if (groups.size < 2)
      return [{ ...family, title: zoneTitle(family.members || []) }];
    return [...groups].map(([stem, members]) => {
      const key = stem
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24);
      return {
        ...family,
        id: `zones-${key}`,
        title: zoneTitle(members),
        slot: `zones-${key}`,
        idSuffix: key,
        members,
      };
    });
  });
}

/*
 * Залазы по контейнерам автора (10.11.2026). hallowen приносит два набора: `1.rpf` (залазы) и `vzhzal.rpf` (ВЗХ-залазы). Имена файлов у них одни
 * (`stay.ydr`, `arrow.ydr`, `_manifest.ymf`…), байты разные; одной заявкой они склеивались по имени (27 файлов → 19), и версии ВЗХ терялись.
 * Каждый контейнер — свой компонент со своим слотом установки, как у зон.
 */
const CLIMB_TITLES = Object.freeze({ vzh: "Залазы ВЗХ" });

const climbTitle = (stem, family) => (/vzh/i.test(stem) ? CLIMB_TITLES.vzh : family.title);

export function splitClimbFamilies(families = []) {
  return families.flatMap((family) => {
    if (family.kind !== "climbs") return [family];
    const groups = new Map();
    for (const member of family.members || []) {
      const stem = containerStem(member);
      if (!groups.has(stem)) groups.set(stem, []);
      groups.get(stem).push(member);
    }
    if (groups.size < 2 || [...groups.keys()].some((stem) => !stem)) return [family];
    return [...groups].map(([stem, members]) => {
      const key = stem
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24);
      return {
        ...family,
        id: `climbs-${key}`,
        title: climbTitle(stem, family),
        slot: `climbs-${key}`,
        idSuffix: key,
        group: { stem },
        members,
      };
    });
  });
}

/*
 * Растительность одного редукса — одна часть (17.10, владелец): вместо
 * «Поверхности земли», «Деревьев» и «Травы и кустов» — «Растительность»,
 * у неё одна плитка и кадр полосами. Трава-убиралка (карты травы с пустыми
 * моделями, `removes`) остаётся своей частью. Пакет занимает все слоты
 * участников: старые отдельные части других редуксов вытесняются только
 * там, где пересекаются.
 */
const VEGETATION_WORLD_KINDS = new Set(["terrain", "trees", "grass"]);

export function mergeVegetationFamilies(families = []) {
  const parts = families.filter(
    (family) =>
      VEGETATION_WORLD_KINDS.has(family.kind) &&
      !(
        family.kind === "grass" &&
        (family.members || []).some((member) => member.removes)
      ),
  );
  if (!parts.length) return families;
  const members = parts.flatMap((family) => family.members || []);
  const verdict = familyVerdict(members);
  const files = parts.reduce((total, family) => total + (family.files || 0), 0);
  const merged = {
    ...parts[0],
    id: "vegetation-world",
    kind: "vegetation-world",
    title: "Растительность",
    build: "single-manifest",
    preview: "world",
    slot: "vegetation",
    slots: [...new Set(parts.map((family) => family.slot).filter(Boolean))],
    ground: parts.some((family) => family.kind === "terrain"),
    members,
    related: parts.flatMap((family) => family.related || []),
    files,
    bytes: parts.reduce((total, family) => total + (family.bytes || 0), 0),
    containers: parts.flatMap((family) => family.containers || []),
    ...verdict,
  };
  const at = families.indexOf(parts[0]);
  const rest = families.filter((family) => !parts.includes(family));
  return [...rest.slice(0, at), merged, ...rest.slice(at)];
}
