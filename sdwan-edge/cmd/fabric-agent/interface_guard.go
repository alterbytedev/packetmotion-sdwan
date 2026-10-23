package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"slices"
	"syscall"
	"time"

	"packetmotion/fabric-agent/internal/network"
)

const interfaceGuardDirectory = "/var/lib/packetmotion-interfaces"
const interfacePolicyPath = "/etc/packetmotion/interface-policy.json"

type guardHistory struct {
	Results []network.InterfaceResult `json:"results"`
}
type interfaceConfirmation struct {
	CommitID string `json:"commitId"`
	Checksum string `json:"checksum"`
	Nonce    string `json:"nonce"`
}

type interfaceWorkerFailure struct {
	CommitID  string `json:"commitId"`
	Operation string `json:"operation"`
}

func interfaceGuardCLI(args []string, worker bool, stderr io.Writer) error {
	flags := flag.NewFlagSet("interface-guard", flag.ContinueOnError)
	flags.SetOutput(stderr)
	directory := flags.String("guard-state-dir", interfaceGuardDirectory, "private guard journal directory")
	shared := flags.String("state-dir", "/var/lib/packetmotion", "existing agent state directory")
	policyPath := flags.String("policy", interfacePolicyPath, "root-owned local interface authorization")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected interface guard argument")
	}
	if os.Geteuid() != 0 {
		return errors.New("interface guard requires its locally installed privileged service")
	}
	policy, err := network.ReadInterfaceAuthorization(*policyPath)
	if err != nil {
		return err
	}
	if !filepath.IsAbs(*directory) || !filepath.IsAbs(*shared) || !filepath.IsAbs(*policyPath) || filepath.Clean(*directory) == filepath.Clean(*shared) {
		return errors.New("invalid interface guard paths")
	}
	if err = os.MkdirAll(*directory, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(*directory)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 || info.Sys().(*syscall.Stat_t).Uid != 0 {
		return errors.New("guard state must be a root-owned private directory")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	engine := network.InterfaceEngine{NodeID: policy.NodeID, Authorization: policy}
	if worker {
		var j network.InterfaceJournal
		if err = network.ReadInterfaceFile(*directory, "pending.json", &j); err != nil {
			return err
		}
		c, err := j.Request.Configuration()
		if err != nil || c.NodeID != policy.NodeID || !slices.Contains(policy.Interfaces, c.InterfaceName) {
			return errors.New("unauthorized interface worker")
		}
		applyCtx, stop := context.WithDeadline(ctx, mustGuardDeadline(j.Result.Deadline))
		defer stop()
		err = engine.Apply(applyCtx, j)
		var operation *network.InterfaceOperationError
		if errors.As(err, &operation) {
			_ = network.WriteInterfaceFile(*directory, "worker-failure.json", interfaceWorkerFailure{CommitID: j.Request.CommitID, Operation: operation.Step})
		}
		return err
	}
	return runInterfaceGuard(ctx, *directory, *shared, *policyPath, policy, engine)
}
func mustGuardDeadline(value string) time.Time {
	deadline, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Unix(0, 0)
	}
	return deadline
}

