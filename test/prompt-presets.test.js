import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initialState, importPreset, normalizeState, compilePreset, macroEngine, assembleMessages, createPresetStore, handlePresetAction } from "../lib/prompt-presets.js";
import { buildPresetRequest, installPresetRuntime } from "../lib/prompt-presets-runtime.js";

const user = (value, id = "real-user") => Object.freeze({ id, role: "user", source: { kind: "user" }, content: Object.freeze([{ type: "text", text: value }]) });
const system = (value) => ({ id: "host-system", role: "system", source: { kind: "system-prompt" }, content: [{ type: "text", text: value }] });
const preset = (entries) => importPreset({ name: "测试", entries });

test("内置夏瑾使用酒馆 global 100001 顺序，保留全部条目和扩展", () => {
  const state = initialState();
  const p = state.presets[0];
  assert.equal(p.source.orderId, 100001);
  assert.equal(p.entries.length, 144);
  assert.equal(p.entries.filter((e) => e.enabled).length, 31);
  assert.equal(p.source.original.extensions.regex_scripts.length, 11);
  assert.equal(p.entries[0].id, p.source.original.prompt_order[1].order[0].identifier);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state))), state);
});

test("内置预设全部启用宏可以编译，禁用条目不会泄漏", () => {
  const p = initialState().presets[0];
  const result = compilePreset(p, { messages: [user("开始故事")], random: () => 0.5 });
  assert.ok(result.before.length > 0);
  assert.ok(result.after.length > 0);
  assert.equal(result.depth.length, 0);
  for (const item of [...result.before, ...result.after]) assert.ok(!item.text.includes("{{"));
  assert.ok(!result.system.includes("{{"));
  assert.equal(result.warnings.filter((w) => /变量.*未设置|不支持的宏/.test(w)).length, 0);
  p.entries.push({ id: "disabled", role: "user", name: "关闭", text: "SHOULD_NOT_APPEAR {{unsupported}}", enabled: false });
  assert.ok(!JSON.stringify(compilePreset(p)).includes("SHOULD_NOT_APPEAR"));
});

test("允许显式选择原文件另一套顺序", () => {
  const raw = initialState().presets[0].source.original;
  const p = importPreset(raw, { orderId: 100000 });
  assert.equal(p.entries.filter((e) => e.enabled).length, 10);
  assert.equal(p.entries[0].id, "main");
  assert.throws(() => importPreset(raw, { orderId: 99 }), /不存在/);
});

test("支持 preset-plus 格式且不强制首条 user 改为 system", () => {
  const p = preset([{ role: "user", text: "开头" }, { role: "model", text: "回答" }, { role: "system", text: "系统", enabled: false }]);
  assert.deepEqual(p.entries.map((e) => e.role), ["user", "assistant", "system"]);
  assert.equal(compilePreset(p).system, "");
  assert.throws(() => importPreset({ hello: "world" }), /缺少/);
  assert.throws(() => preset([{ role: "invalid", text: "" }]), /角色无效/);
});

test("宏支持变量、嵌套、注释、trim、随机、掷骰和最近消息", () => {
  const p = preset([{ role: "system", text: "{{setvar::x::{{user}}}} {{//这是注释}}{{trim}}" }, { role: "user", text: "{{getvar::x}}|{{random::甲::乙}}|{{roll 1d6}}|{{lastusermessage}}|{{lastcharmessage}}" }]);
  p.variables = { user: "读者" };
  const result = compilePreset(p, { random: () => 0, messages: [{ role: "assistant", content: [{ type: "text", text: "上一回复" }] }, user("最新输入")] });
  assert.equal(result.before[0].text, "读者|甲|1|最新输入|上一回复");
  assert.equal(result.system, "");
});

test("宏变量按请求隔离，未知宏阻止发送且不执行脚本", () => {
  const first = macroEngine(); first.expand("{{setvar::__proto__::value}}");
  assert.equal(first.expand("{{getvar::__proto__}}"), "value");
  const second = macroEngine();
  assert.equal(second.expand("{{getvar::__proto__}}"), "");
  assert.throws(() => compilePreset(preset([{ role: "user", text: "{{eval::process.exit()}}" }])), /无法展开/);
  assert.throws(() => compilePreset(preset([{ role: "user", text: "{{roll 1d0}}" }])), /范围/);
});

test("同条目嵌套赋值按从左到右执行，注释内宏不执行", () => {
  const engine = macroEngine({ user: "读者" });
  assert.equal(engine.expand("{{setvar::x::{{user}}}}{{getvar::x}}"), "读者");
  assert.equal(engine.expand("{{// {{setvar::x::错误}} }}{{getvar::x}}"), "读者");
});

test("最近消息中的花括号作为用户文本保留，不再次求值", () => {
  const p = preset([{ role: "user", text: "最新：{{lastusermessage}}" }]);
  const value = "解释 {{unsupported}} 这个模板";
  assert.equal(compilePreset(p, { messages: [user(value)] }).before[0].text, "最新：" + value);
});

test("顺序标记把当前历史放在前置和后置条目之间", () => {
  const p = preset([{ id: "a", role: "user", text: "前" }, { id: "chatHistory", role: "user", marker: true }, { id: "b", role: "assistant", text: "后" }]);
  const source = [system("宿主"), user("真实")];
  const result = assembleMessages(compilePreset(p), source, { provider: "x", model: "y" });
  assert.deepEqual(result.map((m) => m.content[0]?.text), ["宿主", "前", "真实", "后"]);
  assert.equal(result[2], source[1]);
  assert.deepEqual(result.at(-1).source, { kind: "model", provider: "x", model: "y" });
});

