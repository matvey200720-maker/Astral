//! Точки обрыва для стендов: убить процесс или задержать его в названном месте.
//!
//! В поставку это не входит: без признака `failpoints` функция [`hit`]
//! пустая, окружение не читается и вызов убирает компилятор.

#[cfg(feature = "failpoints")]
mod armed {
    use std::time::Duration;
    use std::{env, process, thread};

    /// Переменная с именем точки, в которой процесс должен умереть.
    const KILL_VAR: &str = "ASTRAL_ENGINE_FAILPOINT";
    /// Переменная вида `<точка>=<миллисекунды>`: постоять в точке.
    const PAUSE_VAR: &str = "ASTRAL_ENGINE_FAILPOINT_SLEEP";
    /// Код выхода «убитого» процесса.
    const KILLED: i32 = 137;

    /// Что окружение требует от процесса в конкретной точке.
    #[derive(Debug, PartialEq, Eq)]
    pub(super) enum Order {
        Ignore,
        Die,
        Wait { shown: String, millis: u64 },
    }

    /// Решение по значениям обеих переменных; сначала обрыв, потом пауза.
    pub(super) fn decide(point: &str, kill: Option<&str>, pause: Option<&str>) -> Order {
        if kill == Some(point) {
            return Order::Die;
        }
        match pause.and_then(|text| text.split_once('=')) {
            Some((name, amount)) if name == point => Order::Wait {
                shown: amount.to_owned(),
                millis: amount.parse().unwrap_or(0),
            },
            _ => Order::Ignore,
        }
    }

    pub(super) fn obey(point: &str) {
        // Значение не в UTF-8 считается незаданным.
        let kill = env::var(KILL_VAR).ok();
        let pause = env::var(PAUSE_VAR).ok();
        match decide(point, kill.as_deref(), pause.as_deref()) {
            Order::Ignore => {}
            Order::Die => {
                // Печать намеренно обычная: при закрытом stderr она паникует.
                eprintln!("[failpoint] {point}");
                process::exit(KILLED);
            }
            Order::Wait { shown, millis } => {
                eprintln!("[failpoint] {point}: пауза {shown} мс");
                thread::sleep(Duration::from_millis(millis));
            }
        }
    }
}

/// Точка обрыва с именем `name`: без признака `failpoints` не делает ничего.
#[cfg(feature = "failpoints")]
pub fn hit(name: &str) {
    armed::obey(name);
}

/// Точка обрыва с именем `name`: без признака `failpoints` не делает ничего.
#[cfg(not(feature = "failpoints"))]
pub fn hit(_name: &str) {}

#[cfg(test)]
mod tests {
    #[cfg(feature = "failpoints")]
    mod with_feature {
        use super::super::armed::{decide, Order};
        use super::super::hit;
        use std::process::{Command, Output};
        use std::time::Instant;

        const POINT_VAR: &str = "ASTRAL_FP_TEST_POINT";
        const BACK_MARK: &str = "back-after-ms=";

        fn wait(shown: &str, millis: u64) -> Order {
            Order::Wait {
                shown: shown.to_owned(),
                millis,
            }
        }

        const FIRST: &str = "install-after-manifest";

        #[test]
        fn kill_variable_matches_exactly() {
            // Тб1 – Тб10
            assert_eq!(decide(FIRST, None, None), Order::Ignore);
            assert_eq!(decide(FIRST, Some(FIRST), None), Order::Die);
            assert_eq!(
                decide("install-after-first-swap", Some(FIRST), None),
                Order::Ignore
            );
            for point in [
                "restore-after-link",
                "restore-after-swap",
                "install-after-first-swap",
            ] {
                assert_eq!(decide(point, Some(point), None), Order::Die);
            }
            assert_eq!(
                decide(FIRST, Some("Install-After-Manifest"), None),
                Order::Ignore
            );
            assert_eq!(
                decide(FIRST, Some(" install-after-manifest"), None),
                Order::Ignore
            );
            assert_eq!(decide(FIRST, Some(""), None), Order::Ignore);
            assert_eq!(decide("", Some(""), None), Order::Die);
        }

