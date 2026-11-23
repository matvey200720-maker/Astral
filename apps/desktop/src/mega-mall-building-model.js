/*
 * Реальная геометрия здания для предпросмотра мастерской.
 *
 * Раньше превью рисовало здание само — набором коробок с захардкоженными
 * размерами. Выглядело это как «намёк на фасад», и человек не мог понять, как
 * его правка ляжет на настоящий магазин.
 *
 * Здесь модель берётся из игры, установленной у пользователя: drawable и
 * словарь текстур извлекаются из RPF и конвертируются нативным хостом в GLB,
 * который три.js грузит штатным загрузчиком. Ничего от Rockstar в сборку
 * лаунчера не попадает и никуда не отправляется — результат живёт только в
 * локальном кэше рядом с остальным состоянием редактора.
 */

import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";
import { YOU_TOOL_PROFILE_ID } from "@modovik/mega-mall-contract";
import { INTERIOR_ROOM_MODELS } from "@modovik/interior-contract";

import { resolveGameArchive } from "./game-archive-layer.js";

/* Где в архивах GTA V лежит здание каждого профиля.

   Имена несимметричны и это не опечатка: словарь текстур игра назвала
   `utool`, а геометрию — `ytool`/`build`. Поиск по одному написанию ничего
   не находит, поэтому пути записаны целиком.

   Заморозка — в конце файла: ниже к таблице дописываются объекты каталога
   интерьеров и варианты отделки Auto Shop. */
const BUILDING_SOURCES = {
  "you-tool-ashan": Object.freeze({
    archive: "x64t.rpf",
    directory: "levels/gta5/_hills/country_04/cs4_02.rpf/",
    /* Магазин стоит в торговом комплексе, а не отдельным зданием, поэтому под
       собственным именем не находится: единственная модель со словом ytool —
       плоская подложка под ним.

       Перебрал все 211 моделей района, конвертируя каждую со словарём
       `cs4_02_utool` и без него. `nmall00` теряет без него 15 текстур — впятеро
       больше ближайшего кандидата, — и имеет форму здания, а не подложки. */
    drawable: "cs4_02_nmall00.ydr",
    textures: Object.freeze(["cs4_02_utool.ytd"]),
  }),

  /* Заправка Sandy Shores. Из шести заправок игры эта самая насыщенная —
     45 мешей и 62 текстуры против 34 у ближайшей, — поэтому в превью
     показывать интереснее всего. */
  "gas-station-sandy-shores": Object.freeze({
    archive: "x64t.rpf",
    directory: "levels/gta5/_hills/country_04/cs4_02.rpf/",
    drawable: "cs4_02_mrgasstation.ydr",
    textures: Object.freeze(["cs4_02_mrgasstation+hidr.ytd"]),
  }),

  /* Уличные фонари. Игра хранит их фрагментами (.yft), а не обычными .ydr:
     фонарь ломается от удара, и у него есть карта разрушения. Геометрия внутри
     та же, конвертер её достаёт.

     Замерено на реальных файлах: 200-650 КБ на фонарь против 25 МБ у заправки,
     так что превью остаётся лёгким даже с несколькими фонарями в кадре.

     Семейства взяты те же, что знает подписанный coverage-профиль в
     resources/street-lights: превью обязано показывать тот фонарь, который
     редактор потом действительно правит в игре. */
  "prop-streetlight-02": Object.freeze({
    archive: "x64h.rpf",
    directory: "levels/gta5/props/roadside/v_traffic_lights.rpf/",
    drawable: "prop_streetlight_02.yft",
    textures: Object.freeze(["prop_streetlight_02.ytd"]),
  }),
  "prop-streetlight-03e": Object.freeze({
    archive: "x64h.rpf",
    directory: "levels/gta5/props/roadside/v_traffic_lights.rpf/",
    drawable: "prop_streetlight_03e.yft",
    textures: Object.freeze(["prop_streetlight_03e.ytd"]),
  }),
  "prop-streetlight-07b": Object.freeze({
    archive: "x64h.rpf",
    directory: "levels/gta5/props/roadside/v_traffic_lights.rpf/",
    drawable: "prop_streetlight_07b.yft",
    /* Словарь у семейства общий и без буквы варианта. */
    textures: Object.freeze(["prop_streetlight_07.ytd"]),
  }),
  "prop-streetlight-12b": Object.freeze({
    archive: "x64h.rpf",
    directory: "levels/gta5/props/roadside/v_traffic_lights.rpf/",
    drawable: "prop_streetlight_12b.yft",
    /* Отдельного словаря нет — текстуры лежат внутри фрагмента. */
    textures: Object.freeze([]),
  }),
  "prop-streetlight-16a": Object.freeze({
    archive: "x64h.rpf",
    directory: "levels/gta5/props/roadside/v_traffic_lights.rpf/",
    drawable: "prop_streetlight_16a.yft",
    textures: Object.freeze([]),
  }),
};

