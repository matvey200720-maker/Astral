import { Check, Warning } from "../../ui/icons.jsx";
import { installButtonCopy } from "../../../features/downloads/install-button-copy.js";
import { useQueueProgress } from "../../../features/downloads/live-progress.js";
import { failureWords } from "../../../utils/installFailure.js";

/*
 * Статус сборки на её карточке (задача 1 ТЗ 08.10, вечер).
 *
 * «Установить сборку» закрывает окно сборки, а «Загрузки» больше не
 * открываются сами — человек остаётся на полке сборок. Значит, ход должен
 * быть виден там, где он нажимал: на карточке этой сборки, пока её моды в
 * очереди, — «Идёт установка… 42 %»; отказ части — «Не удалось» с причиной в
 * подсказке; встала — прежняя отметка «Установлено».
 */
function partsOf(profile, queue) {
  const ids = new Set(profile.modIds || []);
  const parts = queue.filter(
    (item) => ids.has(item.id) && item.operation === "install",
  );
  const running = parts.filter((item) => !item.failed);
  return {
    current: running.find((item) => item.started) || running[0] || null,
    failed: parts.find((item) => item.failed) || null,
  };
}

/** Есть ли что сказать на карточке: идёт, не удалось или стоит в игре. */
export function hasBuildInstallStatus(profile, queue = [], installed = false) {
  const { current, failed } = partsOf(profile, queue);
  return Boolean(current || failed || installed);
}

export default function BuildInstallStatus({
  profile,
  queue = [],
  installed = false,
  installedLabel,
  language = "ru",
}) {
  const { current, failed } = partsOf(profile, queue);
  const live = useQueueProgress(current?.queueId || "");
  const words = installButtonCopy(language);
  if (current) {
    const progress = Math.round(
      Math.min(99, Number(live?.progress ?? current.progress) || 0),
    );
    return (
      <span className="builds-card-status is-busy" role="status">
        <i aria-hidden="true" />
        {words.installing}
        {current.started ? ` ${progress}%` : ""}
      </span>
    );
  }
  if (failed) {
    const { reason } = failureWords(failed.failed, language);
    return (
      <span className="builds-card-status is-failed" role="alert" title={reason}>
        <Warning weight="fill" aria-hidden="true" />
        {words.failed}
      </span>
    );
  }
  if (!installed) return null;
  return (
    <span className="builds-card-installed">
      <Check />
      {installedLabel}
    </span>
  );
}
