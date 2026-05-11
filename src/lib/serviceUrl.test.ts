import { extractServiceUrl } from "./serviceUrl.js";

function assertEqual(actual: unknown, expected: unknown, name: string) {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

assertEqual(
  extractServiceUrl("main: server is listening on http://localhost:8080"),
  "http://localhost:8080/",
  "extracts localhost URL from server listening line"
);

assertEqual(
  extractServiceUrl("main: server is listening on http://0.0.0.0:8080"),
  "http://localhost:8080/",
  "normalizes wildcard IPv4 host to localhost"
);

assertEqual(
  extractServiceUrl("main: server is listening on http://[::]:8080"),
  "http://localhost:8080/",
  "normalizes wildcard IPv6 host to localhost"
);

assertEqual(
  extractServiceUrl("model metadata url https://huggingface.co/unsloth/Qwen3"),
  null,
  "ignores external model metadata URLs without server listening marker"
);

assertEqual(
  extractServiceUrl("main: server is listening on https://huggingface.co/unsloth"),
  "https://huggingface.co/unsloth",
  "does not filter hosts when server listening marker exists"
);

assertEqual(
  extractServiceUrl("server listening at http://192.168.1.10:8081"),
  null,
  "ignores URL lines without exact server is listening marker"
);

assertEqual(
  extractServiceUrl("llama server loading model"),
  null,
  "returns null when the log line has no URL"
);
