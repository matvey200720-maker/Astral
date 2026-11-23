// Табло «Расписание»: показать, скрыть, добавить строку, сфокусировать строку.
// Рядом — полёт кадра к объекту, он нужен и табло, и выбору.
import { useMemo, useRef } from "react";
import { scheduleBoardOf as boardOf } from "@modovik/vector-map";
import { tr } from "../../../../locales/ui.js";
import { findObject as lookupObject, patchObject as patchOf } from "../world-map-editing.js";
import {
  addBoardRow,
  hideScheduleBoard,
  showScheduleBoard,
} from "../world-map/schedule-board-editing.js";
import { toTarget } from "./map-helpers.js";

function boardTarget(board) {
  return toTarget("emblem", board.id);
}

// Команды табло этой отрисовки читают её проект; поля-стрелки связаны с экземпляром
class BoardDesk {
  constructor(deps) {
    this.d = deps;
  }

  // Табло на карте, если оно есть и не скрыто
  liveBoard() {
    const board = boardOf(this.d.config.emblems);
    if (!board || board.enabled === false) return null;
    return board;
  }

  focusRow(row, icon) {
    const focus = { row, icon };
    focus.stamp = Date.now();
    this.d.setBoardFocus(focus);
  }

  // Кадр летит к объекту проекта; нет объекта — полёта нет
  flyTo = (target, project = this.d.config) => {
    const object = target ? lookupObject(project, target) : null;
    if (!object) {
      this.d.setFocus(null);
      return;
    }
    this.d.setFocus({ object, kind: target.kind, stamp: Date.now() });
  };

  // «Показать набор» на карте: кадр летит к точкам набора
  focusSet = (section, setId, options) => {
    const points = [];
    for (const item of (options?.config || this.d.config)[section]?.items || []) {
      if ((item.group || "") !== setId) continue;
      points.push(...(item.points || [{ x: item.x, y: item.y }]));
    }
    if (points.length === 0) return;
    const focus = { object: { points }, kind: "zone", stamp: Date.now() };
    focus.ifHidden = options?.ifHidden;
    this.d.setFocus(focus);
  };

  showBoard = () => {
    const { config, apply } = this.d;
    const live = this.liveBoard();
    if (live) return this.d.setPicked([boardTarget(live)]);
    const shown = showScheduleBoard(config);
    apply(shown.config, tr("Расписание на карте"), "schedule.show");
    this.d.setPicked([shown.selection]);
    return this.flyTo(shown.selection, shown.config);
  };

  hideBoard = () => {
    this.d.apply(hideScheduleBoard(this.d.config), tr("Расписание скрыто"), "schedule.hide");
    this.d.setPicked([]);
  };

  onBoardAdd = () => {
    const live = this.liveBoard();
    if (live) {
      const next = patchOf(this.d.config, boardTarget(live), addBoardRow(live));
      this.d.apply(next, tr("Строка добавлена"), "schedule.rows");
      this.focusRow(live.schedule.rows.length, false);
    }
  };

  onBoardRow = (row) => this.focusRow(row, false);

  onBoardIcon = (row) => this.focusRow(row, true);

  focusBoard = () => {
    const board = boardOf(this.d.config.emblems);
    if (board) this.flyTo(boardTarget(board));
  };
}

// Имена команд наружу: поля-функции экземпляра, в порядке объявления
const COMMAND_NAMES = (() => {
  const probe = new BoardDesk(null);
  return Object.keys(probe).filter((name) => typeof probe[name] === "function");
})();

export function useBoard(deps) {
  const desk = useRef(null);
  desk.current = new BoardDesk(deps);
  return useMemo(() => {
    const stable = {};
    for (const name of COMMAND_NAMES) stable[name] = (...args) => desk.current[name](...args);
    return stable;
  }, []);
}
