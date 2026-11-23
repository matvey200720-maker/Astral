/*
 * Документ студии — вместе с работой (ТЗ 18.10.2026, Session 1, задачи 6 и 6Б):
 * «Поставить» кладёт в хранилище окна мастерской (`workshop-assets.js`,
 * IndexedDB) документ слоёв и растры слоёв; повторное открытие продолжает со
 * слоями.
 *
 * Документ хранится под КАРТИНКОЙ, которую студия поставила на поверхность
 * (`<поверхность>@<отпечаток картинки>`), а не просто под поверхностью: у двух
 * работ в «Моих работах» на одной поверхности разные картинки, и слои каждой
 * лежат отдельно — открыл работу, открылись её слои, а не слои той, что правили
 * последней. Работа держит ключ картинки — он и ведёт к её слоям, из какой
 * сессии окна её ни открой. Слои одной поверхности помнятся по восемь последних
 * картинок; документ без поставленной картинки (черновик) — под самой
 * поверхностью. Прежние документы, сохранённые под поверхностью (`meta.asset`),
 * читаются как раньше.
 *
 * Не только хранилище окна: слои можно сохранить файлом и открыть из файла
 * (`studio-file.js`).
 *
 * Ключи: `studio-doc:<имя>` — JSON `{ doc, meta, rasters: [ключи] }`,
 * `studio-raster:<имя>:<слой>` — PNG растра.
 */

import { deleteWorkshopAsset, getWorkshopAsset, listWorkshopAssetKeys, putWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";

const DOC = "studio-doc:";
const RASTER = "studio-raster:";
/** Сколько картинок одной поверхности помнят слои. */
export const STUDIO_DOCUMENTS_PER_SURFACE = 8;

const safe = (key) => String(key || "x").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
/* Отпечаток картинки без вида хранилища (`hangar-emblem:`, `finish-image:`) — короткий и без двоеточия. */
const fingerprint = (asset) => String(asset || "").replace(/^[a-z-]+:/i, "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
const nameOf = (key, asset) => (asset ? `${safe(key)}@${fingerprint(asset)}` : safe(key));

async function readRecord(name) {
  const blob = await getWorkshopAsset(`${DOC}${name}`).catch(() => null);
  if (!blob) return null;
  try {
    const record = JSON.parse(typeof blob.text === "function" ? await blob.text() : await new Response(blob).text());
    return record && typeof record.doc === "string" ? record : null;
  } catch {
    return null;
  }
}

async function dropByName(name) {
  for (const old of await listWorkshopAssetKeys(`${RASTER}${name}:`).catch(() => [])) await deleteWorkshopAsset(old).catch(() => {});
  await deleteWorkshopAsset(`${DOC}${name}`).catch(() => {});
}

/* Лишние документы поверхности (старше последних `STUDIO_DOCUMENTS_PER_SURFACE`) уходят вместе с растрами. */
async function pruneSurface(key) {
  const prefix = `${DOC}${safe(key)}@`;
  const names = (await listWorkshopAssetKeys(prefix).catch(() => [])).map((item) => item.slice(DOC.length));
  if (names.length <= STUDIO_DOCUMENTS_PER_SURFACE) return;
  const dated = [];
  for (const name of names) dated.push({ name, at: (await readRecord(name))?.meta?.savedAt || 0 });
  dated.sort((a, b) => b.at - a.at);
  for (const { name } of dated.slice(STUDIO_DOCUMENTS_PER_SURFACE)) await dropByName(name);
}

/**
 * Сохранить сессию (`session.save()`) поверхности `key`; `meta.asset` — картинка,
 * что студия поставила (документ лежит под ней), `meta.baseKind` — основа.
 */
export async function saveStudioDocument(key, saved, meta = {}) {
  const name = nameOf(key, meta.asset);
  const previous = await listWorkshopAssetKeys(`${RASTER}${name}:`).catch(() => []);
  const keys = Object.keys(saved.rasters);
  for (const [layer, blob] of Object.entries(saved.rasters)) await putWorkshopAsset(`${RASTER}${name}:${layer}`, blob);
  for (const old of previous) if (!keys.includes(old.slice(`${RASTER}${name}:`.length))) await deleteWorkshopAsset(old).catch(() => {});
  const record = { doc: saved.doc, meta: { ...meta, savedAt: Date.now() }, rasters: keys };
  await putWorkshopAsset(`${DOC}${name}`, new Blob([JSON.stringify(record)], { type: "application/json" }));
  if (meta.asset) await pruneSurface(key);
}

async function withRasters(name, record) {
  const rasters = {};
  for (const layer of Array.isArray(record.rasters) ? record.rasters : []) {
    const raster = await getWorkshopAsset(`${RASTER}${name}:${layer}`).catch(() => null);
    if (raster) rasters[layer] = raster;
  }
  return { doc: record.doc, rasters, meta: record.meta || {} };
}

/**
 * Прочитать сохранённое: `{ doc, rasters: { ключ: Blob }, meta }` или `null`.
 * `asset` — картинка, что стоит на поверхности сейчас: слои — именно её; нет
 * картинки — черновик поверхности. Документы прежней версии (под самой
 * поверхностью) подходят, если помнят ту же картинку.
 */
export async function loadStudioDocument(key, asset = "") {
  const exact = nameOf(key, asset);
  const record = await readRecord(exact);
  if (record) return withRasters(exact, record);
  if (!asset) return null;
  const legacyName = safe(key);
  const legacy = await readRecord(legacyName);
  return legacy && legacy.meta?.asset === asset ? withRasters(legacyName, legacy) : null;
}

/** Убрать сохранённое поверхности — и черновик, и слои всех картинок (поверхность сброшена). */
export async function dropStudioDocument(key) {
  await dropByName(safe(key));
  for (const item of await listWorkshopAssetKeys(`${DOC}${safe(key)}@`).catch(() => [])) await dropByName(item.slice(DOC.length));
}
