# 夏瑾预设版

本分支基于 dsh-purge 1.1.39，版本为 `1.1.40-xiajin.1`。新增类似 preset-plus 的多预设编辑器，内置用户提供的「夏瑾 天琴座 V2 Beta 1.0.json」。上游宿主补丁未在此改动中扩展。

## 使用

打开会话标题旁的 dsh-purge，在「清洗」页找到「提示词预设」。首次使用默认启用内置夏瑾预设。默认读取酒馆全局顺序 `100001`：144 个条目中启用 31 个，未列入该顺序的条目保留但关闭。

可以切换或新建预设、导入 JSON、修改名称、启停条目、编辑角色和内容、上下移动条目，以及调整会话深度。点击条目名称打开编辑器。修改后点击「保存更改」，下一次主会话模型请求生效。插件本身首次安装或更新仍需要重启宿主加载代码。

预设启用时，插件不再注入旧的 prompt-inject.md、默认规则文案和 postPrompt；旧文本文件仍保留。关闭「启用预设」并保存，会回到原有文本提示词流程。子代理和带 purpose 的后台模型请求不注入这套写作预设。

「查看发送预览」用一条本地测试消息展开宏，不向模型发送请求。真实请求使用当前会话的最近用户消息与模型回复；每次请求的随机值重新生成。

## 导入和导出

支持以下格式：

- 酒馆生成预设：`prompts` 与 `prompt_order`。
- preset-plus 单预设：`entries`，每项使用 `role/text/enabled`。
- preset-plus 多预设文档：`presets`。
- 本插件导出的 `dsh-purge-prompts` v1 预设库。

导入时追加为新预设，不覆盖已有同名项目。导入只修改编辑区，保存后生效。导出包含全部预设及原始酒馆数据；本插件可重新导入该文件，它不是可直接导回酒馆的格式。

当原文件有多套 prompt_order 时，可在编辑器中选一组并点击「按此顺序重新导入」。该操作会以原文件内容重建当前预设条目，并要求确认，避免覆盖条目修改。

保存文件为 `$DSH_HOME/dsh-purge/prompt-presets.json`。保存前检查版本号，旧窗口不能覆盖另一个窗口刚保存的更改。文件损坏时报告错误，不用默认值静默覆盖。

## 宏和顺序

支持 `setvar`、`getvar`、`trim`、注释、`random`、`roll 1dN`、`user`、`char`、`lastusermessage` 和 `lastcharmessage`。变量作用域限于本次请求，不执行脚本或表达式。嵌套宏会先展开内层。

按启用条目的列表顺序展开宏；遇到 chatHistory 标记时划分历史前后条目。user/assistant 条目保留角色，酒馆的 model 角色映射为 assistant。system 文本合并到宿主系统提示词中，不强制把首条 user 改成 system。插入的消息只存在于本次请求副本中，不写入会话历史。

user/assistant 深度条目支持 depth 与 order；深度以 DSH 的消息条数计算，可能与酒馆对一轮对话的计数不同。遇到工具结果时向前调整插入点，避免拆开工具调用和工具结果。system 深度条目合并进系统提示词，不保留其历史深度。未知宏会阻止保存启用的预设和发送请求，错误中显示需要修改的条目。

## 兼容范围

此版本没有实现完整酒馆运行环境：

- 原文件的 11 个正则脚本保存在预设数据中，但不执行。酒馆的输出清理和显示效果不会自动复现。
- temperature、top_p、max_tokens 等采样参数不自动覆盖 DSH 模型设置。
- 角色卡、世界书、persona、场景和示例对话占位符不自动加载外部内容；需要时添加普通文本条目或在当前会话提供。
- 非空 injection_trigger 条件没有等价映射，会在预览中提示；该条目仍由启用开关控制。
- user/assistant 的历史前后顺序可以保留；各 system 条目与它们的任意交错顺序不能完全保留。

导入、宏、请求组装、递归调用和文件保存已有本地自动化测试；未向真实模型发送验证请求，也未替换当前运行的桌面安装。0.2.0-rc.2 的原有 app.asar 切换问题仍需在宿主重启流程中解决，不能用磁盘补丁计数代替运行验证。

## 安装本地包

官方桌面版使用 `default` profile。将 npm 包路径换成实际下载路径，在可用的 dsh 终端执行：

```powershell
dsh plugin --profile default add "C:\实际路径\dsh-purge-1.1.40-xiajin.1.tgz"
```

保存桌面端工作后完全退出并重新打开，以加载新插件代码。若原版已经安装而插件管理器提示已存在，应在插件管理界面使用更新或替换流程，不要改装到 desktop 或 web profile。

GitHub 更新源已改为 `yruh/dsh-purge`。发布本分支前，远端 master 仍可能是旧版，不要在插件内选择旧版本覆盖本地夏瑾版。

## 开发验证

```sh
npm test
npm run build:client
node --check client.js
node --check lib/index.js
```

编辑器源码在 `lib/prompt-presets-client.js`，通过构建脚本嵌入 `client.js`。默认 JSON 保存在 `lib/prompt-presets-default.json`，与用户提供的原文件逐字节一致。

顺序选择依据：[SillyTavern 的 global promptOrder 配置](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/openai.js)。
