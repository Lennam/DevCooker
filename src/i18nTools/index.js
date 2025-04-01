const vscode = require("vscode");
const localeManager = require("./localeManager");
const translationProvider = require("./translationProvider");

// 状态变量
let localeData = {}; // 多语言数据
let localeFiles = {}; // 多语言文件信息
let decorator = null; // 文本编辑器装饰器
let hoverProvider = null; // 悬停提供器
let statusBarItem = null; // 状态栏项
let context = null; // 扩展上下文

/**
 * 初始化i18n工具
 * @param {vscode.ExtensionContext} _context 扩展上下文
 */
async function initialize(_context) {
  context = _context;

  // 创建状态栏项
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "devassistkit.i18nTools.refreshLocales";
  statusBarItem.tooltip = "刷新多语言数据";
  context.subscriptions.push(statusBarItem);

  // 创建装饰器
  decorator = vscode.window.createTextEditorDecorationType({
    after: {
      margin: "0 0 0 10px",
      color: "gray",
    },
  });
  context.subscriptions.push(decorator);

  // 加载多语言数据
  await refreshLocales();

  // 注册悬停提供器
  const supportedLanguages = ["vue", "javascript", "typescript"];
  hoverProvider = vscode.languages.registerHoverProvider(
    supportedLanguages,
    translationProvider.getTranslationHoverProvider(localeData)
  );
  context.subscriptions.push(hoverProvider);

  // 监听文本编辑器变化事件
  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (editor) {
        decorateActiveEditor();
      }
    },
    null,
    context.subscriptions
  );

  // 监听文档变化事件
  vscode.workspace.onDidChangeTextDocument(
    (event) => {
      if (
        vscode.window.activeTextEditor &&
        event.document === vscode.window.activeTextEditor.document
      ) {
        decorateActiveEditor();
      }
    },
    null,
    context.subscriptions
  );

  // 初始化当前打开的编辑器
  if (vscode.window.activeTextEditor) {
    decorateActiveEditor();
  }

  statusBarItem.text = "$(globe) 多语言";
  statusBarItem.show();
}

/**
 * 装饰当前活动的编辑器
 */
function decorateActiveEditor() {
  const editor = vscode.window.activeTextEditor;
  if (
    editor &&
    (editor.document.languageId === "vue" ||
      editor.document.languageId === "javascript" ||
      editor.document.languageId === "typescript")
  ) {
    translationProvider.decorateI18nKeys(editor, decorator, localeData);
  }
}

/**
 * 配置多语言文件路径
 */
async function configureLocales() {
  // 获取当前配置
  const config = vscode.workspace.getConfiguration("devCooker");
  const currentPaths = config.get("i18n.localesPaths", []);

  // 显示输入框
  const pathsInput = await vscode.window.showInputBox({
    prompt: "输入多语言文件路径 (用逗号分隔多个路径)",
    value: currentPaths.join(", "),
    placeHolder: "例如: src/locales, src/i18n, src\\locales",
  });

  if (pathsInput !== undefined) {
    // 解析路径，支持Windows路径风格
    const paths = pathsInput
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p);

    // 更新配置
    await config.update(
      "i18n.localesPaths",
      paths,
      vscode.ConfigurationTarget.Workspace
    );

    // 显示日志
    console.log("已配置的多语言路径:", paths);

    // 刷新多语言数据
    await refreshLocales();
  }
}

/**
 * 刷新多语言数据
 */
async function refreshLocales() {
  try {
    statusBarItem.text = "$(sync~spin) 刷新多语言...";

    // 获取配置
    const config = vscode.workspace.getConfiguration("devCooker");
    const paths = config.get("i18n.localesPaths", []);
    const fileExtensions = config.get("i18n.fileExtensions", [
      ".json",
      ".js",
      ".ts",
    ]);

    if (paths.length === 0) {
      vscode.window.showInformationMessage("请先配置多语言文件路径。");
      statusBarItem.text = "$(alert) 未配置多语言";
      return;
    }

    // 查找多语言文件
    localeFiles = await localeManager.findLocaleFiles(paths, fileExtensions);

    // 加载多语言数据
    localeData = await localeManager.loadLocaleData(localeFiles);
    console.log("多语言数据:", localeData);

    // 计算语言数量和多语言键总数
    const localeCount = Object.keys(localeData).length;

    // 统计所有扁平化键的数量
    let allKeys = new Set();
    for (const locale in localeData) {
      for (const namespace in localeData[locale]) {
        // 获取该命名空间下的所有键
        const keys = Object.keys(localeData[locale][namespace]);
        keys.forEach((key) => allKeys.add(key));
      }
    }
    const keyCount = allKeys.size;

    statusBarItem.text = `$(globe) ${localeCount}种语言`;
    statusBarItem.tooltip = `多语言数据: ${localeCount}种语言, ${keyCount}个翻译键`;

    // 更新当前编辑器的装饰
    decorateActiveEditor();

    vscode.window.showInformationMessage(
      `已加载${localeCount}种语言，共${keyCount}个翻译键`
    );
  } catch (error) {
    vscode.window.showErrorMessage(`刷新多语言数据失败: ${error.message}`);
    statusBarItem.text = "$(error) 多语言加载错误";
    statusBarItem.tooltip = `错误: ${error.message}`;
  }
}

