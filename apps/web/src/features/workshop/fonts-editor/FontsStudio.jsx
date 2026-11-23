/*
 * Шрифты: свой шрифт в текстах самой игры.
 *
 * Своих файлов у шрифтов нет — установщик пересобирает шрифты игры
 * (`$Font2`, `$Font2_cond`, `$gtaCash`, `$Font5`) в библиотеках шрифтов
 * update.rpf игрока из шрифта человека: шаблона из Windows этого
 * компьютера или своего файла. Устройство и пределы —
 * `@modovik/climb-contract/recolor/fonts`; буквы кадра и игры — одна
 * арифметика (`@modovik/gfx/fonts`).
 *
 * Раскладка — мастерская «как в Photoshop»: «Шрифт» и «Текст» —
 * инструменты слева, справа — настройки взятого, в середине — название
 * шрифта его же буквами на матовой плашке (владелец, 04.10.2026: простой
 * экран, без выбора сервера — свой шрифт встаёт во все тексты игры). Общее с остальными наборами
 * (работа, черновик, «Мои работы», «Применить», «Снять из игры») — в
 * `useRecolorEditor`; исходный облик — шрифты игры, и «Применить» его
 * снимает свою установку.
 */

import { useCallback, useState } from "react";
import { PenNib, TextT } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import { DEFAULT_FONT_SETTINGS, applyFontTemplate, fontTemplate } from "@modovik/climb-contract/recolor/fonts";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import useSettledValue from "../../../hooks/useSettledValue.js";
import { useRememberedState } from "../../../section-memory.js";
import { fontFromZip } from "../../../components/desktop/workshop/map-font-source.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import { fontCoverage, fontsImages, saveFontFile } from "./font-file.js";
import { useGameFonts, useSourceFont, useTemplateList } from "./font-sources.js";
import FontsInspector from "./FontsInspector.jsx";
import FontsStage from "./FontsStage.jsx";
import { fontsDoneText, fontsStatusText } from "./fonts-text.js";
import { tr, useTr } from "../../../locales/ui.js";

const FONTS_STORAGE_KEY = "astral.fonts.project.v1";

/* Инструменты шрифтов. Кадр плоский — горячие клавиши буквами. */
const FONTS_TOOLS = Object.freeze([
  {
    id: "font",
    label: "Шрифт",
    icon: <TextT />,
    shortcut: "F",
    group: "font",
    note: "Шаблон или свой файл",
    hint: "Возьмите шаблон или загрузите свой файл шрифта — кадр сразу покажет тексты игры этим шрифтом",
  },
  {
    id: "text",
    label: "Текст",
    icon: <PenNib />,
    shortcut: "T",
    group: "font",
    note: "Размер, ширина, толщина, интервалы, наклон",
    hint: "У каждого ползунка — поле для числа: щёлкните по значению и наберите своё",
  },
]);

export default function FontsStudio({ onExit, onNotice }) {
  useTr();
  const [rememberedTool, setTool] = useRememberedState("fonts:tool", "font");
  /* Прежний инструмент «Где меняется» убран: выбора сервера больше нет. */
  const tool = rememberedTool === "text" ? "text" : "font";
  const [uploading, setUploading] = useState(false);
  const editor = useRecolorEditor({
    set: "fonts",
    contract: RECOLOR_PROJECTS.fonts,
    storageKey: FONTS_STORAGE_KEY,
    title: tr("Шрифты"),
    coverSlotId: "fonts",
    onNotice,
    resetNotice: tr("Шрифты как в игре"),
    savedText: tr("Ставим шрифты в игру"),
    doneText: fontsDoneText,
    rolledBackText: tr("Шрифты сняты из игры — тексты игры снова штатными шрифтами"),
    images: fontsImages,
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
  });
  const { project, commit, replace } = editor;

  const source = useSourceFont(project);
  const game = useGameFonts();
  const templates = useTemplateList();
  const coverage = project.source.kind === "file" && source.font ? fontCoverage(source.font) : null;

  const onEnabled = useCallback(
    (enabled) => commit((current) => ({ ...current, enabled }), enabled ? tr("Свой шрифт в игре") : tr("Шрифты игры")),
    [commit],
  );
  const onTemplate = useCallback(
    (template) => replace((current) => applyFontTemplate(current, template.id), `Шаблон: ${template.label}`),
    [replace],
  );
  const onUpload = useCallback(
    async (picked) => {
      setUploading(true);
      try {
        /* Архив с Google Fonts — достаём из него шрифт, дальше как с файлом. */
        const file = /\.zip$/i.test(picked.name) ? await fontFromZip(picked) : picked;
        const saved = await saveFontFile(file);
        commit(
          (current) => ({
            ...current,
            enabled: true,
            source: { ...current.source, kind: "file", file: { asset: saved.asset, name: saved.name, family: saved.family } },
          }),
          `Свой шрифт: ${saved.family || saved.name}`,
        );
        if (saved.coverage.cyrillic < 0.95)
          onNotice?.(`В «${saved.family || saved.name}» не хватает русских букв — их место займут буквы игры`);
      } catch (error) {
        onNotice?.(error?.message || String(error), "error");
      } finally {
        setUploading(false);
      }
    },
    [commit, onNotice],
  );
  const onSetting = useCallback(
    (id, value) => commit((current) => ({ ...current, settings: { ...current.settings, [id]: value } }), null),
    [commit],
  );
  const onResetSettings = useCallback(
    () =>
      commit(
        (current) => ({
          ...current,
          settings: current.source.kind === "template" ? { ...fontTemplate(current.source.template).settings } : { ...DEFAULT_FONT_SETTINGS },
        }),
        "Настройки шаблона",
      ),
    [commit],
  );

  /* Кадр догоняет ползунок, когда рука остановилась: буквы пересобираются
     тем же разбором, что у установщика, и на каждом шаге ползунка это лишнее. */
  const settled = useSettledValue(project, 120);
  const status = `${editor.status} · ${fontsStatusText(project)}`;

  return (
    <EditorShell
      className="fx-editor recolor-editor fonts-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская шрифтов")}
      status={status}
      tools={FONTS_TOOLS}
      tool={tool}
      onTool={setTool}
      guideKey="fonts"
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <FontsInspector
          tool={tool}
          project={project}
          sourceStatus={source.status}
          templates={templates}
          coverage={coverage}
          uploading={uploading}
          onEnabled={onEnabled}
          onTemplate={onTemplate}
          onUpload={onUpload}
          onSetting={onSetting}
          onResetSettings={onResetSettings}
        />
      }
    >
      <FontsStage project={settled} source={source.font} game={game} />
      {editor.works.dialogs}
    </EditorShell>
  );
}
