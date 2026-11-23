// Присутствие Astral в системе: автозапуск, закрытие в трей, выбор видеокарты и слова системных окон.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { releaseVersionFor } from "./updates/display-version.js";
import { createRageMpStatus, registerRageMpStatusIpc } from "./rage-mp-status.js";

export const GPU_POWERFUL = "high-performance";
export const GPU_ECONOMY = "economy";

const PREFS_FILE = "app-preferences.json";
const LANGUAGE_KEY = "modovik-language";
const SPARE_OPERATION = "Изменения в игре";
const AUTOSTART_PLATFORMS = new Set(["win32", "darwin"]);
const READ_LANGUAGE_CODE = `try { localStorage.getItem(${JSON.stringify(LANGUAGE_KEY)}) } catch { null }`;
const IPC_FLAGS = ["openAtLogin", "closeToTray", "powerfulGpu", "askBeforeClose"];
// Своё окно с вопросом «Закрыть Astral?» обязано ответить «показал» за это время, иначе встаёт системное окно (макет В1, 16.11.2026).
const ASK_SHOWN_MS = 1800;
const CLOSE_ACTIONS = ["tray", "quit", "cancel"];

// Слова одного языка: общая сборка для одинаковых по устройству полей.
function vocabulary({ title, message, detail, resume, stop, openAround, quit, ask, rebuild }) {
  const [before, after] = openAround;
  return {
    title: typeof title === "function" ? title : () => title,
    message,
    detail,
    buttons: [resume, stop],
    open: (name) => `${before}${name}${after}`,
    quit,
    ask,
    rebuild,
  };
}

// Слова окна закрытия, пока идёт пересборка пакета поверх работы (22.11.2026): растительность над дорогами собирается до 20 минут и больше, и «обычно меньше минуты» было бы неправдой.
// `what` — что пересобирается (винительный падеж, с «поверх чего»): набор → { roads | removal | other }; `unknown` — общая формулировка для неизвестного набора.
function rebuildVocabulary({ message, detail, what }) {
  const phrase = ({ set, base } = {}) => {
    const own = what[set];
    if (!own) return what.unknown;
    return (base === "removal" ? own.removal : base === "roads" ? own.roads : undefined) || own.other || own.removal;
  };
  return { message, detail, phrase };
}

// Запасное системное окно «Закрыть Astral?», когда своё окно с вопросом не ответило (макет В1, 16.11.2026):
// число загрузок скобкой, без склонений. Неразрывный пробел французского — только escape (правило репозитория).
function closeAsk(title, one, detail, buttons) {
  return { title, message: (count) => (count > 1 ? `${one} (${count})` : one), detail, buttons };
}

