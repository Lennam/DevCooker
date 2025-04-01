const axios = require("axios");
const path = require("path");
const fs = require("fs");
const {
  getHttpHeaders,
  ensureDirectoryExists,
  getFullPath,
  showMessage,
} = require("./utils");

/**
 * 提取字体URL（支持带参数的URL）
 * @param {string} cssContent CSS内容
 * @returns {string[]} 字体URL数组
 */
function extractFontUrls(cssContent) {
  const regex =
    /url\s*\(\s*['"]?(https?:\/\/[^'")]+?\.(?:woff2?|ttf|eot|svg)(?:[?#][^'")]*)?)/gi;
  const matches = new Set();
  let match;

  while ((match = regex.exec(cssContent))) {
    matches.add(decodeURI(match[1]));
  }

  return Array.from(matches);
}

/**
 * 提取图标定义
 * @param {string} cssContent CSS内容
 * @returns {Map} 图标定义Map
 */
function extractIconDefinitions(cssContent) {
  const iconMap = new Map();
  const regex =
    /\.(dc-icon-basic-[^{:]+)(?::before)?\s*{[^}]*content:\s*"([^"]+)"/g;
  let match;

  while ((match = regex.exec(cssContent))) {
    const className = match[1].trim();
    const unicode = match[2].toLowerCase();
    const normalizedName = className.replace("dc-icon-basic-", "");

    iconMap.set(normalizedName, {
      varName: `$dc-icon-basic-${normalizedName}`,
      unicode: unicode,
      className: `.${className}`,
    });
  }

  return iconMap;
}

/**
 * 下载字体文件
 * @param {string[]} urls 字体URL数组
 * @param {string} savePath 保存路径
 */
async function downloadFonts(urls, savePath) {
  if (urls.length === 0) return;

  const fullPath = getFullPath(savePath);
  await ensureDirectoryExists(fullPath);

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const response = await axios.get(url, {
          responseType: "arraybuffer",
          headers: getHttpHeaders(new URL(url).origin),
        });

        const filename = path.basename(url).split("?")[0];
        const filePath = path.join(fullPath, filename);

        await fs.promises.writeFile(filePath, response.data);
        return { url, success: true, path: filePath };
      } catch (error) {
        console.error(`下载字体文件失败: ${url}`, error);
        return { url, success: false, error: error.message };
      }
    })
  );

  const successCount = results.filter(
    (r) => r.status === "fulfilled" && r.value.success
  ).length;
  const failCount = urls.length - successCount;

  if (failCount > 0) {
    showMessage(
      `${successCount} 个字体文件下载成功，${failCount} 个失败`,
      "warning"
    );
  } else {
    showMessage(`全部 ${successCount} 个字体文件下载成功`);
  }
}

module.exports = {
  extractFontUrls,
  extractIconDefinitions,
  downloadFonts,
};
