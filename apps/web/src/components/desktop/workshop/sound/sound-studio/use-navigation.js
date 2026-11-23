import { useMemo, useReducer } from "react";
import { bankKeyOf, hasSimplePath } from "./studio-model.js";
import { rememberAdvancedChoice } from "./use-studio-view.js";

// Выбор человека в кадре: дорожка, слой, поиск по полке, фильтры и образец.
export const PICK_START = {
  stream: null,
  layer: null,
  query: "",
  onlyReplaced: false,
  tech: false,
  sort: "number",
  reference: null,
  trackList: false,
};

// Значение поля — новое значение или функция от прежнего.
const pickStep = (was, change) => {
  const next = { ...was };
  Object.entries(change).forEach(([field, value]) => {
    next[field] = value instanceof Function ? value(was[field]) : value;
  });
  return next;
};

export function usePicks() {
  const [picked, pick] = useReducer(pickStep, PICK_START);
  // По одному устойчивому установщику на поле: set.query("ab"), set.tech(true) ...
  const set = useMemo(() => {
    const makers = Object.keys(PICK_START).map((field) => [
      field,
      (value) => pick({ [field]: value }),
    ]);
    return Object.fromEntries(makers);
  }, []);
  return { picked, pick, set };
}

const CLEAN_BANK = { stream: null, layer: null, trackList: false, sort: "number", reference: null };

// Переходы между разделами, банками, станциями и дорожками (все устойчивы).
export function useNavigation({ pick, halt, setView, setTool, setAdvanced, readPending, live }) {
  return useMemo(() => {
    const toSection = (id) => {
      halt();
      setView((was) => ({ ...was, section: id, bank: "" }));
      pick({ ...CLEAN_BANK, query: "" });
      setTool("banks");
    };
    return {
      switchSection: toSection,
      selectBank: (bank) => {
        halt();
        setView((was) => ({ ...was, bank: bankKeyOf(bank) }));
        pick(CLEAN_BANK);
        readPending(bank);
      },
      chooseStation: (archive) => {
        halt();
        setView((was) => ({ ...was, station: archive, bank: "" }));
        pick({ stream: null, query: "" });
      },
      setAdvancedChoice: (next) => {
        const on = Boolean(next);
        rememberAdvancedChoice(on);
        setAdvanced(on);
        if (on) return;
        pick({ stream: null, trackList: false, onlyReplaced: false });
        if (!hasSimplePath(live.current.sectionId)) toSection("weapons");
      },
      selectStream: (hash) => {
        pick({ stream: hash });
        if (hash) setTool("edit");
      },
      selectLayer: (target) => {
        pick({ layer: target.key, stream: null });
        setTool("edit");
      },
      openBankDirect: (bank) => setView((was) => ({ ...was, bank: bankKeyOf(bank) })),
      clearReference: () => pick({ reference: null, sort: "number" }),
      similarTo: (title, features) =>
        pick({ reference: { title, features, file: null }, sort: "similar" }),
    };
  }, [pick, halt, setView, setTool, setAdvanced, readPending, live]);
}
