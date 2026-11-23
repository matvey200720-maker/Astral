// Колбэки платформы (file / readEntries) как обещание; метод зовётся на самом объекте.
function ask(target, method) {
  return new Promise((resolve, reject) => target[method](resolve, reject));
}

// Данные переноса живут только внутри события drop: записи (а без них и список files)
// берутся до первого ожидания.
export default async function droppedFiles(transfer) {
  const entries = [];
  for (const item of transfer?.items ?? []) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  const files = [...(entries.length ? [] : (transfer?.files ?? []))];
  if (!entries.length) return { files, folder: "" };
  // Обход строго по одному: file() следующей записи не зовётся, пока не закончена предыдущая.
  // Предел глубины 4 и предел 400 файлов — защита от случайно брошенного домашнего каталога.
  async function walk(list, depth) {
    if (depth > 4) return;
    for (const entry of list) {
      if (files.length >= 400) return;
      if (entry.isFile) files.push(await ask(entry, "file"));
      else {
        // Каталог отдаёт записи порциями: читаем страницы подряд до пустой, потом обходим детей.
        const reader = entry.createReader();
        const children = [];
        for (let page; (page = await ask(reader, "readEntries")).length; ) children.push(...page);
        await walk(children, depth + 1);
      }
    }
  }
  await walk(entries, 0);
  const dirNames = entries.flatMap((entry) => (entry.isDirectory ? [entry.name] : []));
  return { files, folder: dirNames.length === 1 ? dirNames[0] : "" };
}
