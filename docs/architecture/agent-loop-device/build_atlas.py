#!/usr/bin/env python3
"""Build the source-backed atlas with the user's fireworks-tech-graph toolkit.

Usage: python3 build_atlas.py /absolute/path/to/fireworks-tech-graph
SVG uses explicit Python-list geometry with the toolkit's validator and HTML exporter. No application code is changed.
"""
import json
import sys
from html import escape
from pathlib import Path

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
SKILL = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(SKILL / 'scripts'))
from interactive_html import build_interactive_html
import fireworks_geometry as geometry

SHA = '73e2ea9a09cca9194131b54887c48c15c3755a81'
PALETTE = {
    'blue': ('#eff6ff', '#93c5fd'), 'purple': ('#faf5ff', '#c4b5fd'),
    'green': ('#f0fdf4', '#86efac'), 'orange': ('#fff7ed', '#fdba74'),
    'gray': ('#f8fafc', '#cbd5e1'), 'red': ('#fef2f2', '#fca5a5'),
}
ATLAS = []

def node(id, x, y, title, sub='', color='blue', w=340, h=88, kind='rect'):
    fill, stroke = PALETTE[color]
    return dict(id=id, kind=kind, x=x, y=y, width=w, height=h, label=title,
                sublabel=sub, fill=fill, stroke=stroke, flat=True, title_size=18)

def edge(a, b, label='', flow='data', sp='right', tp='left'):
    return dict(id=a+'--'+b, source=a, target=b, label=label, flow=flow,
                source_port=sp, target_port=tp, label_style='offset')

def base(slug, title, subtitle, height=900, width=1500):
    return dict(slug=slug, schema_version=1, mode='architecture', template_type='architecture',
                style=1, quality_profile='showcase', width=width, height=height,
                title=title, subtitle=subtitle, containers=[], nodes=[], arrows=[],
                legend_orientation='horizontal', legend_x=60, legend_y=height-90,
                legend_locked=True, legend=[{'flow':'data','label':'传递 / 引用'},
                {'flow':'feedback','label':'循环 / 反馈'}, {'flow':'read','label':'读取 / 上下文'}],
                footer='Masterino · feat/workspace-runtime · 73e2ea9a · 2026-09-03 · 静态代码追踪',
                footer_x=60, footer_y=height-30)

def lane(d, id, y, label, cards, labels=None, colors=None, flow='data'):
    d['containers'].append(dict(id=id, x=40, y=y, width=d['width']-80, height=134, label=label))
    count=len(cards); gap=100 if count<=3 else 70
    w=(d['width']-140-gap*(count-1))//count
    for i, (title, sub) in enumerate(cards):
        d['nodes'].append(node(id+str(i),70+i*(w+gap),y+42,title,sub,
                               (colors or ['blue']*count)[i],w=w,h=70))
        if i:
            d['arrows'].append(edge(id+str(i-1),id+str(i),(labels or ['']*(count-1))[i-1],flow))

def add(d, lead, points, rows, refs):
    ATLAS.append(dict(diagram=d, lead=lead, points=points, rows=rows, refs=refs))

d=base('01-runtime-paths','01  谁在运行 agent loop？','先分清 loop 的宿主，再看工具在哪台机器执行。Gateway 是传输与调度链路的一部分。',880)
lane(d,'native-gw',120,'A · 原生 agent / Gateway 模式',[
    ('Web / Electron Renderer','executeGatewayAgent → execAgent'),
    ('服务端 AgentRuntime','LLM ↔ 工具结果；每步保存状态'),
    ('目标设备上的工具','Gateway → Electron Main / CLI daemon')],['创建 operation','远程工具调用'],['blue','purple','green'])
lane(d,'native-client',285,'B · 原生 agent / Client 模式',[
    ('Renderer AgentRuntime','executeClientAgent 内 while 循环'),
    ('客户端工具 Executor','LocalSystemExecutionRuntime'),
    ('Electron Main','IPC → ShellCommandCtr / LocalFileCtr')],['调用工具','IPC'],['purple','blue','green'])
lane(d,'hetero-local',450,'C · Claude Code / Codex / 本机 local',[
    ('Renderer 编排会话','保存 topic、选择 cwd、接收流'),
    ('Electron Main 启动 CLI','HeterogeneousAgentCtr → spawn'),
    ('外部 CLI 自己运行 loop','Claude Code / Codex → 模型与工具')],['IPC','子进程'],['blue','green','purple'])
lane(d,'hetero-gw',615,'D · Claude Code / Codex / device 或 sandbox',[
    ('服务端分发运行','设备：dispatchAgentRun；云：sandboxRunner'),
    ('lh hetero exec','设备或云容器中启动并适配事件'),
    ('外部 CLI 自己运行 loop','事件 → heteroIngest / Finish → UI')],['下发参数','启动 CLI'],['blue','green','purple'])
add(d,'“在 Electron 中聊天”不足以判断 loop 在哪里。原生 agent、外部 CLI，以及是否启用 Gateway，是三个不同维度。',[
    'selectRuntimeType 的优先级是 parentRuntime 显式覆盖 → 外部 agent 路由 → Gateway → Client。',
    '原生 agent 是否走 Gateway，取决于 agentGatewayUrl、enableGatewayMode 和 disableGatewayMode；图中没有假设当前线上开关值。',
    '本机 local 与 device=本机仍是两条链路：对外部 CLI，前者直接 IPC，后者经服务端与 Gateway，便于其它客户端观看。',
    'OpenClaw / Hermes 等远端 agent 总是经 Gateway，平台自身可能另外管理工作区。'],[
    ['概念','决定什么','不要混同'],
    ['runtimeType','client / gateway / hetero：谁驱动这次运行','不等于执行设备'],
    ['executionTarget','none / local / device / sandbox：运行工具的位置意图','不等于 loop 一定在云端'],
    ['ExecutionPlan','服务端得到 device / device-unrouted / none / sandbox','是解析后的本轮决定'],
    ['AGENT_RUNTIME_MODE','服务端内部 local queue 或 QStash queue','这里 local 不是用户的 Electron']
], [('src/store/chat/slices/aiChat/actions/agentDispatcher.ts','export const selectRuntimeType'),
    ('src/store/chat/slices/aiChat/actions/gateway.ts','isGatewayModeEnabled ='),
    ('src/store/chat/slices/aiChat/actions/streamingExecutor.ts','Agent runtime loop start'),
    ('src/helpers/executionTarget.ts','export const resolveExecutionPlan'),
    ('apps/desktop/src/main/controllers/GatewayConnectionCtr.ts','private async executeAgentRun')])

