import {
  CircleNotch,
  Check,
  Info,
  Lock,
  WarningCircle,
} from "../../../ui/icons.jsx";
import {
  describeWorkshopInstall,
  workshopInstallShare,
} from "../../../../features/workshop/install-queue/index.js";
import "./optimizer-film.css";

/*
 * Куски панели раздела «Оптимизации» (дизайн 15.11.2026): строка состояния, три этапа установки, строки «ключ — значение».
 * Слова и условия приходят от вкладки — здесь только вид.
 */

/* Строка состояния: «выбрано» — значок «i», «в игре» — белая галочка, «идёт» — вращение, отказ — «!», «выключено» — без значка. */
export function StatusLine({
  tone = "info",
  children,
  role = "status",
  failed = false,
}) {
  return (
    <p
      className="opf-stt"
      data-tone={failed ? "error" : tone}
      role={role}
      data-failed={failed ? "true" : undefined}
    >
      {tone === "on" && !failed ? (
        <i className="opf-stt-mark" aria-hidden="true">
          <Check weight="bold" />
        </i>
      ) : tone === "busy" && !failed ? (
        <CircleNotch className="opf-spin" aria-hidden="true" />
      ) : failed ? (
        <WarningCircle aria-hidden="true" />
      ) : tone === "info" ? (
        <Info aria-hidden="true" />
      ) : null}
      <span>{children}</span>
    </p>
  );
}

/* «Выбрано: …. Нажмите «Установить»» — второе предложение приглушено, как в макете. */
export function SelectedText({ text }) {
  const value = String(text);
  const at = value.search(/\.\s+\S/);
  if (at < 0) return value;
  return (
    <>
      {value.slice(0, at + 1)} <em>{value.slice(at + 2)}</em>
    </>
  );
}

/* Три этапа установки; последний прервать нельзя. */
export function InstallSteps({ steps, lockLabel }) {
  return (
    <ol className="opf-steps">
      {steps.map((label, index) => (
        <li key={label}>
          <i aria-hidden="true">{index + 1}</i>
          <span>
            <b>{label}</b>
            {index === steps.length - 1 ? (
              <em>
                <Lock aria-hidden="true" />
                {lockLabel}
              </em>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/*
 * Идёт установка: тонкая полоса общей доли и шаги столбиком — сделан (белая галочка), идёт (кольцо), ждёт (бледный номер), у последнего — «прервать
 * нельзя». Шаги, подписи и доля — настоящие, из очереди установки (`describeWorkshopInstall`, `workshopInstallShare`: те же, что на экране
 * «В процессе»). Полоса растёт transform-ом.
 */
export function InstallProgress({ job, lockLabel }) {
  const view = describeWorkshopInstall(job);
  const share = workshopInstallShare(job, view);
  return (
    <div className="opf-run">
      <div
        className="opf-run-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        <i style={{ transform: `scaleX(${share})` }} />
      </div>
      <ol className="opf-stages">
        {view.steps.map((step, index) => (
          <li key={step.id} data-state={step.state}>
            <i aria-hidden="true">
              {step.state === "done" ? (
                <Check weight="bold" />
              ) : step.state === "active" ? (
                <CircleNotch className="opf-spin" />
              ) : (
                index + 1
              )}
            </i>
            <span>
              <b>
                {step.label}
                {index === view.steps.length - 1 ? (
                  <em className="opf-lock">
                    <Lock aria-hidden="true" />
                    {lockLabel}
                  </em>
                ) : null}
              </b>
              {step.hint ? <small>{step.hint}</small> : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* Строки «ключ — значение» панели; третий член — выделить значение. */
export function Facts({ rows }) {
  return (
    <dl className="opf-facts">
      {rows.map(([name, value, strong]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd className={strong ? "is-strong" : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
