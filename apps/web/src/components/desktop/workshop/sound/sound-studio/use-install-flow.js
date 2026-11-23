import { useReducer, useRef, useMemo } from "react";
import { desktopHost, sanitizeDesktopErrorMessage } from "../../../../../api.js";
import { recordSoundInstall, queueSoundApply, soundApplyLabel } from "../sound-apply.js";
import { gameRootOf } from "../useSoundAudio.js";
import { soundBankKey } from "../sound-model.js";
import { tr } from "../../../../../locales/ui.js";
import { without } from "./studio-model.js";

const bridgeCan = (host, ...methods) =>
  Boolean(host) && methods.every((name) => typeof host[name] === "function");

const workKey = ({ archive, bank }) => (archive && bank ? soundBankKey(archive, bank) : "");

// Нажатие «Применить» и снятие работы; читает самые свежие значения из latest.
class InstallDesk {
  constructor(latest, io) {
    this.latest = latest;
    this.io = io;
  }

  // Что отдаётся очереди установки; порядок полей виден снаружи.
  jobFor(host, queue, renderFor) {
    const job = {};
    job.host = host;
    job.targets = queue.fresh;
    job.resolveGameRoot = () => gameRootOf(host);
    job.renderFor = renderFor;
    job.notify = this.io.setNotice;
    job.onPlan = (key, plan) => this.io.setPlans((all) => ({ ...all, [key]: plan }));
    job.onApplied = recordSoundInstall;
    return job;
  }

  press = () => {
    const { queue, renderFor } = this.latest.current;
    const host = desktopHost();
    const refusal = !bridgeCan(host, "planSound", "applySound")
      ? tr("Установка звука доступна в приложении Astral.")
      : queue.fresh.length === 0
        ? tr("Сначала поставьте свой звук — в игру пока нечего ставить.")
        : "";
    if (refusal) this.io.setNotice(refusal);
    else queueSoundApply(this.jobFor(host, queue, renderFor));
  };

  removeWork = (work) => {
    const host = desktopHost();
    if (!bridgeCan(host, "removeSound")) return undefined;
    const { setBusy, setView, setPlans, setNotice, reloadWorks } = this.io;
    const forget = () => {
      const key = workKey(work);
      if (!key) return;
      setView((was) =>
        key in was.installed ? { ...was, installed: without(was.installed, key) } : was,
      );
      setPlans((all) => without(all, key));
    };
    setBusy("remove");
    return gameRootOf(host)
      .then((root) => host.removeSound({ gameRoot: root, modId: work.modId }))
      .then(forget)
      .then(() => setNotice(tr("Свой звук убран из игры — вернулся звук игры")))
      .then(reloadWorks)
      .catch((failure) => {
        const reason = sanitizeDesktopErrorMessage(failure);
        setNotice(reason || tr("Убрать звук из игры не удалось."));
      })
      .finally(() => setBusy(""));
  };
}

// «Применить», очередь установки и снятие работы из игры.
// queue приходит из useSoundApplyQueue главного компонента (порядок вызова хуков соседей).
export function useInstallFlow(queue, pending, renderFor, io) {
  const [busy, setBusy] = useReducer((_, next) => next, "");
  const caption = soundApplyLabel(queue.fresh.length ? queue.fresh : pending);

  const latest = useRef(null);
  latest.current = { queue, renderFor };
  const { setNotice, setPlans, setView, reloadWorks } = io;
  const desk = useMemo(
    () => new InstallDesk(latest, { setBusy, setNotice, setPlans, setView, reloadWorks }),
    [setNotice, setPlans, setView, reloadWorks],
  );

  return { busy, queue, caption, press: desk.press, removeWork: desk.removeWork };
}