d=base('02-native-loop','02  原生 agent：一轮模型调用之后发生什么','以 Gateway + Electron 工具为例；Client 复用相同的 AgentRuntime / GeneralChatAgent 核心。',800)
d['nodes']=[
    node('llm',100,180,'① 调用模型','call_llm；先组装上下文，必要时压缩','purple',kind='double_rect'),
    node('brain',580,180,'② 决定下一步','llm_result：无 tool_calls 就 finish','purple',kind='double_rect'),
    node('exec',1060,180,'③ 处理工具指令','审批 / 阻塞策略 → call_tools_batch','blue'),
    node('device',1060,480,'④ Electron 执行工具','GatewayConnectionCtr → 文件 / shell','green'),
    node('result',580,480,'⑤ 返回工具结果','content / state / success；写 tool 消息','green'),
    node('save',100,480,'⑥ 保存并推进','newState + events + nextContext','blue'),
]
d['arrows']=[edge('llm','brain','模型结果'),edge('brain','exec','有工具调用'),
    edge('exec','device','设备请求','data','bottom','top'),edge('device','result','工具结果','data','left','right'),
    edge('result','save','持久化结果','data','left','right'),edge('save','llm','下一 step','feedback','top','bottom')]
add(d,'一次用户发言通常创建一个 operation；这个 operation 内会进行很多 step。step 是“规划并执行指令”的单位，并不等于一次完整的 LLM→工具→LLM 循环。',[
    'AgentRuntime.step 克隆 state、递增 stepCount，调用 GeneralChatAgent.runner，执行返回的 instruction，并产生 newState / events / nextContext。',
    'GeneralChatAgent 在 user_input 与 tools_batch_result 等阶段进入下一次 LLM；有 tool_calls 时先应用审批策略；无工具时 finish。',
    '服务端在 step 前可补全设备上下文，step 后保存结果并决定是否再次 scheduleMessage。Client 则在 Renderer 内执行 while 循环。',
    '等待审批、等待异步子 agent、用户中断、错误与结束都会改变推进方式；等待态不会被当作普通下一步不停重跑。',
    '普通 runCommand 的 shell_id 只标识一次子进程及输出缓存。getCommandOutput 观察同一个进程；下一次 runCommand 新建进程。'],[
    ['层','职责','主要实现'],
    ['决策核心','根据 phase/state 选择 instruction','GeneralChatAgent.runner'],
    ['执行核心','执行 instruction 并产生事件与下一上下文','AgentRuntime.step'],
    ['服务端宿主','状态、队列、数据库、流式通知','AgentRuntimeService / Coordinator'],
    ['本地工具代理','把服务端工具请求投递到设备','localSystemRuntime → deviceGateway'],
    ['设备能力','真正读写文件或启动进程','GatewayConnectionCtr → ShellCommandCtr']
], [('packages/agent-runtime/src/core/runtime.ts','async step('),
    ('packages/agent-runtime/src/agents/GeneralChatAgent.ts','async runner('),
    ('apps/server/src/services/agentRuntime/AgentRuntimeService.ts','// Save initial state'),
    ('apps/server/src/services/agentRuntime/AgentRuntimeService.ts','// Decide whether to schedule next step'),
    ('apps/server/src/services/toolExecution/serverRuntimes/localSystem.ts','factory: (context)'),
    ('packages/local-file-shell/src/shell/runner.ts','export async function runCommand')])

d=base('03-device-topic','03  Device、Agent、Topic、Operation 的关系','本图的箭头表示引用 / 归属，不表示时间顺序；以单 agent 会话为主。',790)
d['nodes']=[
    node('device',80,175,'Device：一台机器 + 一个用户','deviceId；defaultCwd；workingDirs[]','green',w=370),
    node('agent',565,175,'Agent：可复用配置','executionTarget / boundDeviceId / 目录映射','blue',w=370),
    node('topic',1050,175,'Topic：长期会话容器','workingDirectory / heteroSessionId / messages','blue',w=370),
    node('channels',80,460,'在线连接 channels','Electron 与 lh connect 可属于同一 device','green',w=370),
    node('plan',565,460,'本轮设备决定','ExecutionPlan → activeDeviceId','orange',w=370),
    node('op',1050,460,'Operation：一次运行','operationId；多 step；同一个 topicId','purple',w=370,kind='double_rect'),
]
d['arrows']=[edge('agent','device','按 deviceId 引用','read','left','right'),
    edge('topic','agent','归属 agent','read','left','right'),edge('op','topic','topicId','read','top','bottom'),
    edge('op','plan','携带路由','data','left','right'),edge('plan','channels','选在线通道','data','left','right'),
    edge('channels','device','相同 deviceId','read','top','bottom')]
