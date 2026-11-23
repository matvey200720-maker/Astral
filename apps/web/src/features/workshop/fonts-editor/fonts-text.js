/*
 * Слова редактора шрифтов: строка состояния, подпись кадра и то, что уйдёт
 * в игру.
 */

import { GAME_FONT_TARGETS, fontTemplate, fontsProjectIsVanilla } from "@modovik/climb-contract/recolor/fonts";
import { tr } from "../../../locales/ui.js";

/** Имя шрифта работы: семейство шаблона или своего файла. */
export function fontNameOf(project) {
  if (project.source.kind === "file") return project.source.file.family || project.source.file.name || tr("Свой файл");
  return fontTemplate(project.source.template).family;
}

/** Строка состояния: какой шрифт. */
export function fontsStatusText(project) {
  if (fontsProjectIsVanilla(project)) return tr("Шрифты игры");
  return `${fontNameOf(project)} · во всех текстах игры`;
}

/** Что с исходником своего шрифта — одной строкой для панели. */
export function sourceStatusText(status, project) {
  if (status === "loading") return tr("Читаем шрифт…");
  if (status === "offline") return tr("Шаблоны Windows читает Astral Desktop — в браузере кадр рисует название шрифтом окна, приближённо.");
  if (status === "missing")
    return project.source.kind === "file"
      ? tr("Файл шрифта пропал из хранилища окна — загрузите его ещё раз.")
      : `Шрифта «${fontTemplate(project.source.template).family}» нет в Windows этого компьютера — выберите другой шаблон.`;
  if (status === "error") return tr("Шрифт не читается — возьмите другой файл.");
  return "";
}

/** Шрифты игры, на место которых встаёт свой, — одной строкой. */
export const GAME_FONTS_TEXT = GAME_FONT_TARGETS.map((target) => `${target.label.toLowerCase()} (${target.game})`).join(", ");

/**
 * Строки состояния кадра (в панели редактора): прочитан ли шрифт игры, чьи буквы в кадре, что рисует сама игра. Куда встанет шрифт и
 * предупреждение об античите стоят в панели инструмента (`FontsInspector`).
 */
export function fontsNotes({ project, game, own = false }) {
  const notes = [];
  if (fontsProjectIsVanilla(project))
    notes.push(
      game
        ? { text: tr("Название основного шрифта игры его же буквами — из вашей игры.") }
        : { text: tr("Шрифты игры не прочитаны (нет Astral Desktop или игры): название подписано шрифтом окна."), warn: true },
    );
  else if (own)
    notes.push({
      text: tr(
        "Название шрифта его же буквами — те же контуры, что уедут в игру: подгонка под высоту заглавных шрифта игры, ширина, толщина, интервал, наклон и подъём считаются так же, как у установщика.",
      ),
    });
  notes.push({ text: tr("Обводку, тень, цвет и прозрачность текста рисует сама игра у каждого текста — в файле шрифта их нет.") });
  return notes;
}

/** Итог установки одной строкой. */
export function fontsDoneText(result) {
  if (result?.status === "unchanged") return tr("Шрифты в игре уже такие — ставить было нечего");
  const font = result?.font ? `«${result.font}» ` : "";
  return `Шрифт ${font}установлен в тексты игры. Перезапустите игру.`;
}

/** Доля в процентах — для пояснений. */
export const percent = (value) => `${Math.round(value * 100)} %`;
