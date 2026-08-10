# Lovart 产品调研报告

**来源**: https://lovart.ai  **日期**: 2026-06-01  **版本**: N/A (SaaS, no public version tag)

---

## 一、产品定位

**Tagline（精确原文）**: "Your AI Design Partner" / "Agentic Intelligence — Thinking, in Systems"

**副标语**: "Design decisions don't happen in isolation. Lovart unifies color, layout, and voice into a cohesive brand world, built to scale."

**核心定位**: 面向营销人员、设计师、自由职业者、中小企业主的 **AI 设计 Agent 平台**——不只是图像生成器，而是能自主规划并执行完整品牌视觉工作流的 Agentic 系统。

**目标用户**:
- 独立设计师 / 自由职业者（Scale Your Output）
- 营销团队 / 品牌方（replace traditional design company）
- 电商卖家（product photography, background swap）
- 内容创作者 / Social Media Manager

---

## 二、核心功能（具体，不模糊）

### 2.1 AI Design Agent（旗舰能力）
- **MCoT（Multimodal Chain-of-Thought）推理引擎**：分析用户意图 → 搜索视觉参考 → 收集品牌信息 → 生成完整资产集合
- 流程可见（UI展示每个步骤：Analyzing user intent → Explored visual trends → Collected references → Generation）
- 支持 prompt 驱动的完整品牌 Campaign（logo → image → video → copy 任意组合）

### 2.2 编辑能力（Editing Layer）
| 功能 | 描述 |
|------|------|
| **Touch Edit** | 点哪里改哪里，保留其余部分不变（AI 感知区域语义） |
| **Text Edit** | 文字作为独立可编辑图层，修改文案不破坏排版构图 |
| **Style Consistency** | 跨迭代 / 跨格式维持品牌风格一致性 |
| **Background Swap** | 零遮罩替换背景，自动同步光影 |

### 2.3 生成能力
| 类别 | 具体产品/工具 |
|------|------------|
| **图像** | 由 Nano Banana Pro + Flux 模型驱动，4K，完美文字渲染 |
| **视频** | Seedance 2.0 – 影视级商业片、产品视频、B-roll、AI Avatar 直播 |
| **向量/插画** | Nano Banana 模型，可导出 SVG，支持可编辑图层 |
| **批量生成** | CSV 驱动变量模板，批量产出数百张品牌一致设计 |
| **Carousel** | Instagram/LinkedIn 无缝多图生成 |

### 2.4 平台特定输出（SEO 落地页功能集）
- Facebook/Instagram Ads, Google Display Banners
- Logo, Business Card, Brochure, Menu, Coupon
- AI Thumbnail, Giveaway Poster, Event Cover
- 24/7 AI Avatar Live Streaming + Auto-Clipping（TikTok Shorts）

### 2.5 工作流自动化
- **Custom Skills**（2027 Blog）：可复用的自定义 AI 工作流，自动化重复设计任务
- **Batch Generation**：CSV 驱动大规模生成
- **ChatCanvas**：对话式画布，用于客户评审 / 审批流程

### 2.6 Visual Insights（RAG-like 参考系统）
- 实时搜索网络设计参考
- 将高质量参考转化为具体创意方向

---

## 三、技术架构

| 层次 | 技术/信息 |
|------|----------|
| **前端** | SPA（React 或类似框架）+ GTM (GTM-WX5X6NS2)；全部内容客户端渲染 |
| **AI 推理引擎** | 自研 **MCoT（Multimodal Chain-of-Thought）** |
| **图像模型** | 自研 **Nano Banana / Nano Banana Pro**；集成 Flux |
| **视频模型** | **Seedance 2.0**（字节跳动生态或合作方） |
| **画布** | Infinite Canvas（类 Figma 无限画板）|
| **资产层** | 图层系统（文字独立层、可编辑 SVG 输出）|
| **实时性** | WebSocket 可能（实时 AI Avatar 直播能力提示）|
| **计费** | 信用点（Credits）体系：Fast Credits（消耗订阅点）+ Unlimited Relax Generation（排队处理）|

