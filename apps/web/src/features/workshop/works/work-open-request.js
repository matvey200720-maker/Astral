// Одна «просьба открыть работу» на окно: каталог кладёт, мастерская забирает.

const REQUEST_LIFETIME_MS = 60_000;

// Ящик хранит ключ и момент, когда его положили; всё остальное считается из часов.
function createMailbox(lifetimeMs) {
  let parcel = null;

  const isFresh = () => parcel !== null && Date.now() - parcel.placedAt < lifetimeMs;

  return {
    drop(key) {
      if (!key) {
        parcel = null;
        return;
      }
      const text = String(key);
      parcel = { text, placedAt: Date.now() };
    },
    look: isFresh,
    pick() {
      const found = isFresh() ? parcel.text : null;
      parcel = null;
      return found;
    },
  };
}

const mailbox = createMailbox(REQUEST_LIFETIME_MS);

export const requestWorkOpen = (key) => {
  mailbox.drop(key);
};

export const hasWorkOpenRequest = () => mailbox.look();

export const takeWorkOpenRequest = () => mailbox.pick();
