import { clothingInstallKind } from "@modovik/clothing/install-kind";
import { catalogModWithoutPackage, isCatalogBundle } from "../../../../catalog-utils.js";
import { isCatalogWork } from "../../../workshop/works/catalog-work.js";
import { mappingSetsOf } from "../../mapping-sets.js";
import { soundPackMembers } from "../../sound-packs.js";

/*
 * Можно ли поставить мод кнопкой «Установить» прямо в строке списка (вид Б вкладки «Каталог»). Так ставится мод, у которого на странице нет ничего, кроме
 * самой кнопки: один пакет, без выбора. Остальное — сборка по частям, работа мастерской, вещь одежды (окно «На что ставится»), пак звуков и набор маппинга
 * (части выбирают на странице) и витрина без пакета — открывает свою страницу мода: решения, которые она спрашивает, строка за человека не принимает.
 */
export function canQuickInstall(mod, mods = []) {
  if (!mod || typeof mod !== "object") return false;
  if (isCatalogBundle(mod) || isCatalogWork(mod) || catalogModWithoutPackage(mod)) return false;
  /* Вещь одежды ставится только после выбора, на что поставить (владелец, 15.11.2026): по категории, по разделу и по виду установки — любой признак ведёт на страницу мода. */
  if (mod.catalogCategory === "clothing" || mod.catalogSection === "clothing" || clothingInstallKind(mod)) return false;
  if (soundPackMembers(mod, mods).length) return false;
  if (mappingSetsOf(mods).members.get(mod.id)?.length) return false;
  return true;
}