add(d,'deviceId 标识机器身份，topicId 标识会话，operationId 标识本次运行；它们不会自动创建同名的文件夹。',[
    'deviceId 优先由 machineId + userId + 命名空间哈希得到，机器标识不可用时才用持久化 UUID 回退。connectionId 则区分安装 / 连接，避免同机 Electron 与 CLI 互相踢掉。',
    'Agent 的 workingDirByDevice 以 deviceId 为键；Device 的 workingDirs 是最近目录和扫描缓存，defaultCwd 是用户配置的设备默认目录。',
    'Topic 的 workingDirectory 是会话级覆盖。选择目录时，有 topic 就写 topic；无 topic 就写 Agent 的 per-device 映射；最近目录始终写入目标 Device，且不顺带修改 defaultCwd。',
    '普通服务端设备选择：聊天模式先变成 none；否则请求 deviceId 优先于 Agent binding。明确绑定离线时不改派另一台机器；无绑定且恰好一台在线才自动激活。',
    '当前 execAgent 虽可保存 topic.metadata.boundDeviceId，但本段路由读取的是请求 deviceId 与 agent.agencyConfig.boundDeviceId；没有把已存 topic.boundDeviceId 自动读回作为解析输入。'],[
    ['对象','生命周期 / 范围','关键字段'],
    ['Device','用户拥有的机器，跨会话','deviceId / defaultCwd / workingDirs / channels'],
    ['Agent','同一个 agent 可有多个 topic','agencyConfig.executionTarget / workingDirByDevice'],
    ['Topic','多轮对话、分组与恢复依据','metadata.workingDirectory / heteroSessionId'],
    ['Operation','一次执行，多 step，可暂停与继续','activeDeviceId / nextContext / executionPlan'],
    ['workspaceId','组织空间的数据隔离 ID','不是本地项目目录，也不是 cwd']
], [('packages/device-identity/src/index.ts','const deviceId = createHash'),
    ('apps/desktop/src/main/services/gatewayConnectionSrv.ts','getConnectionId()'),
    ('src/features/ChatInput/ControlBar/useCommitWorkingDirectory.ts','const writeCwd ='),
    ('packages/types/src/device.ts','export interface WorkingDirEntry'),
    ('apps/server/src/services/aiAgent/index.ts','const topicBoundDeviceId = requestedDeviceId'),
    ('src/helpers/executionTarget.ts','const boundDeviceId = requestedDeviceId')])

d=base('04-cwd-precedence','04  工作目录优先级：不同入口尚未完全统一','前三行从左向右取首个非空值；最后一行说明真实进程目录。各入口不能跨行套用。',880,width=1660)
lane(d,'ui',120,'界面项目目录 · useEffectiveWorkingDirectory',[
    ('Topic 目录','metadata.workingDirectory'),('Agent 设备目录','workingDirByDevice[deviceId]'),
    ('旧本机配置','localStorage per-agent'),('Device 默认目录','defaultCwd'),('桌面 / Home','desktopPath → homePath')],['为空']*4,['blue','blue','gray','green','gray'])
lane(d,'server',285,'服务端 · workspace init 与设备端 Claude Code / Codex dispatch',[
    ('Topic 目录','已有会话覆盖'),('新 Topic 初始目录','initialTopicMetadata'),
    ('Agent 设备目录','workingDirByDevice[deviceId]'),('Device 默认目录','defaultCwd → undefined')],['为空']*3,['blue','blue','blue','green'])
lane(d,'localcli',450,'桌面 local 外部 CLI · conversationLifecycle → getAgentWorkingDirectoryById',[
    ('Topic 目录','metadata.workingDirectory'),('Agent 设备目录','workingDirByDevice[deviceId]'),
    ('旧本机配置','localStorage per-agent'),('桌面 / Home','此入口没有读取 device.defaultCwd')],['为空']*3,['blue','blue','gray','red'])
lane(d,'spawn',615,'底层普通 shell · 真正的进程 cwd',[
    ('params.cwd','若调用方显式传入，就交给 spawn'),('父进程 cwd','未传时继承 Electron / daemon cwd'),
    ('本次命令内的 cd','只改变当前 shell 及其子进程')],['未传','命令可切换'],['orange','red','green'])
add(d,'“选中的项目目录”与“进程正在使用的 cwd”必须分开看。当前代码确实有入口差异，图中按执行语句绘制，而没有把注释中的统一目标当成已完成的实现。',[
    'resolveDeviceWorkingDirectory 是服务端设备目录解析函数：Topic → 新建 Topic 初始值 → Agent per-device → Device default；workspace init 在创建 topic 后读取其 metadata。',
    '桌面 local 外部 CLI 的实际入口目前用 getAgentWorkingDirectoryById，未读 Device default；它与界面 useEffectiveWorkingDirectory 的结果可能不同。原生 Client 的旧 selector 末级是 Home。',
    '原生 Gateway 的设备 systemInfo.workingDirectory 来自 Electron process.cwd()，经 additionalVariables 进入提示词；workspace init 使用的是另外解析出的项目目录。',
    '原生 runCommand 的公开 manifest 没有 cwd 参数；代理、Executor、ShellCommandCtr 对普通命令也未补入 topic 目录。底层 runner 支持 cwd，但必须由调用方提供；否则继承父进程 cwd。',
    'AgentRuntime state.metadata.workingDirectory（客户端选中目录 / 服务端旧 runtimeEnv 字段）属于上下文与审批资料，不会单凭存在就让 OS 改目录。',
    '每次普通 runCommand 都 spawn 新 shell；第一次执行 cd /A，不会让下一次 runCommand 自动在 /A。目录选择也没有调用全局 process.chdir。'],[
    ['具体位置','当前取值','直接改变 OS cwd？'],
    ['topic.metadata.workingDirectory','用户选择 / 首轮外部 CLI 绑定','否，是数据'],
    ['workspace init 的 scope','服务端设备目录优先级结果','否，只定义扫描根'],
    ['Gateway 提示词 workingDirectory','Electron process.cwd()','否，只是文本'],
    ['Client 提示词 workingDirectory','Topic → 旧 selector → Home','否，只是文本'],
    ['spawn({ cwd })','某次进程启动参数','是，只作用于该子进程'],
    ['HOME / PWD / PATH','环境变量字符串','不等于 spawn 的 cwd 参数']
], [('src/hooks/useEffectiveWorkingDirectory.ts','const fallback ='),
    ('src/helpers/agentWorkingDirectory.ts','export const resolveAgentWorkingDirectory'),
    ('apps/server/src/services/aiAgent/resolveDeviceWorkingDirectory.ts','export const resolveDeviceWorkingDirectory'),
    ('src/store/agent/selectors/agentByIdSelectors.ts','const getAgentWorkingDirectoryById'),
    ('src/store/agent/selectors/selectors.ts','const currentAgentWorkingDirectory'),
    ('apps/desktop/src/main/services/gatewayConnectionSrv.ts','workingDirectory: process.cwd()'),
    ('apps/server/src/modules/AgentRuntime/RuntimeExecutors.ts','...state.metadata?.deviceSystemInfo'),
    ('packages/builtin-tool-local-system/src/manifest.ts','name: LocalSystemApiName.runCommand'),
    ('packages/local-file-shell/src/shell/runner.ts','const childProcess = spawn')])