**开源情况**: 有独立开发者正在逆向复刻（`Shiyao-Huang/openLovart`，37 stars），已实现：
- 知识库 Agentic RAG（实现时间 05-17）
- 设计→图片→视频→口播任意组合（05-24）
- 待完成：图片输入、美学知识库、蒙板绘制

---

## 四、与 Orka 对比

> ⚠️ 注：本项目（goal-test / SUSUSingerBoard）是 **Douyin 弹幕点歌板** desktop app，与 Lovart 领域完全不同（音乐直播辅助 vs AI 设计 SaaS）。以下对比聚焦于 **Agentic / AI 架构思路** 层面。

| 维度 | Lovart | SUSUSingerBoard（本项目）|
|------|--------|------------------------|
| **核心任务** | 品牌视觉生成 + 编辑 | Douyin 弹幕点歌收集展示 |
| **Agent 架构** | MCoT 多步推理，可见进度 | 无 Agent，规则匹配弹幕 |
| **实时数据源** | 网络实时参考搜索（Visual Insights） | Douyin WebSocket 弹幕流 |
| **用户交互** | 对话式 prompt + 画布直接编辑 | 被动展示歌单 |
| **工作流自动化** | Custom Skills，CSV 批量 | 无 |
| **输出** | 图像/视频/向量多格式 | 弹幕点歌列表 |
| **多模型调度** | 多模型（Nano Banana / Flux / Seedance） | 无 AI 模型 |
| **信用计费** | Credits 体系，分 Fast / Relax | 本地 desktop，无计费 |

---

## 五、可借鉴功能（按优先级）

> 本项目方向不同，以下为 **架构/产品思路** 层面的借鉴机会：

### P0 — 强相关
1. **进度可视化 Agent 流程**：Lovart 展示每步（Analyzing → Searching → Collecting → Generating）。若本项目引入 AI 推荐（如"自动搜索歌曲 BPM、热度"），可参考此 UI 模式。

### P1 — 中相关
2. **Real-time Reference Enrichment**：Lovart 实时拉取网络参考。本项目可类比：点歌时自动拉取歌曲信息（封面、歌词片段、平台链接）。
3. **Style Consistency / 队列状态管理**：Lovart 的 Fast/Relax 排队分层，可借鉴为点歌队列的优先级系统（VIP 歌迷优先、房管置顶等）。

### P2 — 低相关
4. **Custom Skills / 工作流自动化**：若本项目扩展为主播工具箱，可参考 Lovart 的可复用 Skill 设计。
5. **Batch/CSV 驱动**：若需要批量导入歌单预设，可参考 CSV 驱动模式。

---

## 六、观察与结论

1. **Lovart 是目前最完整的 "AI Design Agent" 产品** — 不是简单的图像生成器，而是具有 MCoT 推理、多步骤可见、品牌一致性管理的完整 Agentic 系统。

2. **架构核心差异化**：自研模型（Nano Banana）+ 自研推理引擎（MCoT）+ 无限画布 + 实时网络参考，构成不可轻易复制的技术护城河。

3. **商业化策略清晰**：Credits 分 Fast（消耗订阅）+ Relax（排队不消耗），既保证体验又控成本；Team Plan 另售，不共享账号。

4. **开源复刻现状**：`openLovart` 仍处于早期 MVP（核心 RAG + 多模态工作流已通），开源版与商业版差距巨大。

5. **与本项目关联度**：低（领域不重叠）。本项目若向 **AI 赋能直播辅助工具** 方向演进，可参考 Lovart 的 Agentic 工作流 UI 模式和实时信息增强设计。

---

**数据来源**:
- https://lovart.ai （主页，2026-06-01）
- https://lovart.ai/pricing
- https://lovart.ai/features
- https://lovart.ai/blog
- https://github.com/Shiyao-Huang/openLovart
