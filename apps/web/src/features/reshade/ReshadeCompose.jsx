/*
 * Колонка «Состав» страницы ReShade (ТЗ 23.10.2026, п. G): из чего собрана картинка и что с этим делать — ReShade
 * (установить и удалить), клавиша меню в игре, DLSS 5 (установить и числа нейросети), «Ваш ПК». Одна колонка вместо двух
 * вкладок: DLSS 5 ставится тут же, без отдельной вкладки.
 *
 * ReShade ставится во все найденные проекты разом; страница не перечисляет проекты по именам, а если где-то не встал —
 * говорит причину (`reshade-outcome.js`). Клавиша меню меняется и до установки (запомнится и запишется вместе с ней), и
 * после: тогда `ReShade.ini` переписывается сразу, игра при этом должна быть закрыта (иначе главный процесс откажет
 * словами, и клавиша остаётся прежней). Занятые самим ReShade клавиши (листание пресетов, эффекты, скриншот) и клавиши,
 * нужные игре, меню не отдаются — и это сказано.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle,
  DownloadSimple,
  DotsThree,
  Lock,
  PencilSimple,
  Trash,
  Warning,
} from "../../components/ui/icons.jsx";
import {
  RESHADE_DLSS_FIELDS,
  RESHADE_RESERVED_KEY_CODES,
  reshadeMenuKeyByCode,
  reshadeMenuKeyByVk,
} from "@modovik/optimizer/reshade.js";
import { hasDesktopBridge } from "../../api.js";
import Button from "../../components/ui/Button.jsx";
import Kbd from "../../components/ui/Kbd.jsx";
import MenuButton from "../../components/ui/MenuButton.jsx";
import Slider from "../../components/ui/Slider.jsx";
import ReshadeNeeds, { needsRows } from "./ReshadeNeeds.jsx";

import { useGameEditions } from "../workshop/edition-support.js";
import { tr, useUiLanguage } from "../../locales/ui.js";
import { reshadeCopyFor } from "./reshade-copy.js";
import { reshadePageCopyFor } from "./reshade-page-copy.js";
import { reshadePresetsCopyFor } from "./reshade-presets-copy.js";
import { outcomeParts, skippedReasons } from "./reshade-outcome.js";

const MODIFIER_CODES = Object.freeze([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

/* Выбор клавиши меню: «Изменить» → «Нажмите клавишу…» → клавиша из списка или отказ словами. */
function MenuKeyPicker({
  copy,
  keyLabel,
  installed,
  disabled,
  saving,
  onPick,
}) {
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState("");
  const changeRef = useRef(null);

  /* Выбор кончился — фокус возвращается на «Изменить» (клавиатуре не остаться в пустоте), если окно само не потеряло фокус. */
  const stop = (refocus = true) => {
    setListening(false);
    setProblem("");
    if (refocus) requestAnimationFrame(() => changeRef.current?.focus());
  };

  useEffect(() => {
    if (!listening) return undefined;
    const lostFocus = () => stop(false);
    const onKeyDown = (event) => {
      /* Пока ждём клавишу, она принадлежит выбору: ни страница, ни окно её не получают. */
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || MODIFIER_CODES.includes(event.code)) return;
      if (event.code === "Escape") return stop();
      const entry = reshadeMenuKeyByCode(event.code);
      if (!entry) {
        setProblem(
          RESHADE_RESERVED_KEY_CODES.includes(event.code)
            ? copy.keyReserved(copy.keyReservedWhat[event.code])
            : copy.keyRejected,
        );
        return;
      }
      stop();
      onPick(entry);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", lostFocus);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", lostFocus);
    };
  }, [listening, copy, onPick]);

  return (
    <section
      className="reshade-part reshade-key"
      data-part="key"
      aria-label={copy.keyTitle}
    >
      <div className="reshade-part-head">
        <div className="reshade-part-title">
          <b>{copy.keyTitle}</b>
        </div>
        {listening ? (
          <div className="reshade-key-actions">
            <span className="reshade-key-wait" role="status">
              {copy.keyPress}
            </span>
            <Button size="sm" variant="ghost" onClick={() => stop()}>
              {copy.keyCancel}
            </Button>
          </div>
        ) : (
          <div className="reshade-key-actions">
            <Kbd>{keyLabel}</Kbd>
            <Button
              ref={changeRef}
              size="sm"
              icon={<PencilSimple />}
              ariaLabel={copy.keyAria(keyLabel)}
              disabled={disabled}
              onClick={() => setListening(true)}
            >
              {saving ? copy.keyBusy : copy.keyChange}
            </Button>
          </div>
        )}
      </div>
      {problem ? (
        <p className="fx-hint reshade-warning" role="alert">
          <Warning aria-hidden="true" /> {problem}
        </p>
      ) : (
        <p className="fx-hint">
          {copy.keyHint} {installed ? copy.keyNote : copy.keyLater}
        </p>
      )}
    </section>
  );
}

