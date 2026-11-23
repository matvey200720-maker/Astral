package install

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/app"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/betaapi"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/bridge"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/manifest"
)

const (
	defaultPollEvery = 3 * time.Second
	pollGrace        = 5 * time.Second
	backoffFloor     = 3 * time.Second
	backoffCeiling   = 15 * time.Second

	pakMagic   = "ASTRPAK1"
	pakMinSize = 48

	licenseVersion = 1

	pollStatusPending = "pending"
	codeActExpired    = "BETA_ACTIVATION_EXPIRED"
)

var (
	errNotBase64 = errors.New("not base64")

	errPakHead  = errors.New("astral-web.pak does not start with " + pakMagic)
	errPakShort = errors.New("astral-web.pak is too short")

	errLicNoSig      = errors.New("no signature part")
	errLicSigForm    = errors.New("bad signature encoding")
	errLicSigBad     = errors.New("signature does not verify")
	errLicBody64     = errors.New("payload is not base64url")
	errLicBodyJSON   = errors.New("payload is not json")
	errLicOtherAct   = errors.New("license belongs to another activation")
	errLicOtherMachn = errors.New("license belongs to another machine")
)

// activation — одна активация, которую человек подтверждает в браузере.
type activation struct {
	id      string
	machine string
	// Ветка, которую просим у сервера в Poll; выбор другой ветки меняет её под замком раннера.
	ask        layout.Channel
	until      time.Time // срок подтверждения по часам ПК
	interval   int       // интервал сервера, секунды
	userCode   string
	confirmURL string
	confirmed  *confirmation
}

// confirmation — проверенный релиз из подтверждённого ответа.
type confirmation struct {
	serial   string
	account  string
	rel      betaapi.Release
	channels []betaapi.ChannelInfo
	license  string
	bind     string
	mfBytes  []byte
	mf       *manifest.Manifest
}

// channelItem — пункт «channels» для экрана.
type channelItem struct {
	Channel    string  `json:"channel"`
	InstallDir string  `json:"installDir"`
	Version    *string `json:"version"`
}

// confirmedBody — тело события activation.confirmed; поля идут по алфавиту ключей.
type confirmedBody struct {
	AccountName   any                   `json:"accountName"`
	Channel       string                `json:"channel"`
	Channels      []channelItem         `json:"channels"`
	DownloadBytes int64                 `json:"downloadBytes"`
	FreeBytes     any                   `json:"freeBytes"`
	HintChannel   any                   `json:"hintChannel"`
	Installed     []app.InstalledBranch `json:"installed"`
	RequiredBytes uint64                `json:"requiredBytes"`
	Serial        string                `json:"serial"`
	Version       string                `json:"version"`
}

// pollEvery — шаг опроса: настройка раннера, иначе секунды сервера; меньше секунды — три секунды.
func pollEvery(override time.Duration, serverSecs int) time.Duration {
	if override > 0 {
		return override
	}
	if secs := time.Duration(serverSecs) * time.Second; secs >= time.Second {
		return secs
	}
	return defaultPollEvery
}

func retryAfterOf(err error) time.Duration {
	var served *betaapi.APIError
	if errors.As(err, &served) {
		return served.RetryAfter
	}
	return 0
}

// pauseAfter — пауза после сбоя опроса: настройка, затем Retry-After сервера как есть,
// затем удвоение текущего шага в пределах от 3 до 15 секунд.
func pauseAfter(override time.Duration, err error, current time.Duration) time.Duration {
	if override > 0 {
		return override
	}
	if wait := retryAfterOf(err); wait > 0 {
		return wait
	}
	return min(backoffCeiling, max(backoffFloor, 2*current))
}

// sleepOrDone ждёт d; false — контекст отменён раньше.
func sleepOrDone(ctx context.Context, d time.Duration) bool {
	tick := time.NewTimer(d)
	defer tick.Stop()
	select {
	case <-tick.C:
		return ctx.Err() == nil
	case <-ctx.Done():
		return false
	}
}

// dropActivation сбрасывает активацию, если она ещё текущая; сообщает, была ли она текущей.
func (r *Runner) dropActivation(act *activation) (wasCurrent bool) {
	r.locked(func(s *session) {
		if wasCurrent = s.act == act; wasCurrent {
			s.act = nil
		}
	})
	return wasCurrent
}

// poller ведёт опрос одной активации.
type poller struct {
	r       *Runner
	act     *activation
	step    time.Duration
	offline bool
}

// pollFaults — как реагировать на ошибку запроса; первая подошедшая побеждает, остальное — отказ.
var pollFaults = []struct {
	hit    func(error) bool
	handle func(*poller, error) bool
}{
	{func(err error) bool { return betaapi.Code(err) == codeActExpired }, (*poller).onExpired},
	{betaapi.IsTransient, (*poller).onOutage},
}

