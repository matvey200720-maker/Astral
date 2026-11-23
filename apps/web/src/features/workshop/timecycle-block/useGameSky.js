/*
 * Небо игры для кадров с куском карты (`SkyBlockStage`): таймцикл игрока на
 * выбранный час, шапки облаков, луна и звёзды — всё, что кадру нужно, кроме
 * самого куска. Общее у «Таймциклов», «Фонарей» (`LampStreetStage`) и «Воды»
 * (`WaterSeaStage`).
 *
 * Папку игры хук находит сам, если её не дали; небо игрока читается один раз
 * (`readBlockSkyBase`), а час — свой расчёт по прочитанному (`blockSkyAt`).
 */

import { useEffect, useMemo, useState } from "react";
import { detectInstallations } from "../../../api.js";
import { useCloudHatSheets, useCloudHats } from "../../../components/desktop/workshop/sky/cloud-hat-data.js";
import useSkyTextures from "../../../components/desktop/workshop/useSkyTextures.js";
import { blockSkyAt, readBlockSkyBase } from "./block-capture.js";

/**
 * @param {object} input
 * @param {string} [input.gameRoot] — папка игры; без неё хук берёт первую Legacy из найденных
 * @param {number} input.hour — час суток кадра
 * @returns {{ gameRoot: string, searched: boolean, sky: object|null, hats: object, sheets: Map, textures: object }}
 *   `searched` — поиск игры закончился (папки может не быть: игры нет)
 */
export default function useGameSky({ gameRoot: given = "", hour }) {
  const [found, setFound] = useState("");
  const [searched, setSearched] = useState(Boolean(given));
  useEffect(() => {
    if (given) return undefined;
    let cancelled = false;
    detectInstallations()
      .then((games) => {
        if (cancelled) return;
        const legacy = (Array.isArray(games) ? games : []).find(
          (item) => item?.path && String(item.edition || "Legacy").toLowerCase() === "legacy",
        );
        if (legacy) setFound(legacy.path);
      })
      .catch(() => {})
      .finally(() => !cancelled && setSearched(true));
    return () => {
      cancelled = true;
    };
  }, [given]);
  const gameRoot = given || found;

  /* Небо игрока читается один раз: час — свой расчёт по прочитанному. */
  const [skyBase, setSkyBase] = useState(null);
  useEffect(() => {
    if (!gameRoot) return undefined;
    let cancelled = false;
    readBlockSkyBase(gameRoot).then((next) => !cancelled && setSkyBase(next));
    return () => {
      cancelled = true;
    };
  }, [gameRoot]);
  const sky = useMemo(() => (skyBase ? blockSkyAt(skyBase, { hour }) : null), [skyBase, hour]);
  const hats = useCloudHats(gameRoot);
  const sheets = useCloudHatSheets(gameRoot, hats, sky?.clouds?.layerFiles);
  const moonAndStars = useSkyTextures(gameRoot);
  return { gameRoot, searched, sky, hats, sheets, textures: moonAndStars.images };
}
