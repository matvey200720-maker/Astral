/*
 * Модели из установленной GTA V: помещение и объекты каталога.
 *
 * Интерьер здесь собирается из нескольких drawable: зал плюс по одному
 * варианту из каждой группы отделки. Каждая модель читается и разбирается
 * один раз за сеанс, сцена получает клоны — переключение стиля не должно
 * заново тянуть и парсить десяток мегабайт.
 *
 *
 * ПОМЕЩЕНИЕ СОБИРАЕТСЯ ИЗ ЧАСТЕЙ, И ЧАСТИ У ВСЕХ РАЗНЫЕ
 *
 * Разделение проходит не там, где кажется, и путаница дорого стоила: зал Auto
 * Shop однажды стоял в кадре всегда — в том числе когда правили магазин 24/7 на
 * одиннадцать метров.
 *
 * Долгое время здесь стояло утверждение «помещение игра отдаёт ровно одно, зал
 * Auto Shop; для комнат реестра — ничего, потому что обычный интерьер GTA это
 * MLO, а его архетипы резолвятся лишь частично». Первая половина довода верна,
 * вывод — нет. Архетипы САМОГО помещения резолвятся все: магазин 24/7 лежит
 * двадцатью drawable в `v_int_66.rpf`, лавка при заправке — двадцатью
 * четырьмя в `v_int_68.rpf`, каждый со своим говорящим именем и общим на всю
 * комнату словарём текстур. Не резолвятся чужие пропы вокруг — витрины, ящики,
 * мусор, — но помещение это и не они.
 *
 * Отсюда две разные сборки за одним `gameRoomParts`:
 *
 *   — Auto Shop собирается ВЫБОРОМ: оболочка плюс по одному варианту из каждой
 *     группы отделки, и человек эти варианты переключает;
 *   — комната реестра собирается СОСТАВОМ: фиксированный список частей, каждая
 *     на своём месте из `v_int_*.ytyp`. Переключать в ней нечего — Rockstar
 *     сделала её один раз.
 *
 * Места частей приходят из контракта (`INTERIOR_ROOM_MODELS`) в тех же
 * координатах, в которых человек расставляет предметы, и в тех же, которые
 * компилятор кладёт в YMAP. Поэтому помещение и предметы едут в кадр одним
 * преобразованием: поставленный у полки холодильник встанет в игре у той же
 * полки.
 *
 * ПРЕДМЕТЫ каталога игра отдаёт все пять. Они лежат обычными пропами в
 * x64i.rpf, каждый своим файлом с говорящим именем. Отдельного кода здесь для
 * них не нужно: `loadInteriorPart` спрашивает по имени архетипа тем же
 * вызовом, что и часть помещения.
 */

import { getInteriorRoomModel } from "@modovik/interior-contract";

import { hasDesktopBridge, loadMegaMallBuildingModels } from "../../../api.js";
import { tr } from "../../../locales/ui.js";

/** Разобранные модели: идентификатор -> промис с THREE.Group или null. */
const parsed = new Map();

/**
 * Группы вариантов и подписи для интерфейса.
 *
 * Rockstar не даёт вариантам человеческих имён — в файлах только номера,
 * поэтому и подписи номерные. Врать про «индустриальный» или «неоновый»,
 * не видя модель, хуже честной нумерации.
 */
export const INTERIOR_GROUPS = Object.freeze([
  Object.freeze({
    id: "style",
    label: "Стиль зала",
    optional: false,
    items: Object.freeze([
      "tr_int1_mod_int_style_2",
      "tr_int1_mod_int_style_3",
      "tr_int1_mod_int_style_4",
      "tr_int1_mod_int_style_5",
      "tr_int1_mod_int_style_6",
      "tr_int1_mod_int_style_7",
      "tr_int1_mod_int_style_8",
      "tr_int1_mod_int_style_9",
    ]),
  }),
  Object.freeze({
    id: "mezzanine",
    label: "Антресоль",
    optional: true,
    items: Object.freeze([
      "tr_int1_mod_mezzanine_style1",
      "tr_int1_mod_mezzanine_style2",
      "tr_int1_mod_mezzanine_style3",
      "tr_int1_mod_mezzanine_style4",
      "tr_int1_mod_mezzanine_style5",
      "tr_int1_mod_mezzanine_style6",
      "tr_int1_mod_mezzanine_style7",
      "tr_int1_mod_mezzanine_style8",
      "tr_int1_mod_mezzanine_style9",
    ]),
  }),
  Object.freeze({
    id: "banners",
    label: "Баннеры",
    optional: true,
    items: Object.freeze([
      "tr_int1_mod_banners1",
      "tr_int1_mod_banners005",
      "tr_int1_mod_banners007",
      "tr_int1_mod_banners008",
      "tr_int1_mod_banners009",
      "tr_int1_mod_banners010",
    ]),
  }),
  Object.freeze({
    id: "lights",
    label: "Освещение",
    optional: true,
    items: Object.freeze([
      "tr_int1_mod_lights_1",
      "tr_int1_mod_lights_2",
      "tr_int1_mod_lights_3",
      "tr_int1_mod_lights_008",
      "tr_int1_mod_lights_009",
      "tr_int1_mod_lights4_01",
    ]),
  }),
]);

