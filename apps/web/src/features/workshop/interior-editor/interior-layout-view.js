/*
 * Объём макета: то, что человек расставил, — в зале.
 *
 * До этого файла зал и макет жили порознь. Зал приезжал из игры и стоял пустой,
 * объекты макета существовали числами в правой колонке, и единственный способ
 * узнать, куда встал автомат eCola, был прочитать две цифры. Здесь макет
 * получает объём — и ровно настолько, насколько про него честно известно.
 *
 *
 * ЧТО РИСУЕТСЯ ВМЕСТО МОДЕЛИ
 *
 * Настоящие модели объектов лежат в игре, и `interior-models.js` умеет их
 * читать — тем же конвейером, что зал и отделку. Весь каталог интерьеров игра
 * отдаёт: пять предметов, пять обычных пропов в x64i.rpf, и таблица источников
 * (`apps/desktop/src/mega-mall-building-model.js`) их знает.
 *
 * Порядок при этом остался прежним и остаться обязан: сначала спрашиваем игру
 * про архетип объекта, и если модель приехала — ставим её; если нет — ставим
 * коробку РАЗМЕРОМ С АРХЕТИП и подписываем именем. Заглушка не «на время, пока
 * не доделали»: игры может не быть вовсе, редактор открывают и в браузере, и до
 * первой установки, — и там подписанная коробка честного размера остаётся всем,
 * что про предмет известно наверняка. Половина настоящих и половина коробок —
 * нормальный кадр, потому что коробки подписаны.
 *
 *
 * ПОЧЕМУ ИНСТАНСЫ — И ЗАГЛУШКАМ, И МОДЕЛЯМ
 *
 * Восемь одинаковых урн — это восемь матриц, а не восемь мешей: у макета
 * потолок в 128 объектов, и меш на объект означал бы сто двадцать восемь
 * вызовов отрисовки на кадр там, где хватает одного. Заглушки поэтому все до
 * одной живут в ОДНОМ `InstancedMesh` с единичной коробкой: размер объекта
 * уезжает в масштаб матрицы, цвет — в `instanceColor`. Подписи разделены по
 * типам, и только потому, что у каждого типа своя картинка с текстом; их
 * столько, сколько типов в макете, а не сколько объектов.
 *
 * С настоящими моделями правило то же, и стоило оно дороже. Модель — дерево из
 * нескольких мешей, и клон на предмет (как делает зал, где предмет один)
 * вернул бы счёт отрисовки в зависимость от количества: восемь автоматов по
 * четыре меша — тридцать два вызова. Поэтому дерево раскладывается на меши
 * (`interiorModelParts`), и на каждый меш заводится свой `InstancedMesh` с
 * копией на предмет. Счёт держится по ТИПАМ и деталям типа: двадцать предметов
 * и сто двадцать восемь тех же типов стоят одинаково.
 *
 * Движение мышью не пересобирает НИЧЕГО: протяжка пишет одну матрицу тела, одну
 * матрицу подписи, по одной матрице на деталь модели и одну строку в
 * `instanceColor`. Буферы пересобираются только когда меняется состав макета —
 * объект добавили, удалили или спрятали.
 */

import {
  createFloorPlan,
  layoutShape,
  normalizeLayout,
  worldPoint,
} from "./interior-layout.js";
import { interiorModelParts } from "./interior-models.js";

/*
 * Макет приподнят над полом на два сантиметра.
 *
 * У схематичного зала пол лежит на 0.01, у настоящего — на нуле. Объект,
 * поставленный ровно в ноль, у схемы наполовину тонет в полу, а обводка зоны
 * пропадает под ним целиком. Два сантиметра не видно глазом на объекте в метр
 * ростом и хватает, чтобы линия зоны не мерцала z-конфликтом.
 */
const FLOOR_LIFT = 0.02;
const ZONE_LIFT = 0.035;

/*
 * Подпись висит над объектом — но и «над», и её размер здесь ЭКРАННЫЕ, а не
 * мировые. Оба правила написаны по кадру, снятому со стенда.
 *
 * Мировое «над» работает только изнутри зала. Сверху взгляд идёт вдоль той же
 * вертикали, и подпись, поднятая по оси Y, ложится ровно на крышку объекта и
 * закрывает то, про что рассказывает: пиксель в центре автомата читался цветом
 * плашки, а не автомата. Поэтому подпись отодвигается по ВЕРХУ КАМЕРЫ — она и
 * так развёрнута к зрителю, и смещение вдоль его же «вверх» выглядит как «над
 * объектом» в любом ракурсе.
 *
 * Мировой размер даёт вторую беду: подпись у ближней урны вырастает во весь
 * кадр, а у дальней стены её не прочитать. Поэтому высота подписи задана долей
 * КАДРА и пересчитывается по расстоянию до камеры — так подпись остаётся
 * подписью, а не предметом в зале.
 */
