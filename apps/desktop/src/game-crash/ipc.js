/*
 * Каналы окна для «Последних падений игры» (вкладка «Логи»). Журнал падений поднимается позже каналов, поэтому
 * обработчики спрашивают его через `setGameCrashJournal` / `current`: пока его нет, окно получает пустой список.
 */
import fs from "node:fs";
import { MAX_LOOKBACK_MS } from "./watch.js";

let current = null;

export const setGameCrashJournal = (journal) => {
  current = journal;
};

const snapshot = (journal, extra = {}) => ({
  ready: Boolean(journal),
  crashes: journal ? journal.list() : [],
  unnoticed: journal ? journal.unnoticed().map((record) => record.id) : [],
  ...extra,
});

/** Заголовок окна «Сохранить» на языке окна (главный процесс языка не знает: окно присылает его с просьбой). */
const SAVE_TITLES = {
  ru: "Сохранить отчёт о падении",
  uk: "Зберегти звіт про падіння",
  en: "Save the crash report",
  de: "Absturzbericht speichern",
  pl: "Zapisz raport o awarii",
  fr: "Enregistrer le rapport de plantage",
};
export const saveTitle = (language) => SAVE_TITLES[language] || SAVE_TITLES.en;

export function registerGameCrashIpc({ IPC, handleIpc, trusted, showSaveDialog, writeFile = fs.promises.writeFile, journal = () => current }) {
  const channels = [
    ["GAME_CRASH_LIST", () => snapshot(journal())],
    [
      "GAME_CRASH_SCAN",
      async () => {
        const active = journal();
        if (!active) return snapshot(null);
        const outcome = await active.scanNow({ sinceMs: MAX_LOOKBACK_MS, via: "manual" });
        return snapshot(active, { busy: outcome?.busy === true });
      },
    ],
    [
      "GAME_CRASH_NOTICED",
      (input) => {
        journal()?.markNoticed(Array.isArray(input?.ids) ? input.ids.map(String).slice(0, 20) : []);
        return { ok: true };
      },
    ],
    [
      "GAME_CRASH_REPORT",
      async (input) => {
        const active = journal();
        if (!active) return { saved: false, text: "" };
        const text = active.report(typeof input?.id === "string" ? input.id : "");
        if (typeof showSaveDialog !== "function") return { saved: false, text };
        const picked = await showSaveDialog({
          title: saveTitle(String(input?.language || "")),
          defaultPath: `astral-game-crash-${new Date().toISOString().slice(0, 10)}.txt`,
          filters: [{ name: "TXT", extensions: ["txt"] }],
        });
        if (picked.canceled || !picked.filePath) return { saved: false, canceled: true };
        await writeFile(picked.filePath, text, "utf8");
        return { saved: true, fileName: picked.filePath.split(/[\\/]/).pop() };
      },
    ],
  ];
  for (const [name, work] of channels) handleIpc(IPC[name], (event, input) => trusted(event, () => work(input)));
}
