const vscode = require("vscode");
const acorn = require("acorn");
const walk = require("acorn-walk");
const _ = require("lodash");

/**
 * 装饰编辑器中的多语言键
 * @param {vscode.TextEditor} editor 文本编辑器
 * @param {vscode.TextEditorDecorationType} decorator 装饰器类型
 * @param {Object} localeData 多语言数据
 */
function decorateI18nKeys(editor, decorator, localeData) {
  if (!editor || !decorator || _.isEmpty(localeData)) {
    return;
  }

  const text = editor.document.getText();
  const decorations = [];

  // 获取配置
  const config = vscode.workspace.getConfiguration("devAssistKit");
  const defaultLocale = config.get("i18n.defaultLocale", "zh-CN");
  const translationMethods = config.get("i18n.translationMethods", [
    "$t",
    "$st",
    "i18n.global.t",
    "t",
    "translate",
  ]);

  // 根据文件类型选择解析方法
  const fileType = editor.document.languageId;

  if (fileType === "vue") {
    decorations.push(
      ...findVueTranslations(
        text,
        editor,
        translationMethods,
        localeData,
        defaultLocale
      )
    );
  } else if (fileType === "javascript" || fileType === "typescript") {
    decorations.push(
      ...findJsTranslations(
        text,
        editor,
        translationMethods,
        localeData,
        defaultLocale
      )
    );
  }

  // 应用装饰器
  editor.setDecorations(decorator, decorations);
}

/**
 * 查找Vue文件中的翻译调用
 * @param {string} text 文件文本
 * @param {vscode.TextEditor} editor 编辑器
 * @param {string[]} translationMethods 翻译方法名称列表
 * @param {Object} localeData 多语言数据
 * @param {string} defaultLocale 默认语言
 * @returns {vscode.DecorationOptions[]} 装饰选项
 */
function findVueTranslations(
  text,
  editor,
  translationMethods,
  localeData,
  defaultLocale
) {
  const decorations = [];

  // 模板中的翻译: {{ $t('key') }}
  const templatePattern = new RegExp(
    `(${translationMethods.join("|")})\\s*\\(\\s*['"]([^'"]+)['"]`,
    "g"
  );
  let match;

  while ((match = templatePattern.exec(text)) !== null) {
    const [fullMatch, method, key] = match;

    // 匹配文件位置
    const matchPos = editor.document.positionAt(match.index);
    const lineText = editor.document.lineAt(matchPos.line).text;

    // 检查是否在注释中或字符串内
    if (
      isInComment(lineText, matchPos.character) ||
      isInStringLiteral(text, match.index, key)
    ) {
      continue;
    }

    const endPos = editor.document.positionAt(match.index + fullMatch.length);
    const range = new vscode.Range(matchPos, endPos);

    // 获取翻译值
    const translations = getTranslationsForKey(key, localeData);
    const translation = translations[defaultLocale] || key;

    // 创建装饰选项
    const decoration = {
      range,
      renderOptions: {
        after: {
          contentText: `// ${_.truncate(translation, { length: 50 })}`,
          color: "gray",
        },
      },
      hoverMessage: createTranslationHover(key, translations, defaultLocale),
    };

    decorations.push(decoration);
  }

  // 解析脚本部分的翻译
  try {
    // 提取脚本部分
    const scriptMatch = text.match(/<script(\s+[^>]*)?>([\s\S]*?)<\/script>/i);
    if (scriptMatch && scriptMatch[2]) {
      const scriptContent = scriptMatch[2];
      const scriptOffset =
        scriptMatch.index + scriptMatch[0].indexOf(scriptContent);

      // 解析脚本并查找翻译
      const jsDecorations = parseJsContent(
        scriptContent,
        scriptOffset,
        editor,
        translationMethods,
        localeData,
        defaultLocale
      );

      decorations.push(...jsDecorations);
    }
  } catch (error) {
    console.error("解析Vue脚本出错:", error);
  }

  return decorations;
}

/**
 * 查找JS/TS文件中的翻译调用
 * @param {string} text 文件文本
 * @param {vscode.TextEditor} editor 编辑器
 * @param {string[]} translationMethods 翻译方法名列表
 * @param {Object} localeData 多语言数据
 * @param {string} defaultLocale 默认语言
 * @returns {vscode.DecorationOptions[]} 装饰选项
 */
