/*
 * Запуск окна: док «Подготовка GTA V» и ленивая страница входа. Заставка запуска «Контур» и экран пробуждения живут рядом с
 * оболочкой (`features/onboarding/splash/StartupSplash.jsx`, её ставит `DesktopAppPage.jsx`): после запуска она остаётся
 * накладкой на время ухода, поэтому не внутри оболочки.
 * Это то, что нужно каждому запуску, поэтому живёт в главном куске; страница входа и выбор игры (`ProductOnboardingPage.jsx`)
 * нужны новому человеку один раз и подгружаются отдельным куском (бюджет бандла 03.11.2026).
 */

import { Suspense, lazy, useEffect, useState } from "react";
import { ArrowRight, CaretDown, Check, CheckCircle, CircleNotch, ShieldCheck } from "../components/ui/icons.jsx";
import { tr, useTr } from "../locales/ui.js";
import { preparationLine } from "../components/desktop/shell-notices.js";

/* «Закрыть зависшую GTA V» (26.11.2026): сама показывается, только когда игра и правда зависла; куском по запросу. */
const HungGameClose = lazy(() => import("../features/downloads/HungGameClose.jsx"));

export function PreparationDock({ state, language, onOpenSettings }) {
  useTr();
  const [open, setOpen] = useState(() => state?.status === "running");
  useEffect(() => {
    if (state?.status === "running") setOpen(true);
  }, [state?.status]);
  if (!state || state.status === "idle") return null;
  /* Слова дока — из словаря окна, в нём все шесть языков (22.11.2026): прежние таблицы по языкам в главном куске дублировали словарь и весили около 250 Б gzip. */
  const dockCopy = [tr("GTA V готова"), tr("Нужно завершить настройку"), tr("Подготовка GTA V"), tr("Открыть мастер настройки")];
  const finished = state.status === "ready";
  const needsAction =
    state.status === "needs-action" || state.status === "error";
  return (
    <aside
      className={`preparation-dock ${open ? "open" : "collapsed"} ${state.status}`}
    >
      <button className="preparation-dock-head" onClick={() => setOpen(!open)}>
        <span>
          {finished ? (
            <CheckCircle />
          ) : needsAction ? (
            <ShieldCheck />
          ) : (
            <span className="dock-mark" style={{ "--dock-level": `${Math.max(0, Math.min(100, state.progress || 0))}%` }} aria-hidden="true" />
          )}
        </span>
        <div>
          <b>
            {finished ? dockCopy[0] : needsAction ? dockCopy[1] : dockCopy[2]}
          </b>
          <small>{preparationLine(state.status, state.message, language)}</small>
        </div>
        <strong>{Math.round(state.progress || 0)}%</strong>
        <CaretDown />
      </button>
      {open && (
        <div className="preparation-dock-body">
          <div className="preparation-progress">
            <i style={{ width: `${state.progress || 0}%` }} />
          </div>
          <ol>
            {(state.steps || []).map((step) => (
              <li className={step.status} key={step.id}>
                {step.status === "done" ? (
                  <Check />
                ) : step.status === "active" ? (
                  <CircleNotch className="spin" />
                ) : (
                  <i />
                )}
                <span>
                  <b>{step.label}</b>
                  <small>{step.detail}</small>
                </span>
              </li>
            ))}
          </ol>
          {state.status === "error" && (
            <Suspense fallback={null}>
              <HungGameClose />
            </Suspense>
          )}
          {needsAction && (
            <button onClick={onOpenSettings}>
              {dockCopy[3]}
              <ArrowRight />
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

/* Страница входа и выбор игры нужны новому человеку один раз — отдельный кусок; пока он едет, на месте пустая страница с меткой:
   заставка запуска не уходит с экрана, пока метка стоит (`StartupSplash.jsx`, `hold`). */
export const loadProductOnboarding = () => import("./ProductOnboardingPage.jsx");
const ProductOnboarding = lazy(loadProductOnboarding);

export function ProductOnboardingScreen({ language, ...props }) {
  return (
    <Suspense fallback={<div className="product-onboarding" data-onboarding-pending="" />}>
      <ProductOnboarding language={language} {...props} />
    </Suspense>
  );
}
