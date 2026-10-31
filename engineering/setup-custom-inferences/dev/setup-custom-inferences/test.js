// Tests for ../../scripts/setup-custom-inferences.js against the mock server.
// Run: bun ./test.js   (or: node ./test.js). No dependencies.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "../../scripts/setup-custom-inferences.js");
const KEY_ENV = "SCI_TEST_KEY";
const KEY_VALUE = "test-key-that-must-never-appear-in-output";
process.env[KEY_ENV] = KEY_VALUE;

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) process.stdout.write(`ok: ${name}\n`);
  else {
    failures++;
    process.stderr.write(`FAIL: ${name} ${extra}\n`);
  }
}

function run(args, workDir) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    cwd: workDir,
    env: process.env,
  });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const mockChild = spawn(process.execPath, [path.join(here, "mock-server.js"), "--port", "0"], {
  stdio: ["ignore", "pipe", "pipe"],
});
const mockLine = await new Promise((resolve, reject) => {
  let buf = "";
  const timer = setTimeout(() => reject(new Error("mock server did not print a port")), 15000);
  mockChild.stdout.on("data", (c) => {
    buf += c.toString();
    const nl = buf.indexOf("\n");
    if (nl !== -1) {
      clearTimeout(timer);
      resolve(buf.slice(0, nl));
    }
  });
  mockChild.on("error", reject);
});
const port = Number(mockLine.trim().split(/\s+/).pop());
if (!port) {
  process.stderr.write(`mock server printed: ${mockLine}\n`);
  process.exit(1);
}
const base = `http://127.0.0.1:${port}`;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "sci-"));

// 1. probe (main five; flat/gated/colliding models get their own flows below)
{
  const main = "reason/think-on,reason/always,plain/no-reason,reason/text-field,strict/history";
  const r = run(
    ["probe", "--base-url", base, "--provider", "mock", "--key-env", KEY_ENV, "--work-dir", work, "--concurrency", "3", "--models", main],
    work
  );
  check("probe exits 0", r.status === 0, r.out);
  const files = fs.readdirSync(path.join(work, "probe"));
  check("five result files (junk/ filtered)", files.length === 5, files.join(","));
  check("no file for trailing-slash id", !files.some((f) => f.includes("junk")), files.join(","));
  const thinkOn = JSON.parse(fs.readFileSync(path.join(work, "probe", "reason_think-on.json"), "utf8"));
  check("think-on off has no reasoning", thinkOn.off.reasoningChars === 0, JSON.stringify(thinkOn.off));
  check("think-on off field null", thinkOn.off.reasoningField === null, JSON.stringify(thinkOn.off));
  check("think-on high reasons", (thinkOn.levels.high.reasoningChars || 0) > 0);
  check("think-on high field", thinkOn.levels.high.reasoningField === "reasoning_content", JSON.stringify(thinkOn.levels.high));
  check("think-on low vs high graded", thinkOn.levels.low.reasoningChars !== thinkOn.levels.high.reasoningChars, `${thinkOn.levels.low.reasoningChars} vs ${thinkOn.levels.high.reasoningChars}`);
  check("think-on xhigh rejected", (thinkOn.levels.xhigh.httpError || "").startsWith("400"), JSON.stringify(thinkOn.levels.xhigh));
  check("think-on max rejected", (thinkOn.levels.max.httpError || "").startsWith("400"));
  check("think-on effort-none still reasons", (thinkOn.effortNone.reasoningChars || 0) > 0);
  check("think-on tool called", thinkOn.tool.called === true);
  check("think-on replay ok", thinkOn.replay.ok === true);
  const always = JSON.parse(fs.readFileSync(path.join(work, "probe", "reason_always.json"), "utf8"));
  check("always off still reasons", (always.off.reasoningChars || 0) > 0);
  check("always off field", always.off.reasoningField === "reasoning", JSON.stringify(always.off));
  const textfield = JSON.parse(fs.readFileSync(path.join(work, "probe", "reason_text-field.json"), "utf8"));
  check("text-field high field", textfield.levels.high.reasoningField === "reasoning_text", JSON.stringify(textfield.levels.high));
  const plain = JSON.parse(fs.readFileSync(path.join(work, "probe", "plain_no-reason.json"), "utf8"));
  check("plain never reasons", (plain.off.reasoningChars || 0) === 0 && (plain.levels.high.reasoningChars || 0) === 0);
  check("plain tool not called", plain.tool.called === false);
  const history = JSON.parse(fs.readFileSync(path.join(work, "probe", "strict_history.json"), "utf8"));
  check("history replay rejected", history.replay.ok === false, JSON.stringify(history.replay));
  const state = JSON.parse(fs.readFileSync(path.join(work, "state.json"), "utf8"));
  check("state step probed", state.step === "probed", state.step);
  check("compat developer rejected", state.compat.developerRole.ok === false);
}

