
import { tr } from "../../../locales/ui.js";
/*
 * Какое помещение стоит в кадре — и из чего оно сложено.
 *
 * Файл заведён из-за расхождения, которое до него никто не мог закрыть, а мог
 * только назвать. Человек правит комнату из реестра (`convenience-store-small`
 * — 11.51 × 7.51 × 3.56 м, `gas-station-store-small` — 14.47 × 8.39 × 3.56 м),
 * а в кадре стоял зал Auto Shop из mptuner — 42 × 32 × 8 м. Разные помещения,
 * и разница не в отделке, а в четырнадцать раз по площади. Комнату обводили по
 * полу чужого зала, чтобы было видно, где кончается правимое; обводка не врала,
 * но и помещением, которое правят, не была.
 *
 *
 * ЧТО ЗДЕСЬ СТРОИТСЯ И КОГДА ЭТО ВИДНО
 *
 * Схема, а не настоящее помещение. Настоящее игра отдаёт: магазин 24/7 лежит
 * двадцатью drawable в `v_int_66.rpf`, лавка при заправке — двадцатью четырьмя
 * в `v_int_68.rpf`, и `gameRoomParts` в `interior-models.js` знает их состав и
 * места. Долгое время здесь было написано обратное — «игра её не отдаёт,
 * потому что интерьер это MLO»; довод про MLO верен, вывод из него был нет.
 *
 * Схема осталась запасным путём, и путь этот не редкий: без установленной
 * игры, без настольного приложения, у незнакомой комнаты (стенд окна поднимает
 * сцену вовсе без проекта) и при любой неудаче чтения человек обязан увидеть
 * помещение верного размера, а не пустоту. Поэтому размеры настоящие до
 * сантиметра, а не «примерно такие»: по ним он и решает, влезет ли холодильник
 * между стеллажом и стеной.
 *
 *
 * ЧТО СЧИТАЕТСЯ ЗДЕСЬ, А ЧТО НЕТ
 *
 * Здесь только размеры и геометрия коробки. Ни three в импортах (движок
 * приходит параметром — своя копия означала бы второй `instanceof` в чужой
 * сцене), ни React, ни контракта проекта: числа комнаты приходят планом пола из
 * `interior-layout.js`, тем же самым, по которому расставляются объекты. Одна
 * правда на две половины — иначе стены встанут не там, где кончается зона.
 */

/*
 * Зал на случай, когда правят не помещение, а ничего.
 *
 * Сцену поднимают не только из редактора: стенд окна (`dev/preview-lab`) и
 * витрина мода зовут `mount` без проекта, и шаблона комнаты у них нет вовсе.
 * Показывать им пустоту нечестно — окно предпросмотра нечем будет проверить
 * глазами, — поэтому у них остаётся тот самый зал: сорок с небольшим метров
 * поперёк при восьми в высоту. Размеры сняты с настоящего Auto Shop, и это
 * единственная комната, для которой игра отдаёт модель.
 */
export const FALLBACK_HALL = Object.freeze({
  id: "auto-shop-tuner",
  label: "Зал Auto Shop",
  width: 42,
  depth: 32,
  height: 8,
  doorways: Object.freeze([]),
  fallback: true,
});

/*
 * Высота комнаты на случай, когда шаблон её не задал.
 *
 * У обоих шаблонов реестра `maxZ` = 3.5563 — это высота, снятая с настоящего
 * помещения. Ноль вместо неё означал бы комнату без стен, а восемь метров от
 * зала — магазин с потолком в два этажа.
 */
const DEFAULT_HEIGHT = 3.5563;

/* Насколько зона должна прижаться к стене, чтобы считаться проёмом. Зоны в
   реестре заданы с запасом наружу (у 24/7 вход идёт от -5.75 при стене на
   -5.576), поэтому порог односторонний и щедрый. */
const DOORWAY_REACH = 0.6;

/* Проём не выше этого и не выше самой комнаты: дверь во всю стену — это уже не
   дверь, а отсутствующая стена. */
const DOORWAY_HEIGHT = 2.4;

/* Пол лежит на сантиметре, как и у прежней схемы: макет приподнят над ним на
   два (`FLOOR_LIFT` в `interior-layout-view.js`), и объект, поставленный в
   ноль, не должен тонуть. */
const FLOOR_Y = 0.01;

/* Один тайл бетона — четыре метра по полу и семь по стене. Числа не новые:
   у прежней схемы пол повторялся `width / 4`, а стены ровно шесть раз на
   сорока двух метрах, то есть те же семь метров на тайл. */
const FLOOR_TILE = 4;
const WALL_TILE = 7;

/* Колонны нужны большому залу и мешают маленькому. Сорок на тридцать два — это
   1344 м², магазин 24/7 — 86 м²: в комнате такого размера столб посреди пола
   не рассказывает про масштаб, а стоит на проходе. */
