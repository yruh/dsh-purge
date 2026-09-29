import fs from "node:fs";
const clientFile = new URL("../client.js", import.meta.url);
const source = fs.readFileSync(new URL("../lib/prompt-presets-client.js", import.meta.url), "utf8");
const begin = "/* __DSH_PROMPT_PRESETS_BEGIN__ */";
const end = "/* __DSH_PROMPT_PRESETS_END__ */";
let client = fs.readFileSync(clientFile, "utf8");
const fragment = `${begin}\n${source}\n${end}`;
if (client.includes(begin)) {
  const start = client.indexOf(begin), finish = client.indexOf(end, start);
  if (finish < 0) throw new Error("预设编辑器结束标记缺失");
  client = client.slice(0, start) + fragment + client.slice(finish + end.length);
} else {
  const at = client.indexOf("function promptBoxEmpty(text)");
  if (at < 0) throw new Error("预设编辑器插入位置不存在");
  client = client.slice(0, at) + fragment + "\n" + client.slice(at);
}
fs.writeFileSync(clientFile, client);
console.log("已生成预设编辑器客户端");