// 2. key redaction across everything the run wrote
{
  const hits = [];
  for (const f of [path.join(work, "state.json")]) {
    if (fs.readFileSync(f, "utf8").includes(KEY_VALUE)) hits.push(f);
  }
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (fs.readFileSync(p, "utf8").includes(KEY_VALUE)) hits.push(p);
    }
  };
  walk(path.join(work, "probe"));
  check("key value in no file", hits.length === 0, hits.join(","));
}

// 3. resume: second probe run skips existing results
{
  const main = "reason/think-on,reason/always,plain/no-reason,reason/text-field,strict/history";
  const before = fs.statSync(path.join(work, "probe", "reason_think-on.json")).mtimeMs;
  const r = run(
    ["probe", "--base-url", base, "--provider", "mock", "--key-env", KEY_ENV, "--work-dir", work, "--models", main],
    work
  );
  const after = fs.statSync(path.join(work, "probe", "reason_think-on.json")).mtimeMs;
  check("resume exits 0", r.status === 0, r.out);
  check("resume keeps result files", before === after);
}

// 4. build
{
  const r = run(
    ["build", "--work-dir", work, "--provider", "mock", "--base-url", base, "--key-env", KEY_ENV,
      "--name", "Mock", "--context-cap", "100000", "--max-tokens", "8000"],
    work
  );
  check("build exits 0", r.status === 0, r.out);
  const pi = JSON.parse(fs.readFileSync(path.join(work, "draft", "pi.json"), "utf8"));
  const prov = pi.providers.mock;
  check("pi api", prov.api === "openai-completions");
  check("pi apiKey is env ref", prov.apiKey === `$${KEY_ENV}`, prov.apiKey);
  check("pi authHeader", prov.authHeader === true);
  check("pi compat deepseek", prov.compat.thinkingFormat === "deepseek" && prov.compat.supportsReasoningEffort === true, JSON.stringify(prov.compat));
  check("pi compat developer false", prov.compat.supportsDeveloperRole === false, JSON.stringify(prov.compat));
  const t = prov.models.find((m) => m.id === "reason/think-on");
  check("pi think-on reasoning", t.reasoning === true);
  check("pi think-on map", t.thinkingLevelMap.minimal === "minimal" && t.thinkingLevelMap.high === "high" &&
    t.thinkingLevelMap.xhigh === null && t.thinkingLevelMap.max === null && t.thinkingLevelMap.off === "none",
    JSON.stringify(t.thinkingLevelMap));
  check("pi context capped", t.contextWindow === 100000, String(t.contextWindow));
  check("pi maxTokens", t.maxTokens === 8000);
  const a = prov.models.find((m) => m.id === "reason/always");
  check("pi always off null", a.thinkingLevelMap.off === null, JSON.stringify(a.thinkingLevelMap));
  const p = prov.models.find((m) => m.id === "plain/no-reason");
  check("pi plain no reasoning flag", p.reasoning === undefined && p.thinkingLevelMap === undefined, JSON.stringify(p));
  const oc = JSON.parse(fs.readFileSync(path.join(work, "draft", "opencode.json"), "utf8"));
  const oprov = oc.providers.mock;
  check("opencode package", oprov.package === "@opencode/ai/providers/openai-compatible", oprov.package);
  check("opencode env", JSON.stringify(oprov.env) === JSON.stringify([KEY_ENV]));
  check("opencode baseURL", oprov.settings.baseURL === base);
  check("opencode no apiKey in env mode", oprov.settings.apiKey === undefined, JSON.stringify(oprov.settings));
  check("opencode provider compatibility", oprov.compatibility && oprov.compatibility.reasoningField === "reasoning_content" && !("cacheFormat" in oprov.compatibility), JSON.stringify(oprov.compatibility));
  const draftText = fs.readFileSync(path.join(work, "draft", "opencode.json"), "utf8");
  check("opencode no extraBody anywhere", !draftText.includes("extraBody"), "extraBody found");
  check("opencode no image input", !draftText.includes('"image"') && !fs.readFileSync(path.join(work, "draft", "pi.json"), "utf8").includes('"image"'), "image claim found");
  const ot = oprov.models["think-on"];
  check("opencode modelID", ot.modelID === "reason/think-on", ot.modelID);
  check("opencode limit", ot.limit.context === 100000 && ot.limit.output === 8000, JSON.stringify(ot.limit));
  check("opencode reasoning toggle", ot.capabilities.reasoning.supported === true && ot.capabilities.reasoning.toggle === true, JSON.stringify(ot.capabilities));
  check("opencode effort levels", JSON.stringify(ot.capabilities.reasoning.effort) === JSON.stringify(["minimal", "low", "medium", "high"]), JSON.stringify(ot.capabilities.reasoning));
  check("opencode tools", ot.capabilities.tools === true);
  check("opencode no per-model compatibility when same", ot.compatibility === undefined, JSON.stringify(ot.compatibility));
  const high = ot.variants.find((v) => v.id === "high");
  check("opencode level variant body", high && high.body && high.body.reasoning_effort === "high" && high.body.thinking && high.body.thinking.type === "enabled" && high.settings === undefined, JSON.stringify(high));
  const none = ot.variants.find((v) => v.id === "none");
  check("opencode none variant", none && none.body && none.body.thinking && none.body.thinking.type === "disabled" && none.settings === undefined, JSON.stringify(ot.variants));
  const oa = oprov.models["always"];
  check("opencode always no toggle key", oa.capabilities.reasoning.supported === true && !("toggle" in oa.capabilities.reasoning), JSON.stringify(oa.capabilities));
  check("opencode always no none variant", !oa.variants.some((v) => v.id === "none"), JSON.stringify(oa.variants.map((v) => v.id)));
  check("opencode always model compatibility", oa.compatibility && oa.compatibility.reasoningField === "reasoning", JSON.stringify(oa.compatibility));
  const tf = oprov.models["text-field"];
  check("opencode text-field compatibility", tf.compatibility && tf.compatibility.reasoningField === "reasoning_text", JSON.stringify(tf.compatibility));
  const op = oprov.models["no-reason"];
  check("opencode plain unsupported", op.capabilities.reasoning.supported === false && op.variants.length === 0);
  const state = JSON.parse(fs.readFileSync(path.join(work, "state.json"), "utf8"));
  check("state step built", state.step === "built");
  check("state warnings mention replay + levels", state.warnings.some((w) => w.includes("replay")) && state.warnings.some((w) => w.includes("xhigh")), JSON.stringify(state.warnings));
}

