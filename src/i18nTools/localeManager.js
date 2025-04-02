const vscode = require("vscode");
const path = require("path");
const fs = require("fs").promises;
const fg = require("fast-glob");

/**
 * 查找多语言文件
 * @param {string[]} localesPaths 多语言目录路径列表
 * @param {string[]} fileExtensions 文件扩展名列表
 * @returns {Promise<Object>} 多语言文件信息
 */
async function findLocaleFiles(localesPaths, fileExtensions) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    throw new Error("请先打开一个项目文件夹");
  }

  // 构建文件查找模式 - 优化查找模式，减少重复查询
  const patterns = [];
  for (const localePath of localesPaths) {
    try {
      // 标准化路径分隔符，确保在Windows上也能正确工作
      const normalizedPath = localePath.replace(/\\/g, "/");

      // 判断路径是否为绝对路径
      const isAbsolutePath = path.isAbsolute(normalizedPath);

      // 如果是相对路径，则相对于工作区；如果是绝对路径，则直接使用
      const basePath = isAbsolutePath
        ? normalizedPath
        : path.join(workspaceRoot, normalizedPath).replace(/\\/g, "/");

      // 检查目录是否存在
      try {
        await fs.access(basePath);
      } catch (e) {
        continue; // 目录不存在，跳过
      }

      // 优化：只添加一个递归模式，减少查询次数
      for (const ext of fileExtensions) {
        const normalizedExt = ext.startsWith(".") ? ext : `.${ext}`;
        // 使用 **/* 模式一次性匹配所有子目录
        const pattern = path
          .join(basePath, `**/*${normalizedExt}`)
          .replace(/\\/g, "/");
        patterns.push(pattern);
      }
    } catch (error) {
      console.error(`处理路径时出错: "${localePath}"`);
    }
  }

  // 优化：一次性执行glob查询所有模式
  const globOptions = {
    nodir: true,
    ignore: ["**/node_modules/**", "**/index.*"],
    windowsPathsNoEscape: true,
    absolute: true,
    follow: true,
  };

  let allFiles = [];
  try {
    allFiles = await fg(patterns, globOptions);
  } catch (error) {
    console.error("文件查找失败");
  }

  // 过滤掉文件名为index的文件
  const filteredFiles = allFiles.filter((filePath) => {
    const fileName = path.basename(filePath, path.extname(filePath));
    return fileName.toLowerCase() !== "index";
  });

  // 分析文件路径提取语言和命名空间
  const localeFiles = {};
  for (const filePath of filteredFiles) {
    try {
      // 检查文件是否存在且可访问
      try {
        await fs.access(filePath);
      } catch (e) {
        continue; // 文件不存在或无法访问，跳过
      }

      // 提取相对路径
      const relativePath = path.relative(workspaceRoot, filePath);
      console.log(`\n处理文件: "${relativePath}" (${filePath})`);

      // 尝试确定语言标识符
      const locale = determineLocale(filePath);
      console.log(`  语言识别结果: "${locale}"`);

      // 提取命名空间（如果存在）
      const namespace = determineNamespace(filePath);
      console.log(`  命名空间识别结果: "${namespace}"`);

      // 显示文件基本信息
      try {
        const stat = await fs.stat(filePath);
        console.log(`  文件信息:`, {
          大小: `${stat.size} 字节`,
          修改时间: new Date(stat.mtime).toISOString(),
          创建时间: new Date(stat.ctime).toISOString(),
        });
      } catch (e) {
        console.warn(`  无法获取文件信息:`, e);
      }

      // 添加到结果对象
      if (!localeFiles[locale]) {
        localeFiles[locale] = {};
      }
      if (!localeFiles[locale][namespace]) {
        localeFiles[locale][namespace] = [];
      }
      localeFiles[locale][namespace].push(filePath);
    } catch (error) {
      console.error(`处理文件失败: "${filePath}"`);
    }
  }

  return localeFiles;
}

/**
 * 从文件路径确定语言标识符
 * @param {string} filePath 文件路径
 * @returns {string} 语言标识符
 */