const PILLAR_AREA = 400;

const number = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

/**
 * Проёмы в стенах — по защищённым зонам шаблона.
 *
 * Зона «Вход и двери» стоит в реестре не для красоты: она прижата к той стене,
 * в которой у настоящего помещения стеклянный фасад. Глухая стена на этом месте
 * — та же ложь, что и чужой зал вокруг комнаты, только меньше, поэтому зона,
 * достающая до стены, превращается в проём по своей ширине.
 *
 * Координаты на выходе — уже в осях кадра (X вправо, Z на юг) и относительно
 * середины комнаты, как их считает `worldPoint`.
 */
export function doorwaysFor(plan, zones = []) {
  if (!plan) return [];
  const halfWidth = plan.width / 2;
  const halfDepth = plan.depth / 2;
  const doorways = [];
  for (const zone of zones) {
    if (!zone) continue;
    /* Зона приходит в осях макета; переводим её углы в оси кадра тем же
       правилом, что и объекты: X сдвигается на середину, Y меняет знак. */
    const left = number(zone.minX) - plan.centre.x;
    const right = number(zone.maxX) - plan.centre.x;
    const near = plan.centre.y - number(zone.maxY);
    const far = plan.centre.y - number(zone.minY);

    const walls = [
      ["south", far >= halfDepth - DOORWAY_REACH, left, right],
      ["north", near <= -halfDepth + DOORWAY_REACH, left, right],
      ["east", right >= halfWidth - DOORWAY_REACH, near, far],
      ["west", left <= -halfWidth + DOORWAY_REACH, near, far],
    ];
    for (const [wall, touches, from, to] of walls) {
      if (!touches) continue;
      const limit = wall === "east" || wall === "west" ? halfDepth : halfWidth;
      const start = Math.max(from, -limit);
      const end = Math.min(to, limit);
      /* Зона шириной в ладонь — это не проём, а щель: рисовать в стене дыру
         меньше полуметра значит показать шов, а не вход. */
      if (end - start < 0.5) continue;
      doorways.push({ wall, from: start, to: end });
      break;
    }
  }
  return doorways;
}

/**
 * Комната кадра по плану пола макета.
 *
 * Нет плана — нет и проекта: возвращается зал витрины. Это единственное место,
 * где решается «что стоит в кадре», и оно намеренно одно: разойдись ответ по
 * сцене и по редактору, человек снова смотрел бы на одно, а правил другое.
 */
export function frameRoom(plan, zones = [], roomId = "") {
  if (!plan || !(plan.width > 0) || !(plan.depth > 0)) return FALLBACK_HALL;
  return Object.freeze({
    /*
     * Комната зовётся своим именем из реестра, а не «комнатой проекта».
     *
     * Пока имя было общим на всех, вопрос «что игра отдаёт для ЭТОГО
     * помещения» задать было некому: `gameRoomParts` получал одну и ту же
     * строку и для магазина 24/7, и для лавки при заправке. Помещение при этом
     * стояло схемой даже тогда, когда игра отдавала настоящее.
     */
    id: String(roomId || "") || "template-room",
    label: tr("Помещение проекта"),
    width: plan.width,
    depth: plan.depth,
    height: plan.height > 0 ? plan.height : DEFAULT_HEIGHT,
    doorways: Object.freeze(doorwaysFor(plan, zones)),
    fallback: false,
  });
}

/**
 * Размер комнаты в том виде, в каком его ждут камера, лампы и туман сцены.
 *
 * Радиус, а не полуширина: по нему считаются и предел орбиты, и дальность
 * тумана, и коробка теней — все они круглые, а комната прямоугольная.
 *
 * Полуразмеры по осям идут рядом, потому что круглого хватает не всем: коробку
 * полёта радиус вытянул бы по узкой стороне, и камера вышла бы сквозь стену
 * там, где комната у́же своего диаметра.
 */
export function roomExtent(room) {
  return {
    radius: Math.max(room.width, room.depth) / 2,
    height: room.height,
    halfWidth: room.width / 2,
    halfDepth: room.depth / 2,
  };
}

/*
 * Яркость ламп падает с квадратом расстояния, и одна и та же лампа в комнате
 * на три с половиной метра светит впятеро сильнее, чем под восьмиметровым
 * потолком зала. Свет зала подобран по залу (210 кд, см. `interior-scene.js`),
 * и без поправки маленькая комната выходит выбеленной.
 *
 * Отсюда множитель по высоте: свет считается для того потолка, под которым
 * стоит лампа, а не для того, под которым его подбирали.
 */
export function lampScale(room) {
  const height = Math.max(1.6, number(room?.height, FALLBACK_HALL.height));
  return (height / FALLBACK_HALL.height) ** 2;
}

