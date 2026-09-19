# Vox 前端工作台

无需构建、无运行时第三方依赖。交付文件为 `index.html`、`styles.css`、`app.js`，使用已有 `nginx.conf` 同源代理 `/api/`。部署时替换这三个静态文件即可；不要用 `file://` 打开，也不要仅启动没有 API 代理的静态服务器来验证真实业务。

## 功能

- 全部任务和全部文件：完整获取 API 列表，前端按 20 / 50 / 100 条分页，不截断历史数据。
- 名称与 ID 搜索、状态与类型/用途筛选、创建时间排序、完整记录数量。
- 已完成任务点击名称或“阅读转写”即可打开播放器与正文，任务信息默认折叠；关闭后保留列表筛选和页码。
- 任务详情展示所有已公开字段和原始 JSON，关联输入文件与结果文件。
- 文件详情展示名称、完整 ID、所有者、大小、状态、创建时间及关联任务。
- 登录、注册、会话恢复与过期处理；账户切换时取消旧请求、清空旧数据。
- 页面顶部“录音转写”可直接打开录音区；新建转写页也提供直接可见的“麦克风录音”选项。
- 浏览器麦克风录音、时长显示、停止试听、重录与删除；复用现有上传与任务接口提交。录音仅在当前页面保存，刷新会丢失；需要 HTTPS 或 localhost 及麦克风权限。离开新建页会停止录音，退出登录会清空录音并释放设备。浏览器自动选择支持的 WebM/MP4/Ogg 音频格式。
- 新文件直传、完成校验、语言选择、已有文件复用、异步任务创建。
- 转写文本预览、音频/视频内嵌播放、点击整段文字或时间戳跳转、播放段落高亮、复制、文本下载、源文件与结果文件访问。
- 字幕自动滚动跟随当前播放段落；手动滚动、触摸或拖动时暂停，默认 5 秒无操作后恢复，可选 3 / 5 / 10 / 15 / 30 秒并记住设置。支持关闭跟随或立即恢复，仅滚动字幕区域。
- 默认每 10 秒刷新列表；标签页隐藏时暂停，失败时保留旧数据并标记错误。

## API 对照

| 接口                                        | 用途                                                 |
| ------------------------------------------- | ---------------------------------------------------- |
| `POST /api/v1/login`、`POST /api/v1/signup` | 表单方式登录、注册                                   |
| `GET /api/v1/whoami`                        | 验证身份                                             |
| `GET /api/v1/tasks`                         | 当前账户全部任务                                     |
| `GET /api/v1/tasks/:taskid`                 | 刷新单条任务详情                                     |
| `GET /api/v1/listfiles`                     | 当前账户全部文件                                     |
| `POST /api/v1/upload`                       | 申请文件 ID 与上传地址                               |
| `PUT <upload_url>`                          | 直传存储，不附带 API token                           |
| `POST /api/v1/files/:fileid/complete`       | 校验文件上传完成                                     |
| `POST /api/v1/tasks`                        | 提交 `input_file_id`、`type: transcribe`、`language` |
| `GET /api/v1/download/:fileid`              | 按需获取新下载地址                                   |

任务时间兼容 protobuf `{seconds, nanos}`；文件时间支持 RFC3339。空列表兼容 `null`。文件用途仅依据当前任务的输入/输出 ID 关联，未被当前任务引用的中间产物列为“其他文件”。

API 当前未公开任务阶段、所选语言、进度百分比或失败原因，也没有删除、取消接口，因此不显示推测数据或提供虚假的操作。“全部”指当前账户获准访问的全部记录。下载使用存储地址新窗口访问，由浏览器预览或保存；跨域文本读取和上传依赖存储已有的 CORS 配置。

## 浏览器回归

`tests/browser.cjs` 使用 Playwright 和模拟 API，不启动或修改后端，不使用真实账户数据。覆盖完整列表、分页搜索、HTML 转义、详情与结果、复用与上传流程、部分接口失败、会话过期和移动布局。

在已有 Playwright 环境运行：

```sh
node web/tests/browser.cjs
```

也可在临时目录安装测试依赖，不改变项目依赖：

```sh
npm install --prefix /tmp/vox-web-check playwright@1.61.1
NODE_PATH=/tmp/vox-web-check/node_modules CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node web/tests/browser.cjs
```

省略 `CHROME_PATH` 时使用 Playwright 已安装的 Chromium。测试截图输出至 `/tmp/vox-desktop.png` 和 `/tmp/vox-mobile.png`。模拟验证不能替代真实部署环境的 API、对象存储和音视频解码联调。