d=base('05-environment','05  环境变量如何进入子进程','左侧是继承来源，右侧同名变量覆盖左侧；不同执行路径有不同的拼装规则。',880,width=1660)
lane(d,'shellenv',120,'A · 普通 local-system.runCommand',[
    ('Electron process.env','启动环境 + fixPath + bundled bin'),('单次 params.env','模型工具参数 / 调用方传入'),
    ('childEnv','{ ...process.env, ...extraEnv }'),('新 shell 进程','/bin/sh -c；Windows 为 cmd.exe /c')],['覆盖合并','得到','spawn'],['gray','orange','blue','green'])
lane(d,'localenv',285,'B · 桌面 local 的 Claude Code / Codex',[
    ('清理后的父环境','移除 3 个 ANTHROPIC_* 认证变量'),('PATH + 代理配置','CLI 检测 PATH；buildProxyEnv'),
    ('session.env','heterogeneousProvider.env 最后覆盖'),('CLI 子进程','spawnEnv 与 cwd 分别传给 spawn')],['补充','覆盖','spawn'],['gray','blue','orange','green'])
lane(d,'gatewayenv',450,'C · Gateway 下发到 Electron 的外部 CLI',[
    ('Electron process.env','此路径未使用本地 CLI 的清理函数'),('应用代理设置','HTTP(S)_PROXY / ALL_PROXY / NO_PROXY'),
    ('运行认证变量','LOBEHUB_JWT / LOBEHUB_SERVER'),('lh → 外部 CLI','CLI spawn 再继承它的 process.env')],['覆盖','覆盖','继承'],['gray','blue','orange','green'])
lane(d,'prompt',615,'D · 提示词上下文：是模型输入文本，不是操作系统环境变量',[
    ('设备 / 项目资料','systemInfo + AGENTS.md + Skill metadata'),('模板与上下文引擎','{{workingDirectory}} 等占位符'),
    ('发送给模型的消息','改变模型所见信息；不会自动 export 或 chdir')],['读取','注入文本'],['green','purple','purple'],flow='read')
add(d,'cwd 是 spawn 选项，env 是子进程环境字典，system prompt 是发给模型的文字。三个通道彼此独立，只有代码显式连接时才会互相影响。',[
    '应用启动调用 fixPath，并把内置二进制和 CLI wrapper 目录追加到 PATH。PATH 负责找可执行文件，不能决定相对文件路径的基准。',
    '普通 shell 的 env 是父环境与 extraEnv 的合并；ShellCommandCtr 的普通路径没有显式应用 buildProxyEnv。应用网络代理的 in-process dispatcher 不会自动成为所有子进程代理。',
    '桌面 local CLI 先删父环境中的 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL，再补检测到的 PATH、应用代理，最后 session.env 覆盖；用户显式 env 可以重新提供这些变量。',
    'Gateway→Electron 的 spawnLhHeteroExec 使用另一套拼装：process.env + 应用代理 + LOBEHUB_JWT/SERVER。这个入口参数没有 heterogeneousProvider.env，也没有调用上述父环境清理函数。',
    '以 lh / lobe / lobehub 开头的命令在 ShellCommandCtr 被转交 CliCtr：注入登录 token 与服务器地址，但没有转发原 params.cwd / params.env。',
    '读取了项目目录不代表自动加载 .env。这里展示的普通 shell 与 workspace init 路径没有自动 dotenv 读取；外部 CLI 自身可能另有配置机制。'],[
    ['类别','代表字段','作用范围'],
    ['应用连接配置','DEVICE_GATEWAY_URL / OFFICIAL_CLOUD_SERVER','Electron 连接与应用配置'],
    ['服务端调度配置','AGENT_RUNTIME_MODE / REDIS_URL / AGENT_GATEWAY_URL','服务端队列、状态和事件路由'],
    ['子进程寻址','PATH / HOME / CODEX_HOME 等','可执行文件查找与 CLI 自身配置'],
    ['子进程代理','HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY','由具体 spawn 入口显式拼装'],
    ['运行认证','LOBEHUB_JWT / LOBEHUB_SERVER','lh 回报消息与调用服务端'],
    ['模型上下文','workingDirectory / homePath / project_instructions','发给 LLM 的文字，不是 process.env']
], [('apps/desktop/src/main/index.ts','fixPath();'),
    ('apps/desktop/src/main/core/App.ts','process.env.PATH ='),
    ('apps/desktop/src/main/controllers/HeterogeneousAgentCtr.ts','const STRIPPED_INHERITED_ENV_KEYS'),
    ('apps/desktop/src/main/controllers/HeterogeneousAgentCtr.ts','spawnEnv ='),
    ('apps/desktop/src/main/controllers/HeterogeneousAgentCtr.ts','spawnLhHeteroExec(params:'),
    ('apps/desktop/src/main/controllers/CliCtr.ts','async runCliCommand'),
    ('apps/desktop/src/main/modules/networkProxy/envBuilder.ts','export const buildProxyEnv'),
    ('packages/heterogeneous-agents/src/spawn/spawnAgent.ts','const childEnv =')])

d=base('06-skills-workspace','06  Skill 执行目录与项目目录是两条链路','桌面 execScript 会显式选择 Skill 解压目录；项目 workspace init 则只准备模型上下文。',805,width=1660)
lane(d,'skillzip',135,'A · 桌面 lobe-skills.execScript：下载型 Skill',[
    ('首个 activatedSkill','resolveExecutionDirectory'),('按 zipHash 准备缓存','下载 zip → extracted/{zipHash}'),
    ('解压目录作为 cwd','localFileService.runCommand({ cwd })'),('脚本子进程','相对资源路径从此目录解析')],['查找 Skill','返回 extractedDir','spawn'],['purple','gray','orange','green'])
lane(d,'project',325,'B · 设备项目 workspace init：在服务端原生运行准备阶段',[
    ('解析项目根目录','Topic / Agent per-device / Device default'),('设备扫描 + 缓存','AGENTS.md / CLAUDE.md / skills'),
    ('模型上下文','指令正文 + project Skill 元数据'),('按需读取 Skill','readFile / globFiles 指向绝对路径')],['initWorkspace RPC','注入','激活时读取'],['blue','green','purple','green'],flow='read')
