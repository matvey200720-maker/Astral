/*
 * Над каким проектом работает плитка студии.
 *
 * Плитка мини-карты (прицела, большой карты, залазов) открывала последний
 * ИЗМЕНЁННЫЙ проект своего источника. Пока проекты заводил только сам
 * редактор, это и был тот, над которым человек работал. Теперь проекты
 * появляются и в «Моих работах» — шаблоном по коду, копией, — и «последний
 * изменённый» подменял бы работу человека только что добавленным чужим
 * шаблоном: он зашёл в мини-карту и увидел карту друга.
 *
 * Поэтому плитка помнит свой проект сама: тот, что в ней открывали
 * последним — с плитки или из «Моих работ». Лёгкий модуль без зависимостей:
 * его читают и студия, и список работ.
 */

export const STUDIO_CURRENT_KEY = "astral.workshop.studio-current.v1";

function readMap(storage) {
  try {
    const value = JSON.parse(storage?.getItem(STUDIO_CURRENT_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}

/** Проект, над которым плитка источника `sourceModId` работала последним. */
export function currentStudioProjectId(
  sourceModId,
  storage = globalThis.localStorage,
) {
  const id = readMap(storage)[String(sourceModId || "")];
  return typeof id === "string" ? id : "";
}

/** Запомнить проект плитки: его и откроет следующий заход в редактор. */
export function rememberStudioProject(
  sourceModId,
  projectId,
  storage = globalThis.localStorage,
) {
  const source = String(sourceModId || "");
  if (!source || !projectId) return;
  const map = readMap(storage);
  if (map[source] === projectId) return;
  try {
    storage?.setItem(
      STUDIO_CURRENT_KEY,
      JSON.stringify({ ...map, [source]: String(projectId) }),
    );
  } catch {
    /* Хранилище переполнено — плитка откроет последний изменённый проект,
       как раньше. */
  }
}

/**
 * Проект, который открыть на плитке: запомненный, если он ещё есть, иначе
 * последний изменённый того же источника (проекты лежат новыми вперёд).
 */
export function studioProjectFor(
  sourceModId,
  projects,
  storage = globalThis.localStorage,
) {
  const source = String(sourceModId || "");
  if (!source) return null;
  const list = Array.isArray(projects) ? projects : [];
  const remembered = currentStudioProjectId(source, storage);
  return (
    (remembered &&
      list.find(
        (project) =>
          project?.id === remembered && project.sourceModId === source,
      )) ||
    list.find((project) => project?.sourceModId === source) ||
    null
  );
}
