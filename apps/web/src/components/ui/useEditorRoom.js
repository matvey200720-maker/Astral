import { useSyncExternalStore, useLayoutEffect } from "react";

const MARK = "data-editor-room";
const nothing = () => {};
const neverOpenOnServer = () => false;

// Одна комната на окно: сколько компонентов её держат и сколько раз её закрывали.
class Room {
  constructor() {
    this.holders = 0;
    this.closings = 0;
  }

  // Корень запоминается при входе: метку снимаем с того же <html>, где ставили.
  enter(root) {
    this.holders += 1;
    root.setAttribute(MARK, "");
    return () => this.leave(root);
  }

  leave(root) {
    this.holders = Math.max(0, this.holders - 1);
    if (this.holders === 0) {
      root.removeAttribute(MARK);
      this.closings += 1;
    }
  }
}

const room = new Room();

function observeMark(onChange) {
  const Watcher = globalThis.MutationObserver;
  if (typeof Watcher !== "function") return nothing;
  const watcher = new Watcher(onChange);
  watcher.observe(document.documentElement, { attributeFilter: [MARK], attributes: true });
  return () => watcher.disconnect();
}

function editorRoomOpen() {
  return typeof document !== "undefined" && document.documentElement.hasAttribute(MARK);
}

function editorRoomSession() {
  return room.closings;
}

function useEditorRoomOpen() {
  return useSyncExternalStore(observeMark, editorRoomOpen, neverOpenOnServer);
}

function useEditorRoom() {
  useLayoutEffect(() => room.enter(document.documentElement), []);
}

export { MARK as EDITOR_ROOM_ATTRIBUTE, editorRoomOpen, editorRoomSession, useEditorRoomOpen };
export default useEditorRoom;
