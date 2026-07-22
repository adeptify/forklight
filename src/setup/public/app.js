/* ForkLight setup wizard. No innerHTML, no inline handlers, no URL credentials, no browser storage. */
(function () {
  "use strict";

  function $(s) { return document.querySelector(s); }
  function $$(s) { return document.querySelectorAll(s); }
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function hd(tag, cls, kids) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (kids) kids.forEach(function (k) { if (k) e.appendChild(k); });
    return e;
  }

  var TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,256}$/;
  var MODEL_PATTERN = /^[A-Za-z0-9._\-+:\/\[\]]{1,128}$/;
  var ENDPOINT_PATTERN = /^https:\/\/[^\s]{4,256}$/;
  var STAGES = ["system", "model", "connect", "ready"];
  var state = {
    token: null,
    bootstrap: null,
    selection: { provider: null, variant: null, model: "", endpoint: "" },
    probe: null,
    plugin: null,
    stage: null
  };

  function readToken() {
    if (!location.hash || location.hash.length < 2) return null;
    var raw = location.hash.slice(1);
    var decoded;
    try { decoded = decodeURIComponent(raw); } catch (_) { return null; }
    var value = decoded.indexOf("=") >= 0 ? decoded.split("=").slice(1).join("=") : decoded;
    if (!TOKEN_PATTERN.test(value)) return null;
    if (window.history && history.replaceState) {
      try { history.replaceState(null, "", location.pathname + location.search); } catch (_) {}
    }
    return value;
  }

  function setupRequest(path, method, body) {
    if (!state.token) return Promise.reject(new Error("setup token missing"));
    var headers = {
      "X-ForkLight-Setup-Token": state.token,
      "Accept": "application/json"
    };
    var init = { method: method || "GET", headers: headers };
    if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (_) { data = null; } }
        if (!res.ok) {
          var msg = (data && (data.error || data.message)) || ("HTTP " + res.status);
          var err = new Error(String(msg).replace(/[<>"']/g, ""));
          err.status = res.status;
          err.body = data;
          throw err;
        }
        return data;
      });
    });
  }

  function showError(msg) {
    var box = $("#fl-error");
    box.textContent = "";
    if (msg) {
      box.appendChild(h("strong", "", "Setup error: "));
      box.appendChild(document.createTextNode(String(msg)));
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

  function setConn(label) { $("#fl-conn").textContent = label; }

  function showStage(name) {
    state.stage = name;
    STAGES.forEach(function (n) {
      var sec = document.getElementById("fl-stage-" + n);
      if (sec) sec.hidden = (n !== name);
    });
    var currentIndex = STAGES.indexOf(name);
    $$("#fl-steps li").forEach(function (li) {
      var order = STAGES.indexOf(li.getAttribute("data-step"));
      li.classList.remove("complete");
      if (order < currentIndex) {
        li.setAttribute("aria-current", "false");
        li.classList.add("complete");
      } else if (order === currentIndex) {
        li.setAttribute("aria-current", "step");
      } else {
        li.removeAttribute("aria-current");
      }
    });
    var sec = document.getElementById("fl-stage-" + name);
    if (sec) {
      var heading = sec.querySelector("h2");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        if (typeof heading.focus === "function") {
          try { heading.focus({ preventScroll: false }); } catch (_) {}
        }
      }
    }
  }

  function loadBootstrap() {
    setConn("connecting");
    showError("");
    var status = $("#fl-bootstrap-status");
    status.className = "state-msg loading";
    status.textContent = "Loading setup state";
    status.hidden = false;
    STAGES.forEach(function (n) {
      var sec = document.getElementById("fl-stage-" + n);
      if (sec) sec.hidden = true;
    });
    setupRequest("/api/bootstrap", "GET").then(function (data) {
      state.bootstrap = data && typeof data === "object" ? data : {};
      renderBootstrap();
    }).catch(function (err) {
      status.hidden = false;
      status.className = "state-msg error";
      status.textContent = "Setup unavailable";
      showError((err && err.message) ? err.message : "Could not load setup");
      setConn("offline");
    });
  }

  function renderBootstrap() {
    $("#fl-bootstrap-status").hidden = true;
    setConn("ready");
    renderPrereqs();
    renderProviders();
    renderProviderSummary();
    renderFinishList();
    renderProbePolicy();
    showStage("system");
  }

  function renderProbePolicy() {
    var policy = state.bootstrap && state.bootstrap.probe;
    var budget = policy && typeof policy.maxBudgetUsd === "number"
      ? " The configured maximum is $" + policy.maxBudgetUsd.toFixed(2) + "."
      : "";
    $("#fl-cost-banner").textContent =
      "This sends one real request to the provider and may incur charges." + budget +
      " You will confirm before it starts.";
  }

  function renderPrereqs() {
    var list = $("#fl-prereqs");
    list.textContent = "";
    var prereqs = (state.bootstrap && state.bootstrap.prerequisites) || [];
    if (!prereqs.length) {
      list.appendChild(hd("li", "", [h("span", "dot warn", ""), hd("div", "", [h("div", "title", "No prerequisites reported")])]));
      $("#fl-btn-system-next").hidden = true;
      return;
    }
    var blocked = false;
    prereqs.forEach(function (p) {
      var dotCls = p && p.ready ? "ok" : (p && p.blocker ? "err" : "warn");
      if (!p || !p.ready) blocked = true;
      var item = hd("li", "", [
        h("span", "dot " + dotCls, ""),
        hd("div", "", [
          h("div", "title", (p && (p.label || p.id)) || "Unknown"),
          (p && p.message) ? h("div", "desc", String(p.message)) : null
        ])
      ]);
      list.appendChild(item);
    });
    var next = $("#fl-btn-system-next");
    next.hidden = blocked;
  }

  function renderProviders() {
    var list = $("#fl-provider-list");
    list.textContent = "";
    var providers = (state.bootstrap && state.bootstrap.providers) || [];
    if (!providers.length) {
      list.appendChild(h("p", "dim", "No providers available."));
      return;
    }
    providers.forEach(function (p) {
      var input = h("input", "");
      input.type = "radio";
      input.name = "fl-provider";
      input.value = String(p.name || "");
      input.id = "fl-provider-" + p.name;
      var label = hd("label", "", [
        input,
        hd("div", "", [
          h("span", "title", (p && (p.label || p.name)) || "Unknown"),
          (p && p.configured) ? h("span", "desc configured", "Key already stored in Keychain") : null,
          (p && p.defaultModel) ? h("span", "desc", "Current default: " + p.defaultModel) : null
        ])
      ]);
      input.addEventListener("change", function () {
        list.querySelectorAll("label").forEach(function (l) { l.classList.remove("checked"); });
        label.classList.add("checked");
        state.selection.provider = p.name;
        state.probe = null;
        state.plugin = null;
        renderVariants(p);
      });
      list.appendChild(label);
      if (state.bootstrap && state.bootstrap.current && state.bootstrap.current.provider === p.name) {
        input.checked = true;
        label.classList.add("checked");
        state.selection.provider = p.name;
        renderVariants(p);
      }
    });
  }

  function renderVariants(provider) {
    var fieldset = $("#fl-variant-fs");
    var list = $("#fl-variant-list");
    list.textContent = "";
    var variants = provider.variants || [];
    fieldset.hidden = variants.length === 0;
    $("#fl-variant-legend").textContent = provider.variantLabel || "Plan or region";
    var current = state.bootstrap && state.bootstrap.current;
    var selected = variants.find(function (candidate) {
      return current && current.provider === provider.name && current.variant === candidate.id;
    }) || variants.find(function (candidate) { return candidate.recommended; }) || variants[0];
    variants.forEach(function (variant) {
      var input = h("input", "");
      input.type = "radio";
      input.name = "fl-variant";
      input.value = String(variant.id || "");
      input.id = "fl-variant-" + provider.name + "-" + variant.id;
      if (variant === selected) input.checked = true;
      var label = hd("label", "", [
        input,
        hd("div", "", [
          h("span", "title", (variant && (variant.label || variant.id)) || "Unknown"),
          (variant && variant.description) ? h("span", "desc", String(variant.description)) : null,
          (variant && variant.endpoint) ? h("span", "desc mono", String(variant.endpoint)) : null
        ])
      ]);
      if (variant === selected) label.classList.add("checked");
      input.addEventListener("change", function () {
        list.querySelectorAll("label").forEach(function (l) { l.classList.remove("checked"); });
        label.classList.add("checked");
        applyVariant(variant);
      });
      list.appendChild(label);
    });
    if (selected) applyVariant(selected);
  }

  function applyVariant(variant) {
    state.selection.variant = variant.id;
    var current = state.bootstrap && state.bootstrap.current;
    var currentMatches = current && current.provider === state.selection.provider && current.variant === variant.id;
    state.selection.model = currentMatches ? current.model : ((variant.models || [])[0] || "");
    state.selection.endpoint = "";
    var modelInput = $("#fl-model-input");
    modelInput.value = state.selection.model;
    var options = $("#fl-model-options");
    options.textContent = "";
    (variant.models || []).forEach(function (model) {
      var option = h("option", "");
      option.value = String(model);
      options.appendChild(option);
    });
    $("#fl-endpoint-input").placeholder = variant.endpoint || "https://";
    $("#fl-endpoint-input").value = "";
  }

  function selectedProvider() {
    var name = state.selection.provider;
    if (!name) return null;
    var providers = (state.bootstrap && state.bootstrap.providers) || [];
    for (var i = 0; i < providers.length; i++) {
      if (providers[i].name === name) return providers[i];
    }
    return null;
  }

  function selectedVariant() {
    var provider = selectedProvider();
    if (!provider) return null;
    return (provider.variants || []).find(function (candidate) {
      return candidate.id === state.selection.variant;
    }) || null;
  }

  function submitModel(e) {
    if (e) e.preventDefault();
    showError("");
    var provider = selectedProvider();
    if (!provider) { showError("Choose a provider before continuing."); return; }
    if (!selectedVariant()) { showError("Choose the plan or account region that created this API key."); return; }
    var modelInput = $("#fl-model-input");
    var endpointInput = $("#fl-endpoint-input");
    var model = (modelInput.value || "").trim();
    var endpoint = (endpointInput.value || "").trim();
    if (model && !MODEL_PATTERN.test(model)) {
      showError("Model name contains unsupported characters.");
      modelInput.focus();
      return;
    }
    if (endpoint && !ENDPOINT_PATTERN.test(endpoint)) {
      showError("Endpoint override must start with https:// and have no spaces.");
      endpointInput.focus();
      return;
    }
    state.selection.model = model;
    state.selection.endpoint = endpoint;
    var payload = {
      provider: provider.name,
      variant: state.selection.variant,
      model: model || null,
      endpoint: endpoint || null
    };
    sendProvider(payload);
  }

  function sendProvider(payload) {
    var btn = $("#fl-model-form button[type=submit]");
    if (btn) btn.disabled = true;
    setupRequest("/api/provider", "POST", payload).then(function () {
      renderProviderSummary();
      renderFinishList();
      showStage("connect");
      setTimeout(function () {
        var key = $("#fl-key-input");
        if (key && typeof key.focus === "function") key.focus();
      }, 0);
    }).catch(function (err) {
      showError((err && err.message) ? err.message : "Provider configuration failed");
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function renderProviderSummary() {
    var box = $("#fl-provider-summary");
    box.textContent = "";
    var provider = selectedProvider();
    if (!provider) {
      box.appendChild(h("span", "dim", "No provider selected."));
      return;
    }
    var lines = [];
    lines.push("Provider: " + (provider.label || provider.name));
    var variant = selectedVariant();
    if (variant) lines.push((provider.variantLabel || "Plan or region") + ": " + (variant.label || variant.id));
    lines.push("Model: " + (state.selection.model || provider.defaultModel || "default"));
    lines.push("Endpoint: " + (state.selection.endpoint || (variant && variant.endpoint) || provider.defaultEndpoint));
    box.appendChild(hd("div", "", lines.map(function (l) { return h("div", "mono", l); })));
  }

  function probeConnect() {
    var provider = selectedProvider();
    if (!provider) { showError("Choose a provider before probing."); return; }
    var keyInput = $("#fl-key-input");
    var key = keyInput.value || "";
    if (key.length < 8) {
      showError("Enter an API key of at least 8 characters.");
      keyInput.focus();
      return;
    }
    var label = (provider && (provider.label || provider.name)) || "the provider";
    if (!window.confirm("Running the probe will make a billable request to " + label + ". Continue?")) {
      return;
    }
    var btn = $("#fl-btn-probe");
    btn.disabled = true;
    showError("");
    var result = $("#fl-probe-result");
    result.hidden = false;
    result.textContent = "";
    result.appendChild(h("p", "dim", "Probing provider..."));
    var payload = {
      provider: provider.name,
      variant: state.selection.variant,
      model: state.selection.model || null,
      endpoint: state.selection.endpoint || null,
      apiKey: key,
      confirmCost: true
    };
    keyInput.value = "";
    setupRequest("/api/probe", "POST", payload).then(function (data) {
      state.probe = data || { ok: true };
      renderProbeResult(true, null, data);
      renderFinishList();
      showStage("ready");
    }).catch(function (err) {
      state.probe = null;
      renderProbeResult(false, err);
      renderFinishList();
    }).then(function () {
      btn.disabled = false;
    });
  }

  function renderProbeResult(ok, err, data) {
    var result = $("#fl-probe-result");
    result.textContent = "";
    if (ok) {
      result.appendChild(h("div", "title", "Probe succeeded"));
      if (data && typeof data.latencyMs === "number") {
        result.appendChild(h("div", "desc", "Latency: " + data.latencyMs + " ms"));
      }
      if (data && data.model) result.appendChild(h("div", "desc", "Model: " + data.model));
      if (data && data.note) result.appendChild(h("div", "desc", String(data.note)));
      result.appendChild(h("p", "dim fs11", "Key cleared. Choices preserved. Continue to Ready."));
    } else {
      result.appendChild(h("div", "title", "Probe failed"));
      result.appendChild(h("div", "desc", (err && err.message) ? err.message : "Provider rejected the credential."));
      result.appendChild(h("p", "dim fs11", "Key cleared. Enter a corrected key and try again."));
    }
  }

  function renderFinishList() {
    var list = $("#fl-finish-list");
    list.textContent = "";
    var items = [
      {
        title: "Provider verified",
        desc: state.probe
          ? "Yes (latency " + ((state.probe.latencyMs !== undefined) ? state.probe.latencyMs : "?") + " ms)"
          : "Run the billable probe",
        ok: !!state.probe
      },
      {
        title: "Codex plugin installed",
        desc: state.plugin ? "Installed" : "Not yet installed",
        ok: !!state.plugin
      }
    ];
    items.forEach(function (it) {
      list.appendChild(hd("li", "", [
        h("span", "dot " + (it.ok ? "ok" : "warn"), ""),
        hd("div", "", [
          h("div", "title", it.title),
          h("div", "desc", it.desc)
        ])
      ]));
    });
    $("#fl-btn-finish").disabled = !(state.probe && state.plugin);
  }

  function installPlugin() {
    var btn = $("#fl-btn-plugin");
    btn.disabled = true;
    showError("");
    var result = $("#fl-finish-result");
    result.hidden = false;
    result.textContent = "";
    result.appendChild(h("p", "dim", "Installing Codex plugin..."));
    setupRequest("/api/plugin", "POST", { plugin: "codex", confirm: true }).then(function (data) {
      state.plugin = data || { ok: true };
      result.textContent = "";
      result.appendChild(h("div", "title", "Codex plugin installed"));
      result.appendChild(h("p", "dim fs11", "You can finish setup."));
      renderFinishList();
    }).catch(function (err) {
      result.textContent = "";
      result.appendChild(h("div", "title", "Plugin install failed"));
      result.appendChild(h("div", "desc", (err && err.message) ? err.message : "Try again or check Codex availability."));
      btn.disabled = false;
    });
  }

  function finishSetup() {
    var btn = $("#fl-btn-finish");
    btn.disabled = true;
    setupRequest("/api/finish", "POST", {}).then(function (data) {
      var result = $("#fl-finish-result");
      result.hidden = false;
      result.textContent = "";
      result.appendChild(h("div", "title", "Setup complete"));
      var consoleUrl = safeConsoleUrl(data && data.consoleUrl);
      if (!consoleUrl) throw new Error("Setup returned an invalid local console URL");
      var link = h("a", "", "Open ForkLight console");
      link.href = consoleUrl;
      link.setAttribute("data-testid", "console-link");
      result.appendChild(link);
      result.appendChild(h("p", "dim fs11", "The setup token is no longer required for this page."));
    }).catch(function (err) {
      btn.disabled = false;
      showError((err && err.message) ? err.message : "Finish failed");
    });
  }

  function safeConsoleUrl(value) {
    if (typeof value !== "string") return null;
    try {
      var parsed = new URL(value);
      if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") return null;
      return parsed.href;
    } catch (_) {
      return null;
    }
  }

  function init() {
    var token = readToken();
    if (!token) {
      var status = $("#fl-bootstrap-status");
      status.hidden = false;
      status.className = "state-msg error";
      status.textContent = "Setup token missing. Reopen the setup link from the CLI.";
      setConn("offline");
      return;
    }
    state.token = token;
    $("#fl-btn-system-retry").addEventListener("click", loadBootstrap);
    $("#fl-btn-system-next").addEventListener("click", function () { showStage("model"); });
    $("#fl-model-form").addEventListener("submit", submitModel);
    $("#fl-btn-model-back").addEventListener("click", function () { showStage("system"); });
    $("#fl-btn-probe").addEventListener("click", probeConnect);
    $("#fl-btn-connect-back").addEventListener("click", function () { showStage("model"); });
    $("#fl-btn-plugin").addEventListener("click", installPlugin);
    $("#fl-btn-finish").addEventListener("click", finishSetup);
    loadBootstrap();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
