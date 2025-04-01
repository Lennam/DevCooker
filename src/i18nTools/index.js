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
  const config = vscode.workspace.getConfiguration("devAssistKit");
  const currentPaths = config.get("i18n.localesPaths", []);

  // 显示输入框
  const pathsInput = await vscode.window.showInputBox({
    prompt: "输入多语言文件路径 (用逗号分隔多个路径)",
    value: currentPaths.join(", "),
    placeHolder: "例如: src/locales, src/i18n",
  });

  if (pathsInput !== undefined) {
    // 解析路径
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
    const config = vscode.workspace.getConfiguration("devAssistKit");
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
    console.log("多语言文件:", localeFiles);

    // 加载多语言数据
    localeData = await localeManager.loadLocaleData(localeFiles);

    const localeCount = Object.keys(localeData).length;
    const keyCount = new Set(
      Object.values(localeData).flatMap((data) => Object.keys(data))
    ).size;

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

    // 收集所有语言的翻译
    for (const locale in localeData) {
      if (localeData[locale][key]) {
        translations[locale] = localeData[locale][key];
      }
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
