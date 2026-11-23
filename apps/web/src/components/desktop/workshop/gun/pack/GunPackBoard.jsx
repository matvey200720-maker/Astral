/*
 * Экран «Ганпак» — первый инструмент мастерской оружия (владелец, 02.11.2026). Слева колонка та же, что у редактора ствола; в кадре — все стволы пака; справа — их список, как слои.
 * Сцена живёт у `WeaponWorkshop`: здесь холст только вешается на страницу.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { PencilSimple, Plus, Trash } from "../../../../ui/icons.jsx";
import Button from "../../../../ui/Button.jsx";
import EditorActions from "../../../../ui/EditorActions.jsx";
import EditorShell from "../../../../ui/EditorShell.jsx";
import LayerList from "../../../../ui/LayerList.jsx";
import { StageBusy } from "../../../../ui/StageOverlay.jsx";
import { WeaponSheet } from "../../weapon-picker/WeaponPicker.jsx";
import { weaponSlotGroups } from "../GunSlotPicker.jsx";
import { useGameWeaponIcons } from "../useGameWeaponIcons.js";
import { count, fill, trKey, uiLanguage } from "../gun-copy.js";
import { packRows, slotInfo } from "./pack-rows.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import "./gun-pack.css";

export { slotInfo };

export default function GunPackBoard({
  scene,
  sceneFailed = false,
  rail,
  title,
  slots,
  touched,
  resets = {},
  statuses,
  hovered,
  install,
  onAdd,
  onEdit,
  onRemove,
  onExit,
}) {
  useTr();
  const language = uiLanguage();
  const hostRef = useRef(null);
  const labelRef = useRef(null);
  const [adding, setAdding] = useState(false);
  const icons = useGameWeaponIcons();
  const groups = useMemo(() => weaponSlotGroups(icons), [icons]);

  useLayoutEffect(() => {
    if (!scene || !hostRef.current) return undefined;
    scene.attach(hostRef.current);
    scene.home();
    return () => scene.detach();
  }, [scene]);

  /* Подсветка строки при наведении на ствол не пересобирает список. */
  const items = useMemo(
    () => packRows({ slots, touched, resets, statuses, icons }),
    // Язык читает `tr` из модуля: смена языка пересобирает подписи.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slots, statuses, touched, resets, icons, language],
  );
  const loading = slots.some((slot) => statuses.get(slot)?.state === "loading");
  const shown = slotInfo(hovered);

  /* Подпись ствола — у курсора: положение пишется прямо в стиль, перерисовывать страницу на каждое движение мыши незачем. */
  const moveLabel = (event) => {
    const label = labelRef.current;
    const host = hostRef.current;
    if (!label || !host) return;
    const box = host.getBoundingClientRect();
    label.style.transform = `translate(${Math.round(event.clientX - box.left + 14)}px, ${Math.round(event.clientY - box.top + 16)}px)`;
  };

  return (
    <EditorShell
      className="gun-studio gun-pack-board"
      onBack={onExit}
      title={title}
      status={slots.length ? count(slots.length, trKey("ствол|ствола|стволов")) : tr("стволов пока нет")}
      tools={rail.tools}
      tool={rail.tool}
      onTool={rail.onTool}
      toolShortcuts={false}
      toolCards={false}
      guide={[
        { keys: tr("ЛКМ"), text: tr("вращение") },
        { keys: tr("Щелчок по стволу"), text: tr("открыть редактор") },
        { keys: tr("СКМ"), text: tr("сдвиг") },
        { keys: tr("Колесо"), text: tr("приближение") },
      ]}
      guideKey="gun-pack"
      actions={
        <EditorActions
          apply={{
            label: tr("Поставить ганпак"),
            onClick: install.start,
            disabled: !install.ready,
            busy: install.progress ? fill(tr("Ставлю {done} из {total}…"), install.progress) : "",
            title: !install.ready
              ? tr("Нет стволов с правками: щёлкните ствол и покрасьте его")
              : !install.canRemove
                ? tr("Все стволы с правками встанут в игру")
                : touched.length
                  ? tr("Стволы с правками встанут в игру, у откатанных скин снимется")
                  : tr("У откатанных стволов скин снимется из игры"),
          }}
        />
      }
      inspector={
        <section className="ui-panel gun-panel gun-pack-panel" aria-label={tr("Стволы ганпака")}>
          <LayerList
            label={tr("Стволы ганпака")}
            items={items}
            value={hovered}
            onSelect={onEdit}
            tools={(item) => [
              { id: "edit", label: tr("Редактировать"), icon: <PencilSimple />, onClick: () => onEdit(item.id) },
              { id: "remove", label: tr("Убрать из ганпака"), icon: <Trash />, danger: true, onClick: () => onRemove(item.id) },
            ]}
            footer={
              <Button variant="secondary" size="sm" icon={<Plus />} aria-expanded={adding} onClick={() => setAdding((open) => !open)}>
                {tr("Добавить оружие")}
              </Button>
            }
          />
        </section>
      }
    >
      <div className="gun-stage">
        <div className="gun-viewport gun-pack-viewport" ref={hostRef} onPointerMove={moveLabel}>
          <span ref={labelRef} className="gun-pack-label" hidden={!shown}>
            {shown ? tr(shown.ru) : ""}
          </span>
          {!slots.length && !adding && (
            <div className="gun-empty-stage gun-pack-empty" role="note">
              <b>{tr("В ганпаке пока нет стволов")}</b>
              <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setAdding(true)}>
                {tr("Добавить оружие")}
              </Button>
            </div>
          )}
          {sceneFailed && slots.length > 0 && (
            <p className="gun-failure" role="alert">
              <b>{tr("Кадр не открылся")}</b>
              <span>{tr("Стволы можно открывать из списка справа.")}</span>
            </p>
          )}
          <StageBusy busy={loading} label={tr("Загружаю модели…")} />
        </div>
        {adding && (
          <WeaponSheet
            groups={groups}
            selected=""
            marked={new Set(slots)}
            markLabel={tr("уже в ганпаке")}
            closable
            onPick={onAdd}
            onClose={() => setAdding(false)}
          />
        )}
      </div>
    </EditorShell>
  );
}
