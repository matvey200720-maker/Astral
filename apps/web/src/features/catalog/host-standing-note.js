import { tr } from "../../locales/ui.js";
import { trFill } from "../../locales/tr-fill.js";

/*
 * Режим RP, частичное перекрытие (22.11.2026): прежняя работа на том же месте осталась, потому что в ней есть файлы, которых нет в новой. Главный процесс присылает в итоге установки `hostStanding: [{ modId, by }]`
 * (`apps/desktop/src/installer-ipc.js`, правило — `packages/install-engine/host-standing.js`); окно добавляет к уведомлению одну спокойную фразу, без названий работ и без внутренностей; пусто, если поля нет.
 * Подключается из `DesktopShell.jsx` по `import()`, только когда `hostStanding` есть (как `model-guard-note.js`): в главный кусок окна модуль не входит; слова — в языковых кусках словаря (`locales/ui-text/zone-host-standing-2211.js` и `fr/`).
 *
 * Куда вести: корзина «Библиотеки» снимает работы всех видов (скин и ганпак оружия, покраска одежды, тату, остальные работы мастерской): работа выделяется плиткой, кнопка корзины — «Удалить выделенное» (`features/library/LibraryTrashBar.jsx`).
 * Название раздела (`LibraryShelves.jsx`, `tr("Библиотека")`) и кнопки (`tr("Удалить выделенное")`, перевод — `locales/ui-text/zone-library-v2.js` и `fr/`) — из словаря окна по `{0}` и `{1}`, в именительном падеже на каждом языке, склонять не нужно.
 */
export function hostStandingNote(result) {
  const standing = Array.isArray(result?.hostStanding) ? result.hostStanding : [];
  if (!standing.some((item) => Array.isArray(item?.by) && item.by.length)) return "";
  return trFill("Прежняя работа на этом месте осталась: в ней есть файлы, которых нет в новой. Чтобы осталась одна, выделите прежнюю в разделе «{0}» и нажмите «{1}».", tr("Библиотека"), tr("Удалить выделенное"));
}
