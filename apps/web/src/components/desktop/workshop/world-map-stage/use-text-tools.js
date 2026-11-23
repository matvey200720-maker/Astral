// Надписи на карте: печать (`textEdit`), правка подписи зоны или точки на месте, правка на
// табло «Расписания», двойной щелчок. Хук держит правки в редьюсере, а «стол» (TextDesk)
// отдаёт состояние, скрытые ids и готовые поля.
import { createElement, useEffect, useMemo, useReducer } from "react";
import { sceneLabelOf } from "@modovik/vector-map";
import { hitTest, findObject, patchObject } from "../world-map-editing.js";
import { tr } from "../../../../locales/ui.js";
import MapLabelEditor from "../world-map/MapLabelEditor.jsx";
import MapTextEditor from "../world-map/MapTextEditor.jsx";
import ScheduleBoardField from "../world-map/ScheduleBoardField.jsx";
import { currentBoard, framesOf, partDraft, partUnder, EDITABLE_PARTS, targetOfPart, rowOfPart, partPatch, editSlot, nextPart as deskNextPart, fieldGeometry, fieldFocusKey, hiddenBoardIds } from "./board-bridge.js";
import { FALLBACK_WIDTH } from "./numbers.js";
import { labelHitAt, isLocked } from "./select-rules.js";
import { labelFieldProps, emblemItems, typeFieldProps } from "./text-fields.js";

const NO_IDS = new Set();
const NO_EDITS = { label: null, board: null };
const DOUBLE_CLICK_TOOLS = ["select", "text"];
const BOARD_TOOLS = ["schedule", "images"];

const targetOf = ({ kind, id }) => ({ kind, id });

// Правки на месте: открытая подпись и открытое поле табло
const typed = (slot) => (state, draft) =>
  state[slot] ? { ...state, [slot]: { ...state[slot], draft } } : state;
const closed = (slot) => (state) => (state[slot] ? { ...state, [slot]: null } : state);

const EDIT_ACTIONS = {
  openLabel: (state, label) => ({ ...state, label }),
  openBoard: (state, board) => ({ ...state, board }),
  typeLabel: typed("label"),
  typeBoard: typed("board"),
  closeLabel: closed("label"),
  closeBoard: closed("board"),
  closeAll: (state) => (state.label || state.board ? NO_EDITS : state),
  // выбор сменился: поле остаётся, только пока выбрана та же подпись или само табло
  keepFor(state, { pickedId, boardId }) {
    const label = state.label?.target.id === pickedId ? state.label : null;
    const board = boardId !== undefined && boardId === pickedId ? state.board : null;
    return label === state.label && board === state.board ? state : { label, board };
  },
};
const reduceEdits = (state, { type, value }) => EDIT_ACTIONS[type](state, value);

class TextDesk {
  constructor(env, edits, send, hidden) {
    this.env = env;
    this.labelEdit = edits.label;
    this.boardEdit = edits.board;
    this.send = send;
    this.hidden = hidden;
    this.board = currentBoard(env.config);
    this.scale = (env.win.width || FALLBACK_WIDTH) / env.frame.width;
  }

  get boardFrame() {
    return framesOf(this.board, this.env.projector);
  }

