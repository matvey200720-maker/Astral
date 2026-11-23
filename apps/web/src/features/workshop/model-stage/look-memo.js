/*
 * Что кадр уже поставил материалу: ползунок трогает только изменённые материалы (14.11.2026, «Astral быстрее»).
 *
 * Редактор отдаёт кадру функцию `look(index, info)`, и каждый тик ползунка — новая функция: `setLook` без списка проходил по ВСЕМ материалам сцены
 * и для каждого заново собирал листы, свойства шейдера и отражение (сотни материалов у зала, тысячи у зоны). Правка ползунка, как правило, меняет
 * облик нескольких материалов. Здесь кадр запоминает, с каким обликом материал поставлен в последний раз, и при правке пропускает те, у кого облик
 * тот же и вокруг ничего не изменилось. Вокруг — это то, от чего зависит результат `apply`, кроме самого облика (проверено по `applyRecolourLook`,
 * `roomReflection` и по всем, кто пишет в материалы кадра):
 *   • `epoch` — сколько листов пришло и сколько ушло (пришёл или ушёл лист — материалы, что на него смотрят, ставятся заново; пачка листов называет их
 *     поимённо; от листа зависят карта, нормали, блеск, отделка, слои земли, средний цвет `fallback` и замена листа другого размера);
 *   • `env` — снимок зала (отражение): появился или ушёл — отражение материалов считается заново.
 * Остальное определяется обликом: цвет, прозрачность, видимость, набор приёмов шейдера. Качество, «внутри/снаружи», комнаты, спрятанные вещи и копии моделей
 * материал не меняют — это другие материалы (сцена, комната и копия строят свои, записи ключуются самим материалом) или сетки (видимость сеток), а «Ламберт» тяжёлой
 * сцены задан при создании материала. Поставить тот же облик ещё раз — значит записать те же числа.
 *
 * Отпечаток для памяти строже отпечатка для вспышки правки (`look-signature.js`, `settleLooks` его и держит): тот гасит функции в пустую строку, а холст,
 * `ImageBitmap`, `Map` и любой объект без своих ключей — в «{}», то есть два разных холста равны. Для вспышки это безвредно, для пропуска `apply` — устаревшая
 * картинка. Здесь по значению сравнивается только то, что читается по значению: числа, строки, простые объекты, массивы, `Texture` (по `uuid`: сам лист шейдер
 * берёт по ссылке), `Color`, `Matrix4` и векторы; всё остальное, и функции, — по тождеству объекта.
 *
 * Чистый модуль без DOM: его читает `orbit-stage.js`, а тест гоняет на подставных материалах.
 */

/* Номер объекта: два разных объекта (холст, функция, `Map`) никогда не дают один отпечаток, один и тот же — всегда один. */
const ids = new WeakMap();
let lastId = 0;
function identityOf(object) {
  let id = ids.get(object);
  if (id === undefined) {
    lastId += 1;
    id = lastId;
    ids.set(object, id);
  }
  return id;
}

const plain = (value) => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Отпечаток облика для памяти: равные отпечатки — гарантированно равный облик. Бросает на петле ссылок (`signatureOf` ловит). */
export function memoSignature(value) {
  switch (typeof value) {
    case "undefined":
      return "u";
    case "string":
      return `s${JSON.stringify(value)}`;
    case "number":
      return `n${Object.is(value, -0) ? "-0" : value}`;
    case "boolean":
      return value ? "b1" : "b0";
    case "bigint":
      return `i${value}`;
    case "function":
      return `f${identityOf(value)}`;
    case "symbol":
      return `y${String(value)}`;
    default:
      break;
  }
  if (value === null) return "N";
  if (value.isTexture) return `t${value.uuid}`;
  if (value.isColor) return `c${value.getHexString()}`;
  if (value.isMatrix4 || value.isMatrix3) return `m${value.elements.join()}`;
  if (value.isVector2 || value.isVector3 || value.isVector4 || value.isQuaternion || value.isEuler) return `v${value.toArray().join()}`;
  if (Array.isArray(value)) return `[${value.map(memoSignature).join(",")}]`;
  if (!plain(value)) return `o${identityOf(value)}`;
  let out = "{";
  for (const key of Object.keys(value)) out += `${JSON.stringify(key)}:${memoSignature(value[key])};`;
  return `${out}}`;
}

/** Отпечаток облика материала; `null` — отпечаток снять не вышло (тогда материал всегда ставится заново). */
export function signatureOf(next) {
  try {
    return memoSignature(next);
  } catch {
    return null;
  }
}

/**
 * Один материал при правке: `apply()` ставит облик и возвращает, просит ли он отражение зала. При `diff` облик, что уже стоит (та же запись, то же
 * окружение), пропускается (`onKept(запись)`); любой проход запоминает, что поставил. `true` — материал поставлен, `false` — пропущен.
 */
export function applyWithMemo(memo, { material, next, state, diff = false, apply, onKept }) {
  const signature = signatureOf(next);
  if (diff) {
    const kept = memo.kept(material, signature, state);
    if (kept) {
      onKept?.(kept);
      return false;
    }
  }
  memo.remember(material, signature, state, apply());
  return true;
}

export function createLookMemo() {
  /* Ключ — сам материал: ушла сцена, ушли и записи; вернулась из кэша — материалы те же, и записи на месте. */
  const records = new WeakMap();
  return {
    /** Запись о материале, если его ставили с тем же обликом при том же окружении (`state: { epoch, env }`); иначе `null`. */
    kept(material, signature, state) {
      if (signature === null) return null;
      const record = records.get(material);
      if (!record || record.signature !== signature) return null;
      return record.epoch === state.epoch && record.env === state.env ? record : null;
    },
    /** Материал поставлен с этим обликом; `wants` — просит ли его облик отражение зала. */
    remember(material, signature, state, wants) {
      if (signature === null) records.delete(material);
      else records.set(material, { signature, epoch: state.epoch, env: state.env, wants: Boolean(wants) });
    },
    forget(material) {
      records.delete(material);
    },
  };
}
