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
    // 标准化路径分隔符，确保在Windows上也能正确工作
    const normalizedPath = localePath.replace(/\\/g, "/");
    for (const ext of fileExtensions) {
      // 添加对直接位于locales根目录下的文件的支持
      patterns.push(path.join(normalizedPath, `*${ext}`));
      patterns.push(path.join(normalizedPath, `*/*${ext}`)); // 添加对子目录的支持
    }
  }

  // 查找匹配的文件
  const allFiles = [];
  for (const pattern of patterns) {
    try {
      // 确保Windows路径格式也能正确工作
      const fullPattern = path.join(workspaceRoot, pattern).replace(/\\/g, "/");
      console.log("查找模式:", fullPattern);

      // 移除可能导致问题的重复代码
      /* 
      const g = new Glob(fullPattern, {});
      for await (const file of g) {
        console.log("found a foo file:", file);
      }
      */

      // 使用glob查找文件，添加Windows路径兼容选项
      const files = await glob(fullPattern, {
        nodir: true,
        ignore: ["node_modules/**", "**/index.*"], // 排除node_modules和index文件
        windowsPathsNoEscape: true, // 添加Windows路径兼容选项
      });
      console.log("匹配的文件:", files);
      allFiles.push(...files);
    } catch (error) {
      console.error(`查找文件失败: ${pattern}`, error);
    }
  }

  // 过滤掉文件名为index的文件
  const filteredFiles = allFiles.filter((filePath) => {
    const fileName = path.basename(filePath, path.extname(filePath));
    return fileName.toLowerCase() !== "index";
  });

  // 分析文件路径提取语言和命名空间
  const localeFiles = {};
  for (const filePath of filteredFiles) {
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
  // 标准化路径用于正则匹配
  const normalizedPath = filePath.replace(/\\/g, "/");

  // 常见语言标识模式, 如 en.json, zh-CN.json
  const localePatterns = [
    /\/([a-z]{2}(-[A-Z]{2})?)\//, // 目录名如 /en/ 或 /zh-CN/
    /\/([a-z]{2}(-[A-Z]{2})?)\.(?:json|js|ts)$/, // 文件名如 en.json 或 zh-CN.json
    /\/i18n\/([a-z]{2}(-[A-Z]{2})?)\//, // i18n目录下的子目录 /i18n/en/ 或 /i18n/zh-CN/
    /\/locales\/([a-z]{2}(-[A-Z]{2})?)\//, // locales目录下的子目录 /locales/en/ 或 /locales/zh-CN/
  ];

  for (const pattern of localePatterns) {
    const match = normalizedPath.match(pattern);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
  }

  // 如果无法确定，使用文件名作为标识
  const fileName = path.basename(normalizedPath, path.extname(normalizedPath));
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
      // 初始化命名空间
      localeData[locale][namespace] = {};

      // 临时存储原始的嵌套对象
      let originalData = {};

      // 加载该命名空间下的所有文件
      for (const file of localeFiles[locale][namespace]) {
        try {
          const content = await fs.readFile(file.path, "utf-8");
          console.log(`加载多语言文件: ${file.relativePath}`);

          // 根据文件扩展名处理内容
          const ext = path.extname(file.path).toLowerCase();
          let data = {};

          if (ext === ".json") {
            data = JSON.parse(content);
            console.log(`解析JSON文件: ${file.relativePath}`, data);
          } else if (ext === ".js" || ext === ".ts") {
            // 优化JS/TS文件内容提取，支持export default格式
            const exportPattern = /export\s+default\s+({[\s\S]+?});?\s*$/;
            const constPattern = /const\s+\w+\s*=\s*({[\s\S]+?});?\s*$/;

            // 尝试匹配export default格式
            let matches = content.match(exportPattern);

            // 如果没找到，尝试匹配const变量声明格式
            if (!matches) {
              matches = content.match(constPattern);
            }

            if (matches && matches[1]) {
              try {
                // 使用eval，因为JSON.parse不能处理JS对象字面量
                // 注意：这在生产环境中可能存在安全风险
                const objStr = matches[1]
                  .replace(/\/\/.*$/gm, "")
                  .replace(/\/\*[\s\S]*?\*\//g, "");
                data = eval(`(${objStr})`);
                console.log(`解析JS/TS文件: ${file.relativePath}`, data);
              } catch (e) {
                console.error(`无法解析文件内容: ${file.relativePath}`, e);
              }
            }
          }

          // 合并原始嵌套对象
          originalData = deepMerge(originalData, data);

          // 合并扁平化数据到命名空间
          const flattenedData = flattenObject(data);
          console.log(
            `加载文件 ${file.relativePath} 的扁平化数据:`,
            flattenedData
          );

          // 合并数据到命名空间
          localeData[locale][namespace] = {
            ...localeData[locale][namespace],
            ...flattenedData,
          };
        } catch (error) {
          console.error(`加载文件失败: ${file.relativePath}`, error);
        }
      }

      // 将原始嵌套对象也添加到命名空间中
      localeData[locale][namespace] = {
        ...localeData[locale][namespace],
        ...originalData,
      };

      console.log(
        `${locale}.${namespace} 命名空间加载完成`,
        localeData[locale][namespace]
      );
    }
  }

  return localeData;
}

