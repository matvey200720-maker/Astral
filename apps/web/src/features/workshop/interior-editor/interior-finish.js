/*
 * Отделка помещения: какие в нём есть поверхности и как их перекрасить.
 *
 * Редактор до сих пор умел одно — расставлять предметы. Само помещение при
 * этом приезжало из установленной GTA V и было ровно тем, чем его сделала
 * Rockstar: те же стены, тот же кафель, те же полки. Спросить «а если стены
 * будут синие» было негде, а с этого вопроса начинается любая переделка
 * магазина.
 *
 *
 * ЧТО СЧИТАЕТСЯ ПОВЕРХНОСТЬЮ
 *
 * Один материал одной детали помещения. Не «стена целиком» и не «весь зал»:
 * игра красит модель по материалам, и всё, что можно перекрасить, не выдумывая
 * геометрию, — это они. Стеллажи `v_66_shelves` приезжают пятью материалами
 * (картон, полки, ящик с фруктами, металл, сетка корзин — имена читаны из
 * файла игры), и каждый человек может тронуть отдельно.
 *
 * Отсюда имя поверхности: `v_66_shelves:m1` — деталь и номер материала внутри
 * неё. Номер, а не имя текстуры, и это выбор, а не лень. Имена материалов в
 * кадре зависят от того, какой версией нативного конвертера собран GLB: старый
 * писал `Mat_1`, новый — `normal|gz_V_ML_Shelves`. Номер же задаёт сама деталь
 * из файлов игры, и покрашенный вчера пол останется покрашенным после
 * обновления конвертера. Имя текстуры при этом не пропадает — оно идёт
 * подписью, когда его удаётся прочитать.
 *
 * Схема помещения — которую редактор рисует, когда игры рядом нет, — считается
 * такой же деталью по имени `room`. Ради этого здесь нет ни слова о том, откуда
 * взялась группа: пол схемы и пол настоящего магазина красятся одним кодом, и
 * человек без установленной игры видит те же органы, а не пустую панель с
 * обещанием.
 *
 *
 * КАК ПОВЕРХНОСТЬ ПОЛУЧАЕТ ИМЯ «ПОЛ» ИЛИ «СТЕНЫ»
 *
 * Из геометрии, а не из таблицы. Таблица «материал №2 оболочки 24/7 — это пол»
 * верна ровно до первого обновления игры, а нормали и габариты меша врать не
 * умеют: поверхность, которая смотрит вверх, тонкая и лежит внизу помещения, —
 * пол и есть. Что не опознано, остаётся «поверхностью N» с именем текстуры в
 * подписи: врать про «индустриальный бетон», не видя модель, здесь не будут.
 *
 *
 * ПОЧЕМУ МАТЕРИАЛЫ КЛОНИРУЮТСЯ
 *
 * Разобранная модель живёт в кэше `interior-models` и переживает закрытие
 * окна: клоны деталей делят с ней и геометрию, и материалы. Покрась мы материал
 * на месте — синие стены поехали бы в следующий проект, в витрину мода и на
 * стенд окна, а «вернуть как было» стало бы невозможно: исходного цвета никто
 * бы не помнил. Поэтому каждая поверхность получает свой клон материала, а
 * исходные цвет и текстура остаются записанными рядом с ним.
 */

/* Подписи ролей. Роль — это то, чем поверхность оказалась в помещении, а не
   то, как её назвала Rockstar. */
/*
 * Роли, которые красят целиком.
 *
 * Пол, стены и потолок — это то, ради чего отделку и открывают, и в живом
 * магазине каждая из них разложена игрой на несколько деталей: пол зала,
 * пол подсобки, стена за прилавком. Красить их по одной значит попадать
 * ползунком в список из двух десятков строк.
 */
export const INTERIOR_BULK_ROLES = Object.freeze(["floor", "wall", "ceiling"]);

const ROLE_LABELS = Object.freeze({
  floor: "Пол",
  ceiling: "Потолок",
  wall: "Стены",
  glass: "Стекло",
  light: "Свет",
});

/** Подпись роли — та же, что у отдельной поверхности этой роли. */
export const interiorRoleLabel = (role) => ROLE_LABELS[role] || role;