        #[test]
        fn pause_variable_is_split_at_the_first_equals_sign() {
            // Тб11 – Тб21, Тб24, Тб25
            let pause = |text: &str| decide(FIRST, None, Some(text));
            assert_eq!(pause("install-after-manifest=600"), wait("600", 600));
            assert_eq!(pause("install-after-manifest=0"), wait("0", 0));
            assert_eq!(pause("install-after-manifest=abc"), wait("abc", 0));
            assert_eq!(pause("install-after-manifest="), wait("", 0));
            assert_eq!(pause("install-after-manifest=-5"), wait("-5", 0));
            assert_eq!(pause("install-after-manifest= 500 "), wait(" 500 ", 0));
            assert_eq!(pause("install-after-manifest=+500"), wait("+500", 500));
            assert_eq!(pause("install-after-manifest=1=2"), wait("1=2", 0));
            assert_eq!(pause("install-after-manifest"), Order::Ignore);
            assert_eq!(pause("restore-after-link=600"), Order::Ignore);
            assert_eq!(pause("INSTALL-AFTER-MANIFEST=600"), Order::Ignore);
            assert_eq!(decide("a", None, Some("a=b=600")), wait("b=600", 0));
            assert_eq!(
                pause("install-after-manifest=99999999999999999999"),
                wait("99999999999999999999", 0)
            );
        }

        #[test]
        fn kill_wins_over_pause() {
            // Тб22, Тб23
            let both = decide(FIRST, Some(FIRST), Some("install-after-manifest=600"));
            assert_eq!(both, Order::Die);
            let other = decide(
                FIRST,
                Some("restore-after-swap"),
                Some("install-after-manifest=600"),
            );
            assert_eq!(other, wait("600", 600));
        }

        /// Тело дочернего прогона: без переменной ничего не делает.
        #[test]
        fn probe_child_entry() {
            let Ok(point) = std::env::var(POINT_VAR) else {
                return;
            };
            let started = Instant::now();
            hit(&point);
            println!("{BACK_MARK}{}", started.elapsed().as_millis());
        }

        fn run_child(point: &str, env: &[(&str, &str)]) -> (Output, Option<u128>) {
            let mut command = Command::new(std::env::current_exe().unwrap());
            command
                .args([
                    "--exact",
                    "failpoint::tests::with_feature::probe_child_entry",
                ])
                .args(["--nocapture", "--test-threads=1"])
                .env_remove("ASTRAL_ENGINE_FAILPOINT")
                .env_remove("ASTRAL_ENGINE_FAILPOINT_SLEEP")
                .env(POINT_VAR, point);
            for (name, value) in env {
                command.env(name, value);
            }
            let output = command.output().unwrap();
            let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
            // Харнес печатает «test имя ... » перед выводом теста: метка может стоять в середине строки.
            let waited = stdout.lines().find_map(|line| {
                let at = line.find(BACK_MARK)?;
                let digits: String = line[at + BACK_MARK.len()..]
                    .chars()
                    .take_while(char::is_ascii_digit)
                    .collect();
                digits.parse().ok()
            });
            (output, waited)
        }

        fn stderr_of(output: &Output) -> String {
            String::from_utf8_lossy(&output.stderr).into_owned()
        }

        #[test]
        fn process_dies_with_137_and_a_stderr_line() {
            // Тб2, Тб4 – Тб6, Тб10, Тб22
            for point in [
                FIRST,
                "restore-after-link",
                "restore-after-swap",
                "install-after-first-swap",
            ] {
                let (output, back) = run_child(point, &[("ASTRAL_ENGINE_FAILPOINT", point)]);
                assert_eq!(output.status.code(), Some(137), "{point}");
                assert!(back.is_none(), "после обрыва управление не возвращается");
                assert!(stderr_of(&output).contains(&format!("[failpoint] {point}\n")));
            }
            let (output, back) = run_child(
                FIRST,
                &[
                    ("ASTRAL_ENGINE_FAILPOINT", FIRST),
                    (
                        "ASTRAL_ENGINE_FAILPOINT_SLEEP",
                        "install-after-manifest=600",
                    ),
                ],
            );
            assert_eq!(output.status.code(), Some(137));
            assert!(back.is_none());
        }

