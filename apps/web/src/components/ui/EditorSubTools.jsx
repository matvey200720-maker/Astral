import SegmentedControl from "./SegmentedControl.jsx";
import { tr, useTr } from "../../locales/ui.js";

/*
 * Переключатель внутри инструмента колонки (ТЗ 22.10.2026, «облегчить»): над панелью, в ширину колонки («Свет» — цвет,
 * яркость и блик; «Листва» — цвет листвы и «В разнобой»; «Краска» оружия — кисть, ластик, заливка…). Лист —
 * `editor-sub-tools.css`, подключён в `styles/index.css`. Пункты и сам переключатель даёт единый орган колонки по
 * группам — `useRailGroups` (`useRailGroups.jsx`, `editor-rail-groups.js`, описание в `design-qa.md`): каждый пункт —
 * прежний инструмент со своей панелью; внутри ничего не изменилось, колонка стала короче.
 */
/* `tabs` — пункты значком над коротким словом, поровну в ширину колонки (п. 13 `design-qa.md`: сегментов из одних значков нет). */
export default function EditorSubTools({ options, value, onChange, tabs = false }) {
  useTr();
  if (!options || options.length < 2) return null;
  return (
    <div className={`editor-sub-tools${tabs ? " is-tabs" : ""}`}>
      <SegmentedControl label={tr("Раздел")} size="sm" value={value} onChange={onChange} options={options} />
    </div>
  );
}
