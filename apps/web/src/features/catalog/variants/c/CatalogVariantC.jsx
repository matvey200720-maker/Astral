import "./catalog-variant-c.css";
import { useCallback, useMemo } from "react";
import { catalogSectionOfMod, publicCatalogCategories } from "../../../../components/desktop/catalog/catalogSections.js";
import CatalogNavigator from "../../../../components/desktop/catalog/CatalogNavigator.jsx";
import { catalogLabel } from "../../catalog-words.js";
import VariantEmpty from "../VariantEmpty.jsx";
import VariantHeading from "../VariantHeading.jsx";
import VariantTools from "../VariantTools.jsx";
import { useBundleActions } from "../../bundles/BundleContext.js";
import { localPartName } from "../../part-name.js";
import { partNamePrefixes } from "../../pack-contents.js";
import { packBrowseCopy } from "../../pack-browse-copy.js";
import { packContentsCopy } from "../../pack-contents-copy.js";
import { soundPackMembers, soundPackName, soundRow } from "../../sound-packs.js";
import { mappingSetsOf, mappingSetWords } from "../../mapping-sets.js";
import { coverFor, hasOwnCover } from "../../../../utils/catalogMedia.js";
import { modSizeLabel } from "../../size-estimate.js";
import { useRememberedState } from "../../../../section-memory.js";
import { tr } from "../../../../locales/ui.js";
import ModList from "./ModList.jsx";
import Scene from "./Scene.jsx";

/*
 * Каталог, вариант В — «Просмотр» (ТЗ 29.10.2026-b; из трёх вариантов на выбор владельцу, как было с «Компонентами»).
 *
 *   ┌ навигатор ──┐  Винтовки                       [♡] [проект] [Новые ▾]
 *   │ разделы     │  37 модификаций · Majestic
 *   │ и полки     │  ┌ список ─────┐ ┌ сцена ─────────────────────────┐
 *   └─────────────┘  │ кадр · имя  │ │  большой кадр / ролик по ▶      │
 *                    │ кадр · имя  │ │  имя · автор · размер           │
 *                    │ …           │ │  [Установить] [Открыть в маст.] │
 *                    └─────────────┘ │  лента кадров                   │
 *                                    └─────────────────────────────────┘
 *
 * Это вся вкладка: шапка, поиск, фильтры и порядок, навигатор (свёрнутая рельса — тот же `CatalogNavigator`), список, сцена, пустое состояние и загрузка, открытие мода.
 * Состояния здесь нет: раздел, полка, поиск, избранное, проект, порядок и выборка приходят одним `model` из `PublicCatalog` (`features/catalog/variants/index.js`), вид только рисует.
 * Отличие от сетки — витрина: список слева и большая сцена выбранного справа; щелчок по моду выбирает его, страница мода открывается кнопкой «Открыть» (или щелчком по автору).
 * Мест показа (`Showcase`) среди строк нет: это витрина сетки (берётся `gridItems`, а не `gridFeedItems`).
 */

const SECTION_ICONS = new Map(publicCatalogCategories.map((item) => [item.id, item.icon]));

/* Подраздел словарём витрины, затем общим словарём окна; незнакомая подпись остаётся как есть (как на странице мода). */
function crumbLabel(text, language) {
  if (!text) return "";
  const label = catalogLabel(text, language);
  return label === text ? tr(text) : label;
}

/* Имена стволов звука на языке окна. */
const weaponNames = (row) => row.weapons.map((weapon) => tr(weapon.name) || weapon.catalog).join(", ");

/**
 * @param {{ model: object }} props `model` — состояние вкладки от `PublicCatalog` (список ключей — рядом с флагом в `PublicCatalog.jsx`).
 */
