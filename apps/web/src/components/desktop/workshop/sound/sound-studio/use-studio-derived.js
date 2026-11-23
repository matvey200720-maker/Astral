import { useMemo } from "react";
import { describeBank, groupBanks, isWeaponBank } from "@modovik/sound-studio";
import {
  isReplacedState,
  pendingSoundBanks,
  soundBankStates,
  useSoundStateLabels,
} from "../sound-apply.js";
import { soundBankKey } from "../sound-model.js";
import { bankTarget, defaultTargetOf, streamTarget, trackTitle } from "../sound-targets.js";
import {
  assignmentsOfBank,
  bankKeyOf,
  hashesOf,
  indexAssignments,
  openBankOf,
  stateKeyOf,
  weaponTargets,
} from "./studio-model.js";

const NOTHING = Object.freeze([]);
const NO_ASSIGNMENTS = new Map();

/* ---------- открытый банк и всё, что от него зависит ---------- */

class BankFocus {
  constructor(shelf, wantedKey, bankSection) {
    const bank = openBankOf(shelf, wantedKey, bankSection);
    this.bank = bank;
    this.whole = !!bank && bank.kind === "bank";
    this.about = bank ? describeBank(bank.bank, bank.archive) : null;
    this.streams = (bank && bank.streams) || NOTHING;
    const layered = !!bank && !this.whole && isWeaponBank(bank.archive);
    this.layers = layered ? weaponTargets(bank) : NOTHING;
    this.firstPlace = new Map();
    this.streams.forEach((one, place) => {
      if (!this.firstPlace.has(one.hash)) this.firstPlace.set(one.hash, place);
    });
    this.names = null;
  }

  get heading() {
    return this.about.title || this.bank.bank;
  }

  streamTargetOf = (hash) => {
    const place = this.firstPlace.get(hash);
    return place === undefined ? null : streamTarget(this.bank, this.streams[place], place);
  };

  // Цель, которую сейчас правят: банк целиком, дорожка из списка или слой.
  choose(streamHash, layerKey) {
    if (!this.bank) return null;
    if (this.whole) return bankTarget(this.bank, this.heading);
    const listed = streamHash ? this.streamTargetOf(streamHash) : null;
    return listed || this.layers.find(({ key }) => key === layerKey) || this.layers[0] || null;
  }

  // Имя дорожки в плане установки: слой, банк целиком или «Дорожка N».
  describe = (hash) => {
    if (!this.bank) return hash;
    if (this.whole) return this.heading;
    if (!this.names) {
      this.names = new Map();
      this.streams.forEach((one, place) => this.names.set(one.hash, trackTitle(place)));
      this.layers.forEach((layer) => {
        hashesOf(layer).forEach((one) => this.names.set(one, layer.title));
      });
    }
    return this.names.has(hash) ? this.names.get(hash) : hash;
  };

  // Куда ляжет файл, брошенный мимо карточек.
  dropKey(streamHash) {
    const preset = this.bank ? defaultTargetOf(this.bank) : null;
    if (preset) return preset.key;
    const listed = this.streams.find(({ hash }) => hash === streamHash);
    const usable = listed && listed.replaceable !== false;
    return usable ? `stream:${listed.hash}` : "";
  }
}

function useBankFocus(context, feed, picked) {
  const { section, full, view } = context;
  const wholeShelf = full || section.id !== "weapons";
  const shelfBanks = useMemo(
    () => (wholeShelf ? feed.banks : feed.banks.filter(({ archive }) => isWeaponBank(archive))),
    [wholeShelf, feed.banks],
  );
  const bankSection = section.kind === "bank";
  const focus = useMemo(
    () => new BankFocus(shelfBanks, view.bank, bankSection),
    [shelfBanks, view.bank, bankSection],
  );
  const selectedTarget = useMemo(
    () => focus.choose(picked.stream, picked.layer),
    [focus, picked.stream, picked.layer],
  );
  const fallbackKey = useMemo(() => focus.dropKey(picked.stream), [focus, picked.stream]);
  return {
    bankSection,
    shelfBanks,
    openBank: focus.bank,
    wholeBank: focus.whole,
    info: focus.about,
    bankStreams: focus.streams,
    layerTargets: focus.layers,
    streamTargetOf: focus.streamTargetOf,
    describeStream: focus.describe,
    selectedTarget,
    fallbackKey,
  };
}

/* ---------- назначения проекта ---------- */

const finderOver = (index) => (bank, hash) => index.get(`${stateKeyOf(bank)}:${hash}`);

function useAssignmentTables(assignments, openBank) {
  const assignmentOf = useMemo(() => finderOver(indexAssignments(assignments)), [assignments]);
  const openAssignments = useMemo(
    () => (openBank ? assignmentsOfBank(assignments, openBank) : NO_ASSIGNMENTS),
    [assignments, openBank],
  );
  return { assignmentOf, openAssignments };
}

/* ---------- метки полки, группы, цели по умолчанию ---------- */

const hasAddress = (work) => Boolean(work && work.archive && work.bank);
const mentions = (text, needle) => String(text).toLowerCase().includes(needle);

function bankMatches(bank, needle) {
  const { title, codename } = describeBank(bank.bank, bank.archive);
  return [title, codename].some((text) => mentions(text, needle));
}

// Группа, попавшая под запрос, остаётся целиком; иначе в ней отбираются банки.
function narrowGroups(groups, needle) {
  return groups.reduce((kept, group) => {
    const own = mentions(group.title, needle)
      ? group.banks
      : group.banks.filter((bank) => bankMatches(bank, needle));
    if (own.length === 0) return kept;
    return [...kept, own.length === group.banks.length ? group : { ...group, banks: own }];
  }, []);
}

function useShelfStates(feed, view, assignments, shelfBanks, picked) {
  const worksByBank = useMemo(
    () =>
      new Map(
        feed.works
          .filter(hasAddress)
          .map((work) => [soundBankKey(work.archive, work.bank), work]),
      ),
    [feed.works],
  );
  const bankStates = useMemo(
    () =>
      soundBankStates({
        banks: feed.banks,
        assignments,
        installed: view.installed,
        works: worksByBank,
      }),
    [feed.banks, assignments, view.installed, worksByBank],
  );
  const labels = useSoundStateLabels(bankStates);
  const pending = useMemo(() => pendingSoundBanks(bankStates), [bankStates]);

  const replacedBanks = useMemo(
    () => shelfBanks.filter((bank) => isReplacedState(labels.get(stateKeyOf(bank)))),
    [shelfBanks, labels],
  );
  const { onlyReplaced, query } = picked;
  const groups = useMemo(() => {
    const grouped = groupBanks(onlyReplaced ? replacedBanks : shelfBanks);
    const needle = query.trim().toLowerCase();
    return needle ? narrowGroups(grouped, needle) : grouped;
  }, [shelfBanks, replacedBanks, onlyReplaced, query]);
  const shelfTargets = useMemo(
    () => new Map(shelfBanks.map((bank) => [bankKeyOf(bank), defaultTargetOf(bank)])),
    [shelfBanks],
  );
  return {
    bankStates,
    labels,
    pending,
    groups,
    shelfTargets,
    replacedCount: replacedBanks.length,
  };
}

// Всё, что выводится из банков, проекта и выбора человека, без побочных действий.
export function useStudioDerived(feed, picked, context) {
  const { view, assignments } = context;
  const focus = useBankFocus(context, feed, picked);
  const tables = useAssignmentTables(assignments, focus.openBank);
  const shelf = useShelfStates(feed, view, assignments, focus.shelfBanks, picked);
  return { ...focus, ...tables, ...shelf };
}
