import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  // 规则已全局关闭的内联 eslint-disable 注释不再报「Unused directive」（第十八轮：
  // 关掉 react-hooks 编译器规则后存量注释全部变“未使用”，103 条噪音淹没真问题）
  linterOptions: {
    reportUnusedDisableDirectives: "off",
  },
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    // react-hooks v7 起「编译器级」规则全家桶（immutability/refs/set-state-in-effect 等）
    // 会对每个文件跑 React Compiler 分析——单个大组件文件（如 wx-app/chat-page 401KB）
    // 可吃掉 1.5GB+ 内存直接被系统 OOM 杀掉，全量 lint 因此跑不完（第十八轮 #8 根因）。
    // 关闭编译器规则，只保留轻量的 rules-of-hooks（纯 AST 线性检查，零额外内存）。
    "react-hooks/purity": "off",
    "react-hooks/static-components": "off",
    "react-hooks/use-memo": "off",
    "react-hooks/preserve-manual-memoization": "off",
    "react-hooks/incompatible-library": "off",
    "react-hooks/immutability": "off",
    "react-hooks/globals": "off",
    "react-hooks/refs": "off",
    "react-hooks/set-state-in-effect": "off",
    "react-hooks/error-boundaries": "off",
    "react-hooks/set-state-in-render": "off",
    "react-hooks/unsupported-syntax": "off",
    "react-hooks/config": "off",
    "react-hooks/gating": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "upload", "tests", "mini-services/**", "download/**", "e2e-tmp/**", "repo-5201314/**", "public/**", "scripts/**", "*.cjs"]
}];

export default eslintConfig;
