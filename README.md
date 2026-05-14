# nexus-grid-static

Dashboard mounting.

## Temporary local deep-learning model

Use `scripts/temp-local-deep-learning-model.sh` to spin up an Ollama-backed
local model in Docker for short-lived development and testing. The script:

- starts an Ollama container bound to `127.0.0.1` only;
- pulls a small default model (`llama3.2:1b`) unless you choose another model;
- exposes the Ollama API on `http://127.0.0.1:11434`;
- removes the container and temporary model cache when you press `Ctrl+C`.

```bash
scripts/temp-local-deep-learning-model.sh
```

Choose a different model or port:

```bash
scripts/temp-local-deep-learning-model.sh --model qwen2.5:1.5b --port 11435
```

Keep the model weights between runs if you do not want to pull them repeatedly:

```bash
scripts/temp-local-deep-learning-model.sh --keep-cache
```

Start in detached mode and clean up manually later:

```bash
scripts/temp-local-deep-learning-model.sh --detach
# later:
docker rm -f nexus-temp-ollama
```

Quick health check after the script reports that the model is ready:

```bash
curl http://127.0.0.1:11434/api/generate \
  -d '{"model":"llama3.2:1b","prompt":"Reply with one sentence about Nexus Grid.","stream":false}'
```
