/*
 * Установка замены анимации из окна (ТЗ 29.10-d): запрос к главному процессу, слова причин и заметок на языке окна.
 *
 * Главный процесс отвечает кодами (`why`, `notes`, `code`): русские строки в его ответе — для журнала, окно их не показывает. Здесь код
 * превращается в фразу словаря, а числа и имена окно ставит само рядом, не внутри фразы.
 */

import { tr } from "../../../locales/ui.js";
import {
  applyAnimationInstall,
  listInstalledAnimations,
  planAnimationInstall,
  removeAnimationInstall,
} from "../../../api.js";
import { entryRequest } from "./animation-library.js";
import { mainProcessText, messageOf } from "./animation-errors.js";

/* Слова словаря: русская строка — ключ, `tr` переводит при выводе. */
const REFUSALS = Object.freeze({
  "source-not-body": "Новая анимация — не анимация тела человека.",
  "target-not-body":
    "Эта анимация — не анимация тела человека: так заменять нельзя.",
  layers: "У новой анимации два слоя, а у этой один: слоёв не хватит.",
  "ped-source": "Кости новой анимации не из скелета человека игры.",
  "ped-target": "Кости этой анимации не из скелета человека игры.",
  duration: "У новой анимации невозможная длительность.",
  sequences: "В новой анимации нет данных кадров.",
});

/* Источник замены недоступен: словарь проекта не скачался, файл ушёл — причина в самой строке установки, а не общей фразой (ревью 14.11, п. 5). Русские строки — те же, что говорит главный процесс. */
const SOURCE_REFUSALS = Object.freeze({
  ANIMATION_PROJECT_OFFLINE:
    "Не получилось скачать анимацию проекта: проверьте интернет и повторите.",
  ANIMATION_PROJECT_MISSING:
    "Эту анимацию проекта ещё не выложили на сервер Astral.",
  ANIMATION_PROJECT_BROKEN:
    "Скачанная анимация проекта не сошлась с описью и не используется.",
  ENOENT: "Эту замену поставить нельзя: файл анимации недоступен.",
});

const NOTES = Object.freeze({
  "missing-bones":
    "Часть костей новой анимации в этой не двигается — так бывает у анимаций верхней части тела.",
  duration:
    "Длительность сильно отличается от прежней: сервер считает время по прежней.",
  mover: "У новой анимации есть движение корня: персонаж может сместиться.",
});

/** Причина отказа по ответу главного процесса: слова словаря или общая фраза (сама причина — в подсказке окна). */
export function refusalText(row) {
  if (row?.why && REFUSALS[row.why]) return tr(REFUSALS[row.why]);
  if (row?.code === "ANIMATION_TARGET")
    return tr(
      "Этой анимации нет в вашей игре: ставить некуда, замена — только для просмотра.",
    );
  if (SOURCE_REFUSALS[row?.code]) return tr(SOURCE_REFUSALS[row.code]);
  if (row?.code === "ANIMATION_ENTRY")
    return tr("Эту замену поставить нельзя: файл анимации недоступен.");
  if (row?.code === "YCD_LIST")
    return tr("Эта анимация собрана из нескольких слоёв: заменить её нельзя.");
  return tr("Замену поставить не получилось.");
}

/** Заметки к удавшейся замене (после установки): по коду, без дубликатов. */
export function noteTexts(codes = []) {
  return [...new Set(codes)]
    .filter((code) => NOTES[code])
    .map((code) => tr(NOTES[code]));
}

/** Слова об отказе вызова (канал, игра запущена, нет прав): отбрасывает оболочку Electron и узнаёт «игра запущена». */
export function failureText(error) {
  const message = messageOf(error);
  if (/запущен|закройте|running/i.test(message))
    return tr("Игра запущена. Закройте GTA V и поставьте замену ещё раз.");
  if (/подтвержд|Legacy/i.test(message))
    return tr(
      "Замены ставятся только в GTA V Legacy из папки, которую Astral знает.",
    );
  return mainProcessText(message, tr("Замену поставить не получилось."));
}

/** Подробность для подсказки пары: слова главного процесса на языке окна или пусто. */
export const detailText = (raw) => mainProcessText(raw, "");

/** Пара из «Моих замен» в запрос установки: что менять (цель) и чем (источник). */
export function installPair(item) {
  return {
    id: item.id,
    target: { ...entryRequest(item.target), name: item.target.name },
    replacement: {
      ...entryRequest(item.replacement),
      name: item.replacement.name,
    },
  };
}

/**
 * Поставить пару: проверка и план, потом запись. Возвращает `{ status: "installed" | "unchanged" | "refused", reason, notes, heavy, archive }`;
 * отказ вызова — исключением с причиной, которую `failureText` скажет словами.
 */
export async function installReplacement(
  item,
  gameRoot,
  { onPlan = null } = {},
) {
  const request = { gameRoot, install: [installPair(item)] };
  const plan = await planAnimationInstall(request);
  const first = (plan?.results || []).find((row) => row.id === item.id);
  if (!first || first.status === "refused")
    return {
      status: "refused",
      reason: refusalText(first),
      detail: detailText(first?.reason),
      notes: noteTexts(first?.notes),
    };
  onPlan?.({
    heavy: Boolean(plan.files?.some((file) => file.heavy)),
    archive: plan.files?.[0]?.archive || "",
  });
  const done = await applyAnimationInstall(request);
  const row =
    (done?.results || []).find((entry) => entry.id === item.id) || first;
  if (row.status === "refused")
    return {
      status: "refused",
      reason: refusalText(row),
      detail: detailText(row.reason),
      notes: noteTexts(row.notes),
    };
  return {
    status: row.status === "unchanged" ? "unchanged" : "installed",
    notes: noteTexts(row.notes || first.notes),
  };
}

/** Снять замену с игры: подлинный словарь возвращается. */
export async function uninstallReplacement(item, gameRoot) {
  const done = await removeAnimationInstall({ gameRoot, ids: [item.id] });
  return {
    removed: (done?.results || []).some(
      (row) => row.id === item.id && row.status === "removed",
    ),
  };
}

/** Какие замены стоят в игре сейчас (с проверкой отпечатка файла): множество номеров; `null`, если спросить нечем. */
export async function installedIds(gameRoot) {
  try {
    const answer = await listInstalledAnimations({ gameRoot });
    return new Set(
      (answer?.items || []).filter((row) => row.present).map((row) => row.id),
    );
  } catch {
    return null;
  }
}
