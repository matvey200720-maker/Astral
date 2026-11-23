/*
 * Карточка «Ствол» редактора в составе ганпака (владелец, 03.11.2026): раскрывается столбиком, как список стволов на экране «Ганпак», и показывает только стволы пака. Щелчок по строке сразу открывает этот ствол на правку.
 * Вне ганпака у студии прежняя карточка со всей полкой игры (`GunSlotPicker.jsx`).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { workshopWeaponSlots } from "../../../../../catalog-taxonomy.js";
import LayerList from "../../../../ui/LayerList.jsx";
import { StageCorner } from "../../../../ui/StageOverlay.jsx";
import { WeaponChip } from "../../weapon-picker/WeaponPicker.jsx";
import { weaponSlotImage } from "../GunSlotPicker.jsx";
import { useGameWeaponIcons } from "../useGameWeaponIcons.js";
import { uiLanguage } from "../gun-copy.js";
import { editedPackSlots, packRows } from "./pack-rows.jsx";
import { readPackResets } from "./pack-store.js";
import { tr, useTr } from "../../../../../locales/ui.js";
import "./gun-pack.css";

/**
 * @param {object} props
 * @param {string} props.slotId — ствол, что правят сейчас.
 * @param {string[]} props.slots — стволы пака.
 * @param {boolean} [props.edited] — у открытого ствола есть правки: они новее записанного черновика.
 * @param {(slot: string) => void} props.onSwitch
 */
export default function GunPackPicker({ slotId, slots, edited = false, onSwitch }) {
  useTr();
  const language = uiLanguage();
  const [open, setOpen] = useState(false);
  const icons = useGameWeaponIcons();
  const menuRef = useRef(null);
  const current = workshopWeaponSlots.find((slot) => slot.id === slotId);
  /* Подписи — при каждом открытии столбика: правки идут на ходу. */
  const rows = useMemo(() => {
    if (!open) return [];
    const touched = editedPackSlots(slots.filter((slot) => slot !== slotId));
    if (edited) touched.push(slotId);
    return packRows({ slots, touched, resets: readPackResets(), icons });
    // Язык читает `tr` из модуля: смена языка пересобирает подписи.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slots, slotId, edited, icons, language]);

  /* Щелчок мимо и Escape закрывают столбик; Escape — только его: у страницы на ту же клавишу свой «назад». */
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => {
      if (!event.target?.closest?.(".gun-pack-picker")) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", onKeyDown, true);
    menuRef.current?.querySelector(".ui-layer-row.is-active .ui-layer-pick")?.focus({ preventScroll: false });
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const pick = (slot) => {
    setOpen(false);
    if (slot !== slotId) onSwitch(slot);
  };

  return (
    <StageCorner className="gun-stage-picker gun-pack-picker">
      <WeaponChip
        image={weaponSlotImage(current, icons)}
        title={tr(current?.ru || slotId)}
        open={open}
        onToggle={() => setOpen((value) => !value)}
      />
      {open && (
        <div ref={menuRef} className="gun-pack-menu" role="dialog" aria-label={tr("Стволы ганпака")}>
          <LayerList label={tr("Стволы ганпака")} items={rows} value={slotId} onSelect={pick} />
        </div>
      )}
    </StageCorner>
  );
}
