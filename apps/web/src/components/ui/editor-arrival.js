// Сколько заглушек-каркасов сейчас держат комнату редактора на экране (счётчик, а не флаг).
let holders = 0;

export function editorRoomStanding() {
  return holders > 0;
}

/** Берёт комнату и возвращает снятие; повторное снятие не защищено, счётчик снизу не ограничен. */
export function holdEditorRoom() {
  holders += 1;
  return () => {
    holders -= 1;
  };
}