/**
 * 编辑翻译
 * @param {string} key 翻译键
 */
async function editTranslation(key) {
  try {
    // 获取当前翻译
    const translations = {};

    // 调试日志
    console.log(`准备编辑翻译键: ${key}`);

    // 检查键是否为空
    if (!key) {
      console.warn("翻译键为空");
      vscode.window.showWarningMessage("翻译键不能为空");
      return;
    }

    // 简单的键分割，用于嵌套对象导航
    const parts = key.split(".");

    // 遍历所有语言
    for (const locale in localeData) {
      // 跳过不存在的语言
      if (!localeData[locale]) continue;

      // 是否在此语言中找到翻译
      let foundInLocale = false;

      // 遍历该语言的所有命名空间
      for (const namespace in localeData[locale]) {
        // 尝试方法 1: 直接在当前命名空间找到完整键
        if (localeData[locale][namespace][key] !== undefined) {
          translations[locale] = localeData[locale][namespace][key];
          console.log(`在 ${locale}.${namespace} 中找到完整键: ${key}`);
          foundInLocale = true;
          break; // 找到了就不再继续查找其他命名空间
        }

        // 尝试方法 2: 深度导航嵌套对象
        try {
          let current = localeData[locale][namespace];
          let found = true;

          // 深度优先遍历对象树
          for (const part of parts) {
            if (!current || typeof current !== "object" || !(part in current)) {
              found = false;
              break;
            }
            current = current[part];
          }

          // 找到了非对象的叶子节点值
          if (found && current !== undefined && typeof current !== "object") {
            translations[locale] = current;
            console.log(
              `在 ${locale}.${namespace} 中通过嵌套路径找到键: ${key} = ${current}`
            );
            foundInLocale = true;
            break; // 找到了就不再继续查找
          }
        } catch (error) {
          console.error(`嵌套导航出错: ${locale}.${namespace}.${key}`, error);
        }

        // 尝试方法 3: 查找最后一个部分作为简单键
        if (parts.length > 1) {
          const lastPart = parts[parts.length - 1];
          if (localeData[locale][namespace][lastPart] !== undefined) {
            translations[locale] = localeData[locale][namespace][lastPart];
            console.log(`在 ${locale}.${namespace} 中找到简单键: ${lastPart}`);
            foundInLocale = true;
            break; // 找到了就不再继续查找
          }
        }
      }
    }

    // 如果没有找到任何翻译，可以记录一个警告
    if (Object.keys(translations).length === 0) {
      console.warn(`未找到翻译键: ${key}`);
      vscode.window.showWarningMessage(`未找到翻译键: ${key}`);
    } else {
      console.log(`已找到翻译键 ${key} 的值:`, translations);
    }

    // 导入翻译编辑器
    const translationEditor = require("./translationEditor");

    // 创建翻译编辑器
    await translationEditor.createTranslationEditor(
      key,
      translations,
      localeData,
      localeFiles
    );

    // 刷新多语言数据
    await refreshLocales();
  } catch (error) {
    vscode.window.showErrorMessage(`编辑翻译失败: ${error.message}`);
  }
}

/**
 * 清理资源
 */
function dispose() {
  if (statusBarItem) {
    statusBarItem.dispose();
  }

  if (decorator) {
    decorator.dispose();
  }

  if (hoverProvider) {
    hoverProvider.dispose();
  }
}

module.exports = {
  initialize,
  configureLocales,
  refreshLocales,
  editTranslation,
  dispose,
};
