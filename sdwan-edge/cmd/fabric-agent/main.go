package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/big"
	"os"
	"os/signal"
	"packetmotion/fabric-agent/internal/agent"
	"packetmotion/fabric-agent/internal/controller"
	"packetmotion/fabric-agent/internal/identity"
	"runtime"
	"strings"
	"syscall"
	"time"
)

func main() {
	if err := execute(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func execute(args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: fabric-agent [--version|--help] | enroll|run|status [options]")
	}
	command := args[0]
	if command == "version" {
		fmt.Fprintln(stdout, agent.Version)
		return nil
	}
	if command == "--version" || command == "-version" {
		fmt.Fprintf(stdout, "fabric-agent version %s (%s/%s)\n", agent.Version, runtime.GOOS, runtime.GOARCH)
		return nil
	}
	if command == "--help" || command == "-help" || command == "-h" || command == "help" {
		fmt.Fprintln(stdout, "Usage: fabric-agent [--version] [--help] | enroll|run|status [options]")
		fmt.Fprintln(stdout, "Commands: enroll, run, version, status, reset-network")
		return nil
	}
	if command != "enroll" && command != "run" && command != "status" && command != "reset-network" {
		return fmt.Errorf("unknown command %q; use fabric-agent --help", command)
	}
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.Usage = func() {
		fmt.Fprintf(stderr, "Usage: fabric-agent %s [options]\nOptions:\n", command)
		flags.PrintDefaults()
	}
	directory := flags.String("state-dir", "/var/lib/packetmotion", "private state directory")
	var address, caPath, lanInterface *string
	var expected *string
	var managementDirectory *string
	var check *bool
	var local, wireguard, routing, once *bool
	if command == "enroll" {
		address = flags.String("controller", "", "controller HTTPS origin")
		caPath = flags.String("server-ca", "", "optional PEM for a private server CA")
		local = flags.Bool("allow-insecure-local", false, "allow HTTP on loopback or private IPs for isolated development labs")
	} else if command == "reset-network" {
		expected = flags.String("confirm-node-id", "", "old local identity approved for network cleanup")
		managementDirectory = flags.String("management-state-dir", "", "new enrolled identity used to verify controller access")
	} else if command == "status" {
		expected = flags.String("expected-node-id", "", "expected dashboard device ID")
		check = flags.Bool("check", false, "check controller authentication without applying configuration")
	} else {
		wireguard = flags.Bool("enable-wireguard", false, "enable owned WireGuard interface apply (requires NET_ADMIN and isolated validation)")
		routing = flags.Bool("enable-routing", false, "enable locally authorized LAN address and FRR BGP apply (requires --enable-wireguard and --lan-interface)")
		lanInterface = flags.String("lan-interface", "", "locally authorized physical LAN interface for routing apply")
		once = flags.Bool("once", false, "one management cycle")
	}
	if err := flags.Parse(args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	switch command {
	case "reset-network":
		return resetNetwork(ctx, stdout, *directory, *managementDirectory, *expected)
	case "status":
		if *expected != "" && !validNodeID(*expected) {
			return errors.New("expected-node-id must be a UUID")
		}
		return localStatus(ctx, stdout, *directory, *expected, *check)
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
		report := operationReporter(stderr, &identity.State{})
		report("enrollment.started", nil, time.Time{})
		state, err := agent.Enroll(ctx, *address, ca, token, *directory, *local)
		if err != nil {
			report("enrollment", err, time.Time{})
			return err
		}
		operationReporter(stderr, &state)("enrollment", nil, time.Time{})
		fmt.Fprintf(stdout, "Enrolled %s device %s. Run fabric-agent run --state-dir <same-directory>.\n", map[string]string{"branch": "Edge", "hub": "Hub"}[state.Kind], state.NodeID)
		return nil
	case "run":
		state, err := identity.Load(*directory)
		if err != nil {
			operationReporter(stderr, &identity.State{})("identity.load", errors.New("enroll this agent first"), time.Time{})
			return errors.New("enroll this agent first")
		}
		report := operationReporter(stderr, &state)
		report("service.starting", nil, time.Time{})
		state.WireGuardEnabled = *wireguard
		state.RoutingEnabled = *routing
		state.LANInterface = *lanInterface
		if *routing && (!*wireguard || *lanInterface == "") {
			return errors.New("--enable-routing requires --enable-wireguard and --lan-interface")
		}
		if *wireguard {
			report("network.recovery.started", nil, time.Time{})
			engine, engineErr := agent.NetworkEngine(ctx, &state, *directory, state.AgentURL)
			if engineErr != nil {
				report("network.recovery", engineErr, time.Time{})
				return engineErr
			}
			if err = engine.Restore(ctx); err != nil {
				report("network.recovery", err, time.Time{})
				return err
			}
			report("network.recovery", nil, time.Time{})
		}
		client, err := controller.New(state.AgentURL, state.ServerCA, state.Certificate, state.Key, state.AllowLocal)
		if err != nil {
			report("controller.setup", err, time.Time{})
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
		operations := managementOperations{
			renew: func(callCtx context.Context) error {
				var renewErr error
				client, renewErr = agent.Renew(callCtx, client, &state, *directory)
				return renewErr
			},
			heartbeat: func(callCtx context.Context, snapshot agent.Telemetry) error {
				return agent.Heartbeat(callCtx, client, snapshot)
			},
			desired: func(callCtx context.Context, wait time.Duration) (time.Duration, error) {
				return agent.ReconcileWait(callCtx, client, &state, *directory, wait)
			},
			snapshot: func() agent.Telemetry { return agent.Snapshot(start) },
			now:      time.Now,
			report:   report,
		}
		return runManagementLoop(ctx, *once, &state, operations)
	default:
		return errors.New("unknown command")
	}
}
