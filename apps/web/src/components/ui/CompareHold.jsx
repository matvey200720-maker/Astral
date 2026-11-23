import Button from "./Button.jsx";
import { Eye } from "./icons.jsx";
import { tr, useTr } from "../../locales/ui.js";
import { isTextEntry } from "../../utils/hotkeys.js";
import { createElement as h, useEffect, useRef } from "react";

const HOLD_KEYS = [" ", "Enter"];
const MODIFIERS = ["ctrlKey", "metaKey", "altKey"];

// Последняя переданная функция владельца: смена onChange подписки не трогает.
function useLatest(value) {
  const box = useRef(value);
  box.current = value;
  return box;
}

// Что уходит владельцу: только булево и всегда последняя переданная функция.
const reporter = (latest) => (flag) => () => {
  latest.current?.(flag);
};

// Клавиша «\» на окне: нажатие без Ctrl, Meta, Alt и не из текстового поля начинает сравнение,
// отпускание (с любыми модификаторами) и уход фокуса окна его кончают.
function windowHandlers(latest) {
  const tell = reporter(latest);
  const begin = tell(true);
  const finish = tell(false);
  const isBackslash = (event) => event.code === "Backslash";
  const down = (event) => {
    const plain = isBackslash(event) && !event.repeat && !MODIFIERS.some((name) => event[name]);
    if (!plain || isTextEntry(event.target)) return;
    event.preventDefault();
    begin();
  };
  const up = (event) => {
    if (isBackslash(event)) finish();
  };
  return [["keydown", down], ["keyup", up], ["blur", finish]];
}

function useBackslashHold(latest) {
  useEffect(() => {
    const table = windowHandlers(latest);
    table.forEach(([type, handler]) => window.addEventListener(type, handler));
    return () => table.forEach(([type, handler]) => window.removeEventListener(type, handler));
  }, [latest]);
}

// События самой кнопки: удержание мышью и пробелом или Enter; повтор клавиши гасится, но не считается.
function buttonEvents(latest) {
  const tell = reporter(latest);
  const begin = tell(true);
  const finish = tell(false);
  const holdKey = (event) => HOLD_KEYS.includes(event.key);
  return {
    onPointerDown: (event) => {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      begin();
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    onKeyDown: (event) => {
      if (!holdKey(event)) return;
      event.preventDefault();
      if (!event.repeat) begin();
    },
    onKeyUp: (event) => {
      if (holdKey(event)) finish();
    },
    onBlur: finish,
  };
}

export default function CompareHold(props) {
  const { active = false } = props;
  const latest = useLatest(props.onChange);
  useBackslashHold(latest);
  useTr();
  const word = tr("Как в игре");
  const hint = tr("Удерживайте — кадр как в игре; клавиша \\");
  const look = { className: "ui-compare-hold", variant: "ghost", size: "sm", active, icon: h(Eye) };
  const labels = { "aria-pressed": active, "aria-label": `${word}. ${hint}`, title: hint };
  return h(Button, Object.assign(look, labels, buttonEvents(latest)), word);
}
