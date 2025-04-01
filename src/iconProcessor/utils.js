const path = require("path");
const vscode = require("vscode");
const fs = require("fs");
const axios = require("axios");

/**
 * 从用户输入中提取图标URL
 * @param {string} userInput 用户输入的URL或<link>标签
 * @returns {string} 提取出的URL或空字符串
 */
function extractUrlFromInput(userInput) {
  if (!userInput) return "";

  if (userInput.includes("<link")) {
    const hrefRegex = /href\s*=\s*["']([^"']+)["']/i;
    const match = userInput.match(hrefRegex);
    return match ? match[1] : "";
  }

  return userInput.trim();
}

/**
 * 获取通用的HTTP请求头
 * @returns {Object} HTTP请求头对象
 */
function getHttpHeaders(referer = null) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  };

  if (referer) {
    headers.Referer = referer;
  }

  return headers;
}

/**
 * 确保目录存在
 * @param {string} dirPath 目录路径
 */
async function ensureDirectoryExists(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

/**
 * 获取完整文件路径
 * @param {string} relativePath 相对路径
 * @returns {string} 完整路径
 */
function getFullPath(relativePath) {
  return path.join(vscode.workspace.rootPath || "", relativePath);
}

/**
 * 显示消息
 * @param {string} message 消息内容
 * @param {string} type 消息类型: 'info', 'warning', 'error'
 */
function showMessage(message, type = "info") {
  switch (type) {
    case "error":
      vscode.window.showErrorMessage(message);
      break;
    case "warning":
      vscode.window.showWarningMessage(message);
      break;
    default:
      vscode.window.showInformationMessage(message);
  }
}

/**
 * 确保文件路径有效，如果是目录则添加默认文件名
 * @param {string} filePath 文件路径
 * @param {string} defaultFileName 默认文件名
 * @returns {Promise<string>} 有效的文件路径
 */
async function ensureValidFilePath(filePath, defaultFileName = "index.scss") {
  try {
    // 检查路径是否存在
    try {
      const stats = await fs.promises.stat(filePath);
      // 如果是目录，附加默认文件名
      if (stats.isDirectory()) {
        const newPath = path.join(filePath, defaultFileName);
        console.log(`路径"${filePath}"是目录，将使用文件: ${newPath}`);
        return newPath;
      }
    } catch (err) {
      // 只处理文件不存在的情况
      if (err.code !== "ENOENT") {
        console.error(`检查路径"${filePath}"时出错:`, err);
        throw err;
      }

      // 文件不存在，检查路径是否以目录分隔符结尾或没有扩展名
      if (
        filePath.endsWith(path.sep) ||
        filePath.endsWith("/") ||
        filePath.endsWith("\\") ||
        path.extname(filePath) === ""
      ) {
        // 看起来是一个目录路径，创建目录并使用默认文件名
        await ensureDirectoryExists(filePath);
        const newPath = path.join(filePath, defaultFileName);
        console.log(`路径"${filePath}"看起来像目录，将使用文件: ${newPath}`);
        return newPath;
      }
    }

    // 确保父目录存在
    await ensureDirectoryExists(path.dirname(filePath));
    console.log(`将使用文件路径: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error(`确保文件路径"${filePath}"有效时出错:`, error);
    // 出错时，尝试最安全的选项 - 创建一个新的唯一文件名在工作区根目录
    const safeFilePath = getFullPath(defaultFileName);
    console.log(`出错后使用安全路径: ${safeFilePath}`);
    return safeFilePath;
  }
}

module.exports = {
  extractUrlFromInput,
  getHttpHeaders,
  ensureDirectoryExists,
  getFullPath,
  showMessage,
  ensureValidFilePath,
};
