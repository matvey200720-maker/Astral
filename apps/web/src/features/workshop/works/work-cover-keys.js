import { storedStateName } from "../../../stored-json.js";
import { listWorkshopWorks } from "./workshop-works.js";
import { slotCoverKey } from "./work-covers.js";

/*
 * Где лежит снимок работы — один ответ на библиотеку, «Мои работы» и сборки (31.10.2026, владелец: одна работа в библиотеке и в сборке выглядела
 * по-разному). Раньше у каждого был свой ключ: библиотека спрашивала `project:<id>` и «Мои работы», а сборка — свой `work:project:<id>:<плитка>` и
 * `build:<длина кода>:<имя>`, под которыми снимков не лежит никогда, поэтому в сборке всегда стоял запасной вид.
 *
 * Порядок: проект студии → сохранённая работа → снимок поставленного без сохранения (`slot:<плитка>`, его пишет «Применить»).
 */

/* Ключи, под которыми снимки лежат на самом деле (`work-covers.js`). */
const SAVED_KEY = /^(work|project):[^:]+$/;

/** Ключ обложки работы, что стоит в слоте: проект студии — по id, работа редактора — по «Моим работам». */
export function installedCoverKey(slotId, projectId = "") {
  if (projectId) return `project:${projectId}`;
  return listWorkshopWorks().find((item) => item.installed && item.slotId === slotId)?.key || "";
}

/**
 * Ключи снимка работы по порядку: первый найденный и есть её картинка.
 * `work` — `{ coverKey?, key?, slotId, projectId?, installed? }`; `installed` — работа стоит в игре (библиотека, «стоит в игре» у сборки).
 */
export function workCoverKeys(work) {
  if (!work) return [];
  const keys = [
    work.coverKey,
    work.projectId ? `project:${work.projectId}` : "",
    SAVED_KEY.test(String(work.key || "")) ? work.key : "",
  ];
  /* У проекта снимок свой, он уже назван. */
  if (work.installed && work.slotId && !work.projectId) keys.push(installedCoverKey(work.slotId), slotCoverKey(work.slotId));
  return [...new Set(keys.filter(Boolean))];
}

/**
 * Ключи снимка работы из кода сборки: проект из кода, сохранённая работа того же вида и имени, а если в игре стоит именно она (тот же снимок или то же
 * имя: код сборки держит правку в своём виде, строка может отличаться) — снимок поставленного. На чужой машине снимка нет: у работы запасной вид.
 */
export function buildEntryCoverKeys(entry, { state = null, projectId = "", installedState = null } = {}) {
  const saved = listWorkshopWorks().find((item) => item.workKind === entry?.workKind && item.name === entry?.name)?.key;
  const keys = [projectId ? `project:${projectId}` : "", saved];
  const inGame = Boolean(installedState) && (installedState === state || storedStateName(installedState) === entry?.name);
  if (inGame) keys.push(slotCoverKey(entry?.slotId));
  return [...new Set(keys.filter(Boolean))];
}
