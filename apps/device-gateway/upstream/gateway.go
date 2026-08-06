package devicegateway

import "github.com/lobehub/lobehub/apps/device-gateway-go/internal/gateway"

type Config = gateway.Config

type Server = gateway.Server

func ConfigFromEnv() Config { return gateway.ConfigFromEnv() }

func NewServer(cfg Config) *Server { return gateway.NewServer(cfg) }