test("深度条目不拆开工具调用和工具结果，同深度按 order 排序", () => {
  const source = [user("起点"), { id: "call", role: "assistant", content: [{ type: "tool-call", toolCallId: "t" }] }, { id: "result", role: "tool", toolCallId: "t", content: [] }, user("最后")];
  const p = preset([{ role: "user", text: "二", position: 1, depth: 2, order: 200 }, { role: "user", text: "一", position: 1, depth: 2, order: 100 }]);
  const result = assembleMessages(compilePreset(p), source);
  assert.deepEqual(result.map((m) => m.id === "call" || m.id === "result" ? m.id : m.content[0]?.text), ["起点", "一", "二", "call", "result", "最后"]);
});

test("系统提示保留宿主内容，输入对象不被修改", () => {
  const options = Object.freeze({ sessionId: "s", messages: Object.freeze([system("宿主系统"), user("真实")]) });
  const before = JSON.stringify(options);
  const p = preset([{ role: "system", text: "预设系统" }, { role: "user", text: "前置" }]);
  const { request } = buildPresetRequest(options, p);
  assert.equal(JSON.stringify(options), before);
  assert.equal(request.messages[0].content[0].text, "宿主系统\n\n预设系统");
  assert.equal(request.messages[1].content[0].text, "前置");
  assert.ok(Object.isFrozen(request));
  assert.ok(Object.isFrozen(request.messages));
});

test("无 system 消息时补充系统提示，不使用 options.system", () => {
  const { request } = buildPresetRequest({ messages: [user("真实")] }, preset([{ role: "system", text: "系统" }]));
  assert.equal(request.system, undefined);
  assert.equal(request.messages[0].role, "system");
});

test("同一个模型请求的递归 stream 只注入一次，并跳过后台与子代理", () => {
  let hook;
  let forwarded;
  let subagent = false;
  let enabled = true;
  const p = preset([{ role: "user", text: "前置" }]);
  const ctx = { on(name, fn) { assert.equal(name, "llm/stream"); hook = fn; }, get() { return { get() { return { session: { header: { origin: subagent ? "subagent" : "user" } } }; } }; }, llm: { stream(options) { forwarded = options; return hook(options, () => "model"); } } };
  installPresetRuntime(ctx, { active: () => enabled ? p : null });
  const options = { sessionId: "s", messages: [user("真实")] };
  assert.equal(hook(options, () => "next"), "model");
  assert.equal(forwarded.messages.length, 2);
  assert.equal(hook({ ...options, purpose: "summary" }, () => "skip"), "skip");
  subagent = true;
  assert.equal(hook(options, () => "skip"), "skip");
  subagent = false; enabled = false;
  assert.equal(hook(options, () => "skip"), "skip");
});

test("保存、重载、过期写入和损坏文件不会静默覆盖用户配置", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-preset-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(home).startsWith("dsh-preset-test-"));
    fs.rmSync(home, { recursive: true, force: true });
  });
  const store = createPresetStore(home);
  const state = store.load();
  assert.equal(fs.existsSync(path.join(home, "dsh-purge")), false);
  state.presets[0].name = "改过的名字";
  state.enabled = false;
  store.save(state, state.revision);
  const reloaded = createPresetStore(home).load();
  assert.equal(reloaded.presets[0].name, "改过的名字");
  assert.equal(reloaded.enabled, false);
  assert.equal(store.active(), null);
  assert.throws(() => store.save(state, 0), /其他窗口/);
  fs.writeFileSync(path.join(home, "dsh-purge", "prompt-presets.json"), "broken json");
  assert.throws(() => createPresetStore(home).load());
});

test("酒馆启用顺序引用缺失条目时报错，避免静默丢数据", () => {
  assert.throws(() => importPreset({ prompts: [{ identifier: "a", role: "user", content: "a" }], prompt_order: [{ character_id: 100001, order: [{ identifier: "missing", enabled: true }] }] }), /不存在/);
});

test("重新包装请求时不重复添加系统和普通条目", () => {
  const p = preset([{ role: "system", text: "预设系统" }, { role: "user", text: "预设前置" }]);
  const first = buildPresetRequest({ messages: [system("宿主"), user("真实")] }, p).request;
  const again = buildPresetRequest({ ...first }, p).request;
  assert.deepEqual(again.messages.map((m) => m.content), first.messages.map((m) => m.content));
  const noSystem = buildPresetRequest({ messages: [user("真实")] }, p).request;
  assert.equal(buildPresetRequest({ ...noSystem }, p).request.messages.length, noSystem.messages.length);
});

test("接口导入为新 ID，预览不写入，非法保存不调用存储", () => {
  const state = initialState();
  let writes = 0;
  const store = { save(raw, revision) { writes++; assert.equal(revision, 0); return normalizeState(raw); } };
  const imported = handlePresetAction({ action: "import", data: state }, store);
  assert.notEqual(imported.presets[0].id, state.presets[0].id);
  assert.deepEqual(imported.presets[0].entries, state.presets[0].entries);
  handlePresetAction({ action: "preview", preset: imported.presets[0], message: "测试" }, store);
  assert.equal(writes, 0);
  state.presets[0].entries.unshift({ id: "bad", role: "user", text: "{{unknown}}", name: "错误条目", enabled: true });
  assert.throws(() => handlePresetAction({ action: "save", state, revision: 0 }, store), /无法展开/);
  assert.equal(writes, 0);
  state.enabled = false;
  assert.equal(handlePresetAction({ action: "save", state, revision: 0 }, store).state.enabled, false);
  assert.equal(writes, 1);
});