export default function CatalogVariantC({ model }) {
  const {
    language,
    words,
    mods,
    gridItems,
    looks,
    reduxOf,
    soundHits,
    favoriteIds,
    favoritesOnly,
    onNavigate,
  } = model;
  const actions = useBundleActions();
  /* Выбранный в списке мод — помнится вместе с остальным видом каталога (`catalog:`): вернулся — тот же мод на сцене. */
  const [pickedKey, setPickedKey] = useRememberedState("catalog:c-pick", "");
  const { selectCard, chooseShelfIn } = model;

  /* Записи списка — только ключ и то, что показывает строка (мод или карточка редукса); имя, вторая строка, кадр и знак считаются на строке, которая на экране
     (`describe`): в разделе бывают тысячи модов, а на виду два десятка. */
  const entries = useMemo(() => gridItems.map((item) => (item.reduxCard ? { key: item.id, redux: item } : { key: item.id, mod: item })), [gridItems]);
  const describe = useCallback(
    (entry) => {
      if (entry.redux) {
        const { group, lead, components } = entry.redux;
        return {
          key: entry.key,
          mod: lead,
          group,
          components,
          title: group.name,
          sub: components ? words.components(components) : "",
          cover: group.cover || (lead && hasOwnCover(lead) ? coverFor(lead) : ""),
          icon: SECTION_ICONS.get("redux"),
        };
      }
      const mod = entry.mod;
      const sounds = soundPackMembers(mod, mods);
      const pieces = mappingSetsOf(mods).members.get(mod.id) || [];
      const owner = pieces.length ? mappingSetsOf(mods).owner.get(mod.id) : null;
      const setName = pieces.length ? [mappingSetWords(language).kind, owner?.name].filter(Boolean).join(" · ") : "";
      const part = reduxOf.get(mod.id) && !setName && !sounds.length;
      const name = part ? localPartName(mod.name, language, partNamePrefixes(mod)) : setName || (sounds.length ? soundPackName(mod.name) : mod.name);
      const hitId = soundHits.get(mod.id)?.[0] || "";
      const hit = hitId ? sounds.find((sound) => sound.id === hitId) : null;
      const hitRow = hit ? soundRow(hit) : null;
      const extent = sounds.length
        ? packBrowseCopy(language).sounds(sounds.length)
        : pieces.length
          ? packContentsCopy(language).parts(pieces.length)
          : modSizeLabel(mod, mods, words.locale).text;
      const kind = crumbLabel(mod.catalogSubcategory || mod.categoryLabel || "", language);
      return {
        key: mod.id,
        mod,
        title: name,
        sub: hitRow ? packBrowseCopy(language).soundHit(weaponNames(hitRow)) : [kind, extent].filter(Boolean).join(" · "),
        kind,
        hitId: hit?.id || "",
        cover: looks.get(mod.id) || (hasOwnCover(mod) ? coverFor(mod) : ""),
        icon: SECTION_ICONS.get(catalogSectionOfMod(mod)),
      };
    },
    [language, looks, mods, reduxOf, soundHits, words],
  );
  const selectedLight = entries.find((entry) => entry.key === pickedKey) || entries[0] || null;
  const selected = selectedLight ? describe(selectedLight) : null;
  /* «Открыть» — страница мода; у пака звуков, найденного по звуку, она встаёт на этом звуке; редукс без пака — выборка его частей. */
  const openEntry = useCallback(
    (entry) => {
      if (entry.mod) selectCard(entry.mod, entry.hitId || "");
      else if (entry.group) chooseShelfIn("redux", entry.group.id);
    },
    [chooseShelfIn, selectCard],
  );
  const selectMod = useCallback((mod) => selectCard(mod), [selectCard]);

  return (
    <div ref={model.pageRef} className="desktop-page public-catalog-page is-navigator is-variant-c" data-catalog-variant="c">
      <CatalogNavigator {...model.navigatorProps} search={model.searchField} />

      <section className="catalog-main cvc-main" data-catalog-output>
        <header className="catalog-main-head">
          <VariantHeading model={model} />
          <VariantTools model={model} />
        </header>

        {selected ? (
          <div className="cvc-split" key={`${model.category}:${model.shelf?.id || ""}:${model.refine}:${favoritesOnly}`}>
            <ModList
              entries={entries}
              describe={describe}
              selectedKey={selected.key}
              likedIds={favoriteIds}
              installedIds={actions?.installed || []}
              onPick={setPickedKey}
              label={tr("Моды раздела")}
            />
            <Scene
              key={selected.key}
              entry={selected}
              mods={mods}
              words={words}
              language={language}
              liked={Boolean(selected.mod && favoriteIds.has(selected.mod.id))}
              kicker={selected.kind || ""}
              onFavorite={model.toggleFavorite}
              onSelect={selectMod}
              onOpen={openEntry}
              onNavigate={onNavigate}
            />
          </div>
        ) : (
          <section className="public-catalog-results cvc-empty">
            <VariantEmpty model={model} />
          </section>
        )}
      </section>
    </div>
  );
}
