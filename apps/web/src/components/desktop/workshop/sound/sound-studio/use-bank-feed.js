import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { desktopHost, sanitizeDesktopErrorMessage } from "../../../../../api.js";
import { gameRootOf } from "../useSoundAudio.js";
import { subscribeSoundInstalls } from "../sound-apply.js";
import { tr } from "../../../../../locales/ui.js";
import { bankKeyOf } from "./studio-model.js";

const hasMethod = (host, name) => Boolean(host) && typeof host[name] === "function";

const FEED_START = {
  banks: [],
  readState: "loading",
  stale: false,
  problems: [],
  works: [],
  worksKnown: false,
  gameRoot: "",
};

// Единый редьюсер ленты: каждое сообщение читается из игры одним действием.
const feedStep = (feed, act) => {
  switch (act.kind) {
    case "state":
      return feed.readState === act.value ? feed : { ...feed, readState: act.value };
    case "root":
      return feed.gameRoot === act.value ? feed : { ...feed, gameRoot: act.value };
    case "empty":
      return { ...feed, banks: [], stale: false, problems: [], readState: "ready" };
    case "answer":
      return {
        ...feed,
        banks: act.banks || [],
        stale: Boolean(act.stale),
        problems: act.problems || [],
        readState: "ready",
      };
    case "failure":
      return { ...feed, banks: [], readState: "error" };
    case "works":
      return { ...feed, works: act.list, worksKnown: true };
    case "detail":
      return {
        ...feed,
        banks: feed.banks.map((one) =>
          bankKeyOf(one) === bankKeyOf(act.bank) ? { ...one, ...act.detail, pending: false } : one,
        ),
      };
    default:
      return feed;
  }
};

// Банки раздела, список работ в игре, папка игры и дочитывание песни.
export function useBankFeed({ sectionId, station, setNotice, setView }) {
  const [feed, send] = useReducer(feedStep, FEED_START);
  // Повторное то же значение не отправляем: у useReducer это лишний вызов компонента.
  const seen = useRef(feed);
  seen.current = feed;

  const reload = useMemo(() => {
    const radio = sectionId === "radio";
    return ({ refresh = false, announce = false, onFresh } = {}) => {
      const host = desktopHost();
      if (!hasMethod(host, "listSoundBanks")) {
        send({ kind: "state", value: "unavailable" });
        return Promise.resolve();
      }
      if (radio && !station) {
        send({ kind: "empty" });
        return Promise.resolve();
      }
      if (seen.current.readState !== "loading") send({ kind: "state", value: "loading" });
      return gameRootOf(host)
        .then((found) => {
          if (seen.current.gameRoot !== found) send({ kind: "root", value: found });
          const query = { gameRoot: found, section: sectionId };
          if (radio) query.archive = station;
          query.refresh = refresh;
          return host.listSoundBanks(query);
        })
        .then((answer) => {
          const { banks, stale, problems } = answer;
          send({ kind: "answer", banks, stale, problems });
          if (!refresh) return;
          if (onFresh) onFresh();
          if (announce) setNotice(tr("Банки перечитаны из игры"));
        })
        .catch((failure) => {
          send({ kind: "failure" });
          setNotice(
            sanitizeDesktopErrorMessage(failure) || tr("Не удалось прочитать звуковые банки."),
          );
        });
    };
  }, [sectionId, station, setNotice]);

  const reloadWorks = useCallback(async () => {
    const host = desktopHost();
    const asked = (async () => {
      if (!hasMethod(host, "listSoundWorks")) return [];
      const answer = await host.listSoundWorks({});
      return (answer && answer.works) || [];
    })();
    const list = await asked.catch(() => []);
    send({ kind: "works", list });
  }, []);

  // Отпечаток чужой установки -> в вид проекта, затем работы читаем заново.
  useEffect(
    () =>
      subscribeSoundInstalls((key, signature) => {
        setView((was) => ({ ...was, installed: { ...was.installed, [key]: signature } }));
        reloadWorks();
      }),
    [setView, reloadWorks],
  );

  useEffect(() => {
    reload();
    reloadWorks();
  }, [reload, reloadWorks]);

  const readPending = useCallback(
    (bank) => {
      const host = desktopHost();
      if (!bank.pending || !hasMethod(host, "readSoundBank")) return;
      const ask = async () => {
        const root = await gameRootOf(host);
        return host.readSoundBank({ gameRoot: root, archive: bank.archive, bank: bank.bank });
      };
      ask().then(
        (detail) => send({ kind: "detail", bank, detail }),
        (failure) =>
          setNotice(
            sanitizeDesktopErrorMessage(failure) || tr("Не удалось прочитать песню из игры."),
          ),
      );
    },
    [setNotice],
  );

  return { ...feed, reload, reloadWorks, readPending };
}

// Очередь разбора профилей: один запрос на банк, отказ снимает отметку для повтора.
class ProfileDesk {
  constructor(put) {
    this.put = put;
    this.asked = new Set();
  }

  request(host, bank) {
    const key = bankKeyOf(bank);
    if (this.asked.has(key)) return;
    this.asked.add(key);
    this.put(key, null);
    gameRootOf(host)
      .then((root) =>
        host.readSoundProfile({ gameRoot: root, archive: bank.archive, bank: bank.bank }),
      )
      .then(
        (answer) => this.put(key, { tracks: answer.tracks || {} }),
        (failure) => {
          this.asked.delete(key);
          this.put(key, {
            error: sanitizeDesktopErrorMessage(failure) || tr("Не удалось разобрать звуки."),
          });
        },
      );
  }
}

const putProfile = (all, [key, value]) => ({ ...all, [key]: value });

export function useBankProfiles({ wanted, bank }) {
  const [profiles, store] = useReducer(putProfile, {});
  const [attempt, setAttempt] = useState(0);
  const desk = useState(() => new ProfileDesk((key, value) => store([key, value])))[0];

  useEffect(() => {
    const host = desktopHost();
    if (wanted && bank && hasMethod(host, "readSoundProfile")) desk.request(host, bank);
  }, [wanted, bank, attempt, desk]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { profiles, retry };
}
