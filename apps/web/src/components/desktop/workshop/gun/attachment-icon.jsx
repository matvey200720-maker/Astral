import * as Icons from "./attachment-icons.js";
import { createElement as h, useEffect, useRef, useState } from "react";
import * as Ui from "../../../../locales/ui.js";

// Рамка со снимком обвеса: снимок просим, когда рамка подъехала к экрану,
// а ответ соседа держим как есть, пока не придёт следующий.
const AttachmentIcon = (props) => {
  const { component, className = "", bone, weaponId, resolveGameRoot } = props;
  Ui.useTr();
  const { node, filled, seen } = useIconState({ weaponId, bone, component, resolveGameRoot });
  return h("span", frameAttrs(node, filled, seen, className), pictureOf(seen));
};

export default AttachmentIcon;

// Весь рабочий кусок компонента: ссылка на узел, состояние «рядом / ответ» и два эффекта.
function useIconState({ weaponId, bone, component, resolveGameRoot }) {
  const node = useRef(null);
  const { id, kind } = component ?? {};
  const [stage, setStage] = useState(FRESH);
  const { near, reply } = stage;

  useEffect(
    () => (id && !near ? startWatching(node.current, () => setStage(becomeNear)) : undefined),
    [near, id, node],
  );
  useEffect(
    () => (near && id ? sendRequest({ weaponId, bone, id, kind, resolveGameRoot }, (answer) => setStage(withReply(answer))) : undefined),
    [bone, weaponId, resolveGameRoot, kind, id, near],
  );

  return { node, filled: Boolean(id), seen: id ? reply : null };
}

function becomeNear(stage) {
  return stage.near ? stage : { ...stage, near: true };
}

function withReply(reply) {
  return (stage) => (Object.is(stage.reply, reply) ? stage : { ...stage, reply });
}

function frameAttrs(node, filled, seen, className) {
  return {
    ref: node,
    className: `gun-attach-icon${stateSuffix(filled, seen)} ${className}`.trim(),
    "aria-hidden": "true",
    title: captionOf(seen),
  };
}

function stateSuffix(filled, seen) {
  if (!filled) return " is-none";
  return seen?.url ? " is-ready" : "";
}

// Подсказка есть только у рамки с причиной; причина переводится по языку окна.
function captionOf(seen) {
  const reason = seen?.reason;
  if (!reason) return undefined;
  return Ui.tr(reason);
}

function pictureOf(seen) {
  if (!seen?.url) return null;
  return h("img", { alt: "", draggable: "false", src: seen.url });
}

// Наблюдатель за подъездом к экрану; без IntersectionObserver рамка считается близкой сразу.
class NearWatch {
  watcher = null;

  constructor(onNear) {
    this.onNear = onNear;
  }

  start(node) {
    const Observer = globalThis.IntersectionObserver;
    if (typeof Observer !== "function") {
      this.onNear();
      return;
    }
    this.watcher = new Observer((entries) => this.hear(entries), { rootMargin: "160px" });
    this.watcher.observe(node);
  }

  hear(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      this.onNear();
      this.stop();
      break;
    }
  }

  stop() {
    this.watcher?.disconnect();
  }
}

function startWatching(node, onNear) {
  const watch = new NearWatch(onNear);
  watch.start(node);
  return () => watch.stop();
}

// Талон запроса: после отмены wanted даёт ложь, а поздний ответ отбрасывается.
class Ticket {
  live = true;

  constructor(accept) {
    this.accept = accept;
  }

  wanted = () => this.live;

  deliver = (reply) => this.live && this.accept(reply);

  cancel() {
    this.live = false;
  }
}

function sendRequest(params, accept) {
  const ticket = new Ticket(accept);
  Icons.attachmentIcon({
    weaponId: params.weaponId,
    bone: params.bone,
    component: { id: params.id, kind: params.kind || "" },
    resolveGameRoot: params.resolveGameRoot,
    wanted: ticket.wanted,
  }).then(ticket.deliver);
  return () => ticket.cancel();
}

const FRESH = { near: false, reply: null };
