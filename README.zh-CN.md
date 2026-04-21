# check-your-api

面向 OpenAI 兼容 API 的批量可用性检测工具，支持实时延迟监控。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Z1rconium/check-your-api)

[English](./README.md)

## 简介

`check-your-api` 是一个基于 Web 的工具，用于验证 OpenAI 兼容 API 端点。它可以发现可用模型并通过并发探测请求测试其实际可用性，提供模型状态和首字延迟的即时反馈。

**核心能力：**
- 从任何 OpenAI 兼容端点获取模型列表
- 可配置并发数的批量可用性测试
- 首字延迟测量，提供性能洞察
- 模型选择和过滤，支持针对性测试
- 通过 localStorage 持久化表单，方便使用

## 技术栈

**前端：**
- React 18.3+ 配合 TypeScript
- Vite 5.4+ 构建工具
- CSS3 自定义属性实现主题

**后端：**
- Node.js 18+ 运行时
- Express 4.21+ 用于开发/生产服务器
- Vercel 无服务器函数用于云部署

**开发工具：**
- TypeScript 5.5+ 严格类型检查
- TSX 用于开发热重载
- Concurrently 并行运行开发进程

## 架构

应用使用代理架构来避免 CORS 问题：

```
浏览器 → 前端 (React)
    ↓
    /api/models 或 /api/check
    ↓
后端代理层 (Express 或 Vercel Functions)
    ↓
目标 OpenAI 兼容 API
```

**核心组件：**
- `src/App.tsx` - 主 React 应用及状态管理
- `server/core.ts` - 共享请求处理逻辑
- `server/app.ts` - Node.js 部署的 Express 服务器
- `api/*.ts` - Vercel 无服务器函数处理器

**请求流程：**
1. 用户配置 base URL、API key 和并发数
2. 前端通过 `/api/models` 获取模型
3. 用户选择模型并启动批量检测
4. 前端向 `/api/check` 发送并发请求
5. 后端代理流式请求到目标 API
6. 测量并显示首字延迟

## 快速开始

### 环境要求

- Node.js 18 或更高版本
- npm 包管理器
- 有效的 OpenAI 兼容 API 端点和密钥

### 安装

```bash
npm install
```

### 开发模式

同时运行前端和后端的监听模式：

```bash
npm run dev
```

访问应用：
- 前端：`http://127.0.0.1:5173`
- 后端代理：`http://127.0.0.1:8787`

### 生产构建

构建应用：

```bash
npm run build
```

启动生产服务器：

```bash
npm run start
```

如需修改默认端口：

```bash
PORT=3000 npm run start
```

## 部署

### Vercel（推荐）

本项目针对 Vercel 部署进行了优化，零配置：

```bash
vercel
```

或点击上方的 "Deploy with Vercel" 按钮直接从 GitHub 部署。

`vercel.json` 配置会自动：
- 将 Vite 前端构建到 `dist/`
- 将 `/api/models` 和 `/api/check` 暴露为无服务器函数
- 从构建输出提供静态资源

### 自托管

在任何兼容 Node.js 的服务器上构建和运行：

```bash
npm run build
npm run start
```

服务器默认监听 8787 端口（可通过 `PORT` 环境变量配置）。

## 项目结构

```
.
├── api/                    # Vercel 无服务器函数
│   ├── check.ts           # 模型可用性检测端点
│   └── models.ts          # 模型列表获取端点
├── server/                # Node.js 服务器实现
│   ├── core.ts           # 共享请求处理逻辑
│   ├── app.ts            # Express 应用设置
│   └── index.ts          # 服务器入口
├── src/                   # React 前端
│   ├── App.tsx           # 主应用组件
│   ├── main.tsx          # React 入口
│   └── styles.css        # 应用样式
├── vite.config.ts        # Vite 构建配置
├── vercel.json           # Vercel 部署配置
└── package.json          # 依赖和脚本
```

## 核心功能

### 模型发现
自动从配置端点的 `/models` 接口获取可用模型。

### 选择性测试
使用模型选择器选择要测试的模型，支持搜索和批量选择控制。

### 并发检测
配置并发数（1-N 个并行请求）以平衡速度和速率限制。

### 性能指标
显示可用模型的首字延迟，按响应速度颜色编码：
- **快速**：≤800ms
- **中等**：801-2000ms
- **慢速**：>2000ms

### 结果过滤
按状态过滤结果：全部、可用、不可用或待完成。

### 自定义提示词
在所有模型中使用一致的测试提示词以获得可比较的结果。

### 表单持久化
API 凭证和设置保存到浏览器 localStorage 以方便使用。

## API 兼容性

本工具期望目标服务实现：

- `GET {baseUrl}/models` - 返回可用模型列表
- `POST {baseUrl}/chat/completions` - 接受带流式传输的聊天补全请求

**兼容服务：**
- OpenAI API (`https://api.openai.com/v1`)
- Azure OpenAI Service
- OpenRouter
- 任何 OpenAI 兼容代理或网关

**探测请求格式：**
```json
{
  "model": "model-id",
  "messages": [{"role": "user", "content": "Hi"}],
  "stream": true,
  "temperature": 0,
  "max_tokens": 64
}
```

## 使用说明

- **并发数**：较高的值测试更快，但可能触发速率限制。建议从 3-5 开始。
- **安全性**：API 密钥仅存储在浏览器 localStorage 中，永远不会发送给第三方。
- **可用性**：模型出现在 `/models` 中并不保证它可以被调用。
- **延迟**：首字延迟测量到第一个流式响应块的时间。
- **超时**：请求在 30 秒后超时。

## 开发

### 脚本

- `npm run dev` - 启动开发模式（前端 + 后端）
- `npm run dev:web` - 仅启动 Vite 开发服务器
- `npm run dev:proxy` - 仅启动 Express 代理服务器
- `npm run build` - 生产构建
- `npm run build:web` - 仅构建前端
- `npm run build:server` - 仅构建后端
- `npm run start` - 启动生产服务器
- `npm run preview` - 本地预览生产构建

### TypeScript 配置

项目使用 TypeScript 项目引用：
- `tsconfig.app.json` - 前端配置
- `tsconfig.node.json` - Vite 配置类型
- `tsconfig.server.json` - 后端服务器类型

## Roadmap

- [ ] 导出结果为 CSV 或 JSON
- [ ] 显示失败的详细错误消息
- [ ] 添加重试逻辑和速率限制处理
- [ ] 支持其他探测类型（embeddings、completions）
- [ ] 模型对比视图
- [ ] 历史延迟跟踪

## 贡献

欢迎贡献！请随时提交 issue 或 pull request。

## 许可证

当前仓库还没有单独附带许可证文件。请联系仓库所有者获取许可信息。

## 致谢

使用 React、Vite、Express 和 TypeScript 构建。为使用 OpenAI 兼容 API 的开发者设计。
