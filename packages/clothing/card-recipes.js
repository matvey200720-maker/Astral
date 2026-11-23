/*
 * Что стоит на карточках категорий одежды (ТЗ 04.10.2026, задача 5) и откуда
 * это в игре игрока. Номера выбраны глазами: все вещи компонента по базе и
 * дополнениям отрисованы листами, и на карточку попало то, что читается
 * категорией с первого взгляда.
 *
 * Имена компонентов в игре не бытовые: `jbib` — верх, `lowr` — низ, `berd` —
 * маска, `task` — бронежилет, `teef` — цепочки и галстуки, `uppr` — руки (у
 * парашютного дополнения — перчатки), `hand` — сумки и парашюты, `p_head` —
 * головные уборы.
 *
 * `view` — ракурс карточки: вещь смотрит в камеру (yaw 0), а у кепки и обуви
 * лёгкий доворот оставляет объём. Вписывает вещь в квадрат с одинаковыми
 * полями сам съёмщик.
 *
 * Рецепты читают двое: команда `npm run clothing:preview-assets` (местный
 * набор `clothing-local` на ПК разработчика) и Astral Desktop у игрока
 * (`apps/desktop/src/clothing-cards.js`, 14.10.2026): в поставке снимков нет —
 * это ассеты Rockstar, — и лаунчер снимает карточки из игры самого человека.
 */

const BASE = Object.freeze({
  archive: "x64v.rpf",
  folder: "models/cdimages/streamedpeds_mp.rpf/mp_m_freemode_01",
});
const dlc = (pack, folder) =>
  Object.freeze({
    archive: `update/x64/dlcpacks/${pack}/dlc.rpf`,
    folder: `x64/models/cdimages/${folder}`,
  });

/* Номер версии рецептов: новый номер — карточки пересобираются. */
export const CARD_VERSION = 2;

export const CARD_RECIPES = Object.freeze([
  {
    id: "armor",
    note: "чёрный бронежилет — штатный жилет игры в чёрной расцветке",
    view: { yaw: 0, pitch: 4 },
    parts: [
      { name: "task", ...BASE, component: "task", model: "task_005_u.ydd", texture: "task_diff_005_b_uni.ytd" },
    ],
  },
  {
    id: "tshirts",
    note: "белая футболка — та же модель, расцветка a",
    view: { yaw: 0, pitch: 4 },
    parts: [
      { name: "jbib", ...BASE, component: "jbib", model: "jbib_001_u.ydd", texture: "jbib_diff_001_a_uni.ytd" },
    ],
  },
  {
    /* Госодежда — форма патрульного: её нет у свободного персонажа, она в
       модели полицейского вместе с головой и ботинками; `drawable` называет
       нужную часть, `textureName` — её текстуру в общем словаре педа. */
    id: "government-clothing",
    note: "китель патрульного",
    view: { yaw: 0, pitch: 4 },
    parts: [
      {
        name: "uppr",
        archive: "x64e.rpf",
        folder: "models/cdimages/componentpeds_s_m_y.rpf",
        component: "uppr",
        model: "s_m_y_cop_01.ydd",
        drawable: "uppr_000_r",
        texture: "s_m_y_cop_01.ytd",
        textureName: "uppr_diff_000_a",
      },
    ],
  },
  {
    id: "pants",
    note: "джинсы — как и были",
    view: { yaw: 0, pitch: 2 },
    parts: [
      { name: "lowr", ...BASE, component: "lowr", model: "lowr_000_r.ydd", texture: "lowr_diff_000_g_whi.ytd" },
    ],
  },
  {
    id: "shoes",
    note: "кеды: белая подошва, чёрный верх (дополнение «Рождество 3»)",
    view: { yaw: -28, pitch: 14 },
    parts: [
      {
        name: "feet",
        ...dlc("mpchristmas3", "mpchristmas3_male.rpf/mp_m_freemode_01_mp_m_christmas3"),
        component: "feet",
        model: "feet_005_u.ydd",
        texture: "feet_diff_005_a_uni.ytd",
      },
    ],
  },
  {
    id: "hats",
    note: "кепка «Los Santos 137» козырьком к зрителю (обновление 02.2023)",
    view: { yaw: -10, pitch: 8 },
    parts: [
      {
        name: "p_head",
        ...dlc("mp2023_02", "mp2023_02_male_p.rpf/mp_m_freemode_01_p_mp_m_2023_02"),
        component: "p_head",
        model: "p_head_015.ydd",
        texture: "p_head_diff_015_a.ytd",
      },
    ],
  },
  {
    /* Вместо очков (ТЗ): цепочка и балаклава одним кадром. Вещи педа лежат
       в одном пространстве, поэтому цепочка висит под балаклавой, как на
       персонаже. */
    id: "accessories",
    note: "золотая цепочка («Роскошь 2») и чёрная балаклава («Ограбления»)",
    view: { yaw: 0, pitch: 4 },
    parts: [
      {
        name: "berd",
        ...dlc("mpheist", "mpheist_streamedpeds.rpf/mp_m_freemode_01_male_heist"),
        component: "berd",
        model: "berd_022_u.ydd",
        texture: "berd_diff_022_a_uni.ytd",
      },
      {
        name: "teef",
        ...dlc("mpluxe2", "mpluxe2_male.rpf/mp_m_freemode_01_mp_m_luxe_02"),
        component: "teef",
        model: "teef_004_u.ydd",
        texture: "teef_diff_004_a_uni.ytd",
      },
    ],
  },
  {
    /* Перчатки — вариант рук из парашютного дополнения: две кисти; показ
       (`glovesShowcase`) ставит их парой тыльной стороной к зрителю. */
    id: "gloves",
    note: "чёрные тактические перчатки парой, тыльной стороной к зрителю",
    view: { yaw: 0, pitch: 0 },
    parts: [
      {
        name: "uppr",
        archive: "x64w.rpf",
        folder: "dlcpacks/mplts/dlc.rpf/x64/models/cdimages/mplts.rpf/mp_m_freemode_01_male_freemode_mplts",
        component: "uppr",
        model: "uppr_000_r.ydd",
        texture: "uppr_diff_000_a_whi.ytd",
      },
    ],
  },
  {
    id: "masks",
    note: "маска свиньи",
    view: { yaw: 0, pitch: 4 },
    parts: [
      { name: "berd", ...BASE, component: "berd", model: "berd_001_u.ydd", texture: "berd_diff_001_a_uni.ytd" },
    ],
  },
  {
    /* Татуировка — наложение на кожу, а не вещь: на карточке то, на чём она
       живёт, — голый торс свободного персонажа. */
    id: "tattoos",
    note: "голый торс персонажа",
    view: { yaw: 0, pitch: 2 },
    parts: [
      { name: "uppr", ...BASE, component: "uppr", model: "uppr_015_r.ydd", texture: "uppr_diff_015_a_whi.ytd" },
    ],
  },
  {
    /* «Большая сумка» GTA5RP — сумка ограбления казино (`mpheist3`,
       hand_000…003). Сам `hand_000_u.ydd` — пустая сумка (квадрат), сумка —
       в ступенях наполнения; на карточке самая полная. */
    id: "bags",
    note: "«Большая сумка» GTA5RP — сумка ограбления казино",
    view: { yaw: 0, pitch: 6 },
    parts: [
      {
        name: "hand",
        ...dlc("mpheist3", "mpheist3_male.rpf/mp_m_freemode_01_mp_m_heist3"),
        component: "hand",
        model: "hand_000_u_26.ydd",
        texture: "hand_diff_000_a_uni.ytd",
      },
    ],
  },
]);
