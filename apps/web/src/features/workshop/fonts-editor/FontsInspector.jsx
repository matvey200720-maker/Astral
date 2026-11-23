/*
 * Панель шрифтов — настройки взятого инструмента (мастерская «как в
 * Photoshop»).
 *
 * «Шрифт»: свой шрифт в игре, готовые шаблоны (шрифты Windows этого
 * компьютера) и свой файл. «Текст»: размер, ширина, толщина, интервал,
 * наклон, подъём и межстрочный — у каждого ползунка поле для числа;
 * обводку, тень, цвет и прозрачность рисует игра у каждого текста, в файле
 * шрифта их нет, и панель говорит это прямо. Выбора сервера нет: свой шрифт
 * встаёт во все шрифты игры, файл у всех серверов один.
 *
 * Органы — из словаря (`components/ui`), раздел — `ui-panel fx-section`.
 */

import { useRef, useState } from "react";
import { UploadSimple } from "../../../components/ui/icons.jsx";
import { DEFAULT_FONT_SETTINGS, FONT_LIMITS, FONT_SETTING_IDS, FONT_TEMPLATES, fontsProjectIsVanilla } from "@modovik/climb-contract/recolor/fonts";
import Button from "../../../components/ui/Button.jsx";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import Switch from "../../../components/ui/Switch.jsx";
import { hasDesktopBridge } from "../../../api.js";
import { InstalledFonts, installedFontFile } from "../emblem/FontSources.jsx";
import { FONT_FILE_ACCEPT } from "./font-file.js";
import { GAME_FONTS_TEXT, percent, sourceStatusText } from "./fonts-text.js";
import GoogleFontSource from "./GoogleFontSource.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

