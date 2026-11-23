// Слова для человека о состоянии обновлений: знак орбиты, заголовок, вторая строка, примечание.
// Функции чистые: «Настройки › О программе › Обновления» и тесты получают одну и ту же строку,
// поэтому «что показать» проверяется без окна (docs/beta/release-channels.md §5.4).

import { errorCopy } from "./copy.js";
import { formatBytes, formatWhen, transferLines } from "./format.js";
import { describe } from "./model.js";

const PART_SEPARATOR = " · ";
// Буква диска и двоеточие. Всё остальное считаем непригодным: подсказка без диска честнее выдуманного.
const DRIVE_PATTERN = /^[A-Z]:$/;

// Для «Не хватает места» подсказка называет нужный и свободный объём и диск программы:
// обновление ставится туда, где стоит сама программа, а не в кэш, и общий совет вводил бы в заблуждение.
export function errorHint(error, copy, language) {
  const [, base] = errorCopy(copy, error?.code);
  if (error?.code !== "DISK_FULL" || !(Number(error.details?.need) > 0)) return base;
  const { available, drive, need } = error.details;
  const diskLabel = typeof drive === "string" && DRIVE_PATTERN.test(drive) ? drive : null;
  return copy.diskFull(formatBytes(need, language), formatBytes(available, language), diskLabel);
}

const shape = (kind, title, sub = "", note = "", value = 0) => ({
  orbit: { kind, value },
  title,
  sub,
  note,
});
const versionOf = (view) => view.candidate?.version || "";

// Слова орбиты: wait — идёт работа без цифр, progress — есть доля, done — готово к установке,
// error — ошибка, idle — покой.
const VIEWS = {
  applying: ({ copy }) => shape("wait", copy.applying, copy.applyingHint),
  available: ({ copy, language, view }) =>
    shape(
      "idle",
      copy.available(versionOf(view)),
      copy.availableHint(formatBytes(view.candidate?.bytes, language)),
    ),
  checking: ({ copy }) => shape("wait", copy.checking),
  current: ({ copy, language, now, state }) => {
    const parts = [
      state.checkedAt ? copy.checkedAt(formatWhen(state.checkedAt, language, copy, now)) : "",
      state.current?.build ? copy.build(state.current.build) : "",
    ];
    return shape("idle", copy.current, parts.filter((part) => part !== "").join(PART_SEPARATOR));
  },
  downloading: ({ copy, language, view }) => {
    const { facts } = view;
    const { line, note } = transferLines(facts, language, copy);
    const version = versionOf(view);
    const title = facts?.stage === "verify" ? copy.verifying(version) : copy.downloading(version);
    return shape("progress", title, line, note, facts?.share || 0);
  },
  error: ({ copy, language, state }) =>
    shape("error", errorCopy(copy, state.error?.code)[0], errorHint(state.error, copy, language)),
  idle: ({ copy }) => shape("idle", copy.never, copy.neverHint),
  off: ({ copy }) => shape("idle", copy.off),
  ready: ({ copy, view }) => shape("done", copy.ready(versionOf(view)), copy.readyHint),
};

export function statusOf(state, copy, language, now = new Date()) {
  const view = describe(state);
  // Режим вне списка (фаза из прототипа словаря) читается как покой, но mode остаётся таким, как вернул describe.
  const build = Object.hasOwn(VIEWS, view.mode) ? VIEWS[view.mode] : VIEWS.idle;
  const { orbit, title, sub, note } = build({
    state,
    view,
    copy,
    language,
    now,
  });
  return { mode: view.mode, orbit, title, sub, note };
}
