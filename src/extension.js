const vscode = require("vscode");
const iconProcessor = require("./iconProcessor");
const i18nTools = require("./i18nTools");

/**
 * 在扩展激活时调用
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // 注册图标处理器功能
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "devassistkit.iconProcessor",
      iconProcessor.processIcomoonAssets
    )
  );

  // 注册国际化工具功能
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "devassistkit.i18nTools.configureLocales",
      i18nTools.configureLocales
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "devassistkit.i18nTools.refreshLocales",
      i18nTools.refreshLocales
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "devassistkit.i18nTools.editTranslation",
      i18nTools.editTranslation
    )
  );

  // 初始化国际化工具
  i18nTools.initialize(context);

  console.log("DevCooker 已激活");
}

function deactivate() {
  // 清理国际化工具资源
  i18nTools.dispose();
  console.log("DevCooker 已停用");
}

module.exports = {
  activate,
  deactivate,
};
