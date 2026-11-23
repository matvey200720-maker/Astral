import {
  Books as Lib,
  Crosshair as Gun,
  Gauge as Fps,
  Palette as Art,
  TShirt as Shirt,
} from "./components/ui/icons.jsx";
import { workshopToolbarCopyFor } from "./workshop-copy.js";
import PageTabs, { PageBar as Bar } from "./components/ui/PageTabs.jsx";
import { useTr } from "./locales/ui.js";
import WorkshopHead from "./features/workshop/poster/WorkshopHead.jsx";

// Описания вкладок мастерской: подсказка «Имя — описание» (24.10.2026, п. 3). У «Редакторов» описания нет.
const SECTION_HINTS = {
  gunpacks: "Свой скин и обвесы на любой ствол",
  clothing: "Одежда и тату прямо на персонаже",
  animations: "Замена анимаций персонажа: смотри обе на модели",
  optimization: "Больше кадров без лишнего в игре",
};
// Значки вкладок библиотеки: у трёх те же, что были у разделов мастерской, у «Графики» — палитра (ТЗ 10.10).
const SHELF = {
  graphics: Art,
  weapons: Gun,
  clothing: Shirt,
  optimization: Fps,
};
// Точка «новое» (19.10.2026): стоит на вкладке раздела, что появилась без человека, до первого нажатия.
const DOT = <i aria-hidden="true" className="library-tab-dot" />;

// Мастерская — своя шапка (`WorkshopHead`, дизайн 15.11.2026): заголовок и вкладки в одной строке, органы страницы справа через actions.
// Библиотека — прежняя полоса вкладок. Подписи — из workshop-copy по locale, описания — tr.
export default function WorkshopToolbar({
  actions,
  editorCount = 0,
  libraryTab = "library",
  libraryTabs = [],
  locale,
  mode,
  onSectionChange,
  section,
}) {
  useTr();
  const labels = workshopToolbarCopyFor(locale);
  if (mode !== "library")
    return (
      <WorkshopHead
        actions={actions}
        counts={{ redux: editorCount }}
        hints={SECTION_HINTS}
        label={labels.navigation}
        onSectionChange={onSectionChange}
        section={section}
        sections={labels.sections}
      />
    );
  const entries = [
    { fresh: false, icon: Lib, id: "library", name: labels.library },
    ...libraryTabs.map(({ fresh, id }) => ({
      fresh: Boolean(fresh),
      icon: SHELF[id],
      id,
      name: labels.libraryTabs[id] || id,
    })),
  ];
  const options = entries.map(({ fresh, icon, id, name }) => ({
    icon,
    label: fresh ? (
      <span className="library-tab-name">
        {name}
        {DOT}
      </span>
    ) : (
      name
    ),
    title: name,
    value: id,
  }));
  return (
    <Bar actions={actions} className="workshop-page-bar">
      <PageTabs label={labels.libraryNavigation} onChange={onSectionChange} options={options} value={libraryTab} />
    </Bar>
  );
}
