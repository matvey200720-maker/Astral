/*
 * Что сказать человеку об итоге установки ReShade, пресета или DLSS 5 (ТЗ 23.10.2026, п. G). Главный процесс отвечает
 * по-русски и именами проектов; страница говорит на языке окна и без перечня проектов, поэтому причины пропуска берутся
 * по номеру места, а не из присланного текста.
 */

/* Почему место пропущено: лаунчер Majestic не найден; нет игры; в корне игры нет загрузчика ASI. */
export function skipReason(copy, id, state) {
  if (id === "majestic") return copy.skip.majestic;
  const game = (state?.targets || []).find((item) => item.id === "game");
  return game && game.available === false ? copy.skip.game : copy.skip.asi;
}

/** Причины пропуска мест, куда ReShade не встанет, — одной строкой через «;». */
export function skippedReasons(copy, state, ids = null) {
  const places = (state?.places || []).filter(
    (place) => !place.ready && (!ids || ids.includes(place.id)),
  );
  return places.map((place) => skipReason(copy, place.id, state)).join("; ");
}

/**
 * Части уведомления об итоге `applyReshade`: что пропущено и включена ли в лаунчере Majestic поддержка модов.
 * `dlssCopy` — тексты `reshade-copy.js` (там слова про поддержку модов).
 */
export function outcomeParts(result, state, copy, dlssCopy) {
  const targets = result?.targets || [];
  const skippedIds = targets
    .filter((item) => item.action === "skipped")
    .map((item) => item.id);
  return {
    skipped: skippedReasons(copy, state, skippedIds),
    support: targets.some(
      (item) => item.action === "installed" && item.modSupport === "on",
    )
      ? dlssCopy.supportNotice
      : "",
  };
}
