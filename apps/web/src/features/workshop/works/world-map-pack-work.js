import { requestWorkOpen } from "./work-open-request.js";
import { addWorkTemplates as storeTemplates } from "./work-transfer.js";
import { tr } from "../../../locales/ui.js";

// --- настройки и ссылка на часть мода ---------------------------------------

const SETTING_DEFAULTS = { name: "", title: "", geometry: null, open: true };

function readSettings(options) {
  const given = Object.entries(SETTING_DEFAULTS).map(([field, fallback]) => [
    field,
    options[field] === undefined ? fallback : options[field],
  ]);
  return { ...Object.fromEntries(given), source: options.source };
}

// Идентификатор из каталога: любое значение приводится к строке, ложное считается пустым.
const cleanId = (value) => String(value || "").trim();

// Название в ссылке не длиннее 80 знаков; из одних пробелов — пустое.
function partLink({ name, title, source }) {
  const shown = [title, name].find(Boolean);
  const text = shown === undefined ? "" : String(shown).slice(0, 80);
  return {
    modId: cleanId(source?.modId),
    partId: cleanId(source?.partId),
    title: text.trim() ? text : "",
  };
}

const workLabel = ({ name, title }) => String([name, title].find(Boolean) ?? tr("Большая карта мода")).trim();
const workKey = (projectId) => `project:${projectId}`;

// --- этапы ----------------------------------------------------------------------

async function primeGeometry(link, bytes) {
  const source = await import("../../../components/desktop/workshop/world-map-pack-source.js");
  source.primeWorldMapPack(link, bytes);
}

const originOf = (project) => project.modules?.["world-map"]?.base?.packOrigin;

async function findWork(link) {
  const { readWorkshopProjects } = await import("../../../components/desktop/workshop/workshop-project.js");
  const sameLink = (origin) => Boolean(origin) && origin.modId === link.modId && origin.partId === link.partId;
  return readWorkshopProjects().find((project) => sameLink(originOf(project)));
}

// Слои новой карты нарежутся при первом открытии, поэтому пока они отложены.
async function mapConfigFor(link) {
  const { createDefaultWorldMap, normalizeWorldMap, applyMapTemplate, MOD_PACK_TEMPLATE } = await import(
    "@modovik/vector-map"
  );
  const seed = createDefaultWorldMap();
  const withOrigin = { ...seed, base: { ...seed.base, packOrigin: link, packLayers: "pending" } };
  return applyMapTemplate(normalizeWorldMap(withOrigin), MOD_PACK_TEMPLATE);
}

async function draftProject(link, label) {
  const { createWorkshopProject } = await import("../../../components/desktop/workshop/workshop-project.js");
  const project = createWorkshopProject({
    name: label,
    sourceModId: "custom-world-map",
    sourceModName: label,
    enabledModules: ["world-map"],
  });
  Object.assign(project.modules, { "world-map": await mapConfigFor(link) });
  return project;
}

async function recordWork(link, label) {
  const template = { kind: "world-map", name: label, project: await draftProject(link, label) };
  const [created] = await storeTemplates([template]);
  if (!created?.projectId) throw new Error("Работа карты не создалась.");
  return workKey(created.projectId);
}

const announce = (key) => {
  requestWorkOpen(key);
  return key;
};

export async function createWorldMapWorkFromPack(options = {}) {
  const settings = readSettings(options);
  const link = partLink(settings);
  if (!link.modId || !link.partId) throw new Error("Нужны мод и часть каталога, из которых взята карта.");

  if (settings.geometry) await primeGeometry(link, settings.geometry);
  const known = await findWork(link);
  const key = known ? workKey(known.id) : await recordWork(link, workLabel(settings));
  return settings.open ? announce(key) : key;
}
