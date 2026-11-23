/*
 * Уточнение спорных находок по содержимому файла.
 *
 * Один маршрут в игре принадлежит нескольким категориям каталога, и по имени
 * файла их не разделить. Самый частый случай —
 * `common/data/timecycle/timecycle_mods_*.xml`: в нём лежат все модификаторы
 * сразу, и таймцикл, килл-эффект и «убрать эффект алкоголя» правят каждый свои
 * строки одного и того же файла.
 *
 * Гадать здесь нельзя, а сдаваться незачем: что именно тронуто, видно внутри.
 * Разбираются старая и новая версия файла, сравниваются модификаторы по имени,
 * и находка достаётся тому, чьи строки действительно изменились.
 *
 * Второе и более важное, что видно только внутри, — **частичный файл**. Авторы
 * редуксов часто кладут не весь `timecycle_mods_4.xml`, а огрызок из двенадцати
 * нужных им модификаторов вместо трёхсот игровых. Поставить такой файл заменой
 * значит стереть у игрока остальные двести восемьдесят три: пропадут переходы
 * между персонажами, интерьеры, кинотеатр. Разбор обязан это заметить и
 * предложить не замену, а слой по именам модификаторов — тот самый
 * `timecycle-modifier-v1`, которым приложение ставит собственные пакеты.
 *
 * Разбор XML сюда не втащен: он живёт в установщике, и второй его экземпляр
 * разошёлся бы с первым. Функции принимают уже разобранные документы.
 */

import { getLegacyModTarget } from "@modovik/mod-targets";

/**
 * Наборы модификаторов, которые категория объявляет своими.
 *
 * У категории с опциями набор не один: «оптимизация» — это восемь независимых
 * переключателей, и у каждого свой слот в каталоге. Поэтому возвращается не
 * одно множество на категорию, а по множеству на опцию: иначе восемь разных
 * модов слиплись бы в один.
 */
function ownerSets(id) {
  const definition = getLegacyModTarget(id);
  const names = (items) => {
    const set = new Set();
    for (const item of items || [])
      for (const name of item.merge?.includeNames || [])
        set.add(name.toLowerCase());
    return set;
  };
  const sets = [{ id, option: null, names: names(definition?.targets) }];
  for (const [option, items] of Object.entries(definition?.options || {})) {
    const set = names(items);
    if (set.size) sets.push({ id, option, names: set });
  }
  return sets;
}

/** Приоритет слоя категории — из той же таблицы, что и у собственных пакетов. */
function layerPriority(id) {
  const definition = getLegacyModTarget(id);
  const fromTargets = definition?.targets?.find(
    (item) => item.merge?.strategy === "timecycle-modifier-v1",
  )?.merge?.priority;
  if (fromTargets) return fromTargets;
  for (const items of Object.values(definition?.options || {}))
    for (const item of items)
      if (item.merge?.priority) return item.merge.priority;
  return 100;
}

/**
 * Что стало с модификаторами между двумя версиями файла.
 *
 * Разделять «изменён» и «пропал» обязательно: у полного файла редукса правки
 * это `edited`, у огрызка — двести восемьдесят три `removed`, и это две разные
 * истории, которые нельзя складывать в одно число «тронуто».
 */
export function diffModifiers(before, after) {
  const previous = new Map(
    (before?.modifiers || []).map((item) => [
      item.name.toLowerCase(),
      JSON.stringify(item.fields),
    ]),
  );
  const added = [];
  const edited = [];
  for (const modifier of after?.modifiers || []) {
    const name = modifier.name.toLowerCase();
    const snapshot = JSON.stringify(modifier.fields);
    if (!previous.has(name)) added.push(name);
    else if (previous.get(name) !== snapshot) edited.push(name);
    previous.delete(name);
  }
  return {
    added,
    edited,
    removed: [...previous.keys()],
    beforeCount: before?.modifiers?.length || 0,
    afterCount: after?.modifiers?.length || 0,
  };
}

/** Имена, которые отличаются в любую сторону — для простых сравнений. */
export function changedModifierNames(before, after) {
  const diff = diffModifiers(before, after);
  return [...diff.added, ...diff.edited, ...diff.removed];
}

/**
 * Выбирает категорию спорной находки по тому, чьи модификаторы тронуты.
 *
 * Возвращает `null`, когда уточнить нельзя: тронуты модификаторы сразу
 * нескольких претендентов или ничьи. Это не неудача, а честный ответ —
 * находка остаётся со списком претендентов, как была.
 */
export function refineByModifiers(candidates, diff) {
  const shape = Array.isArray(diff)
    ? { added: [], edited: diff, removed: [], beforeCount: 0, afterCount: 0 }
    : diff;
  const present = [...new Set([...shape.added, ...shape.edited])].map((name) =>
    name.toLowerCase(),
  );

  /*
   * Частичный файл: пропало больше, чем принесено. Значит перед нами не правка
   * игрового файла, а огрызок из нужных автору модификаторов, и «пропавшее» —
   * не его решение, а следствие того, что он не стал копировать остальное.
   * Судить такой файл по пропавшему нельзя; судим по принесённому.
   */
  const partial = shape.removed.length > present.length;
  const judged = partial
    ? present
    : [...new Set([...present, ...shape.removed.map((n) => n.toLowerCase())])];
  if (!judged.length) return null;

  const owners = candidates.flatMap((id) => ownerSets(id));
  const claimed = new Set();
  for (const owner of owners) for (const name of owner.names) claimed.add(name);

  const matched = owners.filter(
    (owner) =>
      owner.names.size && judged.every((name) => owner.names.has(name)),
  );
  if (matched.length === 1) {
    const { id, option } = matched[0];
    const name = option ? `${id} · ${option}` : id;
    return {
      id,
      option,
      partial,
      modifiers: present,
      priority: layerPriority(id),
      evidence: partial
        ? `частичный файл: ${shape.afterCount} модификаторов вместо ${shape.beforeCount}, и все они принадлежат «${name}»`
        : `внутри файла тронуты только модификаторы «${name}»`,
    };
  }

  /* Категория без собственного списка модификаторов — это «весь файл»
     целиком. Она выигрывает, только когда тронуто что-то вне чужих наборов. */
  const outside = judged.filter((name) => !claimed.has(name));
  const broad = owners.find((owner) => !owner.names.size);
  if (outside.length && broad)
    return {
      id: broad.id,
      option: null,
      partial,
      modifiers: present,
      priority: layerPriority(broad.id),
      evidence: partial
        ? `частичный файл: ${shape.afterCount} модификаторов вместо ${shape.beforeCount}`
        : `внутри файла тронуты модификаторы вне частных наборов (${outside.length} шт.)`,
    };

  return null;
}