  // Открыть поле табло на части: черновик берётся из самого табло
  #openPart(target) {
    this.send("openBoard", { ...target, draft: partDraft(this.board, target) });
  }

  // ——— двойной щелчок: надпись, затем табло, затем подпись ———
  editTextAt = (world) => {
    const { env } = this;
    if (!env.onEditText || !DOUBLE_CLICK_TOOLS.includes(env.tool)) return false;
    const options = { textAdvance: env.textAdvance };
    const hit = hitTest(env.config, "emblems", world, env.tolerance, env.preferLayer, options);
    const object = hit ? findObject(env.config, hit) : null;
    if (object?.kind !== "text") return false;
    env.onEditText({ kind: "emblem", id: hit.id });
    return true;
  };

  openBoardAt = (point) => {
    const { env, board } = this;
    const part = board && BOARD_TOOLS.includes(env.tool) ? partUnder(this.boardFrame, point) : null;
    if (!part || !EDITABLE_PARTS.has(part.kind)) return false;
    env.onSelect({ kind: "emblem", id: board.id });
    this.#openPart(targetOfPart(part));
    const row = rowOfPart(part);
    if (row !== null) env.onBoardRow?.(row);
    return true;
  };

  openLabelAt = (point) => {
    const { env } = this;
    const hit = labelHitAt(env, point);
    if (!hit) return false;
    const target = targetOf(hit);
    const draft = String(findObject(env.config, target).name || "");
    const label = sceneLabelOf(env.scene, target);
    this.send("openLabel", { target, draft, opened: draft, label });
    env.onSelect(targetOf(hit));
    return true;
  };

  // ——— поля ———
  #typeLabel(value) {
    const { env, labelEdit } = this;
    const { target } = labelEdit;
    this.send("typeLabel", value);
    if (value.trim()) {
      const step = patchObject(env.config, target, { name: value });
      env.change(step, tr("Текст подписи"), `label.text.${target.id}`);
    }
  }

  labelField = () => {
    const { env, labelEdit } = this;
    if (!labelEdit?.label) return null;
    return createElement(MapLabelEditor, {
      focusKey: labelEdit.target.id,
      draft: labelEdit.draft,
      ...labelFieldProps(labelEdit, env.frame, this.scale),
      onChange: (value) => this.#typeLabel(value),
      onDone: () => this.send("closeLabel"),
    });
  };

  #typeBoard(value) {
    const { env, board, boardEdit } = this;
    this.send("typeBoard", value);
    const patch = partPatch(board, boardEdit, value);
    const slot = editSlot(boardEdit);
    env.change(
      patchObject(env.config, { kind: "emblem", id: board.id }, patch),
      tr("Текст на табло"),
      `schedule.field.${boardEdit.part}.${slot}`,
    );
  }

  // Enter: к следующей части табло, а за последней поле закрывается
  #nextPart() {
    const next = deskNextPart(this.boardFrame, this.boardEdit);
    if (!next) return this.send("closeBoard");
    this.#openPart(next);
    if (Number.isInteger(next.index)) this.env.onBoardRow?.(next.index);
    return undefined;
  }

  boardField = () => {
    const { env, board, boardEdit } = this;
    if (!boardEdit || !board) return null;
    const origin = { x: env.frame.x, y: env.frame.y };
    const place = fieldGeometry(this.boardFrame, emblemItems(env.scene), boardEdit, this.scale, origin);
    if (!place) return null;
    return createElement(ScheduleBoardField, {
      focusKey: fieldFocusKey(boardEdit),
      draft: boardEdit.draft,
      ...place,
      multiline: boardEdit.part === "name",
      onChange: (value) => this.#typeBoard(value),
      onNext: () => this.#nextPart(),
      onDone: () => this.send("closeBoard"),
    });
  };

  typeField = (onGrip) => {
    const { env } = this;
    const { textEdit, selection, config } = env;
    if (!textEdit || !(env.frame.width > 0)) return null;
    const selected = selection ? findObject(config, selection) : null;
    const frozen = selected ? isLocked(config, selection.kind, selected) : false;
    return createElement(MapTextEditor, {
      focusKey: textEdit.key,
      draft: textEdit.draft,
      ...typeFieldProps(textEdit, env, this.scale),
      grips: !frozen && Boolean(textEdit.emblem),
      onChange: textEdit.onChange,
      onDone: textEdit.onDone,
      onGrip,
    });
  };
}

// Что не рисуется на сцене, пока открыто поле: подпись и примитивы табло
function hiddenIdsOf(label, boardEdit, board, projector) {
  const ids = [];
  if (label) ids.push(`${label.target.kind}-label-${label.target.id}`);
  if (boardEdit && board) ids.push(...hiddenBoardIds(framesOf(board, projector), boardEdit));
  return ids;
}

export function useTextTools({ env }) {
  const [edits, dispatch] = useReducer(reduceEdits, NO_EDITS);
  const send = (type, value) => dispatch({ type, value });
  const board = currentBoard(env.config);
  const [boardId, pickedId] = [board?.id, env.selection?.id];

  // Правка закрывается сменой инструмента и сменой выбора
  useEffect(() => send("closeAll"), [env.tool]);
  useEffect(() => send("keepFor", { pickedId, boardId }), [pickedId, boardId]);

  const { label, board: boardEdit } = edits;
  const hidden = useMemo(() => {
    const ids = hiddenIdsOf(label, boardEdit, board, env.projector);
    return ids.length ? new Set(ids) : NO_IDS;
  }, [label, boardEdit, board, env.projector]);

  return new TextDesk(env, edits, send, hidden);
}
