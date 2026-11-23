/*
 * Животные игры — список для редактора «Животные» (мастерская, 05.11.2026).
 *
 * Животное в GTA V — пед `a_c_*` (animal, creature). Файлы лежат в трёх местах, и от места зависит, что с ними можно сделать:
 *
 *   • `component` — `models/cdimages/componentpeds_a_c.rpf` в `x64e.rpf`: четыре файла на животное (`a_c_boar.yft` — скелет и
 *     физика, `.ydd` — тело, `.ytd` — текстуры, `.ymt` — описание частей). Всё тело — в одной модели словаря (`head_000_r`);
 *   • `streamed` — `models/cdimages/streamedpeds_a_c.rpf` в `x64e.rpf`: собаки, пума и тигровая акула. `a_c_chop.yft` лежит
 *     отдельно, а тело — папкой `a_c_chop/` (`head_000_r.ydd`, `uppr_000_u.ydd`, `lowr_000_u.ydd`, текстуры `*_diff_*.ytd`);
 *   • `dlc` — дополнения Rockstar (`mp2023_01`…): вторые облики кабана, оленя, койота и других. Пакет дополнения игра
 *     грузит ПОСЛЕ слоя Astral в `update.rpf`, поэтому слой их файлы не перекроет: такие животные в окне видны и
 *     показываются, но поставить на них облик пока нельзя (`installable: false`) — нужен свой пакет дополнения.
 *
 * Белки в GTA V нет (ни в сюжете, ни в Online): в игре есть крыса, кролик, курица и кошка. Список ниже — всё, что есть в файлах
 * игры у владельца на 05.11.2026 (33 в базовой игре и 9 в дополнениях); окно показывает тех, чьи файлы нашлись у игрока.
 *
 * Имена — русские ключи словаря интерфейса: переводит тот, кто выводит подпись (`tr`).
 */

/** Группы списка: порядок — порядок в окне. */
export const ANIMAL_GROUPS = Object.freeze([
  Object.freeze({ id: "land", name: "Звери" }),
  Object.freeze({ id: "birds", name: "Птицы" }),
  Object.freeze({ id: "water", name: "Вода" }),
]);

const BASE_COMPONENT = Object.freeze({
  source: "base",
  layout: "component",
  label: "x64e.rpf",
  container: "models/cdimages/componentpeds_a_c.rpf",
});
const BASE_STREAMED = Object.freeze({
  source: "base",
  layout: "streamed",
  label: "x64e.rpf",
  container: "models/cdimages/streamedpeds_a_c.rpf",
});
const dlcPlace = (pack) =>
  Object.freeze({
    source: "dlc",
    layout: "component",
    label: `update/x64/dlcpacks/${pack}/dlc.rpf`,
    container: `x64/models/cdimages/peds/${pack}.rpf`,
    pack,
  });

const row = (id, name, group, icon, place) => Object.freeze({ id, name, group, icon, ...place });