// pollLoop опрашивает сервер, пока активацию не подтвердят, не отменят или она не истечёт.
func (r *Runner) pollLoop(ctx context.Context, act *activation) {
	defer r.group.Done()
	p := &poller{r: r, act: act, step: pollEvery(r.cfg.PollInterval, act.interval)}
	for sleepOrDone(ctx, p.step) && p.round(ctx) {
	}
}

// round — один оборот; false — опрос кончился.
func (p *poller) round(ctx context.Context) bool {
	if time.Now().After(p.act.until.Add(pollGrace)) {
		return p.onExpired(nil)
	}
	ask := peek(p.r, func(*session) layout.Channel { return p.act.ask })
	resp, err := p.r.api.Poll(ctx, p.act.id, p.act.machine, string(ask))
	if ctx.Err() != nil {
		return false
	}
	if err != nil {
		return p.onFault(err)
	}
	return p.onReply(resp)
}

func (p *poller) onFault(err error) bool {
	for _, fault := range pollFaults {
		if fault.hit(err) {
			return fault.handle(p, err)
		}
	}
	// Об отказе опроса активации, которую уже заменили другой, странице знать незачем.
	if p.r.dropActivation(p.act) {
		p.r.fail("poll", betaapi.ToBridgeError(err))
	}
	return false
}

func (p *poller) onExpired(error) bool {
	// Истекла активация, которую уже заменили другой: это не «истекла», страница ждёт новую.
	if p.r.dropActivation(p.act) {
		p.r.rt.Emit("activation.expired", map[string]any{})
	}
	return false
}

func (p *poller) onOutage(err error) bool {
	if !p.offline {
		p.offline = true
		p.r.rt.Emit("connection", map[string]any{"online": false})
	}
	p.step = pauseAfter(p.r.cfg.PollInterval, err, p.step)
	return true
}

func (p *poller) onReply(resp *betaapi.PollResponse) bool {
	if p.offline {
		p.offline = false
		p.r.rt.Emit("connection", map[string]any{"online": true})
	}
	if resp.Status == pollStatusPending {
		p.step = pollEvery(p.r.cfg.PollInterval, resp.Interval)
		return true
	}
	p.r.acceptConfirmation(p.act, resp)
	return false
}

func channelNames(list []betaapi.ChannelInfo) string {
	names := make([]string, 0, len(list))
	for _, c := range list {
		names = append(names, c.Channel)
	}
	return strings.Join(names, " ")
}

// optional превращает пустую строку в null.
func optional(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// acceptConfirmation проверяет релиз, записывает подтверждение и сообщает странице.
func (r *Runner) acceptConfirmation(act *activation, resp *betaapi.PollResponse) {
	cf, berr := r.vetPoll(resp, act.id, act.machine)
	if berr != nil {
		r.dropActivation(act)
		r.fail("poll", berr)
		return
	}
	superseded := peek(r, func(s *session) bool {
		if s.act == act {
			act.confirmed = cf
		}
		return s.act != act
	})
	if superseded {
		return
	}
	body := r.confirmedPayload(cf)
	r.log.Printf("activation confirmed: version %s, channel %s, offered [%s]", cf.rel.Version, cf.rel.Channel, channelNames(cf.channels))
	r.rt.Emit("activation.confirmed", body)
}

// confirmedPayload собирает тело события activation.confirmed.
func (r *Runner) confirmedPayload(cf *confirmation) confirmedBody {
	relCh, _ := layout.Parse(cf.rel.Channel)
	return confirmedBody{
		AccountName:   optional(cf.account),
		Channel:       cf.rel.Channel,
		Channels:      r.channelItems(cf.rel, cf.channels),
		DownloadBytes: cf.rel.Pak.Bytes + cf.rel.Base.Bytes,
		FreeBytes:     r.freeOver(r.rootFor(relCh)),
		HintChannel:   optional(string(r.cfg.Hint)),
		Installed:     app.InstalledList(r.installedNow()),
		RequiredBytes: requiredBytes(cf.rel),
		Serial:        cf.serial,
		Version:       cf.rel.Version,
	}
}

func rankOf(name string) int {
	ch, _ := layout.Parse(name)
	return ch.Rank()
}

// offeredBranches оставляет в списке сервера известные ветки без повторов, по старшинству.
func offeredBranches(list betaapi.ChannelList) []betaapi.ChannelInfo {
	var known []betaapi.ChannelInfo
	for _, item := range list {
		if ch, ok := layout.Parse(item.Channel); ok {
			known = append(known, betaapi.ChannelInfo{Channel: string(ch), Version: item.Version})
		}
	}
	slices.SortStableFunc(known, func(a, b betaapi.ChannelInfo) int { return rankOf(a.Channel) - rankOf(b.Channel) })
	return slices.CompactFunc(known, func(a, b betaapi.ChannelInfo) bool { return a.Channel == b.Channel })
}

// channelItems — пункты списка веток: ветка релиза есть всегда, порядок alpha, beta, release.
func (r *Runner) channelItems(rel betaapi.Release, offered []betaapi.ChannelInfo) []channelItem {
	versions := map[layout.Channel]string{}
	for _, o := range offered {
		if ch, ok := layout.Parse(o.Channel); ok {
			versions[ch] = o.Version
		}
	}
	if relCh, ok := layout.Parse(rel.Channel); ok && versions[relCh] == "" {
		versions[relCh] = rel.Version
	}
	items := func(yield func(channelItem) bool) {
		for _, ch := range layout.All {
			version, present := versions[ch]
			if !present {
				continue
			}
			item := channelItem{Channel: string(ch), InstallDir: r.rootFor(ch)}
			if version != "" {
				item.Version = &version
			}
			if !yield(item) {
				return
			}
		}
	}
	return slices.AppendSeq([]channelItem{}, items)
}

// freeOver — место у ближайшей существующей папки над путём; nil, если система не ответила.
func (r *Runner) freeOver(path string) any {
	if free := r.freePtr(path); free != nil {
		return *free
	}
	return nil
}

// decodeManifest читает base64 манифеста в одном из четырёх видов.
func decodeManifest(text string) ([]byte, error) {
	text = strings.TrimSpace(text)
	var raw []byte
	alphabets := []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding}
	decoded := slices.ContainsFunc(alphabets, func(enc *base64.Encoding) bool {
		out, err := enc.DecodeString(text)
		raw = out
		return err == nil
	})
	if !decoded {
		return nil, errNotBase64
	}
	return raw, nil
}

