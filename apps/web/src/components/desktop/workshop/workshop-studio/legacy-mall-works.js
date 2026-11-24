/*
 * Прежний редактор фасадов «Davis Mega Mall» / «Ашан · You Tool» (`MegaMallCustomizer.jsx`, оверлей в `newmods`, ему нужна пара
 * загрузчиков): с 23.11.2026 для НОВОЙ работы входа нет — «Мастерская Мегамолла» живёт в новой студии зданий
 * (`building-editor`, набор мест `astral_places`, без загрузчика). Плитки прежнего редактора остаются на витрине только у того,
 * у кого есть прежняя работа: сохранённый проект или поставленный оверлей — чтобы её можно было открыть и снять
 * (корзина библиотеки видит оверлей и сама, `workshop-library.js`).
 *
 * Читаются те же ключи, что пишет сам редактор: список проектов (`astral-mega-mall-projects-v1`) и слепок установки
 * (`astral.mega-mall.install.v1`). Ничего не пишется; недоступное хранилище — «работ нет».
 */
import { MEGA_MALL_INSTALL_KEY } from "../../../../workshop-library.js";

export const MEGA_MALL_PROJECTS_KEY = "astral-mega-mall-projects-v1";

const storageOf = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** Какие плитки прежнего редактора ещё нужны: `{ megaMall, youTool }`. */
export function legacyMallWorks(storage = storageOf()) {
  const works = { megaMall: false, youTool: false };
  if (!storage) return works;
  try {
    const projects = JSON.parse(storage.getItem(MEGA_MALL_PROJECTS_KEY) || "[]");
    if (Array.isArray(projects))
      for (const project of projects) {
        if (!project || typeof project !== "object") continue;
        if (String(project.profileId || "").startsWith("you-tool")) works.youTool = true;
        else works.megaMall = true;
      }
  } catch {
    /* Битый список проектов — редактор сам отложит его в карантин; плитку из-за него не показываем. */
  }
  try {
    if (storage.getItem(MEGA_MALL_INSTALL_KEY)) works.megaMall = true;
  } catch {
    /* Хранилище недоступно — слепка нет. */
  }
  return works;
}
