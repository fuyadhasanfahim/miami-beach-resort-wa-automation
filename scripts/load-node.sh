# Sourced by setup.sh and start-*.sh. Makes sure `node` is on PATH.
# Tries, in order: current PATH, vendored ./vendor/node, then common Node
# version managers (nvm, fnm, volta, asdf, Homebrew). Always returns success
# so a caller running with `set -e` is never aborted by this file.

_ln_root="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd)"

_ln_try() {
  [ -d "$1" ] || return 1
  case ":$PATH:" in
    *":$1:"*) ;;
    *) PATH="$1:$PATH"; export PATH ;;
  esac
  command -v node >/dev/null 2>&1
}

_ln_load() {
  command -v node >/dev/null 2>&1 && return 0

  if [ -d "$_ln_root/vendor/node" ]; then
    _b="$(ls -d "$_ln_root"/vendor/node/node-v*/bin 2>/dev/null | head -1)"
    [ -z "$_b" ] && _b="$(ls -d "$_ln_root"/vendor/node/node-v*-win-* 2>/dev/null | head -1)"
    [ -n "$_b" ] && _ln_try "$_b" && return 0
  fi

  _nvm="${NVM_DIR:-$HOME/.nvm}"
  if [ -d "$_nvm/versions/node" ]; then
    _v=""
    [ -f "$_nvm/alias/default" ] && _v="$(cat "$_nvm/alias/default" 2>/dev/null)"
    _d=""
    [ -n "$_v" ] && [ -d "$_nvm/versions/node/v$_v" ] && _d="$_nvm/versions/node/v$_v"
    [ -z "$_d" ] && [ -n "$_v" ] && [ -d "$_nvm/versions/node/$_v" ] && _d="$_nvm/versions/node/$_v"
    [ -z "$_d" ] && _d="$(ls -d "$_nvm"/versions/node/v* 2>/dev/null | sort -V | tail -1)"
    [ -n "$_d" ] && _ln_try "$_d/bin" && return 0
  fi

  _ln_try "$HOME/.volta/bin" && return 0
  _ln_try "$HOME/.local/share/fnm/aliases/default/bin" && return 0
  _ln_try "$HOME/.fnm/aliases/default/bin" && return 0
  _ln_try "$HOME/.asdf/shims" && return 0
  _ln_try "/opt/homebrew/bin" && return 0
  _ln_try "/usr/local/bin" && return 0
  return 0
}

_ln_load || true
unset -f _ln_try _ln_load 2>/dev/null || true
unset _ln_root _b _nvm _v _d 2>/dev/null || true
true
