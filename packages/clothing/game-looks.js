/*
 * Одинаковые вещи игры — одна плитка вместо нескольких (круг 7, 30.10.2026; владелец: «чёрные водительские 4 раза, и при этом они визуально одинаковые выглядят … Сделай у всех разные
 * модельки, чтобы они были реалистичными один в один к игре»).
 *
 * Откуда повторки (разобрано по файлам игры владельца, хеши геометрии и пикселей). Rockstar выпускает ту же вещь снова и снова: одна и та же перчатка «Чёрные водительские» лежит в
 * Ограблениях, Байкерах и Рождестве 3, а жилет Января 2016 — это 12 моделей жилета GTA V под 12 кроёв торса, перекрашенных в 10 цветов. В игре у каждого такого номера своё место, и
 * заменёнку ставят на нужное. Но человеку это одна вещь — и окно показывало её по плитке на каждый номер.
 *
 * Здесь — что считается «одной вещью». Это решает скрипт по файлам игры (`scripts/clothing-looks.mjs`, сверка — `game-looks-cluster.js` → `resources/clothing/game-looks.json`), а окно только
 * читает таблицу:
 *   • ту же вещь — `same`: у вида одна и та же геометрия (положение вершин, развёртка, куски, шейдеры, вложенные текстуры) и те же расцветки (по пикселям, с допуском на перекодирование);
 *   • формы одного стиля — `forms`, только у видов, что подбираются под торс (руки `uppr`, бронежилет `task`): те же расцветки, но модель своя на каждый крой торса. Это одна перчатка и один
 *     жилет, а не по вещи на номер.
 * Имя в сверку не входит: «Водительские перчатки» (Ограбления) и «Чёрные водительские» (Байкеры) — одна вещь с двумя именами. У обычных вещей наоборот: если игра назвала их по-разному,
 * они остаются двумя плитками — в магазине они разные (стекло шлема глянцевое или матовое, логотип на куртке), а чем именно, по модели не видно.
 *
 * Плитка группы — «лицо» (`look.rep`, самая полная модель), а `together` — все её места: выбор плитки ставит заменёнку на все места разом, как у перчаток (`glove-forms.js`) и совета
 * автора на нескольких номерах. Куда реально ляжет файл, выбор плитки не меняет: каждый номер ставится на своё место, как и прежде.
 *
 * Чистый JS: главный процесс (строки игры) и окно (плитки). Скрипту нужна ещё `game-looks-cluster.js`: окну картинки не нужны.
 */

export const LOOKS_VERSION = 3;

/*
 * Вещи без целой формы (круг 7, 31.10.2026, слово ведущей: «убери из выбора»). У видов под торс Rockstar кладёт и крои, где от вещи виден только край, — жилет Января 2016 на одном из кроёв торса: 82–141
 * вершина против 750 у целого. Целая форма есть в той же группе — она «лицо» плитки (самая полная модель, `game-looks-cluster.js`), а обрезок остаётся одним из мест плитки. Но когда целой формы нет
 * вовсе — три жилета Ограблений-3 по 120 вершин (обрезки, до `SCRAP_VERTS`) или модель из четырёх точек, квадрат с текстурой (пустышка, до `QUAD_VERTS`) — выбирать нечего: на персонаже такой
 * вещи не видно, и заменёнка на ней ничего не покажет. Таблица (`hidden`) держит места таких вещей: окно в выбор их не берёт и не рисует. Заменёнка, что уже стоит на таком месте, живёт как
 * прежде — в «Библиотеке» по записи установки и снимается по ней.
 */
export const SCRAP_VERTS = 200;
export const QUAD_VERTS = 8;

/* Маски в разделе аксессуаров на шею (владелец, 01.11.2026): безымянная модель в тысячи вершин. У настоящих вещей этого вида есть имя в магазине. */
export const NECK_MASK_VERTS = 2000;
const neckMask = (entry) => entry.component === "teef" && !entry.name && entry.verts >= NECK_MASK_VERTS;

/** Виды, у которых вещь подбирается под торс: у стиля одна расцветка и своя модель на каждый крой. */
export const FORM_COMPONENTS = Object.freeze(["uppr", "task"]);

/** Место вещи в игре — как ключ таблицы: пол, вид, папка, номер. */
export const lookPlace = ({ gender, component, folder, drawable }) =>
  `${gender}|${component}|${String(folder || "").toLowerCase()}|${drawable}`;

/**
 * Места вещей без целой формы (`hidden` в таблице). `entries` — вещи, что сверялись (`{ place, component, verts }`), `groups` — группы таблицы (`{ m: [место, …] }`). Место прячется, когда оно обрезок
 * или пустая модель (вида под торс, до `SCRAP_VERTS` вершин) и вся его группа — такие же (целой формы, что стала бы лицом плитки, нет) или группы нет вовсе. Обрезок в группе с целой формой остаётся
 * местом её плитки.
 */
export function hiddenPlaces(entries, groups) {
  const scraps = new Set(entries.filter((entry) => (FORM_COMPONENTS.includes(entry.component) && entry.verts <= SCRAP_VERTS) || neckMask(entry)).map((entry) => entry.place));
  const groupOf = new Map((groups || []).flatMap((group) => group.m.map((member) => [member, group])));
  return [...scraps].filter((place) => !groupOf.has(place) || groupOf.get(place).m.every((member) => scraps.has(member))).sort();
}

/**
 * Таблица (`game-looks.json`: `groups: [{ k: "s" | "f", m: [place, …] }]`) → место → `{ id, rep, forms }`. `id` — номер группы в таблице (строкой: у строк окна он стоит рядом с остальными полями).
 */
