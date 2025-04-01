const vscode = require("vscode");
const path = require("path");
const fs = require("fs").promises;
const { glob, Glob } = require("glob");

/**
 * 查找多语言文件
 * @param {string[]} localesPaths 多语言目录路径列表
 * @param {string[]} fileExtensions 文件扩展名列表
 * @returns {Promise<Object>} 多语言文件信息
 */
async function findLocaleFiles(localesPaths, fileExtensions) {
  const workspaceRoot = vscode.workspace.workspaceFolders[0]?.uri.fsPath;
  if (!workspaceRoot) {
    throw new Error("请先打开一个项目文件夹");
  }

  // 构建文件查找模式
  const patterns = [];
  for (const localePath of localesPaths) {
    for (const ext of fileExtensions) {
      patterns.push(path.join(localePath, `*${ext}`));
    }
  }

  // 查找匹配的文件
  const allFiles = [];
  for (const pattern of patterns) {
    try {
      const fullPattern = path.join(workspaceRoot, pattern);
      const g = new Glob(fullPattern, {});
      // glob objects are async iterators, can also do globIterate() or
      // g.iterate(), same deal
      for await (const file of g) {
        console.log("found a foo file:", file);
      }
      // 使用glob查找文件
      const files = await glob(fullPattern, {
        nodir: true,
        ignore: "node_modules/**",
      });
      console.log("匹配的文件:", files);
      allFiles.push(...files);
    } catch (error) {
      console.error(`查找文件失败: ${pattern}`, error);
    }
  }

  // 分析文件路径提取语言和命名空间
  const localeFiles = {};
  for (const filePath of allFiles) {
    // 提取相对路径
    const relativePath = path.relative(workspaceRoot, filePath);

    // 尝试确定语言标识符
    const locale = determineLocale(filePath);

    // 提取命名空间（如果存在）
    const namespace = determineNamespace(filePath);

    if (!localeFiles[locale]) {
      localeFiles[locale] = {};
    }

    if (!localeFiles[locale][namespace]) {
      localeFiles[locale][namespace] = [];
    }

    localeFiles[locale][namespace].push({
      path: filePath,
      relativePath,
    });
  }

  return localeFiles;
}

/**
 * 从文件路径确定语言标识符
 * @param {string} filePath 文件路径
 * @returns {string} 语言标识符
 */
function determineLocale(filePath) {
  // 常见语言标识模式, 如 en.json, zh-CN.json
  const localePatterns = [
    /[/\\]([a-z]{2}(-[A-Z]{2})?)[/\\]/i, // 目录名如 /en/ 或 /zh-CN/
    /[/\\]([a-z]{2}(-[A-Z]{2})?)\.(?:json|js|ts)$/i, // 文件名如 en.json 或 zh-CN.json
    /[/\\]i18n[/\\]([a-z]{2}(-[A-Z]{2})?)[/\\]/i, // i18n目录下的子目录 /i18n/en/ 或 /i18n/zh-CN/
  ];

  for (const pattern of localePatterns) {
    const match = filePath.match(pattern);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
  }

  // 如果无法确定，使用文件名作为标识
  const fileName = path.basename(filePath, path.extname(filePath));
  return fileName;
}

/**
 * 从文件路径确定命名空间
 * @param {string} filePath 文件路径
 * @returns {string} 命名空间
 */
function determineNamespace(filePath) {
  // 提取文件名（不含扩展名）
  const fileName = path.basename(filePath, path.extname(filePath));

  // 如果文件名是语言标识，则命名空间为 common
  const localePattern = /^[a-z]{2}(-[A-Z]{2})?$/i;
  if (localePattern.test(fileName)) {
    return "common";
  }

  // 否则使用文件名作为命名空间
  return fileName;
}

/**
 * 加载多语言数据
 * @param {Object} localeFiles 多语言文件信息
 * @returns {Promise<Object>} 多语言数据
 */