// 5. apply merges one provider with backup
{
  const target = path.join(work, "live.json");
  fs.writeFileSync(target, JSON.stringify({ providers: { other: { name: "Other" } } }));
  let r = run(["apply", "--draft", path.join(work, "draft", "pi.json"), "--target", target, "--provider", "mock"], work);
  check("apply exits 0", r.status === 0, r.out);
  const live = JSON.parse(fs.readFileSync(target, "utf8"));
  check("apply keeps other provider", live.providers.other && live.providers.other.name === "Other");
  check("apply adds mock", live.providers.mock && live.providers.mock.models.length === 5, String(live.providers.mock && live.providers.mock.models.length));
  const baks = fs.readdirSync(work).filter((f) => f.startsWith("live.json.bak-"));
  check("apply writes backup", baks.length === 1, baks.join(","));
  const settings = path.join(work, "settings.json");
  fs.writeFileSync(settings, JSON.stringify({ defaultProvider: "x", theme: "dark" }));
  r = run(["apply", "--draft", path.join(work, "draft", "pi.json"), "--target", settings, "--provider", "mock", "--as-settings", "--model", "reason/think-on"], work);
  const s = JSON.parse(fs.readFileSync(settings, "utf8"));
  check("apply settings defaults", r.status === 0 && s.defaultProvider === "mock" && s.defaultModel === "reason/think-on" && s.theme === "dark", r.out);
}

