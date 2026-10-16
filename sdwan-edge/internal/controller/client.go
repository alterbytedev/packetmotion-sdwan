package controller

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxResponseBytes = 64 * 1024

type Client struct {
	URL  string
	HTTP *http.Client
}

func ValidateURL(address string, allowLocal bool) error {
	parsed, err := url.Parse(address)
	if err != nil {
		return errors.New("invalid controller URL")
	}
	if parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return errors.New("controller URL must be an origin")
	}
	if parsed.Scheme == "https" {
		return nil
	}
	if allowLocal && parsed.Scheme == "http" && isAllowedInsecureHost(parsed.Hostname()) {
		return nil
	}
	return errors.New("HTTPS is required (HTTP requires --allow-insecure-local and a loopback or approved lab controller address)")
}

func isAllowedInsecureHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate())
}

func New(address, serverCA, cert, key string, allowLocal bool) (*Client, error) {
	if err := ValidateURL(address, allowLocal); err != nil {
		return nil, err
	}
	configuration := &tls.Config{MinVersion: tls.VersionTLS12}
	if serverCA != "" {
		roots, err := x509.SystemCertPool()
		if err != nil {
			roots = x509.NewCertPool()
		}
		if !roots.AppendCertsFromPEM([]byte(serverCA)) {
			return nil, errors.New("invalid server CA")
		}
		configuration.RootCAs = roots
	}
	if cert != "" {
		pair, err := tls.X509KeyPair([]byte(cert), []byte(key))
		if err != nil {
			return nil, errors.New("invalid device certificate")
		}
		configuration.Certificates = []tls.Certificate{pair}
	}
	transport := &http.Transport{
		TLSClientConfig:       configuration,
		MaxIdleConns:          2,
		MaxIdleConnsPerHost:   2,
		MaxConnsPerHost:       2,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
	}
	return &Client{
		URL: strings.TrimRight(address, "/"),
		HTTP: &http.Client{
			Timeout:   35 * time.Second,
			Transport: transport,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return errors.New("redirects are not permitted")
			},
		},
	}, nil
}

func (c *Client) Request(ctx context.Context, method, path string, input, output any) error {
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.URL+path, body)
	if err != nil {
		return err
	}
	if input != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.HTTP.Do(request)
	if err != nil {
		return errors.New("controller connection failed")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return errors.New("controller response failed")
	}
	if len(data) > maxResponseBytes {
		return errors.New("controller response too large")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("controller rejected request (HTTP %d)", response.StatusCode)
	}
	if output != nil {
		if err = json.Unmarshal(data, output); err != nil {
			return errors.New("invalid controller response")
		}
	}
	return nil
}