/* Порядок в списке: сначала то, ради чего редактор открывают. */
const ROLE_ORDER = Object.freeze({
  floor: 0,
  wall: 1,
  ceiling: 2,
  glass: 3,
  light: 4,
  other: 5,
});

/**
 * Имя текстуры из имени материала.
 *
 * Новый конвертер пишет «шейдер|текстура» — то же написание, что у сборщика
 * секций карты. Старый писал «Mat_3», и это не имя, а номер: пустая строка
 * честнее выдуманной подписи.
 */
export function surfaceTextureName(material) {
  const name = String(material?.name || "");
  if (!name.includes("|")) return "";
  const texture = name.slice(name.indexOf("|") + 1).trim();
  return !texture || texture === "flat" ? "" : texture;
}

/*
 * Средняя нормаль поверхности и её габариты — по всем её мешам разом.
 *
 * Нормали складываются по вершинам, без веса площади. Вес дал бы более точный
 * ответ на кривой геометрии, а стоил бы прохода по индексам: у оболочки
 * магазина это десятки тысяч треугольников на каждое открытие редактора. Для
 * вопроса «смотрит вверх или вбок» хватает и суммы.
 */
function measure(THREE, meshes) {
  const box = new THREE.Box3();
  const normal = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  let counted = 0;
  for (const mesh of meshes) {
    box.expandByObject(mesh);
    const attribute = mesh.geometry?.getAttribute?.("normal");
    if (!attribute) continue;
    /* Шаг по вершинам: у стены их бывает четыре штуки, у оболочки — десятки
       тысяч, а средняя нормаль по каждой пятисотой вершине та же самая. */
    const step = Math.max(1, Math.floor(attribute.count / 500));
    for (let index = 0; index < attribute.count; index += step) {
      scratch.fromBufferAttribute(attribute, index);
      /* Нормаль записана в системе самого меша, а деталь может стоять
         повёрнутой: поворот учитывается, перенос — нет. */
      scratch.transformDirection(mesh.matrixWorld);
      normal.add(scratch);
      counted += 1;
    }
  }
  if (counted) normal.divideScalar(counted);
  const empty = box.isEmpty();
  return {
    box,
    size: empty ? new THREE.Vector3() : box.getSize(new THREE.Vector3()),
    centre: empty ? new THREE.Vector3() : box.getCenter(new THREE.Vector3()),
    up: normal.y,
    flat: Math.hypot(normal.x, normal.z),
  };
}

/**
 * Чем поверхность оказалась в помещении.
 *
 * `hall` — габариты всего зала: пол узнаётся не по абсолютной высоте, а по
 * тому, что лежит внизу помещения. Зал витрины на сорок метров и магазин на
 * одиннадцать разбираются одним правилом.
 */
function classify(shape, hall, material) {
  if (material?.transparent && Number(material.opacity) < 0.95) return "glass";
  const emissive = material?.emissive;
  if (emissive && (emissive.r || emissive.g || emissive.b)) return "light";

  const height = Math.max(0.5, hall.size.y);
  const relative = (shape.centre.y - hall.box.min.y) / height;
  const thin = shape.size.y < height * 0.12;
  const wide =
    Math.max(shape.size.x, shape.size.z) >
    Math.max(1.5, Math.min(hall.size.x, hall.size.z) * 0.3);

  if (shape.up > 0.7 && thin && relative < 0.3 && wide) return "floor";
  if (shape.up < -0.5 && thin && relative > 0.6) return "ceiling";
  if (shape.flat > 0.6 && shape.size.y > height * 0.35 && wide) return "wall";
  /* Стены и потолок одной коробкой — так собрана схема помещения: вывернутый
     внутрь куб держит и то, и другое. Роли у такой поверхности нет, но «стены»
     ближе к правде, чем «поверхность 2». */
  if (shape.flat > 0.3 && shape.size.y > height * 0.5) return "wall";
  return "other";
}

/*
 * Холст образцов — один на всё окно.
 *
 * У магазина полсотни текстур, и свой холст на каждую означал бы полсотни
 * элементов и полсотни контекстов ради полсотни картинок сорок восемь на сорок
 * восемь. `null` здесь — «холста не будет вовсе»: в тесте (jsdom) рисовать
 * некому, и спрашивать об этом заново на каждую текстуру незачем.
 */
