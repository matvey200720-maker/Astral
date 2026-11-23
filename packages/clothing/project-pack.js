/*
 * Паки RP-проектов (GTA 5 RP, Nova RP; Majestic придёт позже) — одежда проекта как карточки каталога (решения ведущей 14.11.2026).
 *
 * Паки проекта лежат в дампе `dlcpacks`: `gta5rp_skins7f/dlc.rpf`, `grand_clothes_12/dlc.rpf`. Это вещи самого проекта, а не замены чужого DLC: у `gta5rp_skins7f` внутри
 * `mp_m_freemode_01_mp_m_gta5rp_skins7/teef_011_u.ydd` — коллекция `skins7`, к которой пак просто добавляет номера, а `.ymt` и магазина в паке нет (они в основном паке коллекции).
 * Без этого модуля конвейер читал такой пак как «замену вещи сервера» (`source: "collection"`), автором ставил название поста, а имя вещи брал из имени архива.
 *
 * Что делает модуль: по имени пака узнаёт проект, отдаёт происхождение (новая вещь DLC проекта) и имя вещи с вики проекта из базы серверов (`server-base`).
 * Чистый JS без чтения файлов, кроме ленивого кусочка базы.
 */

import { packOfPath } from "@modovik/pack-intake/dlc-packs";

/**
 * Проекты и их паки. Проект однозначно виден по имени пака (setup2.xml `nameHash` или папка над `dlc.rpf`).
 * `server` — id в базе серверов (`server-base`), по нему ищутся имена с вики; у Nova RP базы нет — имена «Вид №N · проект».
 */
export const PROJECTS = Object.freeze([
  Object.freeze({
    id: "gta5rp",
    name: "GTA 5 RP",
    server: "gta5rp",
    pack: /^gta5rp/i,
  }),
  Object.freeze({
    id: "novarp",
    name: "Nova RP",
    server: null,
    pack: /^grand_clothes/i,
  }),
]);

/** Проект по имени пака — или `null` (пак автора, пак Rockstar). */
export function projectOfPackName(name) {
  const text = String(name ?? "");
  return PROJECTS.find((project) => project.pack.test(text)) ?? null;
}

/** Проект по описанию паков архива (`describeDlcPacks`): первый пак с одеждой, чьё имя назвал проект. */
export function projectOfPacks(packs = []) {
  for (const pack of packs) {
    if (!(pack?.clothing?.items > 0)) continue;
    const project = projectOfPackName(pack.name);
    if (project) return project;
  }
  return null;
}

/** Проект вещи по паку, в котором лежит её файл (`packs` — `describeDlcPacks`): у каждой вещи свой, пак автора и пак проекта в одном архиве не смешиваются. */
export function projectOfItem(packs, item) {
  const path =
    item.models?.[0]?.path || item.sets?.[0]?.textures?.[0]?.path || "";
  return projectOfPackName(packOfPath(packs, path)?.name);
}

/**
 * Происхождение вещи проекта в форме `itemOrigin`: новая вещь DLC проекта (`addon`, источник `dlc`), пак и коллекция — как в файлах.
 * `project` в записи — только для текстов карточки и замечаний; в блок карточки он не идёт (поля `dlc` у выпущенных лаунчеров строгие).
 */
export function projectItemOrigin(project, item, packs = []) {
  const path =
    item.models?.[0]?.path || item.sets?.[0]?.textures?.[0]?.path || "";
  const pack = packOfPath(packs, path);
  const collection = item.collection
    ? String(item.collection).toLowerCase()
    : null;
  return {
    origin: "addon",
    source: "dlc",
    dlc: pack?.name || collection,
    title: project.name,
    collection,
    pack: pack?.name || null,
    project: project.name,
  };
}

/**
 * Метка коллекции в запасном имени: хвост имени коллекции без служебных частей. `mp_m_gta5rp_skins7` → `7`, `mp_f_gta5rp_skins5h` → `5h`, `grand_clothes_3` → `3`, `mp_m_grandreb1` (коллекции Nova RP) → `1`; коллекция
 * без такого хвоста (`grpclothes`, `christmas3`) — целиком. Номера вещей у разных коллекций повторяются (№12 есть и в skins6, и в skins7), метка их различает: «Верх №7.12».
 */
export function collectionLabel(collection) {
  const rest = String(collection ?? "")
    .toLowerCase()
    .replace(/^p_/, "")
    .replace(/^mp_[mf]_/, "");
  return rest.replace(/^(?:gta5rp_skins|grand_clothes_?|grandreb)/, "") || rest;
}

/**
 * Запасное имя вещи проекта, когда имени с вики нет: «<Вид> №<К>.<N> · <проект>». У `teef` проектов вид — «Аксессуар» (без «на шею»: это украшения рук);
 * `kindLabel` — вид кройки или компонента, как его называет конвейер.
 */
export function projectFallbackName(project, item, kindLabel) {
  const kind = item.component === "teef" ? "Аксессуар" : kindLabel;
  const label = collectionLabel(item.collection);
  return `${kind} №${label ? `${label}.` : ""}${item.drawable} · ${project.name}`;
}

/** Тег проекта: название как есть; в карточке тег — нижний регистр (нормализатор `draft.js`, «gta 5 rp»). */
export const projectTag = (project) => project.name;

/**
 * Имя вещи с вики проекта: база серверов по паре «папка коллекции + номер файла». Нет вещи в базе, нет имени у неё или имя помечено «не сверено» — пусто,
 * и конвейер называет вещь сам («Вид №N · проект»). `loadBase` — `loadServerBase` из `server-base.js`; подключается лениво, чтобы окно и работники без проекта базу не тянули.
 */
export async function projectItemName(project, item, { loadBase } = {}) {
  if (!project?.server || !item?.folder || !item.component) return "";
  const load = loadBase ?? (await import("./server-base.js")).loadServerBase;
  const rows = await load({
    server: project.server,
    gender: item.gender ?? "male",
    component: item.component,
  }).catch(() => []);
  const row = rows.find(
    (entry) => entry.folder === item.folder && entry.drawable === item.drawable,
  );
  return row?.name && !row.doubt ? row.name : "";
}