// Язык ищется обычным обращением к простому объекту, поэтому имена из прототипа тоже «находятся».
const WORDS = {
  ru: vocabulary({
    title: (operation) => `Идёт применение: ${operation}`,
    message: "ASTRAL сейчас переписывает файлы игры.",
    detail:
      "Закрытие прервёт операцию посреди записи в архив GTA V. Astral вернёт файлы из резервной копии " +
      "при следующем запуске, но игру до этого запускать нельзя. Безопаснее дождаться завершения — " +
      "обычно меньше минуты.",
    resume: "Продолжить операцию",
    stop: "Всё равно закрыть",
    openAround: ["Открыть ", ""],
    quit: "Выйти",
    rebuild: rebuildVocabulary({
      message: (what) => `ASTRAL пересобирает ${what} — это может занять 20 минут и больше.`,
      detail:
        "Закрытие прервёт запись в архив GTA V посреди пересборки. Astral вернёт файлы из резервной копии при следующем запуске, но игру до этого запускать нельзя, а пересборку придётся запустить заново. Безопаснее дождаться завершения.",
      what: {
        vegetation: { roads: "растительность поверх дорог", removal: "растительность без снятых работ", other: "растительность поверх новой работы" },
        textures: { removal: "ступень текстур без снятых работ", other: "ступень текстур поверх новой работы" },
        roads: { removal: "дороги без снятых работ", other: "дороги поверх новой работы" },
        arenas: { other: "арену поверх мода" },
        unknown: "пакеты поверх новой работы",
      },
    }),
    ask: closeAsk("Закрыть Astral?", "Ещё идёт скачивание.", "Если закрыть, скачивание продолжится с того же места при следующем запуске.", ["Свернуть в трей", "Закрыть", "Отмена"]),
  }),
  uk: vocabulary({
    title: "Триває застосування змін у грі",
    message: "ASTRAL зараз переписує файли гри.",
    detail:
      "Закриття перерве операцію посеред запису в архів GTA V. Astral поверне файли з резервної копії " +
      "під час наступного запуску, але гру до цього запускати не можна. Безпечніше дочекатися завершення — " +
      "зазвичай менше хвилини.",
    resume: "Продовжити операцію",
    stop: "Все одно закрити",
    openAround: ["Відкрити ", ""],
    quit: "Вийти",
    rebuild: rebuildVocabulary({
      message: (what) => `ASTRAL перезбирає ${what} — це може зайняти 20 хвилин і більше.`,
      detail:
        "Закриття перерве запис в архів GTA V посеред перезбирання. Astral поверне файли з резервної копії під час наступного запуску, але гру до цього запускати не можна, а перезбирання доведеться запустити заново. Безпечніше дочекатися завершення.",
      what: {
        vegetation: { roads: "рослинність поверх доріг", removal: "рослинність без знятих робіт", other: "рослинність поверх нової роботи" },
        textures: { removal: "ступінь текстур без знятих робіт", other: "ступінь текстур поверх нової роботи" },
        roads: { removal: "дороги без знятих робіт", other: "дороги поверх нової роботи" },
        arenas: { other: "арену поверх мода" },
        unknown: "пакети поверх нової роботи",
      },
    }),
    ask: closeAsk("Закрити Astral?", "Ще триває завантаження.", "Якщо закрити, завантаження продовжиться з того самого місця під час наступного запуску.", ["Згорнути в трей", "Закрити", "Скасувати"]),
  }),
  en: vocabulary({
    title: "Applying changes to the game",
    message: "ASTRAL is rewriting game files right now.",
    detail:
      "Closing will interrupt the operation in the middle of writing to the GTA V archive. Astral will " +
      "restore the files from a backup on the next launch, but the game must not be started until then. " +
      "It is safer to wait for it to finish — usually less than a minute.",
    resume: "Continue operation",
    stop: "Close anyway",
    openAround: ["Open ", ""],
    quit: "Quit",
    rebuild: rebuildVocabulary({
      message: (what) => `ASTRAL is rebuilding ${what} — this can take 20 minutes or more.`,
      detail:
        "Closing will interrupt the write to the GTA V archive in the middle of the rebuild. Astral will restore the files from a backup on the next launch, but the game must not be started until then, and the rebuild will have to be started again. It is safer to wait for it to finish.",
      what: {
        vegetation: { roads: "vegetation on top of the roads", removal: "vegetation without the removed works", other: "vegetation on top of the new work" },
        textures: { removal: "the texture level without the removed works", other: "the texture level on top of the new work" },
        roads: { removal: "the roads without the removed works", other: "the roads on top of the new work" },
        arenas: { other: "the arena on top of the mod" },
        unknown: "packages on top of the new work",
      },
    }),
    ask: closeAsk("Close Astral?", "A download is still in progress.", "If you close Astral, the download will resume from where it stopped the next time you start it.", ["Minimize to tray", "Close", "Cancel"]),
  }),
  de: vocabulary({
    title: "Änderungen werden ins Spiel geschrieben",
    message: "ASTRAL schreibt gerade Spieldateien neu.",
    detail:
      "Schließen unterbricht den Vorgang mitten im Schreiben ins GTA-V-Archiv. Astral stellt die Dateien " +
      "beim nächsten Start aus einer Sicherung wieder her, aber bis dahin darf das Spiel nicht gestartet " +
      "werden. Sicherer ist es, das Ende abzuwarten — meist unter einer Minute.",
    resume: "Vorgang fortsetzen",
    stop: "Trotzdem schließen",
    openAround: ["", " öffnen"],
    quit: "Beenden",
    rebuild: rebuildVocabulary({
      message: (what) => `ASTRAL baut ${what} neu auf — das kann 20 Minuten oder länger dauern.`,
      detail:
        "Schließen unterbricht das Schreiben ins GTA-V-Archiv mitten im Neuaufbau. Astral stellt die Dateien beim nächsten Start aus einer Sicherung wieder her, aber bis dahin darf das Spiel nicht gestartet werden, und der Neuaufbau muss erneut gestartet werden. Sicherer ist es, das Ende abzuwarten.",
      what: {
        vegetation: { roads: "die Vegetation über den Straßen", removal: "die Vegetation ohne die entfernten Arbeiten", other: "die Vegetation über der neuen Arbeit" },
        textures: { removal: "die Texturstufe ohne die entfernten Arbeiten", other: "die Texturstufe über der neuen Arbeit" },
        roads: { removal: "die Straßen ohne die entfernten Arbeiten", other: "die Straßen über der neuen Arbeit" },
        arenas: { other: "die Arena über dem Mod" },
        unknown: "die Pakete über der neuen Arbeit",
      },
    }),
    ask: closeAsk("Astral schließen?", "Es läuft noch ein Download.", "Wenn du Astral schließt, wird der Download beim nächsten Start an derselben Stelle fortgesetzt.", ["In den Infobereich", "Schließen", "Abbrechen"]),
  }),
  pl: vocabulary({
    title: "Trwa zapisywanie zmian w grze",
    message: "ASTRAL właśnie zapisuje pliki gry.",
    detail:
      "Zamknięcie przerwie operację w trakcie zapisu do archiwum GTA V. Astral przywróci pliki z kopii " +
      "zapasowej przy następnym uruchomieniu, ale do tego czasu nie wolno uruchamiać gry. Bezpieczniej " +
      "poczekać do końca — zwykle trwa to mniej niż minutę.",
    resume: "Kontynuuj operację",
    stop: "Zamknij mimo to",
    openAround: ["Otwórz ", ""],
    quit: "Zakończ",
    rebuild: rebuildVocabulary({
      message: (what) => `ASTRAL przebudowuje ${what} — to może potrwać 20 minut lub dłużej.`,
      detail:
        "Zamknięcie przerwie zapis do archiwum GTA V w trakcie przebudowy. Astral przywróci pliki z kopii zapasowej przy następnym uruchomieniu, ale do tego czasu nie wolno uruchamiać gry, a przebudowę trzeba będzie uruchomić od nowa. Bezpieczniej poczekać do końca.",
      what: {
        vegetation: { roads: "roślinność na wierzchu dróg", removal: "roślinność bez usuniętych prac", other: "roślinność na wierzchu nowej pracy" },
        textures: { removal: "poziom tekstur bez usuniętych prac", other: "poziom tekstur na wierzchu nowej pracy" },
        roads: { removal: "drogi bez usuniętych prac", other: "drogi na wierzchu nowej pracy" },
        arenas: { other: "arenę na wierzchu moda" },
        unknown: "pakiety na wierzchu nowej pracy",
      },
    }),
    ask: closeAsk("Zamknąć Astral?", "Pobieranie jeszcze trwa.", "Jeśli zamkniesz Astral, pobieranie zostanie wznowione od tego samego miejsca przy następnym uruchomieniu.", ["Do zasobnika", "Zamknij", "Anuluj"]),
  }),
  fr: vocabulary({
    title: "Application des modifications au jeu en cours",
    message: "ASTRAL est en train de réécrire les fichiers du jeu.",
    detail:
      "La fermeture interrompra l’opération au milieu de l’écriture dans l’archive de GTA V. Astral " +
      "restaurera les fichiers depuis une sauvegarde au prochain lancement, mais il ne faut pas lancer " +
      "le jeu d’ici là. Il est plus prudent d’attendre la fin — en général moins d’une minute.",
    resume: "Poursuivre l’opération",
    stop: "Fermer quand même",
    openAround: ["Ouvrir ", ""],
    quit: "Quitter",
    rebuild: rebuildVocabulary({
      message: (what) => `ASTRAL reconstruit ${what} — cela peut prendre 20 minutes ou plus.`,
      detail:
        "La fermeture interrompra l’écriture dans l’archive de GTA V au milieu de la reconstruction. Astral restaurera les fichiers depuis une sauvegarde au prochain lancement, mais il ne faut pas lancer le jeu d’ici là, et la reconstruction devra être relancée. Il est plus prudent d’attendre la fin.",
      what: {
        vegetation: { roads: "la végétation par-dessus les routes", removal: "la végétation sans les travaux retirés", other: "la végétation par-dessus le nouveau travail" },
        textures: { removal: "le niveau de textures sans les travaux retirés", other: "le niveau de textures par-dessus le nouveau travail" },
        roads: { removal: "les routes sans les travaux retirés", other: "les routes par-dessus le nouveau travail" },
        arenas: { other: "l’arène par-dessus le mod" },
        unknown: "les paquets par-dessus le nouveau travail",
      },
    }),
    ask: closeAsk("Fermer Astral" + String.fromCharCode(0xa0) + "?", "Un téléchargement est encore en cours.", "Si vous fermez Astral, le téléchargement reprendra là où il s’est arrêté au prochain lancement.", ["Réduire dans la zone de notification", "Fermer", "Annuler"]),
  }),
};

