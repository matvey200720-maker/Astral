import { lazy } from "react";

/* Страница «Загрузки» («Лента», 15.11.2026) едет отдельным куском: открывают её не на каждом запуске, а в стартовом куске места нет. */
export const DownloadsPanel = lazy(
  () => import("../../components/desktop/DownloadsPanel.jsx"),
);
export { recordDownloadDone } from "./done-log.js";
export { default as FastInstallOffer } from "./FastInstallOffer.jsx";
export { CloseAskHost } from "./close-ask/CloseAskHost.jsx";
export { downloadsRailMetrics } from "./rail-metrics.js";
export {
  describeInstallFailure,
  failureNotice,
  humanFailure,
  pending,
  successNotice,
} from "./install-outcome.js";
export { useSimulatedProgress } from "./useSimulatedProgress.js";
export { useWorkInstallFlight } from "./work-flight.js";
export { useForeignQuestionOpen } from "./foreign-auto-open.js";
export {
  queueRowBytes,
  useInstallProgressBridge,
  useLiveQueueItem,
  useQueueProgress,
} from "./live-progress.js";
export {
  requestDownloadsPanel,
  useDownloadsRequests,
} from "./open-requests.js";
