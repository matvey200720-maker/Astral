import * as accel from "./accelerated.js";
import * as api from "../../api.js";
import { useEffect, useRef } from "react";

function usePrefetchNext(queue) {
  const enabled = accel.useDownloadsAccelerated();
  const remembered = useRef(null);

  useEffect(function askAhead() {
    if (enabled) {
      remembered.current ??= new Set();
      requestNext(queue, remembered.current);
    }
  }, [queue, enabled]);
}

function requestNext(queue, known) {
  const candidate = prefetchCandidate(queue, known);
  if (candidate === null) return;

  known.add(candidate.queueId);
  const { manifest, packageBaseUrl: baseUrl } = candidate;
  api.prefetchPackage({ manifest, baseUrl }).catch(ignore);
}

// Что качать наперёд: первая ждущая установка, но только когда другая уже идёт
// и ни одну из ждущих ещё не просили (не больше одного мода вперёд).
const prefetchCandidate = (queue = [], asked = new Set()) => {
  const installs = queue.filter(isQueuedInstall);
  if (installs.every(isWaitingInstall)) return null;

  const alreadyAsked = (row) => isWaitingInstall(row) && asked.has(row.queueId);
  if (installs.find(alreadyAsked)) return null;
  return installs.find(isWaitingInstall) ?? null;
};

function isWaitingInstall(row) {
  return !row.started;
}

// Строка, которую очередь поставит сама: установка с манифестом и адресом пакета.
// Одежда и тату с выбором вещи ставятся своим путём, упавшие не считаются.
function isQueuedInstall(row) {
  if (row?.operation !== "install") return false;
  if (row.failed || row.clothingChoice || row.tattooSetChoice) return false;
  return Boolean(row.manifest) && Boolean(row.packageBaseUrl);
}

const ignore = () => {};

export { prefetchCandidate, usePrefetchNext };
