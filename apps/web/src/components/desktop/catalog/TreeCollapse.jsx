import { motionEnabled } from "../../../motion-preference.js";
import { createElement, useLayoutEffect, useRef, useState } from "react";

const TIMING = { duration: 220, easing: "cubic-bezier(0.22, 0.72, 0.24, 1)" };
const nothing = () => {};

// Ход возможен только у узла с animate и при включённом движении.
const canMove = (node) => Boolean(node) && typeof node.animate === "function" && motionEnabled();

// Запускает ход и отдаёт отмену; свёртка по окончании зовёт onGone, если её не отменили.
function startRun(node, growing, onGone) {
  const frames = growing
    ? [{ height: "0px", opacity: 0 }, { height: `${node.scrollHeight}px`, opacity: 1 }]
    : [{ height: `${node.getBoundingClientRect().height}px`, opacity: 1 }, { height: "0px", opacity: 0 }];
  const run = node.animate(frames, { ...TIMING, fill: growing ? "none" : "forwards" });
  const afterwards = growing ? nothing : onGone;
  let live = true;
  run.finished.then(() => {
    if (live) afterwards();
  }, nothing);
  return () => {
    live = false;
    run.cancel();
  };
}

export default function TreeCollapse({ open, children }) {
  const [built, setBuilt] = useState(() => open);
  const nodeRef = useRef(null);
  const firstPass = useRef(true);

  if (!built && open) setBuilt(true);

  useLayoutEffect(() => {
    const skip = firstPass.current;
    firstPass.current = false;
    if (skip) return undefined;
    const node = nodeRef.current;
    if (canMove(node)) return startRun(node, open, () => setBuilt(false));
    if (!open) setBuilt(false);
    return undefined;
  }, [open]);

  if (!built) return null;
  return createElement("div", { ref: nodeRef, className: "catalog-tree-collapse", "data-state": open ? "open" : "closing" }, children());
}
