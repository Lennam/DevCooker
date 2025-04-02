const vscode = require("vscode");
const acorn = require("acorn");
const walk = require("acorn-walk");

// 添加翻译缓存，避免重复查询相同的键
const translationCache = new Map();
// 控制是否输出调试日志
const DEBUG = false;

// 用于日志输出的辅助函数
function logDebug(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

function logWarn(...args) {
  console.warn(...args);
}

function logError(...args) {
  console.error(...args);
}

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
 * 装饰编辑器中的多语言键
 * @param {vscode.TextEditor} editor 文本编辑器
 * @param {vscode.TextEditorDecorationType} decorator 装饰器类型
 * @param {Object} localeData 多语言数据
 */
function decorateI18nKeys(editor, decorator, localeData) {
  if (!editor || !decorator || isEmpty(localeData)) {
    return;
  }

  const startTime = Date.now();
  const text = editor.document.getText();
  const decorations = [];

  // 获取配置
  const config = vscode.workspace.getConfiguration("devCooker");
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

  // 每次装饰前清理缓存，避免缓存过大
  // 只在不同文件间保留缓存，同一文件的更新会刷新缓存
  if (translationCache.size > 1000) {
    translationCache.clear();
  }

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

  logDebug(
    `装饰完成，共处理 ${decorations.length} 个翻译键，耗时 ${
      Date.now() - startTime
    }ms`
  );
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
  
  // 优化正则表达式，一次性捕获所有可能的多语言方法调用
  const methodPattern = translationMethods.join("|");
  const templatePattern = new RegExp(
    `(${methodPattern})\\s*\\(\\s*['"]([^'"]+)['"]`,
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

    // 创建仅用于悬停功能的装饰器（不包含行内显示）
    const decoration = {
      range,
      // 不需要获取翻译值，提高性能
    };

    decorations.push(decoration);
  }

  // 解析脚本部分的翻译
  try {
    // 提取脚本部分 - 使用更高效的正则表达式
    const scriptMatch = text.match(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/i);
    if (scriptMatch && scriptMatch[1]) {
      const scriptContent = scriptMatch[1];
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
    logError("解析Vue脚本出错:", error);
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
    // 解析JS代码 - 优化解析选项
    const ast = acorn.parse(content, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      // 添加容错能力
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
    });

    // 创建方法名映射集，提高查找性能
    const translationMethodsSet = new Set(translationMethods);

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
              methodName = `i18n.global.${methodName}`;
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
          translationMethodsSet.has(methodName) &&
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

            // 创建仅用于悬停功能的装饰器（不包含行内显示）
            const decoration = {
              range,
              // 不需要获取翻译值，提高性能
            };

            decorations.push(decoration);
          }
        }
      },
    });
  } catch (error) {
    logError("解析JS代码出错:", error);
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
  // 检查缓存中是否已有结果
  const cacheKey = key;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  // 创建结果对象
  const result = {};

  // 调试日志
  logDebug(`尝试获取翻译键: ${key}`);

  // 检查键是否为空
  if (!key) {
    logWarn("翻译键为空");
    translationCache.set(cacheKey, result);
    return result;
  }

  // 简单的键分割，用于嵌套对象导航
  const parts = key.split(".");

  // 遍历所有语言
  for (const locale in localeData) {
    // 跳过不存在的语言
    if (!localeData[locale]) continue;

    // 遍历该语言的所有命名空间
    let found = false;
    for (const namespace in localeData[locale]) {
      if (found) break; // 如果已经找到翻译，不再继续查找

      // 尝试方法 1: 直接在当前命名空间找到完整键
      if (localeData[locale][namespace][key] !== undefined) {
        result[locale] = localeData[locale][namespace][key];
        logDebug(`在 ${locale}.${namespace} 中找到完整键: ${key}`);
        found = true;
        continue;
      }

      // 尝试方法 2: 深度导航嵌套对象
      try {
        let current = localeData[locale][namespace];
        let validPath = true;

        // 深度优先遍历对象树
        for (const part of parts) {
          if (!current || typeof current !== "object" || !(part in current)) {
            validPath = false;
            break;
          }
          current = current[part];
        }

        // 找到了非对象的叶子节点值
        if (validPath && current !== undefined && typeof current !== "object") {
          result[locale] = current;
          logDebug(
            `在 ${locale}.${namespace} 中通过嵌套路径找到键: ${key} = ${current}`
          );
          found = true;
          continue;
        }
      } catch (error) {
        logError(`嵌套导航出错: ${locale}.${namespace}.${key}`, error);
      }

      // 尝试方法 3: 查找最后一个部分作为简单键
      if (parts.length > 1) {
        const lastPart = parts[parts.length - 1];
        if (localeData[locale][namespace][lastPart] !== undefined) {
          result[locale] = localeData[locale][namespace][lastPart];
          logDebug(`在 ${locale}.${namespace} 中找到简单键: ${lastPart}`);
          found = true;
        }
      }
    }
  }

  // 调试日志
  if (Object.keys(result).length === 0) {
    logWarn(`未找到翻译键: ${key} 的翻译`);
  } else {
    logDebug(`翻译键 ${key} 的最终结果:`, result);
  }

  // 缓存结果
  translationCache.set(cacheKey, result);
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

    // 优先显示默认语言和英文
    const orderedLocales = Object.keys(translations).sort((a, b) => {
      if (a === defaultLocale) return -1;
      if (b === defaultLocale) return 1;
      if (a === "en" || a === "en-US") return -1;
      if (b === "en" || b === "en-US") return 1;
      return a.localeCompare(b);
    });

    for (const locale of orderedLocales) {
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
  const config = vscode.workspace.getConfiguration("devCooker");
  const defaultLocale = config.get("i18n.defaultLocale", "zh-CN");
  const translationMethods = config.get("i18n.translationMethods", [
    "$t",
    "$st",
    "i18n.global.t",
    "t",
    "translate",
  ]);

  // 编译一次正则表达式，提高性能
  const methodPattern = translationMethods.join("|");
  const regex = new RegExp(
    `(${methodPattern})\\s*\\(\\s*['"]([^'"]+)['"]`,
    "g"
  );

  return {
    provideHover(document, position, token) {
      // 读取当前位置的单词
      const wordRange = document.getWordRangeAtPosition(position);
      if (!wordRange) {
        return null;
      }

      const lineText = document.lineAt(position.line).text;
      const line = position.line;

      // 重置正则表达式的lastIndex
      regex.lastIndex = 0;
      
      // 查找这一行中的翻译调用
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
  clearTranslationCache: () => translationCache.clear(),
};
