/*
 * Очередь применения мастерской: один вход для редакторов и для оболочки.
 *
 * Здесь только то, что нужно обоим: сама очередь, подписка на неё и
 * «Применить». Ничего тяжёлого отсюда не видно, и это правило, а не
 * случайность: экран «В процессе» живёт в стартовом куске приложения, а
 * `project-installs.js` тянет за собой модель проекта мастерской — все
 * шестнадцать модулей с их значениями по умолчанию. Один такой реэкспорт
 * стоил стартовому куску семидесяти килобайт в gzip и выбил его за бюджет.
 *
 * Кто работает с проектами и с игрой — редакторы, — берут соседние файлы по
 * имени: `project-installs.js`, `game-root.js`, `native-record.js`,
 * `tasks/*`. Они и так живут в кусках мастерской.
 */

export { applyWorkshopWork } from "./apply.js";
export {
  DEFAULT_INSTALL_STEPS,
  REPLACING_INSTALL_STEPS,
  WORKSHOP_INSTALL_DONE_MS,
  cancelWorkshopInstall,
  describeWorkshopInstall,
  dismissWorkshopFailure,
  dismissWorkshopInstall,
  enqueueWorkshopInstall,
  holdWorkshopInstalls,
  releaseWorkshopInstalls,
  resetWorkshopInstalls,
  retryWorkshopInstall,
  runBesideWorkshopInstalls,
  setWorkshopBatchPartner,
  workshopInstallCancellable,
  workshopInstallFailureOf,
  workshopInstallPlace,
  workshopInstallShare,
  workshopInstallShareOf,
  workshopInstallStatusOf,
  workshopInstallsWriting,
} from "./queue.js";
export { workSignature } from "./signature.js";
export {
  useWorkshopApplyButton,
  useWorkshopInstallStatus,
  useWorkshopInstalls,
  useWorkshopInstallsLive,
  workshopApplyButton,
} from "./useWorkshopInstalls.js";