async function loadLocaleData(localeFiles) {
  const localeData = {};

  for (const locale in localeFiles) {
    localeData[locale] = {};

    for (const namespace in localeFiles[locale]) {
      localeData[locale][namespace] = {};

      // 加载该命名空间下的所有文件
      for (const file of localeFiles[locale][namespace]) {
        try {
          const content = await fs.readFile(file.path, "utf-8");

          // 根据文件扩展名处理内容
          const ext = path.extname(file.path).toLowerCase();
          let data = {};

          if (ext === ".json") {
            data = JSON.parse(content);
          } else if (ext === ".js" || ext === ".ts") {
            // 尝试使用简单的正则从JS/TS文件中提取JSON对象
            // 这种方法不完美，但可以处理很多常见情况
            const matches = content.match(
              /export\s+default\s+({[\s\S]+?});?\s*$/
            );
            if (matches && matches[1]) {
              try {
                // 使用eval，因为JSON.parse不能处理JS对象字面量
                // 注意：这在生产环境中可能存在安全风险
                data = eval(`(${matches[1]})`);
              } catch (e) {
                console.error(`无法解析文件内容: ${file.relativePath}`, e);
              }
            }
          }

          // 合并数据到命名空间
          localeData[locale][namespace] = {
            ...localeData[locale][namespace],
            ...flattenObject(data, namespace),
          };
        } catch (error) {
          console.error(`加载文件失败: ${file.relativePath}`, error);
        }
      }
    }
  }

  return localeData;
}

/**
 * 将嵌套对象扁平化为点分隔的键
 * @param {Object} obj 嵌套对象
 * @param {string} prefix 前缀
 * @returns {Object} 扁平化的对象
 */
function flattenObject(obj, prefix = "") {
  const result = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      const newKey = prefix ? `${prefix}.${key}` : key;

      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        Object.assign(result, flattenObject(value, newKey));
      } else {
        result[newKey] = value;
      }
    }
  }

  return result;
}

/**
 * 将翻译内容写入文件
 * @param {string} key 翻译键
 * @param {Object} translations 翻译值
 * @param {Object} localeFiles 多语言文件信息
 * @returns {Promise<void>}
 */
async function saveTranslation(key, translations, localeFiles) {
  // 拆分键以确定命名空间
  const parts = key.split(".");
  const namespace = parts.shift();
  const restKey = parts.join(".");

  for (const locale in translations) {
    if (
      !translations[locale] ||
      !localeFiles[locale] ||
      !localeFiles[locale][namespace]
    ) {
      continue;
    }

    // 使用该语言和命名空间的第一个文件
    const fileInfo = localeFiles[locale][namespace][0];
    if (!fileInfo) continue;

    try {
      const content = await fs.readFile(fileInfo.path, "utf-8");
      const ext = path.extname(fileInfo.path).toLowerCase();

      if (ext === ".json") {
        // 处理JSON文件
        let data = JSON.parse(content);
        setNestedValue(data, parts, translations[locale]);
        await fs.writeFile(
          fileInfo.path,
          JSON.stringify(data, null, 2),
          "utf-8"
        );
      } else if (ext === ".js" || ext === ".ts") {
        // 处理JS/TS文件
        // 这种方法仅适用于有固定格式的JS/TS文件
        // 真实场景可能需要更复杂的解析和生成
        const matches = content.match(/export\s+default\s+({[\s\S]+?});?\s*$/);
        if (matches && matches[1]) {
          try {
            let data = eval(`(${matches[1]})`);
            setNestedValue(data, parts, translations[locale]);

            const newContent = content.replace(
              /export\s+default\s+({[\s\S]+?});?\s*$/,
              `export default ${JSON.stringify(data, null, 2)};`
            );

            await fs.writeFile(fileInfo.path, newContent, "utf-8");
          } catch (e) {
            console.error(`无法更新文件: ${fileInfo.relativePath}`, e);
          }
        }
      }
    } catch (error) {
      console.error(`保存翻译失败: ${fileInfo.relativePath}`, error);
    }
  }
}

/**
 * 设置嵌套对象的值
 * @param {Object} obj 对象
 * @param {string[]} keys 键路径
 * @param {any} value 要设置的值
 */
function setNestedValue(obj, keys, value) {
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }

  const lastKey = keys[keys.length - 1];
  current[lastKey] = value;
}

module.exports = {
  findLocaleFiles,
  loadLocaleData,
  saveTranslation,
};