function findJsTranslations(
  text,
  editor,
  translationMethods,
  localeData,
  defaultLocale
) {
  return parseJsContent(
    text,
    0,
    editor,
    translationMethods,
    localeData,
    defaultLocale
  );
}

/**
 * 解析JS内容并提取翻译调用
 * @param {string} content JS内容
 * @param {number} offset 内容在文件中的偏移量
 * @param {vscode.TextEditor} editor 编辑器
 * @param {string[]} translationMethods 翻译方法名列表
 * @param {Object} localeData 多语言数据
 * @param {string} defaultLocale 默认语言
 * @returns {vscode.DecorationOptions[]} 装饰选项
 */
function parseJsContent(
  content,
  offset,
  editor,
  translationMethods,
  localeData,
  defaultLocale
) {
  const decorations = [];

  try {
    // 解析JS代码
    const ast = acorn.parse(content, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
    });

    // 遍历AST查找翻译方法调用
    walk.simple(ast, {
      CallExpression(node) {
        let methodName = "";

        // 直接方法调用: t('key')
        if (node.callee.type === "Identifier") {
          methodName = node.callee.name;
        }
        // 成员方法调用: i18n.t('key') 或 this.$t('key')
        else if (node.callee.type === "MemberExpression") {
          if (node.callee.property.type === "Identifier") {
            methodName = node.callee.property.name;

            // 处理 i18n.global.t 这样的情况
            if (
              node.callee.object.type === "MemberExpression" &&
              node.callee.object.property.type === "Identifier" &&
              node.callee.object.property.name === "global"
            ) {
              methodName = `${node.callee.object.property.name}.${methodName}`;

              if (
                node.callee.object.object.type === "Identifier" &&
                node.callee.object.object.name === "i18n"
              ) {
                methodName = `i18n.${methodName}`;
              }
            } else if (
              node.callee.object.type === "Identifier" &&
              node.callee.object.name === "i18n"
            ) {
              methodName = `i18n.${methodName}`;
            }
          }
        }

        // 检查是否是翻译方法
        if (
          translationMethods.includes(methodName) &&
          node.arguments.length > 0
        ) {
          const firstArg = node.arguments[0];

          // 只处理字符串字面量键
          if (
            firstArg.type === "Literal" &&
            typeof firstArg.value === "string"
          ) {
            const key = firstArg.value;

            // 计算范围，考虑偏移量
            const startPos = editor.document.positionAt(
              firstArg.start + offset
            );
            const endPos = editor.document.positionAt(firstArg.end + offset);
            const range = new vscode.Range(startPos, endPos);

            // 获取翻译值
            const translations = getTranslationsForKey(key, localeData);
            const translation = translations[defaultLocale] || key;

            // 创建装饰选项
            const decoration = {
              range,
              renderOptions: {
                after: {
                  contentText: `// ${_.truncate(translation, { length: 50 })}`,
                  color: "gray",
                },
              },
              hoverMessage: createTranslationHover(
                key,
                translations,
                defaultLocale
              ),
            };

            decorations.push(decoration);
          }
        }
      },
    });
  } catch (error) {
    console.error("解析JS代码出错:", error);
  }

  return decorations;
}

/**
 * 检查位置是否在注释中
 * @param {string} lineText 行文本
 * @param {number} character 字符位置
 * @returns {boolean} 是否在注释中
 */
function isInComment(lineText, character) {
  // 检查是否在行注释中
  const lineCommentIndex = lineText.indexOf("//");
  if (lineCommentIndex !== -1 && character >= lineCommentIndex) {
    return true;
  }

  // 检查是否在块注释中
  // 这是一个简化的检查，真正的实现需要考虑多行块注释
  const blockCommentStart = lineText.indexOf("/*");
  const blockCommentEnd = lineText.indexOf("*/");

  if (
    blockCommentStart !== -1 &&
    character >= blockCommentStart &&
    (blockCommentEnd === -1 || character <= blockCommentEnd)
  ) {
    return true;
  }

  return false;
}

