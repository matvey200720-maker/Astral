/*
 * Картинки арены для «Применить»: эмблема на фасаде, экраны, эмблемы зала,
 * звезда и свои картинки отделки поверхностей.
 *
 * Все они живут в хранилище окна под отпечатком (`hangar-emblem:<sha256>`,
 * как эмблемы ангара, завода и маппинга): в работе — только ключ, имя и
 * размер. Главному процессу уходят base64-строкой — только те, что работа
 * выбранного сервера действительно берёт (`arenaImageAssets`).
 */

import { arenaImageAssets, arenaPictureText, arenaReplacementModels, normalizeArenasProject } from "@modovik/climb-contract/recolor/arenas";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { finishImagesFor } from "../finish/finish-assets.js";
import { drawEmblemText } from "../emblem/emblem-items.js";
import { placeModelImages } from "../models/model-assets.js";
import { tr } from "../../../locales/ui.js";

const LABELS = Object.freeze({
  emblem: "Картинка эмблемы",
  screens: "Картинка экранов",
  signs: "Картинка табличек",
  logos: "Картинка эмблем зала",
  posters: "Картинка плакатов",
  star: "Картинка звезды",
  mazeSign: "Надпись Maze Bank Arena",
  outLogos: "Картинка логотипа снаружи",
  outBanners: "Картинка баннеров у входов",
  sign: "Надпись на домике",
  mod: "Картинка листа мода",
});

async function assetData(asset, key) {
  const blob = await getWorkshopAsset(asset);
  if (!blob) throw new Error(`${LABELS[key]} пропала из хранилища окна — загрузите её ещё раз.`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

/** `{ emblems?, screens?, signs?, logos?, posters?, star?, finishes? }` (`emblems` — `{ <asset>: { data } }`, остальные — `{ data }`) или `null`. */
export async function arenaImages(project) {
  const normal = normalizeArenasProject(project);
  const settings = normal[normal.server];
  const out = {};
  const { emblems = [], ...pictures } = arenaImageAssets(normal);
  if (emblems.length) {
    out.emblems = {};
    for (const asset of emblems) out.emblems[asset] = { data: await assetData(asset, "emblem") };
  }
  for (const [key, asset] of Object.entries(pictures)) {
    /* Ключ раздела (`posters`), элемента (`posters:show.3`, задача 10) или надписи домика (`sign:stand`). */
    const [section] = key.split(":");
    /* Свой текст надписи — рисует окно той же функцией, что надписи эмблем. */
    if (asset === "text") {
      const drawn = await drawEmblemText(arenaPictureText(settings, key));
      if (!drawn) throw new Error(`${LABELS[section] || tr("Надпись")}: нарисовать текст не вышло — нажмите «Применить» ещё раз.`);
      out[key] = { data: await assetData(drawn.asset, section) };
    } else out[key] = { data: await assetData(asset, section) };
  }
  const finishes = await finishImagesFor([settings.facade, settings.floor, settings.walls, settings.ceiling]);
  if (finishes) Object.assign(out, finishes);
  /*
   * Свои модели выбранного сервера (задача 1 ТЗ 11.10.2026, вечер) и свои
   * модели вместо моделей сервера (Majestic: аирдропы, болид, домики) —
   * одним списком: их картинки и сетки главный процесс читает из одних
   * `modelImages`/`modelMeshes`. Без замен «Применить» отказывало «Картинка
   * своей модели не пришла» (12.10.2026).
   */
  const models = await placeModelImages([...settings.models, ...arenaReplacementModels(normal)]);
  if (models) Object.assign(out, models);
  return Object.keys(out).length ? out : null;
}