// 6. build --key-file: opencode reads {file:...}, env omitted, file untouched
{
  const before = fs.existsSync("/tmp/sci-key-never-created") ? "present" : "absent";
  const r = run(
    ["build", "--work-dir", work, "--provider", "mock", "--base-url", base, "--key-env", KEY_ENV,
      "--key-file", "/tmp/sci-key-never-created"],
    work
  );
  check("key-file build exits 0", r.status === 0, r.out);
  const oc = JSON.parse(fs.readFileSync(path.join(work, "draft", "opencode.json"), "utf8"));
  check("key-file apiKey ref", oc.providers.mock.settings.apiKey === "{file:/tmp/sci-key-never-created}", JSON.stringify(oc.providers.mock.settings));
  check("key-file omits env", oc.providers.mock.env === undefined, JSON.stringify(oprov_keys(oc)));
  check("key file never created", before === "absent" && !fs.existsSync("/tmp/sci-key-never-created"));
  function oprov_keys(o) { return Object.keys(o.providers.mock); }
}

// 7. graded effort silently ignored: low~high -> all graded levels unsupported
{
  const w2 = fs.mkdtempSync(path.join(os.tmpdir(), "sci-flat-"));
  let r = run(
    ["probe", "--base-url", base, "--provider", "flat", "--key-env", KEY_ENV, "--work-dir", w2, "--models", "flat/effort"],
    w2
  );
  check("flat probe exits 0", r.status === 0, r.out);
  r = run(["build", "--work-dir", w2, "--provider", "flat", "--base-url", base, "--key-env", KEY_ENV], w2);
  check("flat build exits 0", r.status === 0, r.out);
  const pi = JSON.parse(fs.readFileSync(path.join(w2, "draft", "pi.json"), "utf8"));
  const m = pi.providers.flat.models[0];
  const vals = Object.values(m.thinkingLevelMap);
  check("flat graded null, off none", m.reasoning === true && m.thinkingLevelMap.off === "none" && vals.filter((v) => v !== null).length === 1, JSON.stringify(m.thinkingLevelMap));
  const oc = JSON.parse(fs.readFileSync(path.join(w2, "draft", "opencode.json"), "utf8"));
  const om = oc.providers.flat.models["effort"];
  check("flat effort empty, toggle kept", JSON.stringify(om.capabilities.reasoning.effort) === "[]" && om.capabilities.reasoning.toggle === true, JSON.stringify(om.capabilities));
  check("flat none variant kept", om.variants.some((v) => v.id === "none"), JSON.stringify(om.variants));
  const st = JSON.parse(fs.readFileSync(path.join(w2, "state.json"), "utf8"));
  check("flat warning recorded", st.warnings.some((w) => w.includes("effort ignored")), JSON.stringify(st.warnings));
}

// 8. HTTP 403 model: recorded inaccessible, excluded from drafts
{
  const w3 = fs.mkdtempSync(path.join(os.tmpdir(), "sci-gated-"));
  let r = run(
    ["probe", "--base-url", base, "--provider", "gated", "--key-env", KEY_ENV, "--work-dir", w3, "--models", "denied/gated", "--api", "openai-completions"],
    w3
  );
  check("gated probe exits 0", r.status === 0 && r.out.includes("inaccessible"), r.out);
  const st = JSON.parse(fs.readFileSync(path.join(w3, "state.json"), "utf8"));
  check("gated status inaccessible", st.models["denied/gated"] && st.models["denied/gated"].status === "inaccessible", JSON.stringify(st.models));
  r = run(["build", "--work-dir", w3, "--provider", "gated", "--base-url", base, "--key-env", KEY_ENV], w3);
  check("gated build refuses empty", r.status !== 0 && r.out.includes("inaccessible"), r.out);
}