/**
 * 检查位置是否在字符串字面量中
 * @param {string} text 文件文本
 * @param {number} position 位置
 * @param {string} key 键值
 * @returns {boolean} 是否在字符串字面量中
 */
function isInStringLiteral(text, position, key) {
  // 简化实现，检查当前位置是否已包含在翻译键调用中
  return false;
}

/**
 * 获取指定键的所有语言翻译
 * @param {string} key 翻译键
 * @param {Object} localeData 多语言数据
 * @returns {Object} 翻译映射
 */
function getTranslationsForKey(key, localeData) {
  const result = {};

  // 拆分键以查找命名空间
  const parts = key.split(".");
  const namespace = parts[0];
  const fullKey = key;

  for (const locale in localeData) {
    if (
      localeData[locale][namespace] &&
      localeData[locale][namespace][fullKey]
    ) {
      result[locale] = localeData[locale][namespace][fullKey];
    }
  }

  return result;
}

/**
 * 创建翻译悬停消息
 * @param {string} key 翻译键
 * @param {Object} translations 翻译映射
 * @param {string} defaultLocale 默认语言
 * @returns {vscode.MarkdownString} Markdown格式的悬停消息
 */
function createTranslationHover(key, translations, defaultLocale) {
  const hoverContent = new vscode.MarkdownString();
  hoverContent.isTrusted = true;
  hoverContent.supportHtml = true;

  hoverContent.appendMarkdown(`**翻译键:** \`${key}\`\n\n`);

  // 添加翻译值
  if (Object.keys(translations).length === 0) {
    hoverContent.appendMarkdown(`**警告:** 未找到此键的翻译。\n\n`);
  } else {
    hoverContent.appendMarkdown(`**翻译:**\n\n`);

    for (const locale in translations) {
      const value = translations[locale];
      const isDefaultLocale = locale === defaultLocale ? " (默认)" : "";
      hoverContent.appendMarkdown(
        `- **${locale}${isDefaultLocale}:** ${value || "空"}\n`
      );
    }
  }

  // 添加编辑按钮
  hoverContent.appendMarkdown(`\n---\n\n`);
  hoverContent.appendMarkdown(
    `[编辑翻译](command:devassistkit.i18nTools.editTranslation?${encodeURIComponent(
      JSON.stringify([key])
    )})`
  );

  return hoverContent;
}

/**
 * 获取翻译悬停提供器
 * @param {Object} localeData 多语言数据
 * @returns {vscode.HoverProvider} 悬停提供器
 */
function getTranslationHoverProvider(localeData) {
  // 获取配置
  const config = vscode.workspace.getConfiguration("devAssistKit");
  const defaultLocale = config.get("i18n.defaultLocale", "zh-CN");
  const translationMethods = config.get("i18n.translationMethods", [
    "$t",
    "$st",
    "i18n.global.t",
    "t",
    "translate",
  ]);

  return {
    provideHover(document, position, token) {
      // 根据文件类型选择解析方法
      const fileType = document.languageId;
      const text = document.getText();

      // 读取当前位置的单词
      const wordRange = document.getWordRangeAtPosition(position);
      if (!wordRange) {
        return null;
      }

      const lineText = document.lineAt(position.line).text;
      const line = position.line;

      // 查找这一行中的翻译调用
      const regex = new RegExp(
        `(${translationMethods.join("|")})\\s*\\(\\s*['"]([^'"]+)['"]`,
        "g"
      );
      let match;

      while ((match = regex.exec(lineText)) !== null) {
        const [fullMatch, method, key] = match;
        const startCharacter = match.index;
        const endCharacter = match.index + fullMatch.length;

        // 检查位置是否在这个匹配内
        if (
          position.character >= startCharacter &&
          position.character <= endCharacter
        ) {
          // 获取翻译值
          const translations = getTranslationsForKey(key, localeData);

          // 创建悬停消息
          return new vscode.Hover(
            createTranslationHover(key, translations, defaultLocale),
            new vscode.Range(line, startCharacter, line, endCharacter)
          );
        }
      }

      return null;
    },
  };
}

module.exports = {
  decorateI18nKeys,
  getTranslationHoverProvider,
};
