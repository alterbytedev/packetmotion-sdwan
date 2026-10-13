package identity

import (
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"
)

func TestKeyCSRAndPrivatePersistence(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "private")
	key, err := CreateKey()
	if err != nil {
		t.Fatal(err)
	}
	csr, err := CSR(key)
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode([]byte(csr))
	parsed, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	if err = parsed.CheckSignature(); err != nil {
		t.Fatal(err)
	}
	state := State{NodeID: "node", Key: key}
	if err = Save(directory, state); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(filepath.Join(directory, "identity.json"))
	if info.Mode().Perm() != 0600 {
		t.Fatal("key is not private")
	}
	loaded, err := Load(directory)
	if err != nil || loaded.Key != key {
		t.Fatal("state did not survive restart")
	}
	os.Chmod(directory, 0755)
	if err = Save(directory, state); err == nil {
		t.Fatal("unsafe state directory accepted")
	}
}