func isHex64(s string) bool {
	raw, err := hex.DecodeString(s)
	return err == nil && len(raw) == 32
}

func anyOf(conditions ...bool) bool { return slices.Contains(conditions, true) }

func refuse(code, format string, args ...any) *bridge.Error {
	return bridge.Errf(code, false, format, args...)
}

// vetting — проверка одного ответа сервера; правила идут по очереди и накапливают результат.
type vetting struct {
	r       *Runner
	resp    *betaapi.PollResponse
	actID   string
	machine string
	doc     []byte
	mf      *manifest.Manifest
}

type vetRule func(v *vetting) *bridge.Error

var vetRules = []vetRule{
	(*vetting).needComplete,
	(*vetting).needKnownChannel,
	(*vetting).needManifest,
	(*vetting).readDoc,
	(*vetting).checkSignature,
	(*vetting).checkMatch,
	(*vetting).checkLicense,
}

func (v *vetting) needComplete() *bridge.Error {
	rel := v.resp.Release
	if rel == nil || anyOf(rel.Base.URL == "", rel.Pak.URL == "", rel.Base.Bytes <= 0,
		!isHex64(rel.Base.SHA256), v.resp.License == "", v.resp.BindSecret == "") {
		return refuse("INSTALL_FAILED", "%s", "incomplete release in the poll response")
	}
	return nil
}

func (v *vetting) needKnownChannel() *bridge.Error {
	if _, ok := layout.Parse(v.resp.Release.Channel); !ok {
		return refuse("INSTALL_FAILED", "unsupported_channel: %q", v.resp.Release.Channel)
	}
	return nil
}

func (v *vetting) needManifest() *bridge.Error {
	if anyOf(v.resp.Release.Manifest == "", v.resp.Release.ManifestSig == "") {
		return refuse("INSTALL_FAILED", "manifest_missing")
	}
	return nil
}

func (v *vetting) readDoc() *bridge.Error {
	doc, err := decodeManifest(v.resp.Release.Manifest)
	if err != nil {
		return refuse("INSTALL_FAILED", "manifest is not base64")
	}
	v.doc = doc
	return nil
}

func (v *vetting) checkSignature() *bridge.Error {
	cfg, sig := v.r.cfg, v.resp.Release.ManifestSig
	ways := []struct {
		usable bool
		check  func() (*manifest.Manifest, error)
	}{
		{cfg.Keys.Len() > 0, func() (*manifest.Manifest, error) { return manifest.Verify(cfg.Keys, v.doc, sig) }},
		{cfg.AllowUnsigned, func() (*manifest.Manifest, error) {
			v.r.log.Printf("WARNING: the manifest signature is NOT verified (dev build without release keys)")
			return manifest.Parse(v.doc)
		}},
		{true, func() (*manifest.Manifest, error) { return nil, manifest.ErrNoKeys }},
	}
	for _, way := range ways {
		if !way.usable {
			continue
		}
		mf, err := way.check()
		if err != nil {
			return refuse("SIGNATURE_INVALID", "%s", err.Error())
		}
		v.mf = mf
		return nil
	}
	return nil
}

