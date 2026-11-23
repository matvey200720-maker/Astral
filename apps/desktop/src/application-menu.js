/*
 * Меню приложения Electron.
 *
 * Меню по умолчанию — «Файл, Правка, Вид, Окно» — живёт и в окне без рамки, и без видимой строки: его
 * сочетания работают всегда. Ctrl+W закрывает окно, Ctrl+Q выходит из приложения, Ctrl+R перезагружает.
 * Камера мастерской летает по W A S D и Q E, а «вниз» — Ctrl: человек, летящий вперёд, зажимал Ctrl, и
 * Astral закрывался посреди кадра («зажал Ctrl — и всё упало», 19.10.2026; воспроизведено настоящими
 * клавишами: W, затем Ctrl — процесс завершился; гасить сочетание в самой странице не помогло — меню
 * получает его раньше). Закрытие окна у Astral — свои кнопки и своя защита от выхода посреди операции
 * (app-presence.js), а не меню.
 *
 * Поэтому у установленного Astral меню нет вовсе. У разработки — только то, что нужно разработчику:
 * перезагрузка, инструменты разработчика, масштаб; закрытия и выхода в нём нет. На macOS меню остаётся
 * штатным: без него не работают Cmd+Q, Cmd+C и Cmd+V.
 */

/**
 * Шаблон меню: null — без меню, undefined — оставить штатное.
 *
 * @param {{ packaged: boolean, platform: string }} input
 */
export function applicationMenuTemplate({ packaged, platform }) {
  if (platform === "darwin") return undefined;
  if (packaged) return null;
  return [
    {
      label: "Dev",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
  ];
}

/** Ставит меню приложения: зовётся до первого окна. Возвращает, менялось ли меню. */
export function installApplicationMenu({ Menu, packaged, platform = process.platform }) {
  const template = applicationMenuTemplate({ packaged: Boolean(packaged), platform });
  if (template === undefined) return false;
  Menu.setApplicationMenu(template === null ? null : Menu.buildFromTemplate(template));
  return true;
}
