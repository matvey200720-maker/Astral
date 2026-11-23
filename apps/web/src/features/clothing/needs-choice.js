import { clothingInstallKind } from "@modovik/clothing/install-kind";
import { clothingOf } from "./clothing-catalog.js";

/*
 * Вещь одежды ставится только после выбора, «на что поставить» (слова владельца 15.11.2026, ~23:40: «я нажимал установить, и у меня не устанавливался бы этот мод, а мне бы предлагался на что-то
 * поставить замененку … то же касается бороды, ногтей»). Карточки вида `pick` («одна вещь на замену»: причёска, борода, усы, ногти, штатная вещь) и `gloves` открывают окно «Сделать заменёнку»;
 * остальные виды (`retexture`, `ownPlaces`, `pack`, `tattoo`, `unknown`) спрашивают своё окно («На что ставится», тату) и сюда не входят.
 */

/** Карточке нужно окно выбора «на что поставить» до установки: вид `pick` / `gloves` с местом на теле. Чистая функция — для оболочки, страницы мода и теста-сторожа. */
export function clothingNeedsChoice(mod) {
  if (!mod || typeof mod !== "object") return false;
  if (!["pick", "gloves"].includes(clothingInstallKind(mod))) return false;
  return Boolean(clothingOf(mod)?.component);
}

/** Установка пришла без выбора: у карточки вида `pick` / `gloves` нет ни `clothingChoice`, ни набора тату. Такую установку оболочка не ставит, а открывает карточку. */
export const installLacksChoice = (mod) =>
  clothingNeedsChoice(mod) && !mod.clothingChoice && !mod.tattooSetChoice;

/** Из списка модов сборки («Сборки» пользователя, сборка каталога): вещи одежды без выбора. Выбора эти сборки не хранят — такие вещи в очередь не идут, их ставят из карточек. */
export const modsNeedingChoice = (mods) =>
  (mods || []).filter(installLacksChoice);

/**
 * Названия вещей для слова про сборку («… не ставятся сами: откройте их карточки — {названия}»): первые `max`, остальные числом «+N» — оно не зависит от языка. Список в десятки вещей иначе
 * растянул бы уведомление (ширина 440 px, строки переносятся, не обрезаются) на полокна.
 */
export function choosingNames(mods, max = 3) {
  const names = (mods || []).map((mod) => mod?.name).filter(Boolean);
  const head = names.slice(0, max).join(", ");
  return names.length > max ? `${head} +${names.length - max}` : head;
}
