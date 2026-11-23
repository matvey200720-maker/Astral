import { modWeapons, weaponById } from "../catalog/search-concepts.js";
import { isSoundMod, soundPackName } from "../catalog/sound-packs.js";
import { weaponPicture } from "../catalog/sound-rows.js";
import { tr } from "../../locales/ui.js";
import { modPicture } from "./mod-picture.js";

/*
 * Звуки из каталога на полке «Библиотеки» (25.10.2026, владелец: карандаш — везде, где есть звук).
 *
 * Звук пака публикуется модом раздела `other` со слотом `weapon-sounds` (`placement.section = "other"`), а полка библиотеки искала
 * установленное по слотам разделов `redux`, `gunpacks`, `clothing`: звук, поставленный из каталога, на ней не появлялся вовсе — ни
 * плитки, ни пути к редактору. Теперь каждый поставленный звук — своя карточка, как вещь одежды (`clothing-placements.js`):
 *   • часть пака (звук ствола или группы стволов с общим банком) — имя оружия на языке окна, кадр ствола из нашего набора, подпись
 *     «Звук оружия · <пак>»;
 *   • пак целиком — имя пака и его обложка.
 * Карточка ведёт на страницу мода — там «Редактировать» (карандаш: мастерская звуков на его стволе) и «Удалить».
 *
 * Установки карточек едут в корзину библиотеки так же, как у одежды: `units` — по одной на мод, слот установки — id карточки.
 */

const LOCALES = ["ru", "uk", "en", "de", "pl", "fr"];
const EMPTY = Object.freeze([]);
const everyLocale = (value) =>
  Object.fromEntries(LOCALES.map((locale) => [locale, value]));
const text = (value) => (typeof value === "string" ? value.trim() : "");

/** Имя пака в имени звука («Звук: … · VIBE REDUX» → «VIBE REDUX»); у имени без « · » — пусто. */
function packOf(mod) {
  const pieces = text(mod?.name).split(" · ");
  return pieces.length > 1 ? pieces[pieces.length - 1].trim() : "";
}

/**
 * Карточки установленных звуков и их установки для корзины.
 *
 * @param {{ installedMods?: object[] }} options `installedMods` — установленные моды каталога (`installedWorkshopMods`)
 * @returns {{ cards: object[], units: object[] }}
 */
export function soundLibraryCards({ installedMods = EMPTY } = {}) {
  const cards = [];
  const units = [];
  for (const mod of installedMods) {
    if (!mod?.id || !isSoundMod(mod)) continue;
    const pack = Boolean(mod.includedModIds?.length);
    const id = `sound-mod:${mod.id}`;
    const weapons = pack
      ? []
      : modWeapons(mod)
          .map((weaponId) => weaponById(weaponId))
          .filter(Boolean);
    const shot = weapons.map((weapon) => weaponPicture(weapon)).find(Boolean) || "";
    const name = pack
      ? soundPackName(mod.name)
      : weapons.length
        ? weapons.map((weapon) => tr(weapon.name) || weapon.catalog).join(", ")
        : text(mod.name) || mod.id;
    const note = pack
      ? tr("Пак звуков оружия")
      : [tr("Звук оружия"), packOf(mod)].filter(Boolean).join(" · ");
    cards.push({
      id,
      category: "weapon-sounds",
      placed: true,
      sound: true,
      mod,
      title: everyLocale(name),
      description: everyLocale(note),
      /* Часть — кадр её ствола (владелец: «значок карабина»); пак — своя обложка. */
      image: shot || modPicture(mod),
      preferImage: Boolean(shot),
    });
    units.push({
      kind: "mod",
      key: `mod:${mod.id}`,
      modId: mod.id,
      name,
      slots: [id],
      installedAt: "",
      origin: { type: "sound" },
    });
  }
  return { cards, units };
}