export const INTERIOR_SHELL = "tr_int1_mod_int_shell";

/**
 * Что игра отдаёт моделью для этого помещения.
 *
 * Ключ — идентификатор комнаты кадра из `interior-room.js`: у зала витрины это
 * `auto-shop-tuner`, у комнаты проекта — `id` её шаблона в реестре.
 *
 * `null` — по-прежнему законный ответ: помещение может быть незнакомым (стенд
 * поднимает сцену вовсе без шаблона), и тогда его рисует схема по числам.
 *
 * Ответ различает две сборки. У зала Auto Shop это `groups` — человек выбирает
 * отделку, и состав кадра меняется вместе с выбором. У комнаты реестра это
 * `parts` — готовый список частей с местами, менять в нём нечего.
 *
 * @returns {{shell: string, groups: object[], parts: object[]|null}|null}
 */
export function gameRoomParts(roomId) {
  const key = String(roomId || "");
  if (key === "auto-shop-tuner")
    return { shell: INTERIOR_SHELL, groups: INTERIOR_GROUPS, parts: null };
  const room = getInteriorRoomModel(key);
  if (!room) return null;
  /* Групп нет и быть не должно: показывать «Стиль зала» над магазином 24/7
     значило бы обещать выбор, которого у него нет. */
  return { shell: "", groups: [], parts: room.parts };
}

/**
 * Как называется деталь помещения — словами.
 *
 * Нужна редактору отделки: поверхности он показывает сгруппированными по
 * деталям, и «покрасить v_66_shop711» человеку не говорит ничего. У комнат
 * реестра подпись лежит в контракте рядом с местом детали, у зала Auto Shop
 * своей нет — там деталь и есть выбранный вариант отделки.
 */
export function partLabel(roomId, partId) {
  const id = String(partId || "");
  const part = gameRoomParts(roomId)?.parts?.find((item) => item.id === id);
  if (part?.label) return part.label;
  if (id === INTERIOR_SHELL) return tr("Оболочка зала");
  const group = INTERIOR_GROUPS.find((item) => item.items.includes(id));
  return group ? variantLabel(group, group.items.indexOf(id)) : id;
}

/** Подпись варианта: «Стиль 3», «Антресоль 5». */
export function variantLabel(group, index) {
  return `${group.label} ${index + 1}`;
}

/*
 * Почему модели нет — словами, которые можно показать человеку.
 *
 * Провайдер отвечает `unsupported` / `unavailable` / `failed` и своим текстом
 * («Установленная GTA V не найдена», «Архив x64i.rpf не найден в папке игры»),
 * и раньше всё это съедал `.catch(() => null)`. Кадр показывал коробки с
 * именами и молчал о причине, а человек видел ровно одно: предметы не такие,
 * как обещано.
 */
const NO_BRIDGE = "Модели читаются из игры только в приложении Astral.";
const NO_MODEL = "Игра не отдала эту модель.";

/**
 * Прочитать и разобрать одну модель.
 *
 * Возвращает `{ model, status, reason }`: `model` — THREE.Group или null,
 * `status` — `ready` либо `missing`, `reason` — причина словами.
 *
 * Отсутствие модели — нормальный ответ: без приложения, без игры или без
 * нативного хоста редактор обязан открыться и объяснить, почему объёма нет.
 *
 * Запоминается только удача. Неудачу помнить нельзя: игру подключают уже при
 * открытом редакторе, и запомненный `null` оставлял бы предметы коробками до
 * перезапуска приложения — включая нажатие «прочитать ещё раз», которое при
 * этом выглядело работающим.
 */
/*
 * Заказы одного тика уезжают в игру ОДНОЙ партией.
 *
 * Спрашивают модели врозь и из разных мест: сцена берёт части зала через
 * `Promise.all`, разметка — предметы циклом по мере расстановки. Каждый такой
 * запрос стоил отдельной распаковки трёхгигабайтного архива и отдельного
 * процесса конвертации, а в main-процессе все запуски помощника ещё и стоят в
 * одной общей очереди — то есть параллелизм окна до диска не доходил вовсе.
 * Комната 24/7 из восьми моделей собиралась 13,4 секунды.
 *
 * Собранные в партию, те же восемь моделей приезжают за 1,6 секунды: архив
 * открывается один раз, а словарь текстур — общий у всей комнаты — читается
 * хостом один раз на всю партию, а не заново на каждую модель.
 *
 * Склейка сделана здесь, а не у вызывающих, намеренно: у них разные поводы
 * спросить и разные жизненные циклы, и знать друг о друге они не должны.
 * Ждём микрозадачу, а не таймер: заказы одного тика — это ровно то, что окно
 * выдало одним движением, а лишний кадр ожидания здесь ничего не купит.
 */
