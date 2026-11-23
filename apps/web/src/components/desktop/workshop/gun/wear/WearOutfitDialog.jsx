import { useEffect, useMemo, useState } from "react";
import { TShirt } from "../../../../ui/icons.jsx";
import Button from "../../../../ui/Button.jsx";
import Dialog from "../../../../ui/Dialog.jsx";
import ClothingInstallDialog from "../../../catalog/ClothingInstallDialog.jsx";
import ReplacePairRow from "../../../clothing/ReplacePairRow.jsx";
import TattooPaintParts from "../../../catalog/TattooPaintParts.jsx";
import { TattooRetiredNote } from "../../../catalog/TattooPaintDialog.jsx";
import GameItemPicture from "../../../clothing/GameItemPicture.jsx";
import { useTattooPartChoices } from "../../../../../features/clothing/tattoo-parts.js";
import { shownTargetName } from "../../../../../features/clothing/item-title.js";
import { currentUiLanguage, tr, useTr } from "../../../../../locales/ui.js";
import { pluralWord } from "../../../../../plural.js";
import { count, fill, trKey } from "../gun-copy.js";
import { outfitInstalls, outfitPending } from "./wear-outfit.js";
import "./wear-studio.css";

/*
 * «3 вещи» комплекта: слово — своё, как в заголовке списка («Вещи комплекта» — «Outfit items», «Teile des Outfits», «Articles de la tenue»).
 * Ключ «вещь|вещи|вещей» для него не годится: он общий с «{items} сервера» в названии работы (`useSkinInstall.js`), и у en и de там «server item»
 * и «Serverstück». Формы — [одна, несколько, много]; у языков с двумя формами вторая и третья совпадают.
 */
const OUTFIT_ITEM_WORDS = Object.freeze({
  ru: ["вещь", "вещи", "вещей"],
  uk: ["річ", "речі", "речей"],
  en: ["item", "items", "items"],
  de: ["Teil", "Teile", "Teile"],
  pl: ["przedmiot", "przedmioty", "przedmiotów"],
  fr: ["article", "articles", "articles"],
});
const itemsText = (amount) => `${amount} ${pluralWord(amount, OUTFIT_ITEM_WORDS[currentUiLanguage()] ?? OUTFIT_ITEM_WORDS.ru)}`;

/*
 * «Установить комплект» (ТЗ 29.10.2026-d, голос владельца): окно «Применить» на комплекте, собранном в мастерской. По строке на каждую
 * изменённую вещь: справа — наша заменёнка (кадр покрашенной вещи), слева — «?», пока не выбрано, какую вещь GTA она заменит. Щелчок
 * по «?» открывает то же окно «Сделать заменёнку» с сеткой вещей GTA этого вида и пола (`ClothingInstallDialog`, а не его копию);
 * выбранная вещь встаёт на место «?», между ними — стрелка, как в «Библиотеке → Одежда». «Установить» гаснет и пишет, сколько
 * вещей осталось выбрать; у каждой строки стоит отметка «ставить» (включена по умолчанию, ТЗ 30.10.2026): снял отметку — строка в установку не идёт.
 *
 * Ставит вещи не это окно, а студия (`onInstall`): тем же путём заменёнок одежды, что одиночное «Применить», по очереди установок.
 */

/* Имя вещи для глаз: название на языке окна (`shown`); `name` у вещи игры — русское имя Desktop (установка, крой), показывать его нельзя (17.11.2026). */
const shownOf = (row) => row.shown || row.name;

/* Части тела в окне комплекта (голос владельца 01.11.2026: «вместе с одеждой каждая татуировка у него бы по отдельности предлагалось поменяться»): те же строки, что в «Куда поставить татуировки». */
function OutfitTattoos({ tattoos, gameRoot, onChoice }) {
  useTr();
  const state = useTattooPartChoices({ parts: tattoos.parts, project: tattoos.project, gender: tattoos.gender, gameRoot, readInks: tattoos.readInks, memo: tattoos.memo || null });
  const { picks, retired, pending, waiting, status, error } = state;
  /* Пока тату читаются, выбора ещё нет: окно это знает и не отдаёт «Установить» (`pending`), иначе комплект ушёл бы без них. «?» на строке тату держит «Установить», как «?» на строке вещи (`waiting`). */
  useEffect(() => onChoice({ picks, retired, pending, waiting }), [picks, retired, pending, waiting, onChoice]);
  return (
    <section className="tattoo-set-dialog wear-outfit-tattoos" aria-label={tr("Куда поставить татуировки")}>
      <h3>{tr("Куда поставить татуировки")}</h3>
      {pending && <p className="tattoo-set-status">{tr("Читаю тату вашей игры…")}</p>}
      {!pending && status === "no-game" && <p className="tattoo-set-status is-problem">{tr("Игра не найдена: татуировки ставятся на тату из вашей GTA V. Укажите папку игры в настройках.")}</p>}
      {status === "error" && <p className="tattoo-set-status is-problem">{error || tr("Тату игры не прочитались.")}</p>}
      {status === "ready" && <TattooPaintParts parts={tattoos.parts} project={tattoos.project} gender={tattoos.gender} state={state} />}
      {!pending && !waiting && <TattooRetiredNote retired={retired} />}
    </section>
  );
}

