import { COMPONENTS } from "@modovik/clothing/taxonomy";
import { garmentKindLabel, garmentKindOf } from "@modovik/clothing/garment-kinds";
import { tr } from "../../locales/ui.js";

/*
 * «Что изменится» у вещи одежды на странице мода (слово владельца через ведущую, 28.10.2026): не «Файлы мода», а что именно меняется — вид вещи (куртка, футболка)
 * или раздел (верх, сумка, аксессуар): она встанет на ту вещь, которую человек выберет в «Сделать заменёнку». Вид — узнанный разбором импорта
 * (`domain.clothing.garment`) или по названию и тегам мода, как в самом окне; нет вида — раздел по месту на теле; нет и его — слова без вида.
 */
export function clothingChangeSummary(mod) {
  const block = mod?.domain?.clothing;
  const component = String(block?.component || "");
  const kind =
    garmentKindLabel(
      block?.garment ||
        garmentKindOf({ component, names: [mod?.name, ...(Array.isArray(mod?.tags) ? mod.tags : [])] }),
    ) ||
    COMPONENTS[component]?.label ||
    "";
  return kind ? tr("{kind} — на вещь, которую вы выберете").replace("{kind}", tr(kind)) : tr("На вещь, которую вы выберете");
}
