import { useEffect, useRef } from "react";

const COLUMN_SELECTOR = ".ui-editor-inspector";
const FRAME_ATTR = "data-file-drop";
const LABEL_ATTR = "data-file-drop-label";

const typesOf = (event) => event.dataTransfer?.types ?? [];
const withFiles = (event) => Array.from(typesOf(event)).includes("Files");

// Рамка на колонке: два атрибута, второй несёт подпись.
const frame = {
  show(target, label) {
    target.setAttribute(FRAME_ATTR, "");
    target.setAttribute(LABEL_ATTR, label);
  },
  hide(target) {
    for (const name of [FRAME_ATTR, LABEL_ATTR]) target.removeAttribute(name);
  },
};

// Слушается вся колонка редактора; при `self` или без колонки — сам узел.
const dropTarget = (node, self) => (self ? node : (node?.closest(COLUMN_SELECTOR) ?? node));

// Пары «событие — слушатель»; считают заходы файла в цель и показывают рамку, пока он над ней.
function dragListeners(target, label, dropRef) {
  let depth = 0;
  const table = [
    [
      "dragenter",
      (event) => {
        event.preventDefault();
        depth += 1;
        frame.show(target, label);
      },
    ],
    [
      "dragover",
      (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      },
    ],
    [
      "dragleave",
      () => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) frame.hide(target);
      },
    ],
    [
      "drop",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        depth = 0;
        frame.hide(target);
        const file = event.dataTransfer.files?.[0];
        if (file) dropRef.current?.onFile(file);
      },
    ],
  ];
  return table.map(([type, handle]) => [
    type,
    (event) => {
      if (withFiles(event)) handle(event);
    },
  ]);
}

/** Рамка «Отпустите — встанет на …» на колонке редактора, пока над ней держат файл. */
export function useFileDrop(anchor, drop, { self = false } = {}) {
  const label = drop?.label || "";
  const enabled = Boolean(drop);
  const dropRef = useRef(drop);
  // onFile читается в момент отпускания: новая функция слушателей не пересоздаёт.
  dropRef.current = drop;

  // Цель считается первой, потом проверяется «drop есть и цель есть».
  useEffect(() => {
    const target = dropTarget(anchor.current, self);
    if (!enabled || !target) return undefined;

    const listeners = dragListeners(target, label, dropRef);
    for (const [type, listener] of listeners) target.addEventListener(type, listener);
    return () => {
      for (const [type, listener] of listeners) target.removeEventListener(type, listener);
      frame.hide(target);
    };
  }, [anchor, enabled, label, self]);
}
