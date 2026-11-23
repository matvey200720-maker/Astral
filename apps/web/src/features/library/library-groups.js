import { bundleProgress } from "../catalog/bundles/bundle-state.js";
import { isCatalogBundle } from "../../catalog-utils.js";
import { isGunpackPack, packProgress } from "./gunpack-state.js";

/*
 * Заголовки над частями на «Загрузках» (22.11.2026): строки библиотеки, что поставил один ганпак или одна сборка редукса, стоят вместе под заголовком «Ганпак «Brick» · Стоят 3 из 41 · Удалить ганпак»
 * («Снять сборку» у редукса). Часть — запись установки с `origin.bundleId` (`bundleOf`); строки остальных модов остаются на своих местах. Чистые функции: страница даёт карточки и состояние, строка рисует.
 */

/**
 * Группы строк: по одной на ганпак или сборку, у которых в библиотеке есть хоть одна строка.
 * @param {{ id: string, meta?: { mod?: object } }[]} cards строки библиотеки (у карточки мода `meta.mod`)
 * @param {{ mods: object[], installed: string[], bundleOf: object }} state каталог, установленное и «id записи → id пака или сборки»
 * @returns {{ id: string, kind: "pack"|"build", bundle: object, cardIds: string[], standing: number, total: number }[]} в порядке первой строки группы
 */
export function libraryGroups(cards, { mods = [], installed = [], bundleOf = {} } = {}) {
  const byId = new Map(mods.map((mod) => [mod.id, mod]));
  const groups = new Map();
  for (const card of cards) {
    const modId = card.meta?.mod?.id;
    const bundleId = modId ? bundleOf[modId] : "";
    const bundle = bundleId ? byId.get(bundleId) : null;
    const kind = isGunpackPack(bundle) ? "pack" : isCatalogBundle(bundle) ? "build" : "";
    if (!kind) continue;
    if (!groups.has(bundleId)) {
      const build = kind === "build" ? bundleProgress(bundle, installed, mods) : null;
      const standing = build ? build.installedCount : packProgress(bundle, bundleOf, installed).standing.length;
      groups.set(bundleId, { id: bundleId, kind, bundle, cardIds: [], standing, total: build ? build.total : bundle.includedModIds.length });
    }
    groups.get(bundleId).cardIds.push(card.id);
  }
  return [...groups.values()];
}

/**
 * Порядок строк: заголовок группы и сразу её строки (там, где в списке стояла первая из них), остальные — как были.
 * @returns {({ type: "group", group: object } | { type: "card", card: object, grouped: boolean })[]}
 */
export function libraryLayout(cards, groups = []) {
  const owner = new Map(groups.flatMap((group) => group.cardIds.map((id) => [id, group])));
  const byId = new Map(cards.map((card) => [card.id, card]));
  const shown = new Set();
  const out = [];
  for (const card of cards) {
    const group = owner.get(card.id);
    if (!group) {
      out.push({ type: "card", card, grouped: false });
      continue;
    }
    if (shown.has(group.id)) continue;
    shown.add(group.id);
    out.push({ type: "group", group });
    for (const id of group.cardIds) out.push({ type: "card", card: byId.get(id), grouped: true });
  }
  return out;
}