const LABEL_SCREEN_SHARE = 0.045;
/* Пределы на случай, когда объект вплотную к камере или на другом конце зала:
   подпись не должна ни схлопнуться в точку, ни закрыть собой зал. */
const LABEL_MIN = 0.1;
const LABEL_MAX = 1.1;

/*
 * Цвета органов редактора заданы числами, а не палитрой `--astral-*`.
 *
 * Палитра живёт в CSS, а это WebGL: сюда её не дотянуть иначе как чтением
 * вычисленного стиля на каждый кадр. Приём тот же, что у торгового центра
 * (`mega-mall-scene.js`), и число выделения взято оттуда же — редактор
 * мастерской один, и «выбрано» в нём должно выглядеть одинаково.
 */
const SELECT_LINE = 0x66dcff;
const ZONE_LINE = 0x7f8794;
const GUARD_LINE = 0xe0a44a;
const ERROR_LINE = 0xff6a5c;

/* Подмес к цвету объекта, когда проверка на него ругается. Цвет типа при этом
   остаётся узнаваемым: полностью красный автомат перестаёт быть автоматом. */
const LEVEL_TINT = Object.freeze({ warn: 0xe0a44a, error: 0xff5145 });
const LEVEL_MIX = Object.freeze({ warn: 0.55, error: 0.72 });

/**
 * Подпись рисуется в холст один раз на тип объекта и делится всеми его копиями.
 *
 * `null` — честный ответ там, где двумерного контекста нет (jsdom, старый
 * вебвью): белый прямоугольник вместо подписи врал бы про объект больше, чем её
 * отсутствие.
 */
function labelTexture(THREE, text) {
  const canvas =
    typeof document === "undefined" ? null : document.createElement("canvas");
  let paint = null;
  try {
    paint = canvas?.getContext?.("2d") || null;
  } catch {
    /* jsdom не отдаёт контекст, а бросает: подписи в тесте просто нет. */
  }
  if (!paint) return null;

  const size = 34;
  paint.font = `600 ${size}px system-ui, sans-serif`;
  const measured = Number(paint.measureText(text)?.width) || text.length * 18;
  canvas.width = Math.max(64, Math.ceil(measured) + 28);
  canvas.height = 64;

  const draw = canvas.getContext("2d");
  draw.clearRect(0, 0, canvas.width, canvas.height);
  draw.fillStyle = "rgba(9, 11, 16, 0.82)";
  draw.fillRect(0, 0, canvas.width, canvas.height);
  draw.font = `600 ${size}px system-ui, sans-serif`;
  draw.fillStyle = "rgba(255, 255, 255, 0.94)";
  draw.textAlign = "center";
  draw.textBaseline = "middle";
  draw.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: canvas.width / canvas.height };
}

/**
 * Объём макета внутри чужой сцены.
 *
 * @param {object} options
 * @param {object} options.THREE Движок приходит из окна: своя копия означала бы
 *   второй `instanceof` глубоко внутри рендерера.
 * @param {object} options.root Группа сцены, в которую всё складывается.
 * @param {Function} [options.requestModel] `(archetype) => Promise<{model,status,reason}>`
 * @param {Function} [options.onModel] `({archetype, status, reason}) => void`
 *   — попытка достать настоящую модель объекта из игры.
 * @param {Function} [options.onChanged] Сцене надо попросить кадр, когда модель
 *   доехала сама по себе.
 */
