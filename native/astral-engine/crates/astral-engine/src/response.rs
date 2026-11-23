//! Строка ответа команды: один JSON, и в нём только ASCII.
//!
//! Консоль Windows и мост по-разному понимают кодировку, поэтому всё выше
//! U+007F уходит записью `\uXXXX`. Те же два помощника нужны соседям, которые
//! пишут JSON-файлы без знаков вне ASCII.

use std::fmt::{self, Write};

use serde_json::{Map, Value};

use crate::error::EngineError;

/// Приёмник текста, который по дороге превращает знаки выше ASCII в
/// последовательности `\uXXXX` (суррогатные пары для знаков вне BMP).
struct SevenBit<'a>(&'a mut String);

impl Write for SevenBit<'_> {
    fn write_str(&mut self, text: &str) -> fmt::Result {
        for ch in text.chars() {
            if ch.is_ascii() {
                self.0.push(ch);
                continue;
            }
            let mut halves = [0u16; 2];
            for unit in ch.encode_utf16(&mut halves).iter() {
                write!(self.0, "\\u{unit:04X}")?;
            }
        }
        Ok(())
    }
}

/// Объект JSON с ключами в том порядке, в каком они перечислены.
fn ordered<const N: usize>(entries: [(&str, Value); N]) -> Value {
    Value::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect::<Map<String, Value>>(),
    )
}

/// Любой текст без знаков выше ASCII. Управляющие знаки и обратная косая
/// остаются как есть: это не JSON-экранирование.
pub fn ascii_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    // Запись в `String` не отказывает, ошибке взяться неоткуда.
    let _ = SevenBit(&mut out).write_str(text);
    out
}

/// Компактный JSON значения без знаков выше ASCII.
pub fn ascii_json(value: &Value) -> String {
    let mut out = String::new();
    let _ = write!(SevenBit(&mut out), "{value}");
    out
}

/// Строка успешного ответа: `ok`, `command`, `result`.
pub fn success(command: &str, result: Value) -> String {
    ascii_json(&ordered([
        ("ok", Value::Bool(true)),
        ("command", Value::from(command)),
        ("result", result),
    ]))
}

