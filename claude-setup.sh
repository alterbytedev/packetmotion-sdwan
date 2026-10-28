#!/usr/bin/env bash
# claude-setup.sh
# Idempotent setup and precheck for Claude Code in the current repo.
# Skips anything already configured. Never deletes files. Never writes secrets.

set -u

REPO_DIR="$(pwd)"
OK="[ OK ]"; SKIP="[SKIP]"; WARN="[WARN]"; FAIL="[FAIL]"; DO="[ DO ]"
ASK_INSTALL="${ASK_INSTALL:-1}"   # set ASK_INSTALL=0 to auto-install without prompt

say()  { printf '%s %s\n' "$1" "$2"; }
have() { command -v "$1" >/dev/null 2>&1; }
confirm() {
  [ "$ASK_INSTALL" = "0" ] && return 0
  read -r -p "$1 [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]]
}

echo "== Claude Code setup for: $REPO_DIR =="

# ---------- 1. Precheck prerequisites ----------
if have node; then say "$OK" "node $(node -v)"; else say "$FAIL" "node not found. Install Node.js first."; exit 1; fi
if have npx;  then say "$OK" "npx found"; else say "$FAIL" "npx not found"; exit 1; fi
if have claude; then say "$OK" "claude CLI found"; else say "$FAIL" "claude CLI not found. Install Claude Code first."; exit 1; fi

# ---------- 2. rtk ----------
if have rtk; then
  if rtk --help 2>/dev/null | grep -qi "token killer\|Rust Token Killer\|init"; then
    say "$OK" "rtk installed (Rust Token Killer)"
  else
    say "$WARN" "rtk found but may not be Rust Token Killer. Check 'rtk --help'."
  fi
else
  say "$WARN" "rtk not installed. Install it from the official rtk-ai release, then re-run."
fi

if have rtk && grep -q "rtk hook" "$HOME/.claude/settings.json" 2>/dev/null; then
  say "$SKIP" "rtk hook already in ~/.claude/settings.json"
elif have rtk; then
  if confirm "Add rtk hook globally (rtk init -g --hook-only)?"; then
    rtk init -g --hook-only && say "$OK" "rtk hook installed" || say "$FAIL" "rtk init failed"
  else
    say "$SKIP" "rtk hook skipped by user"
  fi
fi

# ---------- 3. Permission mode ----------
if grep -q '"defaultMode": *"plan"' "$HOME/.claude/settings.json" 2>/dev/null; then
  say "$WARN" "defaultMode is 'plan'. Remove it if unintended (edit ~/.claude/settings.json manually)."
else
  say "$OK" "defaultMode is not 'plan'"
fi

# ---------- 4. repomix config ----------
if [ -f repomix.config.json ]; then
  say "$SKIP" "repomix.config.json exists (not overwritten, review manually)"
else
  if confirm "Create repomix.config.json?"; then
    cat > repomix.config.json <<'EOF'
{
  "output": {
    "filePath": ".claude/codebase-structure.xml",
    "style": "xml",
    "compress": true,
    "removeComments": true,
    "removeEmptyLines": true
  },
  "ignore": {
    "customPatterns": [
      "**/*.lock", "**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml",
      "dist/**", "build/**", "node_modules/**", "vendor/**",
      "**/*.min.*", "**/generated/**", "**/*.png", "**/*.jpg", "**/*.pdf",
      "**/__fixtures__/**", "**/fixtures/**", "**/testdata/**"
    ]
  }
}
EOF
    say "$OK" "repomix.config.json created"
  else
    say "$SKIP" "repomix.config.json skipped"
  fi
fi

# ---------- 5. .gitignore ----------
mkdir -p .claude
if [ -f .gitignore ] && grep -qxF ".claude/codebase-structure.xml" .gitignore; then
  say "$SKIP" ".gitignore already ignores codebase-structure.xml"
else
  if confirm "Append .claude/codebase-structure.xml to .gitignore?"; then
    echo ".claude/codebase-structure.xml" >> .gitignore
    say "$OK" ".gitignore updated"
  else
    say "$SKIP" ".gitignore skipped"
  fi
fi

# ---------- 6. repomix MCP ----------
if claude mcp list 2>/dev/null | grep -q "^repomix:"; then
  say "$SKIP" "repomix MCP already registered"
else
  if confirm "Register repomix MCP (claude mcp add repomix)?"; then
    claude mcp add repomix -- npx -y repomix --mcp && say "$OK" "repomix MCP registered" || say "$FAIL" "repomix MCP registration failed"
  else
    say "$SKIP" "repomix MCP skipped"
  fi
fi

# ---------- 7. claude-context (manual only) ----------
if claude mcp list 2>/dev/null | grep -q "^claude-context:"; then
  say "$SKIP" "claude-context already registered"
else
  say "$WARN" "claude-context not registered (optional). Register it yourself with your own keys."
fi

# ---------- 8. CLAUDE.md ----------
if [ -f CLAUDE.md ]; then
  lines=$(wc -l < CLAUDE.md)
  if [ "$lines" -gt 150 ]; then
    say "$WARN" "CLAUDE.md is $lines lines (cap 150). Trim it."
  else
    say "$OK" "CLAUDE.md exists ($lines lines)"
  fi
else
  say "$WARN" "CLAUDE.md missing. Create it following the setup guide."
fi

# ---------- 9. Skeleton ----------
if [ -f .claude/codebase-structure.xml ]; then
  say "$SKIP" "skeleton exists (refresh with: npx -y repomix)"
else
  if confirm "Generate repomix skeleton now?"; then
    npx -y repomix >/dev/null 2>&1 && say "$OK" "skeleton generated" || say "$FAIL" "repomix failed"
    if [ -f .claude/codebase-structure.xml ]; then
      tok=$(( $(wc -c < .claude/codebase-structure.xml) / 4 ))
      say "$OK" "approx ${tok} tokens (warn if > 30000)"
      [ "$tok" -gt 30000 ] && say "$WARN" "skeleton is large. Tighten ignore patterns."
    fi
  else
    say "$SKIP" "skeleton skipped"
  fi
fi

# ---------- 10. Launch Claude ----------
echo
echo "== Setup check done. Launching Claude Code in $REPO_DIR =="
exec claude