        #[test]
        fn a_closed_stderr_turns_the_kill_into_a_panic() {
            // Т-8, Тб-П1: печать падает паникой раньше, чем процесс успевает умереть с 137
            for env in [
                ("ASTRAL_ENGINE_FAILPOINT", FIRST),
                ("ASTRAL_ENGINE_FAILPOINT_SLEEP", "install-after-manifest=0"),
            ] {
                let mut child = Command::new(std::env::current_exe().unwrap())
                    .args([
                        "--exact",
                        "failpoint::tests::with_feature::probe_child_entry",
                    ])
                    .args(["--nocapture", "--test-threads=1"])
                    .env_remove("ASTRAL_ENGINE_FAILPOINT")
                    .env_remove("ASTRAL_ENGINE_FAILPOINT_SLEEP")
                    .env(POINT_VAR, FIRST)
                    .env(env.0, env.1)
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
                    .unwrap();
                drop(child.stderr.take());
                let output = child.wait_with_output().unwrap();
                assert_eq!(output.status.code(), Some(101), "{env:?}");
                assert!(!String::from_utf8_lossy(&output.stdout).contains(BACK_MARK));
            }
        }

        #[test]
        fn a_nonmatching_or_missing_variable_changes_nothing() {
            // Тб1, Тб3, Тб7 – Тб9, Тб19 – Тб21
            let cases: [&[(&str, &str)]; 6] = [
                &[],
                &[("ASTRAL_ENGINE_FAILPOINT", "install-after-first-swap")],
                &[("ASTRAL_ENGINE_FAILPOINT", "Install-After-Manifest")],
                &[("ASTRAL_ENGINE_FAILPOINT", "")],
                &[("ASTRAL_ENGINE_FAILPOINT_SLEEP", "install-after-manifest")],
                &[("ASTRAL_ENGINE_FAILPOINT_SLEEP", "restore-after-link=600")],
            ];
            for env in cases {
                let (output, back) = run_child(FIRST, env);
                assert_eq!(output.status.code(), Some(0), "{env:?}");
                assert!(back.unwrap() < 400);
                assert!(!stderr_of(&output).contains("[failpoint]"), "{env:?}");
            }
        }

        #[test]
        fn pause_prints_its_line_and_waits() {
            // Тб11 – Тб13, Тб17, Тб23
            let (output, back) = run_child(
                FIRST,
                &[(
                    "ASTRAL_ENGINE_FAILPOINT_SLEEP",
                    "install-after-manifest=600",
                )],
            );
            assert_eq!(output.status.code(), Some(0));
            assert!(back.unwrap() >= 550, "ждал {:?} мс", back);
            assert!(
                stderr_of(&output).contains("[failpoint] install-after-manifest: пауза 600 мс\n")
            );

            let (output, back) = run_child(
                FIRST,
                &[
                    ("ASTRAL_ENGINE_FAILPOINT", "restore-after-swap"),
                    (
                        "ASTRAL_ENGINE_FAILPOINT_SLEEP",
                        "install-after-manifest=+500",
                    ),
                ],
            );
            assert_eq!(output.status.code(), Some(0));
            assert!(back.unwrap() >= 450);
            assert!(
                stderr_of(&output).contains("[failpoint] install-after-manifest: пауза +500 мс\n")
            );

            let (output, back) = run_child(
                FIRST,
                &[(
                    "ASTRAL_ENGINE_FAILPOINT_SLEEP",
                    "install-after-manifest=abc",
                )],
            );
            assert!(back.unwrap() < 400);
            assert!(
                stderr_of(&output).contains("[failpoint] install-after-manifest: пауза abc мс\n")
            );
        }
    }

    #[cfg(not(feature = "failpoints"))]
    #[test]
    fn without_the_feature_the_point_is_inert() {
        // Тб-01 – Тб-06: окружение не читается и ничего не происходит.
        super::hit("install-after-manifest");
    }
}
