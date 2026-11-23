//! Резидентный режим движка: запросы приходят строками JSON, ответы и ход
//! уходят строками JSON, запросы выполняются одновременно.
//!
//! Конец ввода означает «мост закрылся»: начатые запросы доводятся до конца,
//! после чего `serve` возвращает управление.
//!
//! Кроме запросов `{id, argv}` в ввод идут строки управления без `argv`:
//!
//! * `{"control":"hello"}` — какие управления знает этот движок;
//! * `{"control":"limits","target":<id>,"writeLimitMbps":N,"readLimitMbps":M}` —
//!   сменить потолки идущего запроса (0 — без потолка, пропущенный ключ не
//!   меняется);
//! * `{"control":"cancel","target":<id>}` — остановить запрос в безопасной
//!   точке (ответ запроса — отказ `Cancelled`, код выхода 130).
//!
//! У строки управления может быть свой `id`: ответ придёт с ним, в том же
//! виде `{id, exitCode, response}`. Неизвестное управление и запрос, которого
//! уже нет, получают отказ, а не обрыв процесса. Прежний мост управления не
//! шлёт, а новый узнаёт его у движка строкой `hello`: прежний движок отвечает
//! на неё отказом «нужен argv».

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::panic::{self, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;

use rage_rpf::activity::{self, Activity};
use serde_json::{json, Map, Value};

use crate::disk::{limit_from_megabytes, Change, LiveLimits};
use crate::error::EngineError;
use crate::http;
use crate::progress::{Cancel, Progress};
use crate::{response, Outcome};

/// Исполнитель запроса; в работе это `crate::run`, в тестах бывает подмена.
type Executor = dyn Fn(&[String], &Progress) -> Outcome + Send + Sync;

/// Версия строк управления; растёт, когда прежний мост перестаёт их понимать.
pub const CONTROL_PROTOCOL: u32 = 1;

/// Управления, которые знает движок.
pub const CONTROLS: [&str; 3] = ["hello", "limits", "cancel"];

/// Команды установки, которым резидентный режим подходит: у них нет состояния
/// на процесс, а потолки и отмена идут через строки управления.
pub const INSTALL_COMMANDS: [&str; 3] = ["compose-rpf", "install-rpf-patch", "probe-rpf"];

/// Ключи блока `install` у `compose-rpf`, которые движок исполняет (не молча
/// пропускает): установка в два шага и ожидания запроса. Старый движок такого
/// списка не отдаёт, а незнакомые ключи игнорирует, поэтому приложение зовёт
/// `hold` только когда ответ на `hello` называет его здесь.
pub const INSTALL_KEYS: [&str; 6] = [
    "hold",
    "commit",
    "discard",
    "expectEntries",
    "expectDlcList",
    "keepKey",
];

const UNKNOWN_TARGET: &str = "UnknownTarget";
const UNKNOWN_CONTROL: &str = "UnknownControl";

/// Общий выход: каждая строка пишется одним куском под замком и сбрасывается.
struct Outlet(Mutex<Box<dyn Write + Send>>);

impl Outlet {
    fn new(sink: impl Write + Send + 'static) -> Self {
        Outlet(Mutex::new(Box::new(sink)))
    }

    /// Ошибки записи (читатель закрыл трубу) молча теряются.
    fn emit(&self, value: &Value) {
        let mut chunk = value.to_string();
        chunk.push('\n');
        let mut sink = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        let _ = sink.write_all(chunk.as_bytes()).and_then(|()| sink.flush());
    }
}

/// Счётчик начатых и не законченных запросов; по нему `serve` дожидается конца.
#[derive(Default)]
struct Ledger {
    running: Mutex<usize>,
    drained: Condvar,
}

/// Отметка «запрос в работе»: снимается при уничтожении, в том числе при панике.
struct Running(Arc<Ledger>);

impl Ledger {
    fn counter(&self) -> MutexGuard<'_, usize> {
        self.running.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn enter(self: &Arc<Self>) -> Running {
        *self.counter() += 1;
        Running(Arc::clone(self))
    }

    fn wait_until_drained(&self) {
        let mut running = self.counter();
        while *running > 0 {
            running = self
                .drained
                .wait(running)
                .unwrap_or_else(PoisonError::into_inner);
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let mut running = self.0.counter();
        *running -= 1;
        if *running == 0 {
            self.0.drained.notify_all();
        }
    }
}

/// Объект JSON с ключами в перечисленном порядке.
fn ordered<const N: usize>(entries: [(&str, Value); N]) -> Value {
    Value::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect::<Map<String, Value>>(),
    )
}

/// Ответ на запрос: строка ответа процесса разбирается и печатается заново,
/// поэтому знаки выше ASCII идут обычным UTF-8.
fn reply_frame(id: Value, exit_code: i32, line: &str) -> Value {
    let response = serde_json::from_str(line).unwrap_or_else(|_| Value::from(line));
    ordered([
        ("id", id),
        ("exitCode", Value::from(exit_code)),
        ("response", response),
    ])
}

/// Всё, чем канал управления достаёт до идущего запроса.
struct Control {
    cancel: Cancel,
    limits: Arc<LiveLimits>,
}

/// Идущие запросы по их `id` (запись JSON): к ним обращается строка управления.
/// Запрос заносится до того, как для него заведён поток, поэтому строка
/// управления сразу за строкой запроса его находит.
#[derive(Default)]
struct Registry(Mutex<HashMap<String, Vec<Arc<Control>>>>);

impl Registry {
    fn table(&self) -> MutexGuard<'_, HashMap<String, Vec<Arc<Control>>>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn key(id: &Value) -> String {
        id.to_string()
    }

    /// Запись живёт, пока жива охрана; одинаковые `id` у одновременных
    /// запросов не склеиваются: управление достаётся всем.
    fn enroll(self: &Arc<Self>, id: &Value, control: Arc<Control>) -> Enrolled {
        let key = Self::key(id);
        self.table()
            .entry(key.clone())
            .or_default()
            .push(Arc::clone(&control));
        Enrolled {
            registry: Arc::clone(self),
            key,
            control,
        }
    }

    fn find(&self, id: &Value) -> Vec<Arc<Control>> {
        self.table()
            .get(&Self::key(id))
            .cloned()
            .unwrap_or_default()
    }
}

/// Запись запроса в реестре; уходит из него при уничтожении, в том числе при панике.
struct Enrolled {
    registry: Arc<Registry>,
    key: String,
    control: Arc<Control>,
}

impl Drop for Enrolled {
    fn drop(&mut self) {
        let mut table = self.registry.table();
        if let Some(list) = table.get_mut(&self.key) {
            list.retain(|other| !Arc::ptr_eq(other, &self.control));
            if list.is_empty() {
                table.remove(&self.key);
            }
        }
    }
}

/// Строка управления после разбора.
enum Order {
    Hello,
    Limits { target: Value, change: Change },
    Cancel { target: Value },
}

/// Что получилось из одной входной строки.
enum Ask {
    Blank,
    Refused { id: Value, error: EngineError },
    Work { id: Value, argv: Vec<String> },
    Control { id: Value, order: Order },
}

