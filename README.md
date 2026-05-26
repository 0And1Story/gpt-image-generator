# GPT Image 2 Generation

一个简易网页程序，用于通过 OpenAI `gpt-image-2` API 生成图片，并将请求记录、结果 JSON 和图片文件持久化到本地。

当前实现已尽量按 OpenAI 官方图片生成文档对齐常用生成参数。

## 功能

- 网页输入提示词并生成图片
- 支持标准尺寸和自定义分辨率
- 支持上传参考图进行参考生成
- 支持 `quality`、`background`、`moderation`
- 支持 `output_format`、`output_compression`
- 支持一次生成多张图 `n`
- 支持流式生成 `stream` 和 `partial_images`
- 支持可选 `user` 字段
- 支持 `API_BASE_URL`，可接代理网关或兼容服务
- 生成后的图片保存到本地
- 每次请求和结果保存为 JSON
- 页面内可查看最新结果和历史记录

## 技术栈

- Node.js
- Express
- OpenAI Node SDK
- 原生 HTML / CSS / JavaScript

## 环境要求

- Node.js 18 或更高版本
- 可用的 OpenAI API Key

## 安装

```bash
npm install
```

## 环境变量

在项目根目录创建 `.env`：

```env
OPENAI_API_KEY=your_openai_api_key_here
API_BASE_URL=
PORT=3000
```

也支持：

```env
API_KEY=your_openai_api_key_here
API_BASE_URL=
PORT=3000
```

说明：

- `OPENAI_API_KEY` 或 `API_KEY`：二选一
- `API_BASE_URL`：可选，默认留空时使用 OpenAI 官方默认地址
- `PORT`：服务端口，默认 `3000`

示例：

```env
OPENAI_API_KEY=your_openai_api_key_here
API_BASE_URL=https://your-api-gateway.example.com/v1
PORT=3000
```

参考文件：[.env.example](./.env.example)

## 启动

```bash
npm start
```

启动后访问：

```text
http://localhost:3000
```

## 页面参数

基础参数：

- `prompt`
- `referenceImages`
- `size`
- `customSize`
- `quality`
- `outputFormat`
- `outputCompression`

高级参数：

- `background`
- `moderation`
- `n`
- `stream`
- `partialImages`
- `user`

## 参数说明

### `size`

支持：

- `1024x1024`
- `1536x1024`
- `1024x1536`
- `auto`
- `custom`

当使用 `custom` 时，需要额外传 `customSize`。

### `customSize`

格式要求：

- 必须是 `WIDTHxHEIGHT`
- 宽高都必须是正整数
- 宽高都必须能被 `16` 整除
- 宽高比必须在 `1:3` 到 `3:1` 之间
- 宽高都不能超过 `3840`

示例：

- `1536x864`
- `2048x1024`
- `1024x1536`

### `quality`

支持：

- `auto`
- `low`
- `medium`
- `high`

默认值：

- `auto`

### `outputFormat`

支持：

- `png`
- `jpeg`
- `webp`

默认值：

- `png`

### `outputCompression`

范围：

- `0-100`

说明：

- 仅在 `jpeg` 或 `webp` 时生效
- `png` 时不会传给 API

### `background`

支持：

- `auto`
- `opaque`

说明：

- `gpt-image-2` 不支持透明背景
- 因此当前页面没有暴露 `transparent`

### `moderation`

支持：

- `auto`
- `low`

默认值：

- `auto`

### `n`

范围：

- `1-10`

当前页面支持直接选择 `1-10`。

### `stream`

支持：

- `true`
- `false`

启用后会走流式图片生成。

### `partialImages`

范围：

- `0-3`

说明：

- 仅在 `stream=true` 时可用
- 用于请求中间预览图事件数量

### `user`

可选字符串，用于区分调用方或审计用途。

### `referenceImages`

说明：

- 可上传 1 到 16 张参考图
- 有参考图时，后端会按官方方式改走 `images.edit`
- 支持 `png`、`jpg`、`jpeg`、`webp`
- 单文件大小限制为 50MB

页面会先本地预览参考图，请求记录和历史卡片也会展示参考图摘要。

## 数据持久化

程序会自动使用以下目录：

```text
data/
  history.json
  images/
  requests/
```

说明：

- `data/images/`：保存生成后的图片文件
- `data/requests/`：每次请求的独立 JSON 记录
- `data/history.json`：历史记录汇总

无论成功还是失败，请求都会被记录。

记录内容包括：

- 请求参数
- `apiBaseUrl`
- 参考图信息
- 成功或失败状态
- 响应摘要
- 请求 ID
- 返回的事件摘要或原始响应摘要
- 生成后的图片路径
- 模型返回的修订提示词
- 流式生成的事件摘要

## 多图结果

当 `n > 1` 时：

- 后端会保存多张图片
- 页面会把多张图一起展示
- 返回结果中的 `result.images` 会包含所有图片信息

## API

### `GET /api/config`

返回前端可用的配置项。

### `GET /api/history`

返回历史记录列表。

### `POST /api/generate`

生成图片。

基础请求示例：

```json
{
  "prompt": "一只在雨夜霓虹街头打伞的橘猫，电影感，写实",
  "size": "1536x1024",
  "quality": "auto",
  "outputFormat": "png"
}
```

完整请求示例：

```json
{
  "prompt": "未来城市黄昏航拍，电影级构图",
  "size": "custom",
  "customSize": "1536x864",
  "quality": "high",
  "outputFormat": "webp",
  "outputCompression": 85,
  "background": "auto",
  "moderation": "auto",
  "n": 2,
  "stream": true,
  "partialImages": 1,
  "user": "demo-user-001"
}
```

如果要通过表单上传参考图，请使用 `multipart/form-data`，字段名为 `referenceImages`。

成功响应会包含：

- 请求 ID
- 创建时间
- 请求参数
- 响应摘要
- 首张图片路径
- 所有图片列表
- 图片数量
- 模型返回信息

## 目录结构

```text
.
├─ public/
│  ├─ app.js
│  ├─ index.html
│  └─ styles.css
├─ data/
│  ├─ history.json
│  ├─ images/
│  └─ requests/
├─ .env.example
├─ .gitignore
├─ package.json
├─ package-lock.json
├─ README.md
└─ server.js
```

## 注意事项

- 如果没有配置 `OPENAI_API_KEY` 或 `API_KEY`，页面仍可打开，但生成请求会失败
- 如果没有配置 `API_BASE_URL`，程序会使用 OpenAI 默认 API 地址
- 本项目不保存会话上下文，每次请求都是独立调用
- 实际图片生成会消耗你的 OpenAI API 配额
- 流式模式下，当前页面只展示最终图片，不展示中间 partial image 二进制内容，只记录事件摘要

## 开发

```bash
npm start
```

```bash
npm run dev
```

当前 `start` 和 `dev` 都执行：

```bash
node server.js
```
