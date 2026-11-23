import { tr } from "../../locales/ui.js";
import { PROJECTS, modProjects } from "./catalog-projects.js";

/*
 * Проекты, о которых говорят фильтр каталога и страница мода (ТЗ 24.10.2026, пп. 13 и B вечера): GTA 5 RP и Majestic.
 * «Россия Онлайн» запускает клиент Majestic, отдельным пунктом она не стоит. Знаки проектов на карточках каталога
 * убраны (ТЗ 24.10.2026, вечер, п. A): на карточке остаются имя, сердечко и под курсором — загрузки и вес.
 */
export const CARD_PROJECTS = Object.freeze(["gta5rp", "majestic"]);

/**
 * Что написано в строке «Для какого проекта» панели фактов страницы мода (ТЗ 24.10.2026, вечер, п. B): «GTA 5 RP»,
 * «Majestic» или «GTA 5 RP и Majestic». Мод ни под один из двух (только «Россия Онлайн» или RMRP) строки не получает.
 */
export function projectFactText(mod) {
  const fits = cardProjectsOf(mod);
  if (fits.length === CARD_PROJECTS.length) return tr("GTA 5 RP и Majestic");
  return fits[0]?.label || "";
}

/** Проекты, под которые подходит мод, в порядке `CARD_PROJECTS`: `[{ id, label, logo, … }]`. */
export function cardProjectsOf(mod, byId = null) {
  const fits = modProjects(mod, byId);
  return CARD_PROJECTS.filter((id) => fits.has(id)).map((id) => PROJECTS.find((project) => project.id === id));
}
