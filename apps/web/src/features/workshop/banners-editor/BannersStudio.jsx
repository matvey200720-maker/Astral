/*
 * Редактор «Баннеры на зданиях» (задача 7 ТЗ 18.10.2026): большие рекламные
 * полотна на высотках — Fame or Shame на даунтауне, Flow и герб на банке
 * Pacific Standard, постер ТЦ Бертон, Mile High Club и другие, — видно на
 * целом здании в 3D: облёт, готовые ракурсы и «Тени».
 *
 * Над кадром — какое здание. Одна панель «Полотно» (слово владельца
 * 30.10.2026, `design-qa.md`, п. 10–12): своя картинка взятого полотна первым
 * делом, под ней — полотна здания строками и «Этот вид — на все полотна
 * здания». Щелчок по полотну в кадре берёт только его.
 *
 * Полотна здания — **щиты описи билбордов** (`inventory/billboards.js`), поэтому
 * у «Баннеров» нет своей работы: это второй вид работы «Билборды» (тот же
 * черновик, «Мои работы», код и установка). Правка здесь видна в «Билбордах» и
 * наоборот, а установка одна — один редактор другой не затрёт.
 */

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { CaretLeft, CaretRight, ImageSquare } from "../../../components/ui/icons.jsx";
import { BANNER_PLACES, BANNER_PLACE_IDS, bannerRemovedChanged, bannerSite, bannerSiteGroup } from "@modovik/climb-contract/recolor/banner-sites";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import {
  applyBillboardLook,
  billboard,
  billboardLookOf,
  changedBillboards,
  linkedBillboards,
  normalizeBillboardLook,
} from "@modovik/climb-contract/recolor/billboards";
import Button from "../../../components/ui/Button.jsx";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import MenuButton from "../../../components/ui/MenuButton.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { billboardFaceSpec } from "../billboards-editor/billboards-aim.js";
import { billboardsImages } from "../billboards-editor/billboards-images.js";
import { boardLabelText, boardsText, trFill } from "../billboards-editor/billboards-text.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import BannersInspector, { bannersText } from "./BannersInspector.jsx";
import BannersStage from "./BannersStage.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { tr, useTr } from "../../../locales/ui.js";

/* Одна панель: полотна здания — строками под картинкой взятого (п. 12), отдельного инструмента списка нет (до 30.10.2026 был «Полотна»).
   Подпись под именем панели — само взятое полотно (`tools` ниже). */
const TOOLS = Object.freeze([
  Object.freeze({
    id: "board",
    label: "Полотно",
    icon: <ImageSquare />,
    group: "paint",
    note: "Одно полотно",
    hint: "Щелчок по полотну в кадре или строка списка берёт полотно; положите картинку — и она на нём",
    shortcut: "1",
  }),
]);
const TOOL_IDS = TOOLS.map((tool) => tool.id);

function doneText(result) {
  if (result?.status === "unchanged") return tr("Полотна в игре уже такие — ставить было нечего");
  const count = result?.boards || 0;
  return count ? `Билборды установлены: щитов — ${count}. Перезапустите игру.` : tr("Билборды установлены. Перезапустите игру.");
}

/** Подпись места: здание со сценой (полотен района без здания больше нет — 31.10.2026). */
const siteLabel = (site) => tr(site?.label || "");

/** Соседнее место по порядку описи: `step` — +1 или −1. */
const siblingSite = (siteId, step) => BANNER_PLACE_IDS[(BANNER_PLACE_IDS.indexOf(siteId) + step + BANNER_PLACE_IDS.length) % BANNER_PLACE_IDS.length];

/** Пункты меню мест над кадром — по районам. */
function siteOptions() {
  const options = [];
  let district = null;
  for (const site of BANNER_PLACES) {
    if (site.district !== district) {
      district = site.district;
      options.push({ heading: tr(district) });
    }
    options.push({ value: site.id, label: siteLabel(site), description: bannersText(site.boards.length) });
  }
  return options;
}

