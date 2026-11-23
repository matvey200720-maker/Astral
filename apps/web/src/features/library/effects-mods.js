import { isCatalogBundle } from "../../catalog-utils.js";
import { EFFECTS_LEAD_ORDER, TRACERS_SLOT, effectsSlotOf, plainEffectsName } from "../catalog/bundles/component-groups.js";
import { tr } from "../../locales/ui.js";
import { modPicture } from "./mod-picture.js";

/*
 * «Эффекты» и «Трейсеры» редукса на полке «Библиотеки» (12.11.2026, владелец: «просто „Эффекты“ и отдельно „Трейсеры“»).
 *
 * Полка раскладывает установленное по слотам плиток (`workshop-mod-index.js`, слот — `catalogSlot`), а у пакетов разбора слоты свои — `blood-routing`, `effects-core`,
 * `particle-effects`, `effects-tables`, `tracer-bindings`: плитки у них нет, и поставленные пакеты на полке не появлялись вовсе. Теперь каждый поставленный набор — своя карточка,
 * как звуки из каталога (`sound-mods.js`):
 *   • «Эффекты» — одна карточка на редукс, сколько бы его пакетов ни стояло (четыре пакета — одна вещь); имя — имя ведущего пакета без служебной пометки;
 *   • «Трейсеры» — своя карточка на редукс.
 * Карточка ведёт на страницу ведущего пакета; «Удалить» на корзине снимает все стоящие пакеты карточки разом: `units` — по одному на пакет, слот установки — id карточки.
 * Редукс пакета — сборка каталога, в чьём составе он стоит; пакет без сборки получает свою карточку.
 */

const LOCALES = ["ru", "uk", "en", "de", "pl", "fr"];
const EMPTY = Object.freeze([]);
const everyLocale = (value) => Object.fromEntries(LOCALES.map((locale) => [locale, value]));

// Сборка каталога, в чьём составе стоит пакет: первая; нет сборки — пусто.
const ownerOf = (mod, mods) => mods.find((owner) => isCatalogBundle(owner) && (owner.includedModIds || []).includes(mod.id)) || null;

/**
 * Карточки установленных эффектов и трейсеров и их установки для корзины.
 *
 * @param {{ installedMods?: object[], mods?: object[] }} options `installedMods` — установленные моды каталога (`installedWorkshopMods`), `mods` — весь каталог (для сборок-владельцев)
 * @returns {{ cards: object[], units: object[] }}
 */
export function effectsLibraryCards({ installedMods = EMPTY, mods = EMPTY } = {}) {
  const sets = new Map();
  for (const mod of installedMods) {
    const slot = effectsSlotOf(mod);
    if (!mod?.id || !slot) continue;
    const tracers = slot === TRACERS_SLOT;
    const owner = ownerOf(mod, mods);
    const key = `${tracers ? "tracers" : "effects"}:${owner?.id || mod.id}`;
    if (!sets.has(key)) sets.set(key, { id: `effects-mod:${key}`, tracers, parts: [] });
    sets.get(key).parts.push({ mod, slot });
  }
  const cards = [];
  const units = [];
  for (const set of sets.values()) {
    /* Ведущий — первый по порядку набора; привязки следа — сами. */
    const lead = set.tracers
      ? set.parts[0]
      : EFFECTS_LEAD_ORDER.map((slot) => set.parts.find((part) => part.slot === slot)).find(Boolean) || set.parts[0];
    const name = plainEffectsName(lead.mod.name) || lead.mod.id;
    cards.push({
      id: set.id,
      category: set.tracers ? "tracers" : "hit-effects",
      placed: true,
      mod: lead.mod,
      title: everyLocale(name),
      description: everyLocale(set.tracers ? tr("Трейсеры") : tr("Эффекты")),
      image: modPicture(lead.mod),
    });
    for (const { mod } of set.parts) {
      units.push({ kind: "mod", key: `mod:${mod.id}`, modId: mod.id, name: plainEffectsName(mod.name) || mod.id, slots: [set.id], installedAt: "", origin: { type: "redux-part" } });
    }
  }
  return { cards, units };
}
