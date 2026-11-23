import { Waveform } from "../../../components/ui/icons.jsx";
import { weaponCatalogSlots } from "../../../catalog-taxonomy.js";

/*
 * Обложка работы со звуками стволов в «Моих работах» — её первый ствол.
 *
 * Работы звуков в списке различаются тем, что в них звучит: карточка
 * показывает рендер первого ствола работы из каталога (тот же, что на полке
 * оружия) со знаком звука в углу и числом стволов, если их несколько.
 * Модели ствола в Astral нет (РПГ, миниган) — остаётся знак звука.
 *
 * В библиотеке у звуков ствола нет: там карточка отвечает, что стоит в игре,
 * и у неё знак звука (`SoundCover.jsx`).
 */
export default function SoundWeaponsCover({ models = [] }) {
  const image = models
    .map((model) => weaponCatalogSlots.find((slot) => slot.id === model))
    .find(Boolean)?.image;
  if (!image)
    return (
      <span className="workshop-cover-glyph">
        <Waveform weight="fill" />
      </span>
    );
  return (
    <>
      <img
        className="workshop-cover-weapon"
        src={image}
        alt=""
        draggable="false"
      />
      <span className="workshop-cover-sound-badge">
        <Waveform weight="bold" />
        {models.length > 1 && <b>{models.length}</b>}
      </span>
    </>
  );
}
