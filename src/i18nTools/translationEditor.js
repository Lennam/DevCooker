const vscode = require("vscode");
const { saveTranslation } = require("./localeManager");

/**
 * 创建翻译编辑器
 * @param {string} key 翻译键
 * @param {Object} currentTranslations 当前翻译值
 * @param {Object} localeData 多语言数据
 * @param {Object} localeFiles 多语言文件信息
 * @returns {Promise<void>}
 */
async function createTranslationEditor(
  key,
  currentTranslations,
  localeData,
  localeFiles
) {
  // 获取配置
  const config = vscode.workspace.getConfiguration("devAssistKit");
  const defaultLocale = config.get("i18n.defaultLocale", "zh-CN");

  // 创建Webview面板
  const panel = vscode.window.createWebviewPanel(
    "translationEditor",
    `编辑翻译: ${key}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  // 准备所有可用的语言列表
  const availableLocales = Object.keys(localeData);

  // 为未找到翻译的语言创建空值
  const translations = { ...currentTranslations };
  for (const locale of availableLocales) {
    if (!translations[locale]) {
      translations[locale] = "";
    }
  }

  // 设置Webview的HTML内容
  panel.webview.html = getWebviewContent(
    key,
    translations,
    availableLocales,
    defaultLocale
  );

  // 处理Webview消息
  return new Promise((resolve, reject) => {
    panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "save":
            try {
              await saveTranslation(key, message.translations, localeFiles);
              vscode.window.showInformationMessage(`已保存翻译: ${key}`);
              panel.dispose();
              resolve();
            } catch (error) {
              vscode.window.showErrorMessage(`保存翻译失败: ${error.message}`);
              reject(error);
            }
            return;

          case "cancel":
            panel.dispose();
            resolve();
            return;
        }
      },
      undefined,
      []
    );

    // 面板关闭时解决Promise
    panel.onDidDispose(() => {
      resolve();
    });
  });
}

/**
 * 生成Webview内容
 * @param {string} key 翻译键
 * @param {Object} translations 翻译值
 * @param {string[]} availableLocales 可用的语言列表
 * @param {string} defaultLocale 默认语言
 * @returns {string} HTML内容
 */
function getWebviewContent(key, translations, availableLocales, defaultLocale) {
  const localeInputs = availableLocales
    .map((locale) => {
      const value = translations[locale] || "";
      const isDefault = locale === defaultLocale ? " (默认语言)" : "";

      return `
    <div class="form-group">
      <label for="${locale}">${locale}${isDefault}:</label>
      <textarea id="${locale}" name="${locale}" 
        class="translation-input${
          locale === defaultLocale ? " default-locale" : ""
        }"
        placeholder="输入${locale}翻译">${escapeHtml(value)}</textarea>
    </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>编辑翻译</title>
  <style>
    body {
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      font-size: 13px;
    }
    .container {
      display: flex;
      flex-direction: column;
      gap: 15px;
      width: 100%;
      max-width: 600px;
      margin: 0 auto;
    }
    .key-info {
      margin-bottom: 20px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    label {
      font-weight: bold;
    }
    .translation-input {
      padding: 8px;
      border-radius: 3px;
      border: 1px solid var(--vscode-input-border);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      min-height: 60px;
      font-family: monospace;
    }
    .default-locale {
      border-color: var(--vscode-focusBorder);
    }
    .buttons {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 20px;
    }
    button {
      padding: 6px 14px;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
    }
    .btn-primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    .btn-secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="key-info">
      <h3>编辑翻译</h3>
      <div>翻译键: <code>${escapeHtml(key)}</code></div>
    </div>
    
    <form id="translation-form">
      ${localeInputs}
      
      <div class="buttons">
        <button type="button" class="btn-secondary" id="cancel-btn">取消</button>
        <button type="submit" class="btn-primary" id="save-btn">保存</button>
      </div>
    </form>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const translations = ${JSON.stringify(translations)};
    const availableLocales = ${JSON.stringify(availableLocales)};
    
    document.getElementById('translation-form').addEventListener('submit', (e) => {
      e.preventDefault();
      
      // 收集所有翻译
      const updatedTranslations = {};
      
      for (const locale of availableLocales) {
        const value = document.getElementById(locale).value.trim();
        if (value) {
          updatedTranslations[locale] = value;
        }
      }
      
      // 发送消息到扩展
      vscode.postMessage({
        command: 'save',
        translations: updatedTranslations
      });
    });
    
    document.getElementById('cancel-btn').addEventListener('click', () => {
      vscode.postMessage({
        command: 'cancel'
      });
    });
  </script>
</body>
</html>`;
}

/**
 * 转义HTML特殊字符
 * @param {string} text 文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = {
  createTranslationEditor,
};
