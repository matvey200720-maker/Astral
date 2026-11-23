import "./library-v2.css";
import { useState } from "react";
import Button from "../../components/ui/Button.jsx";
import { Trash } from "../../components/ui/icons.jsx";
import { tr, useTr } from "../../locales/ui.js";
import TileThumbImg from "../../components/ui/TileThumbImg.jsx";
import { modPicture } from "./mod-picture.js";
import {
  SIZE_MAX,
  SIZE_MIN,
  SIZE_STEPS,
  appliedSize,
  clampSize,
} from "./pack-card-model.js";

/*
 * Карточка установленного ганпака в библиотеке v2 (14.11.2026, концепт A5, кадр `2-ganpak`): слева кадр и «Размер модели в руках» с «Применить», справа название, автор и список
 * стволов — у каждого миниатюра, имя и своя корзина. Внизу «Удалить ганпак…» (вторичная кнопка: красного здесь нет, он живёт в окне подтверждения) и «Открыть в мастерской оружия».
 * Размер ставится пересборкой пака и требует перезапуска игры (подсказка под списком). Сама карточка ничего не пишет в игру: всё — колбэками страницы.
 */

const CUSTOM = "custom";
/* Кадр ствола в списке «Стволы в игре» — 56 × 40 css px (`.lib-gun img`): превью самой малой ширины из ряда вместо оригинала 1200 × 800. */
const GUN_ROW_PX = 56;

function SizePick({ value, onChange }) {
  useTr();
  const [custom, setCustom] = useState(false);
  const choice = custom || !SIZE_STEPS.includes(value) ? CUSTOM : String(value);
  return (
    <div className="lib-size">
      <label className="lib-size-label">
        <span>{tr("Размер модели в руках")}</span>
        <select
          aria-label={tr("Размер модели")}
          value={choice}
          onChange={(event) => {
            if (event.target.value === CUSTOM) {
              setCustom(true);
              return;
            }
            setCustom(false);
            onChange(Number(event.target.value));
          }}
        >
          {SIZE_STEPS.map((step) => (
            <option key={step} value={step}>{`${step}%`}</option>
          ))}
          <option value={CUSTOM}>{tr("Свой размер…")}</option>
        </select>
      </label>
      {choice === CUSTOM && (
        <input
          type="number"
          inputMode="numeric"
          min={SIZE_MIN}
          max={SIZE_MAX}
          step="1"
          value={value}
          aria-label={`${tr("Размер модели")} (${SIZE_MIN}–${SIZE_MAX}%)`}
          onChange={(event) => onChange(Number(event.target.value) || SIZE_MIN)}
          onBlur={() => onChange(clampSize(value))}
        />
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.pack мод пака из каталога
 * @param {object[]} props.guns моды-стволы пака (`packGuns`)
 * @param {string} props.author подпись автора или пусто
 * @param {() => void} props.onBack «← Библиотека»
 * @param {(percent: number) => void} props.onApplySize «Применить»: пересборка пака с размером
 * @param {(gun: object) => void} props.onRemoveGun корзина ствола
 * @param {() => void} props.onRemovePack «Удалить ганпак…»
 * @param {() => void} props.onOpenStudio «Открыть в мастерской оружия»
 * @param {boolean=} props.busy пока идёт пересборка
 * @param {Storage=} props.storage
 */
export default function LibraryPackCard({
  pack,
  guns,
  author = "",
  onBack,
  onApplySize,
  onRemoveGun,
  onRemovePack,
  onOpenStudio,
  busy = false,
  storage,
}) {
  useTr();
  const applied = appliedSize(pack.id, storage);
  const [size, setSize] = useState(applied);
  const dirty = clampSize(size) !== applied;
  return (
    <div className="lib-pack" data-library-pack="">
      <div className="lib-pack-top">
        <Button variant="ghost" size="sm" onClick={onBack}>
          {`← ${tr("Библиотека")}`}
        </Button>
      </div>
      <div className="lib-pack-body">
        <div className="lib-pack-left">
          <figure className="lib-pack-frame">
            {modPicture(pack) ? <img src={modPicture(pack)} alt="" /> : null}
          </figure>
          <SizePick value={size} onChange={setSize} />
          <div className="lib-size-actions">
            <Button
              variant="primary"
              size="md"
              disabled={!dirty || busy}
              onClick={() => onApplySize(clampSize(size))}
            >
              {tr("Применить")}
            </Button>
            <Button variant="secondary" size="md" onClick={onOpenStudio}>
              {tr("Открыть в мастерской оружия")}
            </Button>
          </div>
          <p className="lib-size-hint">
            {tr(
              "100% — как в игре. Размер встанет после пересборки пака и перезапуска игры.",
            )}
          </p>
        </div>
        <div className="lib-pack-right">
          <h1>{pack.name}</h1>
          {author ? <p className="lib-pack-author">{author}</p> : null}
          <h2>{tr("Стволы в игре")}</h2>
          <ul className="lib-guns" aria-label={tr("Стволы в игре")}>
            {guns.map((gun) => (
              <li key={gun.id} className="lib-gun">
                {modPicture(gun) ? (
                  <TileThumbImg src={modPicture(gun)} tile={GUN_ROW_PX} alt="" />
                ) : (
                  <span className="lib-gun-blank" />
                )}
                <span className="lib-gun-name">{gun.name}</span>
                <button
                  type="button"
                  className="lib-trash is-gun"
                  aria-label={`${tr("Удалить из игры")}: ${gun.name}`}
                  title={tr("Удалить из игры")}
                  disabled={busy}
                  onClick={() => onRemoveGun(gun)}
                >
                  <Trash weight="regular" />
                </button>
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            size="md"
            disabled={busy}
            onClick={onRemovePack}
          >
            {`${tr("Удалить ганпак")}…`}
          </Button>
        </div>
      </div>
    </div>
  );
}
