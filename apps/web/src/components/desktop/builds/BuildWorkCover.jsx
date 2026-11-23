import { installedEditorState } from "../../../features/workshop/works/workshop-works.js";
import { readWorkCode } from "../../../features/workshop/works/work-transfer.js";
import { buildEntryCoverKeys } from "../../../features/workshop/works/work-cover-keys.js";
import WorkCover from "../../../features/workshop/works/WorkCover.jsx";
import { useEffect, useMemo, useState } from "react";

const RETRYABLE = ["short-busy", "short-unavailable"];

// Память файла общая для всех показов: готовые ответы (по коду) и чтения, которые ещё идут.
function createLedger(capacity) {
  const answers = new Map();
  const jobs = new Map();

  // Когда мест нет, уходит самая ранняя запись; обращение к ответу очерёдность не трогает.
  const save = (code, answer) => {
    if (!answers.has(code) && answers.size >= capacity) {
      const [oldest] = answers.keys();
      answers.delete(oldest);
    }
    answers.set(code, answer);
  };

  return {
    peek: (code) => (answers.has(code) ? answers.get(code) : undefined),
    clear() {
      answers.clear();
      jobs.clear();
    },
    fetch(code, reader) {
      if (answers.has(code)) return Promise.resolve(answers.get(code));
      if (jobs.has(code)) return jobs.get(code);
      const job = reader(code).then(({ answer, final }) => {
        if (jobs.get(code) === job) jobs.delete(code);
        if (final) save(code, answer);
        return answer;
      });
      jobs.set(code, job);
      return job;
    },
  };
}

const ledger = createLedger(30);

export const forgetDecodedCovers = () => {
  ledger.clear();
};

const asText = (raw) => (typeof raw === "string" ? raw : JSON.stringify(raw));

// Из ответа чтения берётся только первый шаблон; всё остальное — окончательное «ничего».
function distill(reply) {
  try {
    const first = reply?.templates?.[0];
    if (!first) return null;
    const { state, project } = first;
    const source = state || project;
    return { state: source ? asText(source) : null, projectId: project?.id || "" };
  } catch {
    return null;
  }
}

// final = false у временных отказов сервера коротких кодов: такой ответ в память не идёт.
async function consult(code) {
  let reply;
  try {
    reply = await readWorkCode(code);
  } catch (failure) {
    return { answer: null, final: !RETRYABLE.includes(failure?.reason) };
  }
  return { answer: distill(reply), final: true };
}

const keysFor = (entry, answer) => {
  if (answer === undefined) return [];
  return buildEntryCoverKeys(entry, {
    state: answer?.state ?? null,
    projectId: answer?.projectId ?? "",
    installedState: installedEditorState(entry.slotId),
  });
};

const BuildWorkCover = (props) => {
  const { entry } = props;
  const { code, name, slotId } = entry;
  const { workKind, section } = entry;
  const index = props.index === undefined ? 0 : props.index;

  // undefined — ответа ещё не было; null — чтение окончательно не удалось
  const seedAnswer = () => ledger.peek(code);
  const [answer, setAnswer] = useState(seedAnswer);

  useEffect(() => {
    const watch = { live: true };
    ledger.fetch(code, consult).then((found) => {
      if (watch.live) setAnswer(found);
    });
    return () => {
      watch.live = false;
    };
  }, [code]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- ключи зависят от полей записи, а не от её объекта
  const coverKeys = useMemo(() => keysFor(entry, answer), [answer, code, name, slotId, workKind]);

  const work = useMemo(() => {
    if (answer === undefined) return null;
    const key = `build:${code.length}:${name}`;
    return { key, workKind, slotId, section, state: answer?.state ?? null, coverKeys };
  }, [answer, code, name, workKind, slotId, section, coverKeys]);

  if (work === null) return <span aria-hidden="true" className="workshop-cover" />;
  return <WorkCover work={work} index={index} />;
};

export default BuildWorkCover;
