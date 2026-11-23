import { variantOf } from "@modovik/publishing";
import { chooseBundleVariant } from "./bundle-choices.js";
import { bundleVariantOf } from "./bundle-state.js";
import { chosenMapWork, mapChoiceKey } from "./map-works.js";

const NO_VERSIONS = Object.freeze({ label: "", work: null, versions: null });

// Ответ «выбирать нечего»: порядок ключей part, label, work, versions сохраняется.
const bare = (part) => ({ part, ...NO_VERSIONS });

const optionsOf = (pairs) => pairs.map(([value, label]) => ({ value, label }));

/** Из «приговора» стратегии (что показать и какое меню) получается ответ плитке. */
const present = (copy, { part, label, work, menu }) => ({
  part,
  label,
  work,
  versions: {
    label: copy.versions(label, menu.options.length),
    heading: copy.versionsHeading,
    count: menu.options.length,
    ...menu,
  },
});

// Свои карты игрока вытесняют версии автора целиком, как бы он ни выбирал раньше.
function ownMapsVerdict({ mod, copy, choices, mapWorks, ownMaps, select }) {
  if (!(ownMaps?.length > 0)) return null;

  const work = chosenMapWork(mod.id, mapWorks, choices);
  const pairs = [
    [mod.id, copy.original],
    ...ownMaps.map((own) => [own.key, copy.mineNamed(own.name)]),
  ];

  return {
    part: mod,
    label: work ? copy.mine : copy.original,
    work,
    menu: {
      value: work ? work.key : mod.id,
      options: optionsOf(pairs),
      // «Оригинал» хранится пустой строкой: запись о карте остаётся, но обнуляется.
      onSelect: (value) => {
        select(mapChoiceKey(mod.id), value === mod.id ? "" : value);
      },
    },
  };
}

function authorVerdict({ mod, choices, allMods, installed, select }) {
  const { mod: picked, siblings, group } = bundleVariantOf(mod, { mods: allMods, installed, choices });
  if (siblings.length < 2) return null;

  const labelOf = (version) => variantOf(version)?.label;

  return {
    part: picked,
    label: labelOf(picked) ?? "",
    work: null,
    menu: {
      value: picked.id,
      options: optionsOf(siblings.map((version) => [version.id, labelOf(version) ?? version.name])),
      onSelect: (id) => {
        select(group, id);
      },
    },
  };
}

export const partVersions = (item, { view, copy, choices, mapWorks = {} }) => {
  const { mod } = item;
  const { id: bundleId } = view.mod;
  const { allMods } = view.rails;
  const { installed } = view.parts;
  const ownMaps = mapWorks[mod.id];

  const select = (group, value) => {
    chooseBundleVariant(bundleId, group, value);
  };
  const scene = { mod, copy, choices, mapWorks, ownMaps, allMods, installed, select };

  const verdict = ownMapsVerdict(scene) ?? authorVerdict(scene);
  return verdict ? present(copy, verdict) : bare(mod);
};