export default function WearOutfitDialog({ rows, tattoos = null, gameRoot = "", mods, onClose, onInstall }) {
  useTr();
  /* Части тела: пока окно их не прочитало, выбора нет. */
  const [tattooChoice, setTattooChoice] = useState(() => ({ picks: [], retired: [], pending: Boolean(tattoos), waiting: 0 }));
  const { picks: tattooPicks, retired: tattooRetired, pending: tattoosReading, waiting: tattoosWaiting } = tattooChoice;
  const [choices, setChoices] = useState({});
  const [selections, setSelections] = useState({});
  const [skipped, setSkipped] = useState(() => new Set());
  const [picking, setPicking] = useState("");
  const pending = outfitPending(rows, choices, skipped) + tattoosWaiting;
  const installs = useMemo(() => outfitInstalls(rows, choices, skipped), [rows, choices, skipped]);
  const open = rows.find((row) => row.slot === picking) || null;

  const toggleSkip = (slot) =>
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });

  /* Занятые вещи: «Применить» окна выбора отдаёт согласие заменить (`replace`) — оно едет в установку вместе с выбором. */
  const confirmPick = (choice) => {
    setChoices((current) => ({ ...current, [picking]: { targets: choice.targets || [], server: choice.server, replace: choice.replace || [] } }));
    setPicking("");
  };

  const status = pending
    ? fill(tr("Выберите, какую вещь заменит каждая: осталось {n}"), { n: pending })
    : tattoosReading
      ? tr("Читаю тату вашей игры…")
      : installs.length
        ? fill(tr("Всё выбрано — ставим {items}"), { items: itemsText(installs.length) })
        : tattooPicks.length
          ? fill(tr("Всё выбрано — ставим тату: {n}"), { n: tattooPicks.length })
          : tattooRetired.length
            ? fill(tr("Всё выбрано — снимаем тату: {n}"), { n: tattooRetired.length })
            : tr("Нечего ставить: все вещи пропущены");
  const nothing = installs.length === 0 && tattooPicks.length === 0 && tattooRetired.length === 0;

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={tr("Установить комплект")}
        kicker={itemsText(rows.length)}
        className="wear-outfit-dialog"
        size="wide"
        status={
          <span className={`wear-outfit-status${pending ? " is-waiting" : ""}`} role="status">
            {status}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              {tr("Отмена")}
            </Button>
            <Button
              variant="primary"
              disabled={pending > 0 || nothing || tattoosReading}
              title={pending ? fill(tr("Сначала выберите, какую вещь заменит каждая: осталось {n}"), { n: pending }) : tattoosReading ? tr("Читаю тату вашей игры…") : undefined}
              onClick={() => onInstall(installs, tattooPicks, tattooRetired)}
            >
              {pending > 0 ? fill(tr("Установить · осталось {n}"), { n: pending }) : tr("Установить комплект")}
            </Button>
          </>
        }
      >
        <ul className="wear-outfit-rows" aria-label={tr("Вещи комплекта")}>
          {rows.map((row) => {
            const chosen = choices[row.slot]?.targets?.[0] || null;
            const skip = skipped.has(row.slot);
            return (
              <ReplacePairRow
                key={row.slot}
                slot={row.slot}
                on={!skip}
                installable={row.installable}
                checkLabel={fill(tr("Ставить «{name}»"), { name: row.title })}
                onToggle={() => toggleSkip(row.slot)}
                title={row.title}
                note={
                  <>
                    {shownOf(row)}
                    {row.layers ? ` · ${count(row.layers, trKey("слой|слоя|слоёв"))}` : ""}
                  </>
                }
                chosen={Boolean(chosen)}
                from={
                  chosen ? (
                    <GameItemPicture
                      game={{ gender: row.wear?.gender || "male", component: chosen.component, folder: chosen.folder, drawable: chosen.drawable }}
                      fallback={<TShirt aria-hidden="true" />}
                    />
                  ) : null
                }
                fromLabel={
                  chosen
                    ? fill(tr("Заменяет «{name}» — выбрать другую вещь"), { name: shownTargetName(chosen) })
                    : fill(tr("Выбрать, какую вещь GTA заменит «{name}»"), { name: shownOf(row) })
                }
                fromTitle={chosen ? shownTargetName(chosen) : tr("Выбрать вещь GTA, на место которой встанет заменёнка")}
                onPick={() => setPicking(row.slot)}
                to={row.cover ? <img src={row.cover} alt="" loading="lazy" decoding="async" /> : <TShirt aria-hidden="true" />}
                meta={row.reason ? tr(row.reason) : skip ? tr("Не ставим") : chosen ? shownTargetName(chosen) : tr("Заменяемая вещь не выбрана")}
              />
            );
          })}
        </ul>
        {tattoos && <OutfitTattoos tattoos={tattoos} gameRoot={gameRoot} onChoice={setTattooChoice} />}
      </Dialog>
      {open && (
        <ClothingInstallDialog
          mod={{ id: `work:outfit-${open.slot}`, name: shownOf(open), tags: [] }}
          mods={mods}
          work={{
            key: `outfit:${open.slot}`,
            name: shownOf(open),
            cover: open.cover,
            slot: open.slot,
            wear: open.wear,
            base: open.base,
            names: open.names,
            shape: null,
            own: [],
            tattoo: false,
            selection: selections[open.slot] || null,
            onSelection: (next) => setSelections((current) => ({ ...current, [open.slot]: next })),
          }}
          onClose={() => setPicking("")}
          onConfirm={confirmPick}
        />
      )}
    </>
  );
}
