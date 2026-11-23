/*
 * Картинки работы «Дирижабли» для главного процесса (ТЗ 11.10.2026):
 *
 *   • при своей надписи, картинке или своих цветах дирижабля окно рисует
 *     весь лист `blimp_sign_1` (512 × 256, разметка листа игры) и отдаёт
 *     его PNG — `sign: { data: <base64> }`; «как в игре» — без него, лист
 *     берётся из игры игрока;
 *   • у своих моделей в небе с лого или своей текстурой (ТЗ 11.10.2026,
 *     вечер) — лист картинки модели (`airshipSkinSheet`, размер по
 *     `AIRSHIP_SKINS`) — `skins: { <вид>: { data } }`.
 *
 * Нечего везти — `null`. Без кадра редактора: так ставит и «Применить», и
 * работа из «Моих работ» или сборки.
 */

import { AIRSHIP_KIND_IDS, airshipDecorated, airshipSignChanged, normalizeAirshipsProject } from "@modovik/climb-contract/recolor/airships";
import { encodePng } from "@modovik/gfx/png";
import { airshipSignSheet } from "./airships-sign.js";
import { airshipSkinSheet } from "./airships-skin.js";

function bytesBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

const pngData = (sheet) => ({ data: bytesBase64(encodePng(new Uint8Array(sheet.rgba.buffer, sheet.rgba.byteOffset, sheet.rgba.byteLength), sheet.width, sheet.height, 4)) });

/** Своим моделям в небе нужен лист картинки: вид летает и у него лого или своя текстура. */
export const airshipSkinKinds = (project) => AIRSHIP_KIND_IDS.filter((id) => project.fleet[id].count > 0 && airshipDecorated(id, project));

export async function airshipsImages(input) {
  const project = normalizeAirshipsProject(input);
  const out = {};
  if (airshipSignChanged(project)) {
    const sheet = await airshipSignSheet(project, { strict: true });
    if (sheet) out.sign = pngData(sheet);
  }
  const skins = {};
  for (const id of airshipSkinKinds(project)) {
    const sheet = await airshipSkinSheet(id, project, { strict: true });
    if (sheet) skins[id] = pngData(sheet);
  }
  if (Object.keys(skins).length) out.skins = skins;
  return Object.keys(out).length ? out : null;
}
