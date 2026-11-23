import { useCallback, useEffect, useMemo, useState } from "react";
import { readHardware } from "../../api.js";
import { useChannels } from "../updates/channels-store.js";
import { useLibrary } from "../../components/desktop/builds/use-library.js";
import {
  cardViews,
  visibleProfiles,
} from "../../components/desktop/builds/build-views.js";
import { buildWorksEnabled } from "../builds/works-switch.js";
import { useInstalledWorkItems } from "../library/useMyMods.js";
import { readAppliedOptimizerSummary } from "../library/libraryInstalled.js";
import {
  badgeGroups,
  badgeProgress,
  badgeSummary,
  nearestBadges,
} from "./badge-progress.js";
import { markSeen, recentIds, syncLedger, unseenIds } from "./badge-ledger.js";
import {
  accessRows,
  accountContacts,
  coverCandidates,
  hasDiscord,
  installedTiles,
  rankOf,
  tileCounts,
  totalBytes,
} from "./profile-facts.js";

const NO_MODS = [];

/*
 * Всё, что страница «Профиль» берёт из окна, одним ответом: что стоит в игре,
 * значки и их цифры, доступ по веткам, железо, сборки. Сервера здесь нет: что
 * окну не присылают, в ответе пустое (`contacts`) или «скоро» (значки без
 * источника, `badge-defs.js`).
 */
export default function useProfileData({
  account,
  data,
  installed,
  profiles,
  favorites,
  catalogMods = NO_MODS,
  catalogConnection = null,
}) {
  const library = useLibrary({
    catalogMods,
    libraryMods: data?.mods || NO_MODS,
    installed,
    profiles,
    catalogConnection,
  });
  const { modsById, entriesOf } = library;
  const workItems = useInstalledWorkItems(installed);
  const channelsStore = useChannels();
  const channels = channelsStore.state;
  /* `undefined` — железо ещё читается (на месте названия и памяти стоят серые плиты); `null` — читать нечем или не вышло. */
  const [hardware, setHardware] = useState(undefined);
  useEffect(() => {
    let alive = true;
    readHardware().then(
      (value) => alive && setHardware(value ?? null),
      () => alive && setHardware(null),
    );
    return () => {
      alive = false;
    };
  }, []);

  const tiles = useMemo(
    () =>
      installedTiles({
        installed,
        modsById,
        mods: data?.mods || NO_MODS,
        workItems,
      }),
    [installed, modsById, data?.mods, workItems],
  );
  const counts = useMemo(() => tileCounts(tiles), [tiles]);
  const covers = useMemo(() => coverCandidates(tiles), [tiles]);
  const access = useMemo(() => accessRows(channels), [channels]);
  /* Снимок применённой оптимизации лежит в хранилище, а не в `installed`: его перечитывают, когда меняется то, что стоит в игре. */
  const optimizer = useMemo(
    () => installed !== null && Boolean(readAppliedOptimizerSummary()),
    [installed],
  );

  const groups = useMemo(() => {
    const progress = badgeProgress({
      tiles,
      counts,
      installed,
      builds: profiles.length,
      favorites: favorites.length,
      access,
      discord: hasDiscord(account),
      optimizer,
    });
    return badgeGroups(progress);
  }, [
    tiles,
    counts,
    installed,
    profiles.length,
    favorites.length,
    access,
    account,
    optimizer,
  ]);
  const summary = useMemo(() => badgeSummary(groups), [groups]);
  const earned = useMemo(
    () =>
      groups
        .flatMap((group) => group.items)
        .filter((item) => item.info.state === "got"),
    [groups],
  );
  const earnedKey = earned.map((item) => item.badge.id).join(",");

  /* Журнал значков: что получено нового с прошлого раза (`badge-ledger.js`); пишется, когда страница считает значки. */
  const earnedIds = useMemo(
    () => (earnedKey ? earnedKey.split(",") : []),
    [earnedKey],
  );
  /* Пока каталог не пришёл, мод по id не опознать, и первый подсчёт занизил бы набор: тогда всё «дополученное» позже выглядело бы новым. */
  const catalogReady = !catalogConnection?.gap?.catalog;
  const [ledger, setLedger] = useState(null);
  useEffect(() => {
    if (catalogReady) setLedger(syncLedger(earnedIds).ledger);
  }, [catalogReady, earnedIds]);
  const unseen = useMemo(
    () => (ledger ? unseenIds(ledger, earnedIds) : []),
    [ledger, earnedIds],
  );
  const recent = useMemo(
    () => recentIds(ledger || { earned: {} }, earnedIds),
    [ledger, earnedIds],
  );

  const seeIds = useCallback((ids) => {
    if (ids.length > 0) setLedger(markSeen(ids));
  }, []);

  /* Работы мастерской в сборках — под тем же выключателем, что и страница «Сборки». */
  const worksOn = buildWorksEnabled();
  const views = useMemo(
    () =>
      cardViews(
        visibleProfiles(profiles, worksOn),
        entriesOf,
        modsById,
        workItems.map((item) => item.name),
        workItems,
      ),
    [profiles, worksOn, entriesOf, modsById, workItems],
  );

  return {
    modsById,
    allMods: data?.mods || NO_MODS,
    tiles,
    counts,
    bytes: totalBytes(tiles),
    covers,
    cover: covers[0] || null,
    access,
    /* Снимок веток и данные окна ещё едут — боковые карточки рисуют каркас с серыми плитами, а не пустоту и не прыжок. */
    accessLoading: !channelsStore.loaded,
    countsLoading: installed === null,
    hardwareLoading: hardware === undefined,
    rank: rankOf(account, access),
    contacts: accountContacts(account),
    discord: hasDiscord(account),
    hardware,
    groups,
    summary,
    nearest: nearestBadges(groups),
    recent,
    unseen,
    markSeen: seeIds,
    views,
  };
}
