package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"packetmotion/fabric-agent/internal/agent"
	"packetmotion/fabric-agent/internal/controller"
	"packetmotion/fabric-agent/internal/identity"
)

func resetNetwork(ctx context.Context, writer io.Writer, directory, managementDirectory, expected string) error {
	if os.Geteuid() != 0 {
		return errors.New("network reset requires local root privileges")
	}
	if !validNodeID(expected) || managementDirectory == "" || filepath.Clean(directory) == filepath.Clean(managementDirectory) {
		return errors.New("reset requires old --confirm-node-id and a separate --management-state-dir")
	}
	old, err := identity.Load(directory)
	if err != nil {
		return errors.New("old identity unavailable; reset refused")
	}
	if !strings.EqualFold(old.NodeID, expected) {
		return errors.New("old identity does not match reset confirmation")
	}
	next, err := identity.Load(managementDirectory)
	if err != nil || !validNodeID(next.NodeID) || strings.EqualFold(old.NodeID, next.NodeID) {
		return errors.New("a different enrolled management identity is required")
	}
	if err = controller.ValidateURL(next.AgentURL, next.AllowLocal); err != nil {
		return err
	}
	client, err := controller.New(next.AgentURL, next.ServerCA, next.Certificate, next.Key, next.AllowLocal)
	if err != nil {
		return err
	}
	defer client.HTTP.CloseIdleConnections()
	engine, err := agent.NetworkEngine(ctx, &old, directory, next.AgentURL)
	if err != nil {
		return err
	}
	resetCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	err = engine.Reset(resetCtx, func(checkCtx context.Context) error {
		client.HTTP.CloseIdleConnections()
		return client.Request(checkCtx, http.MethodGet, "/api/agent/v1/desired", nil, nil)
	})
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(writer, "Old owned network configuration removed; identity files remain preserved for installer backup.")
	return err
}