const pending = new Map();
let flushing = null;

function flushPending(GLTFLoader) {
  const batch = new Map(pending);
  pending.clear();
  flushing = null;
  const ids = [...batch.keys()];

  void (async () => {
    let answer = null;
    try {
      /* Лампы редактору интерьеров не нужны — он их из ответа не смотрит, — а
         их разбор читает ресурс целиком и стоит столько же, сколько сама
         распаковка. */
      answer = await loadMegaMallBuildingModels({ ids, lights: false });
    } catch (error) {
      const reason = String(error?.message || error) || NO_MODEL;
      for (const resolve of batch.values())
        resolve({ model: null, status: "missing", reason });
      return;
    }
    const models = answer?.models || {};
    for (const [id, resolve] of batch) {
      resolve(await parseOnePart(GLTFLoader, models[id]));
    }
  })();
}

async function parseOnePart(GLTFLoader, result) {
  if (result?.status !== "ready" || !result.glb)
    return {
      model: null,
      status: "missing",
      reason: result?.reason || result?.message || NO_MODEL,
    };
  try {
    const gltf = await new Promise((resolve, reject) => {
      new GLTFLoader().parse(result.glb, "", resolve, reject);
    });
    const model = gltf.scene;
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = true;
    });
    return { model, status: "ready", reason: "" };
  } catch (error) {
    return {
      model: null,
      status: "missing",
      reason: String(error?.message || error) || NO_MODEL,
    };
  }
}

export async function loadInteriorPart(THREE, GLTFLoader, buildingId) {
  if (!buildingId) return { model: null, status: "missing", reason: NO_MODEL };
  if (!hasDesktopBridge())
    return { model: null, status: "missing", reason: NO_BRIDGE };
  if (parsed.has(buildingId)) return parsed.get(buildingId);

  const promise = new Promise((resolve) => {
    pending.set(buildingId, resolve);
    /* Загрузчик берётся у первого заказчика партии: он у всех один и тот же
       модуль, а тащить его сюда импортом значило бы тянуть GLB-разбор туда,
       где игры может не быть вовсе. */
    if (!flushing)
      flushing = Promise.resolve().then(() => flushPending(GLTFLoader));
  });

  parsed.set(buildingId, promise);
  /* Неудачный ответ выкидывается из памяти, как только он получен: следующий
     спрос пойдёт в игру заново. */
  void promise.then((answer) => {
    if (answer?.status !== "ready" && parsed.get(buildingId) === promise)
      parsed.delete(buildingId);
  });
  return promise;
}

/**
 * Модель, разложенная в плоский список мешей.
 *
 * Нужно ровно одному: экземплярной отрисовке. Приехавшая модель — дерево из
 * нескольких мешей со своими материалами и своими местами внутри дерева, а
 * `InstancedMesh` умеет один меш и матрицу на копию. Поэтому дерево
 * разбирается один раз: каждому мешу запоминается его место ВНУТРИ модели, и
 * дальше копия предмета — это произведение «где стоит предмет» на «где деталь
 * внутри предмета».
 *
 * Клон на предмет обошёлся бы дешевле в коде и дороже в кадре: у макета
 * потолок в 128 объектов, и восемь одинаковых автоматов деревьями означали бы
 * тридцать два вызова отрисовки там, где хватает четырёх.
 *
 * Разбор кэшируется по самой модели: состав макета пересобирается на каждое
 * добавление объекта, а дерево мешей от этого не меняется.
 *
 * @returns {ReadonlyArray<{geometry: object, material: object, offset: object}>}
 */
const flattened = new WeakMap();
const EMPTY_PARTS = Object.freeze([]);

export function interiorModelParts(model) {
  if (!model) return EMPTY_PARTS;
  const known = flattened.get(model);
  if (known) return known;

  /* Матрицы внутри дерева считаем сами: модель живёт в кэше и в сцену не
     добавлена, значит никто их за нас не пересчитает. */
  model.updateMatrixWorld(true);
  const parts = [];
  model.traverse((object) => {
    if (!object.isMesh || !object.geometry || !object.material) return;
    /* Меш с массивом материалов рисуется группами геометрии, и экземпляром его
       не свести. У моделей нашего конвертера их не бывает — на примитив
       приходится один материал, — но встреченный останется заглушкой, а не
       превратится в кусок другого предмета. */
    if (Array.isArray(object.material)) return;
    parts.push(
      Object.freeze({
        geometry: object.geometry,
        material: object.material,
        offset: object.matrixWorld.clone(),
      }),
    );
  });
  const frozen = Object.freeze(parts);
  flattened.set(model, frozen);
  return frozen;
}

/** Сбросить кэш — нужен тестам и смене установки игры. */
export function resetInteriorModelCache() {
  parsed.clear();
}
