/*
 * Панель «Предметы» — общая часть редакторов с предметами (ТЗ владельца 26.10.2026, п. A; арены, потом остальные).
 *
 * Редактор отдаёт опись (`{ models, items }`, как у арен: `packages/climb-contract/recolor/arena-objects.js`) и два
 * слова о ней: к какой категории относится модель (`categoryOf`) и как зовётся комната (`roomLabel`). Отсюда
 * считаются три страницы панели:
 *
 *   1. вход — список категорий с числом и кадром модели (`itemCategories`);
 *   2. категория — разбивка по комнатам, у каждой строки кадр модели (`itemRooms`);
 *   3. предмет — соседи по модели для перелистывания (`itemNeighbours`).
 *
 * Чистые функции без React и three: их читает панель (`ItemsPanel.jsx`) и тесты. Убранные из игры вещи (`removed`)
 * не пропадают из страниц: у категории они считаются отдельно, у строки — помечены, чтобы их можно было вернуть.
 */

const toSet = (value) => (value instanceof Set ? value : new Set(value || []));

/** Все вещи модели, что ещё в игре. */
export const liveKeys = (model, removed) => {
  const gone = toSet(removed);
  return gone.size ? model.keys.filter((key) => !gone.has(key)) : model.keys;
};

/*
 * Категории по описи: `categories` — порядок и названия (`[{ id, label }]`), `categoryOf(модель)` — id категории.
 * Модель, чьей категории в списке нет, уходит в последнюю (она же «Прочее»). Пустые категории не показываются.
 * Внутри — модели по убыванию числа вещей, потом по имени: самое частое — первым, оно и даёт кадр категории.
 * `{ id, label, models, total, live, gone, picture }`: `picture` — модель, чей кадр стоит на плитке категории.
 */
export function itemCategories(objects, { categories, categoryOf, removed = null }) {
  if (!objects) return [];
  const gone = toSet(removed);
  const order = new Map(categories.map((category, index) => [category.id, index]));
  const last = categories[categories.length - 1]?.id;
  const byId = new Map(categories.map((category) => [category.id, { ...category, models: [], total: 0, live: 0, gone: 0 }]));
  for (const model of objects.models) {
    const wanted = categoryOf(model);
    const entry = byId.get(order.has(wanted) ? wanted : last);
    if (!entry) continue;
    entry.models.push(model);
    entry.total += model.count;
    const alive = liveKeys(model, gone).length;
    entry.live += alive;
    entry.gone += model.count - alive;
  }
  const out = [];
  for (const entry of byId.values()) {
    if (!entry.total) continue;
    entry.models.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    entry.picture = entry.models.find((model) => liveKeys(model, gone).length) || entry.models[0];
    out.push(entry);
  }
  return out;
}

/*
 * Модели категории по комнатам: `[{ id, label, count, groups: [{ model, keys, live, gone }] }]`. Строка комнаты — одна
 * модель в этой комнате (сто одинаковых подставок не раздувают список до ста строк). Комнаты — в порядке `roomOrder`
 * (меньше — раньше), одинаковые — по появлению в описи; внутри комнаты — по убыванию числа, потом по имени.
 * `roomOf(вещь)` — идентификатор комнаты (`""` — вещь без комнаты), `roomLabel(id)` — подпись.
 */
export function itemRooms(objects, models, { roomOf, roomLabel, roomOrder = () => 0, removed = null }) {
  if (!objects || !models?.length) return [];
  const gone = toSet(removed);
  const wanted = new Set(models.map((model) => model.index));
  const rooms = new Map();
  for (const item of objects.items) {
    if (!wanted.has(item.model)) continue;
    const id = roomOf(item);
    const room = rooms.get(id) || { id, label: roomLabel(id), count: 0, groups: new Map(), at: rooms.size };
    rooms.set(id, room);
    const group = room.groups.get(item.model) || { model: objects.models[item.model], keys: [], live: 0, gone: 0 };
    group.keys.push(item.key);
    if (gone.has(item.key)) group.gone += 1;
    else group.live += 1;
    room.groups.set(item.model, group);
    room.count += 1;
  }
  return [...rooms.values()]
    .sort((a, b) => roomOrder(a.id) - roomOrder(b.id) || a.at - b.at)
    .map((room) => ({
      id: room.id,
      label: room.label,
      count: room.count,
      groups: [...room.groups.values()].sort((a, b) => b.keys.length - a.keys.length || (a.model.name < b.model.name ? -1 : 1)),
    }));
}

/*
 * Поиск по моделям: подпись, внутреннее имя, подпись категории. Пустой запрос — ничего (список категорий остаётся).
 * Возвращает модели той же формы, что `objects.models`, в порядке категорий и убывания числа.
 */
export function findItemModels(categories, query, { titleOf = () => "" } = {}) {
  const find = String(query || "").trim().toLowerCase();
  if (!find) return [];
  const out = [];
  for (const category of categories)
    for (const model of category.models)
      if (model.name.toLowerCase().includes(find) || category.label.toLowerCase().includes(find) || String(titleOf(model)).toLowerCase().includes(find)) out.push(model);
  return out;
}

/*
 * Соседи выбранной вещи по модели — для перелистывания «3 из 11»: `{ index, total, prev, next }` или `null`, если вещь
 * одна. Ключи — только те, что ещё в игре, а выбранная — всегда в списке (даже убранная: чтобы страница не прыгала).
 * `room` ограничивает перелистывание комнатой (`roomOf` вещи) — у охвата «в комнате».
 */
export function itemNeighbours(objects, key, { removed = null, room = null, roomOf = null } = {}) {
  const item = objects?.byKey.get(key);
  if (!item) return null;
  const model = objects.models[item.model];
  const gone = toSet(removed);
  const keys = model.keys.filter((entry) => entry === key || (!gone.has(entry) && (room === null || !roomOf || roomOf(objects.byKey.get(entry)) === room)));
  if (keys.length < 2) return null;
  const index = keys.indexOf(key);
  return { index: index + 1, total: keys.length, prev: keys[(index + keys.length - 1) % keys.length], next: keys[(index + 1) % keys.length] };
}

/**
 * Какой охват подставить, когда вещь взяли строкой списка: у модели несколько вещей в комнате — «в комнате» (то, что
 * строка и показывала), иначе «этот». Охват «во всей арене» человек выбирает сам переключателем.
 */
export const scopeForRow = (group) => (group.keys.length > 1 ? "room" : "one");