/// Строка отказа: `ok`, затем `error` с `code` и `message`.
pub fn failure(error: &EngineError) -> String {
    let details = ordered([
        ("code", Value::from(error.code.as_str())),
        ("message", Value::from(error.message.as_str())),
    ]);
    ascii_json(&ordered([("ok", Value::Bool(false)), ("error", details)]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn escaped(cases: &[(&str, &str)]) {
        for (input, expected) in cases {
            assert_eq!(ascii_escape(input), *expected, "вход: {input:?}");
        }
    }

    #[test]
    fn plain_and_boundary_characters() {
        // Ас1, Ас2, Ас5, Ас6 – Ас16
        escaped(&[
            ("", ""),
            ("plain text {\"a\":1}", "plain text {\"a\":1}"),
            ("a\u{7f}b", "a\u{7f}b"),
            ("a\u{80}b", "a\\u0080b"),
            ("\u{ff}", "\\u00FF"),
            ("\u{100}", "\\u0100"),
            ("\u{7ff}", "\\u07FF"),
            ("\u{800}", "\\u0800"),
            ("\u{2028}", "\\u2028"),
            ("\u{feff}", "\\uFEFF"),
            ("\u{fffd}", "\\uFFFD"),
            ("\u{ffff}", "\\uFFFF"),
            ("\u{d7ff}", "\\uD7FF"),
            ("\u{e000}", "\\uE000"),
        ]);
    }

    #[test]
    fn letters_marks_and_scripts() {
        // Ас3, Ас4, Ас22, Ас25, Ас27
        escaped(&[
            ("Привет", "\\u041F\\u0440\\u0438\\u0432\\u0435\\u0442"),
            ("caf\u{e9}", "caf\\u00E9"),
            (
                "say \"привет\"",
                "say \"\\u043F\\u0440\\u0438\\u0432\\u0435\\u0442\"",
            ),
            ("e\u{301}", "e\\u0301"),
            ("中文", "\\u4E2D\\u6587"),
        ]);
    }

    #[test]
    fn astral_plane_becomes_surrogate_pairs() {
        // Ас17 – Ас20, Ас26
        escaped(&[
            ("\u{10000}", "\\uD800\\uDC00"),
            ("😀", "\\uD83D\\uDE00"),
            ("\u{10ffff}", "\\uDBFF\\uDFFF"),
            ("😀😁x", "\\uD83D\\uDE00\\uD83D\\uDE01x"),
            ("👨\u{200d}👩", "\\uD83D\\uDC68\\u200D\\uD83D\\uDC69"),
        ]);
    }

    #[test]
    fn existing_backslashes_and_controls_are_left_alone() {
        // Ас21, Ас23, Ас24
        escaped(&[
            (
                "back\\slash and \\u00e9 literal",
                "back\\slash and \\u00e9 literal",
            ),
            ("a\nb\u{e9}", "a\nb\\u00E9"),
            ("a\0b\u{e9}", "a\0b\\u00E9"),
        ]);
    }

    #[test]
    fn scalars_print_like_serde_json() {
        // Ас-Дж1 – Ас-Дж14
        let cases: Vec<(Value, &str)> = vec![
            (Value::Null, "null"),
            (json!(true), "true"),
            (json!(0), "0"),
            (json!(-17), "-17"),
            (Value::from(u64::MAX), "18446744073709551615"),
            (Value::from(i64::MIN), "-9223372036854775808"),
            (json!(0.1), "0.1"),
            (json!(1.0), "1.0"),
            (json!(1e21), "1e+21"),
            (json!(1e-7), "1e-7"),
            (Value::from(f64::NAN), "null"),
            (Value::from(f64::INFINITY), "null"),
            (Value::from(-0.0f64), "-0.0"),
            (Value::from(0.1f32), "0.10000000149011612"),
        ];
        for (value, expected) in cases {
            assert_eq!(ascii_json(&value), expected, "{value:?}");
        }
    }

    #[test]
    fn strings_keys_and_nesting() {
        // Ас-Дж15 – Ас-Дж22
        assert_eq!(
            ascii_json(&json!("Привет, мир")),
            "\"\\u041F\\u0440\\u0438\\u0432\\u0435\\u0442, \\u043C\\u0438\\u0440\""
        );
        assert_eq!(ascii_json(&json!({})), "{}");
        assert_eq!(ascii_json(&json!([])), "[]");
        assert_eq!(
            ascii_json(&json!({"z": 1, "a": 2, "м": 3, "b": {"y": 1, "x": 2}})),
            "{\"z\":1,\"a\":2,\"\\u043C\":3,\"b\":{\"y\":1,\"x\":2}}"
        );
        assert_eq!(
            ascii_json(&json!({"имя": "значение", "emoji😀": "😀"})),
            "{\"\\u0438\\u043C\\u044F\":\"\\u0437\\u043D\\u0430\\u0447\\u0435\\u043D\\u0438\\u0435\",\
             \"emoji\\uD83D\\uDE00\":\"\\uD83D\\uDE00\"}"
        );
        assert_eq!(
            ascii_json(&json!("a\u{1}b\u{1f}c\u{7f}d\te\nf\rg\u{8}h\u{c}i\"j\\k/l")),
            "\"a\\u0001b\\u001fc\u{7f}d\\te\\nf\\rg\\bh\\fi\\\"j\\\\k/l\""
        );
        assert_eq!(
            ascii_json(&json!({"a": [1, {"b": ["ж", null, 2.5]}], "s": "é"})),
            "{\"a\":[1,{\"b\":[\"\\u0436\",null,2.5]}],\"s\":\"\\u00E9\"}"
        );
        assert_eq!(ascii_json(&json!([0, 1, 2, 3, 4])), "[0,1,2,3,4]");
    }

    #[test]
    fn success_lines() {
        // Ус1 – Ус8
        let cases: Vec<(&str, Value, &str)> = vec![
            (
                "health",
                json!({"count": 2}),
                r#"{"ok":true,"command":"health","result":{"count":2}}"#,
            ),
            (
                "команда",
                Value::Null,
                r#"{"ok":true,"command":"\u043A\u043E\u043C\u0430\u043D\u0434\u0430","result":null}"#,
            ),
            (
                "x",
                Value::Null,
                r#"{"ok":true,"command":"x","result":null}"#,
            ),
            ("", json!({}), r#"{"ok":true,"command":"","result":{}}"#),
            (
                "a\"b",
                json!([]),
                r#"{"ok":true,"command":"a\"b","result":[]}"#,
            ),
            (
                "x",
                json!([1, "é"]),
                r#"{"ok":true,"command":"x","result":[1,"\u00E9"]}"#,
            ),
            (
                "x",
                json!({"name": "Привет", "emoji": "😀"}),
                r#"{"ok":true,"command":"x","result":{"name":"\u041F\u0440\u0438\u0432\u0435\u0442","emoji":"\uD83D\uDE00"}}"#,
            ),
            (
                "x",
                json!({"b": 1, "a": 2}),
                r#"{"ok":true,"command":"x","result":{"b":1,"a":2}}"#,
            ),
        ];
        for (command, result, expected) in cases {
            assert_eq!(success(command, result), expected);
        }
    }

    #[test]
    fn failure_lines() {
        // От1 – От8
        let cases: Vec<(EngineError, &str)> = vec![
            (
                EngineError::argument("--patch is required."),
                r#"{"ok":false,"error":{"code":"ArgumentException","message":"--patch is required."}}"#,
            ),
            (
                EngineError::cancelled(),
                r#"{"ok":false,"error":{"code":"Cancelled","message":"\u041E\u0442\u043C\u0435\u043D\u0435\u043D\u043E."}}"#,
            ),
            (
                EngineError::new("", ""),
                r#"{"ok":false,"error":{"code":"","message":""}}"#,
            ),
            (
                EngineError::new("К", "Ошибка"),
                r#"{"ok":false,"error":{"code":"\u041A","message":"\u041E\u0448\u0438\u0431\u043A\u0430"}}"#,
            ),
            (
                EngineError::new("E", "oops 😀"),
                r#"{"ok":false,"error":{"code":"E","message":"oops \uD83D\uDE00"}}"#,
            ),
            (
                EngineError::invalid_data("line1\nline2"),
                r#"{"ok":false,"error":{"code":"InvalidDataException","message":"line1\nline2"}}"#,
            ),
            (
                EngineError::io("a \"b\" \\ c"),
                r#"{"ok":false,"error":{"code":"IOException","message":"a \"b\" \\ c"}}"#,
            ),
            (
                EngineError::internal("unknown failure"),
                r#"{"ok":false,"error":{"code":"InternalError","message":"unknown failure"}}"#,
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(failure(&error), expected);
        }
    }

    #[test]
    fn output_is_one_ascii_line_that_parses_back() {
        let original = json!({"name": "Привет", "emoji": "😀", "nested": ["é", {"k": "ж"}]});
        let line = success("round-trip", original.clone());
        assert!(line.is_ascii());
        assert!(!line.contains('\n'));
        let parsed: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(parsed["result"], original);
        let refusal = failure(&EngineError::new("E", "Ошибка 😀\nдве строки"));
        let back: Value = serde_json::from_str(&refusal).unwrap();
        assert_eq!(back["error"]["message"], "Ошибка 😀\nдве строки");
    }
}