export default function ReshadeCompose({ ctrl, onNotice, state: status }) {
  const language = useUiLanguage();
  const copy = reshadePageCopyFor(language);
  const dlssCopy = reshadeCopyFor(language);
  const presetsCopy = reshadePresetsCopyFor(language);
  const editions = useGameEditions();
  const {
    project,
    change,
    state,
    busy,
    run,
    installed,
    installedTargets,
    installedProject,
    dlssOn,
    menuKey,
    presetOn,
    projectFor,
    compatibility,
    packMissing,
    reshadeMissing,
  } = ctrl;
  const bridge = hasDesktopBridge();
  const keyLabel = reshadeMenuKeyByVk(menuKey).label;
  const blocked = compatibility?.block === true;
  const canReshade = bridge && !busy && !reshadeMissing;
  const canDlss = bridge && !busy && !packMissing && !(blocked && !dlssOn);
  const gpu = state?.gpu;

  async function installReshade() {
    const result = await run("reshade", projectFor({ reshade: true }));
    if (!result) return;
    onNotice?.(
      copy.installedNotice({
        key: keyLabel,
        ...outcomeParts(result, state, copy, dlssCopy),
      }),
    );
  }

  /* «Удалить» снимает всё: ReShade вместе с пресетом и нейросетью, как было до Astral. */
  async function removeReshade() {
    const result = await run(
      "reshade-off",
      projectFor({ reshade: false, preset: "", dlss: false }),
    );
    if (!result) return;
    onNotice?.(
      result.targets.some((item) => item.action === "removed")
        ? copy.removedNotice
        : copy.nothingNotice,
    );
  }

  async function toggleDlss(enabled) {
    const result = await run(
      enabled ? "dlss" : "dlss-off",
      projectFor({ dlss: enabled }),
    );
    if (!result) return;
    onNotice?.(
      enabled
        ? copy.dlssNotice({
            key: keyLabel,
            ...outcomeParts(result, state, copy, dlssCopy),
          })
        : copy.dlssRemovedNotice,
    );
  }

  /* «Без пресета»: пресет снимается, ReShade и DLSS 5 остаются (то же действие, что в шапке «Готовых пресетов»). */
  async function removePreset() {
    const result = await run("preset-off", projectFor({ preset: "" }));
    if (!result) return;
    onNotice?.(presetOn ? presetsCopy.offNotice : presetsCopy.offNothing);
  }

  async function pickKey(entry) {
    if (entry.vk === menuKey) return;
    if (!installed) {
      /* ReShade ещё нет: клавиша запоминается и запишется вместе с установкой. */
      change((current) => ({ ...current, overlayKey: entry.vk }));
      onNotice?.(copy.keyLaterNotice(entry.label));
      return;
    }
    /* ReShade стоит: в его `ReShade.ini` меняется одна строка клавиши, остальное не трогается; игра должна быть закрыта. */
    const result = await run("key", projectFor({ overlayKey: entry.vk }), {
      keyOnly: true,
    });
    if (result) onNotice?.(copy.keySavedNotice(entry.label));
  }

  const onDlss = (values) =>
    change((current) => ({ ...current, dlss: { ...current.dlss, ...values } }));

  /* Числа нейросети поменяли при поставленном DLSS 5 — переписать ReShade.ini во всех проектах. */
  const installedDlss = installedProject?.dlss;
  const settingsChanged = useMemo(
    () =>
      dlssOn &&
      Boolean(installedDlss) &&
      RESHADE_DLSS_FIELDS.some(
        (field) =>
          Math.abs(installedDlss[field.id] - project.dlss[field.id]) > 0.0005,
      ),
    [dlssOn, installedDlss, project.dlss],
  );

  const skipped = skippedReasons(copy, state);
  const missing = installedTargets.reduce(
    (most, item) => Math.max(most, item.missing || 0),
    0,
  );
  const supportOff = installedTargets.some(
    (item) => item.id === "majestic" && item.modSupport !== true,
  );
  const foreign =
    !installed && (state?.targets || []).some((item) => item.foreignReshade);
  const lastRun = dlssOn
    ? installedTargets.map((item) => item.lastRun).find(Boolean)
    : null;
  const driverOld =
    !blocked && gpu?.rtx === true && gpu.driver && compatibility?.message
      ? gpu.driver.toFixed(2)
      : "";

  /* Что сейчас в карточке «Состояние» (дизайн 15.11.2026, макет «Кино»): строка под названием состояния и одна главная кнопка. Главная кнопка
     ставит то, чего ещё нет, по порядку: пока ничего нет — ReShade вместе с DLSS 5 одним проходом (установка DLSS 5 кладёт и ReShade), если DLSS 5
     здесь невозможен (нет RTX, нет пакета) — один ReShade; ReShade стоит, а DLSS 5 нет — DLSS 5. Остальное — «Без пресета», «Удалить» и меню
     «По отдельности» (только ReShade, убрать только DLSS 5): ни одно прежнее действие не потеряно. */
  const dlssInstallable = !blocked && !packMissing;
  const stateLine = !bridge
    ? copy.onlyApp
    : !state
      ? dlssCopy.checking
      : reshadeMissing
        ? ""
        : installed
          ? `${skipped ? copy.reshadeSkipHint(skipped) : copy.reshadeAllHint} ${copy.reshadeRemoveHint}`
          : copy.reshadeOffHint;
  let mainAction = null;
  if (!installed) {
    mainAction = dlssInstallable
      ? {
          label: busy === "dlss" ? copy.installing : copy.install,
          disabled: !canDlss,
          run: () => toggleDlss(true),
        }
      : {
          label:
            busy === "reshade"
              ? copy.installing
              : tr("Поставить только ReShade"),
          disabled: !canReshade,
          run: installReshade,
        };
  } else if (!dlssOn && dlssInstallable) {
    mainAction = {
      label: busy === "dlss" ? copy.installing : tr("Поставить DLSS 5"),
      disabled: !canDlss,
      run: () => toggleDlss(true),
    };
  }
  const separately = [];
  if (!installed && dlssInstallable)
    separately.push({
      value: "reshade-only",
      label: tr("Поставить только ReShade"),
      icon: <DownloadSimple aria-hidden="true" />,
      disabled: !canReshade,
      run: installReshade,
    });
  if (dlssOn)
    separately.push({
      value: "dlss-off",
      label: tr("Убрать только DLSS 5"),
      icon: <Trash aria-hidden="true" />,
      disabled: !canDlss,
      run: () => toggleDlss(false),
    });

  /* Ползунки нейросети видны всегда: пока DLSS 5 не стоит, они серые и стоят на выбранных числах (как будут выглядеть после установки), чтобы
     карточка не оставалась пустой (владелец, 16.11.2026: «пустое пространство мы не оставляем»). */
  const numbers = (
    <div
      className={`reshade-numbers${dlssOn ? "" : " is-preview"}`}
      role="group"
      aria-label={dlssCopy.numbersAria}
      aria-disabled={dlssOn ? undefined : "true"}
    >
      {RESHADE_DLSS_FIELDS.map((field) => (
        <Slider
          key={field.id}
          label={dlssCopy.fields[field.id]?.label ?? field.label}
          value={Math.round(project.dlss[field.id] * 100)}
          min={0}
          max={100}
          step={5}
          format={(value) => `${value} %`}
          className="is-stacked"
          disabled={!dlssOn}
          onChange={(value) => onDlss({ [field.id]: value / 100 })}
        />
      ))}
      {dlssOn ? <p className="fx-hint">{dlssCopy.numbersNote}</p> : null}
      {dlssOn && settingsChanged ? (
        <div className="reshade-numbers-actions">
          <p className="fx-hint">
            {dlssCopy.settingsChanged(
              `DLSS 5 ${Math.round(installedDlss.intensity * 100)} %`,
            )}
          </p>
          <Button
            variant="primary"
            icon={<DownloadSimple />}
            disabled={!canDlss}
            onClick={() => void toggleDlss(true)}
          >
            {busy === "dlss" ? dlssCopy.writing : dlssCopy.writeToGame}
          </Button>
        </div>
      ) : null}
    </div>
  );

  /* Три карточки полосы под кадром (дизайн 15.11.2026, DLSS 5 «Кино»): «Состояние» — что стоит и кнопки, «Что нужно» — ПК и честные факты,
     «В игре и числа DLSS 5» — клавиша меню и числа нейросети. Содержимое частей прежнее. */
  return (
    <aside className="reshade-panel is-band" aria-label={copy.panelAria}>
      <div className="reshade-panel-scroll">
        <div className="reshade-band">
          <div className="reshade-card" data-card="state">
            <p className="reshade-card-kicker" aria-hidden="true">
              {tr("Состояние")}
            </p>
            <header className="reshade-panel-head">
              <h2 className="reshade-panel-title is-visually-hidden">
                {copy.panelTitle}
              </h2>
              {status ? (
                <span
                  className={`reshade-state${status.on ? " is-on" : ""}`}
                  role="status"
                >
                  {status.on ? (
                    <CheckCircle weight="fill" aria-hidden="true" />
                  ) : null}
                  {status.text}
                </span>
              ) : null}
            </header>
            <div className="reshade-state-body">
              {stateLine ? <p className="fx-hint">{stateLine}</p> : null}
              {reshadeMissing ? (
                <p className="fx-hint reshade-warning">
                  <Warning aria-hidden="true" /> {dlssCopy.packMissing}
                </p>
              ) : null}
              {missing > 0 ? (
                <p className="fx-hint reshade-warning">
                  <Warning aria-hidden="true" /> {copy.missingFiles(missing)}
                </p>
              ) : null}
              {installed && supportOff ? (
                <p className="fx-hint reshade-warning">
                  <Warning aria-hidden="true" /> {copy.supportOff}
                </p>
              ) : null}
              {foreign ? (
                <p className="fx-hint">{copy.foreignReshade}</p>
              ) : null}
              {!dlssOn ? <p className="fx-hint">{copy.dlssHint}</p> : null}
              {blocked ? (
                <p className="fx-hint reshade-warning is-block" role="alert">
                  <Warning aria-hidden="true" />{" "}
                  {dlssCopy.gpuNoRtx({
                    names: gpu?.names?.join(", ") || dlssCopy.gpuUnknown,
                  })}
                </p>
              ) : null}
              {lastRun ? (
                <p className="fx-hint">
                  {lastRun.worked
                    ? dlssCopy.lastWorked(lastRun.gpu)
                    : lastRun.failure
                      ? dlssCopy.lastFailed(lastRun.failure)
                      : ""}
                </p>
              ) : null}
            </div>
            <div className="reshade-state-actions">
              {mainAction ? (
                <Button
                  className="reshade-main-action"
                  variant="primary"
                  size="lg"
                  icon={<DownloadSimple />}
                  disabled={mainAction.disabled}
                  onClick={() => void mainAction.run()}
                >
                  {mainAction.label}
                </Button>
              ) : null}
              {installed && dlssOn ? (
                <Button
                  variant="secondary"
                  size="lg"
                  disabled={!bridge || Boolean(busy) || !presetOn}
                  onClick={() => void removePreset()}
                >
                  {busy === "preset-off"
                    ? presetsCopy.offBusy
                    : presetsCopy.offButton}
                </Button>
              ) : null}
              {installed ? (
                <Button
                  variant="secondary"
                  size="lg"
                  icon={<Trash />}
                  disabled={!canReshade}
                  onClick={() => void removeReshade()}
                >
                  {busy === "reshade-off" ? copy.removing : copy.remove}
                </Button>
              ) : null}
              {separately.length > 0 ? (
                <MenuButton
                  className="reshade-separately"
                  variant="ghost"
                  size="lg"
                  icon={<DotsThree weight="bold" aria-hidden="true" />}
                  trailing={null}
                  ariaLabel={tr("По отдельности")}
                  align="end"
                  options={separately}
                  onSelect={(value) =>
                    void separately.find((item) => item.value === value)?.run()
                  }
                />
              ) : null}
            </div>
          </div>

          <div className="reshade-card" data-card="needs">
            <p className="reshade-card-kicker" aria-hidden="true">
              {tr("Что нужно")}
            </p>
            {bridge ? (
              <ReshadeNeeds
                label={copy.pcTitle}
                rows={needsRows({ state, gpu, dlssCopy, driverOld, editions })}
              >
                {driverOld ? (
                  <p className="fx-hint reshade-warning" role="status">
                    <Warning aria-hidden="true" /> {copy.driverOld(driverOld)}
                  </p>
                ) : null}
              </ReshadeNeeds>
            ) : null}
            <footer className="reshade-panel-foot">
              <p className="fx-hint">
                {dlssCopy.gpuNeeded}
                {bridge && state && !packMissing && !reshadeMissing
                  ? ` ${copy.packLine({
                      reshade: dlssCopy.megabytes(
                        Math.round(state.pack.sizes.reshade / (1024 * 1024)),
                      ),
                      neural: dlssCopy.megabytes(
                        Math.round(state.pack.sizes.neural / (1024 * 1024)),
                      ),
                    })}`
                  : ""}
              </p>
            </footer>
          </div>

          <div className="reshade-card" data-card="game">
            <p className="reshade-card-kicker" aria-hidden="true">
              {tr("В игре и числа DLSS 5")}
            </p>
            <MenuKeyPicker
              copy={copy}
              keyLabel={keyLabel}
              installed={installed}
              disabled={!bridge || Boolean(busy)}
              saving={busy === "key"}
              onPick={(entry) => void pickKey(entry)}
            />
            {numbers}
            {!dlssOn ? (
              <div className="reshade-lock">
                <Lock aria-hidden="true" />
                <p className="fx-hint">
                  {tr(
                    "Клавиша меню и ползунки нейросети откроются после установки.",
                  )}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  );
}
