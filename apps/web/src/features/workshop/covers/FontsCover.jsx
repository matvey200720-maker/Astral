import { useMemo } from "react";
import { createFontsProject, fontTemplate, fontsProjectIsVanilla, normalizeFontsProject } from "@modovik/climb-contract/recolor/fonts";
import { parseCoverState } from "./cover-data.js";
import { useCoverCanvas } from "./useCoverCanvas.js";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Обложка шрифтов — образец «Аа» этим шрифтом на матовой плашке карточки
 * (холст прозрачный; ТЗ владельца 27.10.2026: «большая «А» и маленькая «а»
 * этим шрифтом», название шрифта на обложке не пишется). Шаблон —
 * шрифт Windows, свой файл — по имени семейства (если он есть в системе);
 * ширина и наклон работы — тем же преобразованием, что у кадра без Astral
 * Desktop. Пока человек ничего не ставил — «Шрифты игры» системным шрифтом:
 * шрифтов Rockstar в поставке нет.
 */
export default function FontsCover({ state = null }) {
  useTr();
  const look = useMemo(() => {
    const stored = parseCoverState(state);
    const project = stored ? normalizeFontsProject(stored) : createFontsProject();
    if (fontsProjectIsVanilla(project)) return { family: "sans-serif", weight: 600, name: tr("Шрифты игры"), own: false, settings: {} };
    if (project.source.kind === "file")
      return { family: `"${project.source.file.family || "sans-serif"}", sans-serif`, weight: 400, name: project.source.file.family || tr("Свой шрифт"), own: true, settings: project.settings };
    const template = fontTemplate(project.source.template);
    return { family: `"${template.family}", sans-serif`, weight: template.weight, name: template.family, own: true, settings: project.settings };
  }, [state]);

  const canvasRef = useCoverCanvas(
    (context, { width, height }) => {
      /* Холст прозрачный: под ним матовая плашка `.workshop-cover`. */
      const stretch = (look.settings.width ?? 100) / 100;
      const skew = Math.tan(((look.settings.slant ?? 0) * Math.PI) / 180);
      /* Образец — кириллица: игроки Majestic и GTA 5 RP читают именно её; у шрифта без русских букв браузер подставит соседний. */
      const specimen = "Аа";
      let size = height * 0.66 * ((look.settings.size ?? 100) / 100);
      context.font = `${look.weight} ${Math.round(size)}px ${look.family}`;
      const measured = context.measureText(specimen).width * stretch;
      if (measured > width * 0.7) size *= (width * 0.7) / measured;
      context.font = `${look.weight} ${Math.round(size)}px ${look.family}`;
      context.fillStyle = look.own ? "#f4f1ea" : "rgba(244, 241, 234, 0.9)";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.translate(width / 2, height / 2);
      context.transform(stretch, 0, -skew, 1, 0, 0);
      context.fillText(specimen, 0, 0);
    },
    [look],
  );

  return <canvas ref={canvasRef} className="workshop-cover-canvas" />;
}
