/*
 * Редактор «Билборды» — рекламные щиты всей карты (задача 4 ТЗ 10.10.2026,
 * вечер): на крышах домов, у дорог и шоссе, на стенах.
 *
 * Над кадром — какой щит в кадре (щиты района и соседние стрелками).
 * Инструменты слева (мастерская «как в Photoshop»): «Все щиты» — одна
 * картинка или цвет на все щиты карты; «Один щит» — взятый щит по одному: своя
 * картинка первым делом (положил — и щит свой), под ней — «Где стоят»
 * строками: щиты по районам и видам, поиск, группа для одного облика (слово
 * владельца 30.10.2026, `design-qa.md`, п. 10–12: отдельного инструмента нет);
 * «Рисунок» — кисть, ластик, заливка и текст прямо на полотне (задача 3 ТЗ
 * 17.10.2026: в кадре — само полотно плоско); «Шаблоны» — готовые наборы и
 * «Стандарт». Кадр — щит из игры игрока с обликом работы.
 *
 * Общее с остальными местами (работа, черновик, «Мои работы»,
 * «Применить», камера) — `useRecolorEditor`. Все щиты «Как в игре» —
 * ставить нечего: «Применить» снимает установку.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { CaretLeft, CaretRight, ImageSquare, PaintBrush, SquaresFour, Swatches } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import {
  BILLBOARD_BRUSH,
  BILLBOARD_SHIELD_IDS,
  addBillboardDrawingOp,
  applyBillboardLook,
  applyBillboardsPreset,
  applyBillboardsStandard,
  billboard,
  billboardLookOf,
  changedBillboards,
  clearBillboardLooks,
  emptyBillboardDrawing,
  linkedBillboards,
  normalizeBillboardLook,
} from "@modovik/climb-contract/recolor/billboards";
import Button from "../../../components/ui/Button.jsx";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import MenuButton from "../../../components/ui/MenuButton.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import BillboardsCanvas, { drawingSizeOf } from "./BillboardsCanvas.jsx";
import { DEFAULT_BRUSH, normalizeBrush } from "./BillboardsDrawTool.jsx";
import BillboardsInspector from "./BillboardsInspector.jsx";
import BillboardsStage from "./BillboardsStage.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { billboardFaceSpec } from "./billboards-aim.js";
import { billboardsImages } from "./billboards-images.js";
import { boardLabelText, boardMenuOptions, boardsText, siblingBoard } from "./billboards-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Цифры — горячие клавиши по порядку панели: буквы в 3D-кадре заняты полётом. Подпись под именем панели — короткое имя того, что в ней
   (п. 9): у «Щита» — сам взятый щит (`toolsFor`). */
const TOOLS = Object.freeze(
  [
    {
      id: "all",
      label: "Все щиты",
      icon: <SquaresFour />,
      group: "paint",
      note: "Вся карта",
      hint: "Своя картинка, цвет или градиент — на все щиты карты разом. Щиты со своей картинкой остаются своими",
    },
    {
      id: "board",
      /* «Один щит», а не «Щит»: словарь знает «Щит» как доспех (на других языках выходило Shield, Tarcza, Bouclier). */
      label: "Один щит",
      icon: <ImageSquare />,
      group: "paint",
      note: "Взятый щит",
      hint: "Щелчок по щиту в кадре или строка «Где стоят» берёт щит; положите картинку — и он свой",
    },
    {
      id: "draw",
      label: "Рисунок",
      icon: <PaintBrush />,
      group: "paint",
      note: "Кисть и текст",
      hint: "Полотно взятого щита — плоско, в его пропорции: рисуйте прямо на нём. Рисунок ложится поверх облика и уедет в игру. Отменить штрих — Ctrl+Z",
    },
    {
      id: "templates",
      label: "Шаблоны",
      icon: <Swatches />,
      group: "ready",
      /* Подписи нет: заголовок полки «Готовые наборы» сразу под именем панели (подпись повторяла бы его). */
      hint: "Готовый набор оформляет все щиты разом — дальше любой щит можно поменять по одному",
    },
  ].map((tool, index) => Object.freeze({ ...tool, shortcut: String(index + 1) })),
);
const TOOL_IDS = TOOLS.map((tool) => tool.id);

