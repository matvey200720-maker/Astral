import { useCallback, useEffect, useRef, useState } from "react";
import { PREWARM_BOOT_MS, prewarmAllowed, trackInput } from "../../ui/idle-gate.js";

/*
 * Прогрев окна настроек (31.10.2026).
 *
 * Открытие настроек при ×4: холодное — 200–350 мс одной задачей, второе и следующие — 67–83 мс, хотя узлы окна собирались заново каждый раз (Dialog на закрытом
 * отдавал null). Разобрать окно прогретым и собрать снова значило заплатить в открытии за 236 новых узлов (стиль 46 мс и раскладка 18 мс при ×4 в задаче фокуса):
 * кэши тёплые, узлы — нет. Поэтому окно не разбирается: после прогрева оно остаётся смонтированным и скрытым (опция keep у Dialog), открытие — показ готового.
 *
 * ЭФФЕКТЫ СТРАНИЦЫ НЕ СТАРТУЮТ ДО ОТКРЫТИЯ. Закрытую страницу держит скрытая Activity: React собирает узлы на самом низком приоритете, а эффекты (запросы, таймеры,
 * подписки, метка на оболочке, запись в хранилище) не монтирует; при закрытии их снимает. Узлы Activity прячет строкой display: none !important — прогрев её
 * снимает и считает стиль и раскладку кусками: каркас, потом по куску не больше ~30 узлов (у куска снимается content-visibility: hidden и читается высота), каждый
 * кусок — своё requestIdleCallback. Само окно в это время невидимо (visibility: hidden у подложки, is-kept в листе диалога).
 *
 * КОГДА. Не раньше, чем через 10 с после старта окна и только если 2 с ничего не трогали. Не греется: окно скрыто или свёрнуто, идёт установка, открыт редактор
 * (там WebGL), открыто другое окно. Ввод посреди прогрева — прогрев уступает (кусок не берётся, пока не стихнет) и продолжается с того же места. Кусок не берётся и
 * пока браузер ждёт ввод (isInputPending). Застой дольше двух минут — окно разбирается, прогрев ждёт заново. Если человек открыл настройки раньше прогрева, окно
 * после закрытия тоже остаётся: второе открытие — показ готового.
 */

export { noteInputAt, prewarmAllowed, PREWARM_BOOT_MS, PREWARM_QUIET_MS, trackInput } from "../../ui/idle-gate.js";

const POLL_MS = 1_000;
const PAUSE_MS = 500;
const STALL_MS = 120_000;
const READY_POLL_MS = 150;
const READY_TIMEOUT_MS = 8_000;
const UNIT_NODES = 30;

/**
 * Решает, когда окну настроек стоять смонтированным. keep — пора держать окно (Dialog keep); warming — идёт прогрев (считаются стиль и раскладка).
 * Открыли сами — окно остаётся и после закрытия.
 */
export function useSettingsPrewarm({ open, busy }) {
  const [stage, setStage] = useState("waiting");
  useEffect(() => {
    if (open && stage !== "kept") setStage("kept");
  }, [open, stage]);
  useEffect(() => {
    if (stage !== "waiting" || open) return undefined;
    trackInput();
    let timer = 0;
    const tick = () => {
      if (!busy && performance.now() >= PREWARM_BOOT_MS && prewarmAllowed()) {
        setStage("warming");
        return;
      }
      timer = window.setTimeout(tick, POLL_MS);
    };
    timer = window.setTimeout(tick, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [stage, open, busy]);
  const done = useCallback(() => setStage("kept"), []);
  const abort = useCallback(() => setStage("waiting"), []);
  return { keep: stage !== "waiting", warming: stage === "warming" && !open, done, abort, busy };
}

function whenIdle(task) {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(task, { timeout: 1000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(task, 50);
  return () => clearTimeout(id);
}

/** Узлы, которые Activity спрятала (display: none !important в строке стиля), показываются — прятать будет подложка. */
function stripHiddenDisplay(body) {
  for (const node of body.children) {
    const style = node.style;
    if (style.display === "none" && style.getPropertyPriority("display") === "important") style.removeProperty("display");
  }
}

/** Куски не больше UNIT_NODES узлов: что крупнее — делится на детей. Каркас (крупные узлы) считается первым проходом. */
function unitsOf(body) {
  const units = [];
  const visit = (node) => {
    if (node.querySelectorAll("*").length <= UNIT_NODES) {
      units.push(node);
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const child of body.children) visit(child);
  return units;
}

function keptBody() {
  return document.querySelector(".settings-window-backdrop.is-kept .settings-window-body");
}

/**
 * Считает стиль и раскладку смонтированного закрытого окна кусками в простое. active — пока прогрев идёт; onDone — все куски сочтены; onAbort — окно не собралось за
 * восемь секунд или стоит без дела дольше двух минут.
 */
export function useWarmLayout({ active, busy, onDone, onAbort }) {
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (!active) return undefined;
    let cancel = () => {};
    let cancelled = false;
    let phase = "dom";
    let units = [];
    let index = 0;
    let lastCount = -1;
    const started = performance.now();
    let stalledSince = 0;
    let warmingMark = null;

    const measure = (task) => {
      const from = performance.now();
      task();
      try {
        performance.measure("settings-prewarm", { start: from, end: performance.now() });
      } catch {
        /* Метки времени — для замера; без них прогрев тот же. */
      }
    };
    const schedule = (delay = 0) => {
      cancel();
      if (delay > 0) {
        const id = setTimeout(step, delay);
        cancel = () => clearTimeout(id);
      } else cancel = whenIdle(step);
    };
    function step() {
      if (cancelled) return;
      if (busyRef.current || !prewarmAllowed()) {
        stalledSince ||= performance.now();
        if (performance.now() - stalledSince > STALL_MS) onAbort();
        else schedule(PAUSE_MS);
        return;
      }
      stalledSince = 0;
      if (navigator.scheduling?.isInputPending?.()) {
        schedule();
        return;
      }
      const body = keptBody();
      if (body && !warmingMark) {
        warmingMark = body.closest(".settings-window-backdrop");
        warmingMark?.setAttribute("data-warming", "");
      }
      if (phase === "dom") {
        /* React собирает скрытую страницу кусками на низшем приоритете: ждём, пока число узлов перестанет расти. */
        const count = body ? body.querySelectorAll("*").length : 0;
        if (body && count > 20 && count === lastCount) {
          measure(() => {
            stripHiddenDisplay(body);
            units = unitsOf(body);
            for (const unit of units) unit.style.contentVisibility = "hidden";
            void body.offsetHeight;
          });
          phase = "units";
          schedule();
          return;
        }
        if (performance.now() - started > READY_TIMEOUT_MS) {
          onAbort();
          return;
        }
        lastCount = count;
        schedule(READY_POLL_MS);
        return;
      }
      const unit = units[index];
      index += 1;
      if (!unit || !unit.isConnected) {
        onDone();
        return;
      }
      measure(() => {
        unit.style.removeProperty("content-visibility");
        void unit.offsetHeight;
      });
      schedule();
    }
    schedule(READY_POLL_MS);
    return () => {
      cancelled = true;
      cancel();
      /* Открыли посреди прогрева или прогрев сняли: ни один кусок не остаётся скрытым. */
      for (const unit of units) unit.style.removeProperty("content-visibility");
      warmingMark?.removeAttribute("data-warming");
    };
  }, [active, onAbort, onDone]);
}