let swatch;

function swatchCanvas() {
  if (swatch !== undefined) return swatch;
  swatch = null;
  if (typeof document === "undefined") return swatch;
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  if (context) swatch = { canvas, context };
  return swatch;
}

/** Картинка текстуры в маленький квадрат: по ней выбирают, чем красить. */
function thumbnail(texture) {
  const image = texture?.image;
  if (!image || !(image.width || image.videoWidth)) return "";
  const target = swatchCanvas();
  if (!target) return "";
  try {
    target.context.clearRect(0, 0, 48, 48);
    target.context.drawImage(image, 0, 0, 48, 48);
    return target.canvas.toDataURL("image/png");
  } catch {
    /* Картинка из чужого источника умеет запачкать холст, и тогда `toDataURL`
       бросает. Список поверхностей от этого не пропадает — пропадает образец. */
    return "";
  }
}

const hex = (color) => (color ? `#${color.getHexString()}` : "");

/**
 * Разобрать зал на поверхности.
 *
 * `sources` — детали помещения: `{ id, label, object }`. Возвращается индекс:
 * список поверхностей, карта по имени для покраски и клоны материалов, которые
 * индекс завёл и которые обязан освободить тот, кто его построил.
 */
export function indexInteriorSurfaces(THREE, sources = []) {
  const list = [];
  const clones = [];
  const byId = new Map();
  /* Меш -> поверхность: по нему щелчок в зале превращается в выбранную строку
     панели, и превращается за один поиск, а не перебором всех поверхностей. */
  const byMesh = new Map();

  for (const source of sources) {
    if (!source?.object) continue;
    source.object.updateMatrixWorld(true);
    /* Меши по материалу: один материал могут делить несколько мешей детали, и
       это одна поверхность, а не две. */
    const groups = new Map();
    let slot = 0;
    source.object.traverse((object) => {
      if (!object.isMesh || !object.geometry || !object.material) return;
      const index = slot;
      slot += 1;
      /* Меш с массивом материалов рисуется группами геометрии. Из конвертера
         такие не приезжают — на примитив приходится один материал, — а
         встреченный останется как есть, а не потеряет часть краски. */
      if (Array.isArray(object.material)) return;
      /*
       * Считается ИСХОДНЫЙ материал, а не тот, что сейчас на меше.
       *
       * Индекс пересобирается на каждую смену состава зала, и во второй раз на
       * меше лежит уже наш крашеный клон. Возьми мы его — «как в игре» стало бы
       * означать «как покрасили в прошлый раз», и снять краску было бы нечем.
       */
      const base = object.userData.astralRoomMaterial || object.material;
      object.userData.astralRoomMaterial = base;
      const known = groups.get(base);
      if (known) known.meshes.push(object);
      else groups.set(base, { slot: index, meshes: [object] });
    });

    for (const [material, group] of groups) {
      const paint = material.clone();
      /* Клон получает то же имя: по нему читается имя текстуры из игры. */
      paint.name = material.name;
      for (const mesh of group.meshes) mesh.material = paint;
      clones.push(paint);
      list.push({
        id: `${source.id}:m${group.slot}`,
        sourceId: source.id,
        sourceLabel: source.label || source.id,
        texture: surfaceTextureName(material),
        material: paint,
        base: {
          color: material.color?.clone?.() || null,
          emissive: material.emissive?.clone?.() || null,
          map: material.map || null,
        },
        meshes: group.meshes,
      });
    }
  }

  /* Габариты зала считаются по всему, что в нём стоит: роль поверхности
     определяется её местом в помещении, а не абсолютной высотой. */
  const hall = { box: new THREE.Box3(), size: new THREE.Vector3() };
  const shapes = new Map();
  for (const surface of list) {
    const shape = measure(THREE, surface.meshes);
    shapes.set(surface.id, shape);
    if (!shape.box.isEmpty()) hall.box.union(shape.box);
  }
  if (!hall.box.isEmpty()) hall.box.getSize(hall.size);

  const counters = new Map();
  for (const surface of list) {
    surface.role = classify(shapes.get(surface.id), hall, surface.material);
    const seen = (counters.get(surface.sourceId) || 0) + 1;
    counters.set(surface.sourceId, seen);
    surface.label =
      ROLE_LABELS[surface.role] || surface.texture || `Поверхность ${seen}`;
    surface.thumbnail = thumbnail(surface.base.map);
    surface.baseColor = hex(surface.base.color);
    byId.set(surface.id, surface);
    for (const mesh of surface.meshes) byMesh.set(mesh, surface);
  }

  list.sort((left, right) => {
    if (left.sourceId !== right.sourceId)
      return left.sourceId < right.sourceId ? -1 : 1;
    const order = ROLE_ORDER[left.role] - ROLE_ORDER[right.role];
    return order || (left.id < right.id ? -1 : 1);
  });

  return { list, byId, byMesh, clones };
}

