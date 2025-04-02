const vscode = require("vscode");
// 使用懒加载方式导入模块
let iconProcessor;
let i18nTools;

/**
 * 在扩展激活时调用
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // 注册图标处理器功能
  context.subscriptions.push(
    vscode.commands.registerCommand("devassistkit.iconProcessor", async () => {
      // 懒加载iconProcessor模块
      if (!iconProcessor) {
        iconProcessor = require("./iconProcessor");
      }
      return iconProcessor.processIcomoonAssets();
    })
  );

  // 注册国际化工具功能 - 懒加载方式
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "devassistkit.i18nTools.configureLocales",
      async () => {
        // 懒加载i18nTools模块
        if (!i18nTools) {
          i18nTools = require("./i18nTools");
          // 只在首次加载时初始化
          await i18nTools.initialize(context);
        }
        return i18nTools.configureLocales();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "devassistkit.i18nTools.refreshLocales",
      async () => {
        if (!i18nTools) {
          i18nTools = require("./i18nTools");
          await i18nTools.initialize(context);
        }
        return i18nTools.refreshLocales();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "devassistkit.i18nTools.editTranslation",
      async (key) => {
        if (!i18nTools) {
          i18nTools = require("./i18nTools");
          await i18nTools.initialize(context);
        }
        return i18nTools.editTranslation(key);
      }
    )
  );

  // 仅当打开vue/js/ts文件时才初始化i18n工具
  if (vscode.window.activeTextEditor) {
    const doc = vscode.window.activeTextEditor.document;
    if (
      doc.languageId === "vue" ||
      doc.languageId === "javascript" ||
      doc.languageId === "typescript"
    ) {
      setTimeout(async () => {
        if (!i18nTools) {
          i18nTools = require("./i18nTools");
          await i18nTools.initialize(context);
        }
      }, 1000); // 延迟1秒加载，不阻塞初始化流程
    }
  }

  console.log("DevCooker 已激活");
}

function deactivate() {
  // 只有在i18nTools已加载的情况下才清理资源
  if (i18nTools) {
    i18nTools.dispose();
  }
  console.log("DevCooker 已停用");
}

module.exports = {
  activate,
  deactivate,
};
