import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const FORMAT = "dsh-purge-prompts";
const MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_ID = "xiajin-lyra-v2-beta-1";
const roles = new Set(["system", "user", "assistant"]);
const text = (v) => typeof v === "string" ? v : "";
const integer = (v, fallback = 0) => Number.isFinite(Number(v)) ? Math.max(0, Math.min(10000, Math.floor(Number(v)))) : fallback;

function entry(raw, index) {
  const role = raw.role === "model" ? "assistant" : raw.role;
  if (!roles.has(role) && !raw.marker) throw new Error(`第 ${index + 1} 个条目的角色无效`);
  return {
    ...raw,
    id: text(raw.id || raw.identifier) || randomUUID(),
    name: text(raw.name) || `条目 ${index + 1}`,
    role: roles.has(role) ? role : "system",
    text: text(raw.text ?? raw.content),
    enabled: raw.enabled !== false,
    marker: raw.marker === true,
    position: integer(raw.position ?? raw.injection_position),
    depth: integer(raw.depth ?? raw.injection_depth, 4),
    order: integer(raw.order ?? raw.injection_order, 100),
  };
}

export function importPreset(raw, { name, orderId } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("请选择预设 JSON 对象");
  if (Array.isArray(raw.prompts)) {
    const groups = Array.isArray(raw.prompt_order) ? raw.prompt_order : [];
    const selected = orderId !== undefined
      ? groups.find((g) => String(g.character_id) === String(orderId))
      : groups.find((g) => g.character_id === 100001) || groups.at(-1);
    if (orderId !== undefined && !selected) throw new Error("所选提示词顺序不存在");
    const prompts = new Map();
    for (const p of raw.prompts) {
      if (!p.identifier || prompts.has(p.identifier)) throw new Error("提示词 identifier 缺失或重复");
      prompts.set(p.identifier, p);
    }
    const used = new Set();
    const entries = [];
    for (const item of selected?.order || []) {
    if (used.has(item.identifier)) throw new Error("提示词顺序中存在重复条目");
      const p = prompts.get(item.identifier);
      if (!p) throw new Error(`顺序引用了不存在的条目：${item.identifier}`);
      used.add(item.identifier);
      entries.push(entry({ ...p, enabled: item.enabled !== false }, entries.length));
    }
    for (const p of raw.prompts) {
      if (!used.has(p.identifier)) entries.push(entry({ ...p, enabled: !selected }, entries.length));
    }
    return normalizePreset({
      id: randomUUID(), name: name || raw.name || "导入的酒馆预设", entries,
      source: { kind: "sillytavern", orderId: selected?.character_id, original: raw },
      variables: { user: "用户", char: "助手" },
    });
  }
  if (!Array.isArray(raw.entries)) throw new Error("文件缺少 prompts 或 entries，不能作为预设导入");
  return normalizePreset({ ...raw, id: randomUUID(), name: name || raw.name });
}

export function normalizePreset(raw) {
  if (!raw || !Array.isArray(raw.entries) || raw.entries.length > 2000) throw new Error("预设条目无效或超过 2000 条");
  const entries = raw.entries.map(entry);
  if (new Set(entries.map((e) => e.id)).size !== entries.length) throw new Error("条目 ID 重复");
  const variables = {};
  for (const [key, value] of Object.entries(raw.variables || {})) {
    if (typeof value === "string") Object.defineProperty(variables, key, { value, enumerable: true });
  }
  return {
    id: text(raw.id) || randomUUID(), name: text(raw.name) || "未命名预设",
    entries, variables, source: raw.source && typeof raw.source === "object" ? raw.source : null,
  };
}

export function initialState() {
  const original = JSON.parse(fs.readFileSync(new URL("./prompt-presets-default.json", import.meta.url), "utf8"));
  const preset = importPreset(original, { name: "夏瑾 天琴座 V2 Beta 1.0" });
  preset.id = DEFAULT_ID;
  return { format: FORMAT, version: 1, revision: 0, enabled: true, activePresetId: preset.id, presets: [preset] };
}

export function normalizeState(raw) {
  if (raw?.format !== FORMAT || raw.version !== 1 || !Array.isArray(raw.presets) || !raw.presets.length || raw.presets.length > 50) {
    throw new Error("预设库格式无效（需为 dsh-purge-prompts v1）");
  }
  const presets = raw.presets.map(normalizePreset);
  if (new Set(presets.map((p) => p.id)).size !== presets.length) throw new Error("预设 ID 重复");
  if (!presets.some((p) => p.id === raw.activePresetId)) throw new Error("当前预设不存在");
  const revision = Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0;
  return { format: FORMAT, version: 1, revision, enabled: raw.enabled !== false, activePresetId: raw.activePresetId, presets };
}

