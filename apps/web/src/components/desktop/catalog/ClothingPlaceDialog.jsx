import { COMPONENTS } from "@modovik/clothing/taxonomy";
import { clothingInstallKind } from "@modovik/clothing/install-kind";
import Dialog from "../../ui/Dialog.jsx";
import Button from "../../ui/Button.jsx";
import { clothingOf } from "../../../features/clothing/clothing-catalog.js";
import { packContents } from "../../../features/catalog/pack-contents.js";
import { clothingChangeSummary } from "../../../features/clothing/change-summary.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";

/*
 * «На что ставится» у вещи одежды со своим местом в игре (круг 4, 28.10.2026; владелец: «у ВСЕХ вещей одежды «Установить» сначала открывает выбор
 * «на что поставить», а не ставит сразу»). Новая вещь своего DLC ставится вместо вещи, которую выбирает человек (`ClothingInstallDialog`). У
 * перекраски штатной вещи, набора перчаток, комплекта и тату место одно и определено самим модом — выбирать нечего, но и ставить молча нельзя:
 * окно говорит, что именно в игре изменится, и ставит по «Установить». Отказаться можно, ничего не записано.
 */
const REPLACED_LIMIT = 8;

/** Вещь, которую заменяет мод: имя, если оно известно, иначе вид и номер («Сумка или рюкзак №2»); вид — у записи или у самой вещи мода. */
const replacedLabel = (component) => (item) => {
  const place = `${tr(COMPONENTS[item?.component || component]?.label || "Вещь")} №${item?.drawable ?? "?"}`;
  return item?.name ? `${item.name} · ${place}` : place;
};

/** Что изменится у карточки: заголовок строки и список того, что затрагивается. */
export function clothingPlaceFacts(mod, mods = [], language = "ru") {
  const block = clothingOf(mod);
  const label = replacedLabel(block?.component || mod?.domain?.clothing?.component);
  const kind = clothingInstallKind(mod);
  if (kind === "tattoo") return { lead: tr("Рисунок ляжет на кожу персонажа"), items: [] };
  if (kind === "retexture") return { lead: tr("Перекраска штатной вещи игры: заменятся её текстуры"), items: (block?.replaces || []).map(label) };
  if (kind === "ownPlaces") return { lead: tr("Набор встанет на свои места в игре"), items: (block?.replaces || []).map(label) };
  if (kind === "pack") {
    const rows = packContents(mod, mods, language).map((row) => row.mod?.name).filter(Boolean);
    return { lead: tr("Комплект встанет на свои места в игре"), items: rows };
  }
  return { lead: clothingChangeSummary(mod), items: (block?.replaces || []).map(label) };
}

export default function ClothingPlaceDialog({ mod, mods = [], onClose, onConfirm }) {
  useTr();
  const language = useUiLanguage();
  const { lead, items } = clothingPlaceFacts(mod, mods, language);
  const shown = [...new Set(items)].slice(0, REPLACED_LIMIT);
  const more = new Set(items).size - shown.length;
  return (
    <Dialog
      open
      onClose={onClose}
      title={tr("На что ставится")}
      kicker={mod?.name}
      className="clothing-place-dialog"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tr("Отмена")}
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {tr("Установить")}
          </Button>
        </>
      }
    >
      <p className="clothing-place-lead">{lead}</p>
      {shown.length > 0 && (
        <ul className="clothing-place-list">
          {shown.map((label) => (
            <li key={label}>{label}</li>
          ))}
          {more > 0 && <li className="is-more">{tr("и ещё {n}").replace("{n}", more)}</li>}
        </ul>
      )}
    </Dialog>
  );
}
