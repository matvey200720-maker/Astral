import { useMemo } from "react";
import { Plus, Stack } from "../../../ui/icons.jsx";

import Button from "../../../ui/Button.jsx";
import {
  MEGA_MALL_DASHBOARD_MODULE,
  YOU_TOOL_DASHBOARD_MODULE,
  useWorkshopLocalization,
} from "./shared.jsx";
import { WorkshopCard } from "./cards.jsx";
import { legacyMallWorks } from "./legacy-mall-works.js";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Витрина мастерской: плитки модулей и двух студий, живущих своей жизнью.
 */

function Dashboard({
  projects,
  recovery,
  onCreate,
  onOpenModule,
  onShowProjects,
  onOpenMegaMall,
  onOpenYouTool,
}) {
  useTr();
  const { translate: t, modules } = useWorkshopLocalization();
  const activeProject = projects[0] || recovery;
  /* Плитки прежнего редактора фасадов — только там, где у человека прежняя работа (23.11.2026): новая «Мастерская Мегамолла» —
     в студии зданий, без загрузчика. */
  const legacy = useMemo(() => legacyMallWorks(), []);
  const tileCount = modules.length + (legacy.megaMall ? 1 : 0) + (legacy.youTool ? 1 : 0);
  return (
    <section className="studio-dashboard studio-dashboard-focused">
      <header className="studio-dashboard-hero">
        <div>
          <span>{t("Кастомизация · GTA V")}</span>
          <h1>{t("Мастерская интерфейса")}</h1>
          <p>
            {tr(
              "Три редактора с живым GTA V предпросмотром: прицел, мини-карта и Davis Mega Mall.",
            )}
          </p>
        </div>
        <div className="studio-dashboard-actions">
          <Button
            variant="secondary"
            icon={<Stack />}
            trailing={projects.length > 0 ? <b>{projects.length}</b> : null}
            onClick={onShowProjects}
          >
            {t("Мои проекты")}
          </Button>
          <Button variant="primary" icon={<Plus />} onClick={onCreate}>
            {t("Новый набор")}
          </Button>
        </div>
      </header>
      <header className="studio-modules-heading">
        <div>
          <span>{t("Доступно сейчас")}</span>
          <strong>
            <b>{tileCount}</b>
            <small>/ {tileCount}</small>
          </strong>
        </div>
        <small>
          {t("Изменения отображаются сразу и сохраняются одним проектом")}
        </small>
      </header>
      <div
        className="studio-module-grid studio-module-grid-focused"
        data-assembly-grid
      >
        {modules.map((module, index) => (
          <WorkshopCard
            key={module.id}
            module={module}
            project={activeProject}
            index={index}
            onOpen={() => onOpenModule(module.id, activeProject)}
          />
        ))}
        {legacy.megaMall && (
          <WorkshopCard
            module={MEGA_MALL_DASHBOARD_MODULE}
            project={null}
            index={modules.length}
            onOpen={onOpenMegaMall}
          />
        )}
        {legacy.youTool && (
          <WorkshopCard
            module={YOU_TOOL_DASHBOARD_MODULE}
            project={null}
            index={modules.length + (legacy.megaMall ? 1 : 0)}
            onOpen={onOpenYouTool}
          />
        )}
      </div>
    </section>
  );
}

export { Dashboard };