export function createPresetStore(home) {
  const file = path.join(home, "dsh-purge", "prompt-presets.json");
  let cached;
  let stamp;
  function load() {
    let stat;
    try { stat = fs.statSync(file); } catch (e) { if (e.code !== "ENOENT") throw e; }
    const nextStamp = stat ? `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}` : "default";
    if (cached && stamp === nextStamp) return structuredClone(cached);
    if (stat?.size > MAX_BYTES) throw new Error("预设库超过 8 MB");
    cached = stat ? normalizeState(JSON.parse(fs.readFileSync(file, "utf8"))) : initialState();
    stamp = nextStamp;
    return structuredClone(cached);
  }
  function save(raw, expectedRevision) {
    const current = load();
    if (expectedRevision !== current.revision) throw new Error("预设已在其他窗口修改，请刷新后再保存");
    const state = normalizeState(raw);
    state.revision = current.revision + 1;
    const data = JSON.stringify(state, null, 2) + "\n";
    if (Buffer.byteLength(data) > MAX_BYTES) throw new Error("预设库超过 8 MB");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, data, { flag: "wx" });
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    stamp = undefined;
    return load();
  }
  return { load, save, active() { const s = load(); return s.enabled ? s.presets.find((p) => p.id === s.activePresetId) : null; } };
}

/** 只解释白名单宏，不执行脚本、正则或表达式。变量限于本次请求。 */
export function macroEngine(values = {}, random = Math.random) {
  const vars = new Map(Object.entries(values));
  const warnings = new Set();
  const unresolved = new Set();
  const trimToken = "\u0000DSH_TRIM\u0000";
  function render(input, nesting = 0) {
    if (nesting > 64) throw new Error("宏嵌套超过 64 层");
    let output = "";
    let cursor = 0;
    while (cursor < input.length) {
      const start = input.indexOf("{{", cursor);
      if (start < 0) { output += input.slice(cursor); break; }
      output += input.slice(cursor, start);
      let depth = 1, end = start + 2;
      for (; end < input.length && depth; end++) {
        if (input.slice(end, end + 2) === "{{") { depth++; end++; }
        else if (input.slice(end, end + 2) === "}}") { depth--; end++; }
      }
      if (depth) { unresolved.add("未闭合的宏"); output += input.slice(start); break; }
      const whole = input.slice(start, end);
      const raw = input.slice(start + 2, end - 2);
      cursor = end;
      // 注释内部的宏不求值，避免注释意外改写变量。
      if (raw.trimStart().startsWith("//")) continue;
      const body = render(raw, nesting + 1);
        const parts = body.split("::");
        const key = parts.shift().trim();
        const lower = key.toLowerCase();
        let result;
        if (lower.startsWith("//")) result = "";
        else if (lower === "trim") result = trimToken;
        else if (lower === "setvar") { vars.set(parts.shift(), parts.join("::")); result = ""; }
        else if (lower === "getvar") {
          const name = parts.join("::");
          if (!vars.has(name)) warnings.add(`变量 ${name} 未设置，按空文本处理`);
          result = vars.get(name) ?? "";
        } else if (lower === "random") {
          const choices = parts.length > 1 ? parts : (parts[0] || "").split(",");
          result = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))] || "";
        } else if (/^roll\s+1d\d+$/i.test(key)) {
          const max = Number(key.match(/1d(\d+)/i)[1]);
          if (max < 1 || max > 1e9) throw new Error("掷骰范围无效");
          result = String(1 + Math.min(max - 1, Math.floor(random() * max)));
        } else if (vars.has(key)) result = vars.get(key);
        else { unresolved.add(key); warnings.add(`不支持的宏：${key}`); result = whole; }
        output += String(result);
    }
    return output;
  }
  function expand(input) { return render(String(input)).replace(new RegExp(`\\s*${trimToken}\\s*`, "g"), ""); }
  return { expand, warnings, unresolved, vars };
}

