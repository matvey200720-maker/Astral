import { EMBLEM_TEXT_OUTLINES, EMBLEM_TEXT_OUTLINE_LABELS } from "@modovik/climb-contract/recolor/emblems";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Обводка надписи — общая у всех надписей мастерской (эмблемы, надпись арены, лого, вывеска, дирижабли). Три слова «Без обводки | Тёмная |
 * Светлая» — сегментом, а не выпадающим списком (п. 13 и 16 `design-qa.md`: списков на 2–4 варианта нет). Подпись группы — «Обводка»,
 * как у «Подгонки» в `SurfaceFit`: имя сегмента для читалки другое, чтобы имя группы и сегмента не двоились.
 *
 *   <OutlineControl value={text.outline} onChange={(outline) => edit.patchText({ outline }, "Надпись: обводка")} />
 */
export default function OutlineControl({ value, onChange, label = "" }) {
  useTr();
  const options = EMBLEM_TEXT_OUTLINES.map((outline) => ({ value: outline, label: tr(EMBLEM_TEXT_OUTLINE_LABELS[outline]) }));
  return (
    <ListGroup title={tr("Обводка")} plain>
      <SegmentedControl label={label || tr("Вид обводки")} size="sm" options={options} value={value} onChange={onChange} />
    </ListGroup>
  );
}
