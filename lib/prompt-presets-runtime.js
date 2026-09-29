import { randomUUID } from "node:crypto";
import { assembleMessages, compilePreset, messageText } from "./prompt-presets.js";
const originalSystems = new WeakMap();

export function buildPresetRequest(options, preset) {
  const source = (options.messages || []).filter((m) => !String(m.id || "").startsWith("dsh-purge-preset:"));
  const compiled = compilePreset(preset, { messages: source });
  const systemText = compiled.system;
  let hasSystem = false;
  const history = source.map((message) => {
    if (message.role !== "system") return message;
    message = originalSystems.get(message) || message;
    hasSystem = true;
    if (!systemText) return message;
    const updated = Object.freeze({ ...message, content: Object.freeze([Object.freeze({ type: "text", text: [messageText(message), systemText].filter(Boolean).join("\n\n") })]) });
    originalSystems.set(updated, message);
    return updated;
  });
  if (systemText && !hasSystem) history.unshift(Object.freeze({
    id: `dsh-purge-preset:${randomUUID()}`, role: "system", source: Object.freeze({ kind: "system-prompt" }),
    content: Object.freeze([{ type: "text", text: systemText }]),
  }));
  const messages = assembleMessages(compiled, history, options).map((message) => {
    if (Object.isFrozen(message)) return message;
    return Object.freeze({ ...message, source: Object.freeze({ ...message.source }), content: Object.freeze(message.content.map((block) => Object.freeze({ ...block }))) });
  });
  return { request: Object.freeze({ ...options, messages: Object.freeze(messages) }), warnings: compiled.warnings };
}

/** 只处理主会话的模型请求；派生请求保留宿主原有流程。 */
export function installPresetRuntime(ctx, store) {
  const inFlight = new WeakSet();
  return ctx.on("llm/stream", (options, next) => {
    if (inFlight.has(options) || options.purpose !== undefined || !options.sessionId) return next();
    const agent = ctx.get?.("agents")?.get(options.sessionId);
    if (agent?.session?.header?.origin === "subagent") return next();
    const preset = store.active();
    if (!preset) return next();
    const { request } = buildPresetRequest(options, preset);
    inFlight.add(request);
    return ctx.llm.stream(request);
  }, { global: true });
}
