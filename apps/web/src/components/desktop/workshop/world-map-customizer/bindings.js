// Свойства из сводки по описанию. Запись: "имя" — то же поле сводки; ["имя", "поле"] — другое поле;
// ["имя", (сводка) => значение] — вычисляемое. Порядок записей — порядок свойств.
export const pull = (source, spec) =>
  Object.fromEntries(
    spec.map((entry) => {
      if (typeof entry === "string") return [entry, source[entry]];
      const [name, from] = entry;
      return [name, typeof from === "function" ? from(source) : source[from]];
    }),
  );