/// Потолок из значения поля: пропущенный ключ — не менять; `null` и 0 — без потолка.
fn limit_field(value: &Value, key: &str) -> Result<Option<Option<u64>>, EngineError> {
    match value.get(key) {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(number) => match number.as_u64() {
            Some(megabytes) => Ok(Some(limit_from_megabytes(megabytes))),
            None => Err(EngineError::argument(format!(
                "{key} must be a non-negative whole number."
            ))),
        },
    }
}

fn parse_control(value: &Value) -> Result<Order, EngineError> {
    let Some(name) = value.get("control").and_then(Value::as_str) else {
        return Err(EngineError::argument("Serve control must be a string."));
    };
    let target = || {
        value
            .get("target")
            .cloned()
            .ok_or_else(|| EngineError::argument("Serve control needs a target."))
    };
    match name {
        "hello" => Ok(Order::Hello),
        "limits" => {
            let change = Change {
                write: limit_field(value, "writeLimitMbps")?,
                read: limit_field(value, "readLimitMbps")?,
            };
            if change == Change::default() {
                return Err(EngineError::argument(
                    "Serve control limits needs writeLimitMbps or readLimitMbps.",
                ));
            }
            Ok(Order::Limits {
                target: target()?,
                change,
            })
        }
        "cancel" => Ok(Order::Cancel { target: target()? }),
        other => Err(EngineError::new(
            UNKNOWN_CONTROL,
            format!("Unknown serve control: {other}"),
        )),
    }
}

fn parse_ask(line: &str) -> Ask {
    if line.trim().is_empty() {
        return Ask::Blank;
    }
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(problem) => {
            return Ask::Refused {
                id: Value::Null,
                error: EngineError::argument(format!("Bad serve request: {problem}")),
            }
        }
    };
    let id = value.get("id").cloned().unwrap_or(Value::Null);
    // Строка с `argv` — запрос, как раньше; без `argv`, но с `control` — управление.
    if value.get("argv").is_none() && value.get("control").is_some() {
        return match parse_control(&value) {
            Ok(order) => Ask::Control { id, order },
            Err(error) => Ask::Refused { id, error },
        };
    }
    let Some(items) = value.get("argv").and_then(Value::as_array) else {
        return Ask::Refused {
            id,
            error: EngineError::argument("Serve request needs an argv array."),
        };
    };
    match items
        .iter()
        .map(|item| item.as_str().map(str::to_owned))
        .collect::<Option<Vec<String>>>()
    {
        Some(argv) => Ask::Work { id, argv },
        None => Ask::Refused {
            id,
            error: EngineError::argument("Serve request argv must be strings."),
        },
    }
}

/// Приёмник отмены для записи архива: из хода берёт только проверку отмены.
/// Строки хода записи («prepare») запросам, у которых их раньше не было, не
/// прибавляются.
struct CancelOnly(Progress);

impl Activity for CancelOnly {
    fn check(&self) -> rage_rpf::Result<()> {
        self.0
            .checkpoint()
            .map_err(|_| rage_rpf::RpfError::Cancelled)
    }

    fn step(&self, _phase: &str, _done: u64, _total: u64) {}
}

/// Причина паники одной строкой.
fn crash_reason(cause: &(dyn std::any::Any + Send)) -> String {
    if let Some(text) = cause.downcast_ref::<&str>() {
        return (*text).to_owned();
    }
    cause
        .downcast_ref::<String>()
        .cloned()
        .unwrap_or_else(|| String::from("unknown failure"))
}

/// Выполняет запрос: строки хода идут как `{"id":…,"progress":…}`, затем ответ.
/// Запрос идёт со своими живыми потолками и своей отменой: контекст виден
/// только этому потоку, а паника исполнителя становится ответом, а не тишиной.
fn handle(
    outlet: &Arc<Outlet>,
    exec: &Executor,
    id: Value,
    argv: &[String],
    progress: &Progress,
    enrolled: Enrolled,
) {
    let _scope = enrolled.control.limits.enter();
    let _hook = activity::install(Arc::new(CancelOnly(progress.clone())));
    let guarded = AssertUnwindSafe(|| exec(argv, progress));
    let outcome = panic::catch_unwind(guarded).unwrap_or_else(|cause| {
        let error = EngineError::internal(crash_reason(cause.as_ref()));
        Outcome {
            line: response::failure(&error),
            exit_code: 1,
        }
    });
    // Из реестра запрос уходит раньше ответа: «нет такого запроса» — это «уже кончился».
    drop(enrolled);
    outlet.emit(&reply_frame(id, outcome.exit_code, &outcome.line));
}

/// Строка хода запроса с его `id`.
fn relay_for(outlet: &Arc<Outlet>, id: &Value) -> impl Fn(&str) + Send + Sync + 'static {
    let outlet = Arc::clone(outlet);
    let id = id.clone();
    move |line: &str| {
        let step = serde_json::from_str::<Value>(line)
            .ok()
            .and_then(|mut parsed| parsed.get_mut("progress").map(Value::take))
            .unwrap_or(Value::Null);
        outlet.emit(&ordered([("id", id.clone()), ("progress", step)]));
    }
}

/// Запускает запрос в отдельном потоке; без потока (нет ресурсов) ответ всё
/// равно будет один: отказом.
fn dispatch(
    outlet: &Arc<Outlet>,
    exec: &Arc<Executor>,
    ledger: &Arc<Ledger>,
    registry: &Arc<Registry>,
    id: Value,
    argv: Vec<String>,
) {
    let mark = ledger.enter();
    let spare_id = id.clone();
    let progress = Progress::with_sink(relay_for(outlet, &id));
    let control = Arc::new(Control {
        cancel: progress.cancel().clone(),
        limits: LiveLimits::new(),
    });
    let enrolled = registry.enroll(&id, control);
    let job = {
        let (outlet, exec) = (Arc::clone(outlet), Arc::clone(exec));
        move || {
            let _mark = mark;
            handle(&outlet, exec.as_ref(), id, &argv, &progress, enrolled);
        }
    };
    if let Err(cause) = thread::Builder::new().spawn(job) {
        let error = EngineError::internal(format!("Cannot start a request thread: {cause}"));
        outlet.emit(&reply_frame(spare_id, 1, &response::failure(&error)));
    }
}

fn controls_reply(id: Value, result: Result<(&str, Value), EngineError>) -> Value {
    match result {
        Ok((name, body)) => reply_frame(id, 0, &response::success(name, body)),
        Err(error) => reply_frame(id, 1, &response::failure(&error)),
    }
}

fn unknown_target() -> EngineError {
    EngineError::new(UNKNOWN_TARGET, "No running request has this id.")
}

/// Мегабайты потолка для ответа: `null`, если потолка нет.
fn shown(limit: Option<u64>) -> Value {
    limit.map_or(Value::Null, |bytes| json!(bytes / (1024 * 1024)))
}

