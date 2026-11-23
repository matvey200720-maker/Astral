import { useEffect, useState } from "react";
import { tr } from "../../../locales/ui.js";

const MAP_KIND = "world-map";
const CHOICE_PREFIX = "map:";
const WORK_PREFIX = "project:";
const IDS_SEPARATOR = "|";

// Тяжёлые модули мастерской подгружаются только тогда, когда они правда нужны.
const loadProjects = () => import("../../../components/desktop/workshop/workshop-project.js");
const loadTransfer = () => import("../../workshop/works/work-transfer.js");
const loadQueue = () => import("../../workshop/work-install/install-build-works.js");

const doNothing = () => {};

const readAllProjects = async () => (await loadProjects()).readWorkshopProjects();

/** Исходная часть карты, из которой сделан проект или шаблон. */
const originPartId = (holder) => holder?.modules?.[MAP_KIND]?.base?.packOrigin?.partId;

const statusesOf = (project) =>
  Array.isArray(project.installations) ? project.installations.map((record) => record?.status) : [];

const hasActiveInstallation = (project) => statusesOf(project).includes("active");

const projectTitle = (project) => String(project.name ?? "").trim() || tr("Своя карта");

// Поля работы в том порядке, в каком их видят вызывающие.
const WORK_FIELDS = [
  ["key", (project) => WORK_PREFIX + project.id],
  ["projectId", (project) => project.id],
  ["partId", (_project, partId) => partId],
  ["name", projectTitle],
  ["installed", hasActiveInstallation],
];

const workOf = (project, partId) =>
  Object.fromEntries(WORK_FIELDS.map(([field, take]) => [field, take(project, partId)]));

export function mapChoiceKey(partId) {
  return CHOICE_PREFIX + partId;
}

export const partMapWorks = async (partId) => {
  if (!partId) return [];

  const projects = await readAllProjects();
  return projects.flatMap((project) => (originPartId(project) === partId ? [workOf(project, partId)] : []));
};

const signatureOf = (partIds) => partIds.filter(Boolean).join(IDS_SEPARATOR);

async function collectParts(ids) {
  const lists = await Promise.all(ids.map((id) => partMapWorks(id)));
  return Object.fromEntries(ids.map((id, at) => [id, lists[at]]));
}

/** Запускает загрузку и отдаёт отмену: запоздавший ответ уже никому не нужен. */
function followParts(ids, deliver) {
  let awaited = true;

  collectParts(ids).then((answer) => {
    if (awaited) deliver(answer);
  }, doNothing);

  return () => {
    awaited = false;
  };
}

const NOT_LOADED = {};

export function usePartMapWorks(partIds = []) {
  const signature = signatureOf(partIds);
  const [answer, setAnswer] = useState(NOT_LOADED);

  useEffect(
    () => (signature ? followParts(signature.split(IDS_SEPARATOR), setAnswer) : undefined),
    [signature],
  );

  return signature === "" ? {} : answer;
}

export const chosenMapWork = (partId, works = {}, choices = {}) => {
  const wanted = choices[mapChoiceKey(partId)];
  const candidates = works[partId] || [];
  const at = candidates.findIndex((work) => work.key === wanted);
  return at === -1 ? null : candidates[at];
};

const failMissing = (name) => {
  throw new Error(`Работы «${name}» больше нет.`);
};

const findProject = async (projectId) => {
  const projects = await readAllProjects();
  return projects.find((candidate) => candidate.id === projectId);
};

export const mapWorkEntry = async (work) => {
  const { projectId, name } = work;

  const project = (await findProject(projectId)) ?? failMissing(name);
  const transfer = await loadTransfer();
  const made = await transfer.studioCode(project, MAP_KIND);
  return { name, workKind: MAP_KIND, code: made.code };
};

const standsIn = (installed) => (work) => installed.includes(work.partId);

export const blockedMapWorks = (works = [], installed = []) => works.filter(standsIn(installed));

export const installMapWorks = async (works, { notify = doNothing } = {}) => {
  if (!works?.length) return null;

  // Очередь подгружается, пока собираются записи; ошибка записи отменяет установку.
  const queueLoading = loadQueue();
  const entriesBuilding = Promise.all(works.map((work) => mapWorkEntry(work)));

  return Promise.all([queueLoading, entriesBuilding]).then(([queue, entries]) =>
    queue.installBuildWorks(entries, { notify }),
  );
};

const isMapRecord = (entry) => entry?.workKind === MAP_KIND;

/**
 * Исходные части шаблонов, записи читаются по одной и по порядку.
 * Исключение самого вызова читателя уходит наружу, отказ его обещания пропускает запись.
 */
async function* originsOf(records, reader) {
  for (const { code } of records) {
    const pending = reader(code);
    let reply;
    try {
      reply = await pending;
    } catch {
      continue;
    }

    for (const template of reply?.templates ?? []) yield originPartId(template?.project);
  }
}

export const partsReplacedByWorks = async (works = [], { read = null } = {}) => {
  const records = (works ?? []).filter(isMapRecord);
  if (records.length === 0) return new Set();

  const reader = read || (await loadTransfer()).readWorkCode;

  const origins = [];
  for await (const partId of originsOf(records, reader)) origins.push(partId);
  return new Set(origins.filter(Boolean));
};
