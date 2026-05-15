#!/usr/bin/env bash
#
# facet CLI installer
#
# Source of truth: this file (packages/landing/scripts/install.sh).
# Served at: https://agentfacets.io/install
#
# Usage:
#   curl -fsSL https://agentfacets.io/install | bash
#   curl -fsSL https://agentfacets.io/install | bash -s -- --version 0.5.3
#   ./install.sh --binary /path/to/facet
#
# Target-selection: the platform detection logic picks a single
# @agent-facets/cli-<target> npm package. See build_target() below for
# the canonical rules.

set -euo pipefail

# ---------------------------------------------------------------------------
# Style
# ---------------------------------------------------------------------------

if [[ -t 1 ]]; then
    RED=$'\033[0;31m'
    GREEN=$'\033[0;32m'
    ORANGE=$'\033[38;5;214m'
    DIM=$'\033[0;2m'
    BOLD=$'\033[1m'
    RESET=$'\033[0m'
else
    RED=''
    GREEN=''
    ORANGE=''
    DIM=''
    BOLD=''
    RESET=''
fi

error() {
    printf '%bError:%b %s\n' "$RED" "$RESET" "$*" >&2
    exit 1
}

info() {
    printf '%b%s%b\n' "$DIM" "$*" "$RESET"
}

success() {
    printf '%b%s%b\n' "$GREEN" "$*" "$RESET"
}

warn() {
    printf '%bWarning:%b %s\n' "$ORANGE" "$RESET" "$*" >&2
}

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------

usage() {
    cat <<EOF
facet installer

Usage: install.sh [options]

Options:
  -h, --help                Show this help and exit
  -v, --version <version>   Install a specific version (e.g. 0.5.3)
  -b, --binary <path>       Install from a local binary, skip download
      --no-modify-path      Do not modify any shell rc files

Environment:
  FACET_VERSION             Same as --version (flag wins if both are set)
  FACET_DIR                 Facet directory root (default: \$HOME/.facet)
                            Binary goes in <dir>/bin/facet; cache, adapters,
                            and install locks share the same root.
  FACET_CLI_REGISTRY        npm registry base URL for CLI tarballs
                            (default: https://registry.npmjs.org)

Examples:
  curl -fsSL https://agentfacets.io/install | bash
  curl -fsSL https://agentfacets.io/install | bash -s -- --version 0.5.3
  FACET_DIR=/opt/facet curl -fsSL https://agentfacets.io/install | bash
  ./install.sh --binary ./dist/facet
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

requested_version=${FACET_VERSION:-}
binary_path=""
no_modify_path=false
facet_cli_registry=${FACET_CLI_REGISTRY:-https://registry.npmjs.org}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -v|--version)
            [[ -n "${2:-}" ]] || error "--version requires an argument"
            requested_version="$2"
            shift 2
            ;;
        -b|--binary)
            [[ -n "${2:-}" ]] || error "--binary requires an argument"
            binary_path="$2"
            shift 2
            ;;
        --no-modify-path)
            no_modify_path=true
            shift
            ;;
        *)
            warn "unknown option '$1'"
            shift
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Early exit: Windows (native)
# ---------------------------------------------------------------------------

raw_os=$(uname -s 2>/dev/null || echo unknown)

case "$raw_os" in
    MINGW*|MSYS*|CYGWIN*|Windows_NT*)
        printf '%b' "$RED"
        cat >&2 <<'EOF'
Error: Windows is not supported by this installer.

The facet CLI is distributed via npm for Windows. Install with:

    npm install -g agent-facets

For progress on native Windows support:
    https://docs.agentfacets.io/roadmap

WSL users: this script works inside WSL.
EOF
        printf '%b' "$RESET"
        exit 1
        ;;
esac

# ---------------------------------------------------------------------------
# Preflight: required tools
# ---------------------------------------------------------------------------

require_tool() {
    command -v "$1" >/dev/null 2>&1 || error "'$1' is required but not installed"
}

require_tool curl
require_tool tar

if command -v sha1sum >/dev/null 2>&1; then
    sha1_cmd() { sha1sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
    sha1_cmd() { shasum -a 1 "$1" | awk '{print $1}'; }
else
    error "'sha1sum' or 'shasum' is required for integrity verification"
fi

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------

detect_os() {
    case "$raw_os" in
        Darwin*) echo darwin ;;
        Linux*)  echo linux ;;
        *)       error "unsupported OS: $raw_os" ;;
    esac
}

detect_arch() {
    local m
    m=$(uname -m 2>/dev/null || echo unknown)
    case "$m" in
        x86_64|amd64)   echo x64 ;;
        aarch64|arm64)  echo arm64 ;;
        *)              error "unsupported architecture: $m" ;;
    esac
}