/* Под курсором и по щелчку в кадре — только щиты: соседний баннер на здании правится в «Баннерах на зданиях». */
const SHIELD = (id) => BILLBOARD_SHIELD_IDS.includes(id);

/* Что за шаг рисунка — подписью «Отменить». */
const STROKE_LABELS = Object.freeze({ brush: "штрих кисти", eraser: "ластик", fill: "заливка", text: "надпись" });

/* Подсказки внизу холста «Рисунка»: у плоского полотна камеры нет — мышь рисует. */
function drawGuide(tool) {
  if (tool === "fill") return [{ keys: tr("ЛКМ"), text: tr("залить область") }, { keys: "Ctrl+Z", text: tr("отменить шаг") }];
  if (tool === "text") return [{ keys: tr("ЛКМ"), text: tr("поставить надпись") }, { keys: "Ctrl+Z", text: tr("отменить шаг") }];
  return [
    { keys: tr("ЛКМ"), text: tool === "eraser" ? tr("стирать") : tr("рисовать") },
    { keys: ["[", "]"], text: tr("размер кисти") },
    { keys: "Ctrl+Z", text: tr("отменить штрих") },
  ];
}

function doneText(result) {
  if (result?.status === "unchanged") return tr("Щиты в игре уже такие — ставить было нечего");
  const count = result?.boards || 0;
  return count ? `Билборды установлены: щитов — ${count}. Перезапустите игру.` : tr("Билборды установлены. Перезапустите игру.");
}