/**
 * Схематичная комната: пол, стены, потолок и проёмы — по числам шаблона.
 *
 * Строится всегда, а не «когда игры рядом нет»: для комнат реестра игра модели
 * не отдаёт вовсе, и это единственное, что человек увидит. Поэтому размеры
 * настоящие до сантиметра, а не «примерно такие»: по ним он и решает, влезет ли
 * холодильник между стеллажом и стеной.
 *
 * @param {object} THREE Движок из контекста окна. Свой импорт здесь означал бы
 *   вторую копию three рядом с первой.
 * @param {object} room Комната из `frameRoom`.
 * @param {object} [options]
 * @param {Function} [options.surface] `(kind, repeat) => THREE.Texture|null` —
 *   покрытие из набора окна. Набор один на все редакторы, он же кэширует и он
 *   же освобождает; отсюда текстуру только берут.
 * @returns {{group: object, owned: object[]}} Группа для сцены и всё, что она
 *   завела сама и что обязана освободить. Клоны моделей из игры сюда не
 *   попадают — их геометрию делит кэш `interior-models`.
 */
export function buildRoomShell(THREE, room, { surface = () => null } = {}) {
  const width = Math.max(1, number(room?.width, FALLBACK_HALL.width));
  const depth = Math.max(1, number(room?.depth, FALLBACK_HALL.depth));
  const height = Math.max(1, number(room?.height, FALLBACK_HALL.height));
  const doorways = Array.isArray(room?.doorways) ? room.doorways : [];

  const group = new THREE.Group();
  group.name = "interior-schematic-hall";
  const owned = [];
  const keep = (...items) => {
    for (const item of items) if (item) owned.push(item);
  };
  const tiles = (size, tile) => Math.max(1, size / tile);

  /* ---------- пол ---------- */

  const floorMap = surface("concrete", tiles(width, FLOOR_TILE));
  const floorGeometry = new THREE.PlaneGeometry(width, depth);
  const floorMaterial = new THREE.MeshStandardMaterial({
    /* Покрытие покрашено до нас: второй слой краски поверх текстуры из игры
       превращает пол в чёрную дыру под ногами. */
    color: floorMap ? 0xffffff : 0x54565a,
    roughness: 0.94,
    map: floorMap || null,
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  group.add(floor);
  keep(floorGeometry, floorMaterial);

  /* ---------- стены и потолок ---------- */

  const wallMap = surface("concrete", tiles(width, WALL_TILE));
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: wallMap ? 0xb9bcc2 : 0x3d4045,
    roughness: 0.9,
    map: wallMap || null,
    side: doorways.length ? THREE.FrontSide : THREE.BackSide,
  });
  keep(wallMaterial);

  if (!doorways.length) {
    /*
     * Глухая комната — одной коробкой, вывернутой внутрь: помещение смотрят
     * изнутри, и наружные грани в кадр не попадают вовсе. Ровно так стоял зал
     * витрины до этого файла, и кадр витрины меняться не должен.
     */
    const shellGeometry = new THREE.BoxGeometry(width, height, depth);
    const shell = new THREE.Mesh(shellGeometry, wallMaterial);
    shell.position.y = height / 2;
    shell.receiveShadow = true;
    group.add(shell);
    keep(shellGeometry);
  } else {
    /* С проёмом коробкой не обойтись: дыру в готовом кубе не вырезать, поэтому
       стены собираются панелями, а потолок кладётся отдельно. */
    for (const panel of wallPanels(width, depth, height, doorways)) {
      const geometry = new THREE.PlaneGeometry(panel.width, panel.height);
      const mesh = new THREE.Mesh(geometry, wallMaterial);
      mesh.position.set(panel.x, panel.y, panel.z);
      mesh.rotation.y = panel.rotation;
      mesh.receiveShadow = true;
      group.add(mesh);
      keep(geometry);
    }

    const ceilingGeometry = new THREE.PlaneGeometry(width, depth);
    const ceiling = new THREE.Mesh(ceilingGeometry, wallMaterial);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = height;
    group.add(ceiling);
    keep(ceilingGeometry);

    /*
     * В проёме стекло, а не пустота.
     *
     * Сквозь дыру в стене видно небо окна и туман за ним — снаружи у комнаты
     * ничего нет и быть не должно, — и читается это как отсутствующая стена, а
     * не как вход. Полупрозрачная створка честнее: у настоящего магазина там
     * стеклянный фасад, и дневной свет через него действительно попадает.
     */
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0xcfe3ee,
      roughness: 0.12,
      metalness: 0,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    });
    keep(glassMaterial);
    for (const panel of doorwayPanels(width, depth, height, doorways)) {
      const geometry = new THREE.PlaneGeometry(panel.width, panel.height);
      const glass = new THREE.Mesh(geometry, glassMaterial);
      glass.position.set(panel.x, panel.y, panel.z);
      glass.rotation.y = panel.rotation;
      group.add(glass);
      keep(geometry);
    }
  }

  /* ---------- колонны ---------- */

  if (width * depth >= PILLAR_AREA) {
    /*
     * Не украшение: без них большой зал — пустая коробка, в которой свет ламп
     * ложится ровным полем и не читается ни как объём, ни как расстояние. Одна
     * вертикаль с тенью на полу говорит про размер зала больше, чем вся его
     * квадратура. Маленькой комнате они не нужны — там расстояние меряется
     * стеной, до которой рукой подать.
     */
    const pillarGeometry = new THREE.CylinderGeometry(0.45, 0.55, height, 12);
    const pillarMaterial = new THREE.MeshStandardMaterial({
      color: 0x6b6e74,
      roughness: 0.72,
      metalness: 0.08,
    });
    keep(pillarGeometry, pillarMaterial);
    for (const [x, z] of [
      [-width * 0.24, -depth * 0.22],
      [width * 0.24, -depth * 0.22],
      [-width * 0.24, depth * 0.22],
      [width * 0.24, depth * 0.22],
    ]) {
      const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
      pillar.position.set(x, height / 2, z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      group.add(pillar);
    }
  }

  return { group, owned };
}