// 9. colliding short aliases fall back to full upstream ids
{
  const w4 = fs.mkdtempSync(path.join(os.tmpdir(), "sci-collide-"));
  let r = run(
    ["probe", "--base-url", base, "--provider", "collide", "--key-env", KEY_ENV, "--work-dir", w4, "--models", "x/same,y/same"],
    w4
  );
  check("collide probe exits 0", r.status === 0, r.out);
  r = run(["build", "--work-dir", w4, "--provider", "collide", "--base-url", base, "--key-env", KEY_ENV], w4);
  check("collide build exits 0", r.status === 0, r.out);
  const oc = JSON.parse(fs.readFileSync(path.join(w4, "draft", "opencode.json"), "utf8"));
  const keys = Object.keys(oc.providers.collide.models).sort();
  check("collide full-id keys", JSON.stringify(keys) === JSON.stringify(["x/same", "y/same"]), keys.join(","));
  const st = JSON.parse(fs.readFileSync(path.join(w4, "state.json"), "utf8"));
  check("collide warning recorded", st.warnings.some((w) => w.includes("full upstream ids")), JSON.stringify(st.warnings));
}

// 11. responses protocol end to end
{
  const w5 = fs.mkdtempSync(path.join(os.tmpdir(), "sci-resp-"));
  let r = run(
    ["probe", "--base-url", base, "--provider", "resp", "--key-env", KEY_ENV, "--work-dir", w5,
      "--models", "resp/think,resp/always,resp/flat,resp/gated", "--api", "openai-responses", "--concurrency", "2"],
    w5
  );
  check("resp probe exits 0", r.status === 0, r.out);
  const st = JSON.parse(fs.readFileSync(path.join(w5, "state.json"), "utf8"));
  check("resp state api", st.api === "openai-responses", st.api);
  check("resp gated inaccessible", st.models["resp/gated"] && st.models["resp/gated"].status === "inaccessible");
  const think = JSON.parse(fs.readFileSync(path.join(w5, "probe", "resp_think.json"), "utf8"));
  check("resp think field", think.levels.high.reasoningField === "reasoning_summary_text", JSON.stringify(think.levels.high));
  check("resp think replayFull", think.replayFull.ok === true);
  check("resp think replayPrevId", think.replayPrevId.ok === true);
  r = run(["build", "--work-dir", w5, "--provider", "resp", "--base-url", base, "--key-env", KEY_ENV], w5);
  check("resp build exits 0", r.status === 0, r.out);
  const pi = JSON.parse(fs.readFileSync(path.join(w5, "draft", "pi.json"), "utf8"));
  check("resp pi api", pi.providers.resp.api === "openai-responses", pi.providers.resp.api);
  check("resp pi compat", pi.providers.resp.compat.supportsReasoningEffort === true && pi.providers.resp.compat.thinkingFormat === undefined, JSON.stringify(pi.providers.resp.compat));
  const t = pi.providers.resp.models.find((m) => m.id === "resp/think");
  check("resp pi map", t.thinkingLevelMap.high === "high" && t.thinkingLevelMap.xhigh === null && t.thinkingLevelMap.off === "none", JSON.stringify(t.thinkingLevelMap));
  const a = pi.providers.resp.models.find((m) => m.id === "resp/always");
  check("resp always off null", a.thinkingLevelMap.off === null, JSON.stringify(a.thinkingLevelMap));
  check("resp gated excluded", !pi.providers.resp.models.some((m) => m.id === "resp/gated"));
  const oc = JSON.parse(fs.readFileSync(path.join(w5, "draft", "opencode.json"), "utf8"));
  const oprov = oc.providers.resp;
  check("resp oc package", oprov.package === "@opencode/ai/providers/openai-compatible/responses", oprov.package);
  check("resp oc reasoningField", oprov.compatibility && oprov.compatibility.reasoningField === "reasoning_summary_text", JSON.stringify(oprov.compatibility));
  const ot = oprov.models["think"];
  const hv = ot.variants.find((v) => v.id === "high");
  check("resp level body", hv && hv.body && hv.body.reasoning && hv.body.reasoning.effort === "high" && hv.body.reasoning.summary === "auto", JSON.stringify(hv));
  const nv = ot.variants.find((v) => v.id === "none");
  check("resp none body", nv && nv.body && nv.body.reasoning && nv.body.reasoning.effort === "none", JSON.stringify(ot.variants));
  check("resp flat empty none", (() => {
    const f = oprov.models["flat"];
    const n = f && f.variants.find((v) => v.id === "none");
    return f && f.capabilities.reasoning.toggle === true && n && Object.keys(n.body).length === 0;
  })(), JSON.stringify(oprov.models["flat"] && oprov.models["flat"].variants));
  const st2 = JSON.parse(fs.readFileSync(path.join(w5, "state.json"), "utf8"));
  check("resp warnings", st2.warnings.some((w) => w.includes("effort ignored")) && st2.warnings.some((w) => w.includes("resp/gated")), JSON.stringify(st2.warnings));
}

