/*
 * Метки и GPS в игру (задача 9 ТЗ 10.10.2026).
 *
 * Работа уезжает одним нативным патчем со своей точкой отката
 * (`gps-customizer.js` в главном процессе): цвета метки и маршрутов сервера
 * в hudcolor.dat, значок метки в листе значков minimap.ytd и, если выбрана
 * точность «напрямую», узлы дорог paths.rpf. Запись установки запоминает
 * точку, а прежняя версия уходит из стопки (`rememberInstallRecord`).
 *
 * Вид игры при стоящей работе — «вернуть игре её метку и GPS»: он ставится
 * так же, а запись после него забывается — от Astral в игре ничего не
 * осталось.
 */

import { createDefaultGpsWork, gpsWorkIsStock, normalizeGpsWork } from "@modovik/minimap-contract/gps";
import { applyGps } from "../../../../api.js";
import { forgetInstallRecord, rememberInstallRecord } from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";

export const GPS_INSTALL_KEY = "astral.gps.install.v1";

/** Метка, маршруты и узлы Rockstar — вид «Стандарт». */
export const STOCK_GPS_WORK = createDefaultGpsWork();

/** Отпечаток работы для кнопки «Применить»: то, что уходит в игру. */
export function gpsSignature(work) {
  const normalized = normalizeGpsWork(work);
  return JSON.stringify({
    marker: normalized.marker,
    server: { color: normalized.server.color, routes: [...normalized.server.routes].sort() },
    accuracy: normalized.route.accuracy,
  });
}

/**
 * `picture` — квадрат своего значка (PNG base64) или `null`.
 *
 * @param {{ work: object, state: string, picture?: string|null, report?: Function }} input
 * @returns {Promise<{ result: object, record: object|null }>}
 */
export async function installGps({ work, state, picture = null, report = null }) {
  const game = await locateLegacyTarget();
  report?.({ step: "prepare" });
  const result = await applyGps({
    gameRoot: game.path,
    work,
    ...(picture ? { picture: { data: picture, mime: "image/png" } } : {}),
  });
  if (gpsWorkIsStock(work)) {
    forgetInstallRecord(GPS_INSTALL_KEY);
    return { result, record: null };
  }
  const record = await rememberInstallRecord(
    GPS_INSTALL_KEY,
    result,
    {
      editor: "gps",
      gameRoot: game.path,
      installedState: state,
      summary: result?.summary || "",
    },
    { report },
  );
  return { result, record };
}
