// Точная версия Astral из подписанного манифеста установленного релиза: package.json у всех
// бета-сборок одинаковый и ничего не говорит (docs/beta/release-channels.md, §5.3).
import { useEffect, useState } from "react";
import { channelLabel as branchName } from "./model.js";
import { updateActions, useUpdates as useSnapshot } from "./store.js";

// undefined - ещё спрашиваем, null - установленного релиза нет (разработка, не бета).
// Версия службы входит в ключ: смена её в снимке страхует от устаревшего ответа
// (на диске версия меняется только перезапуском).
export function useInstalledRelease() {
  const { loaded, state } = useSnapshot();
  const [release, setRelease] = useState();
  const version = (state.current || {}).version ?? null;

  useEffect(() => {
    let alive = loaded;
    if (loaded && state.disabled) setRelease(null);
    else if (loaded) {
      Promise.resolve(updateActions.installed()).then((info) => alive && setRelease(info && info.version ? info : null));
    }
    return () => {
      alive = false;
    };
  }, [loaded, state.disabled, version]);

  return release;
}

// Слова лежат здесь, а не в общем словаре обновлений: нужны и там, где обновлений нет вовсе.
// В шаблонах # - подставляемое значение.
const WORDS = {
  ru: { build: "сборка #", branch: "ветка #", dev: "Версия разработки" },
  uk: { build: "збірка #", branch: "гілка #", dev: "Версія розробки" },
  en: { build: "build #", branch: "# branch", dev: "Development version" },
  de: { build: "Build #", branch: "Zweig #", dev: "Entwicklungsversion" },
  pl: { build: "build #", branch: "gałąź #", dev: "Wersja deweloperska" },
  fr: { build: "build #", branch: "branche #", dev: "Version de développement" },
};

function wordsFor(language) {
  return WORDS[language] || WORDS.en;
}

const fill = (template, value) => template.split("#").join(value);

export function releaseDetail(info, language) {
  const words = wordsFor(language);
  const branch = info && branchName(info.channel);
  const parts = info ? [info.build && fill(words.build, info.build), branch && fill(words.branch, branch)] : [];
  return parts.filter(Boolean).join(" · ");
}

export function developmentVersionLabel(language) {
  return wordsFor(language).dev;
}
