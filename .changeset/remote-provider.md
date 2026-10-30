---
'localnotes': minor
---

Remote agents: an OpenAI-compatible provider streams from any chat-completions endpoint (Ollama, LM Studio, vLLM, OpenAI) with tool-call support; the runtime feeds tool results back across up to four rounds until the model answers without tools. Provider settings (base URL, model, API key) persist in the settings store behind the chat drawer's panel, and endpoint access stays off until the host permission is granted explicitly. Default endpoint is the local Ollama at http://localhost:11434/v1 with model qwen3:30b-a3b.
