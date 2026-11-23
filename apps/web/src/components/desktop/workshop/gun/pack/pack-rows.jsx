/*
 * Строки стволов ганпака: миниатюра, имя и тихая подпись. Одни и те же — в списке экрана «Ганпак» (`GunPackBoard.jsx`) и в столбике карточки «Ствол» редактора (`GunPackPicker.jsx`):
 * владелец, 03.11.2026, — «чтобы раскрывалось точно так же, как в ганпаке».
 */

import { projectIsEmpty } from "@modovik/gun-studio";
import { weaponByShelf } from "@modovik/rpf-inspector/weapon-identity";
import { workshopWeaponSlots } from "../../../../../catalog-taxonomy.js";
import { weaponSkinInstallOf } from "../../../../../features/workshop/install-queue/tasks/weapon-skin.js";
import { tr } from "../../../../../locales/ui.js";
import { readGunDraft } from "../gun-drafts.js";
import { weaponSlotImage } from "../GunSlotPicker.jsx";

export const slotInfo = (slot) => workshopWeaponSlots.find((item) => item.id === slot) || null;

/** Стволы пака с правками в черновике: покраска, слои, наклейки, потёртость, обвесы, свой размер. */
export function editedPackSlots(slots, read = readGunDraft) {
  return slots.filter((slot) => {
    const draft = read(slot);
    return draft && !projectIsEmpty(draft);
  });
}

/** Подпись под именем: ход загрузки, правки, что скин стоит в игре или что откат снимет его при установке пака. */
export function rowMeta(slot, status, touched, resets = {}) {
  if (status?.state === "loading") return tr("Загружаю модель…");
  if (status?.state === "failed") return tr("Модель не открылась");
  const model = weaponByShelf(slot)?.model;
  const installed = Boolean(model && weaponSkinInstallOf(model));
  if (installed && resets[slot] && !touched.includes(slot)) return tr("снимется при установке");
  if (installed) return tr("в игре");
  return touched.includes(slot) ? tr("есть правки") : "";
}

/** Строки для `LayerList`: `icons` — иконки стволов из игры игрока (`useGameWeaponIcons`). */
export function packRows({ slots, touched = [], resets = {}, statuses = new Map(), icons = null }) {
  return slots.map((slot) => {
    const info = slotInfo(slot);
    const image = weaponSlotImage(info, icons);
    return {
      id: slot,
      title: tr(info?.ru || slot),
      meta: rowMeta(slot, statuses.get(slot), touched, resets),
      tooltip: statuses.get(slot)?.message || "",
      thumb: image ? <img src={image} alt="" /> : null,
    };
  });
}
