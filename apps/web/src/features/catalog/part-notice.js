// Одно письмо на окно: каталог оставляет строку, нужный редактор её забирает.
// Ячейка живёт в замыкании и недоступна снаружи, кроме как через два метода.
const { rememberPartNotice, takePartNotice } = (() => {
  // Либо null, либо пара [кому, что].
  let letter = null;

  return {
    // Каждый вызов затирает прежнее письмо. Если адресата или текста нет,
    // нового письма тоже нет, и старое не должно дожить до чужого забора.
    rememberPartNotice(editor, text) {
      letter = editor && text ? [editor, text] : null;
    },

    // Чужому редактору письмо не отдаётся и не пропадает.
    takePartNotice(editor) {
      if (letter === null || letter[0] !== editor) return "";
      const body = letter[1];
      letter = null;
      return body;
    },
  };
})();

export { rememberPartNotice, takePartNotice };