/** Все животные игры. Порядок внутри группы — как в списке окна. */
export const ANIMALS = Object.freeze([
  row("a_c_boar", "Кабан", "land", "boar", BASE_COMPONENT),
  row("a_c_deer", "Олень", "land", "deer", BASE_COMPONENT),
  row("a_c_coyote", "Койот", "land", "dog", BASE_COMPONENT),
  row("a_c_mtlion", "Пума", "land", "cat", BASE_STREAMED),
  row("a_c_rabbit_01", "Кролик", "land", "rabbit", BASE_COMPONENT),
  row("a_c_cow", "Корова", "land", "cow", BASE_COMPONENT),
  row("a_c_pig", "Свинья", "land", "pig", BASE_COMPONENT),
  row("a_c_rat", "Крыса", "land", "paw", BASE_COMPONENT),
  row("a_c_cat_01", "Кошка", "land", "cat", BASE_COMPONENT),
  row("a_c_chop", "Чоп", "land", "dog", BASE_STREAMED),
  row("a_c_rottweiler", "Ротвейлер", "land", "dog", BASE_STREAMED),
  row("a_c_shepherd", "Овчарка", "land", "dog", BASE_STREAMED),
  row("a_c_husky", "Хаски", "land", "dog", BASE_STREAMED),
  row("a_c_retriever", "Ретривер", "land", "dog", BASE_STREAMED),
  row("a_c_poodle", "Пудель", "land", "dog", BASE_COMPONENT),
  row("a_c_pug", "Мопс", "land", "dog", BASE_COMPONENT),
  row("a_c_westy", "Вест-хайленд-терьер", "land", "dog", BASE_COMPONENT),
  row("a_c_chimp", "Шимпанзе", "land", "paw", BASE_COMPONENT),
  row("a_c_rhesus", "Макака-резус", "land", "paw", BASE_COMPONENT),
  row("a_c_boar_02", "Кабан (второй облик)", "land", "boar", dlcPlace("mp2023_01")),
  row("a_c_deer_02", "Олень (второй облик)", "land", "deer", dlcPlace("mp2023_01")),
  row("a_c_coyote_02", "Койот (второй облик)", "land", "dog", dlcPlace("mp2023_01")),
  row("a_c_mtlion_02", "Пума (второй облик)", "land", "cat", dlcPlace("mp2023_01")),
  row("a_c_pug_02", "Мопс (второй облик)", "land", "dog", dlcPlace("mp2023_01")),
  row("a_c_rottweiler_02", "Ротвейлер (второй облик)", "land", "dog", dlcPlace("mp2025_01")),
  row("a_c_cat_02", "Кошка (второй облик)", "land", "cat", dlcPlace("mp2025_02")),
  row("a_c_chimp_02", "Шимпанзе (второй облик)", "land", "paw", dlcPlace("mpchristmas3")),
  row("a_c_rabbit_02", "Кролик (второй облик)", "land", "rabbit", dlcPlace("mpchristmas3")),
  row("a_c_hen", "Курица", "birds", "bird", BASE_COMPONENT),
  row("a_c_pigeon", "Голубь", "birds", "bird", BASE_COMPONENT),
  row("a_c_crow", "Ворона", "birds", "bird", BASE_COMPONENT),
  row("a_c_seagull", "Чайка", "birds", "bird", BASE_COMPONENT),
  row("a_c_cormorant", "Баклан", "birds", "bird", BASE_COMPONENT),
  row("a_c_chickenhawk", "Ястреб", "birds", "bird", BASE_COMPONENT),
  row("a_c_fish", "Рыба", "water", "fish", BASE_COMPONENT),
  row("a_c_dolphin", "Дельфин", "water", "whale", BASE_COMPONENT),
  row("a_c_killerwhale", "Косатка", "water", "whale", BASE_COMPONENT),
  row("a_c_humpback", "Горбатый кит", "water", "whale", BASE_COMPONENT),
  row("a_c_whalegrey", "Серый кит", "water", "whale", BASE_COMPONENT),
  row("a_c_sharkhammer", "Акула-молот", "water", "fish", BASE_COMPONENT),
  row("a_c_sharktiger", "Тигровая акула", "water", "fish", BASE_STREAMED),
  row("a_c_stingray", "Скат", "water", "fish", BASE_COMPONENT),
]);

const BY_ID = new Map(ANIMALS.map((animal) => [animal.id, animal]));

export const animalById = (id) => BY_ID.get(String(id || "").toLowerCase()) || null;
export const isAnimalId = (id) => BY_ID.has(String(id || "").toLowerCase());

/** Ставится ли на животное облик: только базовая игра (слой Astral в `update.rpf` грузится раньше пакетов дополнений). */
export const animalInstallable = (animal) => Boolean(animal) && animal.source === "base";

/** Путь записи в архиве игры: `x64e.rpf:models/cdimages/componentpeds_a_c.rpf/a_c_boar.ydd`. */
export function animalEntryAt(animal, relative) {
  return `${animal.label}:${animal.container}/${relative}`;
}

/** Тело животного — одна модель словаря, в которую ложатся метка и свечение: у `component` и `streamed` это `head_000_r`. */
export const BODY_DRAWABLE = "head_000_r";

/** Файлы одного животного по месту и тому, что нашлось в игре. */
export function animalFileNames(animal, found = []) {
  if (animal.layout === "streamed") {
    const folder = animal.id;
    const names = new Set(found.map((name) => String(name).toLowerCase()));
    return {
      folder,
      model: `${folder}/${BODY_DRAWABLE}.ydd`,
      textures: [...names].filter((name) => name.startsWith(`${folder}/`) && /_diff_.*\.ytd$/.test(name)).sort(),
    };
  }
  return { folder: "", model: `${animal.id}.ydd`, textures: [`${animal.id}.ytd`] };
}

/** Контейнер слоя Astral, в который едут файлы животных (в `update.rpf`). */
export const ANIMALS_CONTAINER = "x64/astral/astral_animals.rpf";
export const ANIMALS_SLOT = "animals";
