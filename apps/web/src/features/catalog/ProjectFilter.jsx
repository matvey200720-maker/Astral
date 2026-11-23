import { Globe, SquaresFour } from "../../components/ui/icons.jsx";
import MenuButton from "../../components/ui/MenuButton.jsx";
import { ALL_PROJECTS, PROJECTS, useProject } from "./catalog-projects.js";
import { CARD_PROJECTS } from "./card-projects.js";

/*
 * Фильтр проекта над сеткой каталога (ТЗ 24.10.2026, п. 13; образцы — скрины 32–34): кнопка со знаком проекта (земной
 * шар — тот же, что у строки «Для какого проекта» на странице мода) между сердечком избранного и порядком. Ползунки с неё
 * ушли на кнопку «Компоненты» страницы мода (владелец, 24.10.2026 ночью: «тот значок можешь к компонентам перенести»). Нажатие раскрывает «Все · 5RP · Majestic» со знаками проектов, выбор сужает каталог до модов,
 * что подходят проекту. Выбор — тот же, что у всего приложения (`catalog-projects.js`: сборки, мастерская и библиотека
 * читают его оттуда же), поэтому он переживает перезапуск; «Все» — отсутствие выбора.
 *
 * Проектов два (как и знаки на карточке): «Россия Онлайн» запускает клиент Majestic и отдельным пунктом здесь не стоит.
 * Если у человека выбран он (старый выбор приложения), кнопка всё равно помечена: каталог сужен, а «Все» снимет сужение.
 */
const SHORT_LABELS = Object.freeze({ gta5rp: "5RP", majestic: "Majestic" });

export default function ProjectFilter({ words }) {
  const [project, setProject] = useProject();
  const options = [
    { value: ALL_PROJECTS, label: words.allProjects, icon: <SquaresFour className="catalog-project-all" weight="fill" /> },
    ...CARD_PROJECTS.map((id) => {
      const item = PROJECTS.find((entry) => entry.id === id);
      return {
        value: id,
        label: SHORT_LABELS[id],
        icon: <img className={`catalog-project-badge is-${item.fit}`} src={item.logo} alt="" draggable="false" />,
      };
    }),
  ];
  const filtered = project !== ALL_PROJECTS;
  return (
    <MenuButton
      className={`catalog-project-filter${filtered ? " is-filtered" : ""}`}
      menuClassName="catalog-project-menu"
      variant="secondary"
      size="sm"
      icon={<Globe />}
      trailing={null}
      ariaLabel={words.projectLabel}
      title={filtered ? `${words.projectLabel}: ${SHORT_LABELS[project] || project}` : words.projectLabel}
      align="end"
      options={options}
      value={project}
      onSelect={setProject}
    />
  );
}
