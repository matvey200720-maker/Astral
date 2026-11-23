/*
 * Штатные жилеты GTA Online в «Замене» (ТЗ 04.10.2026, задача 9): ниже
 * бронежилетов самого проекта (задача 2 ТЗ 06.10.2026).
 *
 * Как выбор оружия у трейсеров: группы «Стандартный / Государственные /
 * Фракции», в строке — цвет жилета, чей он на проекте и отметка; выбрать
 * можно сколько угодно, у группы — «Все». Строка — цвет семейства жилетов:
 * покраска ляжет в файл этого цвета у всех его моделей (`@modovik/clothing/
 * armor`). Цвет другого кроя погашен и говорит, что покрасить вместо.
 * У строки — картинка жилета этого цвета (вики GTA5RP), где её нет —
 * образец цвета.
 */

import Button from "../../ui/Button.jsx";
import SelectionMark from "../../ui/SelectionMark.jsx";
import { armorRefusal } from "@modovik/clothing/armor";
import ProjectPicture from "./ProjectPicture.jsx";
import { pluralWord } from "../../../plural.js";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Тексты бронежилетов приходят из пакета по-русски; часть собрана из слов и
 * чисел. Перевод — здесь, при выводе: готовая строка — по словарю, собранная —
 * по шаблону с подстановкой.
 */
const SERVICE_NOTE =
  /^Служебные бронежилеты: (.+)\. Какой жилет у какой структуры, проект не сообщает — выбери по виду в игре\.$/;
const ABOUT = /^(.+) · (\d+) (?:модель|модели|моделей)$/;
const OTHER_CUT = /^Другой крой: чтобы поставить сюда, покрась (.+)\.$/;

function packText(text) {
  const value = String(text || "");
  const service = value.match(SERVICE_NOTE);
  if (service)
    return tr(
      "Служебные бронежилеты: {list}. Какой жилет у какой структуры, проект не сообщает — выбери по виду в игре.",
    ).replace("{list}", service[1]);
  const about = value.match(ABOUT);
  if (about)
    return tr("{noun} · {count} {word}")
      .replace("{noun}", tr(about[1]))
      .replace("{count}", about[2])
      .replace(
        "{word}",
        pluralWord(Number(about[2]), [tr("модель"), tr("модели"), tr("моделей")]),
      );
  const cut = value.match(OTHER_CUT);
  if (cut)
    return tr("Другой крой: чтобы поставить сюда, покрась {cut}.").replace("{cut}", tr(cut[1]));
  return tr(value);
}

export default function ClothingArmorTargets({
  groups,
  note = "",
  chosen,
  source = null,
  attention = false,
  onToggle,
  onGroup,
}) {
  useTr();
  const picked = new Set(chosen);
  return (
    <section
      className={`clothing-target-section clothing-armor${attention ? " is-attention" : ""}`}
      aria-label={tr("Жилеты GTA Online")}
    >
      <h4>{tr("Жилеты GTA Online — по цвету")}</h4>
      {note && <p className="clothing-target-note">{packText(note)}</p>}
      {groups.map((group) => {
        const open = group.items.filter((item) => !armorRefusal(item, source));
        const on = open.filter((item) => picked.has(item.key)).length;
        const all = open.length > 0 && on === open.length;
        return (
          <section
            key={group.id}
            className="clothing-armor-group"
            aria-label={tr(group.title)}
          >
            <header className="clothing-armor-head">
              <h4>
                {tr(group.title)}
                <small>
                  {on
                    ? tr("{on} из {total}").replace("{on}", on).replace("{total}", group.items.length)
                    : group.items.length}
                </small>
              </h4>
              {open.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onGroup(
                      open.map((item) => item.key),
                      !all,
                    )
                  }
                >
                  {all ? tr("Снять все") : tr("Все")}
                </Button>
              )}
            </header>
            <p className="clothing-target-note">{packText(group.note)}</p>
            <div className="clothing-armor-rows">
              {group.items.map((item) => {
                const refusal = armorRefusal(item, source);
                const selected = !refusal && picked.has(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`clothing-target-row clothing-armor-row${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    disabled={Boolean(refusal)}
                    title={refusal ? packText(refusal) : undefined}
                    onClick={() => onToggle(item.key)}
                  >
                    <span className="clothing-target-thumb" aria-hidden="true">
                      <ProjectPicture
                        src={item.picture}
                        fallback={
                          <span
                            className="clothing-armor-swatch"
                            style={{ background: item.swatch }}
                          />
                        }
                      />
                    </span>
                    <span className="clothing-target-copy">
                      <b>
                        {tr(item.title)}
                        {item.hint ? ` — ${tr(item.hint)}` : ""}
                      </b>
                      <small>{refusal ? packText(refusal) : packText(item.about)}</small>
                    </span>
                    <SelectionMark on={selected} />
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </section>
  );
}