function determineLocale(filePath) {
  console.log(`  尝试从路径确定语言: "${filePath}"`);

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
      console.log(`    匹配规则: ${pattern} => 结果: ${match[1]}`);
      return match[1].toLowerCase();
    }
  }

  // 如果无法确定，使用文件名作为标识
  const fileName = path.basename(normalizedPath, path.extname(normalizedPath));
  console.log(`    未匹配任何规则，使用文件名: ${fileName}`);
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
  console.log("========== 开始加载多语言数据 ==========");
  const loadStartTime = Date.now();

  const localeData = {};

  // 计算文件总数，用于进度报告
  let totalFiles = 0;
  let processedFiles = 0;
  let successfulFiles = 0;
  let failedFiles = 0;

  // 统计文件总数
  for (const locale in localeFiles) {
    for (const namespace in localeFiles[locale]) {
      totalFiles += localeFiles[locale][namespace].length;
    }
  }

  console.log(`开始加载 ${totalFiles} 个多语言文件`);

  for (const locale in localeFiles) {
    localeData[locale] = {};
    console.log(`\n处理语言: "${locale}"`);

    for (const namespace in localeFiles[locale]) {
      console.log(`  处理命名空间: "${namespace}"`);

      // 初始化命名空间
      localeData[locale][namespace] = {};

      // 临时存储原始的嵌套对象
      let originalData = {};

      // 加载该命名空间下的所有文件
      for (const file of localeFiles[locale][namespace]) {
        try {
          processedFiles++;
          const fileStartTime = Date.now();

          console.log(
            `  [${processedFiles}/${totalFiles}] 加载文件: "${file}"`
          );

          // 确保文件存在
          try {
            await fs.access(file);
            console.log(`    文件可访问: "${file}"`);
          } catch (e) {
            console.warn(`    文件不存在或无法访问: "${file}"`, e);
            failedFiles++;
            continue;
          }

          const content = await fs.readFile(file, "utf-8");
          console.log(`    已读取文件, 大小: ${content.length} 字符`);

          // 根据文件扩展名处理内容
          const ext = path.extname(file).toLowerCase();
          console.log(`    文件类型: ${ext}`);

          let data = {};

          if (ext === ".json") {
            try {
              console.log(`    解析JSON...`);
              data = JSON.parse(content);
              console.log(`    JSON解析成功`);
              successfulFiles++;
            } catch (e) {
              console.error(`    JSON解析错误: "${file}"`, e);
              console.log(
                `    错误位置附近内容: ${content.substring(
                  Math.max(0, e.pos - 20),
                  Math.min(content.length, e.pos + 20)
                )}`
              );
              failedFiles++;
              continue; // 跳过此文件
            }
          } else if (ext === ".js" || ext === ".ts") {
            try {
              console.log(`    解析JS/TS...`);

              // 优化JS/TS文件内容提取，支持多种导出格式
              // 移除注释，减少干扰
              const cleanContent = content
                .replace(/\/\/.*$/gm, "") // 移除行注释
                .replace(/\/\*[\s\S]*?\*\//g, ""); // 移除块注释

              console.log(`    清理后内容长度: ${cleanContent.length} 字符`);

              // 尝试多种可能的导出模式
              const patterns = [
                // export default {...}
                /export\s+default\s+({[\s\S]+?})[;\s]*(?:$|\/\/|\/\*)/,
                // module.exports = {...}
                /module\.exports\s*=\s*({[\s\S]+?})[;\s]*(?:$|\/\/|\/\*)/,
                // const xxx = {...}; export default xxx
                /const\s+\w+\s*=\s*({[\s\S]+?})[;\s]*(?:$|\/\/|\/\*)/,
                // export {...}
                /export\s+({[\s\S]+?})[;\s]*(?:$|\/\/|\/\*)/,
              ];

              console.log(`    尝试 ${patterns.length} 种导出模式...`);
              let objectStr = null;

              // 尝试每种模式
              for (const pattern of patterns) {
                const matches = cleanContent.match(pattern);
                if (matches && matches[1]) {
                  objectStr = matches[1];
                  console.log(`    匹配成功: ${pattern}`);
                  break;
                }
              }

              // 如果找到了对象字符串
              if (objectStr) {
                console.log(
                  `    找到对象字符串，长度: ${objectStr.length} 字符`
                );
                try {
                  // 安全地解析字符串为对象（使用Function构造函数代替eval）
                  console.log(`    使用Function解析...`);
                  data = Function(`"use strict"; return (${objectStr})`)();
                  console.log(`    解析成功`);
                  successfulFiles++;
                } catch (e) {
                  console.error(`    解析JS/TS对象失败: "${file}"`, e);

                  // 尝试使用JSON.parse作为后备方案
                  console.log(`    尝试备用解析方法...`);
                  try {
                    // 尝试将对象转换为JSON格式再解析
                    objectStr = objectStr
                      .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // 确保键名有引号
                      .replace(/'/g, '"'); // 将单引号替换为双引号
                    console.log(
                      `    处理后的对象字符串: 前20字符 ${objectStr.substring(
                        0,
                        20
                      )}...`
                    );
                    data = JSON.parse(objectStr);
                    console.log(`    备用方法解析成功`);
                    successfulFiles++;
                  } catch (jsonError) {
                    console.error(
                      `    备用解析方法也失败: "${file}"`,
                      jsonError
                    );
                    console.log(
                      `    错误位置附近内容: ${objectStr.substring(0, 100)}...`
                    );
                    failedFiles++;
                    continue; // 跳过此文件
                  }
                }
              } else {
                console.warn(`    未找到有效导出对象: "${file}"`);
                console.log(
                  `    文件内容摘要: ${cleanContent.substring(0, 100)}...`
                );
                failedFiles++;
                continue; // 跳过此文件
              }
            } catch (e) {
              console.error(`    处理JS/TS文件出错: "${file}"`, e);
              console.error(`    错误堆栈:`, e.stack);
              failedFiles++;
              continue; // 跳过此文件
            }
          } else {
            console.warn(`    不支持的文件类型: ${ext}, 文件: "${file}"`);
            failedFiles++;
            continue; // 跳过此文件
          }

          // 输出解析结果
          const keyCount = Object.keys(data).length;
          console.log(`    解析得到 ${keyCount} 个顶级键`);
          if (keyCount > 0) {
            console.log(
              `    顶级键: ${Object.keys(data).slice(0, 5).join(", ")}${
                keyCount > 5 ? "..." : ""
              }`
            );
          }

          // 深度合并数据
          console.log(`    合并数据...`);
          originalData = deepMerge(originalData, data);

          const fileEndTime = Date.now();
          console.log(
            `    文件处理完成，耗时: ${fileEndTime - fileStartTime}ms`
          );
        } catch (error) {
          console.error(`    加载文件失败: "${file}"`, error);
          console.error(`    错误堆栈:`, error.stack);
          failedFiles++;
        }
      }

      // 将嵌套对象保存到扁平对象中
      localeData[locale][namespace] = flattenObject(originalData);
      const flattenedKeysCount = Object.keys(
        localeData[locale][namespace]
      ).length;
    }
  }

  // 报告结果
  const localeCount = Object.keys(localeData).length;
  let totalKeys = 0;
  for (const locale in localeData) {
    for (const namespace in localeData[locale]) {
      totalKeys += Object.keys(localeData[locale][namespace]).length;
    }
  }

  const loadEndTime = Date.now();
  const loadDuration = loadEndTime - loadStartTime;

  console.log("\n多语言数据加载统计:");
  console.log(`  语言数: ${localeCount}`);
  console.log(`  翻译键总数: ${totalKeys}`);
  console.log(`  处理文件总数: ${totalFiles}`);
  console.log(`  成功处理: ${successfulFiles}`);
  console.log(`  处理失败: ${failedFiles}`);
  console.log(`  总耗时: ${loadDuration}ms`);

  console.log("========== 多语言数据加载完成 ==========\n");

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

    console.log(`选择文件保存 ${locale} 语言的 ${key}: ${fileInfo}`);

    try {
      // 读取文件内容
      const content = await fs.readFile(fileInfo, "utf-8");
      const ext = path.extname(fileInfo).toLowerCase();

      // 确定键路径
      // 如果第一部分是命名空间，则去掉；否则使用完整路径
      const keyParts = selectedNamespace === parts[0] ? parts.slice(1) : parts;

      if (ext === ".json") {
        // 处理JSON文件
        let data = JSON.parse(content);

        // 创建或更新嵌套值
        setNestedValue(data, keyParts, translations[locale]);

        // 保存文件
        await fs.writeFile(fileInfo, JSON.stringify(data, null, 2), "utf-8");
        console.log(`已保存翻译到JSON文件: ${fileInfo}`);
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
            await fs.writeFile(fileInfo, newContent, "utf-8");
            console.log(`已保存翻译到JS/TS文件: ${fileInfo}`);
          } catch (e) {
            console.error(`无法更新文件: ${fileInfo}`, e);
          }
        } else {
          console.error(`文件格式不支持: ${fileInfo} - 未找到export default`);
        }
      }
    } catch (error) {
      console.error(`保存翻译失败: ${fileInfo}`, error);
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
  flattenObject,
};
