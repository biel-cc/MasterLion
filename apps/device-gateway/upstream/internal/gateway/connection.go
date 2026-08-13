package gateway

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"
)

type connection struct {
	att            DeviceAttachment
	authTimer      *time.Timer
	authTimedOut   bool
	authTimeout    time.Duration
	claimedUserID  string
	heartbeatTimer *time.Timer
	hub            *hub
	server         *Server
	stateMu        sync.RWMutex
	writeMu        sync.Mutex
	ws             *wsConn
}

func (c *connection) writeJSON(v any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	payload, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.ws.writeJSON(payload)
}

func (c *connection) writeText(payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.ws.writeJSON(payload)
}

func (c *connection) close(code int, reason string) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.ws.writeClose(code, reason)
	_ = c.ws.close()
}

func (c *connection) startAuthTimer() {
	c.authTimer = time.AfterFunc(c.authTimeout, func() {
		if !c.markAuthTimedOut() {
			return
		}
		slog.Warn(
			"device gateway authentication timed out",
			"connectionId", c.att.ConnectionID,
			"deviceId", c.att.DeviceID,
		)
		_ = c.writeJSON(map[string]string{"reason": "Authentication timeout", "type": "auth_failed"})
		c.close(wsClosePolicy, "Authentication timeout")
		c.remove()
	})
}

func (c *connection) markAuthTimedOut() bool {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	if c.att.Authenticated || c.authTimedOut {
		return false
	}
	c.authTimedOut = true
	return true
}

func (c *connection) isAuthenticated() bool {
	c.stateMu.RLock()
	defer c.stateMu.RUnlock()
	return c.att.Authenticated
}

func (c *connection) attachAuthenticated(h *hub) bool {
	c.stateMu.Lock()
	if c.authTimedOut {
		c.stateMu.Unlock()
		return false
	}
	c.att.Authenticated = true
	c.att.LastHeartbeat = time.Now().UnixMilli()
	c.hub = h
	c.stateMu.Unlock()
	if c.authTimer != nil {
		c.authTimer.Stop()
	}
	h.register(c)
	return true
}

func (c *connection) currentHub() *hub {
	c.stateMu.RLock()
	defer c.stateMu.RUnlock()
	return c.hub
}

func (c *connection) remove() {
	if c.authTimer != nil {
		c.authTimer.Stop()
	}
	if h := c.currentHub(); h != nil {
		h.remove(c)
	}
}

func (c *connection) startHeartbeatTimer(timeout time.Duration) {
	c.heartbeatTimer = time.AfterFunc(timeout, func() {
		c.close(wsCloseNormal, "Heartbeat timeout")
		c.hub.remove(c)
	})
}

func (c *connection) resetHeartbeatTimer(timeout time.Duration) {
	if c.heartbeatTimer != nil {
		c.heartbeatTimer.Reset(timeout)
	}
}

func (c *connection) readLoop(auth *authResolver, heartbeatTimeout time.Duration) {
	defer c.remove()

	for {
		payload, err := c.ws.readMessage()
		if err != nil {
			return
		}

		var envelope struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(payload, &envelope); err != nil {
			continue
		}

		if envelope.Type == "auth" {
			if c.isAuthenticated() {
				continue
			}
			var msg authMessage
			if err := json.Unmarshal(payload, &msg); err != nil {
				_ = c.writeJSON(map[string]string{"reason": err.Error(), "type": "auth_failed"})
				c.close(wsClosePolicy, err.Error())
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), c.authTimeout)
			verifiedUserID, err := auth.resolve(ctx, c.claimedUserID, msg)
			cancel()
			if err == nil && c.claimedUserID != "" && verifiedUserID != c.claimedUserID {
				err = errUserIDMismatch
			}
			if err != nil {
				reason := err.Error()
				slog.Warn(
					"device gateway authentication failed",
					"connectionId", c.att.ConnectionID,
					"deviceId", c.att.DeviceID,
					"reason", reason,
				)
				_ = c.writeJSON(map[string]string{"reason": reason, "type": "auth_failed"})
				c.close(wsClosePolicy, reason)
				return
			}

			if !c.attachAuthenticated(c.server.hub(verifiedUserID)) {
				return
			}
			slog.Info(
				"device gateway authentication succeeded",
				"connectionId", c.att.ConnectionID,
				"deviceId", c.att.DeviceID,
				"channel", c.att.Channel,
			)
			_ = c.writeJSON(authSuccessMessage{Type: "auth_success", UserID: verifiedUserID})
			c.startHeartbeatTimer(heartbeatTimeout)
			continue
		}

		if !c.isAuthenticated() {
			continue
		}
		h := c.currentHub()
		if h == nil {
			continue
		}

		switch envelope.Type {
		case "heartbeat":
			h.recordHeartbeat(c)
			c.resetHeartbeatTimer(heartbeatTimeout)
			_ = c.writeJSON(map[string]string{"type": "heartbeat_ack"})
		case "tool_call_response", "message_api_response", "system_info_response", "rpc_response", "agent_run_ack":
			var msg rpcEnvelope
			if err := json.Unmarshal(payload, &msg); err == nil {
				h.resolvePending(msg)
			}
		}
	}
}
