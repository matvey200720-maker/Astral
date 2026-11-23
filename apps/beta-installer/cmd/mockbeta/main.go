// Команда mockbeta поднимает подставной сервер беты (internal/betatest) как
// отдельную программу: им проверяют настоящий AstralBetaSetup.exe там, где
// настоящего сервера нет. Установщик запускают с --api-origin <адрес>.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/betatest"
)

// settings — разобранные флаги.
type settings struct {
	urlFile        string
	confirmAfter   int
	sizeMB         int
	files          int
	slowMS         int
	scenario       string
	ttl            time.Duration
	alpha          bool
	stagingDir     string
	stagingChannel string
}

// readSettings разбирает флаги; ошибка или -h завершают процесс сами.
func readSettings(args []string) settings {
	var c settings
	fs := flag.NewFlagSet(os.Args[0], flag.ExitOnError)
	fs.StringVar(&c.urlFile, "url-file", "", "куда записать адрес сервера")
	fs.IntVar(&c.confirmAfter, "confirm-after", 3, "сколько опросов до автоподтверждения (0 — не подтверждать само)")
	fs.IntVar(&c.sizeMB, "size", 30, "размер base.zip, МБ")
	fs.IntVar(&c.files, "files", 0, "сколько мелких файлов добавить в base.zip (распаковка идёт дольше, ход виден)")
	fs.IntVar(&c.slowMS, "slow", 20, "пауза на каждые 32 КБ раздачи base, мс")
	fs.StringVar(&c.scenario, "scenario", "happy", "happy | open | slow | cut | corrupt | ticket | complete-fail | outage | denied | expired")
	fs.DurationVar(&c.ttl, "ttl", 10*time.Minute, "через сколько завершиться самому")
	fs.BoolVar(&c.alpha, "alpha", false, "добавить ветку alpha: poll отдаёт channels [alpha, beta] и релиз выбранной ветки")
	fs.StringVar(&c.stagingDir, "staging-dir", "", "положить в эту папку staging ветки -staging-channel (manifest.json, manifest.sig, base.zip, astral-web.pak), как кладёт лаунчер")
	fs.StringVar(&c.stagingChannel, "staging-channel", "alpha", "ветка для -staging-dir")
	_ = fs.Parse(args)
	if c.sizeMB < 0 {
		fmt.Fprintf(fs.Output(), "invalid value %d for flag -size: must not be negative\n", c.sizeMB)
		fs.Usage()
		os.Exit(2)
	}
	return c
}

// logTB подменяет *testing.T: отказ сервера завершает процесс, очистка
// запоминается и не вызывается, поэтому сервер живёт до конца процесса.
type logTB struct {
	mu       sync.Mutex
	cleanups []func()
}

func (*logTB) Helper()                           {}
func (*logTB) Fatal(args ...any)                 { log.Fatal(args...) }
func (*logTB) Fatalf(format string, args ...any) { log.Fatalf(format, args...) }
func (t *logTB) Cleanup(f func()) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.cleanups = append(t.cleanups, f)
}

func main() {
	c := readSettings(os.Args[1:])
	srv := newMock(c)
	if c.alpha {
		addAlpha(srv)
	}
	if c.stagingDir != "" {
		if err := srv.Staging(c.stagingChannel, c.stagingDir); err != nil {
			log.Fatal(err)
		}
	}
	// Неизвестный сценарий замечаем до печати адреса.
	recipe, known := scenarios[c.scenario]
	if !known {
		log.Fatalf("неизвестный сценарий %q", c.scenario)
	}
	recipe(srv)

	announce(c, srv.URL)
	time.Sleep(c.ttl)
}

// newMock поднимает сервер с релизом beta, собранным по флагам.
func newMock(c settings) *betatest.Server {
	srv := betatest.NewServer(&logTB{})
	srv.AutoConfirmAfter = c.confirmAfter
	srv.SlowBase = time.Duration(c.slowMS) * time.Millisecond
	srv.Rel.BaseZip = betatest.MakeZip(betaFiles(c.sizeMB, c.files))
	srv.Rebuild()
	return srv
}

// announce печатает адрес и, если просили, записывает его в файл (без
// перевода строки), затем сообщает всё в stderr.
func announce(c settings, url string) {
	fmt.Println(url)
	if c.urlFile != "" {
		if err := os.WriteFile(c.urlFile, []byte(url), 0o644); err != nil {
			log.Fatal(err)
		}
	}
	fmt.Fprintf(os.Stderr, "mockbeta: %s (сценарий %s), код для проверки: %s\n", url, c.scenario, betatest.ValidCode)
}

// betaFiles — состав base.zip ветки beta: exe, большой несжимаемый файл
// размером sizeMB мегабайт и files мелких файлов из общего блока шума.
func betaFiles(sizeMB, files int) map[string][]byte {
	set := map[string][]byte{
		"Astral.exe":         []byte("MZ-mock-astral"),
		"resources/app.asar": betatest.Noise(sizeMB<<20, 3),
	}
	if files > 0 {
		block := betatest.Noise(1<<20, 5)
		for n := range files {
			from := n * 37 % (len(block) - 9000)
			set[fmt.Sprintf("resources/pack%03d/f%05d.dat", n%200, n)] = block[from : from+6000+n%2500]
		}
	}
	return set
}

// addAlpha добавляет релиз alpha (на основе релиза по умолчанию) и ставит
// его первым в списке веток: пустой poll получает alpha.
func addAlpha(srv *betatest.Server) {
	srv.AddRelease(betatest.Release{
		Channel:  "alpha",
		Version:  "0.9.1-alpha.1",
		Sequence: srv.Rel.Sequence,
		Pak:      append([]byte("ASTRPAK1"), betatest.Noise(30000, 9)...),
		BaseZip: betatest.MakeZip(map[string][]byte{
			"Astral.exe":         []byte("MZ-mock-astral-alpha"),
			"resources/app.asar": betatest.Noise(2<<20, 7),
		}),
	})
	srv.SetChannels("alpha", "beta")
}

// scenarios — что каждый сценарий делает с сервером.
var scenarios = map[string]func(*betatest.Server){
	"happy":         func(*betatest.Server) {},
	"open":          func(s *betatest.Server) { s.OpenAccess = true },
	"slow":          func(s *betatest.Server) { s.SlowBase = 250 * time.Millisecond },
	"cut":           func(s *betatest.Server) { s.CutBase(3<<20, 2) },
	"corrupt":       func(s *betatest.Server) { s.CorruptBase = true },
	"ticket":        func(s *betatest.Server) { s.TicketBudget = 1 },
	"complete-fail": func(s *betatest.Server) { s.FailComplete(6) },
	"outage":        func(s *betatest.Server) { s.FailPoll(6, 503, "BETA_UNAVAILABLE") },
	"denied":        func(s *betatest.Server) { verdictAfter(s, 5*time.Second, s.Deny) },
	"expired":       func(s *betatest.Server) { verdictAfter(s, 4*time.Second, s.ExpireActivation) },
}

// verdictAfter отключает автоподтверждение; после первого успешного start
// ждёт delay и выносит приговор.
func verdictAfter(srv *betatest.Server, delay time.Duration, verdict func()) {
	srv.AutoConfirmAfter = 0
	go func() {
		poll := time.NewTicker(50 * time.Millisecond)
		defer poll.Stop()
		for range poll.C {
			if srv.Stats().Starts > 0 {
				break
			}
		}
		time.Sleep(delay)
		verdict()
	}()
}