function Section({ title, label, children }) {
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={label || title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/* Строка «да / нет»: подпись с пояснением и переключатель. */
function SwitchRow({ title, hint, checked, onChange, disabled = false }) {
  return (
    <label className="fx-switch">
      <span>
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </span>
      <Switch checked={checked} label={title} disabled={disabled} onChange={onChange} />
    </label>
  );
}

const SETTING_HINTS = Object.freeze({
  size: "100 % — как в игре.",
  width: "Буквы шире или уже при той же высоте: 100 % — как в самом шрифте.",
  weight: "Плюс — жирнее, минус — тоньше",
  spacing: "Расстояние между буквами",
  slant: "Плюс — вправо, минус — влево",
  baseline: "Подъём над линией строки",
  leading: "Расстояние между строками",
});

const signed = (value) => (value > 0 ? `+${value}` : String(value));
const SETTING_FORMAT = Object.freeze({
  size: (value) => `${value}`,
  width: (value) => `${value}`,
  weight: signed,
  spacing: signed,
  slant: signed,
  baseline: signed,
  leading: signed,
});

function FontTools({ project, sourceStatus, templates, coverage, uploading, onEnabled, onTemplate, onUpload }) {
  useTr();
  const input = useRef(null);
  /* Шрифт из установленных на компьютере (ТЗ 23.10.2026, п. F): тот же путь, что у файла, — через `onUpload`. */
  const [listing, setListing] = useState(false);
  const status = sourceStatusText(sourceStatus, project);
  const fromFile = project.source.kind === "file";
  return (
    <>
      <Section title={tr("Свой шрифт")} label={tr("Свой шрифт в игре")}>
        <SwitchRow
          title={tr("Свой шрифт в игре")}
          hint={tr(
            "Тексты самой игры — меню, карта, подсказки, уведомления, деньги, титры — встанут своим шрифтом. Ники над головой, HUD, чат и телефон на Majestic и GTA 5 RP рисует сам сервер — их шрифт файлом игры не поменять",
          )}
          checked={project.enabled}
          onChange={onEnabled}
        />
        {status && <p className={`fx-hint${sourceStatus === "loading" ? "" : " is-warning"}`}>{status}</p>}
      </Section>
      <PresetShelf title={tr("Шаблоны")} label={tr("Шаблоны шрифтов")} count={FONT_TEMPLATES.length} className="recolor-presets fonts-templates" collapsible={false}>
        {FONT_TEMPLATES.map((template) => {
          const available = !templates || templates.get(template.id) !== false;
          return (
            <ChoiceTile
              key={template.id}
              className="recolor-preset fonts-template"
              selected={project.enabled && !fromFile && project.source.template === template.id}
              disabled={!available}
              media={
                <span className="fonts-template-sample" style={{ fontFamily: `"${template.family}", sans-serif`, fontWeight: template.weight }} aria-hidden="true">
                  {tr("Аа Bb 12")}
                </span>
              }
              title={template.label}
              description={template.family}
              meta={available ? null : tr("Нет в Windows")}
              onClick={() => onTemplate(template)}
            />
          );
        })}
      </PresetShelf>
      <Section title={tr("Свой файл")} label={tr("Свой файл шрифта")}>
        <p className="fx-hint">
          {tr("Файл TTF, OTF, TTC или WOFF до 16 МБ либо архив, скачанный с Google Fonts кнопкой «Download». Файл остаётся у вас: в игру уезжают только буквы, пересобранные под шрифт игры.")}
        </p>
        <input
          ref={input}
          type="file"
          accept={`${FONT_FILE_ACCEPT},.zip`}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onUpload(file);
          }}
        />
        <Button variant="secondary" size="sm" icon={<UploadSimple />} disabled={uploading} onClick={() => input.current?.click()}>
          {uploading ? tr("Читаем шрифт…") : fromFile ? tr("Заменить файл") : tr("Загрузить шрифт")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={uploading || !hasDesktopBridge()}
          title={hasDesktopBridge() ? undefined : tr("Шрифты компьютера доступны в Astral Desktop")}
          onClick={() => setListing(true)}
        >
          {tr("Из установленных на ПК")}
        </Button>
        {listing && (
          <InstalledFonts
            onClose={() => setListing(false)}
            onPick={(item) => {
              setListing(false);
              void installedFontFile(item).then(onUpload);
            }}
          />
        )}
        <GoogleFontSource busy={uploading} onFile={onUpload} />
        {fromFile && project.source.file.asset && (
          <p className="fx-hint">
            {project.source.file.family || project.source.file.name}
            {project.source.file.name && project.source.file.family ? ` · ${project.source.file.name}` : ""}
          </p>
        )}
        {fromFile && coverage && coverage.cyrillic < 0.95 && (
          <p className="fx-hint is-warning">
            Русских букв в шрифте {percent(coverage.cyrillic)}: остальные останутся буквами игры.
          </p>
        )}
        {/* Куда встанет шрифт и чем это грозит — прежде стояло подписью под кадром (убрана 25.10.2026), предупреждение об античите остаётся. */}
        {!fontsProjectIsVanilla(project) && (
          <p className="fx-hint is-warning">
            {trFill("В игру: все шрифты игры — {0} — в библиотеках шрифтов update.rpf. Файл у всех серверов один: тексты игры меняются и на Majestic (alt:V), и на GTA 5 RP, Radmir (RAGE Multiplayer), и в одиночной игре; окна серверов в браузере остаются со шрифтами сервера. В GTA Online изменённые файлы игры может заметить античит.", GAME_FONTS_TEXT)}
          </p>
        )}
      </Section>
    </>
  );
}

/* На главной — размер и ширина; остальные пять — на странице «Тонкая настройка» (19.10.2026). */
const MAIN_SETTING_IDS = Object.freeze(["size", "width"]);
const FINE_SETTING_IDS = Object.freeze(FONT_SETTING_IDS.filter((id) => !MAIN_SETTING_IDS.includes(id)));

/* Ползунок настройки: подпись и пояснение переводятся здесь, в месте отрисовки. */
function SettingSlider({ id, project, onSetting }) {
  const limit = FONT_LIMITS[id];
  return (
    <Slider
      label={tr(limit.label)}
      hint={tr(SETTING_HINTS[id])}
      value={project.settings[id]}
      min={limit.min}
      max={limit.max}
      step={limit.step}
      unit={limit.unit ? ` ${limit.unit}` : ""}
      format={SETTING_FORMAT[id]}
      onChange={(value) => onSetting(id, value)}
    />
  );
}

function TextTools({ project, onSetting, onResetSettings }) {
  useTr();
  /* Страница «Тонкая настройка» открыта строкой на главной; в строке — сколько из пяти изменено, либо «как в игре». */
  const [page, setPage] = useState("");
  const changed = FINE_SETTING_IDS.filter((id) => project.settings[id] !== DEFAULT_FONT_SETTINGS[id]).length;
  if (page === "fine")
    return (
      <>
        <PanelPage label={tr("Тонкая настройка")} note={tr("Текст")} backLabel={tr("Ко всему тексту")} onBack={() => setPage("")} />
        <Section title={tr("Тонкая настройка")} label={tr("Тонкая настройка")}>
          {FINE_SETTING_IDS.map((id) => (
            <SettingSlider key={id} id={id} project={project} onSetting={onSetting} />
          ))}
        </Section>
      </>
    );
  return (
    <>
      <Section title={tr("Настройки текста")} label={tr("Настройки текста")}>
        {MAIN_SETTING_IDS.map((id) => (
          <SettingSlider key={id} id={id} project={project} onSetting={onSetting} />
        ))}
        <NavRow title={tr("Тонкая настройка")} caption={changed ? trFill("изменено: {0}", changed) : tr("как в игре")} onOpen={() => setPage("fine")} />
        <Button variant="ghost" size="sm" onClick={onResetSettings}>
          {tr("Настройки шаблона")}
        </Button>
      </Section>
      <Section title={tr("Обводка, тень и прозрачность")} label={tr("Обводка, тень и прозрачность")}>
        <p className="fx-hint">
          {tr("Обводку, тень и прозрачность текста задаёт сама игра.")}
        </p>
      </Section>
    </>
  );
}

export default function FontsInspector({ tool, ...props }) {
  if (tool === "text") return <TextTools {...props} />;
  return <FontTools {...props} />;
}
