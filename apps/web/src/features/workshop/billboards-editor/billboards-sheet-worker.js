import { billboardSheetPixels } from "./billboards-sheet.js";

// Работа возвращает [сообщение, список переноса]; сбой отправки тоже даёт ответ с ошибкой.
function answer(post, id, work) {
  try {
    const [message, transfer] = work();
    if (transfer) post(message, transfer);
    else post(message);
  } catch (thrown) {
    post({ id, error: String(thrown?.message || thrown) });
  }
}

const scope = self;

scope.onmessage = (event) => {
  const data = event.data ?? {};
  const post = (...args) => scope.postMessage(...args);
  answer(post, data.id, () => {
    const rgba = billboardSheetPixels(data.job);
    return [{ id: data.id, rgba }, [rgba.buffer]];
  });
};
