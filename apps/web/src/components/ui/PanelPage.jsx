import Button from "./Button.jsx";
import { createPortal } from "react-dom";
import { PanelPageContext } from "./panel-page-context.js";
import { createElement as h, Fragment, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { tr, useTr } from "../../locales/ui.js";
import { CaretLeft } from "./icons.jsx";

// Последняя переданная функция «назад»: шапка и кнопка зовут её, а не ту, что была при записи.
function useLatest(value) {
  const box = useRef(value);
  box.current = value;
  return box;
}

// Место для значков шапки: создаётся один раз, пока значки не пропадут и не появятся заново;
// узел места попадает в состояние страницы через ссылку, и только тогда значки идут порталом.
function useActionsSlot(actions) {
  const [node, setNode] = useState(() => null);
  const wanted = actions ? 1 : 0;
  const slot = useMemo(() => (wanted === 1 ? h("span", { className: "ui-panel-page-actions", ref: setNode }) : null), [wanted]);
  return { node, slot };
}

// Запись шапки каркасу: пока страница на месте, она стоит; смена полей снимает её и пишет заново.
function useHeadEntry(setHead, { backText, goBack, label, note, slot }) {
  useLayoutEffect(() => {
    if (!setHead) return undefined;
    const goBackNow = () => {
      const latestBack = goBack.current;
      if (latestBack) latestBack();
    };
    setHead({
      actions: slot,
      back: { label: backText, onClick: goBackNow },
      label,
      note,
    });
    return () => {
      setHead(null);
    };
  }, [backText, goBack, label, note, setHead, slot]);
}

const backButton = (text, goBack) => h(Button, { className: "ui-panel-page-back", variant: "ghost", size: "sm", icon: h(CaretLeft), onClick: () => goBack.current?.() }, text);

// Что идёт перед детьми: в каркасе — значки порталом в шапку, вне него — строка «назад» и значки как есть.
const LEADS = {
  true: ({ node, actions }) => [node && actions ? createPortal(actions, node) : null],
  false: ({ backText, goBack, actions }) => [backButton(backText, goBack), actions],
};

export default function PanelPage(props) {
  const { label, note = null, backLabel = "", onBack, actions = null, children } = props;
  useTr();
  const setHead = useContext(PanelPageContext);
  const goBack = useLatest(onBack);
  const { node, slot } = useActionsSlot(actions);
  const backText = backLabel || tr("Назад");
  useHeadEntry(setHead, { label, note, backText, slot, goBack });
  return h(Fragment, null, ...LEADS[Boolean(setHead)]({ node, actions, backText, goBack }), children);
}