// 12. anthropic protocol end to end
{
  const w6 = fs.mkdtempSync(path.join(os.tmpdir(), "sci-anth-"));
  let r = run(
    ["probe", "--base-url", base, "--provider", "anth", "--key-env", KEY_ENV, "--work-dir", w6,
      "--models", "anth/think,anth/fluent,anth/picky,anth/stubborn,anth/gated", "--api", "anthropic-messages", "--concurrency", "2"],
    w6
  );
  check("anth probe exits 0", r.status === 0, r.out);
  const think = JSON.parse(fs.readFileSync(path.join(w6, "probe", "anth_think.json"), "utf8"));
  check("anth think tier field", think.budgets.low.reasoningField === "thinking", JSON.stringify(think.budgets.low));
  check("anth think adaptive rejected", (think.efforts.low.httpError || "").startsWith("400"));
  check("anth think emptySig ok", think.emptySig.ok === true);
  const fluent = JSON.parse(fs.readFileSync(path.join(w6, "probe", "anth_fluent.json"), "utf8"));
  check("anth fluent adaptive works", (fluent.efforts.high.reasoningChars || 0) > 0);
  check("anth fluent budget rejected", (fluent.budgets.low.httpError || "").startsWith("400"));
  const picky = JSON.parse(fs.readFileSync(path.join(w6, "probe", "anth_picky.json"), "utf8"));
  check("anth picky history rejected", picky.replayThinking.ok === false, JSON.stringify(picky.replayThinking));
  check("anth picky emptySig rejected", picky.emptySig.ok === false);
  const stubborn = JSON.parse(fs.readFileSync(path.join(w6, "probe", "anth_stubborn.json"), "utf8"));
  check("anth stubborn off reasons", (stubborn.off.reasoningChars || 0) > 0);
  r = run(["build", "--work-dir", w6, "--provider", "anth", "--base-url", base, "--key-env", KEY_ENV], w6);
  check("anth build exits 0", r.status === 0, r.out);
  const pi = JSON.parse(fs.readFileSync(path.join(w6, "draft", "pi.json"), "utf8"));
  const pp = pi.providers.anth;
  check("anth pi api", pp.api === "anthropic-messages", pp.api);
  check("anth pi key in headers", pp.headers && pp.headers["x-api-key"] === `$${KEY_ENV}` && pp.headers["anthropic-version"] === "2023-06-01" && pp.apiKey === undefined, JSON.stringify(pp.headers));
  const tm = pp.models.find((m) => m.id === "anth/think");
  check("anth think budget map", tm.thinkingLevelMap.low === "low" && tm.thinkingLevelMap.off === "none", JSON.stringify(tm.thinkingLevelMap));
  check("anth think allowEmpty", tm.compat && tm.compat.allowEmptySignature === true, JSON.stringify(tm.compat));
  const fm = pp.models.find((m) => m.id === "anth/fluent");
  check("anth fluent adaptive map", fm.thinkingLevelMap.high === "high" && fm.thinkingLevelMap.minimal === "low" && fm.compat && fm.compat.forceAdaptiveThinking === true, JSON.stringify(fm));
  check("anth provider mixed (no force)", pp.compat.forceAdaptiveThinking === undefined, JSON.stringify(pp.compat));
  const sm = pp.models.find((m) => m.id === "anth/stubborn");
  check("anth stubborn off null", sm.thinkingLevelMap.off === null, JSON.stringify(sm.thinkingLevelMap));
  const pm = pp.models.find((m) => m.id === "anth/picky");
  check("anth picky no allowEmpty", !pm.compat || pm.compat.allowEmptySignature === undefined, JSON.stringify(pm.compat));
  const oc = JSON.parse(fs.readFileSync(path.join(w6, "draft", "opencode.json"), "utf8"));
  const oprov = oc.providers.anth;
  check("anth oc package", oprov.package === "@opencode/ai/providers/anthropic", oprov.package);
  const ot = oprov.models["think"];
  const lb = ot.variants.find((v) => v.id === "low");
  check("anth budget variant", lb && lb.body && lb.body.thinking && lb.body.thinking.budget_tokens === 2048, JSON.stringify(lb));
  const of = oprov.models["fluent"];
  const hb = of.variants.find((v) => v.id === "high");
  check("anth adaptive variant", hb && hb.body && hb.body.thinking && hb.body.thinking.type === "adaptive" && hb.body.output_config && hb.body.output_config.effort === "high", JSON.stringify(hb));
  const st = JSON.parse(fs.readFileSync(path.join(w6, "state.json"), "utf8"));
  check("anth warnings", st.warnings.some((w) => w.includes("anth/gated")) && st.warnings.some((w) => w.includes("thinking-history")), JSON.stringify(st.warnings));
}

