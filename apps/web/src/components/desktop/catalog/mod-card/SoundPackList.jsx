import { useEffect, useRef, useState } from "react";
import { SpeakerHigh } from "../../../ui/icons.jsx";
import { useSoundPlayer } from "../../../../hooks/useSoundPlayer.js";
import { packBrowseCopy } from "../../../../features/catalog/pack-browse-copy.js";
import { packContentsCopy } from "../../../../features/catalog/pack-contents-copy.js";
import {
  clearPackFocus,
  readPackFocus,
} from "../../../../features/catalog/pack-focus.js";
import { soundWeaponCount, soundWeaponRows } from "../../../../features/catalog/sound-rows.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { soundCopy } from "../ModSounds.jsx";
import ComponentsSplit from "./ComponentsSplit.jsx";
import { soundRowFacts } from "./sound-row-facts.js";
import PartActions from "./PartActions.jsx";

/*
 * Звуки пака в окне «Компоненты» — запись на каждое оружие (владелец, 25.10.2026: «часть на каждое оружие — значок карабина,
 * Carbine Rifle, „Установить“ и карандаш»); с 29.10.2026 окно — «Просмотр» (`ComponentsSplit`): слева список стволов, справа большой кадр выбранного, его
 * звук («послушать» — на кадре, только у звука со своим файлом), слова и действия: «Установить», «Изменить в мастерской» (студия звука на ЭТОМ стволе с выстрелом
 * части, `openSoundInWorkshop`) и «Смотреть в 3D» (если у ствола есть модель в нашем наборе мастерской), «Открыть» — страница части.
 *
 * Оружия, которые делят один банк игры (карабин и карабин MK2), — одна часть и несколько записей с общим «Установить»; под именем сказано, с кем звук общий
 * (`sound-rows.js`). Открыли пак из поиска («калаш») — окно встаёт на найденный звук и подсвечивает его словом над именем.
 */

/** Запись окна по строке пака: кадр ствола из нашего набора мастерской, имя оружия на языке окна, вес и длина выстрела, действия. */
function soundEntry(item, { view, copy, partCopy, trackCopy, playing, found, onToggle, onView3D }) {
  const { part, weapon, first } = item;
  const { name, shared, url, on, picture, model, size, length, takeName, burst } = soundRowFacts(item, view, trackCopy, playing);
  return {
    key: item.key,
    id: first ? part.id : undefined,
    /* Имя оружия уже переведено окном (`tr`); страховка перевода резала бы его шаблонами словаря. */
    title: <span data-no-translate="">{name}</span>,
    sub: [length, size].filter(Boolean).join(" · "),
    ariaLabel: name,
    face: { cover: picture, fit: "contain", media: <SpeakerHigh weight="regular" /> },
    kicker: found ? copy.found : null,
    meta: shared.length ? copy.sharedWith(shared.join(", ")) : url ? null : copy.noSound,
    weight: [size, length].filter(Boolean).join(" · ") || null,
    installed: view.parts.installed.includes(part.id),
    /* У звука без файла «послушать» нет: нечего играть. Есть — очередь выстрелов этого оружия в его темпе (`burst`), у оружия без плана — один выстрел. */
    listen: url ? { on, label: on ? copy.stop(name) : copy.listen(name), length, toggle: () => onToggle(url, burst) } : null,
    actions: (
      <PartActions
        part={part}
        parts={view.parts}
        /* «Взять только этот звук — …»: подпись называет все стволы, которых заденет установка. */
        copy={{ ...partCopy, install: () => copy.takeOne(takeName) }}
        editorCopy={view.cardCopy.editor}
        editOptions={weapon ? { weapon: weapon.id } : null}
        view3D={
          model && onView3D
            ? {
                label: `${tr("Показать модель в 3D")}: ${name}`,
                onOpen: () => onView3D({ model, preview: picture, name, kind: "weapon" }),
              }
            : null
        }
      />
    ),
    onOpen: view.parts.open ? () => view.parts.open(part) : null,
  };
}

export default function SoundPackList({ view, items, onView3D }) {
  useTr();
  const copy = packBrowseCopy(view.language);
  const partCopy = packContentsCopy(view.language);
  const trackCopy = soundCopy(view.language);
  const modId = view.mod.id;
  const [hit] = useState(() => readPackFocus(modId)?.sound || "");
  const listRef = useRef(null);
  const { playing, play } = useSoundPlayer(`pack-sounds:${modId}`);
  const [failed, setFailed] = useState(false);
  const rows = soundWeaponRows(items);
  /* Найденный звук — посередине списка, когда окно открылось. */
  useEffect(() => {
    clearPackFocus(modId);
    if (!hit) return;
    const row = listRef.current?.querySelector(`[data-sound-id="${hit}"]`);
    row?.scrollIntoView?.({ block: "center" });
  }, [hit, modId]);
  const weapons = soundWeaponCount(rows);
  const toggle = (url, burst) => {
    setFailed(false);
    play(url, url, { burst }).catch(() => setFailed(true));
  };
  const entries = rows.map((item) =>
    soundEntry(item, { view, copy, partCopy, trackCopy, playing, found: item.part.id === hit, onToggle: toggle, onView3D }),
  );
  return (
    <section
      className="mod-card-section mod-contents mod-pack-sounds"
      id="mod-pack-sounds"
      aria-label={copy.soundsTitle}
    >
      <p className="mod-components-summary">
        {[copy.sounds(items.length), weapons ? copy.weapons(weapons) : ""]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <ComponentsSplit entries={entries} initial={rows.find((item) => item.part.id === hit)?.key || ""} listRef={listRef} />
      <p className="mod-contents-note">{copy.soundNote}</p>
      {failed && (
        <p className="mod-contents-note" role="alert">
          {copy.soundFailed}
        </p>
      )}
    </section>
  );
}
