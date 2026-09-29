// 构建时嵌入 client.js，共用宿主 React 与插件 API。
function PromptPresetsSection() {
  const [state, setState] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(null);
  const [sample, setSample] = useState("开始一段虚构冒险故事。");
  const [orderId, setOrderId] = useState("");
  const fileRef = useRef(null);
  const api = (body) => apiJson("/dsh-purge/prompt-presets", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  useEffect(() => {
    let live = true;
    api().then((data) => { if (live) setState(data.state); }).catch((e) => { if (live) setNotice(e.message); });
    return () => { live = false; };
  }, []);
  const preset = state?.presets.find((p) => p.id === state.activePresetId);
  const selected = preset?.entries.find((e) => e.id === selectedId);
  const change = (fn) => { setState((s) => fn(structuredClone(s))); setDirty(true); setPreview(null); setNotice(""); };
  const editPreset = (fn) => change((s) => { fn(s.presets.find((p) => p.id === s.activePresetId)); return s; });
  const editEntry = (fields) => editPreset((p) => Object.assign(p.entries.find((e) => e.id === selectedId), fields));
  const act = async (fn) => { setBusy(true); setNotice(""); try { await fn(); } catch (e) { setNotice(e.message); } finally { setBusy(false); } };
  const inputStyle = { width: "100%", boxSizing: "border-box", padding: "6px 8px", color: "inherit", background: "var(--dshp-bg, transparent)", border: "1px solid var(--dshp-line, #8886)", borderRadius: 4 };
  const button = (label, onClick, disabled = false) => h(Btn, { tiny: true, disabled: busy || disabled, onClick }, label);
  const download = () => {
    const blob = new Blob([JSON.stringify(state, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "dsh-purge-提示词预设.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const onImport = (event) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    act(async () => {
      if (file.size > 8 * 1024 * 1024) throw new Error("文件超过 8 MB");
      const data = JSON.parse(await file.text());
      const result = await api({ action: "import", data, name: data.prompts ? file.name.replace(/\.json$/i, "") : undefined });
      change((s) => { s.presets.push(...result.presets); s.activePresetId = result.presets[0].id; return s; });
      setSelectedId(""); setOrderId(""); setNotice("已导入到编辑区，保存后生效。");
    });
  };
  if (!state) return h("section", { className: "dshp-sub" }, notice || "正在读取提示词预设……");
  const entries = preset.entries.filter((e) => (!enabledOnly || e.enabled) && (!query || e.name.toLowerCase().includes(query.toLowerCase())));
  const groups = preset.source?.original?.prompt_order || [];
  return h("section", { "aria-label": "提示词预设", style: { marginTop: 20 } },
    h("h4", null, "提示词预设"),
    h("p", { className: "dshp-hint" }, "保存后从下一次模型请求生效。预设用于主会话，子代理保持原有流程。"),
    h("label", null, h("input", { type: "checkbox", checked: state.enabled, disabled: busy, onChange: (e) => change((s) => { s.enabled = e.target.checked; return s; }) }), " 启用预设（替代下方旧提示词）"),
    h("div", { className: "dshp-row", style: { flexWrap: "wrap", marginTop: 10 } },
      h("select", { "aria-label": "当前预设", disabled: busy, value: state.activePresetId, style: { ...inputStyle, width: "auto", maxWidth: "100%" }, onChange: (e) => { const id = e.target.value; change((s) => { s.activePresetId = id; return s; }); setSelectedId(""); setOrderId(""); } }, state.presets.map((p) => h("option", { key: p.id, value: p.id }, p.name))),
      button(dirty ? "保存更改" : "已保存", () => act(async () => { const result = await api({ action: "save", state, revision: state.revision }); setState(result.state); setDirty(false); setNotice("已保存，下次请求使用当前配置。"); }), !dirty),
      button("导入 JSON", () => fileRef.current.click()), button("导出预设库", download),
      button("新建", () => change((s) => { const p = { id: crypto.randomUUID(), name: "新预设", variables: { user: "用户", char: "助手" }, entries: [] }; s.presets.push(p); s.activePresetId = p.id; return s; })),
      button("复制", () => change((s) => { const p = structuredClone(s.presets.find((p) => p.id === s.activePresetId)); p.id = crypto.randomUUID(); p.name += "（副本）"; s.presets.push(p); s.activePresetId = p.id; return s; })),
      button("删除预设", () => { if (window.confirm("删除当前预设？保存前可刷新恢复。")) change((s) => { s.presets = s.presets.filter((p) => p.id !== s.activePresetId); s.activePresetId = s.presets[0].id; return s; }); }, state.presets.length < 2),
      h("input", { ref: fileRef, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: onImport }),
    ),
    h("label", null, "预设名称", h("input", { value: preset.name, disabled: busy, style: inputStyle, onChange: (e) => editPreset((p) => { p.name = e.target.value; }) })),
    groups.length > 1 ? h("div", { className: "dshp-row", style: { flexWrap: "wrap" } },
      h("label", null, "原文件顺序 ", h("select", { value: orderId || String(preset.source.orderId), disabled: busy, onChange: (e) => setOrderId(e.target.value) }, groups.map((g) => h("option", { key: g.character_id, value: String(g.character_id) }, `${g.character_id}（${g.order.filter((x) => x.enabled).length} 项启用）`)))),
      button("按此顺序重新导入", () => { if (!window.confirm("这会用原文件重建当前预设的条目，替换本页条目修改。")) return; act(async () => { const result = await api({ action: "import", data: preset.source.original, name: preset.name, orderId: orderId || preset.source.orderId }); editPreset((p) => { const id = p.id; Object.assign(p, result.presets[0], { id }); }); setSelectedId(""); }); }),
    ) : null,
    h("div", { className: "dshp-row", style: { flexWrap: "wrap" } },
      h("input", { type: "search", "aria-label": "搜索条目", placeholder: "搜索条目名称", value: query, style: { ...inputStyle, width: "min(240px, 100%)" }, onChange: (e) => setQuery(e.target.value) }),
      h("label", null, h("input", { type: "checkbox", checked: enabledOnly, onChange: (e) => setEnabledOnly(e.target.checked) }), " 只看启用项"),
      h("span", { className: "dshp-hint" }, `${preset.entries.filter((e) => e.enabled).length} / ${preset.entries.length} 项启用`),
      button("添加条目", () => { const id = crypto.randomUUID(); editPreset((p) => p.entries.push({ id, name: "新条目", role: "user", text: "", enabled: true, position: 0, depth: 4, order: 100 })); setSelectedId(id); }),
    ),
    h("div", { style: { maxHeight: 300, overflow: "auto", border: "1px solid var(--dshp-line, #8886)" } }, entries.map((e) => h("div", { key: e.id, style: { display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", background: e.id === selectedId ? "var(--dshp-hover, #8882)" : "transparent" } },
      h("input", { type: "checkbox", "aria-label": `启用 ${e.name}`, checked: e.enabled, disabled: busy, onChange: (event) => editPreset((p) => { p.entries.find((x) => x.id === e.id).enabled = event.target.checked; }) }),
      h("button", { type: "button", onClick: () => setSelectedId(e.id), style: { flex: 1, textAlign: "left", background: "none", color: "inherit", border: 0, cursor: "pointer", padding: 4 } }, e.name),
      h("small", null, e.marker ? "占位" : e.role),
    ))),
    selected ? h("div", { style: { marginTop: 12 } },
      h("label", null, "条目名称", h("input", { value: selected.name, disabled: busy, style: inputStyle, onChange: (e) => editEntry({ name: e.target.value }) })),
      h("div", { className: "dshp-row", style: { flexWrap: "wrap" } },
        h("select", { "aria-label": "条目角色", value: selected.role, disabled: busy || selected.marker, onChange: (e) => editEntry({ role: e.target.value }) }, ["system", "user", "assistant"].map((r) => h("option", { key: r }, r))),
        button("上移", () => editPreset((p) => { const i = p.entries.findIndex((e) => e.id === selectedId); [p.entries[i - 1], p.entries[i]] = [p.entries[i], p.entries[i - 1]]; }), preset.entries[0].id === selectedId),
        button("下移", () => editPreset((p) => { const i = p.entries.findIndex((e) => e.id === selectedId); [p.entries[i + 1], p.entries[i]] = [p.entries[i], p.entries[i + 1]]; }), preset.entries.at(-1).id === selectedId),
        button("删除条目", () => { if (window.confirm("删除此条目？")) { editPreset((p) => { p.entries = p.entries.filter((e) => e.id !== selectedId); }); setSelectedId(""); } }),
      ),
      selected.marker ? h("p", { className: "dshp-hint" }, selected.id === "chatHistory" ? "会话历史会放在此位置。" : "酒馆内容占位符：不会自动读取角色卡或世界书；需要时请添加普通文本条目。") : h("div", null,
        h("textarea", { "aria-label": "条目内容", className: "dshp-area", value: selected.text, disabled: busy, spellCheck: false, onChange: (e) => editEntry({ text: e.target.value }) }),
        h("div", { className: "dshp-row", style: { flexWrap: "wrap" } },
          h("label", null, "插入位置 ", h("select", { value: selected.position, disabled: busy, onChange: (e) => editEntry({ position: Number(e.target.value) }) }, h("option", { value: 0 }, "按列表顺序"), h("option", { value: 1 }, "会话深度"))),
          selected.position === 1 ? h("label", null, "深度 ", h("input", { type: "number", min: 0, max: 10000, value: selected.depth, disabled: busy, style: { width: 70 }, onChange: (e) => editEntry({ depth: Number(e.target.value) }) })) : null,
          selected.position === 1 ? h("label", null, "同深度顺序 ", h("input", { type: "number", min: 0, max: 10000, value: selected.order, disabled: busy, style: { width: 70 }, onChange: (e) => editEntry({ order: Number(e.target.value) }) })) : null,
        ),
      ),
    ) : h("p", { className: "dshp-hint" }, "点击条目名称编辑内容。"),
    h("div", { className: "dshp-row", style: { flexWrap: "wrap" } }, ["user", "char"].map((key) => h("label", { key }, key === "user" ? "用户称呼 " : "角色称呼 ", h("input", { value: preset.variables?.[key] || "", disabled: busy, onChange: (e) => editPreset((p) => { p.variables = { ...p.variables, [key]: e.target.value }; }) })))),
    h("details", null, h("summary", null, "查看发送预览"),
      h("p", { className: "dshp-hint" }, "预览只在本机展开宏，不发送给模型。真实请求会使用当前会话的最近消息；随机值会重新生成。"),
      h("input", { "aria-label": "预览用户消息", value: sample, style: inputStyle, onChange: (e) => setSample(e.target.value) }),
      button("生成预览", () => act(async () => { const result = await api({ action: "preview", preset, message: sample }); setPreview(result.preview); })),
      preview ? h("div", null,
        h("ul", null, preview.warnings.map((w) => h("li", { key: w }, w))),
        h("pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 420, overflow: "auto" } }, JSON.stringify(preview, null, 2)),
      ) : null,
    ),
    preset.source?.original?.extensions?.regex_scripts?.length ? h("p", { className: "dshp-hint" }, `已保留原文件的 ${preset.source.original.extensions.regex_scripts.length} 个正则脚本；当前不执行酒馆正则，采样参数也不自动覆盖模型设置。`) : null,
    notice ? h("p", { role: "status", style: { whiteSpace: "pre-wrap" } }, notice) : null,
  );
}
