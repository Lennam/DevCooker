# DevCooker for Visual Studio Code

一款集成多种开发辅助功能的 VS Code 扩展，提升开发效率与工作流程。

---

## 特性

### 图标资源处理
- 🌟 **图标字体生成**: 上传SVG文件并生成iconfont字体文件
- 🔍 **图标预览**: 直观预览当前项目中的所有图标
- 📝 **图标命名**: 轻松修改图标名称和管理图标分类

### 多语言支持
- 🌐 **多语言文件自动查找**: 自动扫描并收集项目中的多语言文件
- 🔍 **翻译实时显示**: 在编辑器中直接查看多语言键的翻译值
- ✏️ **快速编辑翻译**: 通过便捷界面编辑多种语言的翻译内容
- 📝 **i18n方法智能识别**: 支持识别Vue、JS、TS文件中的`$t`、`i18n.global.t`等翻译方法

---

## 安装

通过 VS Code 扩展商店搜索 **DevCooker** 进行安装

## 快速开始

### Icomoon 资源处理
1. 打开命令面板 (Ctrl+Shift+P)
2. 选择 `DevCooker: 处理 Icomoon 资源`
3. 输入 Icomoon 提供的文件 URL

### 多语言支持
1. 打开命令面板 (Ctrl+Shift+P)
2. 选择 `DevCooker: 配置国际化目录`
3. 输入多语言文件路径
4. 使用 VS Code 编辑带有翻译方法的文件时，将自动显示翻译内容

## 配置项

在 VS Code 设置中可以自定义以下配置：

```json
{
  "devCooker.iconProcessor.fontFilesPath": "./src/assets/fonts/",
  "devCooker.iconProcessor.stylesPath": "./src/styles/icons/",
  "devCooker.i18n.localesPaths": ["./src/locales/", "./src/i18n/"],
  "devCooker.i18n.defaultLocale": "zh-CN",
  "devCooker.i18n.fileExtensions": [".json", ".js", ".ts"],
  "devCooker.i18n.translationMethods": ["$t", "$st", "i18n.global.t", "i18n.t", "t", "translate"]
}
```

## 贡献

欢迎提交 issue 或 pull request 来帮助改进此扩展。

## 许可

MIT
  