export function presenceWords(language) {
  return WORDS[language] || WORDS.ru;
}

export function storedGpuPreference(userData, read = readFileSync) {
  try {
    const { gpu } = JSON.parse(read(path.join(userData, PREFS_FILE), "utf8"));
    return gpu === GPU_ECONOMY ? GPU_ECONOMY : GPU_POWERFUL;
  } catch {
    return GPU_POWERFUL;
  }
}

const prettyJson = (value) => JSON.stringify(value, null, 2);

// Файл настроек: читается лениво один раз; запись сначала обновляет память, потом пишет файл.
class PreferencesFile {
  #app;
  #memory;

  constructor(app) {
    this.#app = app;
  }

  #location() {
    return path.join(this.#app.getPath("userData"), PREFS_FILE);
  }

  #fromDisk() {
    try {
      return JSON.parse(readFileSync(this.#location(), "utf8")) || {};
    } catch {
      return {};
    }
  }

  get data() {
    return (this.#memory ??= this.#fromDisk());
  }

  amend(delta) {
    const next = { ...this.data, ...delta };
    this.#memory = next;
    writeFileSync(this.#location(), prettyJson(next));
  }
}

const isKnownLanguage = (value) => typeof value === "string" && Boolean(WORDS[value]);

// Язык окна знает только окно: его спрашивают у страницы, ответ приходит позже.
class WindowLanguage {
  #value = "ru";

  get value() {
    return this.#value;
  }

  refresh(win) {
    if (!win?.webContents || win.isDestroyed?.()) return;
    Promise.resolve(win.webContents.executeJavaScript(READ_LANGUAGE_CODE, true)).then(
      (stored) => {
        if (isKnownLanguage(stored)) this.#value = stored;
      },
      () => {},
    );
  }
}

const trayMenuTemplate = (words, appName, reveal, leave) => [
  { label: words.open(appName), click: reveal },
  { type: "separator" },
  { label: words.quit, click: leave },
];

// Значок один на присутствие; меню собирается на языке момента создания и дальше не меняется.
class TrayBadge {
  #kit;
  #icon = null;

  constructor(kit) {
    this.#kit = kit;
  }

  raise(words, reveal, leave) {
    if (this.#icon) return;
    const { Tray, Menu, nativeImage, iconPath, app } = this.#kit;
    const picture = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
    const tray = new Tray(picture);
    this.#icon = tray;
    tray.setToolTip(app.getName());
    tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(words, app.getName(), reveal, leave)));
    tray.on("click", reveal);
  }

  remove() {
    if (!this.#icon) return;
    this.#icon.destroy();
    this.#icon = null;
  }
}

const restoreIfMinimized = (win) => {
  if (win.isMinimized()) win.restore();
};

class SystemPresence {
  #app;
  #platform;
  #dialog;
  #hooks;
  #prefs;
  #tray;
  #language = new WindowLanguage();
  #leaving = false;
  #consent = false;
  #win = null;
  #ask = null;
  #askSeq = 0;
  #patchSteps = [
    ["openAtLogin", (wanted) => this.#applyAutostart(wanted)],
    ["powerfulGpu", (wanted) => this.#applyGpu(wanted)],
    ["closeToTray", (wanted) => this.#applyTray(wanted)],
    ["askBeforeClose", (wanted) => this.#prefs.amend({ askBeforeClose: Boolean(wanted) })],
  ];

  constructor({ app, platform, dialog, hooks, trayKit }) {
    this.#app = app;
    this.#platform = platform;
    this.#dialog = dialog;
    this.#hooks = hooks;
    this.#prefs = new PreferencesFile(app);
    this.#tray = new TrayBadge(trayKit);
  }

  markLeaving() {
    this.#leaving = true;
  }

  resetConsent() {
    this.#consent = false;
  }

  language() {
    return this.#language.value;
  }

  // Значение gpuAtStart — число/строка либо функция; функция зовётся без привязки к объекту.
  #startedGpu() {
    const { gpuAtStart } = this.#hooks;
    return typeof gpuAtStart === "function" ? gpuAtStart() : gpuAtStart;
  }

  #autostartSupported() {
    return Boolean(this.#app.isPackaged) && AUTOSTART_PLATFORMS.has(this.#platform);
  }

  #traySupported() {
    return this.#platform === "win32";
  }

  info() {
    const app = this.#app;
    const executable = app.getPath?.("exe") || "";
    return {
      version: releaseVersionFor(executable, app.getVersion()),
      packaged: Boolean(app.isPackaged),
      platform: this.#platform,
    };
  }

  preferences() {
    const app = this.#app;
    const autostart = this.#autostartSupported();
    const trayOk = this.#traySupported();
    return {
      openAtLogin: autostart ? Boolean(app.getLoginItemSettings()?.openAtLogin) : false,
      openAtLoginSupported: autostart,
      closeToTray: trayOk && this.#prefs.data.closeToTray === true,
      closeToTraySupported: trayOk,
      askBeforeClose: this.#prefs.data.askBeforeClose !== false,
      powerfulGpu: this.#prefs.data.gpu !== GPU_ECONOMY,
      powerfulGpuActive: this.#startedGpu() === GPU_POWERFUL,
    };
  }

  #applyAutostart(wanted) {
    const app = this.#app;
    if (this.#autostartSupported()) app.setLoginItemSettings({ openAtLogin: Boolean(wanted) });
  }

  #applyGpu(wanted) {
    this.#prefs.amend({ gpu: wanted ? GPU_POWERFUL : GPU_ECONOMY });
  }

  #applyTray(wanted) {
    if (!this.#traySupported()) return;
    this.#prefs.amend({ closeToTray: Boolean(wanted) });
    if (!wanted) this.#tray.remove();
  }

  // Шаг выполняется, если ключ есть в изменении, каким бы ни было значение.
  setPreferences(change) {
    for (const [key, apply] of this.#patchSteps) {
      if (key in change) apply(change[key]);
    }
    return this.preferences();
  }

  showWindow(win) {
    this.#tray.remove();
    if (win.isDestroyed()) return;
    win.show();
    restoreIfMinimized(win);
    win.focus();
  }

  watch(win) {
    this.#win = win;
    this.#language.refresh(win);
    win?.webContents?.on?.("did-finish-load", () => this.#language.refresh(win));
    const subscriptions = [
      ["focus", () => this.#language.refresh(win)],
      ["close", (event) => this.#handleClose(win, event)],
    ];
    for (const [name, handler] of subscriptions) win.on(name, handler);
  }

  #quitFromTray() {
    const app = this.#app;
    this.#leaving = true;
    app.quit();
  }

  /*
   * Сначала значок, потом прятать (05.11.2026): Windows может не дать значок (`new Tray` бросает), и окно, спрятанное
   * раньше, оставалось без значка и без пути назад — Astral висел невидимым. Нет значка — окно закрывается как обычно.
   */
  #tuckAway(win, event) {
    try {
      this.#tray.raise(
        presenceWords(this.#language.value),
        () => this.showWindow(win),
        () => this.#quitFromTray(),
      );
    } catch {
      return false;
    }
    event.preventDefault();
    win.hide();
    return true;
  }

  #interruptQuestion() {
    const { describeBusy, describeRebuild } = this.#hooks;
    const words = presenceWords(this.#language.value);
    let { message, detail } = words;
    const { buttons } = words;
    /* Идёт пересборка пакета поверх работы (ступень `dependent` операции): слова про неё, а не «обычно меньше минуты». Вне ступени — прежний текст. */
    const rebuilding = describeRebuild?.() || null;
    if (rebuilding) {
      message = words.rebuild.message(words.rebuild.phrase(rebuilding));
      detail = words.rebuild.detail;
    }
    return {
      type: "warning",
      title: words.title(describeBusy() || SPARE_OPERATION),
      message,
      detail,
      buttons,
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
  }

  // Скачивания идут и человек не отключил вопрос: тогда закрытие сперва спрашивает, а не закрывает молча (макет В1, 16.11.2026).
  #downloadsCount() {
    const { downloads } = this.#hooks;
    try {
      return Number(downloads?.()) || 0;
    } catch {
      return 0;
    }
  }

  #wantsToAsk() {
    return this.#prefs.data.askBeforeClose !== false && this.#downloadsCount() > 0;
  }

  #bringBack(win) {
    if (win.isDestroyed()) return;
    win.show();
    restoreIfMinimized(win);
    win.focus();
  }

  /*
   * Вопрос задаёт само окно Astral (поверх приложения, на притушенном фоне), а не системное окно Windows. Главный процесс шлёт просьбу и ждёт «показал»
   * (`ASK_SHOWN_MS`): не дождался — окно завис или не успело загрузиться, и вопрос задаёт системное окно, иначе закрыть было бы нельзя.
   */
  #askAboutDownloads(win) {
    if (this.#ask) {
      this.#bringBack(win);
      return;
    }
    const ask = { id: (this.#askSeq += 1), shown: false, timer: null };
    this.#ask = ask;
    ask.timer = setTimeout(() => this.#systemQuestion(ask.id), this.#hooks.askShownMs ?? ASK_SHOWN_MS);
    let sent = false;
    try {
      sent = this.#hooks.sendCloseAsk?.(win, { id: ask.id, count: this.#downloadsCount(), language: this.#language.value }) === true;
    } catch {
      sent = false;
    }
    if (!sent) {
      clearTimeout(ask.timer);
      this.#systemQuestion(ask.id);
    }
  }

  #systemQuestion(id) {
    const ask = this.#ask;
    const win = this.#win;
    if (!ask || ask.id !== id || ask.shown || !win || win.isDestroyed()) return;
    const words = presenceWords(this.#language.value).ask;
    const reply = this.#dialog.showMessageBoxSync(win, {
      type: "question",
      title: words.title,
      message: words.message(this.#downloadsCount() || 1),
      detail: words.detail,
      buttons: words.buttons,
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    // Если свой вопрос всё же успел появиться позже, он закрывается: решение уже принято.
    try {
      this.#hooks.sendCloseAsk?.(win, { id, dismiss: true });
    } catch {
      // окно могло уйти
    }
    this.#finishAsk(CLOSE_ACTIONS[reply] ?? "cancel", false);
  }

  // Окно показало вопрос: системный запасной вариант больше не нужен.
  closeShown(id) {
    const ask = this.#ask;
    if (!ask || ask.id !== id) return { ok: false };
    clearTimeout(ask.timer);
    ask.shown = true;
    return { ok: true };
  }

  // Выбор человека в окне: «tray» — спрятать в трей, «quit» — закрыть, «cancel» — остаться; `dontAsk` запоминает выбор.
  closeAnswer({ id, action, dontAsk }) {
    const ask = this.#ask;
    if (!ask || ask.id !== id) return { ok: false };
    this.#finishAsk(CLOSE_ACTIONS.includes(action) ? action : "cancel", dontAsk === true);
    return { ok: true };
  }

  #finishAsk(action, dontAsk) {
    const win = this.#win;
    clearTimeout(this.#ask?.timer);
    this.#ask = null;
    if (!win || win.isDestroyed()) return;
    if (action === "cancel") {
      this.#leaving = false;
      this.#hooks.onQuitVetoed();
      return;
    }
    // «Больше не спрашивать»: в трей — значит, крестик всегда прячет в трей; закрыть — крестик закрывает сразу.
    if (dontAsk) {
      if (action === "tray") this.#applyTray(true);
      else this.#prefs.amend({ askBeforeClose: false });
    }
    if (action === "tray") {
      // Значка нет (Windows не дала) — прятать некуда: сворачиваем, чтобы человек мог вернуться.
      if (!this.#tuckAway(win, { preventDefault() {} })) win.minimize?.();
      return;
    }
    this.#consent = true;
    win.close();
  }

  #handleClose(win, event) {
    const { isBusy, onQuitVetoed } = this.#hooks;
    const dialog = this.#dialog;
    if (!this.#leaving && this.preferences().closeToTray && this.#tuckAway(win, event)) return;
    if (this.#consent) return;
    if (isBusy()) {
      event.preventDefault();
      if (dialog.showMessageBoxSync(win, this.#interruptQuestion()) === 1) {
        this.#consent = true;
        win.close();
        return;
      }
      this.#leaving = false;
      onQuitVetoed();
      return;
    }
    if (!this.#leaving && this.#wantsToAsk()) {
      event.preventDefault();
      this.#askAboutDownloads(win);
    }
  }
}

export function createAppPresence({
  app,
  platform = process.platform,
  gpuAtStart = GPU_POWERFUL,
  onQuitVetoed = () => {},
  isBusy,
  describeBusy,
  describeRebuild = () => null,
  downloads = () => 0,
  sendCloseAsk = () => false,
  askShownMs = ASK_SHOWN_MS,
  dialog,
  Tray,
  Menu,
  nativeImage,
  iconPath,
}) {
  const core = new SystemPresence({
    app,
    platform,
    dialog,
    hooks: { gpuAtStart, isBusy, describeBusy, describeRebuild, onQuitVetoed, downloads, sendCloseAsk, askShownMs },
    trayKit: { Tray, Menu, nativeImage, iconPath, app },
  });
  app.on("before-quit", () => core.markLeaving());

  return {
    info: () => core.info(),
    preferences: () => core.preferences(),
    setPreferences: (change = {}) => core.setPreferences(change),
    watch: (win) => core.watch(win),
    showWindow: (win) => core.showWindow(win),
    language: () => core.language(),
    resetCloseConsent: () => core.resetConsent(),
    closeShown: (id) => core.closeShown(id),
    closeAnswer: (answer) => core.closeAnswer(answer),
  };
}

// От окна принимаются только настоящие булевы поля, в этом порядке.
const booleanPatch = (input) =>
  Object.fromEntries(
    IPC_FLAGS.map((flag) => [flag, input?.[flag]]).filter(([, value]) => typeof value === "boolean"),
  );

// Ответ окна на вопрос о закрытии: от окна принимаются только номер вопроса, одно из трёх действий и булева галочка.
const closeAnswerOf = (input) => ({
  id: Number.isInteger(input?.id) ? input.id : 0,
  action: CLOSE_ACTIONS.includes(input?.action) ? input.action : "cancel",
  dontAsk: input?.dontAsk === true,
});

export function registerAppPresenceIpc({ IPC, presence, trusted, handleIpc }) {
  const routes = [
    ["APP_INFO", (event) => trusted(event, () => presence.info())],
    ["APP_PREFERENCES", (event) => trusted(event, () => presence.preferences())],
    ["APP_CLOSE_SHOWN", (event, input) => trusted(event, () => presence.closeShown(Number.isInteger(input?.id) ? input.id : 0))],
    ["APP_CLOSE_ANSWER", (event, input) => trusted(event, () => presence.closeAnswer(closeAnswerOf(input)))],
    [
      "APP_PREFERENCES_SET",
      (event, input) => trusted(event, () => presence.setPreferences(booleanPatch(input))),
    ],
  ];
  for (const [channel, handler] of routes) handleIpc(IPC[channel], handler);
  /* Найден ли на ПК клиент RAGE MP (GTA 5 RP) — окно говорит об этом у работ со своим пакетом (18.11.2026, `rage-mp-status.js`). */
  registerRageMpStatusIpc({ IPC, handleIpc, trusted, rage: createRageMpStatus() });
}