lane(d,'cloudskill',515,'C · 服务端 SkillsService 的脚本路径',[
    ('runCommand / execScript','要求 topicId'),('createSandboxService','以 userId + topicId 构造服务'),
    ('sandbox.callTool','下载型 Skill 的 zip URL 随参数传入')],['绑定 topic','云工具'],['purple','blue','green'])
add(d,'项目 Skill 是代码仓库中的能力说明；下载型 Skill 有独立的资源缓存。激活 Skill、扫描工作区、运行脚本，分别是三个动作。',[
    '桌面 resolveExecutionDirectory 只检查 activatedSkills[0]，按 id/name 取 Skill；有 zipFileHash 才下载并返回 extractedDir。没有对应 zip 时返回 undefined，runner 随后继承父 cwd。',
    '下载型 Skill 的脚本相对路径从解压目录出发；并不自动把产物写到用户项目。需要脚本或命令显式指定目标路径。',
    'workspace init 合并根目录 .agents/skills 与 .claude/skills；同名 Skill 前者优先。AGENTS.md 与 CLAUDE.md 可同时读取；这里只扫描所选根目录，不等于递归加载所有嵌套 AGENTS.md。',
    '服务端把扫描结果缓存在 devices.workingDirs[].workspace，TTL 为 1 小时，扫描失败可回用旧缓存。Skill 正文和资源按激活/引用时读取；根指令正文直接进 system role。',
    '服务端 SkillsService 的 runCommand / execScript 当前走 sandbox；项目 Skill 的读取可通过设备 Gateway。选择设备不代表所有工具类别都会变成设备本地脚本。'],[
    ['名称','位置 / 数据','作用'],
    ['project root','用户选中的绝对路径','项目文件、AGENTS.md、项目 skills'],
    ['Skill archive','appStorage/file-storage/skills/archives/{hash}.zip','下载缓存'],
    ['Skill execution dir','appStorage/file-storage/skills/extracted/{hash}','桌面 execScript 的实际 cwd'],
    ['workspace cache','数据库 devices.workingDirs[].workspace','上次扫描结果；不是磁盘目录'],
    ['cloud sandbox','服务端 sandbox service 的执行环境','与 Electron 文件系统分离']
], [('src/services/electron/desktopSkillRuntime.ts','async resolveExecutionDirectory'),
    ('src/store/tool/slices/builtin/executors/lobe-skills.desktop.ts','execScript: async'),
    ('apps/desktop/src/main/controllers/LocalFileCtr.ts','async handlePrepareSkillDirectory'),
    ('packages/device-control/src/workspace.ts','export const initWorkspace'),
    ('apps/server/src/services/aiAgent/workspaceInitCache.ts','export const WORKSPACE_INIT_TTL_MS'),
    ('apps/server/src/services/aiAgent/index.ts','private async resolveWorkspaceInit'),
    ('apps/server/src/services/toolExecution/serverRuntimes/skills.ts','execScript = async')])

d=base('07-disk-map','07  磁盘目录地图：哪些长期存在，哪些按运行变化','以下为代码中的路径规则；用户目录使用符号值，不代表已读取当前机器或线上配置。',850,width=1660)
lane(d,'userdisk',130,'用户资料与项目 · 随用户与所选机器变化',[
    ('homePath / desktopPath','Electron app.getPath(...)'),('用户项目目录','例如 /Users/me/projects/demo'),
    ('代码与项目约定','文件 / .git / AGENTS.md / .agents/skills')],['用户可选择其下目录','包含'],['gray','blue','green'],flow='read')
lane(d,'appdisk',305,'应用数据 · 应用维护缓存，不是项目工作区',[
    ('userDataPath','app.getPath("userData")'),('appStoragePath','userData/lobehub-storage'),
    ('缓存 / trace','file-storage/skills；heteroAgent/files、tracing')],['派生','存放'],['gray','gray','green'])
lane(d,'clisession',480,'外部 CLI 会话 · topic 与磁盘会话通过 sessionId 联系',[
    ('Topic metadata','workingDirectory + heteroSessionId'),('CLI 的恢复参数','Claude --resume / Codex exec resume'),
    ('CLI 自身会话存储','Claude 按 cwd 组织；由 CLI 管理')],['下一轮读取','加载会话'],['blue','purple','green'])
add(d,'本地文件内容、应用缓存、数据库 topic、CLI 会话文件，分别有自己的生命周期。清楚谁拥有它们，就能理解为什么换目录、换设备或重新启动会有不同效果。',[
    'appStoragePath = app.getPath("userData") / lobehub-storage；包名与该目录保留历史实现命名，不代表产品叫 LobeHub。',
    'heteroAgent/files 缓存附件；手动开启 tracing 时用 appStorage/heteroAgent/tracing；普通开发模式 trace 可写到 cwd/.heerogeneous-tracing（保留代码中的原拼写）。',
    'Claude 的临时 AskUserQuestion MCP 配置位于 os.tmpdir()/lobe-cc-mcp-{operationId}.json，并注册运行后/退出清理；它不是执行目录。',
    '桌面 local CLI 首轮发送前把解析的工作目录存到新 Topic，执行完成写 heteroSessionId；resolveHeteroResume 会比较已存目录和当前目录，缺失或不一致时丢弃 resume ID。',
    'Gateway 设备 CLI 的 cwd = 请求 cwd ?? Electron process.cwd()；云端外部 CLI 默认显式使用 /workspace。云端 topic.workingDirectory 可能保存首个 GitHub repo URL，这个 URL 不是容器 cwd。',
    'Gateway 的外部 CLI 恢复路径不使用 Renderer 的 cwd 相等检查；不要把本地恢复规则当成所有路径统一规则。'],[
    ['目录 / 对象','是谁管理','是否自动跟随 topic'],
    ['home / desktop / documents','操作系统用户资料','否'],
    ['project root','用户选择，topic 可保存路径','由具体入口读取'],
    ['Electron process.cwd()','启动 Electron 的父进程','否'],
    ['appStorage / Skill cache','Electron 应用','否'],
    ['os.tmpdir() 的 MCP JSON','某次外部 CLI operation','按 operationId 创建和清理'],
    ['/workspace','云端外部 CLI sandbox','默认固定启动路径'],
    ['workspaceId','数据库组织空间','逻辑数据范围，无对应本地目录']
], [('apps/desktop/src/main/const/dir.ts','export const appStorageDir'),
    ('apps/desktop/src/main/const/heteroAgent.ts','export const HETERO_AGENT_DIR'),
    ('apps/desktop/src/main/controllers/HeterogeneousAgentCtr.ts','private resolveTraceRootDir'),
    ('apps/desktop/src/main/controllers/HeterogeneousAgentCtr.ts','const tmpConfigPath ='),
    ('src/store/chat/slices/aiChat/actions/conversationLifecycle.ts','const workingDirectory = existingTopic'),
    ('src/store/chat/slices/aiChat/actions/heteroResume.ts','export const resolveHeteroResume'),
    ('apps/server/src/services/heterogeneousAgent/sandboxRunner.ts',"const cwd = params.cwd ?? '/workspace'"),
    ('packages/types/src/topic/topic.ts','workingDirectory?: string')])

