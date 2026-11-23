/*
 * Шаблоны арены в панели «Шаблоны» (ТЗ 12.10.2026): Валорант, Майнкрафт,
 * Counter-Strike, Дота, Фортнайт, Новый год, Хэллоуин и шаблоны на каждый
 * день — для выбранного сервера (GTA 5 RP или Majestic).
 *
 * Шаблон кладёт в работу свои PNG-картинки (экраны, баннеры, эмблемы, плитка
 * пола, ящик и фигура), свои слова надписей и цвета — в обычные поля
 * разделов (`arena-templates.js` договора). Дальше всё правится в разделах
 * слева как обычно: заменить картинку, поменять слова, цвет.
 *
 * Плитка — картинка шаблона для экранов (нарисованная, а не кадр из игры —
 * панель так и говорит); отмечен шаблон, с которым работа совпадает.
 */

import { memo } from "react";
import { ARENA_TEMPLATES, ARENA_TEMPLATE_GROUPS, arenaTemplatePicture } from "@modovik/climb-contract/recolor/arena-templates";
import { Check, CircleNotch } from "../../../components/ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { ArenaRow } from "./arena-panel-parts.jsx";

function TemplateArt({ template }) {
  return (
    <span className="arena-template-art">
      <img src={arenaTemplatePicture(template.id, "screen").url} alt="" loading="lazy" decoding="async" />
    </span>
  );
}

/*
 * Строками, как в Настройках (ТЗ 29.10.2026, Модуль Б): слева картинка шаблона, по центру имя и его облик, справа
 * отметка у того, с которым совпадает работа. Что делает шаблон — по «?» карточки сверху, а не абзацем.
 */
function ArenaTemplates({ current = "", busy = "", onApply }) {
  useTr();
  return (
    <div className="arena-templates" data-arena-section="templates">
      {ARENA_TEMPLATE_GROUPS.map((group) => {
        const templates = ARENA_TEMPLATES.filter((template) => template.group === group.id);
        return (
          <div key={group.id} className="arena-template-group" role="group" aria-label={`${tr("Шаблоны арены")}: ${tr(group.label).toLowerCase()}`}>
            {/* Без числа у заголовка: у шаблонов других редакторов его нет (критик 30.10.2026, п. 7). */}
            <h4 className="recolor-subhead">{tr(group.label)}</h4>
            {templates.map((template) => (
              <ArenaRow
                key={template.id}
                className="arena-template"
                media={<TemplateArt template={template} />}
                title={tr(template.label)}
                /* Что в шаблоне — подсказкой строки: под именем не обрезается «…» (критик 30.10.2026). */
                caption={busy === template.id ? tr("Кладём картинки шаблона…") : null}
                tooltip={tr(template.description)}
                selected={template.id === current}
                disabled={Boolean(busy)}
                trailing={busy === template.id ? <CircleNotch aria-hidden="true" /> : template.id === current ? <Check aria-hidden="true" /> : null}
                onOpen={() => onApply(template)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default memo(ArenaTemplates);