// 13. auto-detect: single protocol selected, ambiguous and 403 reported
{
  const w7 = fs.mkdtempSync(path.join(os.tmpdir(), "sci-det-"));
  for (const suffix of ["-r", "-a", "-c", "-amb", "-403"]) fs.mkdirSync(`${w7}${suffix}`, { recursive: true });
  let r = run(
    ["probe", "--base-url", base, "--provider", "det", "--key-env", KEY_ENV, "--work-dir", `${w7}-r`, "--models", "resp/think"],
    `${w7}-r`
  );
  check("detect responses", r.status === 0 && r.out.includes("auto-detected API: openai-responses"), r.out);
  r = run(
    ["probe", "--base-url", base, "--provider", "det", "--key-env", KEY_ENV, "--work-dir", `${w7}-a`, "--models", "anth/think"],
    `${w7}-a`
  );
  check("detect anthropic", r.status === 0 && r.out.includes("auto-detected API: anthropic-messages"), r.out);
  r = run(
    ["probe", "--base-url", base, "--provider", "det", "--key-env", KEY_ENV, "--work-dir", `${w7}-c`, "--models", "reason/think-on"],
    `${w7}-c`
  );
  check("detect completions", r.status === 0 && r.out.includes("auto-detected API: openai-completions"), r.out);
  r = run(
    ["probe", "--base-url", base, "--provider", "det", "--key-env", KEY_ENV, "--work-dir", `${w7}-amb`],
    `${w7}-amb`
  );
  check("detect ambiguous fails", r.status !== 0 && r.out.includes("ambiguous") && r.out.includes("--api"), r.out);
  r = run(
    ["probe", "--base-url", base, "--provider", "det", "--key-env", KEY_ENV, "--work-dir", `${w7}-403`, "--models", "denied/gated"],
    `${w7}-403`
  );
  check("detect 403 reported", r.status !== 0 && r.out.includes("403"), r.out);
}

