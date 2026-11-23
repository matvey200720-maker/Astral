/*
 * Откуда предпросмотр «Шрифтов» берёт шрифты.
 *
 *   свой шрифт — шаблон из Windows этого компьютера (байты читает Astral
 *                Desktop: `readFontSources({ template })`) или свой файл из
 *                хранилища окна;
 *   шрифт игры — штатная библиотека шрифтов из игры самого игрока (основа
 *                update.rpf, `readFontSources({ game })`): в поставке
 *                Astral шрифтов Rockstar нет, и окно получает их только
 *                отсюда — для вида «Как в игре» и для букв, которых в своём
 *                шрифте нет (они остаются буквами игры, как у установщика).
 *
 * Разобранные шрифты кэшируются на всё окно: кадр, плитки и обложка берут
 * одни и те же.
 */

import { useEffect, useState } from "react";
import { GAME_FONT_TARGETS } from "@modovik/climb-contract/recolor/fonts";
import { listGfxFonts, readFontFile } from "@modovik/gfx/fonts";
import { readFontSources } from "../../../api.js";
import { detectLegacyGame } from "../install-queue/game-root.js";
import { fontFileBytes } from "./font-file.js";

const templateFonts = new Map();
let templateList = null;
let gameFonts = null;

const parse = (bytes) => readFontFile(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

/** Шрифт шаблона: `{ font }`, `{ missing: true }` или `null` без Astral Desktop. */
export function loadTemplateFont(id) {
  if (!templateFonts.has(id))
    templateFonts.set(
      id,
      readFontSources({ template: id })
        .then((answer) => {
          if (!answer?.template) return null;
          if (answer.template.missing || !answer.template.bytes) return { missing: true };
          return { font: parse(answer.template.bytes) };
        })
        .catch((error) => ({ error: error?.message || String(error) })),
    );
  return templateFonts.get(id);
}

/** Какие шаблоны есть в этом Windows: `Map(id → есть)` или `null` без Astral Desktop. */
export function loadTemplateList() {
  templateList ||= readFontSources({ templates: true })
    .then((answer) => (Array.isArray(answer?.templates) ? new Map(answer.templates.map((item) => [item.id, Boolean(item.available)])) : null))
    .catch(() => null);
  return templateList;
}

/**
 * Шрифты игры игрока: `{ source, fonts: Map(имя экспорта → шрифт) }` или
 * `null`, если игры нет или Astral Desktop недоступен.
 */
export function loadGameFonts() {
  gameFonts ||= detectLegacyGame()
    .catch(() => "")
    .then((gameRoot) => readFontSources({ game: true, gameRoot: gameRoot || undefined }))
    .then((answer) => {
      const bytes = answer?.game?.bytes;
      if (!bytes) return null;
      const fonts = new Map();
      for (const item of listGfxFonts(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)))
        for (const name of item.exports) fonts.set(name, item.font);
      return GAME_FONT_TARGETS.some((target) => fonts.has(target.export)) ? { source: answer.game.source, fonts } : null;
    })
    .catch(() => null);
  return gameFonts;
}

/**
 * Свой шрифт работы: `{ status, font, error }`; `status` — `loading`,
 * `ready`, `missing` (шаблона нет в Windows / файл пропал), `offline` (байты
 * шаблона читает только Astral Desktop) или `error`.
 */
export function useSourceFont(project) {
  const kind = project.source.kind;
  const key = kind === "file" ? project.source.file.asset : project.source.template;
  const [state, setState] = useState({ key: "", status: "loading", font: null, error: "" });
  useEffect(() => {
    let cancelled = false;
    const settle = (next) => {
      if (!cancelled) setState({ key, font: null, error: "", ...next });
    };
    if (kind === "file" && !key) {
      settle({ status: "missing" });
      return undefined;
    }
    const pending =
      kind === "file"
        ? fontFileBytes(key).then((bytes) => (bytes ? { status: "ready", font: parse(bytes) } : { status: "missing" }))
        : loadTemplateFont(key).then((answer) =>
            !answer
              ? { status: "offline" }
              : answer.missing
                ? { status: "missing" }
                : answer.error
                  ? { status: "error", error: answer.error }
                  : { status: "ready", font: answer.font },
          );
    pending.then(settle).catch((error) => settle({ status: "error", error: error?.message || String(error) }));
    return () => {
      cancelled = true;
    };
  }, [kind, key]);
  return state.key === key ? state : { key, status: "loading", font: null, error: "" };
}

/** Шрифты игры игрока для кадра: `null`, пока не прочитаны или если их нет. */
export function useGameFonts() {
  const [game, setGame] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadGameFonts().then((value) => {
      if (!cancelled) setGame(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return game;
}

/** Есть ли шаблоны в Windows: `Map` или `null` (не знаем — все доступны). */
export function useTemplateList() {
  const [list, setList] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadTemplateList().then((value) => {
      if (!cancelled) setList(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return list;
}
