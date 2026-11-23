import { translateOverlayFiles } from "@modovik/install-engine/overlays-update-route.js";

/*
 * Что сказать человеку после установки тату (режим RP, 21.11.2026, `docs/RP-OVERLAYS-CONTAINER.md`): картинка наложения ушла в контейнер `astral_rp_overlays.rpf` внутри `update.rpf`
 * или осталась в хосте `astral_clothing` (отказ маршрута: папка в записи, чужое имя, не `import`, повтор). Хост клиент RAGE MP не подключает — подтверждено для одежды, пакет тот же —
 * поэтому остаток в хосте при включённом режиме честно называется: «записано в Astral Clothing DLC, на GTA 5 RP не видно». Когда всё ушло в контейнер, слов нет: на сервере тату не снимали,
 * обещать нечего. Режим выключен — слов нет вовсе (ответ прежний, байт в байт).
 *
 * Ответ — той же формы, что `installVisibility` одежды (`{ problems, clean }`): окно говорит его кодами (`features/clothing/install-words.js`), Desktop слов не пишет.
 * Чистый модуль: диска и реестра не трогает.
 */

/**
 * @param {{ files?: Array<object>, route?: object|null }} input `files` — записи манифеста пакета тату как они в нём (форма хоста); `route` — маршрут наложений (`overlaysUpdateRoute` из настроек установки), пусто — режим выключен
 * @returns {{ problems: Array<{ level: "warn", code: "overlay-astral", partial: boolean }>, clean: false } | null} `null` — говорить нечего
 */
export function overlayInstallVisibility({ files = [], route = null } = {}) {
  if (!route) return null;
  /* Тот же перевод, что делает установка (`translateCheckedOverlays`): остаток — то, что он оставил в хосте. */
  const { moved, kept } = translateOverlayFiles({ files: Array.isArray(files) ? files : [] });
  if (!kept.length) return null;
  return { problems: [{ level: "warn", code: "overlay-astral", partial: moved > 0 }], clean: false };
}

/** Один ответ на несколько пакетов одного «Применить» (покраска по тату — пакет на тату): «часть» — только если у каждого пакета часть картинок ушла; `null` — говорить нечего. */
export function mergeOverlayVisibility(list = []) {
  const found = (Array.isArray(list) ? list : []).filter(Boolean);
  if (!found.length) return null;
  const partial = found.every((item) => item.problems?.[0]?.partial === true);
  return { problems: [{ level: "warn", code: "overlay-astral", partial }], clean: false };
}