// 14. maxTokensField via simulated single-field endpoint (build uses compat)
{
  const w8 = fs.mkdtempSync(path.join(os.tmpdir(), "sci-maxtok-"));
  let r = run(
    ["probe", "--base-url", base, "--provider", "maxtok", "--key-env", KEY_ENV, "--work-dir", w8,
      "--models", "reason/think-on", "--api", "openai-completions"],
    w8
  );
  check("maxtok probe exits 0", r.status === 0, r.out);
  const stp = path.join(w8, "state.json");
  const st = JSON.parse(fs.readFileSync(stp, "utf8"));
  st.compat.maxTokens = { ok: false, httpError: "400 rejected" };
  st.compat.maxCompletionTokens = { ok: true, httpError: null };
  fs.writeFileSync(stp, JSON.stringify(st));
  r = run(["build", "--work-dir", w8, "--provider", "maxtok", "--base-url", base, "--key-env", KEY_ENV, "--target", "both"], w8);
  check("maxtok build exits 0", r.status === 0, r.out);
  const pi = JSON.parse(fs.readFileSync(path.join(w8, "draft", "pi.json"), "utf8"));
  check("maxtok pi field", pi.providers.maxtok.compat.maxTokensField === "max_completion_tokens", JSON.stringify(pi.providers.maxtok.compat));
  const oc = JSON.parse(fs.readFileSync(path.join(w8, "draft", "opencode.json"), "utf8"));
  check("maxtok oc field", oc.providers.maxtok.compatibility && oc.providers.maxtok.compatibility.maxTokensField === "max_completion_tokens", JSON.stringify(oc.providers.maxtok.compatibility));
}

// 15. header-env: names recorded, values never written
{
  process.env.SCI_EXTRA_HDR = "hdr-value-that-must-never-appear";
  const w9 = fs.mkdtempSync(path.join(os.tmpdir(), "sci-hdr-"));
  let r = run(
    ["probe", "--base-url", base, "--provider", "hdr", "--key-env", KEY_ENV, "--work-dir", w9,
      "--models", "reason/think-on", "--api", "openai-completions", "--header-env", "X-Custom=SCI_EXTRA_HDR"],
    w9
  );
  check("header probe exits 0", r.status === 0, r.out);
  const st = JSON.parse(fs.readFileSync(path.join(w9, "state.json"), "utf8"));
  check("header mapping recorded", st.headerEnvs && st.headerEnvs["X-Custom"] === "SCI_EXTRA_HDR", JSON.stringify(st.headerEnvs));
  r = run(["build", "--work-dir", w9, "--provider", "hdr", "--base-url", base, "--key-env", KEY_ENV], w9);
  check("header build exits 0", r.status === 0, r.out);
  const pi = JSON.parse(fs.readFileSync(path.join(w9, "draft", "pi.json"), "utf8"));
  check("header pi $ref", pi.providers.hdr.headers && pi.providers.hdr.headers["X-Custom"] === "$SCI_EXTRA_HDR", JSON.stringify(pi.providers.hdr.headers));
  const oc = JSON.parse(fs.readFileSync(path.join(w9, "draft", "opencode.json"), "utf8"));
  check("header oc {env} ref", oc.providers.hdr.headers && oc.providers.hdr.headers["X-Custom"] === "{env:SCI_EXTRA_HDR}", JSON.stringify(oc.providers.hdr.headers));
  let leaked = false;
  for (const f of [path.join(w9, "state.json"), path.join(w9, "draft", "pi.json"), path.join(w9, "draft", "opencode.json")])
    if (fs.readFileSync(f, "utf8").includes("hdr-value-that-must-never-appear")) leaked = true;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (fs.readFileSync(p, "utf8").includes("hdr-value-that-must-never-appear")) leaked = true;
    }
  };
  walk(path.join(w9, "probe"));
  check("header value never written", !leaked);
  delete process.env.SCI_EXTRA_HDR;
}

// 10. TLS error classification is provider-level, never per-model
{
  const { isTlsError } = await import("../../scripts/setup-custom-inferences.js");
  check("tls DEPTH_ZERO", isTlsError("request failed: fetch failed (DEPTH_ZERO_SELF_SIGNED_CERT)") === true);
  check("tls UNABLE_TO_VERIFY", isTlsError("request failed: fetch failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE)") === true);
  check("tls handshake", isTlsError("request failed: TLS handshake timeout") === true);
  check("non-tls 403", isTlsError("403 forbidden") === false);
  check("non-tls refused", isTlsError("request failed: fetch failed") === false);
  check("non-tls empty", isTlsError("") === false);
}

mockChild.kill();
if (failures > 0) {
  process.stderr.write(`${failures} failures\n`);
  process.exit(1);
}
process.stdout.write("all tests passed\n");