def resolve_refs(refs):
    result=[]
    for file, needle in refs:
        lines=(REPO/file).read_text().splitlines()
        matches=[i+1 for i,line in enumerate(lines) if needle in line]
        if not matches:
            raise ValueError(f'Missing source anchor: {file}: {needle}')
        line=matches[0]
        result.append(dict(file=file,line=line,anchor=needle,
            url=f'https://github.com/chaaak6/Masterino/blob/{SHA}/{file}#L{line}'))
    return result

def table_html(rows):
    return '<table><thead><tr>'+''.join('<th>'+escape(s)+'</th>' for s in rows[0])+'</tr></thead><tbody>'+''.join(
        '<tr>'+''.join('<td>'+escape(s)+'</td>' for s in row)+'</tr>' for row in rows[1:])+'</tbody></table>'

def render_explicit(d):
    """Explicit straight corridors, Python list method, portable geometry metadata.

    Avoids auto-layout's rounded fractional ports and label-placement heuristics.
    Geometry/composition checks still run on every finished SVG via the toolkit.
    """
    # Cairo's native font backend does not reliably fall back for these glyphs.
    # Normalize diagram text before both measuring and rendering it.
    d=json.loads(json.dumps(d,ensure_ascii=False).translate(str.maketrans({
        '→':' > ', '↔':' <-> ', '①':'1.', '②':'2.', '③':'3.',
        '④':'4.', '⑤':'5.', '⑥':'6.',
    })))
    w,h=d['width'],d['height']
    colors={'data':'#2563eb','feedback':'#9333ea','read':'#16a34a'}
    lines=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" data-generator="fireworks-tech-graph" data-authoring-mode="explicit-python-list" data-style-id="1" data-visual-theme="Flat Icon" data-diagram-type="architecture" data-quality-profile="showcase" data-semantic-profile="generic">']
    lines.append('<defs>')
    lines.append('<style>text{font-family:"PingFang SC","Helvetica Neue",Arial,sans-serif}</style>')
    for flow,color in colors.items():
        lines.append(f'<marker id="arrow-{flow}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><polygon points="0 0,10 3.5,0 7" fill="{color}"/></marker>')
    lines.append('</defs>')
    lines.append(f'<rect width="{w}" height="{h}" fill="#fff"/>')
    lines.append(f'<g data-graph-role="reserved" data-graph-bounds="40,22,{w-40},103"><text x="60" y="55" font-size="28" font-weight="700">{escape(d["title"])}</text><text x="60" y="86" font-size="15" fill="#64748b">{escape(d["subtitle"])}</text></g>')
    def bounds(n):
        return f'{n["x"]},{n["y"]},{n["x"]+n["width"]},{n["y"]+n["height"]}'
    for c in d['containers']:
        x,y,cw,ch=c['x'],c['y'],c['width'],c['height']
        lines.append(f'<g id="{c["id"]}" data-graph-role="container" data-graph-bounds="{bounds(c)}"><rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="8" fill="#fbfcfe" stroke="#d1d5db" stroke-dasharray="6 4"/><g data-graph-role="reserved" data-graph-bounds="{x+12},{y+8},{x+cw-12},{y+32}"><text x="{x+20}" y="{y+25}" font-size="14" font-weight="600" fill="#526176">{escape(c["label"])}</text></g></g>')
    nodes={n['id']:n for n in d['nodes']}
    labels=[];routes=[]
    def port(n,p):
        x,y,cw,ch=n['x'],n['y'],n['width'],n['height']
        return {'left':(x,y+ch/2),'right':(x+cw,y+ch/2),'top':(x+cw/2,y),'bottom':(x+cw/2,y+ch)}[p]
    for e in d['arrows']:
        a=port(nodes[e['source']],e['source_port']);b=port(nodes[e['target']],e['target_port'])
        if a[0]!=b[0] and a[1]!=b[1]: raise ValueError('Explicit renderer requires aligned ports')
        flow=e['flow'];eid=e['id'];color=colors[flow]
        lines.append(f'<path id="{eid}" data-graph-role="edge" data-edge-id="{eid}" data-source="{e["source"]}" data-target="{e["target"]}" data-flow="{flow}" d="M {a[0]} {a[1]} L {b[0]} {b[1]}" fill="none" stroke="{color}" stroke-width="2" marker-end="url(#arrow-{flow})"/>')
        label=e['label'].replace('创建 operation','创建运行')
        fs=12;tw=geometry.estimate_text_width(label,fs)
        if a[1]==b[1]:
            # Shorten corridor labels rather than squeeze text or draw across cards.
            if tw>abs(b[0]-a[0])-8:
                replacements={'远程工具调用':'工具调用','按 deviceId 引用':'引用设备','持久化结果':'保存结果','未传':'未传','返回 extractedDir':'返回目录','initWorkspace RPC':'扫描 RPC','用户可选择其下目录':'选择目录'}
                label=replacements.get(label,label)
                tw=geometry.estimate_text_width(label,fs)
            x=(a[0]+b[0])/2;y=a[1]-13;anchor='middle';left=x-tw/2
        else:
            x=a[0]+14;y=(a[1]+b[1])/2;anchor='start';left=x
        labels.append(f'<g data-graph-role="label" data-owner="{eid}" data-graph-bounds="{left},{y-13},{left+tw},{y+3}"><text x="{x}" y="{y}" font-size="{fs}" text-anchor="{anchor}" fill="{color}">{escape(label)}</text></g>')
        routes.append({'id':eid,'source':e['source'],'target':e['target'],'route':[a,b]})
    for n in d['nodes']:
        x,y,cw,ch=n['x'],n['y'],n['width'],n['height']
        lines.append(f'<g id="node-{n["id"]}" data-graph-role="node" data-node-id="{n["id"]}" data-graph-bounds="{bounds(n)}"><rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="8" fill="{n["fill"]}" stroke="{n["stroke"]}" stroke-width="1.5"/>')
        if n['kind']=='double_rect':
            lines.append(f'<rect x="{x+5}" y="{y+5}" width="{cw-10}" height="{ch-10}" rx="5" fill="none" stroke="{n["stroke"]}" stroke-width="1"/>')
        ts=min(18,18*(cw-30)/max(1,geometry.estimate_text_width(n['label'],18)))
        lines.append(f'<text x="{x+cw/2}" y="{y+ch/2-5}" text-anchor="middle" font-size="{ts}" font-weight="600">{escape(n["label"])}</text>')
        # Wrap subtitle only when necessary, preserving the complete wording.
        parts=[];part=''
        for char in n['sublabel']:
            if part and geometry.estimate_text_width(part+char,12)>cw-24:
                parts.append(part);part=''
            part+=char
        if part:parts.append(part)
        for j,part in enumerate(parts):
            lines.append(f'<text x="{x+cw/2}" y="{y+ch/2+17+j*14}" text-anchor="middle" font-size="12" fill="#526176">{escape(part)}</text>')
        lines.append('</g>')
    lines.extend(labels)
    ly=h-85
    lines.append(f'<g data-graph-role="reserved" data-graph-bounds="50,{ly-20},760,{ly+15}">')
    for i,(flow,label) in enumerate([('data','传递 / 引用'),('feedback','循环 / 反馈'),('read','读取 / 上下文')]):
        x=60+i*225
        lines.append(f'<line x1="{x}" y1="{ly-4}" x2="{x+32}" y2="{ly-4}" stroke="{colors[flow]}" stroke-width="2"/><text x="{x+44}" y="{ly}" font-size="13" fill="#64748b">{label}</text>')
    lines.append('</g>')
    lines.append(f'<g data-graph-role="reserved" data-graph-bounds="50,{h-49},{w-30},{h-14}"><text x="60" y="{h-29}" font-size="12" fill="#64748b">{escape(d["footer"])}</text></g>')
    lines.append('</svg>')
    return '\n'.join(lines),{'authoring':'explicit-python-list','style':'Flat Icon','quality_profile':'showcase','routes':routes}

