/*
 * Нативное сжатие блоков текстур DXT1/3/5 для процессов Node (15.11.2026).
 *
 * `@modovik/dds` грузится и в окне (браузер), где нативного модуля нет, поэтому
 * ядро Rust (`@modovik/native-rs`, `native/astral-rs/src/dxt.rs`) подставляет
 * сюда код Node: импорт этого файла один раз на процесс или поток назначает
 * его кодеку `encodeBlocks`. Сам файл — только назначение: ядро проверяет себя
 * при первом сжатии, а выключатель `ASTRAL_NATIVE_DXT=0`, отсутствие модуля,
 * старый модуль без этой функции и любой сбой вызова возвращают JS-кодек
 * (`packages/dds/block-codec.js`), он остаётся эталоном.
 *
 * Подключается побочным импортом в главном процессе (`main.js`) и в каждом
 * потоке, который может сжимать текстуры; охрана — `tests/native-block-codec-wiring.test.js`.
 */

import { setNativeBlockEncoder } from "@modovik/dds";
import { encodeBlocksNative } from "@modovik/native-rs";

/** Назначить ядро кодеку DXT этого процесса (повторный вызов ничего не меняет). */
export function installNativeBlockCodec() {
  setNativeBlockEncoder(encodeBlocksNative);
}

installNativeBlockCodec();
