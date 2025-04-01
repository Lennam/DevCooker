const vscode = require("vscode");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

function activate(context) {
  let disposable = vscode.commands.registerCommand(
    "extension.icomoonProcessor",
    async function () {
      // 获取配置
      const config = vscode.workspace.getConfiguration("icomoonProcessor");
      const fontFilesPath = config.get("fontFilesPath", "./src/assets/fonts");
      const stylesPath = config.get("stylesPath", "./src/styles/icons/dc-icon-basic.scss");

	  console.log(fontFilesPath, stylesPath);

      // 获取用户输入
      const userInput = await vscode.window.showInputBox({
        prompt: "请输入Icomoon样式文件URL或<link>标签",
        validateInput: (text) => {
          // 同时允许直接输入URL或包含link标签的输入
          if (text.includes("<link")) {
            return text.includes("href=") ? null : "未找到有效的href属性";
          }
          return text.startsWith("http")
            ? null
            : "请输入有效的URL或完整的<link>标签";
        },
      });

      // 提取URL的逻辑
      let icomoonUrl = "";
      if (userInput.startsWith("<link")) {
        const hrefRegex = /href\s*=\s*["']([^"']+)["']/i;
        const match = userInput.match(hrefRegex);
        icomoonUrl = match ? match[1] : "";
      } else {
        icomoonUrl = userInput;
      }

      if (!icomoonUrl) return;

      try {
        // 下载样式文件
        const cssResponse = await axios.get(icomoonUrl);
        const cssContent = cssResponse.data;

        // 解析字体文件URL
        const fontUrls = extractFontUrls(cssContent);
        console.log("提取到的字体URL：", fontUrls);
        vscode.window.showInformationMessage(
          `找到${fontUrls.length}个字体文件需要下载`
        );
        // 创建字体目录
        const workspaceRoot = vscode.workspace.rootPath || "";
        const fullFontsPath = path.join(workspaceRoot, fontFilesPath);
        await fs.promises.mkdir(fullFontsPath, { recursive: true });

        // 下载所有字体文件
        await Promise.all(
          fontUrls.map(async (url) => {
            try {
              const fontResponse = await axios.get(url, {
                responseType: "arraybuffer",
              });
              // 移除URL参数保留纯净文件名
              const cleanName = path.basename(url).replace(/\?.*/, "");
              const targetPath = path.join(fullFontsPath, cleanName);

              // 检查并删除已存在的同名文件
              if (fs.existsSync(targetPath)) {
                await fs.promises.unlink(targetPath);
              }

              await fs.promises.writeFile(targetPath, fontResponse.data);
            } catch (error) {
              console.error("下载字体文件失败：", error);
            }
          })
        );

        // 保存样式文件
        const fullStylesPath = path.join(workspaceRoot, stylesPath);
		const newScssContent = await generateScssFromCss(cssContent);
		await fs.promises.writeFile(fullStylesPath, newScssContent);
		vscode.window.showInformationMessage('SCSS文件已完整重建');
	
      } catch (error) {
        console.error("完整错误堆栈：", error.stack);
        vscode.window.showErrorMessage(`下载失败：
		URL: ${error.config?.url || "未知"}
		状态码: ${error.response?.status || "无响应"}
		错误详情: ${error.message}`);
      }
    }
  );

  context.subscriptions.push(disposable);
}
const CSS_PARSE_REGEX = /\.(dc-icon-basic-[^{]+)\s*{[^}]*content:\s*"([^"]+)"/g;

async function generateScssFromCss(cssContent) {
    // 提取所有图标定义
    const iconMap = new Map();
    let match;
    
    while ((match = CSS_PARSE_REGEX.exec(cssContent))) {
        const [_, className, unicode] = match;
        const normalizedName = className.replace('dc-icon-basic-', '').replace(':before', '').trim();
        iconMap.set(normalizedName, {
            varName: `$dc-icon-basic-${normalizedName}`,
            unicode: unicode.toLowerCase(),
            className: `.dc-icon-basic-${normalizedName}`
        });
    }

    // 生成SCSS结构
    const scssParts = {
        variables: [],
        classes: []
    };

    // 构建变量声明
    iconMap.forEach((value) => {
        scssParts.variables.push(`${value.varName}: '${value.unicode}';`);
    });

    // 构建类结构
    iconMap.forEach((value) => {
        scssParts.classes.push(`
${value.className} {
    &::before {
        content: ${value.varName};
    }
}`);
    });

    // 组合完整SCSS内容
    return `@use '../base/variables' as *;
@use '../base/theme' as *;

$dc-font-basic-family: 'dc-font-basic' !default;

// ========== 自动生成的图标变量 ==========
${scssParts.variables.join('\n')}

@font-face {
    font-family: $dc-font-basic-family;
    src: url('#{$dc-font-path}/#{$dc-font-basic-family}.eot');
    src: url('#{$dc-font-path}/#{$dc-font-basic-family}.eot?#iefix') format('embedded-opentype'),
        url('#{$dc-font-path}/#{$dc-font-basic-family}.ttf') format('truetype'),
        url('#{$dc-font-path}/#{$dc-font-basic-family}.woff') format('woff'),
        url('#{$dc-font-path}/#{$dc-font-basic-family}.svg##{$dc-font-basic-family}') format('svg');
    font-weight: normal;
    font-style: normal;
    font-display: block;
}

[class^='dc-icon-basic-'],
[class*=' dc-icon-basic-'] {
    font-family: '#{$dc-font-basic-family}' !important;
    font-size: $dc-text-sm;
    font-style: normal;
    font-weight: normal;
	font-variant: normal;
    line-height: 1;
	text-transform: none;
    speak: never;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

// ========== 自动生成的图标类 ==========
${scssParts.classes.join('\n\n')}
`;
}



function extractFontUrls(cssContent) {
  // 更新后的正则表达式，匹配包含查询参数和哈希的完整URL
  const regex =
    /url\s*\(\s*['"]?(https?:\/\/[^'")]+?\.(?:woff2?|ttf|eot|svg)(?:[?#][^'")]*)?)/gi;

  const matches = new Set(); // 直接使用Set去重
  let match;

  while ((match = regex.exec(cssContent)) !== null) {
    // 处理可能存在的编码字符（如空格被转义为%20）
    const decodedUrl = decodeURI(match[1]);
    matches.add(decodedUrl);
  }

  return Array.from(matches);
}

module.exports = {
  activate,
};
