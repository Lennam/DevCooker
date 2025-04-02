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
let isInitialized = false; // 初始化标记
let isInitializing = false; // 正在初始化标记
let editorChangeListener = null; // 编辑器变化监听器
let documentChangeListener = null; // 文档变化监听器

/**
 * 检查对象是否为空
 * @param {Object} obj 要检查的对象
 * @returns {boolean} 对象是否为空
 */
function isEmpty(obj) {
  return (
    obj === null ||
    obj === undefined ||
    (typeof obj === "object" && Object.keys(obj).length === 0)
  );
}

/**
 * 初始化i18n工具
 * @param {vscode.ExtensionContext} _context 扩展上下文
 */
async function initialize(_context) {
  // 防止重复初始化
  if (isInitialized || isInitializing) {
    return;
  }

  isInitializing = true;
  context = _context;

  // 创建状态栏项
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "devassistkit.i18nTools.refreshLocales";
  statusBarItem.tooltip = "刷新多语言数据";
  context.subscriptions.push(statusBarItem);

  // 创建装饰器 - 延迟到实际需要时再创建
  decorator = vscode.window.createTextEditorDecorationType({
    after: {
      margin: "0 0 0 10px",
      color: "gray",
    },
  });
  context.subscriptions.push(decorator);

  // 状态栏显示初始状态
  statusBarItem.text = "$(sync~spin) 加载多语言...";
  statusBarItem.show();

  // 异步加载多语言数据，不阻塞初始化流程
  setTimeout(async () => {
    await refreshLocales();

    // 注册悬停提供器 - 仅在有多语言数据时注册
    if (!isEmpty(localeData)) {
      const supportedLanguages = ["vue", "javascript", "typescript"];
      hoverProvider = vscode.languages.registerHoverProvider(
        supportedLanguages,
        translationProvider.getTranslationHoverProvider(localeData)
      );
      context.subscriptions.push(hoverProvider);
    }

    // 监听文本编辑器变化事件
    editorChangeListener = vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        if (editor) {
          decorateActiveEditor();
        }
      },
      null,
      context.subscriptions
    );

    // 监听文档变化事件
    documentChangeListener = vscode.workspace.onDidChangeTextDocument(
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
    isInitialized = true;
    isInitializing = false;
  }, 300);
}

/**
 * 装饰当前活动的编辑器
 */
function decorateActiveEditor() {
  const editor = vscode.window.activeTextEditor;
  if (
    editor &&
    !isEmpty(localeData) &&
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
    placeHolder: "例如: src/locales, src/i18n, locales",
  });

  if (pathsInput !== undefined) {
    // 解析路径，支持Windows路径风格
    const paths = pathsInput
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p);

    // 验证路径格式
    const validPaths = [];
    const invalidPaths = [];

    for (const p of paths) {
      try {
        // 简单验证路径，去除非法字符
        const sanitizedPath = p.replace(/[<>:"\\|?*]/g, "");
        if (sanitizedPath !== p) {
          invalidPaths.push(p);
          continue;
        }
        validPaths.push(p);
      } catch (error) {
        invalidPaths.push(p);
      }
    }

    if (invalidPaths.length > 0) {
      vscode.window.showWarningMessage(
        `以下路径格式不正确，将被忽略: ${invalidPaths.join(", ")}`
      );
    }

    // 更新配置
    await config.update(
      "i18n.localesPaths",
      validPaths,
      vscode.ConfigurationTarget.Workspace
    );

    // 刷新多语言数据
    await refreshLocales();
  }
}

/**
 * 刷新多语言数据
 */
async function refreshLocales() {
  try {
    if (statusBarItem) {
      statusBarItem.text = "$(sync~spin) 刷新多语言...";
    }

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
      if (statusBarItem) {
        statusBarItem.text = "$(alert) 未配置多语言";
      }
      return;
    }

    // 标准化文件扩展名
    const normalizedExtensions = fileExtensions.map((ext) =>
      ext.startsWith(".") ? ext : `.${ext}`
    );

    // 查找多语言文件
    localeFiles = await localeManager.findLocaleFiles(
      paths,
      normalizedExtensions
    );

    // 加载多语言数据
    localeData = await localeManager.loadLocaleData(localeFiles);

    // 更新装饰器
    if (vscode.window.activeTextEditor && decorator) {
      decorateActiveEditor();
    }

    if (statusBarItem) {
      const localeCount = Object.keys(localeData).length;
      statusBarItem.text = `$(globe) ${
        localeCount > 0 ? localeCount + "种语言" : "多语言"
      }`;
    }
  } catch (error) {
    vscode.window.showErrorMessage(`刷新多语言数据失败: ${error.message}`);
    if (statusBarItem) {
      statusBarItem.text = "$(error) 多语言加载失败";
    }
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
 * 释放资源
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
  if (editorChangeListener) {
    editorChangeListener.dispose();
  }
  if (documentChangeListener) {
    documentChangeListener.dispose();
  }

  // 清空数据
  localeData = {};
  localeFiles = {};
  context = null;
  isInitialized = false;
}

module.exports = {
  initialize,
  configureLocales,
  refreshLocales,
  editTranslation,
  dispose,
};
