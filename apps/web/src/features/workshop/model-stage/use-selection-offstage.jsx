import { itemSeen } from "../items-panel/scene-parts.js";
import { tr } from "../../../locales/ui.js";
import { isTextEntry } from "../../../utils/hotkeys.js";
import Button from "../../../components/ui/Button.jsx";
import { createElement as h, useCallback, useEffect, useRef, useState } from "react";

const MODIFIERS = ["ctrlKey", "metaKey", "altKey", "shiftKey"];

// Причины пропустить нажатие; проверяются по порядку.
const IGNORE_KEYDOWN = [
  (event) => event.code !== "KeyF",
  (event) => event.repeat,
  (event) => event.defaultPrevented,
  (event) => MODIFIERS.some((name) => event[name]),
  (event) => isTextEntry(event.target),
  () => document.querySelector("[role='dialog']:not([data-ui-tour])"),
];

const keyOf = (target) => {
  const [found = null] = [target?.key].filter(Number.isInteger);
  return found;
};

const partOf = (target, key) => (key !== null && target.part) || null;

const listen = (type, handler) => {
  window.addEventListener(type, handler);
  return () => window.removeEventListener(type, handler);
};

const flyOnKey = (show) => (event) => {
  if (IGNORE_KEYDOWN.some((ignored) => ignored(event))) return;
  event.preventDefault();
  show();
};

const refreshSeen = (latest, stageRef, setOffstage) => {
  const { key, part, asset } = latest;
  if (key === null) return;
  setOffstage(!itemSeen(stageRef?.current, asset, key, part));
};

const flyTo = (latestRef, setOffstage) => {
  setOffstage(false);
  latestRef.current.onShow?.();
};

const showButtonProps = (show) => ({
  size: "sm",
  variant: "secondary",
  title: tr("Подлететь к выбранному — клавиша F"),
  "aria-keyshortcuts": "F",
  onClick: show,
});

const plateOf = (name, show) => {
  const label = h(
    "span",
    { className: "stage-offstage-name" },
    tr("{0} за кадром").replace("{0}", name),
  );
  const action = h(Button, showButtonProps(show), tr("Показать"));
  const children = [label, action];
  return h("div", { className: "ui-stage-bar stage-offstage", role: "status" }, ...children);
};

// Флаг «за кадром»: сбрасывается, когда меняется цель.
const useOffstageFlag = (key, part) => {
  const [offstage, setOffstage] = useState(false);
  useEffect(() => {
    setOffstage(false);
  }, [key, part]);
  return [offstage, setOffstage];
};

const useLatest = (value) => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};

const useShowHotkey = (active, show) => {
  useEffect(() => (active ? listen("keydown", flyOnKey(show)) : undefined), [active, show]);
};

const useSelectionOffstage = (props) => {
  const { name = "", onShow = null, target, asset, stageRef } = props;
  const key = keyOf(target);
  const part = partOf(target, key);

  const [offstage, setOffstage] = useOffstageFlag(key, part);
  const now = useLatest({ key, part, asset, onShow });

  const onCameraRest = useCallback(
    () => refreshSeen(now.current, stageRef, setOffstage),
    [stageRef, now, setOffstage],
  );
  const show = useCallback(() => flyTo(now, setOffstage), [now, setOffstage]);

  const active = key !== null && Boolean(onShow);
  useShowHotkey(active, show);

  return { onCameraRest, plate: active && offstage ? plateOf(name, show) : null };
};

export { useSelectionOffstage };