/// Выполняет строку управления и отвечает на неё.
fn control(outlet: &Arc<Outlet>, registry: &Registry, id: Value, order: Order) {
    let result = match order {
        Order::Hello => Ok((
            "serve-hello",
            json!({
                "protocol": CONTROL_PROTOCOL,
                "controls": CONTROLS,
                "installCommands": INSTALL_COMMANDS,
                "installKeys": INSTALL_KEYS,
            }),
        )),
        Order::Limits { target, change } => {
            let running = registry.find(&target);
            if running.is_empty() {
                Err(unknown_target())
            } else {
                running
                    .iter()
                    .for_each(|request| request.limits.apply(change));
                let mut applied = Map::new();
                if let Some(write) = change.write {
                    applied.insert("writeLimitMbps".to_owned(), shown(write));
                }
                if let Some(read) = change.read {
                    applied.insert("readLimitMbps".to_owned(), shown(read));
                }
                Ok((
                    "serve-limits",
                    json!({ "target": target, "applied": Value::Object(applied) }),
                ))
            }
        }
        Order::Cancel { target } => {
            let running = registry.find(&target);
            if running.is_empty() {
                Err(unknown_target())
            } else {
                running.iter().for_each(|request| {
                    request.cancel.request();
                    // Спящая запись и ждущее чтение не должны задерживать остановку.
                    request.limits.halt();
                });
                Ok((
                    "serve-cancel",
                    json!({ "target": target, "requested": true }),
                ))
            }
        }
    };
    outlet.emit(&controls_reply(id, result));
}

/// Читает запросы, пока ввод не кончится, затем ждёт начатые.
fn pump(input: impl BufRead, outlet: &Arc<Outlet>, exec: &Arc<Executor>) {
    let ledger = Arc::new(Ledger::default());
    let registry = Arc::new(Registry::default());
    // Первая же строка не в UTF-8 (и любая ошибка чтения) обрывает чтение.
    for line in input.lines().map_while(Result::ok) {
        match parse_ask(&line) {
            Ask::Blank => {}
            Ask::Refused { id, error } => {
                outlet.emit(&reply_frame(id, 1, &response::failure(&error)));
            }
            Ask::Work { id, argv } => dispatch(outlet, exec, &ledger, &registry, id, argv),
            Ask::Control { id, order } => control(outlet, &registry, id, order),
        }
    }
    ledger.wait_until_drained();
}

/// Поднимает канал данных, если окружение его просит, и сообщает порт первой строкой.
fn announce_channel(outlet: &Outlet, config: Option<http::Config>) {
    let Some(config) = config else {
        return;
    };
    let report = match http::start(config) {
        Ok(port) => json!({ "port": port }),
        Err(cause) => json!({ "error": cause.to_string() }),
    };
    outlet.emit(&json!({ "http": report }));
}