func (v *vetting) checkMatch() *bridge.Error {
	rel := v.resp.Release
	err := v.mf.Matches(manifest.Release{Version: rel.Version, Channel: rel.Channel, BaseSHA256: rel.Base.SHA256, BaseBytes: rel.Base.Bytes})
	if err != nil {
		return refuse("SIGNATURE_INVALID", "%s", err.Error())
	}
	return nil
}

func (v *vetting) checkLicense() *bridge.Error {
	if len(v.r.cfg.LicensePub) == 0 {
		return nil
	}
	if err := matchLicense(v.resp.License, v.r.cfg.LicensePub, v.actID, v.machine); err != nil {
		return refuse("SIGNATURE_INVALID", "license: %s", err.Error())
	}
	return nil
}

// vetPoll проверяет релиз из ответа сервера: полнота, подпись манифеста, совпадение, лицензия.
func (r *Runner) vetPoll(resp *betaapi.PollResponse, actID, machine string) (*confirmation, *bridge.Error) {
	v := &vetting{r: r, resp: resp, actID: actID, machine: machine}
	for _, rule := range vetRules {
		if berr := rule(v); berr != nil {
			return nil, berr
		}
	}
	return &confirmation{
		serial:   resp.Serial,
		account:  resp.Account.DisplayName,
		rel:      *resp.Release,
		channels: offeredBranches(resp.Channels),
		license:  resp.License,
		bind:     resp.BindSecret,
		mfBytes:  v.doc,
		mf:       v.mf,
	}, nil
}

// failIf превращает условие в ошибку.
func failIf(cond bool, err error) error {
	if cond {
		return err
	}
	return nil
}

// readLicense проверяет подпись лицензии (она стоит на тексте первой части) и достаёт aid и mh.
func readLicense(license string, pub ed25519.PublicKey) (aid, mh string, err error) {
	var (
		body, sigText string
		sig, raw      []byte
		doc           struct {
			V   int    `json:"v"`
			AID string `json:"aid"`
			MH  string `json:"mh"`
		}
	)
	stages := []func() error{
		func() error {
			var cut bool
			body, sigText, cut = strings.Cut(license, ".")
			return failIf(!cut, errLicNoSig)
		},
		func() (e error) {
			sig, e = base64.RawURLEncoding.DecodeString(sigText)
			return failIf(e != nil || len(sig) != ed25519.SignatureSize, errLicSigForm)
		},
		func() error { return failIf(!ed25519.Verify(pub, []byte(body), sig), errLicSigBad) },
		func() (e error) {
			raw, e = base64.RawURLEncoding.DecodeString(body)
			return failIf(e != nil, errLicBody64)
		},
		func() error { return failIf(json.Unmarshal(raw, &doc) != nil, errLicBodyJSON) },
		func() error {
			if doc.V == licenseVersion {
				return nil
			}
			return fmt.Errorf("unsupported license version %d", doc.V)
		},
	}
	for _, stage := range stages {
		if err = stage(); err != nil {
			return "", "", err
		}
	}
	return doc.AID, doc.MH, nil
}

// matchLicense: подпись верна, лицензия выдана этой активации и этой машине (активация проверяется раньше).
func matchLicense(license string, pub ed25519.PublicKey, actID, machine string) error {
	aid, mh, err := readLicense(license, pub)
	if err != nil {
		return err
	}
	return cmpOwner(aid != actID, errLicOtherAct, mh != machine, errLicOtherMachn)
}

func cmpOwner(wrongAct bool, actErr error, wrongMachine bool, machineErr error) error {
	if err := failIf(wrongAct, actErr); err != nil {
		return err
	}
	return failIf(wrongMachine, machineErr)
}

// VerifyLicenseMachine: nil, если подпись лицензии верна и она выдана этой машине.
func VerifyLicenseMachine(license string, pub ed25519.PublicKey, machine string) error {
	_, mh, err := readLicense(license, pub)
	if err == nil {
		err = failIf(mh != machine, errLicOtherMachn)
	}
	return err
}

// CheckPakHeader: nil, если файл начинается с ASTRPAK1 и не короче 48 байт.
func CheckPakHeader(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	head := make([]byte, len(pakMagic))
	if n, _ := f.ReadAt(head, 0); n < len(head) || string(head) != pakMagic {
		return errPakHead
	}
	info, err := f.Stat()
	if err != nil {
		return err
	}
	return failIf(info.Size() < pakMinSize, errPakShort)
}
