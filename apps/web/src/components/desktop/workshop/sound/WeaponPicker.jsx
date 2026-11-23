import { memo, useMemo } from "react";
import { weaponSoundsByGroup } from "@modovik/sound-studio";
import { weaponCatalogSlots } from "../../../../catalog-taxonomy.js";
import {
  WeaponChip as SharedWeaponChip,
  WeaponSheet as SharedWeaponSheet,
} from "../weapon-picker/WeaponPicker.jsx";
import { useGameWeaponIcons } from "../gun/useGameWeaponIcons.js";
import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";

/*
 * Выбор ствола — на самом кадре, а не списком в полосе над ним.
 *
 * Стволы те же, что на полке «Оружие» мастерской, с теми же картинками: звук
 * делают «для вот этого ствола», и узнают его по виду быстрее, чем по
 * названию в выпадающем списке. Карточка в органах кадра (`StageBar`, правый
 * верхний угол) называет ствол; по щелчку поверх кадра раскрывается вся
 * полка по группам. Ствол, у которого уже есть свой звук, помечен точкой —
 * без слов: что именно с ним («ждёт», «в игре»), говорит панель «В игре».
 *
 * Карточка и полка — две части: карточка живёт в полосе органов, а полка
 * меряется от всего кадра, и внутри полосы ей не поместиться. Открыта ли
 * полка, держит студия. Полка — внутри пластины кадра, а не порталом: она
 * часть сцены, закрывает её целиком и уходит по выбору, щелчку мимо и Escape.
 */

const SLOT_IMAGES = new Map(
  weaponCatalogSlots.map((slot) => [slot.id, slot.image]),
);

/**
 * Картинка ствола: иконка из игры игрока (`fromGame`, W3) — так ствол рисует
 * меню паузы, — иначе картинка с полки мастерской, если она есть в поставке.
 */
export const weaponImage = (weapon, fromGame = null) =>
  fromGame?.get(weapon?.id) || SLOT_IMAGES.get(weapon?.model) || "";

/** Карточка ствола в органах кадра — общий орган (`weapon-picker`). */
export function WeaponChip({ weapon, open = false, onToggle }) {
  return (
    <SharedWeaponChip
      className="snd-weapon-chip"
      image={weaponImage(weapon, useGameWeaponIcons())}
      title={weapon.title}
      open={open}
      onToggle={onToggle}
    />
  );
}

/** Вся полка стволов поверх кадра — с поиском и категориями (общий орган). */
function WeaponSheetView({ weapon, marked, onChange, onClose }) {
  useTr();
  const language = useUiLanguage();
  const fromGame = useGameWeaponIcons();
  const groups = useMemo(
    () =>
      weaponSoundsByGroup().map((group) => ({
        id: group.id,
        title: tr(group.title),
        items: group.weapons.map((item) => ({
          id: item.id,
          title: item.title,
          image: weaponImage(item, fromGame),
        })),
      })),
    // Язык — в зависимостях: названия групп приходят на русском.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromGame, language],
  );
  return (
    <SharedWeaponSheet
      className="snd-weapon-sheet"
      tileClassName="snd-weapon-tile"
      markedClassName="has-sound"
      groups={groups}
      selected={weapon.id}
      marked={marked}
      markLabel={tr("Есть свой звук")}
      onPick={onChange}
      onClose={onClose}
    />
  );
}

export const WeaponSheet = memo(WeaponSheetView);