/// Обслуживает запросы, пока `input` не кончится; ответы пишет в `output`.
pub fn serve(input: impl BufRead, output: impl Write + Send + 'static) {
    let outlet = Arc::new(Outlet::new(output));
    announce_channel(&outlet, http::Config::from_env());
    let exec: Arc<Executor> = Arc::new(crate::run);
    pump(input, &outlet, &exec);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::time::{Duration, Instant};

    /// Приёмник байтов, общий для теста и `serve`; считает сбросы.
    #[derive(Clone, Default)]
    struct Tap {
        bytes: Arc<Mutex<Vec<u8>>>,
        flushes: Arc<Mutex<usize>>,
    }

    impl Write for Tap {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.bytes.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            *self.flushes.lock().unwrap() += 1;
            Ok(())
        }
    }

    impl Tap {
        fn text(&self) -> String {
            String::from_utf8(self.bytes.lock().unwrap().clone()).unwrap()
        }

        fn lines(&self) -> Vec<String> {
            self.text().lines().map(str::to_owned).collect()
        }
    }

    /// Выход, у которого читатель уже закрыл трубу.
    struct Severed;

    impl Write for Severed {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::ErrorKind::BrokenPipe.into())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Err(std::io::ErrorKind::BrokenPipe.into())
        }
    }

    fn feed_bytes(input: &[u8]) -> Vec<String> {
        let tap = Tap::default();
        serve(Cursor::new(input.to_vec()), tap.clone());
        tap.lines()
    }

    fn feed(input: &str) -> Vec<String> {
        feed_bytes(input.as_bytes())
    }

    fn single(input: &str) -> String {
        let mut lines = feed(input);
        assert_eq!(lines.len(), 1, "{lines:?}");
        lines.remove(0)
    }

    fn refusal(id: &str, message: &str) -> String {
        format!(
            r#"{{"id":{id},"exitCode":1,"response":{{"ok":false,"error":{{"code":"ArgumentException","message":"{message}"}}}}}}"#
        )
    }

    #[test]
    fn empty_and_blank_input_print_nothing() {
        // Сл1, Сл2
        assert!(feed("").is_empty());
        assert!(feed("\n   \n\t\r\n\n").is_empty());
    }

    #[test]
    fn answers_like_a_process_and_keeps_the_id() {
        // Сл3, Сл4
        let line = single("{\"id\":1,\"argv\":[\"engine-info\"]}\n");
        let parsed: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(parsed["id"], json!(1));
        assert_eq!(parsed["exitCode"], json!(0));
        let direct = crate::run(&["engine-info".to_owned()], &Progress::silent());
        assert_eq!(
            parsed["response"],
            serde_json::from_str::<Value>(&direct.line).unwrap()
        );
        assert!(line.starts_with(r#"{"id":1,"exitCode":0,"response":{"ok":true,"command":"engine-info","result":{"name":"astral-engine""#));
        assert_eq!(
            single("{\"id\":\"b\",\"argv\":[\"no-such-command\"]}\n"),
            refusal("\"b\"", "Unsupported native command: no-such-command")
        );
    }

    #[test]
    fn broken_lines_are_answered_with_a_null_id() {
        // Сл5, Сл6, Сл30, Сл32, Сл33
        let cases = [
            (
                "not json",
                "Bad serve request: expected ident at line 1 column 2",
            ),
            (
                "cancel",
                "Bad serve request: expected value at line 1 column 1",
            ),
            (
                "\u{feff}{\"id\":1,\"argv\":[\"teleport\"]}",
                "Bad serve request: expected value at line 1 column 1",
            ),
            (
                "{\"id\":1,\"argv\":[\"teleport\"]} garbage",
                "Bad serve request: trailing characters at line 1 column 30",
            ),
            (
                "{\"id\":1,\"argv\":[\"x\"]}{\"id\":2,\"argv\":[\"y\"]}",
                "Bad serve request: trailing characters at line 1 column 22",
            ),
        ];
        for (input, message) in cases {
            assert_eq!(
                single(&format!("{input}\n")),
                refusal("null", message),
                "{input:?}"
            );
        }
    }

    #[test]
    fn json_that_is_not_a_request_is_refused_with_its_own_id() {
        // Сл7 – Сл16, Сл11, Сл12
        let needs = "Serve request needs an argv array.";
        let strings = "Serve request argv must be strings.";
        let cases = [
            ("{\"id\":3}", "3", needs),
            ("{\"id\":3,\"argv\":\"engine-info\"}", "3", needs),
            ("{\"id\":3,\"argv\":[\"engine-info\",5]}", "3", strings),
            ("{\"id\":3,\"argv\":[\"engine-info\",null]}", "3", strings),
            ("{\"id\":3,\"argv\":[[\"engine-info\"]]}", "3", strings),
            (
                "{\"id\":4,\"argv\":[]}",
                "4",
                "A native command is required.",
            ),
            (
                "{\"argv\":[\"teleport\"]}",
                "null",
                "Unsupported native command: teleport",
            ),
            ("[]", "null", needs),
            ("5", "null", needs),
            ("null", "null", needs),
            ("\"x\"", "null", needs),
        ];
        for (input, id, message) in cases {
            assert_eq!(
                single(&format!("{input}\n")),
                refusal(id, message),
                "{input:?}"
            );
        }
    }

    #[test]
    fn any_json_value_works_as_an_id() {
        // Сл17 – Сл26
        let unsupported = "Unsupported native command: teleport";
        let ids = [
            ("\"abc\"", "\"abc\""),
            ("1.5", "1.5"),
            ("1e2", "100.0"),
            ("123456789012345678901234567890", "1.2345678901234568e+29"),
            ("18446744073709551615", "18446744073709551615"),
            ("-5", "-5"),
            ("{\"a\":[1,2]}", "{\"a\":[1,2]}"),
            ("null", "null"),
            ("true", "true"),
            ("\"запрос\"", "\"запрос\""),
        ];
        for (sent, shown) in ids {
            let line = single(&format!("{{\"id\":{sent},\"argv\":[\"teleport\"]}}\n"));
            assert_eq!(line, refusal(shown, unsupported), "{sent}");
        }
    }

    #[test]
    fn line_endings_spacing_and_odd_fields() {
        // Сл27, Сл28, Сл29, Сл31, Сл34 – Сл37
        let expected = refusal("1", "Unsupported native command: teleport");
        assert_eq!(single("{\"id\":1,\"argv\":[\"teleport\"]}\r\n"), expected);
        assert_eq!(single("{\"id\":1,\"argv\":[\"teleport\"]}"), expected);
        assert_eq!(
            single("   {\"id\":1,\"argv\":[\"teleport\"]}   \n"),
            expected
        );
        assert_eq!(
            single("{\"id\":1,\"argv\":[\"teleport\"],\"extra\":[1,2],\"more\":{}}\n"),
            expected
        );
        assert_eq!(
            single("{\"id\":1,\"id\":2,\"argv\":[\"teleport\"],\"argv\":[\"x\"]}\n"),
            refusal("2", "Unsupported native command: x")
        );
        assert_eq!(
            single("{\"id\":1,\"argv\":[\"телепорт\"]}\n"),
            refusal("1", "Unsupported native command: телепорт")
        );
        assert_eq!(
            single("{\"id\":1,\"argv\":[\"serve\"]}\n"),
            refusal("1", "Unsupported native command: serve")
        );
        assert_eq!(
            single("{\"id\":1,\"argv\":[\"engine-info\",\"--a\"]}\n"),
            refusal("1", "A value is required for --a.")
        );
    }

    #[test]
    fn output_is_utf8_not_ascii_escaped() {
        // Сл41
        let tap = Tap::default();
        serve(
            Cursor::new("{\"id\":\"я\",\"argv\":[\"ё\"]}\n".as_bytes().to_vec()),
            tap.clone(),
        );
        let bytes = tap.bytes.lock().unwrap().clone();
        let expected = "{\"id\":\"я\",\"exitCode\":1,\"response\":{\"ok\":false,\"error\":{\"code\":\"ArgumentException\",\"message\":\"Unsupported native command: ё\"}}}\n";
        assert_eq!(bytes, expected.as_bytes());
        assert!(bytes.windows(2).any(|pair| pair == [0xd1, 0x8f]));
    }

    #[test]
    fn invalid_utf8_stops_reading_for_good() {
        // Сл38, Сл39
        let good = b"{\"id\":1,\"argv\":[\"teleport\"]}\n";
        let mut stopped = vec![0xff, 0xfe, b'\n'];
        stopped.extend_from_slice(good);
        assert!(feed_bytes(&stopped).is_empty());
        let mut middle = good.to_vec();
        middle.extend_from_slice(&[0xff, 0xfe, b'\n']);
        middle.extend_from_slice(good);
        assert_eq!(
            feed_bytes(&middle),
            vec![refusal("1", "Unsupported native command: teleport")]
        );
    }

    #[test]
    fn a_very_long_line_has_no_limit() {
        // Сл40
        let name = "x".repeat(5 * 1024 * 1024);
        let line = single(&format!("{{\"id\":\"long\",\"argv\":[\"{name}\"]}}\n"));
        assert_eq!(line.len() + 1, 5_243_009, "с LF в конце");
        assert!(line.starts_with(
            r#"{"id":"long","exitCode":1,"response":{"ok":false,"error":{"code":"ArgumentException","#
        ));
    }

    #[test]
    fn many_requests_each_get_exactly_one_reply() {
        // Сл-П4, Сл-П5
        for count in [64usize, 500] {
            let mut input = String::new();
            for id in 0..count {
                input.push_str(&format!("{{\"id\":{id},\"argv\":[\"engine-info\"]}}\n"));
            }
            let lines = feed(&input);
            assert_eq!(lines.len(), count);
            let mut seen = vec![0u32; count];
            for line in &lines {
                let parsed: Value = serde_json::from_str(line).unwrap();
                assert_eq!(parsed["exitCode"], json!(0));
                seen[parsed["id"].as_u64().unwrap() as usize] += 1;
            }
            assert!(seen.iter().all(|&times| times == 1));
        }
    }

    fn scripted(
        exec: impl Fn(&[String], &Progress) -> Outcome + Send + Sync + 'static,
    ) -> Arc<Executor> {
        Arc::new(exec)
    }

    fn pump_text(input: &str, exec: &Arc<Executor>) -> Tap {
        let tap = Tap::default();
        let outlet = Arc::new(Outlet::new(tap.clone()));
        pump(Cursor::new(input.as_bytes().to_vec()), &outlet, exec);
        tap
    }

    fn canned(name: &str) -> Outcome {
        Outcome {
            line: format!(r#"{{"ok":true,"command":"{name}","result":null}}"#),
            exit_code: 0,
        }
    }

    #[test]
    fn a_slow_request_does_not_hold_back_a_fast_one() {
        // Сл-П1, Сл-П6
        let started = Instant::now();
        let exec = scripted(|argv, _| {
            if argv[0] == "slow" {
                thread::sleep(Duration::from_millis(400));
            }
            canned(&argv[0])
        });
        let tap = pump_text(
            "{\"id\":\"slow\",\"argv\":[\"slow\"]}\n{\"id\":\"fast\",\"argv\":[\"fast\"]}\n",
            &exec,
        );
        let lines = tap.lines();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with(r#"{"id":"fast""#), "{lines:?}");
        assert!(lines[1].starts_with(r#"{"id":"slow""#), "{lines:?}");
        assert!(
            started.elapsed() >= Duration::from_millis(400),
            "serve ждёт начатые запросы"
        );
    }

    #[test]
    fn progress_lines_carry_the_id_and_precede_the_answer() {
        // Сл-П2, Сл-П3, С-3, С-15
        let exec = scripted(|argv, progress| {
            progress.report_bytes("read", 0, 12288);
            progress.report_bytes("read", 12288, 12288);
            canned(&argv[0])
        });
        let tap = pump_text("{\"id\":\"probe\",\"argv\":[\"p\"]}\n", &exec);
        assert_eq!(
            tap.lines(),
            vec![
                r#"{"id":"probe","progress":{"phase":"read","copiedBytes":0,"totalBytes":12288}}"#.to_owned(),
                r#"{"id":"probe","progress":{"phase":"read","copiedBytes":12288,"totalBytes":12288}}"#.to_owned(),
                r#"{"id":"probe","exitCode":0,"response":{"ok":true,"command":"p","result":null}}"#.to_owned(),
            ]
        );
    }

    #[test]
    fn a_progress_line_without_the_key_becomes_null() {
        // С-15
        let exec = scripted(|argv, progress| {
            // Приёмник сам выдаёт строки `Progress`; здесь проверяем разбор напрямую.
            progress.report("prepare");
            canned(&argv[0])
        });
        let tap = pump_text("{\"id\":7,\"argv\":[\"p\"]}\n", &exec);
        assert_eq!(
            tap.lines()[0],
            r#"{"id":7,"progress":{"phase":"prepare","copiedBytes":0,"totalBytes":0}}"#
        );
    }

    #[test]
    fn every_line_is_flushed_when_written() {
        // Сл-П7
        let tap = Tap::default();
        serve(
            Cursor::new(b"{\"id\":1,\"argv\":[\"teleport\"]}\nnot json\n".to_vec()),
            tap.clone(),
        );
        assert_eq!(tap.lines().len(), 2);
        assert_eq!(*tap.flushes.lock().unwrap(), 2);
    }

    #[test]
    fn a_closed_output_loses_answers_but_not_the_process() {
        // Гл18
        serve(
            Cursor::new(b"{\"id\":1,\"argv\":[\"teleport\"]}\nnot json\n".to_vec()),
            Severed,
        );
    }

    #[test]
    fn lines_from_parallel_requests_never_interleave() {
        // С-1
        let exec = scripted(|argv, progress| {
            for step in 0..20u64 {
                progress.report_bytes("copy", step, 20);
            }
            canned(&argv[0])
        });
        let mut input = String::new();
        for id in 0..40 {
            input.push_str(&format!("{{\"id\":{id},\"argv\":[\"p\"]}}\n"));
        }
        let tap = pump_text(&input, &exec);
        for line in tap.lines() {
            let parsed: Value = serde_json::from_str(&line).unwrap();
            assert!(parsed.get("id").is_some());
        }
    }

    #[test]
    fn channel_announcement_has_the_port_or_stays_silent() {
        // С-6, Нк21
        let tap = Tap::default();
        let outlet = Outlet::new(tap.clone());
        announce_channel(&outlet, None);
        assert!(tap.text().is_empty());
        let dir = tempfile::tempdir().unwrap();
        let config = http::Config {
            token: "0123456789abcdef0123456789abcdef-token".to_owned(),
            origin: None,
            assets: dir.path().to_path_buf(),
        };
        announce_channel(&outlet, Some(config));
        let lines = tap.lines();
        assert_eq!(lines.len(), 1);
        let parsed: Value = serde_json::from_str(&lines[0]).unwrap();
        let port = parsed["http"]["port"].as_u64().unwrap();
        assert!(port > 0 && port < 65536);
        assert_eq!(parsed.as_object().unwrap().len(), 1);
        assert_eq!(parsed["http"].as_object().unwrap().len(), 1);
        assert!(std::net::TcpStream::connect(("127.0.0.1", port as u16)).is_ok());
        assert_eq!(lines[0], format!("{{\"http\":{{\"port\":{port}}}}}"));
    }

    // ----- строки управления -----

    use std::io::Read;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;

    const MIB: u64 = 1024 * 1024;

    /// Ввод, который отдаёт строки по мере того, как тест их присылает.
    struct Feed {
        chunks: mpsc::Receiver<Vec<u8>>,
        pending: Vec<u8>,
        at: usize,
    }

    impl Read for Feed {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.at >= self.pending.len() {
                match self.chunks.recv() {
                    Ok(chunk) => {
                        self.pending = chunk;
                        self.at = 0;
                    }
                    Err(_) => return Ok(0),
                }
            }
            let take = buf.len().min(self.pending.len() - self.at);
            buf[..take].copy_from_slice(&self.pending[self.at..self.at + take]);
            self.at += take;
            Ok(take)
        }
    }

    /// Живой `serve` на подменном исполнителе: строки шлются по одной.
    struct Session {
        send: Option<mpsc::Sender<Vec<u8>>>,
        tap: Tap,
        worker: Option<thread::JoinHandle<()>>,
    }

    impl Session {
        fn start(exec: Arc<Executor>) -> Session {
            let (send, chunks) = mpsc::channel();
            let tap = Tap::default();
            let worker = {
                let tap = tap.clone();
                thread::spawn(move || {
                    let outlet = Arc::new(Outlet::new(tap));
                    let feed = Feed {
                        chunks,
                        pending: Vec::new(),
                        at: 0,
                    };
                    pump(std::io::BufReader::new(feed), &outlet, &exec);
                })
            };
            Session {
                send: Some(send),
                tap,
                worker: Some(worker),
            }
        }

        fn say(&self, line: &str) {
            let text = format!("{line}\n");
            self.send.as_ref().unwrap().send(text.into_bytes()).unwrap();
        }

        /// Ждёт, пока в выводе появится ответ с этим `id` (и телом `response`).
        fn reply(&self, id: &Value) -> Value {
            let started = Instant::now();
            loop {
                let found = self
                    .tap
                    .lines()
                    .iter()
                    .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                    .find(|frame| frame.get("response").is_some() && frame["id"] == *id);
                if let Some(frame) = found {
                    return frame;
                }
                assert!(
                    started.elapsed() < Duration::from_secs(10),
                    "нет ответа на {id}: {:?}",
                    self.tap.lines()
                );
                thread::sleep(Duration::from_millis(5));
            }
        }

        fn silent_for(&self, id: &Value, span: Duration) -> bool {
            thread::sleep(span);
            !self
                .tap
                .lines()
                .iter()
                .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                .any(|frame| frame.get("response").is_some() && frame["id"] == *id)
        }

        fn finish(mut self) {
            drop(self.send.take());
            self.worker.take().unwrap().join().unwrap();
        }
    }

    fn cancelled_outcome() -> Outcome {
        Outcome {
            line: response::failure(&EngineError::cancelled()),
            exit_code: 130,
        }
    }

    /// Работа, которая идёт, пока ей не скажут «отмена»: проверяет точку остановки.
    fn spin_until_cancelled(progress: &Progress) -> Outcome {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(8) {
            if progress.checkpoint().is_err() {
                return cancelled_outcome();
            }
            thread::sleep(Duration::from_millis(2));
        }
        canned("timeout")
    }

    #[test]
    fn hello_names_the_controls_and_the_install_commands() {
        let line = single("{\"id\":9,\"control\":\"hello\"}\n");
        let parsed: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(parsed["id"], json!(9));
        assert_eq!(parsed["exitCode"], json!(0));
        assert_eq!(parsed["response"]["ok"], json!(true));
        assert_eq!(parsed["response"]["command"], json!("serve-hello"));
        let result = &parsed["response"]["result"];
        assert_eq!(result["protocol"], json!(CONTROL_PROTOCOL));
        assert_eq!(result["controls"], json!(["hello", "limits", "cancel"]));
        assert_eq!(
            result["installCommands"],
            json!(["compose-rpf", "install-rpf-patch", "probe-rpf"])
        );
        // что движок исполняет в блоке `install`: приложение зовёт удержание только по этому ключу
        assert_eq!(
            result["installKeys"],
            json!(["hold", "commit", "discard", "expectEntries", "expectDlcList", "keepKey"])
        );
        // Без своего id ответ идёт с null, как отказ без id.
        let bare: Value = serde_json::from_str(&single("{\"control\":\"hello\"}\n")).unwrap();
        assert_eq!(bare["id"], Value::Null);
        assert_eq!(bare["response"]["ok"], json!(true));
    }

    fn failure_of(id: &str, code: &str, message: &str) -> String {
        format!(
            r#"{{"id":{id},"exitCode":1,"response":{{"ok":false,"error":{{"code":"{code}","message":"{message}"}}}}}}"#
        )
    }

    #[test]
    fn broken_and_unknown_controls_are_answered_not_fatal() {
        let target = "Serve control needs a target.";
        let whole = "must be a non-negative whole number.";
        let cases = [
            (
                r#"{"id":1,"control":"limits","target":99,"writeLimitMbps":5}"#,
                failure_of("1", UNKNOWN_TARGET, "No running request has this id."),
            ),
            (
                r#"{"id":2,"control":"cancel","target":99}"#,
                failure_of("2", UNKNOWN_TARGET, "No running request has this id."),
            ),
            (
                r#"{"id":3,"control":"fly","target":1}"#,
                failure_of("3", UNKNOWN_CONTROL, "Unknown serve control: fly"),
            ),
            (
                r#"{"id":4,"control":"limits","writeLimitMbps":5}"#,
                failure_of("4", "ArgumentException", target),
            ),
            (
                r#"{"id":5,"control":"cancel"}"#,
                failure_of("5", "ArgumentException", target),
            ),
            (
                r#"{"id":6,"control":"limits","target":1}"#,
                failure_of(
                    "6",
                    "ArgumentException",
                    "Serve control limits needs writeLimitMbps or readLimitMbps.",
                ),
            ),
            (
                r#"{"id":7,"control":"limits","target":1,"writeLimitMbps":-3}"#,
                failure_of("7", "ArgumentException", &format!("writeLimitMbps {whole}")),
            ),
            (
                r#"{"id":8,"control":"limits","target":1,"readLimitMbps":"fast"}"#,
                failure_of("8", "ArgumentException", &format!("readLimitMbps {whole}")),
            ),
            (
                r#"{"id":9,"control":5}"#,
                failure_of("9", "ArgumentException", "Serve control must be a string."),
            ),
            (
                r#"{"id":10,"control":"limits","target":1,"writeLimitMbps":1.5}"#,
                failure_of(
                    "10",
                    "ArgumentException",
                    &format!("writeLimitMbps {whole}"),
                ),
            ),
        ];
        for (input, expected) in cases {
            assert_eq!(single(&format!("{input}\n")), expected, "{input}");
        }
        // Такие строки не мешают соседним запросам.
        let lines = feed(
            "{\"id\":1,\"control\":\"fly\"}\n{\"id\":2,\"argv\":[\"engine-info\"]}\n{\"id\":3,\"control\":\"cancel\",\"target\":2}\n",
        );
        assert_eq!(lines.len(), 3, "{lines:?}");
        let info = lines
            .iter()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .find(|frame| frame["id"] == json!(2))
            .unwrap();
        assert_eq!(info["exitCode"], json!(0));
    }

    #[test]
    fn a_line_with_argv_stays_a_request_even_with_a_control_key() {
        let line = single("{\"id\":1,\"control\":\"hello\",\"argv\":[\"teleport\"]}\n");
        assert_eq!(
            line,
            refusal("1", "Unsupported native command: teleport"),
            "argv важнее control: прежние строки работают как раньше"
        );
    }

    #[test]
    fn limits_reach_only_the_request_they_name() {
        let release = Arc::new(AtomicBool::new(false));
        let exec = {
            let release = Arc::clone(&release);
            scripted(move |argv, _| {
                let options = crate::args::Options::parse(&argv[2..]).unwrap();
                crate::disk::apply_read_limit(&options);
                while !release.load(Ordering::Acquire) {
                    thread::sleep(Duration::from_millis(2));
                }
                let live = crate::disk::current_live().expect("запрос идёт со своим контекстом");
                let write = live.write_view().ceiling;
                let read = rage_rpf::read_pace::current().limit();
                Outcome {
                    line: response::success(&argv[1], json!({"write": write, "read": read})),
                    exit_code: 0,
                }
            })
        };
        let session = Session::start(exec);
        session.say(r#"{"id":"a","argv":["hold","a","--read-limit-mbps","2"]}"#);
        session.say(r#"{"id":"b","argv":["hold","b","--read-limit-mbps","6"]}"#);
        session.say(
            r#"{"id":11,"control":"limits","target":"a","writeLimitMbps":7,"readLimitMbps":3}"#,
        );
        let ack = session.reply(&json!(11));
        assert_eq!(ack["exitCode"], json!(0));
        assert_eq!(ack["response"]["command"], json!("serve-limits"));
        assert_eq!(ack["response"]["result"]["target"], json!("a"));
        assert_eq!(
            ack["response"]["result"]["applied"],
            json!({"writeLimitMbps": 7, "readLimitMbps": 3})
        );
        release.store(true, Ordering::Release);
        let a = session.reply(&json!("a"));
        let b = session.reply(&json!("b"));
        assert_eq!(
            a["response"]["result"],
            json!({"write": 7 * MIB, "read": 3 * MIB})
        );
        assert_eq!(
            b["response"]["result"],
            json!({"write": Value::Null, "read": 6 * MIB}),
            "чужой запрос потолков не получил"
        );
        session.finish();
    }

    #[test]
    fn a_zero_in_a_control_lifts_the_ceiling_and_the_ack_says_so() {
        let release = Arc::new(AtomicBool::new(false));
        let exec = {
            let release = Arc::clone(&release);
            scripted(move |argv, _| {
                let options = crate::args::Options::parse(&argv[2..]).unwrap();
                crate::disk::apply_read_limit(&options);
                while !release.load(Ordering::Acquire) {
                    thread::sleep(Duration::from_millis(2));
                }
                Outcome {
                    line: response::success(
                        &argv[1],
                        json!({"read": rage_rpf::read_pace::current().limit()}),
                    ),
                    exit_code: 0,
                }
            })
        };
        let session = Session::start(exec);
        session.say(r#"{"id":1,"argv":["hold","x","--read-limit-mbps","2"]}"#);
        session.say(r#"{"id":2,"control":"limits","target":1,"readLimitMbps":0}"#);
        let ack = session.reply(&json!(2));
        assert_eq!(
            ack["response"]["result"]["applied"],
            json!({"readLimitMbps": null})
        );
        release.store(true, Ordering::Release);
        let done = session.reply(&json!(1));
        assert_eq!(done["response"]["result"], json!({"read": Value::Null}));
        session.finish();
    }

    #[test]
    fn a_control_line_right_behind_its_request_still_finds_it() {
        let exec = scripted(|_, progress| spin_until_cancelled(progress));
        let tap = pump_text(
            "{\"id\":1,\"argv\":[\"wait\"]}\n{\"id\":2,\"control\":\"cancel\",\"target\":1}\n",
            &exec,
        );
        let frames: Vec<Value> = tap
            .lines()
            .iter()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(frames.len(), 2, "{frames:?}");
        let ack = frames.iter().find(|frame| frame["id"] == json!(2)).unwrap();
        assert_eq!(ack["response"]["result"]["requested"], json!(true));
        let done = frames.iter().find(|frame| frame["id"] == json!(1)).unwrap();
        assert_eq!(done["exitCode"], json!(130));
        assert_eq!(done["response"]["error"]["code"], json!("Cancelled"));
    }

    #[test]
    fn cancel_stops_its_target_and_leaves_the_other_running() {
        let exec = scripted(|argv, progress| match argv[0].as_str() {
            "quick" => canned("quick"),
            _ => spin_until_cancelled(progress),
        });
        let session = Session::start(exec);
        session.say(r#"{"id":1,"argv":["wait"]}"#);
        session.say(r#"{"id":2,"argv":["wait"]}"#);
        session.say(r#"{"id":3,"control":"cancel","target":1}"#);
        let first = session.reply(&json!(1));
        assert_eq!(first["exitCode"], json!(130));
        assert_eq!(first["response"]["error"]["code"], json!("Cancelled"));
        assert!(
            session.silent_for(&json!(2), Duration::from_millis(150)),
            "чужая отмена второй запрос не остановила"
        );
        // Резидент жив и принимает новые запросы.
        session.say(r#"{"id":4,"argv":["quick"]}"#);
        assert_eq!(session.reply(&json!(4))["exitCode"], json!(0));
        session.say(r#"{"id":5,"control":"cancel","target":2}"#);
        assert_eq!(session.reply(&json!(2))["exitCode"], json!(130));
        session.finish();
    }

    #[test]
    fn a_finished_request_is_no_longer_a_target() {
        let exec = scripted(|argv, _| canned(&argv[0]));
        let session = Session::start(exec);
        session.say(r#"{"id":1,"argv":["quick"]}"#);
        assert_eq!(session.reply(&json!(1))["exitCode"], json!(0));
        session.say(r#"{"id":2,"control":"cancel","target":1}"#);
        let late = session.reply(&json!(2));
        assert_eq!(late["exitCode"], json!(1));
        assert_eq!(late["response"]["error"]["code"], json!(UNKNOWN_TARGET));
        session.say(r#"{"id":3,"control":"limits","target":1,"writeLimitMbps":1}"#);
        assert_eq!(
            session.reply(&json!(3))["response"]["error"]["code"],
            json!(UNKNOWN_TARGET)
        );
        session.finish();
    }

    #[test]
    fn any_json_value_can_be_a_control_target() {
        for (id, target) in [("\"abc\"", "\"abc\""), ("7", "7"), ("null", "null")] {
            let exec = scripted(|_, progress| spin_until_cancelled(progress));
            let session = Session::start(exec);
            session.say(&format!("{{\"id\":{id},\"argv\":[\"wait\"]}}"));
            session.say(&format!(
                "{{\"id\":\"c\",\"control\":\"cancel\",\"target\":{target}}}"
            ));
            let done = session.reply(&serde_json::from_str(id).unwrap());
            assert_eq!(done["exitCode"], json!(130), "{id}");
            session.finish();
        }
    }

    #[test]
    fn the_write_hook_sees_cancel_the_way_a_running_archive_write_does() {
        // Запись архива спрашивает отмену через `activity::check` своего потока.
        let exec = scripted(|_, _| {
            let started = Instant::now();
            while started.elapsed() < Duration::from_secs(8) {
                if activity::check().is_err() {
                    return cancelled_outcome();
                }
                thread::sleep(Duration::from_millis(2));
            }
            canned("timeout")
        });
        let session = Session::start(exec);
        session.say(r#"{"id":1,"argv":["writer"]}"#);
        session.say(r#"{"id":2,"control":"cancel","target":1}"#);
        let done = session.reply(&json!(1));
        assert_eq!(done["exitCode"], json!(130));
        // Следующий запрос идёт без отмены прежнего.
        session.say(r#"{"id":3,"argv":["writer"]}"#);
        assert!(session.silent_for(&json!(3), Duration::from_millis(150)));
        session.say(r#"{"id":4,"control":"cancel","target":3}"#);
        assert_eq!(session.reply(&json!(3))["exitCode"], json!(130));
        session.finish();
    }

    #[test]
    fn a_panic_in_the_executor_is_one_reply_and_serve_keeps_working() {
        let exec = scripted(|argv, _| match argv[0].as_str() {
            "boom" => panic!("boom-text"),
            "boom-owned" => std::panic::panic_any(String::from("boom-owned-text")),
            "boom-odd" => std::panic::panic_any(5u8),
            other => canned(other),
        });
        let session = Session::start(exec);
        session.say(r#"{"id":1,"argv":["boom"]}"#);
        session.say(r#"{"id":2,"argv":["boom-owned"]}"#);
        session.say(r#"{"id":3,"argv":["boom-odd"]}"#);
        session.say(r#"{"id":4,"argv":["fine"]}"#);
        for (id, message) in [
            (1, "boom-text"),
            (2, "boom-owned-text"),
            (3, "unknown failure"),
        ] {
            let reply = session.reply(&json!(id));
            assert_eq!(reply["exitCode"], json!(1));
            assert_eq!(reply["response"]["error"]["code"], json!("InternalError"));
            assert_eq!(reply["response"]["error"]["message"], json!(message));
        }
        assert_eq!(session.reply(&json!(4))["exitCode"], json!(0));
        // Запись упавшего запроса из реестра ушла: управление его уже не находит.
        session.say(r#"{"id":5,"control":"cancel","target":1}"#);
        assert_eq!(
            session.reply(&json!(5))["response"]["error"]["code"],
            json!(UNKNOWN_TARGET)
        );
        session.finish();
    }

    #[test]
    fn requests_with_equal_ids_both_get_the_control() {
        let exec = scripted(|_, progress| spin_until_cancelled(progress));
        let tap = pump_text(
            "{\"id\":1,\"argv\":[\"wait\"]}\n{\"id\":1,\"argv\":[\"wait\"]}\n{\"id\":2,\"control\":\"cancel\",\"target\":1}\n",
            &exec,
        );
        let cancelled = tap
            .lines()
            .iter()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .filter(|frame| frame["id"] == json!(1))
            .filter(|frame| frame["exitCode"] == json!(130))
            .count();
        assert_eq!(cancelled, 2);
    }

    /// Запрос, который пишет по 4 МиБ под потолком из своих параметров.
    fn paced_writer() -> Arc<Executor> {
        scripted(|argv, progress| {
            let options = crate::args::Options::parse(&argv[1..]).unwrap();
            let _pacing = progress.pace(crate::disk::WritePacer::from_options(&options));
            let started = Instant::now();
            while started.elapsed() < Duration::from_secs(20) {
                progress.wrote(4 * MIB);
                if progress.checkpoint().is_err() {
                    return cancelled_outcome();
                }
            }
            canned("timeout")
        })
    }

    #[test]
    fn cancel_wakes_a_sleeping_writer_instead_of_waiting_out_its_ceiling() {
        // 4 МиБ при 1 МиБ/с: четыре секунды сна на каждый кусок.
        let session = Session::start(paced_writer());
        session.say(r#"{"id":1,"argv":["write","--write-limit-mbps","1"]}"#);
        thread::sleep(Duration::from_millis(300));
        let asked = Instant::now();
        session.say(r#"{"id":2,"control":"cancel","target":1}"#);
        let done = session.reply(&json!(1));
        assert_eq!(done["exitCode"], json!(130));
        assert!(
            asked.elapsed() < Duration::from_millis(1500),
            "отмена ждала {:?}",
            asked.elapsed()
        );
        session.finish();
    }

    #[test]
    fn a_lifted_ceiling_reaches_a_writer_that_is_asleep() {
        let exec = scripted(|argv, progress| {
            let options = crate::args::Options::parse(&argv[1..]).unwrap();
            let _pacing = progress.pace(crate::disk::WritePacer::from_options(&options));
            let started = Instant::now();
            progress.wrote(8 * MIB);
            canned(&format!("{}", started.elapsed().as_millis()))
        });
        let session = Session::start(exec);
        session.say(r#"{"id":1,"argv":["write","--write-limit-mbps","1"]}"#);
        thread::sleep(Duration::from_millis(300));
        let asked = Instant::now();
        session.say(r#"{"id":2,"control":"limits","target":1,"writeLimitMbps":0}"#);
        let done = session.reply(&json!(1));
        assert_eq!(done["exitCode"], json!(0));
        assert!(
            asked.elapsed() < Duration::from_millis(1500),
            "после смены потолка ждали ещё {:?}",
            asked.elapsed()
        );
        session.finish();
    }

    #[test]
    fn two_writers_keep_their_own_ceilings() {
        let session = Session::start(paced_writer());
        session.say(r#"{"id":"slow","argv":["write","--write-limit-mbps","1"]}"#);
        session.say(r#"{"id":"fast","argv":["write"]}"#);
        // Быстрый пишет без потолка и шагает мимо контрольных точек, медленный спит;
        // отмена медленного быстрого не трогает.
        thread::sleep(Duration::from_millis(300));
        session.say(r#"{"id":"c1","control":"cancel","target":"slow"}"#);
        assert_eq!(session.reply(&json!("slow"))["exitCode"], json!(130));
        assert!(session.silent_for(&json!("fast"), Duration::from_millis(200)));
        session.say(r#"{"id":"c2","control":"cancel","target":"fast"}"#);
        assert_eq!(session.reply(&json!("fast"))["exitCode"], json!(130));
        session.finish();
    }

    #[cfg(windows)]
    #[allow(unsafe_code)]
    fn thread_priority() -> i32 {
        extern "system" {
            fn GetCurrentThread() -> isize;
            fn GetThreadPriority(thread: isize) -> i32;
        }
        // SAFETY: псевдодескриптор текущего потока.
        unsafe { GetThreadPriority(GetCurrentThread()) }
    }

    #[cfg(windows)]
    #[test]
    fn background_priority_of_the_writer_follows_the_ceiling_set_through_serve() {
        // Запись под потолком идёт в фоне (−4), без тормоза — обычным приоритетом (0), с потолком снова фоном.
        let seen = Arc::new(Mutex::new(Vec::<i32>::new()));
        let release = Arc::new(AtomicBool::new(false));
        let exec = {
            let (seen, release) = (Arc::clone(&seen), Arc::clone(&release));
            scripted(move |argv, progress| {
                let options = crate::args::Options::parse(&argv[1..]).unwrap();
                let _pacing = progress.pace(crate::disk::WritePacer::from_options(&options));
                while !release.load(Ordering::Acquire) {
                    progress.wrote(1);
                    let now = thread_priority();
                    let mut log = seen.lock().unwrap();
                    if log.last() != Some(&now) {
                        log.push(now);
                    }
                    drop(log);
                    thread::sleep(Duration::from_millis(2));
                }
                canned("done")
            })
        };
        let wait_for = |wanted: &[i32]| {
            let started = Instant::now();
            while seen.lock().unwrap().as_slice() != wanted {
                assert!(
                    started.elapsed() < Duration::from_secs(5),
                    "ждали {wanted:?}, видели {:?}",
                    seen.lock().unwrap()
                );
                thread::sleep(Duration::from_millis(5));
            }
        };
        let session = Session::start(exec);
        session.say(r#"{"id":1,"argv":["write","--write-limit-mbps","500"]}"#);
        wait_for(&[-4]);
        session.say(r#"{"id":2,"control":"limits","target":1,"writeLimitMbps":0}"#);
        wait_for(&[-4, 0]);
        session.say(r#"{"id":3,"control":"limits","target":1,"writeLimitMbps":500}"#);
        wait_for(&[-4, 0, -4]);
        release.store(true, Ordering::Release);
        assert_eq!(session.reply(&json!(1))["exitCode"], json!(0));
        session.finish();
    }

    #[test]
    fn progress_of_a_cancelled_request_still_carries_its_id() {
        let exec = scripted(|_, progress| {
            progress.report_bytes("compose", 1, 10);
            spin_until_cancelled(progress)
        });
        let tap = pump_text(
            "{\"id\":\"w\",\"argv\":[\"wait\"]}\n{\"control\":\"cancel\",\"target\":\"w\"}\n",
            &exec,
        );
        let lines = tap.lines();
        assert!(
            lines
                .iter()
                .any(|line| line.starts_with(r#"{"id":"w","progress":{"phase":"compose""#)),
            "{lines:?}"
        );
        assert!(lines
            .iter()
            .any(|line| line.starts_with(r#"{"id":"w","exitCode":130"#)));
    }
}
