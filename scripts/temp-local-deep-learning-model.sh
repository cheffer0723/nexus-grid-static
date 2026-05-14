#!/usr/bin/env bash
set -Eeuo pipefail

# Start a temporary local deep-learning/LLM server with Ollama in Docker.
# Defaults favor a small model so this can run on most developer laptops.

MODEL="${MODEL:-llama3.2:1b}"
PORT="${PORT:-11434}"
CONTAINER_NAME="${CONTAINER_NAME:-nexus-temp-ollama}"
KEEP_CACHE=0
DETACH=0
VOLUME_NAME=""

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Starts a temporary Ollama server locally, pulls a model, and prints a curl
command you can use from the dashboard or local tools. Press Ctrl+C to clean up.

Options:
  -m, --model MODEL       Ollama model to pull/run (default: ${MODEL})
  -p, --port PORT         Host port to expose Ollama on (default: ${PORT})
      --name NAME         Docker container name (default: ${CONTAINER_NAME})
      --keep-cache        Keep the Docker volume with model weights after exit
  -d, --detach            Start, pull, print status, and exit without cleanup trap
  -h, --help              Show this help

Environment overrides:
  MODEL, PORT, CONTAINER_NAME

Examples:
  $(basename "$0")
  $(basename "$0") --model qwen2.5:1.5b --port 11435
  MODEL=llama3.2:3b $(basename "$0") --keep-cache
USAGE
}

log() {
  printf '[local-model] %s\n' "$*"
}

fail() {
  printf '[local-model] ERROR: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--model)
      [[ $# -ge 2 ]] || fail "$1 requires a value"
      MODEL="$2"
      shift 2
      ;;
    -p|--port)
      [[ $# -ge 2 ]] || fail "$1 requires a value"
      PORT="$2"
      shift 2
      ;;
    --name)
      [[ $# -ge 2 ]] || fail "$1 requires a value"
      CONTAINER_NAME="$2"
      shift 2
      ;;
    --keep-cache)
      KEEP_CACHE=1
      shift
      ;;
    -d|--detach)
      DETACH=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

[[ "$PORT" =~ ^[0-9]+$ ]] || fail "PORT must be numeric"
command -v docker >/dev/null 2>&1 || fail "Docker is required. Install/start Docker, then rerun this script."
docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable. Start Docker, then rerun this script."

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  fail "A Docker container named ${CONTAINER_NAME} already exists. Remove it or pass --name."
fi

VOLUME_NAME="${CONTAINER_NAME}-data-$(date +%s)"

cleanup() {
  local exit_code=$?
  if [[ "$DETACH" -eq 0 ]]; then
    log "Stopping temporary model container..."
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    if [[ "$KEEP_CACHE" -eq 0 && -n "$VOLUME_NAME" ]]; then
      log "Removing temporary model cache volume ${VOLUME_NAME}..."
      docker volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
    elif [[ -n "$VOLUME_NAME" ]]; then
      log "Keeping model cache volume ${VOLUME_NAME}."
    fi
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

log "Creating Docker volume ${VOLUME_NAME} for this run..."
docker volume create "$VOLUME_NAME" >/dev/null

log "Starting Ollama on http://127.0.0.1:${PORT} with container ${CONTAINER_NAME}..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -p "127.0.0.1:${PORT}:11434" \
  -v "${VOLUME_NAME}:/root/.ollama" \
  ollama/ollama:latest >/dev/null

log "Waiting for Ollama API to become ready..."
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER_NAME" ollama list >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "$CONTAINER_NAME" ollama list >/dev/null 2>&1 || fail "Ollama did not become ready in time."

log "Pulling model ${MODEL}. This can take several minutes the first time..."
docker exec "$CONTAINER_NAME" ollama pull "$MODEL"

cat <<READY

Local deep-learning model is ready.

Base URL: http://127.0.0.1:${PORT}
Model:    ${MODEL}

Quick test:
  curl http://127.0.0.1:${PORT}/api/generate \\
    -d '{"model":"${MODEL}","prompt":"Reply with one sentence about Nexus Grid.","stream":false}'

OpenAI-compatible chat endpoint:
  curl http://127.0.0.1:${PORT}/v1/chat/completions \\
    -H 'Content-Type: application/json' \\
    -d '{"model":"${MODEL}","messages":[{"role":"user","content":"Say hello"}]}'
READY

if [[ "$DETACH" -eq 1 ]]; then
  cat <<DETACHED

Detached mode is enabled. The container will continue running.
To stop and remove it later:
  docker rm -f ${CONTAINER_NAME}
  docker volume rm ${VOLUME_NAME}
DETACHED
  trap - EXIT INT TERM
  exit 0
fi

log "Press Ctrl+C to stop and remove the temporary local model."
while docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; do
  sleep 5
done