// Shared output is public only inside the agent's private state directory. Use
// descriptor chmod before rename, never chmod a user-replaceable final path.
func publishGuardFile(directory, name string, value any) error {
	data, err := json.Marshal(value)
	if err != nil || len(data) > 32768 {
		return errors.New("guard report too large")
	}
	file, err := os.CreateTemp(directory, ".interface-report-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err == nil {
		err = file.Chmod(0644)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(file.Name(), filepath.Join(directory, name)); err != nil {
		return err
	}
	parent, err := os.Open(directory)
	if err != nil {
		return err
	}
	defer parent.Close()
	return parent.Sync()
}
func guardHistoryResult(directory, shared string, result network.InterfaceResult) error {
	var history guardHistory
	if err := network.ReadInterfaceFile(directory, "history.json", &history); err != nil && !os.IsNotExist(err) {
		return err
	}
	history.Results = slices.DeleteFunc(history.Results, func(r network.InterfaceResult) bool { return r.CommitID == result.CommitID })
	history.Results = append(history.Results, result)
	if len(history.Results) > 50 {
		var acknowledgements map[string]int
		if err := network.ReadInterfaceFile(shared, "interface-report-acks.json", &acknowledgements); err != nil && !os.IsNotExist(err) {
			return err
		}
		for index := 0; len(history.Results) > 50 && index < len(history.Results); {
			item := history.Results[index]
			if item.CommitID != result.CommitID && acknowledgements[item.CommitID] >= item.Sequence {
				history.Results = slices.Delete(history.Results, index, index+1)
			} else {
				index++
			}
		}
		if len(history.Results) > 50 {
			return errors.New("interface result outbox full; preserve unacknowledged history")
		}
	}
	if err := network.WriteInterfaceFile(directory, "history.json", history); err != nil {
		return err
	}
	return publishGuardFile(shared, "interface-history.json", history)
}
func guardResult(directory, shared string, j *network.InterfaceJournal, status, reason string) error {
	j.Result.Status = status
	j.Result.Reason = reason
	j.Result.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	j.Result.Sequence++
	if err := network.WriteInterfaceFile(directory, "pending.json", j); err != nil {
		return err
	}
	return publishGuardFile(shared, "interface-result.json", j.Result)
}
func rollbackInterfaceGuard(directory, shared string, engine network.InterfaceEngine, j *network.InterfaceJournal, reason string) error {
	recovery, stop := context.WithTimeout(context.Background(), 60*time.Second)
	defer stop()
	if err := engine.Rollback(recovery, *j); err != nil {
		_ = guardResult(directory, shared, j, "rollback_failed", "rollback_failed")
		_ = guardHistoryResult(directory, shared, j.Result)
		return errors.New("interface rollback failed; local console recovery required")
	}
	if err := network.WriteInterfaceFile(directory, "confirmed.json", j.Previous); err != nil {
		return err
	}
	if err := guardResult(directory, shared, j, "rolled_back", reason); err != nil {
		return err
	}
	if err := guardHistoryResult(directory, shared, j.Result); err != nil {
		return err
	}
	return removeGuardPending(directory)
}
func removeGuardPending(directory string) error {
	if err := os.Remove(filepath.Join(directory, "pending.json")); err != nil && !os.IsNotExist(err) {
		return err
	}
	file, err := os.Open(directory)
	if err != nil {
		return err
	}
	defer file.Close()
	return file.Sync()
}
func guardNetworkLock(shared string) (*os.File, error) {
	file, err := os.OpenFile(filepath.Join(shared, "network.lock"), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		return nil, errors.New("unsafe network lock")
	}
	parent, err := os.Stat(shared)
	if err != nil {
		file.Close()
		return nil, err
	}
	owner := parent.Sys().(*syscall.Stat_t)
	if err = file.Chown(int(owner.Uid), int(owner.Gid)); err != nil {
		file.Close()
		return nil, err
	}
	if err = syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, network.ErrReconcileBusy
	}
	return file, nil
}
func releaseGuardLock(file *os.File) {
	if file != nil {
		_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		file.Close()
	}
}
func notifyGuard(value string) {
	address := os.Getenv("NOTIFY_SOCKET")
	if address == "" {
		return
	}
	if address[0] == '@' {
		address = "\x00" + address[1:]
	}
	conn, err := net.DialUnix("unixgram", nil, &net.UnixAddr{Name: address, Net: "unixgram"})
	if err != nil {
		return
	}
	defer conn.Close()
	_ = conn.SetWriteDeadline(time.Now().Add(time.Second))
	_, _ = conn.Write([]byte(value))
}
func runInterfaceGuard(ctx context.Context, directory, shared, policyPath string, policy network.InterfaceAuthorization, engine network.InterfaceEngine) error {
	// systemd kills this service's worker cgroup before restart. Any journal left
	// after a crash is rolled back before accepting another controller request.
	var confirmed network.InterfaceBundle
	if err := network.ReadInterfaceFile(directory, "confirmed.json", &confirmed); err != nil && !os.IsNotExist(err) {
		return err
	}
	var interrupted network.InterfaceJournal
	if err := network.ReadInterfaceFile(directory, "pending.json", &interrupted); err == nil {
		lock, err := guardNetworkLock(shared)
		if err != nil {
			return err
		}
		if confirmed.LastResult != nil && confirmed.LastResult.CommitID == interrupted.Request.CommitID && confirmed.LastResult.Status == "applied" {
			err = guardHistoryResult(directory, shared, *confirmed.LastResult)
			if err == nil {
				err = publishGuardFile(shared, "interface-result.json", confirmed.LastResult)
			}
			if err == nil {
				err = removeGuardPending(directory)
			}
		} else {
			err = rollbackInterfaceGuard(directory, shared, engine, &interrupted, "interrupted_apply")
			confirmed = interrupted.Previous
		}
		releaseGuardLock(lock)
		if err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	// Restore confirmed interfaces independently of controller availability.
	if len(confirmed.Configurations) > 0 {
		lock, err := guardNetworkLock(shared)
		if err != nil {
			return err
		}
		restoreCtx, stop := context.WithTimeout(ctx, 90*time.Second)
		for _, c := range confirmed.Configurations {
			r, makeErr := network.NewInterfaceRequest("00000000-0000-0000-0000-000000000000", c)
			if makeErr != nil {
				err = makeErr
				break
			}
			j, prepareErr := engine.Prepare(restoreCtx, r, confirmed)
			if prepareErr != nil {
				err = prepareErr
				break
			}
			if err = engine.Apply(restoreCtx, j); err != nil {
				break
			}
		}
		stop()
		releaseGuardLock(lock)
		if err != nil {
			return errors.New("confirmed interface recovery failed")
		}
	}
	// History survives restart even when no new request arrives.
	var history guardHistory
	if err := network.ReadInterfaceFile(directory, "history.json", &history); err == nil {
		if err = publishGuardFile(shared, "interface-history.json", history); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if confirmed.LastResult != nil && !slices.ContainsFunc(history.Results, func(result network.InterfaceResult) bool {
		return result.CommitID == confirmed.LastResult.CommitID && result.Sequence >= confirmed.LastResult.Sequence
	}) {
		if err := guardHistoryResult(directory, shared, *confirmed.LastResult); err != nil {
			return err
		}
		if err := publishGuardFile(shared, "interface-result.json", confirmed.LastResult); err != nil {
			return err
		}
	}
	notifyGuard("READY=1")
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	var active *network.InterfaceJournal
	var activeExpiry time.Time
	var worker *exec.Cmd
	var done chan error
	var lock *os.File
	defer func() {
		if worker != nil {
			_ = syscall.Kill(-worker.Process.Pid, syscall.SIGKILL)
			<-done
		}
		releaseGuardLock(lock)
	}()
	lastCapability := time.Time{}
	for {
		select {
		case <-ctx.Done():
			if worker != nil {
				_ = syscall.Kill(-worker.Process.Pid, syscall.SIGKILL)
				<-done
				worker = nil
			}
			if active != nil {
				return rollbackInterfaceGuard(directory, shared, engine, active, "interrupted_apply")
			}
			return nil
		case <-ticker.C:
		}
		notifyGuard("WATCHDOG=1")
		if time.Since(lastCapability) > 5*time.Second {
			capability := network.InterfaceCapability{NodeID: policy.NodeID, ProtocolVersion: 1, Mode: "dedicated-static", Interfaces: policy.Interfaces, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
			if err := publishGuardFile(shared, "interface-capability.json", capability); err != nil {
				return err
			}
			lastCapability = time.Now()
		}
		if active != nil {
			if !time.Now().Before(activeExpiry) {
				if worker != nil {
					_ = syscall.Kill(-worker.Process.Pid, syscall.SIGKILL)
					<-done
					worker = nil
				}
				if err := rollbackInterfaceGuard(directory, shared, engine, active, "controller_confirmation_timeout"); err != nil {
					return err
				}
				confirmed = active.Previous
				active = nil
				releaseGuardLock(lock)
				lock = nil
				continue
			}
			if worker != nil {
				select {
				case err := <-done:
					worker = nil
					if err != nil {
						var failure interfaceWorkerFailure
						if network.ReadInterfaceFile(directory, "worker-failure.json", &failure) == nil && failure.CommitID == active.Request.CommitID {
							active.Result.Operation = failure.Operation
						}
						if err = rollbackInterfaceGuard(directory, shared, engine, active, "apply_failed"); err != nil {
							return err
						}
						confirmed = active.Previous
						active = nil
						releaseGuardLock(lock)
						lock = nil
						continue
					}
					if err = guardResult(directory, shared, active, "awaiting_confirmation", ""); err != nil {
						return err
					}
				default:
				}
			}
			if active != nil && active.Result.Status == "awaiting_confirmation" {
				var confirmation interfaceConfirmation
				if err := network.ReadInterfaceFile(shared, "interface-confirmation.json", &confirmation); err == nil && confirmation.CommitID == active.Result.CommitID && confirmation.Checksum == active.Result.Checksum && confirmation.Nonce == active.Result.Nonce && time.Now().Before(activeExpiry) {
					active.Result.Status = "applied"
					active.Result.Reason = ""
					active.Result.Sequence++
					active.Result.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
					active.Next.LastResult = &active.Result
					if err = network.WriteInterfaceFile(directory, "confirmed.json", active.Next); err != nil {
						return err
					}
					if err = removeGuardPending(directory); err != nil {
						return err
					}
					if err = guardHistoryResult(directory, shared, active.Result); err != nil {
						return err
					}
					if err = publishGuardFile(shared, "interface-result.json", active.Result); err != nil {
						return err
					}
					confirmed = active.Next
					active = nil
					releaseGuardLock(lock)
					lock = nil
				}
			}
			continue
		}
		var request network.InterfaceRequest
		if err := network.ReadInterfaceFile(shared, "interface-request.json", &request); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		if err := network.ReadInterfaceFile(directory, "history.json", &history); err != nil && !os.IsNotExist(err) {
			return err
		}
		if slices.ContainsFunc(history.Results, func(r network.InterfaceResult) bool { return r.CommitID == request.CommitID }) {
			continue
		}
		if len(history.Results) >= 50 {
			var acknowledgements map[string]int
			if err := network.ReadInterfaceFile(shared, "interface-report-acks.json", &acknowledgements); err != nil && !os.IsNotExist(err) {
				return err
			}
			if !slices.ContainsFunc(history.Results, func(result network.InterfaceResult) bool { return acknowledgements[result.CommitID] >= result.Sequence }) {
				continue
			}
		}
		var err error
		lock, err = guardNetworkLock(shared)
		if errors.Is(err, network.ErrReconcileBusy) {
			continue
		}
		if err != nil {
			return err
		}
		prepareCtx, stop := context.WithTimeout(ctx, 5*time.Second)
		j, err := engine.Prepare(prepareCtx, request, confirmed)
		stop()
		if err != nil {
			result := network.InterfaceResult{CommitID: request.CommitID, Checksum: request.Checksum, Status: "rejected", Reason: network.InterfaceReason(err), UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano), Sequence: 1}
			if err = guardHistoryResult(directory, shared, result); err != nil {
				return err
			}
			if err = publishGuardFile(shared, "interface-result.json", result); err != nil {
				return err
			}
			releaseGuardLock(lock)
			lock = nil
			continue
		}
		var nonce [32]byte
		if _, err = rand.Read(nonce[:]); err != nil {
			return err
		}
		activeExpiry = time.Now().Add(60 * time.Second)
		j.Result = network.InterfaceResult{CommitID: request.CommitID, Checksum: request.Checksum, Nonce: hex.EncodeToString(nonce[:]), Deadline: activeExpiry.UTC().Format(time.RFC3339Nano)}
		if err = guardResult(directory, shared, &j, "applying", ""); err != nil {
			return err
		}
		// Keep using this verified running binary even if an agent upgrade atomically
		// replaces its installed path. The guard must remain alive through upgrades.
		worker = exec.Command("/proc/self/exe", "interface-worker", "--guard-state-dir", directory, "--state-dir", shared, "--policy", policyPath)
		worker.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		if err = worker.Start(); err != nil {
			worker = nil
			if err = rollbackInterfaceGuard(directory, shared, engine, &j, "apply_failed"); err != nil {
				return err
			}
			releaseGuardLock(lock)
			lock = nil
			continue
		}
		done = make(chan error, 1)
		child := worker
		waitChan := done
		go func() { waitChan <- child.Wait() }()
		active = &j
	}
}