/**
 * Что из индекса уезжает наверх, в интерфейс.
 *
 * Материалы и меши остаются здесь: React про three.js не знает и знать не
 * должен, а материал, положенный в состояние компонента, — это утечка кадра в
 * разметку.
 */
export function describeInteriorSurfaces(index) {
  return (index?.list || []).map((surface) => ({
    id: surface.id,
    sourceId: surface.sourceId,
    sourceLabel: surface.sourceLabel,
    label: surface.label,
    role: surface.role,
    texture: surface.texture,
    thumbnail: surface.thumbnail,
    baseColor: surface.baseColor,
    hasTexture: Boolean(surface.base.map),
  }));
}

/*
 * Что положить в материал вместо текстуры из игры.
 *
 * `undefined` означает «оставить, как в игре», и это не то же самое, что
 * `null`: «снять текстуру и оставить заливку» человек просит отдельно, и цвет
 * тогда виден целиком, а не сквозь рисунок Rockstar.
 */
function resolveTexture(index, reference, textureFor) {
  if (!reference) return undefined;
  if (reference === "flat") return null;
  if (reference.startsWith("room:")) {
    const source = index.byId.get(reference.slice(5));
    return source ? source.base.map : undefined;
  }
  return textureFor?.(reference) || undefined;
}

/**
 * Покрасить помещение по макету.
 *
 * `finish` — записи проекта: цвет и ссылка на текстуру. Всё, чего в записях
 * нет, возвращается к тому, как лежит в игре: снятая краска обязана сниматься,
 * иначе «отменить» перестаёт работать в тот самый миг, когда становится
 * нужным.
 *
 * `textureFor` отвечает за принесённые человеком картинки: индекс знает только
 * то, что приехало из игры, а файл со своего диска читает окно.
 */
export function paintInteriorSurfaces(
  index,
  finish = [],
  { textureFor, highlight = "" } = {},
) {
  const wanted = new Map(
    (Array.isArray(finish) ? finish : []).map((item) => [item.surfaceId, item]),
  );
  for (const surface of index?.list || []) {
    const paint = wanted.get(surface.id) || null;
    const material = surface.material;

    if (paint?.color) material.color?.set?.(paint.color);
    else if (surface.base.color) material.color?.copy?.(surface.base.color);

    /*
     * Выбранная поверхность светится.
     *
     * Другого способа показать, что выбрана именно она, у зала нет: обводка
     * поверх чужой геометрии — это второй проход отрисовки и своя геометрия
     * контура, а поверхность бывает и стеной во всю комнату, и уголком полки.
     * Свечение же ложится ровно на неё и видно с любого ракурса.
     */
    if (material.emissive) {
      if (highlight && surface.id === highlight)
        material.emissive.setHex(0x1d3f66);
      else if (surface.base.emissive)
        material.emissive.copy(surface.base.emissive);
      else material.emissive.setHex(0x000000);
    }

    const chosen = resolveTexture(index, paint?.texture || "", textureFor);
    const next = chosen === undefined ? surface.base.map : chosen;
    if (material.map !== next) {
      material.map = next;
      material.needsUpdate = true;
    }
  }
}

/** Освободить клоны материалов, заведённые индексом. */
export function disposeInteriorSurfaces(index) {
  for (const material of index?.clones || []) material.dispose?.();
}