/*
 * Объекты каталога интерьеров.
 *
 * До этих пяти строк в таблице не было ни одного `prop_*`, и редактор
 * интерьеров рисовал весь каталог коробками: `loadInteriorPart` честно
 * возвращал null, сцена ставила заглушку размером с архетип. Пять записей ниже
 * закрывают каталог `@modovik/interior-contract` целиком — в нём ровно пять
 * предметов.
 *
 * Ключ здесь — имя архетипа как есть, `prop_vend_soda_01`, а не кебаб как у
 * фонарей: сцена просит модель тем именем, которое лежит в реестре объектов, и
 * второе написание означало бы таблицу перевода между ними.
 *
 * Все пять лежат в одном архиве, x64i.rpf, но в разных папках: автоматы в
 * `recreational`, холодильник в `commercial`, урна в `roadside`, растение в
 * `vegetation`. Игра разложила пропы по назначению предмета, а не по тому, кто
 * его ставит, поэтому одной маской на папку каталог магазина не находится.
 *
 * Расширение — не мелочь оформления, а другой конвейер: `.yft` это фрагмент,
 * у предмета есть карта разрушения, и конвертер собирает его по костям. Из
 * пяти предметов четыре — фрагменты; обычный `.ydr` только у холодильника.
 *
 * Про словари повторилась история зелени, и повторилась дважды. У четырёх
 * предметов из пяти обычного `.ytd` НЕТ ВОВСЕ — есть только HD-вариант:
 * `+hifr` у фрагментов, `+hidr` у drawable. Искать `prop_bin_05a.ytd`
 * бесполезно, в архиве лежит один лишь `prop_bin_05a+hifr.ytd`. У растения
 * наоборот: словаря два, суффикс третий (`+hi`), и HD-словарь НЕПОЛНЫЙ —
 * подробности у самой записи.
 *
 * Замерено на установленной игре, build 24129523: исходники 50-404 КБ, готовые
 * GLB 176-800 КБ, весь каталог около 2.5 МБ — на два порядка легче зала Auto
 * Shop, так что двадцать предметов в кадре ничего не стоят.
 */
const INTERIOR_PROP_SOURCES = Object.freeze({
  prop_vend_soda_01: Object.freeze({
    archive: "x64i.rpf",
    directory: "levels/gta5/props/recreational/v_coin_op.rpf/",
    drawable: "prop_vend_soda_01.yft",
    textures: Object.freeze(["prop_vend_soda_01+hifr.ytd"]),
  }),
  prop_vend_soda_02: Object.freeze({
    archive: "x64i.rpf",
    directory: "levels/gta5/props/recreational/v_coin_op.rpf/",
    drawable: "prop_vend_soda_02.yft",
    textures: Object.freeze(["prop_vend_soda_02+hifr.ytd"]),
  }),
  prop_bar_fridge_01: Object.freeze({
    archive: "x64i.rpf",
    directory: "levels/gta5/props/commercial/v_bar.rpf/",
    /* Единственный обычный drawable каталога: холодильник не ломается. */
    drawable: "prop_bar_fridge_01.ydr",
    textures: Object.freeze(["prop_bar_fridge_01+hidr.ytd"]),
  }),
  prop_bin_05a: Object.freeze({
    archive: "x64i.rpf",
    directory: "levels/gta5/props/roadside/v_bins.rpf/",
    drawable: "prop_bin_05a.yft",
    textures: Object.freeze(["prop_bin_05a+hifr.ytd"]),
  }),
  prop_plant_int_01a: Object.freeze({
    archive: "x64i.rpf",
    directory: "levels/gta5/props/vegetation/v_potted.rpf/",
    drawable: "prop_plant_int_01a.yft",
    /*
     * Единственный предмет с ДВУМЯ словарями, и порядок здесь значащий.
     *
     * HD-словарь у растения неполный: в нём три текстуры — кора и хром, — а
     * листа нет вовсе. Собранное по одному `+hi` растение выходит правильной
     * формы и мёртвого серо-бурого цвета: листу нечем краситься. Лист лежит в
     * обычном словаре, вместе с уменьшенными копиями коры и хрома.
     *
     * Конвертер при совпадении имён берёт ПОСЛЕДНИЙ словарь, поэтому обычный
     * идёт первым, а HD — вторым: лист приходит снизу, кора и хром
     * поднимаются до 512. Проверено сравнением: `+hi` первым даёт файл,
     * побайтно равный сборке без него вовсе.
     */
    textures: Object.freeze([
      "prop_plant_int_01a.ytd",
      "prop_plant_int_01a+hi.ytd",
    ]),
  }),
});

for (const [archetype, source] of Object.entries(INTERIOR_PROP_SOURCES)) {
  BUILDING_SOURCES[archetype] = source;
}

/*
 * Auto Shop из mptuner — интерьер с готовой кастомизацией от самой Rockstar.
 *
 * Обычный интерьер GTA собрать нельзя: это оболочка плюс сотни отдельно
 * расставленных объектов, и их архетипы резолвятся в файлы лишь частично.
 * Auto Shop устроен иначе — варианты отделки лежат отдельными drawable с
 * говорящими именами, поэтому показать их можно тем же конвейером, что и
 * здания, без разбора MLO.
 *
 * Замерено на реальных файлах: зал 3.8 МБ, стили 4.9-19.5 МБ, антресоли
 * 0.6-7.7 МБ, баннеры 2.8-5.6 МБ, свет 0.4-1.7 МБ. Одна комбинация — около
 * 17 МБ, поэтому грузим по одному варианту из группы, а не всё сразу.
 */