export function presetWarnings(preset) {
  const out = [];
  const raw = preset.source?.original;
  const regex = raw?.extensions?.regex_scripts;
  if (Array.isArray(regex) && regex.length) out.push(`原文件包含 ${regex.length} 个酒馆正则脚本，已保留在导出数据中；DSH 不执行这些脚本。`);
  if (raw) out.push("原文件的采样参数不自动覆盖 DSH 模型设置。角色卡、世界书和示例对话标记需要由当前会话提供对应内容。");
  if (preset.entries.some((e) => e.enabled && e.position === 1 && e.role === "system")) out.push("为兼容不同模型，system 深度条目会按顺序合并到系统提示词，不保留其历史深度。");
  return out;
}

export function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  return (message?.content || []).filter((p) => p.type === "text").map((p) => p.text).join("\n");
}

export function compilePreset(preset, { messages = [], random, variables = {} } = {}) {
  const last = (role) => messageText([...messages].reverse().find((m) => m.role === role));
  const engine = macroEngine({ ...preset.variables, ...variables, lastusermessage: last("user"), lastcharmessage: last("assistant") }, random);
  const warnings = new Set(presetWarnings(preset));
  const system = [];
  const before = [];
  const after = [];
  const depth = [];
  let passedHistory = false;
  for (const e of preset.entries) {
    if (!e.enabled) continue;
    if (e.marker) { if (e.id === "chatHistory" || e.identifier === "chatHistory") passedHistory = true; continue; }
    if (e.injection_trigger?.length) warnings.add(`条目“${e.name}”的酒馆触发条件未迁移，将按条目开关执行。`);
    const rendered = engine.expand(e.text);
    if (!rendered.trim()) continue;
    if (engine.unresolved.size) throw new Error(`条目“${e.name}”仍有无法展开的宏：${[...engine.unresolved].join("、")}`);
    const item = { id: e.id, name: e.name, role: e.role, text: rendered, depth: e.depth, order: e.order };
    if (e.role === "system") system.push(item);
    else if (e.position === 1) depth.push(item);
    else (passedHistory ? after : before).push(item);
  }
  for (const warning of engine.warnings) warnings.add(warning);
  return { system: system.map((e) => e.text).join("\n\n"), before, after, depth, warnings: [...warnings] };
}

export function assembleMessages(compiled, source, { provider, model } = {}) {
  const make = (e) => ({
    id: `dsh-purge-preset:${randomUUID()}`, role: e.role,
    content: [{ type: "text", text: e.text }],
    source: e.role === "assistant" ? { kind: "model", provider: provider || "dsh-foreign", model: model || "dsh-foreign" } : { kind: "plugin", plugin: "dsh-purge" },
  });
  const history = source.filter((m) => m.role === "system" || !String(m.id || "").startsWith("dsh-purge-preset:"));
  const slots = new Map();
  for (const item of compiled.depth) {
    let at = Math.max(0, history.length - item.depth);
    // 不把提示词插入 assistant 工具调用与工具结果之间。
    while (at > 0 && history[at]?.role === "tool") at--;
    if (!slots.has(at)) slots.set(at, []);
    slots.get(at).push(item);
  }
  const result = [];
  let start = 0;
  while (["system", "developer"].includes(history[start]?.role)) result.push(history[start++]);
  result.push(...compiled.before.map(make));
  for (let i = 0; i < start; i++) result.push(...(slots.get(i) || []).sort((a, b) => a.order - b.order).map(make));
  for (let i = start; i <= history.length; i++) {
    result.push(...(slots.get(i) || []).sort((a, b) => a.order - b.order).map(make));
    if (i < history.length) result.push(history[i]);
  }
  result.push(...compiled.after.map(make));
  return result;
}

export function handlePresetAction(body, store) {
  if (body?.action === "import") {
    const list = Array.isArray(body.data?.presets) ? body.data.presets : [body.data];
    if (!list.length || list.length > 50) throw new Error("一次最多导入 50 套预设");
    const presets = list.map((p) => importPreset(p, { name: list.length === 1 ? body.name : undefined, orderId: body.orderId }));
    return { ok: true, presets };
  }
  if (body?.action === "preview") {
    const preset = normalizePreset(body.preset);
    const messages = [{ role: "user", content: [{ type: "text", text: typeof body.message === "string" ? body.message : "预览用的最新用户消息" }] }];
    return { ok: true, preview: compilePreset(preset, { messages }) };
  }
  if (body?.action === "save") {
    const active = body.state?.presets?.find((p) => p.id === body.state.activePresetId);
    if (body.state?.enabled !== false) compilePreset(normalizePreset(active));
    return { ok: true, state: store.save(body.state, body.revision) };
  }
  throw new Error("未知预设操作");
}
