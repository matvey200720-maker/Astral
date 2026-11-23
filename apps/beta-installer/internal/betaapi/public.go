package betaapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// routePublic — открытый ответ о доступе: без входа и без подписи ключа установщика.
const routePublic = "/api/v1/public/beta"

// publicCallTimeout — срок одной пробы: окно ждёт её перед первым экраном.
const publicCallTimeout = 4 * time.Second

// PublicStatus — то, что установщик берёт из открытого ответа сервера.
// Closed — указатель: «ключа нет в ответе» отличается от «закрыто».
type PublicStatus struct {
	Closed *bool `json:"closed"`
}

// Open: сервер явно ответил «закрыто: нет» — установка идёт без кода.
func (p *PublicStatus) Open() bool { return p != nil && p.Closed != nil && !*p.Closed }

// ClosedExplicitly: сервер явно ответил «закрыто: да».
func (p *PublicStatus) ClosedExplicitly() bool { return p != nil && p.Closed != nil && *p.Closed }

// PublicBeta спрашивает сервер, закрыта ли бета. Запрос обычный GET без доказательства
// DPoP: маршрут открытый. Любой сбой (сеть, не тот ответ) — ошибка, решение «не знаем» на вызывающем.
func (c *Client) PublicBeta(ctx context.Context) (*PublicStatus, error) {
	bounded, release := context.WithTimeout(ctx, publicCallTimeout)
	defer release()
	target := c.Origin + routePublic
	req, err := http.NewRequestWithContext(bounded, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.UserAgent)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, &NetError{Err: err}
	}
	c.syncClock(resp)
	if resp.StatusCode >= 300 {
		return nil, call{cl: c, method: http.MethodGet, target: target}.problem(resp)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxProblemBody))
	if err != nil {
		return nil, &NetError{Err: err}
	}
	var out PublicStatus
	if err := json.NewDecoder(bytes.NewReader(raw)).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}
