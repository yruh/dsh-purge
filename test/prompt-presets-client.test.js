import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { initialState, handlePresetAction } from "../lib/prompt-presets.js";

test("编辑器导入只改草稿，保存后保持全量条目与启用状态", async () => {
  let saved = initialState();
  const slots = [];
  let cursor = 0;
  let initialized = false;
  const effects = [];
  const calls = [];
  const sandbox = {
    structuredClone, crypto: webcrypto, console,
    useState(value) { const at = cursor++; if (!(at in slots)) slots[at] = value; return [slots[at], (next) => { slots[at] = typeof next === "function" ? next(slots[at]) : next; }]; },
    useRef(value) { const at = cursor++; if (!(at in slots)) slots[at] = { current: value }; return slots[at]; },
    useEffect(fn) { if (!initialized) effects.push(fn); },
    h(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity).filter((x) => x !== null && x !== false) }; },
    Btn: "button",
    async apiJson(_url, options) {
      if (!options) return { ok: true, state: structuredClone(saved) };
      const body = JSON.parse(options.body); calls.push(body.action);
      return handlePresetAction(body, { save(raw, revision) { assert.equal(revision, saved.revision); saved = structuredClone(raw); saved.revision++; return structuredClone(saved); } });
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL("../lib/prompt-presets-client.js", import.meta.url), "utf8"), sandbox);
  const render = () => { cursor = 0; const result = sandbox.PromptPresetsSection(); initialized = true; return result; };
  const nodes = (root) => [root, ...(root?.children || []).flatMap((n) => typeof n === "object" ? nodes(n) : [])];
  render(); effects.forEach((fn) => fn()); await new Promise(setImmediate);
  let view = render();
  const file = nodes(view).find((n) => n.props?.type === "file");
  file.props.onChange({ target: { files: [{ size: 90, name: "新.json", text: async () => JSON.stringify({ entries: [{ role: "user", text: "新内容", enabled: false }] }) }], value: "file" } });
  await new Promise(setImmediate);
  assert.equal(saved.presets.length, 1);
  view = render();
  const save = nodes(view).find((n) => n.type === "button" && n.children.includes("保存更改"));
  assert.ok(save);
  await save.props.onClick();
  assert.equal(saved.presets.length, 2);
  assert.equal(saved.presets[0].entries.length, 144);
  assert.equal(saved.presets[1].entries[0].enabled, false);
  assert.deepEqual(calls, ["import", "save"]);
  assert.ok(nodes(render()).some((n) => n.type === "button" && n.children.includes("已保存")));
});
