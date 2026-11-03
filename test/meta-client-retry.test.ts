import assert from "node:assert/strict";
import test from "node:test";
import { MetaClient } from "../src/llm/meta-client.ts";

test("MetaClient retries on 503 and succeeds on subsequent attempt", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  const recordedRetries: any[] = [];

  globalThis.fetch = async () => {
    attempts++;
    if (attempts === 1) {
      return new Response(JSON.stringify({ error: { message: "Service temporarily overloaded", code: 503 } }), {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "Content-Type": "application/json" },
      });
    }
    return Response.json({
      choices: [{
        finish_reason: "stop",
        message: { content: "{\"description\":\"test\",\"expectedInvariant\":\"r04-network-idempotency\",\"interventions\":[\"drop_response\"],\"rationale\":\"test\",\"confidence\":0.9}", tool_calls: [] },
      }],
    });
  };

  try {
    const client = new MetaClient({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      maxRetries: 2,
      onRetry: (r) => recordedRetries.push(r),
    });
    const res = await client.chat([{ role: "user", content: "hello" }], []);
    assert.equal(attempts, 2);
    assert.equal(recordedRetries.length, 1);
    assert.equal(recordedRetries[0].status, 503);
    assert.ok(res.text.includes("r04-network-idempotency"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MetaClient exhausts retries on repeated 503s and fails explicitly", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = async () => {
    attempts++;
    return new Response(JSON.stringify({ error: { message: "Service temporarily overloaded", code: 503 } }), {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const client = new MetaClient({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      maxRetries: 2,
    });
    await assert.rejects(
      async () => {
        await client.chat([{ role: "user", content: "hello" }], []);
      },
      /LLM API 503/
    );
    assert.equal(attempts, 3); // initial + 2 retries
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MetaClient does not retry on 400 Bad Request", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = async () => {
    attempts++;
    return new Response(JSON.stringify({ error: { message: "Bad Request", code: 400 } }), {
      status: 400,
      statusText: "Bad Request",
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const client = new MetaClient({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      maxRetries: 3,
    });
    await assert.rejects(
      async () => {
        await client.chat([{ role: "user", content: "hello" }], []);
      },
      /LLM API 400/
    );
    assert.equal(attempts, 1); // fails immediately
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MetaClient parses Retry-After header", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  const recordedRetries: any[] = [];

  globalThis.fetch = async () => {
    attempts++;
    if (attempts === 1) {
      return new Response(JSON.stringify({ error: { message: "Rate limit", code: 429 } }), {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "Content-Type": "application/json", "Retry-After": "1" },
      });
    }
    return Response.json({
      choices: [{
        finish_reason: "stop",
        message: { content: "ok", tool_calls: [] },
      }],
    });
  };

  try {
    const client = new MetaClient({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      maxRetries: 1,
      onRetry: (r) => recordedRetries.push(r),
    });
    const res = await client.chat([{ role: "user", content: "hello" }], []);
    assert.equal(attempts, 2);
    assert.equal(recordedRetries.length, 1);
    assert.equal(recordedRetries[0].status, 429);
    assert.ok(recordedRetries[0].delayMs >= 1000);
    assert.equal(res.text, "ok");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