sections=[]; index_items=[]; evidence=[]
md=['# Masterino Agent Loop、设备、Topic 与执行目录图谱','',
    f'依据 `feat/workspace-runtime` 的历史提交 `{SHA}`；2026-09-03。该图谱记录 Workspace Runtime v2 全面改造前的执行链路基线，用于与后续实现对照，不代表当前分支 HEAD。分析未读取用户凭据或假设生产开关。',
    '', '[打开交互图谱](index.html)。每张图另有 SVG、PNG、可平移缩放的独立 HTML 和可再生成的 JSON。', '',
    '> 历史基线结论：先区分 loop 宿主与工具执行设备；再分别追踪项目目录、提示词目录、spawn cwd 和 env。在该提交上，不同入口之间仍有差异。','']

for idx,item in enumerate(ATLAS):
    d=item['diagram']; slug=d['slug']; refs=resolve_refs(item['refs']); evidence.extend(refs)
    (OUT/(slug+'.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
    svg, report=render_explicit(d)
    # Native fonts only; the SVG does not fetch any remote resources.
    (OUT/(slug+'.svg')).write_text(svg)
    (OUT/(slug+'.layout.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    viewer=build_interactive_html(svg,d['title'],{'slug':slug})
    (OUT/(slug+'.html')).write_text(viewer)
    src_html=''.join(f'<li><a href="{r["url"]}" target="_blank" rel="noreferrer">{escape(r["file"])}:{r["line"]}</a></li>' for r in refs)
    points=''.join('<li>'+escape(p)+'</li>' for p in item['points'])
    index_items.append(f'<button class="nav-item" data-index="{idx}" aria-controls="view-{idx}"><span>{idx+1:02d}</span>{escape(d["title"].split("  ",1)[1])}</button>')
    sections.append(f'''<section id="view-{idx}" class="view" {'hidden' if idx else ''}>
      <div class="view-heading"><h2>{escape(d['title'])}</h2><p>{escape(item['lead'])}</p></div>
      <div class="downloads"><a href="{slug}.svg" download>SVG</a><a href="{slug}.png" download>高清 PNG</a><a href="{slug}.html" target="_blank">独立交互图 ↗</a><a href="{slug}.json" download>图数据 JSON</a></div>
      <iframe title="{escape(d['title'])}" src="{slug}.html" loading="lazy"></iframe>
      <div class="reading"><h3>沿着代码理解</h3><ul>{points}</ul>{table_html(item['rows'])}
      <details><summary>代码依据 · {len(refs)} 处，固定到 73e2ea9a</summary><ul class="sources">{src_html}</ul></details></div>
    </section>''')
    md.extend(['## '+d['title'],'',item['lead'],'',f'![{d["title"]}]({slug}.png)',''])
    md.extend('- '+p for p in item['points']); md.append('')
    md.append('| '+' | '.join(item['rows'][0])+' |');md.append('| '+' | '.join(['---']*len(item['rows'][0]))+' |')
    md.extend('| '+' | '.join(r)+' |' for r in item['rows'][1:]);md.extend(['','代码依据：',''])
    md.extend(f'- [{r["file"]}:{r["line"]}]({r["url"]})' for r in refs);md.append('')

css='''
*{box-sizing:border-box}body{margin:0;background:#f6f8fb;color:#172133;font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}button{font:inherit;cursor:pointer}header{background:#fff;border-bottom:1px solid #dce3ee;padding:32px 44px 28px}header .eyebrow{font-size:12px;letter-spacing:.15em;color:#2563eb;font-weight:700}h1{font-size:30px;line-height:1.35;margin:10px 0}header p{max-width:1000px;margin:10px 0;color:#526176}.meta{font-size:12px;color:#66748a}.shell{display:grid;grid-template-columns:260px minmax(0,1fr);max-width:1900px;margin:auto}nav{padding:28px 16px;position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto}.nav-item{border:0;background:transparent;text-align:left;width:100%;padding:12px;border-radius:9px;color:#56657a;margin-bottom:6px;line-height:1.5}.nav-item span{display:block;color:#94a3b8;font-size:11px}.nav-item.active{background:#e8efff;color:#1748bc;font-weight:600}.nav-foot{border-top:1px solid #dce3ee;margin:22px 10px;padding-top:16px;font-size:12px;color:#6b7280}.main{min-width:0;padding:26px 32px 50px}.view{background:white;border:1px solid #dde4ef;border-radius:14px;overflow:hidden}.view-heading{padding:26px 30px 10px}h2{font-size:23px;margin:0 0 8px}h3{font-size:18px}p{margin:0 0 14px}.view-heading p{color:#526176;max-width:1100px}.downloads{padding:0 30px 18px;display:flex;gap:14px;font-size:13px}iframe{display:block;width:100%;height:640px;border:0;border-top:1px solid #e7ecf3;border-bottom:1px solid #e7ecf3;background:#fff}.reading{padding:16px 30px 30px;max-width:1300px}.reading li{margin:10px 0}table{border-collapse:collapse;width:100%;font-size:14px;margin:24px 0}td,th{text-align:left;border-bottom:1px solid #e4e9f2;padding:12px;vertical-align:top}th{background:#f2f6fd;font-weight:600}tr:nth-child(even) td{background:#fafbfd}details{border-top:1px solid #e4e9f2;padding-top:18px;font-size:13px}.sources{overflow-wrap:anywhere}.pager{display:flex;justify-content:space-between;margin:18px 0}.pager button{border:1px solid #d2dbeb;border-radius:8px;background:#fff;padding:9px 17px;color:#334155}.pager button:disabled{opacity:.35;cursor:default}.note{margin-top:15px;color:#68778a;font-size:12px}@media(max-width:900px){header{padding:24px}h1{font-size:25px}.shell{display:block}nav{position:static;display:flex;gap:6px;overflow:auto;max-height:none;padding:12px}.nav-item{min-width:160px}.nav-foot{display:none}.main{padding:8px 12px 30px}iframe{height:510px}.view-heading,.reading{padding:20px}.downloads{padding:0 20px 15px}table{font-size:12px}td,th{padding:8px}}
'''
html=['<!doctype html>','<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Masterino · Agent Loop 与工作目录图谱</title>', '<style>'+css+'</style></head><body>',
    '<header><div class="eyebrow">MASTERINO / CODE ATLAS</div><h1>Agent Loop、设备与工作目录</h1><p>把“谁在思考”“在哪台机器执行”“路径如何解析”“环境从哪里来”分开追踪，再沿调用链连接起来。</p><div class="meta">当前代码：feat/workspace-runtime · 73e2ea9a · 2026-09-03 ｜ fireworks-tech-graph / Flat Icon ｜ 7 张图，离线可读</div></header>',
    '<div class="shell"><nav aria-label="图谱导航">'+''.join(index_items)+'<div class="nav-foot">从 01 顺序阅读。<br>图中可缩放、拖动和导出。<br><a href="README.md">文字版与完整代码索引</a><p class="note">源码结论来自静态追踪；没有把代码默认值当作当前部署配置。</p></div></nav><main class="main">',
    ''.join(sections),'<div class="pager"><button id="prev">← 上一张</button><button id="next">下一张 →</button></div></main></div>',
    '''<script>const views=[...document.querySelectorAll('.view')],nav=[...document.querySelectorAll('.nav-item')];let current=0;function show(i){current=Math.max(0,Math.min(views.length-1,i));views.forEach((v,k)=>v.hidden=k!==current);nav.forEach((b,k)=>{b.classList.toggle('active',k===current);b.setAttribute('aria-current',k===current?'page':'false')});document.querySelector('#prev').disabled=current===0;document.querySelector('#next').disabled=current===views.length-1;history.replaceState(null,'','#'+(current+1))}nav.forEach((b,i)=>b.addEventListener('click',()=>show(i)));document.querySelector('#prev').onclick=()=>show(current-1);document.querySelector('#next').onclick=()=>show(current+1);show(Number(location.hash.slice(1)||1)-1);</script></body></html>''']
(OUT/'index.html').write_text('\n'.join(html))
md.extend(['## 阅读时最容易误判的地方','',
    '1. Gateway 模式不等于云沙箱；原生 loop 可在服务端，工具仍在用户 Electron。',
    '2. 目录选择只写数据；只有具体 spawn 的 cwd 或当前命令里的 cd 才改变子进程执行目录。',
    '3. 当前项目扫描根、Gateway 提示词目录、普通 runCommand 的真实 cwd 可以不同。',
    '4. 桌面下载型 Skill 的 executionDirectory 是 Skill 解压缓存，不是 topic 项目路径。',
    '5. 提示词占位符、应用 runtimeEnv 配置、OS process.env 都带“环境”字样，但并非同一个对象。',
    '6. topic 目录绑定与 CLI session 恢复规则因 local / gateway 路径不同而不同。','',
    '## 产物与再生成','',
    '运行 `python3 build_atlas.py /path/to/fireworks-tech-graph` 再生成 SVG、独立 HTML、JSON 和本索引。',
    '运行 `python3 render_exports.py /path/to/fireworks-tech-graph` 调用工具包的 XML、marker、碰撞、几何和构图校验，再以 CairoSVG 导出 2400px PNG。该 Python 环境需要安装 CairoSVG，并能加载系统 Cairo 动态库。',
    '本次渲染使用 `/tmp/masterino-fireworks-render/bin/python3`，以及 Codex 自带的 Cairo 动态库；未改动项目依赖。`validation.json` 记录自动校验与人工图片检查；重新渲染后需重新进行视觉检查。',''])
(OUT/'README.md').write_text('\n'.join(md))
(OUT/'sources.json').write_text(json.dumps({'commit':SHA,'sources':evidence},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'generated':len(ATLAS),'directory':str(OUT),'entry':str(OUT/'index.html')},ensure_ascii=False))
