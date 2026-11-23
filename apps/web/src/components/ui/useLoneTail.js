/*
 * Одинокая плитка в последнем ряду сетки.
 *
 * Пять вариантов в две колонки — «Как в игре», «Свой цвет», «Своя картинка»,
 * «Надпись», «Убрать»: последняя встаёт в левую колонку, а правая рядом с ней
 * пуста, и плитка читается повисшей — выбор будто не закончен (ТЗ 22.10.2026,
 * п. 3, образец 4). Плитка без картинки — одно название и пояснение — в таком
 * случае занимает весь ряд. Плитки с картинкой растягивать нельзя: снимок
 * на ширину панели — уже не снимок того, что выбирают.
 *
 * Сколько колонок в сетке, знает стиль места, где она стоит, а не плитка, поэтому
 * считаем по готовой раскладке: сколько различных левых краёв у плиток и
 * стоит ли последняя в ряду одна. Метку снимаем перед замером — иначе занявшая
 * весь ряд плитка сама скрыла бы то, что она одна. Пересчёт — при смене набора
 * и ширины сетки (колонка инспектора уходит под кадр в узком окне, и два столбца
 * превращаются в один).
 */

import { useLayoutEffect } from "react";

export default function useLoneTail(ref, signature = "") {
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return undefined;

    const arrange = () => {
      const tiles = [...grid.children].filter((node) => node.classList.contains("ui-choice"));
      for (const tile of tiles) tile.removeAttribute("data-lone");
      if (tiles.length < 2) return;
      const columns = new Set(tiles.map((tile) => tile.offsetLeft)).size;
      const last = tiles[tiles.length - 1];
      if (columns < 2 || !last.classList.contains("is-bare")) return;
      const row = tiles.filter((tile) => Math.abs(tile.offsetTop - last.offsetTop) < 2);
      if (row.length === 1) last.setAttribute("data-lone", "");
    };

    arrange();
    if (typeof ResizeObserver === "undefined") return undefined;
    let width = grid.clientWidth;
    const observer = new ResizeObserver(() => {
      if (grid.clientWidth === width) return;
      width = grid.clientWidth;
      arrange();
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [ref, signature]);
}
