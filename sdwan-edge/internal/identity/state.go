package identity

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"os"
	"path/filepath"
)

type State struct {
	Checksum    string `json:"checksum"`
	NodeID      string `json:"nodeId"`
	Kind        string `json:"kind"`
	Controller  string `json:"controller"`
	AgentURL    string `json:"agentUrl"`
	Key         string `json:"privateKey"`
	Certificate string `json:"certificate"`
	CA          string `json:"ca"`
	ServerCA    string `json:"serverCa"`
	ExpiresAt   string `json:"expiresAt"`
	Revision    int    `json:"revision"`
	AllowLocal  bool   `json:"allowLocal"`
}

func CreateKey() (string, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", err
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return "", err
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded})), nil
}
func CSR(keyPEM string) (string, error) {
	block, _ := pem.Decode([]byte(keyPEM))
	if block == nil {
		return "", errors.New("invalid key")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return "", err
	}
	encoded, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: "fabric-agent"}}, key)
	if err != nil {
		return "", err
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: encoded})), nil
}
func WritePrivate(directory, name string, value []byte) error {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return errors.New("state directory must be private (0700)")
	}
	temporary, err := os.CreateTemp(directory, ".pending-")
	if err != nil {
		return err
	}
	defer os.Remove(temporary.Name())
	if err = temporary.Chmod(0600); err != nil {
		temporary.Close()
		return err
	}
	if _, err = temporary.Write(value); err != nil {
		temporary.Close()
		return err
	}
	if err = temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err = temporary.Close(); err != nil {
		return err
	}
	if err = os.Rename(temporary.Name(), filepath.Join(directory, name)); err != nil {
		return err
	}
	parent, err := os.Open(directory)
	if err != nil {
		return err
	}
	defer parent.Close()
	return parent.Sync()
}
func Save(directory string, state State) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return WritePrivate(directory, "identity.json", data)
}
func Load(directory string) (State, error) {
	var state State
	dirInfo, err := os.Lstat(directory)
	if err != nil {
		return state, err
	}
	if !dirInfo.IsDir() || dirInfo.Mode().Perm()&0077 != 0 {
		return state, errors.New("unsafe state directory")
	}
	fileInfo, err := os.Lstat(filepath.Join(directory, "identity.json"))
	if err != nil {
		return state, err
	}
	if !fileInfo.Mode().IsRegular() || fileInfo.Mode().Perm()&0077 != 0 {
		return state, errors.New("unsafe identity file")
	}

	data, err := os.ReadFile(filepath.Join(directory, "identity.json"))
	if err != nil {
		return state, err
	}
	err = json.Unmarshal(data, &state)
	return state, err
}
