/*
 * Роли деталей настоящего зала.
 *
 * Зал из игры приезжает списком файлов: у стадиона их сто тридцать семь, и
 * восемьдесят два из них — одно и то же кресло. Править их по одному значит
 * искать нужную строку в списке, где половина имён ничего не говорит
 * (`v_62_spec_ov13`), а вторая половина — вариации одного предмета.
 *
 * Роли — это ответ на вопрос «что именно я хочу перекрасить»: кресла, экраны,
 * баннеры, автоматы, банкоматы, свет, стены и пол. Ими правят разом, а список
 * остаётся для точечной работы.
 *
 * Приметы взяты с живого зала Maze Bank Arena, а не придуманы: имена в GTA V
 * держатся десятилетие и одинаковы у всех, кто ставит арену. Деталь, не
 * попавшая ни в одну роль, остаётся только в списке — молча приписать её к
 * «стенам» хуже, чем не приписать никуда: один ползунок перекрасил бы
 * половину зала мимо ожиданий.
 */

/*
 * Порядок важен: приметы проверяются сверху вниз, и первая победившая
 * забирает деталь. Свет стоит выше стен, потому что `v_62_ceiling_rig` — это
 * ферма с прожекторами, а не потолок.
 */
export const ARENA_HALL_ROLES = Object.freeze([
  Object.freeze({
    id: "chairs",
    label: "Кресла",
    hint: "трибуны, стулья, диваны",
    match: Object.freeze(["chair", "sofa", "seat"]),
  }),
  Object.freeze({
    id: "screens",
    label: "Экраны",
    hint: "телевизоры и мониторы",
    match: Object.freeze([
      "tv_flat",
      "flatscreen",
      "bigscreen",
      "screen",
      "monitor",
      "tv_ovl",
    ]),
  }),
  Object.freeze({
    id: "banners",
    label: "Баннеры",
    hint: "растяжки, вывески, щиты",
    match: Object.freeze(["banner", "sign", "board0"]),
  }),
  Object.freeze({
    id: "vending",
    label: "Торговые автоматы",
    hint: "напитки и билеты",
    match: Object.freeze(["vend", "ticket"]),
  }),
  Object.freeze({
    id: "atm",
    label: "Банкоматы",
    hint: "",
    match: Object.freeze(["atm"]),
  }),
  Object.freeze({
    id: "lights",
    label: "Свет",
    hint: "прожекторы и ферма",
    match: Object.freeze(["light", "_rig"]),
  }),
  Object.freeze({
    id: "curtains",
    label: "Шторы",
    hint: "занавес и жалюзи",
    match: Object.freeze(["curt", "blind"]),
  }),
  Object.freeze({
    id: "shell",
    label: "Стены и пол",
    hint: "оболочка зала, лестницы, борта",
    match: Object.freeze([
      "shell",
      "wall",
      "floor",
      "_ao_",
      "lobmat",
      "stairs",
      "barrier",
    ]),
  }),
]);

export const ARENA_HALL_ROLE_IDS = Object.freeze(
  ARENA_HALL_ROLES.map((role) => role.id),
);

/** Роль детали по её имени — или `null`, если примет не нашлось. */
export function arenaPieceRole(stem) {
  const name = String(stem || "").toLowerCase();
  if (!name) return null;
  for (const role of ARENA_HALL_ROLES)
    if (role.match.some((token) => name.includes(token))) return role.id;
  return null;
}

/**
 * Детали, разложенные по ролям.
 *
 * Возвращаются только непустые роли и в том же порядке, в каком они объявлены:
 * панель показывает ровно то, что в этом зале есть. Пустая деталь (файл-заглушка
 * в наборе) в роль не идёт — править в ней нечего.
 */
export function groupArenaPieces(pieces = []) {
  const buckets = new Map();
  for (const piece of pieces) {
    if (!piece || piece.empty) continue;
    const role = arenaPieceRole(piece.stem);
    if (!role) continue;
    const bucket = buckets.get(role) || { stems: [], placements: 0 };
    bucket.stems.push(piece.stem);
    bucket.placements += Number(piece.placements) || 0;
    buckets.set(role, bucket);
  }
  return ARENA_HALL_ROLES.filter((role) => buckets.has(role.id)).map(
    (role) => ({
      ...role,
      ...buckets.get(role.id),
    }),
  );
}