const AUTO_SHOP_ARCHIVE = "update/x64/dlcpacks/mptuner/dlc.rpf";
const AUTO_SHOP_DIR = "x64/levels/gta5/interiors/dlc_int_01_tr.rpf/";

/* Весь интерьер делит один словарь текстур. Без него зал собирается серым:
   3.8 МБ со словарём против 0.7 МБ без — почти весь вес модели это текстуры. */
const AUTO_SHOP_TEXTURES = Object.freeze(["tr_int1_tuner_mod_garage.ytd"]);

const autoShopSource = (drawable) =>
  Object.freeze({
    archive: AUTO_SHOP_ARCHIVE,
    directory: AUTO_SHOP_DIR,
    drawable: `${drawable}.ydr`,
    textures: AUTO_SHOP_TEXTURES,
  });

/**
 * Варианты отделки Auto Shop по группам.
 *
 * Имена файлов у Rockstar непоследовательны — `mod_lights_1`, `mod_lights4_01`,
 * `mod_banners005` рядом с `mod_banners1`, — поэтому перечислены явно, а не
 * собраны шаблоном.
 */
export const AUTO_SHOP_VARIANTS = Object.freeze({
  shell: Object.freeze(["tr_int1_mod_int_shell"]),
  style: Object.freeze([
    "tr_int1_mod_int_style_2",
    "tr_int1_mod_int_style_3",
    "tr_int1_mod_int_style_4",
    "tr_int1_mod_int_style_5",
    "tr_int1_mod_int_style_6",
    "tr_int1_mod_int_style_7",
    "tr_int1_mod_int_style_8",
    "tr_int1_mod_int_style_9",
  ]),
  mezzanine: Object.freeze([
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
  banners: Object.freeze([
    "tr_int1_mod_banners1",
    "tr_int1_mod_banners005",
    "tr_int1_mod_banners007",
    "tr_int1_mod_banners008",
    "tr_int1_mod_banners009",
    "tr_int1_mod_banners010",
  ]),
  lights: Object.freeze([
    "tr_int1_mod_lights_1",
    "tr_int1_mod_lights_2",
    "tr_int1_mod_lights_3",
    "tr_int1_mod_lights_008",
    "tr_int1_mod_lights_009",
    "tr_int1_mod_lights4_01",
  ]),
  extras: Object.freeze([
    "tr_int1_mod_carlift",
    "tr_int1_mod_mural_neon",
    "tr_int1_mod_ceillinglights_006",
    "tr_int1_mod_ceillinglights_07",
    "tr_int1_mod_ceillinglights_9",
  ]),
});

/*
 * Помещения интерьеров: магазин 24/7 и лавка при заправке.
 *
 * Здесь опровергается утверждение, которое сам этот файл держал за правду:
 * «обычный интерьер GTA одной моделью не лежит, это MLO — оболочка плюс сотни
 * расставленных сущностей, чьи архетипы резолвятся лишь частично». Первая
 * половина верна, вторая — нет. Архетипы САМОГО помещения резолвятся все:
 * Rockstar положила его отдельными drawable в `v_int_66.rpf` и `v_int_68.rpf`,
 * ровно как отделку Auto Shop, и с ОДНИМ словарём текстур на весь интерьер.
 * Не резолвятся чужие пропы вокруг — витрины, ящики, мусор, — но помещение это
 * и не они.
 *
 * Состав и места лежат в контракте (`INTERIOR_ROOM_MODELS`), а не здесь: их
 * читает и окно, чтобы поставить части в кадр. Здесь из них собираются лишь
 * пути в архивах — единственное, что нужно настольному приложению и не нужно
 * никому больше.
 *
 * Общий словарь текстур на всю комнату — не мелочь оформления: партия читает
 * его один раз на восемь моделей, и вся комната 24/7 приезжает за 1.6 секунды
 * против 13.4 поштучно (замерено на живой игре, x64h.rpf).
 */
const INTERIOR_ROOM_ARCHIVE = "x64h.rpf";

const INTERIOR_ROOM_SOURCES = {};
for (const room of Object.values(INTERIOR_ROOM_MODELS)) {
  for (const part of room.parts) {
    INTERIOR_ROOM_SOURCES[part.id] = Object.freeze({
      archive: INTERIOR_ROOM_ARCHIVE,
      directory: `levels/gta5/interiors/${room.interior}.rpf/`,
      drawable: `${part.id}.ydr`,
      textures: Object.freeze([room.textures]),
    });
  }
}
Object.freeze(INTERIOR_ROOM_SOURCES);

for (const [drawable, source] of Object.entries(INTERIOR_ROOM_SOURCES)) {
  BUILDING_SOURCES[drawable] = source;
}

for (const drawables of Object.values(AUTO_SHOP_VARIANTS)) {
  for (const drawable of drawables) {
    BUILDING_SOURCES[drawable] = autoShopSource(drawable);
  }
}
Object.freeze(BUILDING_SOURCES);

/* Профили mega mall знают только про себя, поэтому связь с моделью держим
   отдельно: здание может понадобиться и там, где профиля нет вовсе — как у
   заправок, где редактора поверхностей пока не существует. */
const PROFILE_BUILDINGS = Object.freeze({
  [YOU_TOOL_PROFILE_ID]: "you-tool-ashan",
});

const MAX_MODEL_BYTES = 48 * 1024 * 1024;

/* Версия конвейера. Входит в ключ кэша, поэтому правка нативного конвертера
   обесценивает старые GLB сама — без неё приложение продолжало отдавать
   модель, собранную предыдущей, ошибочной версией.

   2 — детали фрагментов встают по трансформу кости и в правильном базисе
       осей: до этого плафон и кронштейн сваливались в основание столба.
   3 — рядом с моделью кэшируются координаты ламп из LightAttributes.
   4 — лампы читаются и у обычных drawable (.ydr), а не только у фрагментов,
       и вместе с координатой едут цвет, яркость, затухание и угол конуса.
       Без поднятия версии у всех остался бы закэшированный пустой список
       ламп: он лежит рядом с GLB и ключуется тем же хэшем.
   5 — материалы в GLB зовутся так, как их зовёт игра: «шейдер|текстура»
       вместо «Mat_3». По этому имени редактор отделки подписывает поверхности
       помещения, и без пересборки старые модели остались бы безымянными.
   6 — листы нормалей BC5 декодируются верно (12.10.2026): прежний декодер
       CodeWalker писал зелёный в красный, и рельеф моделей был шумом 4×4. */
const PIPELINE_VERSION = 6;

const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");

/*
 * Таблица — это allowlist, и спрашивать её надо как allowlist.
 *
 * Простой поиск по ключу пропускал имена прототипа: `constructor`, `toString`,
 * `__proto__` находились как «поддерживаемые», `supports()` отвечал да, а
 * загрузка падала голым TypeError из `path.join` — потому что у функции
 * `Object` нет поля `archive`. Своим ключом это не назовёт никто, но имя сюда
 * приходит из окна, а окно — не доверенная сторона.
 */
function sourceFor(buildingId) {
  const key = String(buildingId || "");
  if (!key || !Object.hasOwn(BUILDING_SOURCES, key)) return null;
  return BUILDING_SOURCES[key] || null;
}

export function buildingIdForProfile(profileId) {
  return PROFILE_BUILDINGS[String(profileId || "")] || null;
}

export function listBuildingModelIds() {
  return Object.keys(BUILDING_SOURCES);
}

/*
 * Где у модели светят лампы — по данным самой игры.
 *
 * И во фрагменте, и в обычном drawable лежит массив LightAttributes:
 * координата, направление, угол конуса, цвет и яркость каждого источника.
 * Угадывать их по геометрии не нужно и вредно — у фонарей основание
 * смоделировано в стороне от мачты, а у заправки лампы висят внутри навеса,
 * и любая эвристика по габаритам промахивается.
 *
 * Игра считает вверх по Z, glTF по Y, поэтому позицию и направление
 * переводим как (x, z, -y) — тем же правилом, что и вершины модели.
 */
function toGltfAxes(vector) {
  return {
    x: Number(vector?.x) || 0,
    y: Number(vector?.z) || 0,
    z: -(Number(vector?.y) || 0),
  };
}

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/*
 * Разбор ламп в форму, которую понимает сцена.
 *
 * Модельную позицию отдаёт не всякий ресурс. У фрагмента лампа привязана к
 * кости, и натив умножает её координату на трансформ кости — оттуда
 * `modelPosition`. У обычного drawable скелета нет вовсе, натив зовёт разбор
 * без него и честно кладёт `modelPosition: null`; модельная координата там —
 * это и есть `position` самой лампы. Без этого запасного варианта фильтр ниже
 * выбрасывал бы у .ydr ВСЕ лампы, и снятие гейта по расширению не дало бы
 * ничего.
 *
 * Наружу едут не только координаты: цвет, яркость, дальность и показатель
 * затухания натив уже прочитал, а сцена без них вынуждена подбирать свет на
 * глаз — то есть врать про то, как объект светится в игре.
 */
function describeLights(inventory) {
  const lights = Array.isArray(inventory?.lights) ? inventory.lights : [];
  return Object.freeze(
    lights
      .filter((light) => light?.modelPosition || light?.position)
      .map((light) =>
        Object.freeze({
          position: Object.freeze(
            toGltfAxes(light.modelPosition || light.position),
          ),
          direction: Object.freeze(toGltfAxes(light.direction)),
          coneInnerAngle: finite(light.coneInnerAngle),
          coneOuterAngle: finite(light.coneOuterAngle),
          /* Цвет игра хранит байтами канала, а не долями единицы: перевод —
             дело потребителя, здесь они остаются такими, какими лежат в
             ресурсе. */
          color: Object.freeze({
            r: finite(light.color?.r),
            g: finite(light.color?.g),
            b: finite(light.color?.b),
          }),
          intensity: finite(light.intensity),
          falloff: finite(light.falloff),
          falloffExponent: finite(light.falloffExponent),
          /* Битовая маска часов, в которые лампа горит. Заправка светит не
             круглые сутки, и это знание лежит в самой модели. */
          timeFlags: finite(light.timeFlags),
          type: String(light.type || ""),
        }),
      ),
  );
}

export function createMegaMallBuildingModelProvider({
  cacheRoot,
  findGame,
  extractEntries,
  convertModel,
  /*
   * Пакетная конвертация. Необязательна: без неё партия просто разваливается
   * на одиночные вызовы и работает как раньше, только с одной распаковкой.
   * Это не запас на будущее, а условие честности — провайдер собирают в трёх
   * местах, и не у всех троих есть чем конвертировать пачку.
   */
  convertModels = null,
  inspectLights = null,
  tempRoot = os.tmpdir(),
} = {}) {
  if (!cacheRoot)
    throw new TypeError("Building model provider требует cacheRoot.");
  if (typeof findGame !== "function")
    throw new TypeError("Building model provider требует findGame.");
  if (typeof extractEntries !== "function")
    throw new TypeError("Building model provider требует extractEntries.");
  if (typeof convertModel !== "function")
    throw new TypeError("Building model provider требует convertModel.");

  /*
   * Из какого архива читать: у человека с OpenIV игра грузит `mods\<архив>`, и
   * предпросмотр обязан читать оттуда же, иначе покажет не ту игру.
   *
   * Само правило — и почему признаком служит загрузчик, а не папка — живёт в
   * `game-archive-layer.js`: тем же ответом пользуются зал арены и большая
   * карта, а три похожих ответа на один вопрос разошлись бы молча. Здесь
   * остаётся приделать к нему корень игры: провайдеру нужен файл, а модуль
   * отдаёт путь от корня — он же уезжает нативному хосту в адрес с двоеточием.
   *
   * Ключ кэша от смены слоя не страдает: в нём лежит сам путь к архиву вместе
   * с размером и временем правки, поэтому модель пересобирается сама.
   */
  const archiveFor = async (gameRoot, source) =>
    path.join(
      gameRoot,
      await resolveGameArchive({ gameRoot, archive: source.archive }),
    );

  /* Ключ кэша включает размер и время архива: после патча или обновления игры
     старый GLB перестаёт совпадать и пересобирается сам. */
  const cacheKey = async ({ buildingId, archivePath, source }) => {
    const stat = await fs.stat(archivePath);
    return sha256Hex(
      [
        `v${PIPELINE_VERSION}`,
        buildingId,
        source.drawable,
        [...source.textures].sort().join(","),
        archivePath.toLowerCase(),
        String(stat.size),
        String(Math.trunc(stat.mtimeMs)),
      ].join("|"),
    );
  };

  const readCached = async (file) => {
    try {
      const bytes = await fs.readFile(file);
      return bytes.length && bytes.length <= MAX_MODEL_BYTES ? bytes : null;
    } catch {
      return null;
    }
  };

  /*
   * Хэш готового GLB лежит рядом с ним, а не считается на каждый ответ.
   *
   * Каждое обращение к кэшу раньше проходило sha256 по всему файлу: у
   * крупных зданий это 18–26 МБ в главном потоке (хэш считается синхронно),
   * при том что сам файл не менялся с прошлого раза. Рядом с `<ключ>.glb`
   * теперь лежит `<ключ>.sha256`: «хэш размер время правки». Хэш принимается,
   * только если размер и время правки GLB на диске те же, что записаны, —
   * подменённый или дописанный файл не совпадёт и посчитается заново. Нет
   * файла хэша (старый кэш), он битый или не сошёлся — считаем один раз и
   * кладём рядом. Ошибку записи глотаем: без хэша рядом ответ остаётся
   * верным, просто платит за проход, как раньше.
   */
  const hashFileFor = (cacheFile) => `${cacheFile.slice(0, -4)}.sha256`;

  const rememberHash = async (cacheFile, hash, size) => {
    try {
      const stat = await fs.stat(cacheFile);
      if (stat.size !== size) return;
      await fs.writeFile(
        hashFileFor(cacheFile),
        `${hash} ${size} ${Math.trunc(stat.mtimeMs)}\n`,
        "utf8",
      );
    } catch {
      /* Хэш рядом — удобство, не условие ответа. */
    }
  };

  const storedHash = async (cacheFile, size) => {
    try {
      const [text, stat] = await Promise.all([
        fs.readFile(hashFileFor(cacheFile), "utf8"),
        fs.stat(cacheFile),
      ]);
      const [hash, recordedSize, recordedTime] = text.trim().split(" ");
      if (!/^[0-9a-f]{64}$/.test(hash || "")) return null;
      if (Number(recordedSize) !== size || stat.size !== size) return null;
      if (Number(recordedTime) !== Math.trunc(stat.mtimeMs)) return null;
      return hash;
    } catch {
      return null;
    }
  };

  /* Хэш GLB, только что прочитанного из кэша: из файла рядом или, если его
     нет, посчитанный и положенный рядом. */
  const hashOfCached = async (cacheFile, bytes) => {
    const stored = await storedHash(cacheFile, bytes.length);
    if (stored) return stored;
    const hash = sha256Hex(bytes);
    await rememberHash(cacheFile, hash, bytes.length);
    return hash;
  };

  /*
   * Что нужно достать из архива для одной записи: сама модель и её словари.
   * Пути собираются здесь, чтобы одиночная загрузка и партия просили ровно
   * одно и то же — разойдись они, партия начала бы приносить не то, что
   * приносит поштучное чтение, и кэш стал бы врать.
   */
  const entriesFor = (source) =>
    [source.drawable, ...source.textures].map(
      (name) => `${source.directory}${name}`,
    );

  /*
   * Группировок ДВЕ, и это не усложнение ради красоты: дорого здесь разное.
   *
   * Распаковка дорога открытием архива — помощник вскрывает трёхгигабайтный
   * RPF и льёт из него записи в цикле, поэтому папка внутри архива ничего не
   * стоит, а второй заход в тот же архив стоит всего. Значит распаковка
   * группируется ПО АРХИВУ, и пять предметов каталога из разных папок x64i.rpf
   * приезжают одной распаковкой, а не пятью.
   *
   * Конвертация дорога словарём текстур — хост читает его один раз на партию.
   * Значит конвертация группируется ПО НАБОРУ СЛОВАРЕЙ: у комнаты 24/7 он один
   * на восемь моделей, и это одна конвертация. Сложить же в одну партию модели
   * с РАЗНЫМИ словарями значило бы заставить хост читать все словари для
   * каждой модели — то есть сделать хуже, чем поштучно.
   */
  const archiveKey = (source) => source.archive.toLowerCase();
  const textureKey = (source) => [...source.textures].sort().join(",");

  const resolveGameRoot = async (targetId) => {
    try {
      const game = await findGame(targetId);
      return game?.path ? path.resolve(String(game.path)) : null;
    } catch {
      return null;
    }
  };

  /* Готовый ответ по уже лежащему в кэше GLB. Общий у одиночной загрузки и
     партии: два способа собрать один и тот же ответ — это два способа его
     однажды разойтись. */
  const cachedAnswer = async ({ bytes, cacheFile, lightsFile, source }) => {
    let lights = Object.freeze([]);
    try {
      lights = Object.freeze(JSON.parse(await fs.readFile(lightsFile, "utf8")));
    } catch {
      /* Ламп рядом может не быть: их пишут не всем и не всегда. */
    }
    return Object.freeze({
      status: "ready",
      format: "glb",
      cached: true,
      sha256: await hashOfCached(cacheFile, bytes),
      bytes,
      lights,
      source: Object.freeze({ ...source }),
    });
  };

  return Object.freeze({
    supports(buildingId) {
      return Boolean(sourceFor(buildingId));
    },

    /*
     * Партия моделей за одну распаковку и одну конвертацию.
     *
     * Поштучный путь платит за каждый объект отдельно: своя временная папка,
     * свой запуск помощника на трёхгигабайтный архив, свой процесс
     * конвертации — и всё это в main-процессе выстроено в одну общую очередь,
     * так что параллелизм окна до диска не доходит. На комнате 24/7 из восьми
     * моделей это 13,4 секунды: 3,6 с на восемь распаковок, 3,6 с на восемь
     * разборов ламп и 6,1 с на восемь конвертаций. Той же комнате партией —
     * 1,6 секунды: 0,46 с одна распаковка и 1,1 с одна конвертация. Замерено
     * на живой игре, x64h.rpf.
     *
     * `lights: false` — не оптимизация «на всякий случай», а отказ от работы,
     * результат которой выбрасывают: разбор ламп читает ресурс целиком, а
     * редактору интерьеров лампы не нужны вовсе. Тем, кому нужны (превью
     * здания, фонари), он остаётся включённым.
     */
    async loadMany({ ids, targetId, lights = true } = {}) {
      const wanted = [...new Set((ids || []).map((id) => String(id || "")))]
        .filter(Boolean)
        .filter((id) => sourceFor(id));
      if (!wanted.length) return Object.freeze({});

      const gameRoot = await resolveGameRoot(targetId);
      const answers = {};
      if (!gameRoot) {
        for (const id of wanted) {
          answers[id] = Object.freeze({
            status: "unavailable",
            reason: "Установленная GTA V не найдена.",
          });
        }
        return Object.freeze(answers);
      }

      /* Сперва кэш: партия собирается только из того, чего на диске нет.
         Открывать архив ради восьми моделей, семь из которых уже лежат
         готовыми, — то же расточительство, только пакетное. */
      const misses = [];
      for (const id of wanted) {
        const source = sourceFor(id);
        const archivePath = await archiveFor(gameRoot, source);
        let key = null;
        try {
          key = await cacheKey({ buildingId: id, archivePath, source });
        } catch {
          answers[id] = Object.freeze({
            status: "unavailable",
            reason: `Архив ${source.archive} не найден в папке игры.`,
          });
          continue;
        }
        const cacheFile = path.join(cacheRoot, `${key}.glb`);
        const bytes = await readCached(cacheFile);
        if (bytes) {
          answers[id] = await cachedAnswer({
            bytes,
            cacheFile,
            lightsFile: path.join(cacheRoot, `${key}.lights.json`),
            source,
          });
          continue;
        }
        misses.push({ id, source, archivePath, cacheFile });
      }
      if (!misses.length) return Object.freeze(answers);

      const groups = new Map();
      for (const miss of misses) {
        const key = archiveKey(miss.source);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(miss);
      }

      for (const group of groups.values()) {
        const workspace = await fs.mkdtemp(
          path.join(tempRoot, "astral-building-batch-"),
        );
        try {
          /* Словарь текстур у группы общий по построению — берём из первой
             записи и не повторяем его на каждую модель: помощник извлекает
             каждую запись ровно один раз. */
          const entries = [
            ...new Set(group.flatMap((miss) => entriesFor(miss.source))),
          ];
          const extracted = await extractEntries({
            archivePath: group[0].archivePath,
            entries,
            outputDirectory: workspace,
            gameRoot,
          });
          const produced = new Map(
            (extracted?.extracted || []).map((item) => [
              path.basename(String(item.output)).toLowerCase(),
              String(item.output),
            ]),
          );

          const present = [];
          for (const miss of group) {
            const drawable = produced.get(miss.source.drawable.toLowerCase());
            if (!drawable) {
              answers[miss.id] = Object.freeze({
                status: "failed",
                reason: `Не удалось извлечь ${miss.source.drawable} из игры.`,
              });
              continue;
            }
            present.push({ ...miss, drawable });
          }
          if (!present.length) continue;

          const outputDirectory = path.join(workspace, "glb");
          await fs.mkdir(outputDirectory, { recursive: true });
          const produced2 = new Map();

          /* Внутри одной распаковки конвертация делится по словарям. */
          const byTextures = new Map();
          for (const item of present) {
            const key = textureKey(item.source);
            if (!byTextures.has(key)) byTextures.set(key, []);
            byTextures.get(key).push(item);
          }

          for (const batch of byTextures.values()) {
            const textures = [...new Set(batch[0].source.textures)]
              .map((name) => produced.get(name.toLowerCase()))
              .filter(Boolean);
            if (convertModels && batch.length > 1) {
              await convertModels({
                inputs: batch.map((item) => item.drawable),
                outputDirectory,
                textures,
              });
              /* Хост кладёт результат рядом по имени модели: сопоставляем по
                 основе имени, а не по порядку — порядок он не обещает. */
              for (const file of await fs.readdir(outputDirectory)) {
                produced2.set(
                  path.basename(file, path.extname(file)).toLowerCase(),
                  path.join(outputDirectory, file),
                );
              }
            } else {
              for (const item of batch) {
                const output = path.join(
                  outputDirectory,
                  `${path.basename(item.drawable, path.extname(item.drawable))}.glb`,
                );
                await convertModel({ input: item.drawable, output, textures });
                produced2.set(
                  path.basename(output, ".glb").toLowerCase(),
                  output,
                );
              }
            }
          }

          for (const item of present) {
            const stem = path
              .basename(item.drawable, path.extname(item.drawable))
              .toLowerCase();
            const glb = produced2.get(stem);
            if (!glb) {
              answers[item.id] = Object.freeze({
                status: "failed",
                reason: `Конвертация не вернула модель для ${item.source.drawable}.`,
              });
              continue;
            }
            let bytes = null;
            try {
              bytes = await fs.readFile(glb);
            } catch (error) {
              answers[item.id] = Object.freeze({
                status: "failed",
                reason: String(error?.message || error),
              });
              continue;
            }
            if (!bytes.length || bytes.length > MAX_MODEL_BYTES) {
              answers[item.id] = Object.freeze({
                status: "failed",
                reason: "Конвертация вернула модель недопустимого размера.",
              });
              continue;
            }

            let lampList = Object.freeze([]);
            if (lights && inspectLights) {
              try {
                lampList = describeLights(
                  await inspectLights({
                    inputFile: item.drawable,
                    gameRoot,
                  }),
                );
              } catch {
                lampList = Object.freeze([]);
              }
            }

            await fs.mkdir(cacheRoot, { recursive: true });
            const staging = `${item.cacheFile}.${process.pid}.part`;
            await fs.writeFile(staging, bytes);
            let placed = true;
            await fs.rename(staging, item.cacheFile).catch(async (error) => {
              await fs.rm(staging, { force: true });
              if (!(await readCached(item.cacheFile))) throw error;
              placed = false;
            });
            await fs
              .writeFile(
                `${item.cacheFile.slice(0, -4)}.lights.json`,
                JSON.stringify(lampList),
                "utf8",
              )
              .catch(() => {});
            const hash = sha256Hex(bytes);
            /* Хэш рядом — только если GLB на месте именно наш: рядом мог
               оказаться файл параллельного запроса. */
            if (placed) await rememberHash(item.cacheFile, hash, bytes.length);

            answers[item.id] = Object.freeze({
              status: "ready",
              format: "glb",
              cached: false,
              sha256: hash,
              bytes,
              lights: lampList,
              source: Object.freeze({ ...item.source }),
            });
          }
        } catch (error) {
          const reason = String(error?.message || error);
          for (const miss of group) {
            if (!answers[miss.id])
              answers[miss.id] = Object.freeze({ status: "failed", reason });
          }
        } finally {
          await fs
            .rm(workspace, { recursive: true, force: true })
            .catch(() => {});
        }
      }

      return Object.freeze(answers);
    },

    async load({ buildingId, targetId }) {
      const source = sourceFor(buildingId);
      if (!source) {
        return Object.freeze({
          status: "unsupported",
          reason: "Для этого объекта не задано здание в архивах игры.",
        });
      }

      let gameRoot = null;
      try {
        const game = await findGame(targetId);
        gameRoot = game?.path ? path.resolve(String(game.path)) : null;
      } catch {
        gameRoot = null;
      }
      if (!gameRoot) {
        return Object.freeze({
          status: "unavailable",
          reason: "Установленная GTA V не найдена.",
        });
      }

      const archivePath = await archiveFor(gameRoot, source);
      let key = null;
      try {
        key = await cacheKey({ buildingId, archivePath, source });
      } catch {
        return Object.freeze({
          status: "unavailable",
          reason: `Архив ${source.archive} не найден в папке игры.`,
        });
      }

      const cacheFile = path.join(cacheRoot, `${key}.glb`);
      const lightsFile = path.join(cacheRoot, `${key}.lights.json`);
      const cached = await readCached(cacheFile);
      if (cached) {
        let lights = Object.freeze([]);
        try {
          lights = Object.freeze(
            JSON.parse(await fs.readFile(lightsFile, "utf8")),
          );
        } catch {}
        return Object.freeze({
          status: "ready",
          format: "glb",
          cached: true,
          sha256: await hashOfCached(cacheFile, cached),
          bytes: cached,
          lights,
          source: Object.freeze({ ...source }),
        });
      }

      const workspace = await fs.mkdtemp(
        path.join(tempRoot, "astral-building-"),
      );
      try {
        const entries = [source.drawable, ...source.textures].map(
          (name) => `${source.directory}${name}`,
        );
        const extracted = await extractEntries({
          archivePath,
          entries,
          outputDirectory: workspace,
          gameRoot,
        });
        const produced = new Map(
          (extracted?.extracted || []).map((item) => [
            path.basename(String(item.output)).toLowerCase(),
            String(item.output),
          ]),
        );
        const drawable = produced.get(source.drawable.toLowerCase());
        if (!drawable) {
          throw new Error(`Не удалось извлечь ${source.drawable} из игры.`);
        }
        const textures = source.textures
          .map((name) => produced.get(name.toLowerCase()))
          .filter(Boolean);

        /*
         * Спрашиваем игру, где светят лампы.
         *
         * Раньше здесь стояло условие на `.yft`, и оно отрезало от света всё,
         * что не фрагмент. Нативный помощник этого ограничения не разделяет:
         * `lamp-inspect` разбирает и .ydr, и .ydd, и .ymap, а LightAttributes
         * есть у обычного drawable ровно так же, как у фрагмента. Одна строка
         * условия стоила заправке всего её ночного света.
         *
         * Цена снятия: у крупной модели натив читает весь ресурс целиком —
         * у заправки это двадцать пять мегабайт против полумегабайта у
         * фонаря. Платится это один раз: список ламп ложится в кэш рядом с
         * GLB и ключуется тем же хэшем архива.
         *
         * Ошибку здесь по-прежнему глотаем: без координат превью просто
         * останется без искусственного света, а падать из-за этого не должно.
         */
        let lights = Object.freeze([]);
        if (inspectLights) {
          try {
            const inventory = await inspectLights({
              inputFile: drawable,
              gameRoot,
            });
            lights = describeLights(inventory);
          } catch {
            lights = Object.freeze([]);
          }
        }

        const output = path.join(workspace, "building.glb");
        await convertModel({ input: drawable, output, textures });

        const bytes = await fs.readFile(output);
        if (!bytes.length || bytes.length > MAX_MODEL_BYTES) {
          throw new Error("Конвертация вернула модель недопустимого размера.");
        }
        await fs.mkdir(cacheRoot, { recursive: true });
        /* Пишем через временное имя: два одновременных запроса не должны
           поймать друг у друга наполовину записанный файл. */
        const staging = `${cacheFile}.${process.pid}.part`;
        await fs.writeFile(staging, bytes);
        let placed = true;
        await fs.rename(staging, cacheFile).catch(async (error) => {
          await fs.rm(staging, { force: true });
          if (!(await readCached(cacheFile))) throw error;
          placed = false;
        });
        await fs
          .writeFile(lightsFile, JSON.stringify(lights), "utf8")
          .catch(() => {});
        const hash = sha256Hex(bytes);
        if (placed) await rememberHash(cacheFile, hash, bytes.length);

        return Object.freeze({
          status: "ready",
          format: "glb",
          cached: false,
          sha256: hash,
          bytes,
          lights,
          source: Object.freeze({ ...source }),
        });
      } catch (error) {
        return Object.freeze({
          status: "failed",
          reason: String(error?.message || error),
        });
      } finally {
        await fs
          .rm(workspace, { recursive: true, force: true })
          .catch(() => {});
      }
    },
  });
}

export { BUILDING_SOURCES, INTERIOR_PROP_SOURCES, INTERIOR_ROOM_SOURCES };