detect_rosetta_arm64() {
    # On darwin-x64, check if we're actually running under Rosetta on an
    # arm64 chip. If so, prefer the arm64 binary.
    local os=$1 arch=$2
    if [[ "$os" == "darwin" && "$arch" == "x64" ]]; then
        if [[ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" == "1" ]]; then
            echo arm64
            return
        fi
    fi
    echo "$arch"
}

supports_avx2() {
    local os=$1
    if [[ "$os" == "linux" ]]; then
        grep -qwi avx2 /proc/cpuinfo 2>/dev/null && return 0 || return 1
    fi
    if [[ "$os" == "darwin" ]]; then
        [[ "$(sysctl -n hw.optional.avx2_0 2>/dev/null || echo 0)" == "1" ]] && return 0 || return 1
    fi
    return 1
}

is_musl() {
    [[ -f /etc/alpine-release ]] && return 0
    if command -v ldd >/dev/null 2>&1; then
        ldd --version 2>&1 | grep -qi musl && return 0
    fi
    return 1
}

# Build the target string: <os>-<arch>[-baseline][-musl]
# This is the canonical shell-side implementation. Parity with the npm
# postinstall.mjs in the agent-facets/facets repo should be enforced by
# that repo's CI — not here.
build_target() {
    local os=$1 arch=$2 needs_baseline=$3 musl=$4
    local target="$os-$arch"
    if [[ "$arch" == "x64" && "$needs_baseline" == "true" ]]; then
        target+="-baseline"
    fi
    if [[ "$os" == "linux" && "$musl" == "true" ]]; then
        target+="-musl"
    fi
    echo "$target"
}

os=$(detect_os)
arch=$(detect_arch)
arch=$(detect_rosetta_arm64 "$os" "$arch")

needs_baseline=false
if [[ "$arch" == "x64" ]]; then
    if ! supports_avx2 "$os"; then
        needs_baseline=true
    fi
fi

musl=false
if [[ "$os" == "linux" ]] && is_musl; then
    musl=true
fi

target=$(build_target "$os" "$arch" "$needs_baseline" "$musl")

# Validate combo (defense in depth — detect_os/detect_arch already filter)
case "$os-$arch" in
    darwin-arm64|darwin-x64|linux-arm64|linux-x64) ;;
    *) error "unsupported platform: $os-$arch" ;;
esac

# ---------------------------------------------------------------------------
# Install paths
# ---------------------------------------------------------------------------

install_root=${FACET_DIR:-$HOME/.facet}
install_bin=$install_root/bin
install_path=$install_bin/facet

# ---------------------------------------------------------------------------
# Resolve download URL + integrity
# ---------------------------------------------------------------------------

package_name="@agent-facets/cli-$target"
specific_version=""
tarball_url=""
expected_shasum=""

if [[ -n "$binary_path" ]]; then
    [[ -f "$binary_path" ]] || error "binary not found at: $binary_path"
    specific_version="local"
elif [[ -n "$requested_version" ]]; then
    # Strip leading v
    specific_version="${requested_version#v}"
    tarball_url="${facet_cli_registry}/${package_name}/-/cli-${target}-${specific_version}.tgz"
    # Verify release exists via HEAD before downloading
    http_status=$(curl -sSI -o /dev/null -w "%{http_code}" "$tarball_url" || echo 000)
    if [[ "$http_status" == "404" ]]; then
        error "version ${specific_version} not found for target ${target} (see https://www.npmjs.com/package/agent-facets for available versions)"
    fi
    # No shasum for explicit versions — we don't fetch metadata.
else
    # Default: ask npm for the platform package's latest. This endpoint is
    # self-verifying: if it returns 200, the binary for this platform has
    # been successfully published.
    meta_url="${facet_cli_registry}/${package_name}/latest"
    if ! meta=$(curl -sSfL "$meta_url" 2>/dev/null); then
        error "failed to fetch metadata for ${package_name} (no published binary for ${target}?)"
    fi
    specific_version=$(printf '%s' "$meta" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | head -n1)
    tarball_url=$(printf '%s' "$meta" | sed -n 's/.*"tarball":"\([^"]*\)".*/\1/p' | head -n1)
    expected_shasum=$(printf '%s' "$meta" | sed -n 's/.*"shasum":"\([^"]*\)".*/\1/p' | head -n1)
    [[ -n "$specific_version" ]] || error "could not parse version from npm metadata"
    [[ -n "$tarball_url" ]]      || error "could not parse tarball URL from npm metadata"
    [[ -n "$expected_shasum" ]]  || error "could not parse shasum from npm metadata"
fi

# ---------------------------------------------------------------------------
# Short-circuit if already installed at the requested version
# ---------------------------------------------------------------------------