export function looksIndex(table) {
  const index = new Map();
  /* Места вещей без целой формы (`hidden`); рядом с группами, чтобы окно получало их тем же вызовом. */
  index.hidden = new Set((table?.hidden || []).map(String));
  (table?.groups || []).forEach((group, number) => {
    if (!Array.isArray(group?.m) || group.m.length < 2) return;
    group.m.forEach((place, at) => index.set(String(place), { id: String(number), rep: at === 0, forms: group.k === "f" }));
  });
  return index;
}

/** Строки игры с пометкой группы: `look` — её номер, `lookRep` — «лицо», `lookForms` — формы одного стиля; `hidden` — вещь без целой формы. Строка, которой в таблице нет, остаётся как была. */
export function withLooks(rows, index) {
  if (!index?.size && !index?.hidden?.size) return rows;
  return rows.map((row) => {
    const place = lookPlace(row);
    const look = index.get(place);
    const hidden = index.hidden?.has(place);
    if (!look && !hidden) return row;
    return { ...row, ...(look ? { look: look.id, ...(look.rep ? { lookRep: true } : {}), ...(look.forms ? { lookForms: true } : {}) } : {}), ...(hidden ? { hidden: true } : {}) };
  });
}

const placeOf = (item) => `${item.folder}|${item.drawable}`;

/* Полка вещей базовой игры — как `BASE_SHOP` в `game-assortment.js` (оттуда сюда идёт `withLooks`, поэтому не импортируется; одинаковость строк держит тест). */
export const BASE_LOOK_SHOP = "GTA V";

/**
 * Плитки по одинаковым вещам: вещи одной группы (`item.look`) — одна плитка. Плитка — «лицо» группы (картинка, число расцветок, ключ — его), `together` — все её места по возрастанию
 * номера, `also` — полки, где та же вещь лежит ещё. Вещи без группы идут как были; порядок — по первому месту группы в списке. Если «лица» в списке нет (вещь другого кроя спрятана), лицом
 * становится первая из оставшихся.
 */
export function lookTiles(items) {
  const slots = [];
  const groups = new Map();
  for (const item of items || []) {
    if (!item?.look?.id) {
      slots.push(item);
      continue;
    }
    const key = `${item.gender || ""}|${item.component}|${item.look.id}`;
    let group = groups.get(key);
    if (!group) {
      group = { members: [] };
      groups.set(key, group);
      slots.push(group);
    }
    group.members.push(item);
  }
  return slots.map((slot) => (slot.members ? lookTile(slot.members) : slot));
}

const foldName = (name) => String(name || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
/* Вариант в скобках — та же вещь: «Рюкзак тыквенный кот фиолетовый (Luminoforous)». */
const baseName = (name) => foldName(String(name || "").replace(/\s*\([^)]*\)\s*$/, ""));

/**
 * Плитки вещей игры с одним именем и тем же числом цветов — одна плитка (владелец, 01.11.2026: «Медальон "Эпсилон"» два раза, шарф два раза): это
 * формы одной вещи под ворот и крой, разные по геометрии, поэтому таблица (`groups`) их не складывает. Заменёнка встаёт на все места. Перчатки — свои плитки.
 */
export function namedTiles(tiles) {
  const out = [];
  const groups = new Map();
  for (const tile of tiles || []) {
    if (!tile?.name || tile.glove || tile.component === "uppr") {
      out.push(tile);
      continue;
    }
    const key = `${tile.server || ""}|${tile.gender || ""}|${tile.component}|${baseName(tile.name)}|${tile.textures}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
      out.push(group);
    }
    group.push(tile);
  }
  return out.map((slot) => {
    if (!Array.isArray(slot)) return slot;
    if (slot.length === 1) return slot[0];
    const id = `name:${slot[0].server || ""}|${slot[0].gender || ""}|${slot[0].component}|${baseName(slot[0].name)}`;
    return lookTile(slot.map((tile) => ({ ...tile, look: tile.look || { id } })));
  });
}

function lookTile(members) {
  if (members.length === 1) return members[0];
  /* «Лицо» — вещь с `rep`; у плитки перчаток (`gloveTiles`) оно может лежать среди её форм. */
  const face = members.find((item) => item.look.rep || item.together?.some((own) => own.look?.rep)) || members[0];
  /* Плитка перчаток уже несёт свои формы — берём их, а не саму плитку. */
  const places = new Map();
  for (const item of members) for (const own of item.together?.length ? item.together : [item]) places.set(placeOf(own), own);
  const together = [...places.values()].sort((left, right) => String(left.folder).localeCompare(String(right.folder)) || left.drawable - right.drawable);
  const named = members.find((item) => item.name && item.server) || (face.name ? face : members.find((item) => item.name));
  /* Жилет, что лежит и в базовой игре, и в дополнении, — вещь GTA V: полка базовой игры, а дополнения — в «also». */
  const shop = members.some((item) => item.shop === BASE_LOOK_SHOP) ? BASE_LOOK_SHOP : named?.shop || face.shop;
  const also = [...new Set(members.map((item) => item.shop).filter((value) => value && value !== shop))].sort((left, right) => left.localeCompare(right, "ru"));
  const tile = {
    ...face,
    server: members.find((item) => item.server)?.server || null,
    name: named?.name || null,
    shop,
    preview: face.preview || members.find((item) => item.preview)?.preview || null,
    sources: [...new Set(members.flatMap((item) => item.sources || []))],
    together,
    ...(also.length ? { also } : {}),
  };
  /* Строки игры по языкам (`names`) идут за именем: плитка берёт их у той вещи, чьё имя взяла. */
  if (named?.names) tile.names = named.names;
  else delete tile.names;
  return tile;
}