export function createLayoutView({
  THREE,
  root,
  requestModel = null,
  onModel = null,
  onChanged = null,
}) {
  /* Единичная коробка на все заглушки разом: размер уезжает в масштаб матрицы,
     поэтому геометрия одна и вызов отрисовки один. */
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitEdges = new THREE.EdgesGeometry(unitBox);
  const labelPlane = new THREE.PlaneGeometry(1, 1);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.04,
  });
  const zoneMaterial = new THREE.LineBasicMaterial({
    color: ZONE_LINE,
    /* Обводка зоны — орган редактора, а не предмет в кадре: плёночная кривая
       окна опустила бы её в полдень вместе со всем остальным, и человек
       перестал бы видеть, где кончается то, что он правит. */
    toneMapped: false,
  });
  const guardMaterial = new THREE.LineBasicMaterial({
    color: GUARD_LINE,
    toneMapped: false,
  });
  const selectMaterial = new THREE.LineBasicMaterial({
    color: SELECT_LINE,
    toneMapped: false,
  });
  const ghostLineMaterial = new THREE.LineBasicMaterial({
    color: SELECT_LINE,
    toneMapped: false,
  });
  const ghostMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });

  /* Что заведено здесь и здесь же обязано освободиться. Геометрия и материалы
     моделей из игры сюда не попадают: они живут в разобранном оригинале из
     кэша `interior-models`, который переживает закрытие окна. */
  const owned = [
    unitBox,
    unitEdges,
    labelPlane,
    bodyMaterial,
    zoneMaterial,
    guardMaterial,
    selectMaterial,
    ghostLineMaterial,
    ghostMaterial,
  ];

  const group = new THREE.Group();
  group.name = "interior-layout";
  root.add(group);

  const selection = new THREE.LineSegments(unitEdges, selectMaterial);
  selection.name = "interior-selection";
  selection.renderOrder = 6;
  selection.visible = false;
  group.add(selection);

  const ghost = new THREE.Mesh(unitBox, ghostMaterial);
  ghost.name = "interior-ghost";
  ghost.visible = false;
  group.add(ghost);
  const ghostEdge = new THREE.LineSegments(unitEdges, ghostLineMaterial);
  ghostEdge.renderOrder = 6;
  ghostEdge.visible = false;
  group.add(ghostEdge);

  /* ---------- состав ---------- */

  let layout = normalizeLayout(null);
  let plan = null;
  let shape = "";
  let zoneSignature = "";
  let roomOutline = null;
  let guardOutline = null;
  /* Объект макета -> где он стоит и в каком инстансе живёт. */
  const placed = new Map();
  /* Тип объекта -> его подписи, порядок объектов и буферы настоящей модели. */
  const kinds = new Map();
  let props = new Map();
  let bodies = null;
  let bodyOrder = [];
  /* Разобранные подписи и модели переживают пересборку состава: текст на
     холсте и дерево мешей из игры не меняются оттого, что объект подвинули. */
  const labels = new Map();
  const models = new Map();
  const asked = new Set();
  /* Окно закрыли — приехавшую следом модель ставить некуда. Без этого флага
     `askModel` дописывал бы буферы в снятую со сцены группу и просил кадр у
     разобранного окна. */
  let disposed = false;

  const matrix = new THREE.Matrix4();
  /* Отдельные матрицы для настоящей модели: «где стоит предмет» и «где деталь
     внутри предмета» перемножаются, и общий черновик тут перетёрся бы. */
  const stand = new THREE.Matrix4();
  const part = new THREE.Matrix4();
  const spot = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const unit = new THREE.Vector3(1, 1, 1);
  const spin = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();
  const tint = new THREE.Color();
  /*
   * Цвет заглушки, разобранный один раз на тип.
   *
   * `Color.set("#8a8f98")` — это два регулярных выражения, разбор шестнадцатеричной
   * строки и перевод из sRGB в линейное пространство тремя возведениями в
   * степень. Он стоял в записи КАЖДОГО предмета: двести пятьдесят шесть
   * регулярных выражений и триста восемьдесят четыре возведения за один проход
   * по макету, ради пяти разных цветов.
   */
  const propColours = new Map();
  const facing = new THREE.Quaternion();
  /* «Вверх» глазами зрителя: по нему подпись отодвигается от объекта. */
  const facingUp = new THREE.Vector3(0, 1, 0);
  /* Где стоит глаз и во сколько метров на метр удаления обходится подпись —
     из них считается её экранный размер. */
  const eye = new THREE.Vector3();
  let labelUnit = LABEL_SCREEN_SHARE * 2 * Math.tan((26 * Math.PI) / 180);
  const facedAt = new THREE.Quaternion();
  /* Пока камера не приходила ни разу, сравнивать не с чем: свежий кватернион
     означал бы «повёрнут в ноль», а это законное положение камеры. */
  let faced = false;

  const radians = (yaw) => (yaw * Math.PI) / 180;

  function propColour(prop) {
    let known = propColours.get(prop.id);
    if (!known) {
      known = new THREE.Color(prop.colour);
      propColours.set(prop.id, known);
    }
    return known;
  }

  /* ---------- матрицы одного объекта ---------- */

  function writeEntity(entity) {
    const record = placed.get(entity.id);
    const prop = props.get(entity.propId);
    if (!record || !prop) return;

    const kind = kinds.get(entity.propId);
    const real = Boolean(kind?.instances.length);
    /*
     * Тот же предмет на том же месте — писать нечего.
     *
     * Раньше любая правка, приехавшая из React, переписывала матрицы, цвета и
     * подписи всех ста двадцати восьми предметов — в том числе смена
     * выбранного, где двигается одна проволочная рамка. Отпечаток стоит шесть
     * сравнений, а спасает от полутора сотен матриц и полной перезаливки
     * буферов в видеопамять.
     *
     * `real` в отпечатке потому, что приехавшая модель схлопывает коробку в
     * точку: числа предмета при этом те же, а писать надо заново.
     */
    if (
      record.x === entity.x &&
      record.y === entity.y &&
      record.z === entity.z &&
      record.yaw === entity.yaw &&
      record.level === entity.level &&
      record.real === real
    )
      return;
    record.x = entity.x;
    record.y = entity.y;
    record.z = entity.z;
    record.yaw = entity.yaw;
    record.level = entity.level;
    record.real = real;

    const [x, z] = worldPoint(plan, entity.x, entity.y);
    if (bodies) {
      spot.set(x, FLOOR_LIFT + entity.z + prop.height / 2, z);
      spin.setFromAxisAngle(axis, radians(entity.yaw));
      /* Приехала настоящая модель — коробка схлопывается в точку. Убрать её
         из буфера нельзя (размер задан при создании), а оставить в размере
         значит поставить заглушку поверх того, что она заменяла. */
      if (real) scale.set(0, 0, 0);
      else scale.set(prop.width, prop.height, prop.depth);
      bodies.setMatrixAt(record.bodyIndex, matrix.compose(spot, spin, scale));
      bodies.instanceMatrix.needsUpdate = true;
      /*
       * Сфера буфера кэшируется и устаревает от первой же протяжки: по ней
       * рендерер отсекает буфер за краем кадра, а луч решает, искать ли в нём
       * копию. У настоящих моделей она сбрасывалась (writeModel), а у коробок
       * нет — предмет, утащенный за прежние пределы, переставал и рисоваться, и
       * попадаться под указатель.
       */
      bodies.boundingSphere = null;

      colour.copy(propColour(prop));
      const mix = LEVEL_MIX[entity.level];
      if (mix) colour.lerp(tint.set(LEVEL_TINT[entity.level]), mix);
      bodies.setColorAt(record.bodyIndex, colour);
      if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    }

    /* Якорь подписи — середина объекта; насколько её отодвинуть и какого она
       размера, знает камера. */
    record.anchor.set(x, FLOOR_LIFT + entity.z + prop.height / 2, z);
    record.halfHeight = prop.height / 2;
    writeLabel(entity.propId, record);
    writeModel(kind, record, entity, prop, x, z);
  }

  /**
   * Одна копия настоящей модели — это по матрице на каждую её деталь.
   *
   * Начало координат у модели своё: у автомата оно в середине, у урны почти на
   * дне. Поэтому предмет ставится не низом коробки, а `floorOffset` — числом из
   * реестра, которое и говорит, насколько начало модели ниже её низа.
   */
  function writeModel(kind, record, entity, prop, x, z) {
    if (!kind?.instances.length || record.kindIndex < 0) return;
    spot.set(x, FLOOR_LIFT + entity.z + prop.floorOffset, z);
    spin.setFromAxisAngle(axis, radians(entity.yaw));
    stand.compose(spot, spin, unit);
    for (const mesh of kind.instances) {
      /* Место детали идёт справа: сперва она встаёт на своё место внутри
         модели, и только потом модель целиком — в зал. */
      mesh.setMatrixAt(
        record.kindIndex,
        part.multiplyMatrices(stand, mesh.userData.offset),
      );
      mesh.instanceMatrix.needsUpdate = true;
      /* Сфера буфера считается по матрицам и КЭШИРУЕТСЯ: по ней рендерер
         отсекает буфер за краем кадра, а луч — решает, стоит ли вообще искать
         копию. Не сбросив её, предмет, утащенный мышью за прежние пределы,
         перестаёт и рисоваться, и попадаться под указатель. */
      mesh.boundingSphere = null;
    }
  }

  /**
   * Подпись смотрит на камеру и держит её же размер на экране, поэтому её
   * матрица собирается отдельно от матрицы объекта.
   */
  function writeLabel(propId, record) {
    const kind = kinds.get(propId);
    if (!kind?.labels || record.labelIndex < 0) return;
    const reach = eye.distanceTo(record.anchor);
    const height = Math.min(Math.max(reach * labelUnit, LABEL_MIN), LABEL_MAX);
    scale.set(height * kind.labelAspect, height, 1);
    spot
      .copy(record.anchor)
      .addScaledVector(facingUp, record.halfHeight + height * 0.9);
    kind.labels.setMatrixAt(
      record.labelIndex,
      matrix.compose(spot, facing, scale),
    );
    kind.labels.instanceMatrix.needsUpdate = true;
  }

  /* ---------- сборка состава ---------- */

  function dropInstances() {
    if (bodies) {
      group.remove(bodies);
      bodies.dispose();
      bodies = null;
    }
    bodyOrder = [];
    for (const kind of kinds.values()) {
      if (kind.labels) {
        group.remove(kind.labels);
        /* Материал заводится на пересборку, картинка — нет: холст с текстом
           живёт в `labels` и переживает добавление соседнего объекта. */
        kind.labels.material.dispose();
        kind.labels.dispose();
      }
      for (const mesh of kind.instances) {
        group.remove(mesh);
        /* Освобождается только буфер матриц самого экземпляра: геометрия и
           материал принадлежат разобранной модели в кэше и переживут окно. */
        mesh.dispose();
      }
      kind.instances.length = 0;
    }
    kinds.clear();
    placed.clear();
  }

  /**
   * Пересобрать буферы под новый состав макета.
   *
   * Зовётся только когда состав ИЗМЕНИЛСЯ: у `InstancedMesh` размер буфера
   * задан при создании, и добавленный объект иначе некуда положить. Протяжка
   * мышью сюда не заходит — она пишет матрицу уже собранного инстанса.
   */
  function rebuild() {
    dropInstances();
    const visible = layout.entities.filter((entity) => !entity.hidden);
    if (!visible.length) return;

    bodyOrder = visible.map((entity) => entity.id);
    bodies = new THREE.InstancedMesh(unitBox, bodyMaterial, visible.length);
    bodies.name = "interior-props";
    bodies.castShadow = true;
    bodies.receiveShadow = true;
    /* Матрицы пишутся руками на каждое движение — пусть three не считает
       буфер неизменным. */
    bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(bodies);

    const counts = new Map();
    for (const entity of visible) {
      counts.set(entity.propId, (counts.get(entity.propId) || 0) + 1);
    }

    for (const [propId, count] of counts) {
      const prop = props.get(propId);
      const kind = { prop, labels: null, order: [], instances: [] };
      kinds.set(propId, kind);
      if (prop?.archetype) askModel(prop.archetype);

      if (!labels.has(propId) && prop) {
        labels.set(propId, labelTexture(THREE, prop.label));
      }
      const label = labels.get(propId);
      if (!label) continue;

      kind.labels = new THREE.InstancedMesh(
        labelPlane,
        new THREE.MeshBasicMaterial({
          map: label.texture,
          transparent: true,
          depthWrite: false,
          /* Подпись — тоже орган редактора: её видно в любой час. */
          toneMapped: false,
        }),
        count,
      );
      kind.labels.name = `interior-label-${propId}`;
      kind.labels.renderOrder = 7;
      kind.labels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      kind.labelAspect = label.aspect;
      group.add(kind.labels);
    }

    visible.forEach((entity, index) => {
      const kind = kinds.get(entity.propId);
      /* Номер внутри типа — общий для подписи и для настоящей модели, но
         подписи может не быть вовсе (нет двумерного контекста), а модель при
         этом есть. Поэтому номера два, и второй не равен первому. */
      const kindIndex = kind ? kind.order.length : -1;
      placed.set(entity.id, {
        bodyIndex: index,
        kindIndex,
        labelIndex: kind?.labels ? kindIndex : -1,
        anchor: new THREE.Vector3(),
        halfHeight: 0,
      });
      kind?.order.push(entity.id);
    });

    applyModels();
    for (const entity of visible) writeEntity(entity);
  }

  /* ---------- настоящие модели ---------- */

  function askModel(archetype) {
    if (!requestModel || asked.has(archetype)) return;
    asked.add(archetype);
    void Promise.resolve(requestModel(archetype))
      .then((answer) => {
        /* Ответ приходит либо от загрузчика (`{model, status, reason}`), либо
           голой группой: стенд и проверки поднимают вид со своим загрузчиком, и
           требовать от них обёртку значило бы усложнить каждый вызов ради одной
           строки здесь. */
        const model = answer?.isObject3D ? answer : answer?.model || null;
        if (disposed) return;
        if (!model) {
          /*
           * Заказ снимается: игру подключают уже при открытом редакторе, и тип,
           * запертый одной неудачей, остался бы коробкой навсегда. Причина
           * уходит наверх — кадр обязан сказать, почему предмет не тот.
           */
          asked.delete(archetype);
          onModel?.({
            archetype,
            status: "missing",
            reason: answer?.reason || "",
          });
          return;
        }
        models.set(archetype, model);
        applyModels();
        for (const entity of layout.entities) writeEntity(entity);
        onModel?.({ archetype, status: "ready", reason: "" });
        onChanged?.();
      })
      .catch((error) => {
        asked.delete(archetype);
        onModel?.({
          archetype,
          status: "missing",
          reason: String(error?.message || error),
        });
      });
  }

  /**
   * Спросить игру про типы, которые остались коробками.
   *
   * Игру подключают уже при открытом редакторе, а состав макета при этом может
   * не меняться неделю: без отдельного повтора предметы остались бы заглушками
   * до пересборки сцены. Тип, вопрос по которому ещё в пути, вторым запросом не
   * дублируется — `askModel` держит счёт заказанного.
   */
  function retryModels() {
    /* По типам, которые в кадре есть, а не по всему каталогу: спрашивать игру
       про пять моделей ради одной поставленной урны — это пять распаковок
       архива на ровном месте. */
    for (const kind of kinds.values()) {
      const archetype = kind.prop?.archetype;
      if (archetype && !models.has(archetype)) askModel(archetype);
    }
  }

  /**
   * Модель из игры вместо заглушки.
   *
   * По `InstancedMesh` на каждую деталь модели и по копии в нём на каждый
   * предмет этого типа. Клон на предмет был бы короче, но вернул бы счёт
   * отрисовки в зависимость от количества предметов — ровно то, ради чего
   * заглушки и живут одним буфером.
   */
  function applyModels() {
    let anyPlaceholder = false;
    for (const kind of kinds.values()) {
      if (kind.instances.length) continue;
      const model = kind.prop?.archetype
        ? models.get(kind.prop.archetype)
        : null;
      const parts = interiorModelParts(model);
      if (!parts.length) {
        /* Модели нет или в ней нечего рисовать — тип остаётся коробкой. */
        anyPlaceholder = true;
        continue;
      }
      for (const piece of parts) {
        const mesh = new THREE.InstancedMesh(
          piece.geometry,
          piece.material,
          kind.order.length,
        );
        mesh.name = `interior-model-${kind.prop.id}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        /* Место детали внутри модели и порядок предметов этого типа: первое
           нужно каждой матрице, второе — попаданию указателя. */
        mesh.userData.offset = piece.offset;
        mesh.userData.order = kind.order;
        group.add(mesh);
        kind.instances.push(mesh);
      }
      /* Заглушка и подпись под настоящей моделью не нужны: они и заводились
         затем, чтобы объяснить объект, у которого модели нет. */
      if (kind.labels) kind.labels.visible = false;
    }
    /* Коробки остаются в кадре, пока хоть у одного типа модели нет: буфер
       общий на все типы, и разделить его значило бы платить вызовом отрисовки
       за каждый тип. Инстансы тех, чья модель приехала, схлопнуты в точку —
       см. `writeEntity`. */
    if (bodies) bodies.visible = anyPlaceholder;
  }

  /* ---------- зона макета ---------- */

  function rectSegments(points, minX, maxX, minY, maxY) {
    const corners = [
      worldPoint(plan, minX, minY),
      worldPoint(plan, maxX, minY),
      worldPoint(plan, maxX, maxY),
      worldPoint(plan, minX, maxY),
    ];
    for (let index = 0; index < 4; index += 1) {
      const from = corners[index];
      const to = corners[(index + 1) % 4];
      points.push(from[0], ZONE_LIFT, from[1], to[0], ZONE_LIFT, to[1]);
    }
  }

  function line(points, material, name) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points, 3),
    );
    const segments = new THREE.LineSegments(geometry, material);
    segments.name = name;
    segments.renderOrder = 5;
    group.add(segments);
    return segments;
  }

  function rebuildZone() {
    for (const drawn of [roomOutline, guardOutline]) {
      if (!drawn) continue;
      group.remove(drawn);
      drawn.geometry.dispose();
    }
    roomOutline = null;
    guardOutline = null;
    if (!plan) return;

    const room = [];
    rectSegments(room, plan.minX, plan.maxX, plan.minY, plan.maxY);
    roomOutline = line(room, zoneMaterial, "interior-zone");

    const guards = [];
    for (const zone of layout.zones) {
      rectSegments(guards, zone.minX, zone.maxX, zone.minY, zone.maxY);
    }
    if (guards.length) {
      guardOutline = line(guards, guardMaterial, "interior-guard-zones");
    }
  }

  /* ---------- выделение ---------- */

  function applySelection() {
    const entity = layout.entities.find(
      (item) => item.id === layout.selectedId && !item.hidden,
    );
    const prop = entity ? props.get(entity.propId) : null;
    if (!entity || !prop) {
      selection.visible = false;
      return;
    }
    const [x, z] = worldPoint(plan, entity.x, entity.y);
    selection.visible = true;
    selection.position.set(x, FLOOR_LIFT + entity.z + prop.height / 2, z);
    selection.rotation.y = radians(entity.yaw);
    /* Рамка чуть больше объекта: совпав с ним гранью, она тонет в его же
       поверхности и читается как шов, а не как выделение. */
    selection.scale.set(
      prop.width + 0.08,
      prop.height + 0.08,
      prop.depth + 0.08,
    );
  }

  return {
    /** Спросить игру про типы, оставшиеся коробками. */
    retryModels,
    /** Новый состав макета: буферы пересобираются, только если состав изменился. */
    setLayout(next) {
      layout = normalizeLayout(next);
      props = new Map(layout.props.map((prop) => [prop.id, prop]));
      plan = createFloorPlan(layout.room);

      const zones = JSON.stringify([layout.room, layout.zones]);
      if (zones !== zoneSignature) {
        zoneSignature = zones;
        rebuildZone();
        /*
         * Комната поехала — а с ней и середина, от которой считается место
         * предмета в зале. Числа предметов при этом те же, и отпечаток
         * пропустил бы запись: NaN не равен сам себе и заставляет переписать
         * всё заново.
         */
        for (const record of placed.values()) record.yaw = NaN;
      }

      const nextShape = layoutShape(layout);
      if (nextShape !== shape) {
        shape = nextShape;
        rebuild();
      } else {
        for (const entity of layout.entities) writeEntity(entity);
        /* Состав тот же, а игра могла появиться: пересборка буферов —
           единственное место, где типы спрашивают, и без этого повтора правка
           уже стоящего макета никогда не подтянула бы модели. */
        retryModels();
      }
      applySelection();
    },

    /** Куда встанет объект, который сейчас ставят. `null` — приманки нет. */
    setGhost(next) {
      const prop = next ? props.get(next.propId) : null;
      if (!prop) {
        ghost.visible = false;
        ghostEdge.visible = false;
        return;
      }
      const [x, z] = worldPoint(plan, next.x, next.y);
      ghost.position.set(x, FLOOR_LIFT + prop.height / 2, z);
      ghost.rotation.y = radians(next.yaw || 0);
      ghost.scale.set(prop.width, prop.height, prop.depth);
      ghostEdge.position.copy(ghost.position);
      ghostEdge.rotation.copy(ghost.rotation);
      ghostEdge.scale.copy(ghost.scale);
      colour.set(prop.colour);
      const mix = LEVEL_MIX[next.level];
      if (mix) colour.lerp(tint.set(LEVEL_TINT[next.level]), mix);
      ghostMaterial.color.copy(colour);
      ghostLineMaterial.color.setHex(
        next.level === "error" ? ERROR_LINE : SELECT_LINE,
      );
      ghost.visible = true;
      ghostEdge.visible = true;
    },

    /**
     * Подвинуть один объект — без пересборки чего бы то ни было.
     *
     * Ровно то, что зовётся на каждое движение мыши: две матрицы и один цвет.
     */
    moveEntity(id, patch = {}) {
      const entity = layout.entities.find((item) => item.id === id);
      if (!entity) return;
      if (Number.isFinite(patch.x)) entity.x = patch.x;
      if (Number.isFinite(patch.y)) entity.y = patch.y;
      if (Number.isFinite(patch.yaw)) entity.yaw = patch.yaw;
      if (patch.level) entity.level = patch.level;
      writeEntity(entity);
      if (layout.selectedId === id) applySelection();
    },

    /** Обводка зоны краснеет, когда объект из неё вышел. */
    markZone(level) {
      zoneMaterial.color.setHex(level === "error" ? ERROR_LINE : ZONE_LINE);
    },

    /**
     * Что под указателем: идентификатор объекта или `null`.
     *
     * Спуска по детям нет намеренно: и заглушки, и настоящие модели — плоские
     * буферы экземпляров, и номер копии в буфере прямо называет объект.
     */
    hitTest(raycaster) {
      const targets = [];
      if (bodies?.visible) targets.push(bodies);
      for (const kind of kinds.values()) targets.push(...kind.instances);
      if (!targets.length) return null;
      for (const hit of raycaster.intersectObjects(targets, false)) {
        if (!Number.isInteger(hit.instanceId)) continue;
        const order =
          hit.object === bodies ? bodyOrder : hit.object.userData.order;
        const id = order?.[hit.instanceId];
        if (id) return id;
      }
      return null;
    },

    /**
     * Развернуть подписи к камере.
     *
     * Полный разворот, а не только по горизонту: сверху зал смотрят чаще, чем
     * изнутри, и подпись, повёрнутая одним лишь рысканием, в этом ракурсе видна
     * с торца — то есть не видна вовсе.
     *
     * Кадр без движения камеры сюда не заходит: сравнение с прошлым разворотом
     * стоит одного скалярного произведения, а перезапись матриц — по строке на
     * каждый объект.
     */
    billboard(camera) {
      if (!camera || !kinds.size) return false;
      /* Сравнивается и поворот, и место: поворот меняется от протяжки орбитой,
         а место — от колеса, и от места зависит экранный размер подписи. */
      if (
        faced &&
        facedAt.angleTo(camera.quaternion) < 0.002 &&
        eye.distanceToSquared(camera.position) < 0.0004
      ) {
        return false;
      }
      faced = true;
      facing.copy(camera.quaternion);
      /* Копия в заведённый заранее кватернион, а не новый на каждый сдвинутый
         кадр: за секунду орбиты это шестьдесят объектов на ровном месте. */
      facedAt.copy(camera.quaternion);
      facingUp.set(0, 1, 0).applyQuaternion(facing);
      eye.copy(camera.position);
      if (Number.isFinite(camera.fov)) {
        labelUnit =
          LABEL_SCREEN_SHARE * 2 * Math.tan((camera.fov * Math.PI) / 360);
      }
      for (const [propId, kind] of kinds) {
        if (!kind.labels?.visible) continue;
        for (const id of kind.order) {
          const record = placed.get(id);
          if (record) writeLabel(propId, record);
        }
      }
      return true;
    },

    dispose() {
      disposed = true;
      dropInstances();
      for (const drawn of [roomOutline, guardOutline]) {
        if (!drawn) continue;
        group.remove(drawn);
        drawn.geometry.dispose();
      }
      roomOutline = null;
      guardOutline = null;
      for (const label of labels.values()) label?.texture?.dispose?.();
      labels.clear();
      models.clear();
      asked.clear();
      for (const item of owned) item?.dispose?.();
      owned.length = 0;
      root.remove(group);
    },

    /* ---- то, что знает про макет: для тестов и отладки со стенда ---- */

    get group() {
      return group;
    },
    /**
     * Сколько объектов сцены рисует макет.
     *
     * Ровно столько вызовов отрисовки он и стоит: у инстансов вызов один на
     * буфер, сколько бы копий в нём ни лежало. У настоящей модели буферов
     * столько, сколько в ней деталей, — но и это число от количества
     * расставленных предметов не зависит.
     */
    get drawCount() {
      let count = 0;
      if (roomOutline) count += 1;
      if (guardOutline) count += 1;
      if (bodies?.visible) count += 1;
      for (const kind of kinds.values()) {
        if (kind.labels?.visible) count += 1;
        count += kind.instances.length;
      }
      if (selection.visible) count += 1;
      if (ghost.visible) count += 2;
      return count;
    },
    get instanceCount() {
      return bodies ? bodies.count : 0;
    },
  };
}
