/*
 * Двойники сторон прозрачного двустороннего материала (опыт `side-twins`, 16.11.2026; находка профиля щелчков «Ангар, отделка, сегмент» и «Завод, облик, сегмент»).
 *
 * Прозрачный материал с `side === DoubleSide` three рисует двумя проходами (`WebGLRenderer.js: renderObject`): `material.side = BackSide; material.needsUpdate = true; renderBufferDirect(…)`, затем то же
 * с `FrontSide`. Каждый `needsUpdate` поднимает `material.version`, и на каждом объекте в каждой отрисовке three заново подбирает программу (`getParameters`, ключ, сброс списка uniform-ов) и меняет
 * программу между проходами. У ангара это 68 подборов на отрисовку при неизменной сцене (30 материалов), у завода — 20: четверть времени отрисовки в профиле щелчков. Прозрачные сетки в пачки не склеиваются,
 * поэтому таких объектов много.
 *
 * Здесь те же два прохода без счётчика версий: у материала два «двойника» — живые виды оригинала (`Object.create`), каждый со своей стороной. Всё остальное (цвет, прозрачность, define-ы, карты, окружение, `onBeforeCompile`)
 * двойник читает у оригинала в момент обращения; `version` — тоже оригинала, поэтому настоящая правка (приём облика, мягкий край) пересобирает программы двойников, а переключение стороны — нет. Программы у двойника те
 * же, что у родного прохода (ключ программы считается по стороне и define-ам), uniform-ы перекраски — те же объекты `{ value }` из `userData.recolour`, что `onBeforeCompile` кладёт в каждую сборку: ни «последнего
 * shader», ни копий значений нигде не запоминается.
 *
 * Включается опытом: `installSideTwins(renderer)` оборачивает `renderer.renderBufferDirect` (three зовёт его как `_this.renderBufferDirect`), `adoptSideTwins(material)` ставит материалу `forceSinglePass = true`
 * (three двухпроходную ветку пропускает) и метку. Обёртка делает те же два вызова в том же порядке — сначала обратные грани, потом лицевые, — когда материал помечен, прозрачен и двусторонний; иначе — прежний вызов.
 * В сцене, выбор лучом, тенях и мягком крае ничего не меняется: объекты, `object.material`, `material.side` оригинала те же.
 *
 * Чистый модуль: three и больше ничего.
 */
import { DoubleSide, FrontSide, BackSide, MathUtils } from "three";

const pairs = new WeakMap();
const wrapped = new WeakSet();
let serial = 2_000_000_000;

/** Живой вид материала на одной стороне: всё читается у оригинала, свои — сторона, номер, uuid, слушатели; версию отдаёт оригинал. */
function viewOf(material, side) {
  const twin = Object.create(material);
  Object.defineProperties(twin, {
    side: { value: side, writable: true, enumerable: true, configurable: true },
    id: { value: (serial += 1), writable: true, configurable: true },
    uuid: { value: MathUtils.generateUUID(), writable: true, configurable: true },
    version: { get: () => material.version, set() {}, enumerable: true, configurable: true },
    _listeners: { value: undefined, writable: true, configurable: true },
  });
  return twin;
}

/** Двойники материала: `{ back, front }`; создаются при первом обращении, уходят вместе с материалом (`dispose`). */
export function sideTwinsOf(material) {
  let pair = pairs.get(material);
  if (!pair) {
    pair = { back: viewOf(material, BackSide), front: viewOf(material, FrontSide) };
    pairs.set(material, pair);
    const release = () => {
      material.removeEventListener("dispose", release);
      pairs.delete(material);
      pair.back.dispose();
      pair.front.dispose();
    };
    material.addEventListener("dispose", release);
  }
  return pair;
}

/** Есть ли двойники у материала (тест и учёт). */
export const hasSideTwins = (material) => pairs.has(material);

/**
 * Материал идёт на двойников: двусторонний получает метку и `forceSinglePass = true`. Возвращает, взят ли он.
 * Материал, что с рождения рисуется одним проходом (`forceSinglePass`: наклейка, `recolor-material.js`, 16.11.2026 — задняя грань закрыта самой стеной, второй проход картинку не меняет), не берётся: двойники
 * вернули бы ему два вызова вместо одного. Стёклам и корпусам с прозрачными стенками, у которых `forceSinglePass` ложен, по-прежнему два двойника.
 */
export function adoptSideTwins(material) {
  if (!material || material.side !== DoubleSide) return false;
  if (material.userData.rcSideTwins === true) return true;
  if (material.forceSinglePass === true) return false;
  material.userData.rcSideTwins = true;
  material.forceSinglePass = true;
  return true;
}

/** Рисуется ли материал двумя проходами по двойникам прямо сейчас. */
const twinned = (material) => material.userData?.rcSideTwins === true && material.transparent === true && material.side === DoubleSide;

/** Оборачивает `renderer.renderBufferDirect` один раз на рендерер. Возвращает, поставлена ли обёртка. */
export function installSideTwins(renderer) {
  if (wrapped.has(renderer) || typeof renderer?.renderBufferDirect !== "function") return false;
  wrapped.add(renderer);
  const direct = renderer.renderBufferDirect;
  renderer.renderBufferDirect = function sideTwinsDirect(camera, scene, geometry, material, object, group) {
    if (twinned(material)) {
      const pair = sideTwinsOf(material);
      direct.call(this, camera, scene, geometry, pair.back, object, group);
      return direct.call(this, camera, scene, geometry, pair.front, object, group);
    }
    return direct.call(this, camera, scene, geometry, material, object, group);
  };
  return true;
}

/**
 * Прогрев: к объектам с материалом на двойниках добавляются те же объекты с материалом-двойником (вид `Object.create`: геометрия, флаги копий и тени — объекта), чтобы `renderer.compile` собрал
 * обе стороны заранее, как собирал их родной двухпроходный прогрев. Нет таких объектов — тот же список.
 */
export function withSideTwins(objects) {
  const extra = [];
  for (const object of objects) {
    const material = object.material;
    if (Array.isArray(material) || !material || !twinned(material)) continue;
    const pair = sideTwinsOf(material);
    for (const twin of [pair.back, pair.front]) extra.push(Object.create(object, { material: { value: twin, writable: true, enumerable: true, configurable: true } }));
  }
  return extra.length ? [...objects, ...extra] : objects;
}
