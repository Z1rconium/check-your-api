# check-your-api

面向 OpenAI 兼容 API 的批量可用性检测工具。

[English](./README.md)

## 简介

`check-your-api` 是一个很小的 Web 面板，用来确认某个 OpenAI 兼容接口里列出来的模型，到底能不能真的调用。

现在它同时支持两种部署方式，而且功能一致：

- 部署到 `Vercel`
- 作为普通 Node 服务用 `npm run start` 启动

它只做两件事：

- 从 `GET /models` 拉取模型列表
- 并发请求 `POST /chat/completions` 做批量探活

每个模型最终只会显示两种结果：

- `可用`
- `不可用`

如果模型可用，会额外显示首字返回延迟。

## 功能

- OpenAI 兼容接口模型拉取
- 批量可用性检测
- 可配置并发数
- 可自定义请求内容
- 同源 API 转发层，规避浏览器 CORS
- 可用模型显示首字延迟
- 表单自动持久化到 `localStorage`

## 界面字段

当前界面包含：

- `API Base URL`
- `API Key`
- `并发数`
- `请求内容`
- `获取可用模型`
- `批量检测`

其中“请求内容”默认值是 `Hi`。

## 工作方式

浏览器不会直接请求目标 API。

实际流程是：

1. 前端把请求发给 `/api/models` 和 `/api/check`
2. 服务端转发层再转发给目标 API
3. 根据上游请求成功或失败，更新每个模型的状态

探活请求长这样：

```json
{
  "model": "model-id",
  "messages": [
    {
      "role": "user",
      "content": "Hi"
    }
  ],
  "stream": true,
  "temperature": 0,
  "max_tokens": 64
}
```

只要上游成功返回，就判定该模型可用。
如果上游流式返回了正文首字，还会记录首字延迟并显示在界面里。

## 环境要求

- Node.js 18+
- npm

## 快速开始

安装依赖：

```bash
npm install
```

开发模式启动：

```bash
npm run dev
```

默认本地地址：

- 前端：`http://127.0.0.1:5173`
- 代理：`http://127.0.0.1:8787`

## 生产运行

### 普通服务器运行

构建：

```bash
npm run build
```

启动：

```bash
npm run start
```

如需修改端口：

```bash
PORT=3000 npm run start
```

### 部署到 Vercel

仓库已经包含：

- `api/models.ts`
- `api/check.ts`
- `vercel.json`

直接部署即可：

```bash
vercel
```

或者把仓库导入 Vercel 后台。

Vercel 会自动：

- 构建 `dist` 前端静态资源
- 提供 `/api/models`
- 提供 `/api/check`

不需要额外再配代理或重写。

## 接口兼容约定

当前项目默认目标服务支持：

- `GET {baseUrl}/models`
- `POST {baseUrl}/chat/completions`

`baseUrl` 示例：

```text
https://api.openai.com/v1
https://your-provider.example.com/v1
```

## 项目结构

```text
.
├── api/
│   ├── check.ts
│   └── models.ts
├── server/
│   ├── app.ts
│   ├── core.ts
│   └── index.ts
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── vite.config.ts
└── package.json
```

## 注意

- 并发数不是越高越好，过高可能触发上游限流或网关保护。
- 为了便于重复测试，API Key 会保存在浏览器 `localStorage`。
- `/models` 里存在某个模型，不代表它一定真的可调用。
- 当前不会展示模型返回内容，只展示可用性和首字延迟。

## Roadmap

- 导出 `csv` 或 `json`
- 可选显示失败原因
- 增加重试和限流策略
- 支持除 chat completions 之外的探活方式

## 许可证

当前仓库还没有单独附带 `LICENSE` 文件。
