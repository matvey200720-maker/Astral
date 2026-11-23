import { useRef, useState } from "react";
import Button from "../../../components/ui/Button.jsx";
import { formatSize } from "../../../catalog-utils.js";
import { currentUiLanguage, tr, trIn } from "../../../locales/ui.js";
import { repairLocalTarget } from "../../../api.js";
import { describeInstallFailure } from "../../../utils/installFailure.js";
import { refreshReduxLayers, runReduxLayerAction, useReduxLayer } from "./redux-layers.js";

/*
 * Под кнопкой «Установлено» части: что с редуксом на новом пути (dlc в игре + слой в `update.rpf`) и три действия. Выключенный
 * редукс лежит в игре как лежал и включается мгновенно; «Освободить место» убирает его файлы, и включить его после этого можно
 * только загрузкой заново. Слов о состоянии нет у мода прежнего пути: у него записи `reduxLayer` нет, и компонент молчит.
 */

/* Отказы, при которых помогает «Вернуть как было»; «сверху другой слой» чинит только порядок действий человека. */
const REPAIRABLE = new Set(["redux-key", "redux-damaged", "redux-failed"]);
/* Слова предупреждения после «Вернуть как было», когда правки мастерской не приняты (`zone-repair-patches-lost-2211.js`); блок отказа печатает «reason. advice». Те же слова, что в строке «Проверить файлы игры» (`game-copy.js`, `repairedPatchesLost`). */
const PATCHES_LOST_REASON = "Файлы возвращены, но правки мастерской (небо, фонари и другие) могли сброситься";
const PATCHES_LOST_ADVICE = "Примените их заново в мастерской";
const LOCALES = { ru: "ru-RU", uk: "uk-UA", en: "en-US", de: "de-DE", pl: "pl-PL", fr: "fr-FR" };

export default function ReduxLayerActions({ modId, language = "" }) {
  const layer = useReduxLayer(modId);
  const [busy, setBusy] = useState("");
  const [refusal, setRefusal] = useState(null);
  const running = useRef(false);
  if (!layer) return null;
  const say = language ? (text) => trIn(language, text) : tr;
  const size = formatSize(layer.bytes, LOCALES[language || currentUiLanguage()] || "ru-RU");
  const enabled = layer.state === "enabled";

  const run = async (action) => {
    if (running.current) return;
    running.current = true;
    setBusy(action);
    setRefusal(null);
    try {
      await runReduxLayerAction(modId, action);
    } catch (error) {
      /* Отказ — словами на языке окна (семейства `redux-*`); отмена отказом не считается. */
      setRefusal(describeInstallFailure(error, language || undefined));
    } finally {
      running.current = false;
      setBusy("");
    }
  };

  /* «Вернуть как было» — та же починка цели, что в настройках игры: слой и dlc сверяются, потерянное убирается. */
  const repair = async () => {
    if (running.current) return;
    running.current = true;
    setBusy("repair");
    try {
      const answer = await repairLocalTarget({ targetId: layer.targetId });
      /* Правки мастерской не приняты (`patchesNotAdopted`): в тот же блок `role="alert"`, без кнопки (вид не из `REPAIRABLE`). Ограничение: починка убрала слой — `refreshReduxLayers` уберёт карточку, и предупреждение уйдёт с ней. */
      setRefusal(answer?.patchesNotAdopted?.length > 0 ? { kind: "repair-patches-lost", reason: say(PATCHES_LOST_REASON), advice: say(PATCHES_LOST_ADVICE) } : null);
    } catch (error) {
      setRefusal(describeInstallFailure(error, language || undefined));
    } finally {
      running.current = false;
      setBusy("");
      await refreshReduxLayers();
    }
  };

  const word = enabled
    ? say("Редукс включён. Его файлы занимают {size}.")
    : say("Редукс выключен. Его файлы лежат в игре и занимают {size}.");
  const labelOf = (action, idle, working) => (busy === action ? say(working) : say(idle));
  return (
    <span className="mod-part-redux" role="group" data-redux-state={layer.state}>
      <span className="mod-part-redux-word" role="status">
        {word.replace("{size}", size)}
      </span>
      {enabled ? (
        <Button variant="secondary" size="md" className="mod-part-action is-redux" aria-busy={busy === "disable" ? "true" : undefined} disabled={Boolean(busy)} onClick={() => run("disable")}>
          {labelOf("disable", "Выключить", "Выключаю…")}
        </Button>
      ) : (
        <>
          <Button variant="secondary" size="md" className="mod-part-action is-redux" aria-busy={busy === "enable" ? "true" : undefined} disabled={Boolean(busy)} onClick={() => run("enable")}>
            {labelOf("enable", "Включить", "Включаю…")}
          </Button>
          <Button
            variant="ghost"
            size="md"
            className="mod-part-action is-redux"
            title={say("Файлы редукса будут удалены из игры. Включить его снова можно только загрузкой заново.")}
            aria-busy={busy === "free" ? "true" : undefined}
            disabled={Boolean(busy)}
            onClick={() => run("free")}
          >
            {labelOf("free", "Освободить место", "Освобождаю место…")}
          </Button>
        </>
      )}
      {refusal ? (
        <span className="mod-part-redux-refusal" role="alert">
          {`${refusal.reason}. ${refusal.advice}`}
          {REPAIRABLE.has(refusal.kind) ? (
            <Button variant="secondary" size="md" className="mod-part-action is-redux" disabled={Boolean(busy)} onClick={repair}>
              {say("Вернуть как было")}
            </Button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
