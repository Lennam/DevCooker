const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// 懒加载辅助模块
let utils = null;
let iconParser = null;
let scssGenerator = null;

/**
 * 延迟加载模块
 */
function lazyLoadModules() {
  if (!utils) {
    utils = require("./utils");
  }
  if (!iconParser) {
    iconParser = require("./iconParser");
  }
  if (!scssGenerator) {
    scssGenerator = require("./scssGenerator");
  }
}

/**
 * 获取插件配置
 * @returns {Object} 配置对象
 */
function getConfig() {
  const config = vscode.workspace.getConfiguration("devCooker.iconProcessor");

  // 获取配置值
  let fontFilesPath = config.get("fontFilesPath", "./src/assets/fonts/");
  let stylesPath = config.get(
    "stylesPath",
    "./src/styles/icons/dc-icon-basic.scss"
  );

  // 确保字体路径以斜杠结尾
  if (!fontFilesPath.endsWith("/") && !fontFilesPath.endsWith("\\")) {
    fontFilesPath += "/";
  }

  return {
    fontFilesPath,
    stylesPath,
  };
}

/**
 * 获取用户输入
 * @returns {Promise<string|null>} 用户输入的URL或null
 */
async function getUserInput() {
  lazyLoadModules();
  
  const userInput = await vscode.window.showInputBox({
    prompt: "请输入Icomoon样式文件URL或<link>标签",
    placeHolder: 'https://i.icomoon.io/public/xxx/xxx.css 或 <link href="...">',
    validateInput: (text) => {
      if (!text || text.trim() === "") {
        return "请输入有效内容";
      }
      // 同时允许直接输入URL或包含link标签的输入
      if (text.includes("<link")) {
        return text.includes("href=") ? null : "未找到有效的href属性";
      }
      return text.startsWith("http")
        ? null
        : "请输入有效的URL或完整的<link>标签";
    },
  });

  if (!userInput) return null;

  const icomoonUrl = utils.extractUrlFromInput(userInput);

  if (!icomoonUrl) {
    utils.showMessage("无法解析有效的URL", "error");
    return null;
  }

  return icomoonUrl;
}

/**
 * 下载CSS内容
 * @param {string} url CSS文件URL
 * @returns {Promise<string|null>} CSS内容或null
 */
async function downloadCssContent(url) {
  lazyLoadModules();
  
  try {
    const cssResponse = await axios.get(url, {
      headers: utils.getHttpHeaders(),
    });
    const cssContent = cssResponse.data;

    if (!cssContent || typeof cssContent !== "string") {
      throw new Error("下载的CSS内容无效");
    }

    return cssContent;
  } catch (error) {
    utils.showMessage(`下载CSS文件失败: ${error.message}`, "error");
    console.error(error);
    return null;
  }
}

/**
 * 保存SCSS内容到文件
 * @param {string} scssContent SCSS内容
 * @param {string} stylesPath 样式文件路径
 * @returns {Promise<boolean>} 是否保存成功
 */
async function saveScssFile(scssContent, stylesPath) {
  lazyLoadModules();
  
  try {
    // 获取完整路径
    const fullStylesPath = utils.getFullPath(stylesPath);

    // 确保目录存在
    await utils.ensureDirectoryExists(path.dirname(fullStylesPath));

    // 写入文件内容
    await fs.promises.writeFile(fullStylesPath, scssContent);
    return true;
  } catch (error) {
    utils.showMessage(`保存SCSS文件失败: ${error.message}`, "error");
    console.error(error);
    return false;
  }
}

/**
 * 处理Icomoon资源的主函数
 */
async function processIcomoonAssets() {
  try {
    // 懒加载所有模块
    lazyLoadModules();
    
    // 获取配置
    const { fontFilesPath, stylesPath } = getConfig();

    // 获取用户输入
    const icomoonUrl = await getUserInput();
    if (!icomoonUrl) return;

    // 显示进度
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "处理Icomoon资源",
        cancellable: false,
      },
      async (progress) => {
        // 步骤1: 下载CSS
        progress.report({ message: "下载样式文件中...", increment: 20 });
        const cssContent = await downloadCssContent(icomoonUrl);
        if (!cssContent) return;

        // 步骤2: 提取并下载字体
        progress.report({ message: "下载字体文件中...", increment: 30 });
        const fontUrls = iconParser.extractFontUrls(cssContent);

        if (fontUrls.length === 0) {
          utils.showMessage(
            "未在CSS中找到字体文件引用，请检查CSS内容是否正确",
            "warning"
          );
        }

        await iconParser.downloadFonts(fontUrls, fontFilesPath);

        // 步骤3: 解析图标
        progress.report({ message: "解析图标定义...", increment: 20 });
        const iconDefinitions = iconParser.extractIconDefinitions(cssContent);

        if (iconDefinitions.size === 0) {
          utils.showMessage("未在CSS中找到图标定义，生成的SCSS可能不完整", "warning");
        } else {
          utils.showMessage(`成功解析 ${iconDefinitions.size} 个图标定义`);
        }

        // 步骤4: 生成并保存SCSS
        progress.report({ message: "生成SCSS文件中...", increment: 20 });
        const newScssContent = await scssGenerator.generateScssFromCss(cssContent);
        const saveResult = await saveScssFile(newScssContent, stylesPath);

        // 完成
        if (saveResult) {
          progress.report({ message: "完成!", increment: 10 });
          utils.showMessage(
            `Icomoon资源处理完成！样式文件已保存至: ${utils.getFullPath(stylesPath)}`
          );
        }
      }
    );
  } catch (error) {
    lazyLoadModules();
    utils.showMessage(`处理失败: ${error.message}`, "error");
    console.error(error);
  }
}

module.exports = { processIcomoonAssets };
