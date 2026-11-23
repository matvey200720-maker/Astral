import { pending } from "./install-outcome.js";

const EMPTY_BATCH = { total: 0, completed: 0 };

const isFinished = (job) => job.status === "done" || job.status === "failed";

export function downloadsRailMetrics({ queue, queueBatch, works }) {
  // Порядок виден снаружи: сначала работы мастерской, потом очередь каталога.
  const liveJobs = works.jobs.filter((job) => !isFinished(job)).length;
  const liveRows = pending(queue);
  if (liveRows === 0 && liveJobs === 0) return null;

  const { total: rowsTotal, completed: rowsDone } = queueBatch;
  const { total: jobsTotal, completed: jobsDone } = works.batch || EMPTY_BATCH;

  return {
    /* Сколько модов качается сейчас: число в углу кнопки «Загрузки» (рейка F). */
    active: liveRows + liveJobs,
    completedFiles: rowsDone + jobsDone,
    totalFiles:
      Math.max(rowsTotal, rowsDone + liveRows) +
      Math.max(jobsTotal, jobsDone + liveJobs),
  };
}