/*
 * Раскладка стен по сторонам света кадра.
 *
 * `south` — дальняя по +Z, `north` — ближняя по -Z, `east` — по +X, `west` — по
 * -X. Поворот панели такой, чтобы её лицевая сторона смотрела ВНУТРЬ комнаты:
 * односторонняя стена, повёрнутая наружу, изнутри выглядит как её отсутствие.
 */
const WALLS = Object.freeze({
  south: { axis: "x", offset: [0, 0, 1], rotation: Math.PI },
  north: { axis: "x", offset: [0, 0, -1], rotation: 0 },
  east: { axis: "z", offset: [1, 0, 0], rotation: -Math.PI / 2 },
  west: { axis: "z", offset: [-1, 0, 0], rotation: Math.PI / 2 },
});

const wallSpan = (wall, width, depth) =>
  WALLS[wall].axis === "x" ? width : depth;

function wallPlace(wall, width, depth, centre, y) {
  const { offset, rotation } = WALLS[wall];
  const half = WALLS[wall].axis === "x" ? depth / 2 : width / 2;
  return WALLS[wall].axis === "x"
    ? { x: centre, y, z: offset[2] * half, rotation }
    : { x: offset[0] * half, y, z: centre, rotation };
}

/**
 * Панели стен с вырезами под проёмы.
 *
 * Стена без проёма — одна панель. Стена с проёмом — простенок слева, простенок
 * справа и перемычка над входом: ровно так стоит стена настоящего магазина, и
 * ровно так через проём виден час на улице.
 */
function wallPanels(width, depth, height, doorways) {
  const panels = [];
  for (const wall of Object.keys(WALLS)) {
    const span = wallSpan(wall, width, depth);
    const gaps = doorways
      .filter((item) => item.wall === wall)
      .map((item) => ({
        from: Math.max(item.from, -span / 2),
        to: Math.min(item.to, span / 2),
        height: Math.min(DOORWAY_HEIGHT, height * 0.9),
      }))
      .sort((left, right) => left.from - right.from);

    let cursor = -span / 2;
    for (const gap of gaps) {
      if (gap.from > cursor) {
        const size = gap.from - cursor;
        panels.push({
          width: size,
          height,
          ...wallPlace(wall, width, depth, cursor + size / 2, height / 2),
        });
      }
      /* Перемычка: над проёмом стена остаётся, иначе комната теряет угол
         потолка и читается как незаконченная. */
      const header = height - gap.height;
      if (header > 0.05) {
        panels.push({
          width: gap.to - gap.from,
          height: header,
          ...wallPlace(
            wall,
            width,
            depth,
            (gap.from + gap.to) / 2,
            gap.height + header / 2,
          ),
        });
      }
      cursor = Math.max(cursor, gap.to);
    }
    if (cursor < span / 2) {
      const size = span / 2 - cursor;
      panels.push({
        width: size,
        height,
        ...wallPlace(wall, width, depth, cursor + size / 2, height / 2),
      });
    }
  }
  return panels;
}

/** Стеклянные створки в проёмах. */
function doorwayPanels(width, depth, height, doorways) {
  return doorways.map((item) => {
    const span = wallSpan(item.wall, width, depth);
    const from = Math.max(item.from, -span / 2);
    const to = Math.min(item.to, span / 2);
    const glassHeight = Math.min(DOORWAY_HEIGHT, height * 0.9);
    return {
      width: to - from,
      height: glassHeight,
      ...wallPlace(item.wall, width, depth, (from + to) / 2, glassHeight / 2),
    };
  });
}
