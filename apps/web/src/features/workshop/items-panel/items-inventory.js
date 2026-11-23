/*
 * Опись вещей сцены в виде, который читает панель «Предметы» (docs/design/items-panel.md): запись из описи набора
 * `{ models: [{ name, own?, shell? }], rooms: [""], items: [[номер вещи, номер модели, номер комнаты]] }`
 * (`scripts/lib/scene-objects.mjs`; у арен — `packages/climb-contract/recolor/arena-objects.js`, там же та же форма) →
 * `{ models: [{ index, name, own, shell, kind, selectionKind, count, keys }], items: [{ key, model, room }], byKey, byKind, total }`.
 *
 * `kindOf(модель)` — род вещи для значка и порядка (по желанию редактора); `selectionKindOf(модель)` — род разметки выделения
 * (`@modovik/climb-contract/recolor/scene-item-rules`): по нему «Выбрать все такие» берёт вещи одного рода (`byKind`). Вещи считаются раз
 * на запись описи.
 */

const cache = new WeakMap();

const defaultKind = () => "decor";
const noSelectionKind = () => "";

export function sceneInventory(raw, { kindOf = defaultKind, selectionKindOf = noSelectionKind } = {}) {
  if (!raw?.items?.length) return null;
  /* Опись считается раз на запись и пару слов о ней: другие слова (другой редактор, тест) — другой подсчёт. */
  const known = cache.get(raw);
  if (known && known.kindOf === kindOf && known.selectionKindOf === selectionKindOf) return known.out;
  const models = raw.models.map((model, index) => ({
    index,
    name: model.name,
    own: Boolean(model.own),
    shell: Boolean(model.shell),
    kind: model.shell ? "structure" : kindOf(model),
    selectionKind: selectionKindOf(model) || "",
    count: 0,
    keys: [],
  }));
  const items = raw.items.map(([key, modelIndex, roomIndex]) => ({ key, model: modelIndex, room: raw.rooms?.[roomIndex] ?? "" }));
  for (const item of items) {
    models[item.model].count += 1;
    models[item.model].keys.push(item.key);
  }
  const byKind = new Map();
  for (const model of models) if (model.selectionKind) byKind.set(model.selectionKind, [...(byKind.get(model.selectionKind) || []), ...model.keys].sort((a, b) => a - b));
  const out = { models, items, byKey: new Map(items.map((item) => [item.key, item])), byKind, total: items.length };
  cache.set(raw, { kindOf, selectionKindOf, out });
  return out;
}
