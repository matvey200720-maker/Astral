/*
 * Обновления внутри Astral: единственная точка входа функции.
 *
 *   UpdatesHost   — решает, когда показывать слои поверх приложения (замок,
 *                   подсказка, «Что нового»; а у веток — вопрос о переключении,
 *                   «Доступ снят», предложение поставить рядом), и сигналит
 *                   установщику «отрисовался»; стоит один раз рядом с оболочкой
 *                   (`pages/DesktopAppPage.jsx`);
 *   UpdatesCard   — карточка «Обновления» в «Настройки › О программе»: без службы
 *                   одна строка сразу, в бете — полная карточка ленивым куском;
 *   BranchesCard  — «Версии Astral» там же: ветки рядом, «Открыть», «Установить рядом»;
 *   useInstalledRelease — точная версия, которая стоит у человека (из подписанного
 *                   манифеста: версия, сборка, ветка), для «Общее» и «О программе».
 *
 * Состояние присылает главный процесс (`apps/desktop/src/updates/`), здесь оно
 * только показывается. Экраны и их лист стилей — ленивый кусок (`ui.js`):
 * в стартовом куске остаются хост, хранилище и модель. Подробности —
 * `docs/beta/release-channels.md`.
 */
export { default as UpdatesHost } from "./UpdatesRoot.jsx";
export { default as UpdatesCard } from "./AboutUpdates.jsx";
export { default as BranchesCard } from "./AboutBranches.jsx";
export { developmentVersionLabel, releaseDetail, useInstalledRelease } from "./installed-version.js";
