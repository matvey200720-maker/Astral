import { tr } from "../../../../locales/ui.js";
import { describeInstallFailure, failureLine } from "../../../../utils/installFailure.js";

/*
 * Причина, по которой модель в студии не открылась, словами игрока (живой Electron, 31.10.2026: в карточке «Модель не открылась» стояло английское «Archive was not found: x64c.rpf» — у человека
 * неполная папка игры, а окно на русском). Известные отказы игры и движка (нет архива, нет файла, архив не читается…) — теми же словами и на том же языке, что и в очереди установок
 * (`installFailure.js`, шесть языков); остальное — как раньше, через словарь окна.
 */
/*
 * Модель, которую сцена приняла без единой вершины (22.11.2026, пустой предпросмотр вещи в Astral 1.0.0): раньше студия считала её открытой — «Загружаем модель» кончалась,
 * сцена оставалась пустой, без слов и без «Повторить». Теперь это отказ чтения: слова — в карточке «Модель не открылась», «Повторить» у неё есть. Счётчика вершин нет —
 * ничего не блокируем.
 */
export const EMPTY_MODEL_TEXT = "Модель этой вещи пока не удалось прочитать из игры.";
export const emptyModelFailure = (info) => (info && info.vertices === 0 ? EMPTY_MODEL_TEXT : "");

export function modelFailureText(failure, language) {
  const text = String(failure || "");
  const described = text ? describeInstallFailure(text, language) : null;
  return described && described.kind !== "unknown" ? failureLine(described) : tr(text);
}
