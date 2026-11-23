import { useMemo, useState } from "react";
import { projectStats } from "@modovik/gun-studio";
import { weaponByShelf } from "@modovik/rpf-inspector/weapon-identity";
import { workshopWeaponSlots } from "../../../../catalog-taxonomy.js";
import { weaponSkinInstallOf } from "../../../../features/workshop/install-queue/tasks/weapon-skin.js";
import { WeaponChip, WeaponSheet } from "../weapon-picker/WeaponPicker.jsx";
import { listGunDrafts } from "./gun-drafts.js";
import { useGameWeaponIcons } from "./useGameWeaponIcons.js";
import { trKey } from "./gun-copy.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { StageCorner } from "../../../ui/StageOverlay.jsx";

/*
 * Выбор ствола мастерской оружия (ТЗ 06.10.2026, вечер, задача 2): карточка
 * «Ствол» в левом верхнем углу кадра, по щелчку — полка всех стволов с
 * поиском и категориями (общий орган студии звуков, `weapon-picker`).
 * Ствол с покраской — в черновике или уже в игре — помечен точкой «уже
 * раскрашен». Смена ствола открывает его комнату: у каждого свой черновик.
 */

/** Категории полки — по семейству ствола, в порядке оружейного колеса. */
export const WEAPON_GROUPS = Object.freeze([
  ["pistol", trKey("Пистолеты")],
  ["smg", trKey("Пистолеты-пулемёты")],
  ["rifle", trKey("Винтовки")],
  ["shotgun", trKey("Дробовики")],
  ["sniper", trKey("Снайперские")],
  ["machinegun", trKey("Пулемёты")],
  ["launcher", trKey("Тяжёлое")],
  /* Задача 6 ТЗ 17.10.2026: холодное и метательное — модели из игры. */
  ["melee", trKey("Ближний бой")],
  ["thrown", trKey("Метательное")],
]);

/** Картинка ствола: с полки мастерской, иначе — иконка из игры игрока. */
export function weaponSlotImage(slot, icons = null) {
  if (!slot) return "";
  return slot.image || icons?.get(weaponByShelf(slot.id)?.id) || "";
}

/** Стволы полки по категориям — для `WeaponSheet`. */
export function weaponSlotGroups(icons = null, slots = workshopWeaponSlots) {
  return WEAPON_GROUPS.map(([id, title]) => ({
    id,
    title,
    items: slots
      .filter((slot) => slot.family === id)
      .map((slot) => ({
        id: slot.id,
        title: slot.ru,
        /* Английское имя — подсказкой, только своё (у стволов из игры без
           английского имени его нет). */
        hint: slot.fromGame ? "" : slot.labels?.en || "",
        image: weaponSlotImage(slot, icons),
      })),
  })).filter((group) => group.items.length);
}

/** Стволы, у которых уже есть покраска: в черновике или в игре. */
export function paintedWeaponSlots({
  drafts = listGunDrafts(),
  installOf = weaponSkinInstallOf,
  slots = workshopWeaponSlots,
} = {}) {
  const marked = new Set();
  for (const draft of drafts) {
    if (!draft?.project) continue;
    const stats = projectStats(draft.project);
    if (stats.layers || stats.stickers || stats.decorations || stats.wear) marked.add(draft.slot);
  }
  for (const slot of slots) {
    const model = weaponByShelf(slot.id)?.model;
    if (model && installOf(model)) marked.add(slot.id);
  }
  return marked;
}

export default function GunSlotPicker({ slotId, onSwitch }) {
  useTr();
  const [open, setOpen] = useState(false);
  const icons = useGameWeaponIcons();
  const groups = useMemo(() => weaponSlotGroups(icons), [icons]);
  /* Пометки — при каждом открытии полки: покраска меняется на ходу. */
  const marked = useMemo(() => (open ? paintedWeaponSlots() : null), [open]);
  const current = workshopWeaponSlots.find((slot) => slot.id === slotId);
  return (
    <>
      <StageCorner className="gun-stage-picker">
        <WeaponChip
          image={weaponSlotImage(current, icons)}
          title={tr(current?.ru || slotId)}
          open={open}
          onToggle={() => setOpen((value) => !value)}
        />
      </StageCorner>
      {open && (
        <WeaponSheet
          groups={groups}
          selected={slotId}
          marked={marked}
          markLabel={tr("уже раскрашен")}
          onPick={(id) => {
            if (id !== slotId) onSwitch(id);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