export default function BannersStudio({ onExit, onNotice }) {
  useTr();
  const [savedTool, setTool] = useRememberedState("banners:tool", "board");
  const [savedSite, setSite] = useRememberedState("banners:site", BANNER_PLACE_IDS[0]);
  const [savedBoard, setBoard] = useRememberedState("banners:board", "");
  /* Прежние «Полотна» и «Правка» (до 30.10.2026) — одна панель. */
  const tool = TOOL_IDS.includes(savedTool) ? savedTool : "board";
  const siteId = BANNER_PLACE_IDS.includes(savedSite) ? savedSite : BANNER_PLACE_IDS[0];
  const site = bannerSite(siteId);
  const boardId = site.boards.includes(savedBoard) ? savedBoard : site.boards[0];
  /* Вход и выбор полотна — камера на него (владелец 01.11.2026: «камера сразу на элемент, который редактируешь»). Здание целиком — кнопкой «Здание». */
  const [angle, setAngle] = useState("banner");
  /* Полотно, на которое смотрит камера: выбор из списка, вход, смена здания и кнопка «Полотно». Щелчок по полотну в кадре его не меняет — камера стоит. */
  const [focused, setFocused] = useState(boardId);
  const focusId = site.boards.includes(focused) ? focused : boardId;
  /* Что подсвечено в кадре: полотно и лист, по которому щёлкнули (у полотна на двух листах — тот, что под курсором). */
  const [chosen, setChosen] = useState(null);

  /* Работа та же, что у «Билбордов»: черновик, «Мои работы», код и установка общие. */
  const editor = useRecolorEditor({
    set: "billboards",
    contract: RECOLOR_PROJECTS.billboards,
    storageKey: "astral.billboards.project.v1",
    title: tr("Баннеры на зданиях"),
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
  const { project, commit } = editor;

  const labelOf = (id) => boardLabelText(billboard(id)) || tr("Полотно");

  /* Свой облик полотна — у связанных (одно место листа) тот же. Любая правка сама делает облик своим. */
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
  const onBoardStock = useCallback((id) => onBoard(id, normalizeBillboardLook({}), trFill("{0}: как в игре", labelOf(id))), [onBoard]);
  /* Облик взятого полотна — на все полотна здания: один шаг «Отменить». */
  const onApplyAll = useCallback(
    () => commit((current) => applyBillboardLook(current, bannerSiteGroup(siteId), billboardLookOf(current, boardId)), trFill("{0}: облик «{1}» на все полотна", siteLabel(site), labelOf(boardId))),
    [commit, siteId, boardId, site],
  );
  const onSiteStock = useCallback(
    () => commit((current) => applyBillboardLook(current, bannerSiteGroup(siteId), normalizeBillboardLook({})), trFill("{0}: все полотна как в игре", siteLabel(site))),
    [commit, siteId, site],
  );

  /* Выбор из списка: кадр летит к полотну, открывается «Правка». Щелчок по полотну в кадре камеру не трогает. */
  const onSelect = useCallback(
    (id) => {
      setBoard(id);
      setFocused(id);
      setChosen({ board: id, sheet: null });
      setAngle("banner");
      setTool("board");
    },
    [setBoard, setTool],
  );
  /* Кнопка «Полотно» — крупно на взятое полотно (и на то, что взяли щелчком в кадре). */
  const onAngle = useCallback(
    (next) => {
      if (next === "banner") setFocused(boardId);
      setAngle(next);
    },
    [boardId],
  );
  const onAim = useCallback(
    (aim) => {
      setBoard(aim.board);
      setChosen({ board: aim.board, sheet: aim.sheet });
      setTool("board");
    },
    [setBoard, setTool],
  );
  const onSite = useCallback(
    (id) => {
      setSite(id);
      setBoard("");
      setFocused("");
      setChosen(null);
      setAngle("banner");
    },
    [setSite, setBoard],
  );

  const selected = useMemo(() => billboardFaceSpec(boardId, chosen?.board === boardId ? chosen.sheet : null), [boardId, chosen]);
  /* Лист рекламы игры не прочитан — по «?» у картинки, а не жёлтой строкой на кадре (п. 14). */
  const [sheetsReal, setSheetsReal] = useState(true);
  const tools = useMemo(() => TOOLS.map((item) => ({ ...item, note: boardLabelText(billboard(boardId)) || tr("Полотно") })), [boardId]);
  const options = useMemo(siteOptions, []);

  const tabs = (
    <div className="recolor-actions" role="group" aria-label={tr("Какое здание в кадре")}>
      <Button size="sm" variant="ghost" icon={<CaretLeft />} aria-label={tr("Предыдущее здание")} title={tr("Предыдущее здание")} onClick={() => onSite(siblingSite(siteId, -1))} />
      <MenuButton label={siteLabel(site)} ariaLabel={tr("Какое здание в кадре")} options={options} value={siteId} onSelect={onSite} />
      <Button size="sm" variant="ghost" icon={<CaretRight />} aria-label={tr("Следующее здание")} title={tr("Следующее здание")} onClick={() => onSite(siblingSite(siteId, 1))} />
    </div>
  );

  const changed = changedBillboards(project).length;
  const status = `${project.name || tr("Баннеры на зданиях")} · ${changed ? trFill("в игру — {0}", boardsText(changed)) : tr("как в игре")}`;
  const deferred = useDeferredValue(project);

  /* Кадр баннеров для «Студии»: то же место, крупно на взятое полотно, с работой, где на нём стоит холст студии. */
  const renderLive = useCallback((live) => <BannersStage siteId={siteId} project={live} boardId={boardId} angle="banner" />, [siteId, boardId]);

  /* Правки работы на полотнах, которых в меню больше нет: остаются в игре, пока их не снимут (окно говорит об этом на «Полотнах»). */
  const removedChanged = useMemo(() => bannerRemovedChanged(project), [project]);
  const onRemovedStock = useCallback(
    () => commit((current) => applyBillboardLook(current, bannerRemovedChanged(current), normalizeBillboardLook({})), tr("Убранные из меню полотна — как в игре")),
    [commit],
  );

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor billboards-editor banners-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Баннеры на зданиях")}
      status={status}
      tabs={tabs}
      tools={tools}
      tool={tool}
      onTool={setTool}
      guide={editor.guide(false, { aim: tr("править полотно под курсором") })}
      guideKey="banners"
      guideFlash={editor.cameraMode}
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <StudioLiveProvider project={project} render={renderLive}>
          <BannersInspector
            siteId={siteId}
            project={project}
            boardId={boardId}
            onSelect={onSelect}
            onBoard={onBoard}
            onBoardStock={onBoardStock}
            onApplyAll={onApplyAll}
            onSiteStock={onSiteStock}
            removedChanged={removedChanged.length}
            onRemovedStock={onRemovedStock}
            onNotice={onNotice}
            sheetsUnread={!sheetsReal}
          />
        </StudioLiveProvider>
      }
    >
      <BannersStage
        siteId={siteId}
        project={deferred}
        boardId={boardId}
        focusId={focusId}
        angle={angle}
        onAngle={onAngle}
        onCamera={editor.onCamera}
        onAim={onAim}
        highlight={selected}
        onSheets={setSheetsReal}
      />
      {editor.works.dialogs}
    </EditorShell>
  );
}
