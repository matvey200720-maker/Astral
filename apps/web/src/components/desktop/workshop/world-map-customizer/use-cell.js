// Ячейка состояния без обновлений-функций: значение целиком, то же значение не перерисовывает.
import { useReducer } from "react";

export const takeNew = (_old, fresh) => fresh;

export const useCell = (initial) => useReducer(takeNew, initial);
