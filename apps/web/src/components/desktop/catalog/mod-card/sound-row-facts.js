import { formatModSize } from "../../../../catalog-utils.js";
import { burstPlan } from "../../../../features/catalog/sound-burst.js";
import { weaponModel, weaponPicture } from "../../../../features/catalog/sound-rows.js";
import { tr } from "../../../../locales/ui.js";
import { soundLength } from "../ModSounds.jsx";

/*
 * Что известно о строке пака звуков — слова и ссылки для любого вида окна «Компоненты» (`SoundPackList.jsx`): имя оружия на языке
 * окна, с кем оно делит звук, адрес звука, кадр и модель ствола, вес части и длина выстрела. Вид строки (плашка, плитка, строка
 * списка, просмотр) их только раскладывает. `burst` — очередь выстрелов ствола (`{ interval, shots }`, `features/catalog/sound-burst.js`)
 * или `null`: список «Звуки мода» карточки «Пульт» и окно «Просмотр» передают её проигрывателю, при `null` играет один выстрел.
 */
export function soundRowFacts(item, view, trackCopy, playing) {
  const { part, row, weapon, others } = item;
  const name = weapon ? tr(weapon.name) || weapon.catalog : part.name;
  const shared = others.map((other) => tr(other.name) || other.catalog);
  const url = row.sound?.url || "";
  const size = formatModSize(part, view.rails.allMods, view.locale).replace(/(\d) (?=\S+$)/, "$1 ");
  const length = row.sound?.duration ? soundLength(Number(row.sound.duration), view.language, trackCopy) : "";
  return {
    name,
    shared,
    url,
    on: Boolean(url) && playing === url,
    picture: weaponPicture(weapon),
    model: weaponModel(weapon),
    size,
    length,
    takeName: [name, ...shared].join(", "),
    burst: burstPlan(weapon),
  };
}
