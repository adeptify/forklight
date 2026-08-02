import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkerNetworkPolicy,
  DEFAULT_NO_PROXY,
  freezeWorkerNetworkPolicy,
  validateWorkerNetworkPolicy,
  workerNetworkPolicyMode,
} from "../src/core/network-policy.js";

test("validateWorkerNetworkPolicy accepts the three closed modes and legacy absence", () => {
  assert.equal(validateWorkerNetworkPolicy(undefined), undefined);
  assert.deepEqual(validateWorkerNetworkPolicy({ mode: "inherit" }), { mode: "inherit" });
  assert.deepEqual(validateWorkerNetworkPolicy({ mode: "direct" }), { mode: "direct" });
  assert.deepEqual(validateWorkerNetworkPolicy({
    mode: "custom-proxy",
    httpProxy: "http://127.0.0.1:7890",
  }), {
    mode: "custom-proxy",
    httpProxy: "http://127.0.0.1:7890",
  });
  assert.deepEqual(validateWorkerNetworkPolicy({
    mode: "custom-proxy",
    httpProxy: "https://proxy.internal:8080",
    httpsProxy: "https://proxy.internal:8443",
    noProxy: "localhost,127.0.0.1,::1,*.corp",
  }), {
    mode: "custom-proxy",
    httpProxy: "https://proxy.internal:8080",
    httpsProxy: "https://proxy.internal:8443",
    noProxy: "localhost,127.0.0.1,::1,*.corp",
  });
});

test("validateWorkerNetworkPolicy rejects credentials, control chars, schemes, and missing httpProxy", () => {
  const secretUrl = "http://user:secret-token@proxy.internal:7890";
  assert.throws(
    () => validateWorkerNetworkPolicy({ mode: "custom-proxy", httpProxy: secretUrl }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.ok(!message.includes(secretUrl), "error must not echo the proxy URL");
      assert.ok(!message.includes("secret-token"), "error must not echo credentials");
      assert.ok(!message.includes("proxy.internal"), "error must not echo the hostname");
      return /embedded credentials/.test(message);
    },
  );
  assert.throws(
    () => validateWorkerNetworkPolicy({ mode: "custom-proxy", httpProxy: "ftp://proxy:21" }),
    /http:\/\/ or https:\/\//,
  );
  assert.throws(
    () => validateWorkerNetworkPolicy({ mode: "custom-proxy", httpProxy: "http://proxy:8080\r\n" }),
    /embedded credentials/,
  );
  assert.throws(
    () => validateWorkerNetworkPolicy({ mode: "custom-proxy", httpProxy: "http://proxy:8080 " }),
    /embedded credentials/,
  );
  assert.throws(
    () => validateWorkerNetworkPolicy({ mode: "custom-proxy" }),
    /requires an httpProxy URL/,
  );
});

test("validateWorkerNetworkPolicy enforces plain origin semantics for proxy URLs", () => {
  for (const bad of [
    "http://proxy:0",
    "http://proxy:70000",
    "http://proxy:abc",
    "http://proxy:8080:9090",
    "http://proxy:8080/path",
    "http://proxy:8080?x=1",
    "http://proxy:8080#frag",
    "http://proxy/",
    "http://:8080",
    "http://user:pass@proxy:8080",
    "http://proxy:8080 ",
  ]) {
    assert.throws(
      () => validateWorkerNetworkPolicy({ mode: "custom-proxy", httpProxy: bad }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.ok(!message.includes(bad), "error must never echo the rejected proxy URL");
        return /embedded credentials, path, query, or fragment/.test(message);
      },
      `must reject ${JSON.stringify(bad)}`,
    );
  }
  for (const ok of [
    "http://127.0.0.1:7890",
    "https://proxy.internal:8443",
    "http://localhost",
    "http://proxy.corp",
    "https://10.0.0.5",
  ]) {
    assert.deepEqual(validateWorkerNetworkPolicy({ mode: "custom-proxy", httpProxy: ok }), {
      mode: "custom-proxy",
      httpProxy: ok,
    }, `must accept ${JSON.stringify(ok)}`);
  }
  assert.throws(
    () => validateWorkerNetworkPolicy({ mode: "custom-proxy", httpProxy: "http://proxy:8080", unknown: 1 }),
    /unsupported field/,
  );
  assert.throws(
    () => validateWorkerNetworkPolicy({ mode: "inherit", extra: true }),
    /unsupported field/,
  );
  assert.throws(
    () => validateWorkerNetworkPolicy({ mode: "tunnel" }),
    /inherit, direct, or custom-proxy/,
  );
  assert.throws(
    () => validateWorkerNetworkPolicy("proxy"),
    /must be an object/,
  );
});

test("validateWorkerNetworkPolicy rejects malformed no-proxy values without echoing them", () => {
  const malformed = "localhost, bad, space";
  assert.throws(
    () => validateWorkerNetworkPolicy({
      mode: "custom-proxy",
      httpProxy: "http://127.0.0.1:7890",
      noProxy: malformed,
    }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.ok(!message.includes(malformed), "error must not echo the no-proxy value");
      return /noProxy is malformed/.test(message);
    },
  );
  assert.throws(
    () => validateWorkerNetworkPolicy({
      mode: "custom-proxy",
      httpProxy: "http://127.0.0.1:7890",
      noProxy: "localhost,,127.0.0.1",
    }),
    /noProxy is malformed/,
  );
  assert.throws(
    () => validateWorkerNetworkPolicy({
      mode: "custom-proxy",
      httpProxy: "http://127.0.0.1:7890",
      noProxy: "localhost\n127.0.0.1",
    }),
    /noProxy is malformed/,
  );
});