if [[ -z "$binary_path" && -x "$install_path" ]]; then
    installed_version=$("$install_path" --version 2>/dev/null | head -n1 | awk '{print $NF}' || echo "")
    # Normalize
    installed_version=${installed_version#v}
    if [[ -n "$installed_version" && "$installed_version" == "$specific_version" ]]; then
        info "facet ${specific_version} already installed at ${install_path}"
        exit 0
    fi
fi

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

mkdir -p "$install_bin" || error "failed to create install dir: $install_bin"

if [[ -n "$binary_path" ]]; then
    info "Installing facet from local binary: $binary_path"
    cp "$binary_path" "$install_path" || error "failed to copy binary"
    chmod 755 "$install_path"
else
    info "Installing facet ${specific_version} (${target})"

    tmp_dir=$(mktemp -d)
    # shellcheck disable=SC2064
    trap "rm -rf '$tmp_dir'" EXIT

    tarball_file="$tmp_dir/pkg.tgz"

    if ! curl -fSL --progress-bar -o "$tarball_file" "$tarball_url"; then
        error "failed to download: $tarball_url"
    fi

    # Integrity check (only when we have a known shasum — i.e. not --version path)
    if [[ -n "$expected_shasum" ]]; then
        actual_shasum=$(sha1_cmd "$tarball_file")
        if [[ "$actual_shasum" != "$expected_shasum" ]]; then
            error "integrity check failed: expected ${expected_shasum}, got ${actual_shasum}"
        fi
    fi

    tar -xzf "$tarball_file" -C "$tmp_dir" || error "failed to extract tarball"

    extracted_binary="$tmp_dir/package/bin/facet"
    [[ -f "$extracted_binary" ]] || error "extracted tarball did not contain package/bin/facet"

    mv "$extracted_binary" "$install_path" || error "failed to install binary to $install_path"
    chmod 755 "$install_path"
fi

# ---------------------------------------------------------------------------
# Shell rc PATH injection
# ---------------------------------------------------------------------------

tildify() {
    if [[ "$1" == "$HOME"* ]]; then
        printf '~%s' "${1#"$HOME"}"
    else
        printf '%s' "$1"
    fi
}

add_to_rc() {
    local rc_file=$1 line=$2
    if grep -Fxq "$line" "$rc_file" 2>/dev/null; then
        return 0
    fi
    if [[ -w "$rc_file" ]]; then
        printf '\n# facet\n%s\n' "$line" >> "$rc_file"
        info "Added facet to \$PATH in $(tildify "$rc_file")"
        return 0
    fi
    return 1
}

modified_rc=""
path_already_set=false
case ":$PATH:" in
    *":$install_bin:"*) path_already_set=true ;;
esac

if [[ "$no_modify_path" != "true" && "$path_already_set" != "true" ]]; then
    XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}
    current_shell=$(basename "${SHELL:-bash}")

    case "$current_shell" in
        fish)
            rc_candidates=("$HOME/.config/fish/config.fish")
            rc_line="fish_add_path $install_bin"
            ;;
        zsh)
            rc_candidates=(
                "${ZDOTDIR:-$HOME}/.zshrc"
                "${ZDOTDIR:-$HOME}/.zshenv"
                "$XDG_CONFIG_HOME/zsh/.zshrc"
                "$XDG_CONFIG_HOME/zsh/.zshenv"
            )
            rc_line="export PATH=\"$install_bin:\$PATH\""
            ;;
        bash)
            rc_candidates=(
                "$HOME/.bashrc"
                "$HOME/.bash_profile"
                "$HOME/.profile"
                "$XDG_CONFIG_HOME/bash/.bashrc"
                "$XDG_CONFIG_HOME/bash/.bash_profile"
            )
            rc_line="export PATH=\"$install_bin:\$PATH\""
            ;;
        ash|sh)
            rc_candidates=("$HOME/.ashrc" "$HOME/.profile")
            rc_line="export PATH=\"$install_bin:\$PATH\""
            ;;
        *)
            rc_candidates=("$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile")
            rc_line="export PATH=\"$install_bin:\$PATH\""
            ;;
    esac

    for rc_file in "${rc_candidates[@]}"; do
        if [[ -f "$rc_file" ]] && add_to_rc "$rc_file" "$rc_line"; then
            modified_rc=$rc_file
            break
        fi
    done

    if [[ -z "$modified_rc" ]]; then
        warn "no writable shell rc file found; add this to your shell config manually:"
        printf '  %b%s%b\n' "$BOLD" "$rc_line" "$RESET"
    fi
fi

# GitHub Actions
if [[ "${GITHUB_ACTIONS:-}" == "true" && -n "${GITHUB_PATH:-}" ]]; then
    echo "$install_bin" >> "$GITHUB_PATH"
    info "Added $install_bin to \$GITHUB_PATH"
fi

# ---------------------------------------------------------------------------
# Success banner
# ---------------------------------------------------------------------------

printf '\n'
printf '  %b✓%b facet %b%s%b installed to %b%s%b\n' \
    "$GREEN" "$RESET" "$BOLD" "$specific_version" "$RESET" "$BOLD" "$(tildify "$install_path")" "$RESET"
printf '\n'

if [[ -n "$modified_rc" ]]; then
    printf '  Restart your shell or run %b source %s %b to pick up the PATH change.\n\n' \
        "$BOLD" "$(tildify "$modified_rc")" "$RESET"
fi

printf '  Get started:\n\n'
printf '    %bcd <project>%b\n' "$BOLD" "$RESET"
printf '    %bfacet --help%b\n' "$BOLD" "$RESET"
printf '\n'
printf '  Docs: %bhttps://docs.agentfacets.io%b\n\n' "$DIM" "$RESET"
