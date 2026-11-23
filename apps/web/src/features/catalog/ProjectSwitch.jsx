import { SquaresFour } from "../../components/ui/icons.jsx";
import SegmentedControl from "../../components/ui/SegmentedControl.jsx";
import { catalogWordsFor } from "./catalog-words.js";
import { ALL_PROJECTS, PROJECTS, useProject } from "./catalog-projects.js";

/*
 * Переключатель проекта (ТЗ 05.10, задача 14): Majestic, GTA 5 RP, «Россия
 * Онлайн» или все сразу. Один на всё приложение — тот же выбор стоит в
 * каталоге, в сборках, в мастерской и в библиотеке (`catalog-projects.js`), и
 * лаунчер помнит его после перезапуска. Общий орган — `SegmentedControl`.
 *
 * ТЗ 06.10: вместо названий — настоящие логотипы проектов (файлы и откуда они
 * взяты — `catalog-projects.js`). Имя никуда не делось: оно — имя кнопки для
 * читалки экрана, подсказка под мышью и подсказка от `FocusTip` при фокусе с
 * клавиатуры. Выбранный знак — в цвете и с обводкой фирменного цвета проекта,
 * остальные приглушены (`project-switch.css`).
 */
export function ProjectMark({ project = null }) {
  if (project)
    return (
      <img
        className={`project-mark is-${project.fit}`}
        src={project.logo}
        alt=""
        draggable="false"
        style={{ "--project-accent": project.accent }}
      />
    );
  return (
    <span className="project-mark is-all" aria-hidden="true">
      <SquaresFour weight="fill" />
    </span>
  );
}

export default function ProjectSwitch({
  language = "ru",
  className = "",
  size = "sm",
}) {
  const words = catalogWordsFor(language);
  const [project, setProject] = useProject();
  const options = [
    {
      value: ALL_PROJECTS,
      label: words.allProjects,
      iconOnly: true,
      icon: <ProjectMark />,
      className: "is-project-all",
    },
    ...PROJECTS.map((item) => ({
      value: item.id,
      label: item.id === "russia" ? words.russiaOnline : item.label,
      iconOnly: true,
      icon: <ProjectMark project={item} />,
      className: `is-project-${item.id}`,
    })),
  ];
  return (
    <SegmentedControl
      className={`project-switch${className ? ` ${className}` : ""}`}
      label={words.projectLabel}
      options={options}
      value={project}
      onChange={setProject}
      size={size}
    />
  );
}
