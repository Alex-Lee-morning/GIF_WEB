# 像素桌宠

把照片变成 macOS 桌面上的卡通像素桌宠。默认形象为卡通像素小狗；上传照片会先卡通化，再生成动画帧。

## 功能

- **默认桌宠**：项目内打包的卡通柯基（待机眨眼、左右走）
- **上传流程**：抠图 → 卡通化 → 生成动画帧 → 预览确认后应用
- 自主走动、拖动转向、点击聊天、思考/说话动画
- 托盘开关、尺寸调节（64–256px）
- AI 对话：DeepSeek / 通义 / 智谱 / Kimi / 自定义 OpenAI 兼容接口

## 目录（均在本仓库内）

| 路径 | 说明 |
|------|------|
| `public/default-pet/` | 默认小狗 PNG / GIF |
| `assets/cartoon-source/` | 卡通生成源图 |
| `src/assets/defaultPetSprites.json` | 默认精灵帧（内嵌） |
| `src/lib/cartoonize.ts` | 卡通化 |
| `src/lib/petPipeline.ts` | 上传→卡通→动画管线 |
| `src/lib/defaultPet.ts` | 默认桌宠加载 |

## 打包成 Mac App

```bash
npm run dist
```

产物在 `release/`：

| 文件 | 说明 |
|------|------|
| `mac-arm64/像素桌宠.app` | 可直接运行的 App |
| `像素桌宠-1.0.0-mac-arm64.dmg` | 安装镜像（拖到「应用程序」） |
| `像素桌宠-1.0.0-arm64-mac.zip` | 压缩包分发 |

未签名首次打开：右键 App →「打开」，或：

```bash
xattr -cr "release/mac-arm64/像素桌宠.app"
open "release/mac-arm64/像素桌宠.app"
```

## 打包成 Windows 应用

```bash
npm run dist:win
```

产物在项目根目录 `Windows版/`：

| 文件 | 说明 |
|------|------|
| `像素桌宠-1.0.0-win-x64.exe` | 安装包（推荐） |
| `像素桌宠-1.0.0-win-portable.exe` | 免安装绿色版 |
| `像素桌宠-1.0.0-win-x64.zip` | 压缩包 |
| `win-unpacked/` | 解压后的程序目录 |

拷到 Windows 电脑后双击安装包或绿色版即可。若 SmartScreen 拦截，选「更多信息」→「仍要运行」。

## 自动更新

打包后的应用启动时会检查 [GitHub Releases](https://github.com/Alex-Lee-morning/GIF_WEB/releases)。  
配置与发版说明见 [`update/RELEASE.md`](update/RELEASE.md)。

```bash
# 升版本后打包，再上传 Release
npm run dist && npm run dist:win
npm run release:publish
```

Windows 自动更新仅支持 NSIS 安装版，不支持 portable。

## 开发

```bash
npm install
npm run dev
```

1. 设置窗口可「恢复默认卡通小狗」，或上传照片生成新桌宠  
2. 桌宠窗：拖动转向、空闲自主走、单击聊天  

