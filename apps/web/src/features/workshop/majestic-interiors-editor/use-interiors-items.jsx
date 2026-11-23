/*
 * Инструмент «Предметы» редактора «Интерьеры Majestic RP» (ТЗ владельца 26.10.2026, п. A): всё, что стоит в помещении или зале казино,
 * по одной вещи. Студия берёт отсюда одно: инструмент (`INTERIORS_ITEMS_TOOL`), панель (`panel`), что отдать кадру (`stage`: выбор,
 * наведение, перелёт, снимки плиток) и приём сцены кадра (`onAsset`). Состояние выбора и перелёта живёт здесь, чтобы студия и кадр
 * не разрастались: опись считается по частям сцены (`interiors-items.js`), панель и выбор — общие с остальными редакторами.
 *
 * Правка в этих редакторах ложится на лист и поверхность, а не на вещь, поэтому вещь можно найти, обвести и перелистать, а «Удалить»
 * стоит и говорит, почему не нажимается; кнопки в слоте правки ведут к инструментам, где правится то, что на вещи.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CursorClick, FolderOpen } from "../../../components/ui/icons.jsx";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import { Skeleton } from "../../../components/ui/Skeleton.jsx";
import { tr } from "../../../locales/ui.js";
import { createItemShots } from "../items-panel/item-shots.js";
import { itemFocus } from "../items-panel/items-focus.js";
import { sceneInventory } from "../items-panel/items-inventory.js";
import SceneItemsSection from "../items-panel/SceneItemsSection.jsx";
import { useSceneItems } from "../items-panel/use-scene-items.js";
import { INTERIORS_ITEMS_COPY, interiorsEditorLinks, interiorsItemsAdapter, interiorsObjects, interiorsSelectionKind } from "./interiors-items.js";

/** Описание инструмента для рейки студии: подписи — ключи словаря (студия переводит их в месте отрисовки). */
export const INTERIORS_ITEMS_TOOL = Object.freeze({
  id: "items",
  label: "Предметы",
  icon: <CursorClick />,
  group: "items",
  note: INTERIORS_ITEMS_COPY.note,
  hint: INTERIORS_ITEMS_COPY.hint,
});

/**
 * `active` — взят ли инструмент «Предметы»; `casino` — открыт ли казино (зал, а не помещение); `onTool(id)` — перейти к другому
 * инструменту студии; `onNotice` — сообщение человеку; `absent` — сцены не будет (нет файлов интерьера, нет Astral Desktop, помещение не
 * собралось): вместо вечной плашки загрузки — одна строка, а если человек может это исправить (`fix`: `{ title, caption, onOpen }` —
 * «Выбрать папку» казино, «Паки интерьеров»), — строка с этим действием (п. 14 `design-qa.md`).
 * Ответ: `{ panel, stage, onAsset }` — `stage` отдаётся кадру как `items`, `onAsset(сцена, глаз)` кадр зовёт, когда сцена загружена.
 */
export function useInteriorsItems({ active, casino, onTool, onNotice, absent = false, fix = null }) {
  const [scene, setScene] = useState({ asset: null, home: null });
  const { asset, home } = scene;
  const shots = useMemo(() => createItemShots(), []);
  const objects = useMemo(() => sceneInventory(interiorsObjects(asset), { selectionKindOf: interiorsSelectionKind }), [asset]);
  const adapter = useMemo(() => interiorsItemsAdapter(asset, { casino }), [asset, casino]);
  const links = useMemo(() => interiorsEditorLinks(casino), [casino]);

  /* Перелёт к вещи (или её части): глаз летит изнутри помещения; другая сцена или другой инструмент снимают его, кадр возвращается. Летит сам,
     когда вещь выбрали справа (`useSceneItems`: строка, стрелки, части), и по F и «Показать» на плашке «… за кадром»; щелчок в кадре — нет. */
  const [fly, setFly] = useState(null);
  useEffect(() => {
    setFly(null);
  }, [asset, active]);
  const onAsset = useCallback((loaded, eye = null) => setScene({ asset: loaded, home: eye }), []);
  const find = useCallback(
    (key, box) => {
      const flight = asset ? itemFocus(home, box, { asset, key }) : null;
      if (flight) setFly({ ...flight, at: Date.now() });
      return Boolean(flight);
    },
    [asset, home],
  );
  const sceneItems = useSceneItems({ objects, asset, titleOf: adapter.titleOf, find });
  const { onFind } = sceneItems;

  const panel = objects ? (
    <SceneItemsSection
      adapter={adapter}
      objects={objects}
      asset={asset}
      shots={shots}
      selection={sceneItems.selection}
      onSelect={sceneItems.onSelect}
      onScope={sceneItems.onScope}
      onFind={onFind}
      onHover={sceneItems.onHover}
      onNotice={onNotice}
      onTool={onTool}
      home={home}
      note={casino ? INTERIORS_ITEMS_COPY.casinoEditorNote : INTERIORS_ITEMS_COPY.editorNote}
      links={links}
      removalReason={INTERIORS_ITEMS_COPY.removal}
    />
  ) : asset ? (
    <p className="fx-hint">{tr(INTERIORS_ITEMS_COPY.empty)}</p>
  ) : absent && fix ? (
    <ListGroup label={tr("Предметы")}>
      <NavRow icon={<FolderOpen />} title={fix.title} caption={fix.caption} onOpen={fix.onOpen} />
    </ListGroup>
  ) : absent ? (
    <p className="fx-hint" role="status">
      {tr("Нет интерьера в кадре")}
    </p>
  ) : (
    <Skeleton as="div" style={{ height: 96 }} />
  );

  const { selection, onSelect, onPick, onToggle, onClear, entities, hoverSpec, partsOf, nameOf, onShow } = sceneItems;
  const stage = useMemo(
    () => ({ active: Boolean(active), objects, selection, onSelect, onPick, onToggle, onClear, entities, hoverSpec, shots, fly, partsOf, nameOf, onShow }),
    [active, objects, selection, onSelect, onPick, onToggle, onClear, entities, hoverSpec, shots, fly, partsOf, nameOf, onShow],
  );
  return { panel, stage, onAsset };
}
