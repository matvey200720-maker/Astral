/*
 * «Интерьеры проектов» — что окно может сделать с источниками.
 *
 * Окно называет проект и номер найденного кэша, либо просит диалог выбора
 * папки; путь ему не нужен и от него не принимается: главный процесс берёт
 * только то, что нашёл сам или что человек выбрал диалогом. Тест подменяет
 * `chooseFolder` и `discover`.
 */

import path from "node:path";
import { PROJECT_IDS, SourceError, addSource, discoverCaches, readSources, removeSource } from "./store.js";

const samePath = (a, b) => path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase();

const projectOf = (input) => {
  const project = String(input?.project || "");
  if (!PROJECT_IDS.includes(project)) throw new SourceError("bad-project", "Неизвестный проект.");
  return project;
};

/** Источники проекта и найденные кэши (только GTA 5 РП: кэш alt:V у Majestic зашифрован). */
export async function readProjectState(input, stateDir, { discover = discoverCaches } = {}) {
  const project = projectOf(input);
  const sources = (await readSources(stateDir)).filter((item) => item.project === project);
  const found = project === "gta5rp" ? await discover().catch(() => []) : [];
  return {
    project,
    /* Пакеты из каталога Astral лежат в хранилище Astral: путь к ним окну не нужен. */
    sources: sources.map(({ id, kind, label, path: folder }) => ({ id, kind, label, path: kind === "astral" ? "" : folder })),
    candidates: found.filter((item) => !sources.some((source) => samePath(source.path, item.path))).map(({ id, kind, label }) => ({ id, kind, label })),
    /* Кэш клиента Majestic (alt:V) зашифрован — интерьеры сервера из него не прочесть. */
    encryptedCache: project === "majestic",
  };
}

/**
 * Добавляет источник: найденный кэш (`candidate` — номер из `readProjectState`)
 * или папка из диалога (`pick: true`). `null` — человек отказался от выбора.
 */
export async function addProjectSource(input, stateDir, { chooseFolder, discover = discoverCaches, gameRoot = "" } = {}) {
  const project = projectOf(input);
  if (input?.candidate) {
    const found = (await discover()).find((item) => item.id === String(input.candidate) && item.project === project);
    if (!found) throw new SourceError("not-found", "Этот кэш уже не найден — обновите список.");
    return addSource(stateDir, { project, folder: found.path, kind: found.kind, gameRoot });
  }
  if (!input?.pick || typeof chooseFolder !== "function") throw new SourceError("bad-request", "Не сказано, что добавить.");
  const folder = await chooseFolder(project);
  if (!folder) return null;
  return addSource(stateDir, { project, folder, kind: "folder", gameRoot });
}

export async function removeProjectSource(input, stateDir) {
  const id = String(input?.id || "");
  if (!/^[a-f0-9]{10}$/.test(id)) throw new SourceError("bad-request", "Нет такого источника.");
  return removeSource(stateDir, id);
}
