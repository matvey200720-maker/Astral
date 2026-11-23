import Dialog from "../../ui/Dialog.jsx";
import Button from "../../ui/Button.jsx";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Какую расцветку вещи править (владелец, 29.10.2026): у вещи каталога несколько расцветок, а карандаш в мастерскую брал первую. Теперь у вещи с несколькими — список
 * её расцветок картинками, как полоса карточки; в мастерскую уходит выбранная. У вещи с одной расцветкой список не нужен — карандаш ведёт сразу.
 */
export default function ClothingColourPick({ mod, colours, onPick, onClose }) {
  useTr();
  return (
    <Dialog
      open
      onClose={onClose}
      title={tr("Какую расцветку править?")}
      kicker={mod.name}
      className="clothing-colour-pick-dialog"
      actions={
        <Button variant="ghost" onClick={onClose}>
          {tr("Отмена")}
        </Button>
      }
    >
      <ul className="clothing-colour-pick" aria-label={tr("Расцветки вещи")}>
        {colours.map((colour) => (
          <li key={colour.letter}>
            <button type="button" aria-label={colour.name} onClick={() => onPick(colour.letter)}>
              {colour.image ? (
                <img src={colour.image} alt="" loading="lazy" decoding="async" />
              ) : (
                <i style={colour.swatch ? { background: colour.swatch } : undefined} />
              )}
              <span>{colour.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
