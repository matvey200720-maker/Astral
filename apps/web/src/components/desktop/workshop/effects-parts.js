import { tr } from "../../../locales/ui.js";
import { tracerProfileActive, muzzleHasEdits } from "@modovik/ptfx-studio";

// Значения читаются как у объекта: массив подходит, строка/число/null — нет.
const anyOn = (group) => Object.values(group ?? {}).some((item) => item && item.enabled);

// enabled попаданий и removeAll («убрать эффекты совсем») — строго true; у зон и семейств хватает
// любого истинного enabled. Любое другое название части проверяется как «огонь и взрывы».
export function projectHasPart(project, part) {
  const impact = project?.impact;
  switch (part) {
    case "tracer":
      return project?.tracer?.profiles?.some(tracerProfileActive) === true;
    case "muzzle":
      return muzzleHasEdits(project?.muzzle);
    case "impact":
      return impact?.enabled === true && (impact.removeAll === true || anyOn(impact.zones));
    default:
      return anyOn(project?.environment);
  }
}

// Русские ключи словаря: перевод делает partsLabel в момент вызова, а не при загрузке модуля
// (до смены языка язык окна ещё ru). Порядок ключей — порядок подписи.
export const PART_LABELS = Object.freeze({
  tracer: "трейсеры",
  impact: "эффекты попадания",
  environment: "огонь и взрывы",
  muzzle: "вспышки и дым выстрела",
});

// Состав набора, который поедет в игру; пустая строка — набор пуст.
export function partsLabel(project) {
  let text = "";
  for (const [part, label] of Object.entries(PART_LABELS)) {
    if (projectHasPart(project, part)) text += (text && ", ") + tr(label);
  }
  return text && text[0].toUpperCase() + text.slice(1);
}
