const fs = require("fs");
const path = require("path");
const { extractIconDefinitions } = require("./iconParser");
const { getFullPath } = require("./utils");

/**
 * 生成SCSS导入语句
 * @param {string} workspaceRoot 工作区根目录
 * @returns {string} 导入语句
 */
function generateImports(workspaceRoot) {
  const baseDir = path.join(workspaceRoot, "src/base");
  let useImports = "";

  // 检查是否存在base/variables和base/theme文件
  if (fs.existsSync(path.join(baseDir, "variables.scss"))) {
    useImports += "@use '../base/variables' as *;\n";
  }

  if (fs.existsSync(path.join(baseDir, "theme.scss"))) {
    useImports += "@use '../base/theme' as *;\n";
  }

  if (!useImports) {
    useImports = "// Base files not found, you may need to create them\n";
  }

  return useImports;
}

/**
 * 生成变量声明
 * @param {Map} iconMap 图标定义Map
 * @returns {string[]} 变量声明数组
 */
function generateVariables(iconMap) {
  const variables = [];
  iconMap.forEach((value) => {
    variables.push(`${value.varName}: '${value.unicode}';`);
  });
  return variables;
}

/**
 * 生成类结构
 * @param {Map} iconMap 图标定义Map
 * @returns {string[]} 类结构数组
 */
function generateClasses(iconMap) {
  const classes = [];
  iconMap.forEach((value) => {
    classes.push(`
${value.className} {
    &::before {
        content: ${value.varName};
    }
}`);
  });
  return classes;
}

/**
 * 生成字体定义
 * @returns {string} 字体定义
 */
function generateFontFace() {
  return `@font-face {
    font-family: $dc-font-basic-family;
    src: url('#{$dc-font-path}/#{$dc-font-basic-family}.eot');
    src: url('#{$dc-font-path}/#{$dc-font-basic-family}.eot?#iefix') format('embedded-opentype'),
        url('#{$dc-font-path}/#{$dc-font-basic-family}.ttf') format('truetype'),
        url('#{$dc-font-path}/#{$dc-font-basic-family}.woff') format('woff'),
        url('#{$dc-font-path}/#{$dc-font-basic-family}.svg##{$dc-font-basic-family}') format('svg');
    font-weight: normal;
    font-style: normal;
    font-display: block;
}`;
}

/**
 * 生成图标基础样式
 * @returns {string} 基础样式定义
 */
function generateBaseIconStyles() {
  return `[class^='dc-icon-basic-'],
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
}`;
}

/**
 * 从CSS生成完整SCSS
 * @param {string} cssContent CSS内容
 * @returns {Promise<string>} 生成的SCSS内容
 */
async function generateScssFromCss(cssContent) {
  const iconMap = extractIconDefinitions(cssContent);
  const workspaceRoot = getFullPath("");

  // 模块化组装SCSS内容
  const useImports = generateImports(workspaceRoot);
  const variables = generateVariables(iconMap);
  const classes = generateClasses(iconMap);
  const fontFace = generateFontFace();
  const baseStyles = generateBaseIconStyles();

  // 生成完整SCSS内容
  return `${useImports}
$dc-font-basic-family: 'dc-font-basic' !default;
$dc-font-path: '../assets/fonts' !default;
$dc-text-sm: 16px !default;

// ===== 自动生成的图标变量 =====
${variables.join("\n")}

${fontFace}

${baseStyles}

// ===== 自动生成的图标类 =====
${classes.join("\n\n")}
`;
}

module.exports = {
  generateScssFromCss,
};