test("applyWorkerNetworkPolicy preserves inherit and legacy absence without mutation", () => {
  const base: NodeJS.ProcessEnv = {
    HTTP_PROXY: "http://daemon:1",
    https_proxy: "http://daemon:2",
    NO_PROXY: "internal.corp",
    API_TOKEN: "secret",
    OTHER: "value",
  };
  const inherit = applyWorkerNetworkPolicy(base, { mode: "inherit" });
  assert.deepEqual(inherit, base);
  assert.equal(inherit.API_TOKEN, "secret");

  const absent = applyWorkerNetworkPolicy(base, undefined);
  assert.deepEqual(absent, base);

  const frozen = Object.freeze({ ...base });
  const fromFrozen = applyWorkerNetworkPolicy(frozen, { mode: "inherit" });
  assert.deepEqual(fromFrozen, base);
  // The caller's object must never be mutated.
  assert.equal(base.HTTP_PROXY, "http://daemon:1");
  assert.equal(base.NO_PROXY, "internal.corp");
});

test("applyWorkerNetworkPolicy direct removes every proxy variable and nothing else", () => {
  const base: NodeJS.ProcessEnv = {
    HTTP_PROXY: "http://u:1",
    http_proxy: "http://u:1",
    HTTPS_PROXY: "http://u:2",
    https_proxy: "http://u:2",
    ALL_PROXY: "http://u:3",
    all_proxy: "http://u:3",
    NO_PROXY: "internal.corp",
    no_proxy: "internal.corp",
    API_TOKEN: "secret",
    OTHER: "value",
  };
  const direct = applyWorkerNetworkPolicy(base, { mode: "direct" });
  for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy",
    "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"]) {
    assert.equal(key in direct, false, `${key} must be removed`);
  }
  assert.equal(direct.API_TOKEN, "secret");
  assert.equal(direct.OTHER, "value");
});

test("applyWorkerNetworkPolicy custom sets upper/lower HTTP/HTTPS and safe NO_PROXY default", () => {
  const base: NodeJS.ProcessEnv = {
    HTTP_PROXY: "http://old:1",
    http_proxy: "http://old:1",
    ALL_PROXY: "http://old:2",
    all_proxy: "http://old:2",
    NO_PROXY: "old.corp",
    no_proxy: "old.corp",
    API_TOKEN: "secret",
  };
  const custom = applyWorkerNetworkPolicy(base, {
    mode: "custom-proxy",
    httpProxy: "http://127.0.0.1:7890",
  });
  assert.equal(custom.HTTP_PROXY, "http://127.0.0.1:7890");
  assert.equal(custom.http_proxy, "http://127.0.0.1:7890");
  // HTTPS falls back to httpProxy when no separate httpsProxy is configured.
  assert.equal(custom.HTTPS_PROXY, "http://127.0.0.1:7890");
  assert.equal(custom.https_proxy, "http://127.0.0.1:7890");
  assert.equal(custom.NO_PROXY, DEFAULT_NO_PROXY);
  assert.equal(custom.no_proxy, DEFAULT_NO_PROXY);
  // Stale ALL_PROXY and no-proxy values are cleaned before setting.
  assert.equal("ALL_PROXY" in custom, false);
  assert.equal("all_proxy" in custom, false);
  assert.equal(custom.API_TOKEN, "secret");
});

test("applyWorkerNetworkPolicy custom honors explicit httpsProxy and noProxy bounds", () => {
  const base: NodeJS.ProcessEnv = { HTTP_PROXY: "http://old:1" };
  const custom = applyWorkerNetworkPolicy(base, {
    mode: "custom-proxy",
    httpProxy: "http://127.0.0.1:7890",
    httpsProxy: "http://127.0.0.1:7891",
    noProxy: "localhost,127.0.0.1",
  });
  assert.equal(custom.HTTPS_PROXY, "http://127.0.0.1:7891");
  assert.equal(custom.https_proxy, "http://127.0.0.1:7891");
  assert.equal(custom.NO_PROXY, "localhost,127.0.0.1");
  assert.equal(custom.no_proxy, "localhost,127.0.0.1");
});

test("workerNetworkPolicyMode and freeze produce safe immutable evidence", () => {
  assert.equal(workerNetworkPolicyMode(undefined), "inherit");
  assert.equal(workerNetworkPolicyMode({ mode: "direct" }), "direct");
  assert.equal(workerNetworkPolicyMode({ mode: "custom-proxy", httpProxy: "http://x:1" }), "custom-proxy");

  const frozen = freezeWorkerNetworkPolicy({
    mode: "custom-proxy",
    httpProxy: "http://127.0.0.1:7890",
    httpsProxy: "http://127.0.0.1:7891",
    noProxy: "localhost",
  });
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(Object.isFrozen({ ...frozen }), false, "frozen snapshot is a distinct object");
  assert.throws(() => {
    (frozen as { httpProxy: string }).httpProxy = "http://evil:1";
  }, TypeError);
});
