// 构建期生成 folia/vendor/smaa.iife.js（SMAA 抗锯齿 pass）：
// three 的 examples 模块（SMAAPass + Pass/FullScreenQuad + SMAAShader）不在 three 核心包的入口依赖图里，
// 现有 vendor/three.iife.js（esbuild 打包核心包）没有它们；这里从钉死版本的 three examples 拉三个文件，
// 去掉 import/export、注入 window.THREE 的符号解构，拼成一个 IIFE：window.FoliaSmaa = { SMAAPass, Pass, FullScreenQuad }。
// 产物入库（发布 zip 整个 folia/ 目录，CI 不跑本脚本）；three 升级时改版本号与哈希后重跑，不要手工编辑产物。
// 下载失败直接让生成失败（产物是入库文件，不能留半成品）；本地调试可用 THREE_SKIP_HASH=1 只打印哈希不校验；
// 网络受限时用 THREE_RAW_BASE 换下载基址（如反向代理），默认 jsDelivr。
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THREE_VERSION = '0.185.1';
const THREE_RAW = (process.env.THREE_RAW_BASE
    || `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`).replace(/\/?$/, '/');

// 顺序就是拼接顺序：Pass/FullScreenQuad 是基类，SMAAShader 提供 GLSL，SMAAPass 最后用前两者
const SOURCES = [
    { file: 'examples/jsm/postprocessing/Pass.js', sha256: '444b409c235ead986893c472e720da1b779a56985c7d10b279c7944b52bd61c5' },
    { file: 'examples/jsm/shaders/SMAAShader.js', sha256: '48ce320a6bf5c33806c4fa13ade7e3ab199f7856838d36b05ae82204db8a1c15' },
    { file: 'examples/jsm/postprocessing/SMAAPass.js', sha256: '1a96804b8cb33ba76a67f9a8e77f2d5e2bf47b1a5c9a8476901aa75e24acb85c' },
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'folia', 'vendor', 'smaa.iife.js');
const SKIP_HASH = ['1', 'on', 'true'].includes(String(process.env.THREE_SKIP_HASH ?? '').toLowerCase());

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** 下载 three examples 的一个文件并核对 sha256；不对就抛错，不用错的源码。 */
async function fetchPinned({ file, sha256: expected }) {
    const response = await fetch(`${THREE_RAW}${file}`, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`下载 ${file} 失败：HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const actual = sha256(buffer);
    if (actual !== expected) {
        if (!SKIP_HASH) throw new Error(`${file} 的 sha256 不对：${actual}（升级 three 时确认新源码后把这个值写回脚本）`);
        console.warn(`[smaa-vendor] ${file} sha256 不符但已跳过校验：${actual}`);
    }
    return buffer.toString('utf8');
}

/**
 * 把 ES module 源码改成 IIFE 内的普通脚本：
 * 去掉 import（three 的符号改为 IIFE 顶部对 window.THREE 的解构）、export 语句与 export 关键字。
 */
function stripModuleSyntax(source) {
    return source
        .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\s*$/gm, '')
        .replace(/^export\s*\{[^}]*\};\s*$/gm, '')
        .replace(/^export\s+(class|const|function)\s/gm, '$1 ');
}

/**
 * three 的 FullScreenQuad.dispose 会销毁模块级共享几何（同一份 _geometry）；
 * 插件里町景运行时销毁重建时会第二次 new SMAAPass，再 dispose 会把这份几何连根拔掉。
 * 与 machi-fx-post.js 自实现 FullScreenQuad（dispose 空操作）的约定一致，产物里改成空实现。
 */
function patchSharedGeometryDispose(passSource) {
    const target = 'this._mesh.geometry.dispose();';
    if (!passSource.includes(target)) {
        throw new Error('Pass.js 里没找到 FullScreenQuad.dispose 的共享几何销毁行，three 升级后需人工核对');
    }
    return passSource.replace(
        target,
        '// 产物补丁：模块级共享几何不销毁（模式重建后仍要复用），同插件自实现 FullScreenQuad 的约定',
    );
}

const HEADER = `/*!
 * three.js r${THREE_VERSION} — examples/jsm/postprocessing/SMAAPass.js + Pass.js + shaders/SMAAShader.js
 * 由 dev/build-smaa-vendor.mjs 从 https://cdn.jsdelivr.net/npm/three@${THREE_VERSION} 生成，不要手工编辑。
 * MIT License, Copyright 2010-2026 three.js authors — https://github.com/mrdoob/three.js
 *
 * 与上游源码的唯一差异：FullScreenQuad.dispose 不销毁模块级共享几何（町景运行时重建后还要复用，
 * 同 machi-fx-post.js 自实现 FullScreenQuad 的约定）。依赖先加载的 vendor/three.iife.js（window.THREE）。
 */
(function () {
  'use strict'
  var THREE = window.THREE
  if (!THREE) throw new Error('smaa.iife.js 需要先加载 vendor/three.iife.js')
  // 上游从 'three' 导入的符号（Pass.js 4 个 + SMAAShader.js 1 个 + SMAAPass.js 7 个）
  var BufferGeometry = THREE.BufferGeometry
  var Float32BufferAttribute = THREE.Float32BufferAttribute
  var OrthographicCamera = THREE.OrthographicCamera
  var Mesh = THREE.Mesh
  var Vector2 = THREE.Vector2
  var HalfFloatType = THREE.HalfFloatType
  var LinearFilter = THREE.LinearFilter
  var NearestFilter = THREE.NearestFilter
  var ShaderMaterial = THREE.ShaderMaterial
  var Texture = THREE.Texture
  var UniformsUtils = THREE.UniformsUtils
  var WebGLRenderTarget = THREE.WebGLRenderTarget

`;

async function main() {
    const texts = [];
    for (const item of SOURCES) {
        process.stdout.write(`[smaa-vendor] 下载 ${item.file} ...\n`);
        texts.push(await fetchPinned(item));
    }
    const [passSource, shaderSource, smaaPassSource] = texts;
    const body = [
        '// ===== three examples/jsm/postprocessing/Pass.js（去掉 import/export） =====',
        stripModuleSyntax(patchSharedGeometryDispose(passSource)),
        '// ===== three examples/jsm/shaders/SMAAShader.js（去掉 import/export） =====',
        stripModuleSyntax(shaderSource),
        '// ===== three examples/jsm/postprocessing/SMAAPass.js（去掉 import/export） =====',
        stripModuleSyntax(smaaPassSource),
    ].join('\n');
    const output = `${HEADER}${body}\n\n  window.FoliaSmaa = { SMAAPass: SMAAPass, Pass: Pass, FullScreenQuad: FullScreenQuad }\n})()\n`;
    // 先写临时文件再改名，写到一半被打断不会留下半个文件
    const temporary = `${OUT_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, output);
    fs.renameSync(temporary, OUT_FILE);
    console.log(`[smaa-vendor] 生成完成：${(Buffer.byteLength(output) / 1024).toFixed(1)} KB → folia/vendor/smaa.iife.js`);
}

main().catch((error) => {
    console.error(`[smaa-vendor] 生成失败：${error?.message ?? error}`);
    process.exit(1);
});
