/*
 * Что ставится в какое издание GTA V (ТЗ 08.10.2026, задача 5).
 *
 * Издание лаунчер определяет сам — по найденным играм (`GTA5_Enhanced.exe`
 * у Enhanced). Мастерская и каталог Astral сделаны для Majestic, GTA 5 RP и
 * «России Онлайн», а эти проекты запускаются только на GTA V Legacy: лаунчер
 * Majestic сверяет папку игры («GTA5.exe, без GTA5_Enhanced.exe»), RAGE MP
 * GTA 5 RP — клиент Legacy. Поэтому моды мастерской ставятся в Legacy, а
 * человеку с Enhanced раздел говорит об этом прямо. Что умеет каждое
 * издание — таблица ниже и `REPORT.md`.
 */

import { useEffect, useState } from "react";
import { detectInstallations } from "../../api.js";
import { tr } from "../../locales/ui.js";

/* Поддержка по разделам: `full` — работает в обоих изданиях, `legacy` —
   только в Legacy (причина — `why`), `builtin` — в Enhanced есть своё. */
export const EDITION_SUPPORT = Object.freeze({
  graphics: Object.freeze({ enhanced: "full", why: "Шаблон пишется и в settings.xml Enhanced (Документы\\Rockstar Games\\GTAV Enhanced): общие ключи и выключение трассировки лучей." }),
  dlss: Object.freeze({ enhanced: "builtin", why: "В GTA V Enhanced DLSS встроен в меню графики игры; сборка ReShade + RenoDX рассчитана на DX11 Legacy, а проекты Majestic, GTA 5 RP и «Россия Онлайн» на Enhanced не запускаются." }),
  workshop: Object.freeze({ enhanced: "legacy", why: "Majestic, GTA 5 RP и «Россия Онлайн» запускаются только на GTA V Legacy — моды мастерской ставятся в Legacy." }),
});

let cached = null;
const listInstallations = () => {
  cached ||= Promise.resolve()
    .then(() => detectInstallations())
    .then((games) => (Array.isArray(games) ? games : []))
    .catch(() => []);
  return cached;
};

/** Сбросить запомненный список игр (для тестов и после «Подключить GTA V»). */
export function forgetGameEditions() {
  cached = null;
}

/** Найденные издания: `{ legacy, enhanced, ready }`. */
export function useGameEditions() {
  const [state, setState] = useState({ legacy: false, enhanced: false, ready: false });
  useEffect(() => {
    let cancelled = false;
    listInstallations().then((games) => {
      if (cancelled) return;
      const edition = (game) => String(game?.edition || "Legacy").toLowerCase();
      setState({
        legacy: games.some((game) => edition(game) === "legacy"),
        enhanced: games.some((game) => edition(game) === "enhanced"),
        ready: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/**
 * Пометка раздела мастерской для `EditionNoticeContext`: у человека только
 * Enhanced — ставить некуда; оба издания — ставится в Legacy; только Legacy
 * — пометки нет (говорить не о чем).
 */
export function workshopEditionNotice({ legacy, enhanced }) {
  if (!enhanced) return null;
  if (!legacy)
    return {
      tone: "warning",
      label: tr("Enhanced: не ставится"),
      detail: tr("У вас GTA V Enhanced. Majestic, GTA 5 RP и «Россия Онлайн» запускаются только на GTA V Legacy — моды мастерской ставятся в Legacy. Установите GTA V Legacy (в Steam — «Grand Theft Auto V Legacy») и подключите её."),
    };
  return {
    tone: "info",
    label: tr("Ставится в Legacy"),
    detail: tr("Найдены GTA V Legacy и Enhanced: моды мастерской ставятся в Legacy — на ней запускаются Majestic, GTA 5 RP и «Россия Онлайн». Enhanced не трогается."),
  };
}