export default function BillboardsStudio({ onExit, onNotice }) {
  useTr();
  const [savedTool, setTool] = useRememberedState("billboards:tool", "all");
  const [savedBoard, setBoard] = useRememberedState("billboards:board", BILLBOARD_SHIELD_IDS[0] || "");
  /* «Где стоят» прежде был своим инструментом (до 30.10.2026): его строки теперь в «Одном щите». */
  const tool = savedTool === "where" ? "board" : TOOL_IDS.includes(savedTool) ? savedTool : "all";
  /* Только щиты: полотно здания, взятое прежде (память окна), открывается в «Баннерах на зданиях», а тут — первый щит. */
  const boardId = BILLBOARD_SHIELD_IDS.includes(savedBoard) ? savedBoard : BILLBOARD_SHIELD_IDS[0];
  const board = billboard(boardId);

  const editor = useRecolorEditor({
    set: "billboards",
    contract: RECOLOR_PROJECTS.billboards,
    storageKey: "astral.billboards.project.v1",
    title: tr("Билборды"),
    coverSlotId: "billboards",
    onNotice,
    resetNotice: tr("Все щиты как в игре"),
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
    removalTitle: tr("Снять билборды Astral — в игре щиты станут как были"),
    savedText: tr("Ставим билборды в игру"),
    doneText,
    rolledBackText: tr("Билборды сняты из игры — остальные моды на месте"),
    images: billboardsImages,
  });
  const { project, commit, replace } = editor;

  /* Облик всех щитов. */
  const onAll = useCallback((patch, label) => commit((current) => ({ ...current, all: { ...current.all, ...patch } }), label), [commit]);
  /* Свой облик щита — у связанных щитов (один лист) тот же. */
  const onBoard = useCallback(
    (id, patch, label) =>
      commit((current) => {
        const own = { ...billboardLookOf(current, id), ...patch, own: true };
        const boards = { ...current.boards };
        for (const member of linkedBillboards(id)) boards[member] = own;
        return { ...current, boards };
      }, label),
    [commit],
  );
  const onOwn = useCallback(
    (id, on) =>
      commit(
        (current) => {
          const boards = { ...current.boards };
          for (const member of linkedBillboards(id)) {
            if (on) boards[member] = { ...normalizeBillboardLook(billboardLookOf(current, id)), own: true };
            else delete boards[member];
          }
          return { ...current, boards };
        },
        `${billboard(id)?.label || tr("Щит")}: ${on ? tr("свой облик") : tr("как у всех")}`,
      ),
    [commit],
  );
  const onFollow = useCallback((id) => onOwn(id, false), [onOwn]);
  /* «Как в игре» у щита: свой облик — штатный (картинка, цвет и рисунок сняты), остальные щиты не тронуты. */
  const onStock = useCallback((id) => onBoard(id, normalizeBillboardLook({}), `${billboard(id)?.label || tr("Щит")}: ${tr("как в игре")}`), [onBoard]);
  const onClearOwn = useCallback(() => commit((current) => ({ ...current, boards: {} }), tr("Все щиты одинаковые")), [commit]);
  const onPreset = useCallback((preset) => replace((current) => applyBillboardsPreset(current, preset.id), `Готовый набор: ${preset.label}`), [replace]);
  const onStandard = useCallback(() => replace((current) => applyBillboardsStandard(current), "Все щиты как в игре"), [replace]);
  /* Выбранный щит подсвечивается в кадре, пока взят «Один щит»: щёлкнули по лицу (18.10.2026) или выбрали в «Где стоят» — не стрелками и меню. */
  const [chosen, setChosen] = useState(null);
  const onSelect = useCallback(
    (id) => {
      setBoard(id);
      setChosen({ board: id, sheet: null });
      setTool("board");
    },
    [setBoard, setTool],
  );
  /* Лист рекламы игры не прочитан (окно без Astral Desktop) — служебное, по «?» у картинки, а не жёлтой строкой на кадре (п. 14). */
  const [sheetsReal, setSheetsReal] = useState(true);
  /* «Все районы — поиск по карте…» над кадром: «Один щит» и поле поиска «Где стоят» в фокусе. */
  const [searchKey, setSearchKey] = useState(0);
  /* Щелчок по лицу щита в кадре: «Один щит» и сам щит — свой или соседний на том же здании. */
  const onAim = useCallback(
    (aim) => {
      setBoard(aim.board);
      setTool(aim.tool);
      setChosen({ board: aim.board, sheet: aim.sheet });
    },
    [setBoard, setTool],
  );
  const selected = useMemo(() => (chosen && tool === "board" && chosen.board === boardId ? billboardFaceSpec(chosen.board, chosen.sheet) : null), [chosen, tool, boardId]);

  /* «Рисунок»: настройки кисти помнятся окном; штрих — шаг работы на своём облике щита (и связанных). */
  const [savedBrush, setBrush] = useRememberedState("billboards:brush", DEFAULT_BRUSH);
  const brush = useMemo(() => normalizeBrush(savedBrush), [savedBrush]);
  const onStroke = useCallback(
    (op) => {
      const current = billboardLookOf(project, boardId);
      if (!addBillboardDrawingOp(current.drawing, op, drawingSizeOf(billboard(boardId), current))) {
        onNotice?.(tr("Рисунок на этом щите полон — очистите его или отмените часть шагов."), "error");
        return false;
      }
      commit((latest) => {
        const look = billboardLookOf(latest, boardId);
        const drawing = addBillboardDrawingOp(look.drawing, op, drawingSizeOf(billboard(boardId), look));
        if (!drawing) return latest;
        const own = { ...normalizeBillboardLook(look), drawing, own: true };
        const boards = { ...latest.boards };
        for (const member of linkedBillboards(boardId)) boards[member] = own;
        return { ...latest, boards };
      }, `${billboard(boardId)?.label || tr("Щит")}: ${STROKE_LABELS[op.tool]}`);
      return true;
    },
    [boardId, commit, onNotice, project],
  );
  const onClearDrawing = useCallback(
    () => onBoard(boardId, { drawing: emptyBillboardDrawing() }, `${billboard(boardId)?.label || tr("Щит")}: рисунок очищен`),
    [boardId, onBoard],
  );
  /* Клавиши [ и ] — кисть меньше и больше (как в Photoshop), пока взят «Рисунок». */
  useEffect(() => {
    if (tool !== "draw") return undefined;
    const onKey = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || (event.key !== "[" && event.key !== "]")) return;
      if (event.target?.closest?.("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      setBrush((value) => {
        const current = normalizeBrush(value);
        const step = Math.max(1, Math.round(current.size * 0.15));
        const size = Math.min(BILLBOARD_BRUSH.size.max, Math.max(BILLBOARD_BRUSH.size.min, current.size + (event.key === "]" ? step : -step)));
        return { ...current, size };
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setBrush, tool]);

  /* Группа полотен в «Где стоят»: отмеченные — один облик разом, одним шагом «Отменить». */
  const [picked, setPicked] = useState(() => new Set());
  const onGroup = useCallback(
    (ids, action, image = null) => {
      if (!ids.length) return;
      const count = ids.length;
      if (action === "clear") commit((current) => clearBillboardLooks(current, ids), `Группа (${count}): как у всех`);
      else if (action === "copy") commit((current) => applyBillboardLook(current, ids, billboardLookOf(current, boardId)), `Группа (${count}): облик «${billboard(boardId)?.label || ""}»`);
      else if (action === "image")
        commit((current) => applyBillboardLook(current, ids, { ...normalizeBillboardLook({}), mode: "image", fit: "cover", image }), `Группа (${count}): своя картинка`);
    },
    [boardId, commit],
  );

  const options = useMemo(() => boardMenuOptions(project, boardId), [project, boardId]);
  /* Щит над кадром: стрелки и меню района — строкой кнопок мест (`recolor-actions`). */
  const tabs = (
    <div className="recolor-actions" role="group" aria-label={tr("Какой щит в кадре")}>
      <Button size="sm" variant="ghost" icon={<CaretLeft />} aria-label={tr("Предыдущий щит")} title={tr("Предыдущий щит")} onClick={() => setBoard(siblingBoard(boardId, -1))} />
      <MenuButton
        label={board?.label || tr("Щит")}
        ariaLabel={tr("Какой щит в кадре")}
        options={options}
        value={boardId}
        onSelect={(value) => {
          if (value !== "__where") return setBoard(value);
          setTool("board");
          setSearchKey((key) => key + 1);
        }}
      />
      <Button size="sm" variant="ghost" icon={<CaretRight />} aria-label={tr("Следующий щит")} title={tr("Следующий щит")} onClick={() => setBoard(siblingBoard(boardId, 1))} />
    </div>
  );

  /* «Один щит» и «Рисунок» — про взятый щит: подпись под именем панели — сам щит. */
  const tools = useMemo(() => TOOLS.map((item) => ((item.id === "board" || item.id === "draw") && board ? { ...item, note: boardLabelText(board) } : item)), [board]);
  const changed = changedBillboards(project).length;
  const status = `${project.name || tr("Билборды")} · ${changed ? `в игру — ${boardsText(changed)}` : tr("как в игре")}`;
  const deferred = useDeferredValue(project);

  /* Кадр билбордов для «Студии»: тот же щит с работой, где на месте поверхности стоит холст студии. */
  const renderLive = useCallback((live) => <BillboardsStage project={live} boardId={boardId} />, [boardId]);

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor billboards-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская билбордов")}
      status={status}
      tabs={tabs}
      tools={tools}
      tool={tool}
      onTool={setTool}
      guide={tool === "draw" ? drawGuide(brush.tool) : editor.guide(false, { aim: tr("править щит под курсором") })}
      guideKey="billboards"
      guideFlash={editor.cameraMode}
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <StudioLiveProvider project={project} render={renderLive}>
          <BillboardsInspector
            tool={tool}
            project={project}
            boardId={boardId}
            onAll={onAll}
            onClearOwn={onClearOwn}
            onFollow={onFollow}
            onStock={onStock}
            onBoard={onBoard}
            onSelect={onSelect}
            onPreset={onPreset}
            onStandard={onStandard}
            onNotice={onNotice}
            sheetsUnread={!sheetsReal}
            searchKey={searchKey}
            brush={brush}
            onBrush={setBrush}
            onClearDrawing={onClearDrawing}
            picked={picked}
            onPick={setPicked}
            onGroup={onGroup}
          />
        </StudioLiveProvider>
      }
    >
      {tool === "draw" ? (
        <BillboardsCanvas project={project} boardId={boardId} settings={brush} onStroke={onStroke} onSheets={setSheetsReal} />
      ) : (
        <BillboardsStage project={deferred} boardId={boardId} onCamera={editor.onCamera} onAim={onAim} highlight={selected} only={SHIELD} onSheets={setSheetsReal} />
      )}
      {editor.works.dialogs}
    </EditorShell>
  );
}