/**
 * 深度合并两个对象
 * @param {Object} target 目标对象
 * @param {Object} source 源对象
 * @returns {Object} 合并后的对象
 */
function deepMerge(target, source) {
  // 如果目标不是对象，直接返回源
  if (!target || typeof target !== "object") {
    return source;
  }

  // 如果源不是对象，直接返回目标
  if (!source || typeof source !== "object") {
    return target;
  }

  // 创建结果对象
  const result = { ...target };

  // 遍历源对象的所有键
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      // 如果源和目标在当前键上都是对象，递归合并
      if (
        typeof source[key] === "object" &&
        !Array.isArray(source[key]) &&
        typeof target[key] === "object" &&
        !Array.isArray(target[key])
      ) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        // 否则直接使用源值
        result[key] = source[key];
      }
    }
  }

  return result;
}

/**
 * 将嵌套对象扁平化为点分隔的键
 * @param {Object} obj 嵌套对象
 * @param {string} prefix 前缀
 * @returns {Object} 扁平化的对象
 */
function flattenObject(obj, prefix = "") {
  // 创建结果对象
  const result = {};

  // 处理空值或非对象情况
  if (!obj || typeof obj !== "object") {
    return result;
  }

  // 遍历对象的所有键
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      // 构建新的键名
      const newKey = prefix ? `${prefix}.${key}` : key;

      // 检查是否需要递归处理
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value).length > 0
      ) {
        // 如果值是非空对象并且不是数组，递归处理嵌套对象
        const nestedKeys = flattenObject(value, newKey);

        // 合并嵌套键到结果中
        Object.assign(result, nestedKeys);

        // 同时保留原始键，以便同时支持完整路径和点分隔路径
        result[newKey] = value;
      } else {
        // 叶子节点(值不是对象或是空对象/数组)，直接赋值
        result[newKey] = value;
      }
    }
  }

  // 返回扁平化后的对象
  console.log("扁平化结果:", result);
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
  console.log(`开始保存翻译: ${key}`, translations);

  // 拆分键路径，用于嵌套对象导航
  const parts = key.split(".");

  // 遍历需要保存的所有语言
  for (const locale in translations) {
    // 验证语言是否存在文件
    if (!translations[locale] || !localeFiles[locale]) {
      console.warn(`语言 ${locale} 不存在或没有关联文件`);
      continue;
    }

    // 选择保存文件
    // 1. 首先尝试使用键的第一部分作为命名空间
    let targetNamespace = parts[0];
    let selectedNamespace = null;
    let fileInfo = null;

    // 检查是否存在该命名空间的文件
    if (
      localeFiles[locale][targetNamespace] &&
      localeFiles[locale][targetNamespace].length > 0
    ) {
      selectedNamespace = targetNamespace;
      fileInfo = localeFiles[locale][targetNamespace][0];
    } else {
      // 2. 如果找不到匹配的命名空间，使用第一个可用的命名空间
      const namespaces = Object.keys(localeFiles[locale]);
      if (namespaces.length > 0) {
        selectedNamespace = namespaces[0]; // 使用第一个可用的命名空间
        fileInfo = localeFiles[locale][selectedNamespace][0];
      }
    }

    // 如果没有找到可用的文件，跳过此语言
    if (!fileInfo) {
      console.warn(`未找到语言 ${locale} 的可用文件`);
      continue;
    }

    console.log(
      `选择文件保存 ${locale} 语言的 ${key}: ${fileInfo.relativePath}`
    );

    try {
      // 读取文件内容
      const content = await fs.readFile(fileInfo.path, "utf-8");
      const ext = path.extname(fileInfo.path).toLowerCase();

      // 确定键路径
      // 如果第一部分是命名空间，则去掉；否则使用完整路径
      const keyParts = selectedNamespace === parts[0] ? parts.slice(1) : parts;

      if (ext === ".json") {
        // 处理JSON文件
        let data = JSON.parse(content);

        // 创建或更新嵌套值
        setNestedValue(data, keyParts, translations[locale]);

        // 保存文件
        await fs.writeFile(
          fileInfo.path,
          JSON.stringify(data, null, 2),
          "utf-8"
        );
        console.log(`已保存翻译到JSON文件: ${fileInfo.relativePath}`);
      } else if (ext === ".js" || ext === ".ts") {
        // 处理JS/TS文件 - 支持export default格式
        const exportPattern = /export\s+default\s+({[\s\S]+?});?\s*$/;
        const matches = content.match(exportPattern);

        if (matches && matches[1]) {
          try {
            // 解析数据对象
            const objStr = matches[1]
              .replace(/\/\/.*$/gm, "")
              .replace(/\/\*[\s\S]*?\*\//g, "");
            let data = eval(`(${objStr})`);

            // 创建或更新嵌套值
            setNestedValue(data, keyParts, translations[locale]);

            // 替换导出内容
            const newContent = content.replace(
              exportPattern,
              `export default ${JSON.stringify(data, null, 2)};`
            );

            // 保存文件
            await fs.writeFile(fileInfo.path, newContent, "utf-8");
            console.log(`已保存翻译到JS/TS文件: ${fileInfo.relativePath}`);
          } catch (e) {
            console.error(`无法更新文件: ${fileInfo.relativePath}`, e);
          }
        } else {
          console.error(
            `文件格式不支持: ${fileInfo.relativePath} - 未找到export default`
          );
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
  // 参数验证
  if (!obj || !keys || !keys.length) {
    console.error("设置嵌套值失败: 无效参数", { obj, keys, value });
    return;
  }

  // 特殊情况: 如果只有一个键，直接设置
  if (keys.length === 1) {
    obj[keys[0]] = value;
    return;
  }

  // 常规情况: 导航到嵌套对象
  let current = obj;

  // 遍历除最后一个键以外的所有键，创建路径
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];

    // 如果当前键不存在或值不是对象，创建新对象
    if (
      !current[key] ||
      typeof current[key] !== "object" ||
      Array.isArray(current[key])
    ) {
      current[key] = {};
    }

    // 移动到下一级
    current = current[key];
  }

  // 设置最后一个键的值
  const lastKey = keys[keys.length - 1];
  current[lastKey] = value;

  console.log(`已设置嵌套值: ${keys.join(".")} = ${JSON.stringify(value)}`);
}

module.exports = {
  findLocaleFiles,
  loadLocaleData,
  saveTranslation,
};
