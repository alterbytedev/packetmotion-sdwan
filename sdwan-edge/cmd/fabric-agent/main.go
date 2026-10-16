package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"math/big"
	"os"
	"os/signal"
	"packetmotion/fabric-agent/internal/agent"
	"packetmotion/fabric-agent/internal/controller"
	"packetmotion/fabric-agent/internal/identity"
	"packetmotion/fabric-agent/internal/network"
	"strings"
	"syscall"
	"time"
)

func main() {
	if err := execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func execute() error {
	if len(os.Args) < 2 {
		return errors.New("usage: fabric-agent enroll|run [options]")
	}
	if os.Args[1] == "version" {
		fmt.Println(agent.Version)
		return nil
	}
	flags := flag.NewFlagSet(os.Args[1], flag.ContinueOnError)
	address := flags.String("controller", "", "controller HTTPS origin")
	directory := flags.String("state-dir", "/var/lib/packetmotion", "private state directory")
	caPath := flags.String("server-ca", "", "optional PEM for a private server CA")
	local := flags.Bool("allow-insecure-local", false, "allow HTTP on loopback or private IPs for isolated development labs")
	wireguard := flags.Bool("enable-wireguard", false, "enable owned WireGuard interface apply (requires NET_ADMIN and isolated validation)")
	once := flags.Bool("once", false, "one management cycle")
	if err := flags.Parse(os.Args[2:]); err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	switch os.Args[1] {
	case "enroll":
		if *address == "" {
			return errors.New("--controller is required")
		}
		ca := ""
		if *caPath != "" {
			data, err := os.ReadFile(*caPath)
			if err != nil {
				return err
			}
			ca = string(data)
		}
		token := os.Getenv("FABRIC_ENROLLMENT_TOKEN")
		if token == "" {
			fmt.Fprintln(os.Stderr, "Read enrollment token from stdin (prefer a pipe; token is not a command-line argument).")
			data, err := bufio.NewReader(os.Stdin).ReadString('\n')
			if err != nil && data == "" {
				return errors.New("enrollment token required")
			}
			token = strings.TrimSpace(data)
		}
		state, err := agent.Enroll(ctx, *address, ca, token, *directory, *local)
		if err != nil {
			return err
		}
		fmt.Printf("Enrolled %s device %s. Run fabric-agent run --state-dir <same-directory>.\n", map[string]string{"branch": "Edge", "hub": "Hub"}[state.Kind], state.NodeID)
		return nil
	case "run":
		state, err := identity.Load(*directory)
		if err != nil {
			return errors.New("enroll this agent first")
		}
		state.WireGuardEnabled = *wireguard
		if *wireguard {
			engine := network.Engine{Directory: *directory, NodeID: state.NodeID}
			if err = engine.Restore(ctx); err != nil {
				return err
			}
		}
		client, err := controller.New(state.AgentURL, state.ServerCA, state.Certificate, state.Key, state.AllowLocal)
		if err != nil {
			return err
		}
		if !*once {
			jitter, err := rand.Int(rand.Reader, big.NewInt(int64(5*time.Second)))
			if err != nil {
				return errors.New("startup jitter unavailable")
			}
			timer := time.NewTimer(time.Duration(jitter.Int64()))
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil
			case <-timer.C:
			}
		}
		start := time.Now()
		backoff := time.Second
		heartbeatInterval := 30 * time.Second
		nextHeartbeat := time.Now()
		var pending *agent.Telemetry
		for {
			now := time.Now()
			if pending == nil && !now.Before(nextHeartbeat) {
				snapshot := agent.Snapshot(start)
				pending = &snapshot
			}
			wait := 25 * time.Second
			if pending == nil && nextHeartbeat.After(now) {
				wait = nextHeartbeat.Sub(now)
			}
			if wait > 25*time.Second {
				wait = 25 * time.Second
			}
			if wait > time.Second && !*once {
				jitterMax := wait / 5
				jitter, err := rand.Int(rand.Reader, big.NewInt(int64(jitterMax)+1))
				if err == nil {
					wait -= time.Duration(jitter.Int64())
				}
			}
			if *once {
				wait = 0
			}
			var heartbeatErr, configErr error
			var interval time.Duration
			sentHeartbeat := pending != nil
			var renewalErr error
			client, renewalErr = agent.Renew(ctx, client, &state, *directory)
			heartbeatAt := time.Now()
			if pending != nil {
				interval, heartbeatErr, configErr = agent.CycleWait(ctx, client, &state, *directory, *pending, wait)
			} else {
				interval, configErr = agent.ReconcileWait(ctx, client, &state, *directory, wait)
			}
			if interval > 0 {
				heartbeatInterval = interval
			}
			if heartbeatErr == nil {
				pending = nil
				if sentHeartbeat && interval > 0 {
					nextHeartbeat = heartbeatAt.Add(heartbeatInterval)
				}
			}
			pollErr := errors.Join(heartbeatErr, configErr, renewalErr)
			if *once {
				return pollErr
			}
			if sentHeartbeat && heartbeatErr != nil {
				nextHeartbeat = time.Now()
			}
			delay := time.Duration(0)
			if pollErr != nil {
				fmt.Fprintln(os.Stderr, "Management cycle failed; retrying. Check network observations and the local recovery journal.")
				delay = backoff
				backoff *= 2
				if backoff > 60*time.Second {
					backoff = 60 * time.Second
				}
			} else {
				pending = nil
				backoff = time.Second
			}
			if delay == 0 {
				continue
			}
			jitter, _ := rand.Int(rand.Reader, big.NewInt(int64(delay/5)+1))
			if jitter != nil {
				delay += time.Duration(jitter.Int64())
			}
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil
			case <-timer.C:
			}
		}
	default:
		return errors.New("unknown command")
	}
}
