// 构建期生成雾笺的笔顺数据 folia/assets/nebbia-strokes.json（移植自 folia-major dev/nebbia/nebbiaStrokesPlugin.mjs）：
// 从钉死 commit 的 AnimCJK 下载 graphics 数据，抽出每个字的笔画中线，输出到 folia/assets/。
// 授权：graphics 数据是 Arphic Public License（不是 MIT），许可文本静态随附在 folia/assets/licenses/nebbia-strokes/，
// 本脚本只生成 JSON（顶层带 ' notice' 键，APL 第 2(a) 条的修改声明），并在产出后校验许可文本在位。
// 下载失败直接让构建失败（插件发布必须带完整笔顺）；本地调试可用 FOLIA_NEBBIA_STROKES=off 跳过；
// 网络受限时用 ANIMCJK_RAW_BASE 换下载基址（如反向代理），默认官方 raw 地址。
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ANIMCJK_COMMIT = '99dba566b92daf45ae20d05e6c91d3f68d8619f2';
const ANIMCJK_RAW = (process.env.ANIMCJK_RAW_BASE
    || `https://raw.githubusercontent.com/parsimonhi/animCJK/${ANIMCJK_COMMIT}`).replace(/\/?$/, '/');

// 顺序就是优先级：假名 → 简体中文 → 日文汉字（中文按简体笔顺，日文独有的字形再用日文数据补）
const GRAPHICS = [
    { file: 'graphicsJaKana.txt', sha256: '3f61aee523e2cf95e76240b760234a1c6c437d4e9308dca88723178dd8bdb61c' },
    { file: 'graphicsZhHans.txt', sha256: '3bb2150fe12edc7d82e18df0044c3e942aca6b8f399f8fd17aa0eee5197cbd62' },
    { file: 'graphicsJa.txt', sha256: '3b2d95465152fb2a7e108774219e969c43af14f1e51e66498bc96522a674cfeb' },
];

// 静态随附的许可文本（提交在 folia/assets/licenses/nebbia-strokes/），生成后校验在位
const LICENSE_DIR = path.join('folia', 'assets', 'licenses', 'nebbia-strokes');
const LICENSE_FILES = ['NOTICE.txt', 'COPYING.txt', 'ARPHICPL.TXT'];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'folia', 'assets', 'nebbia-strokes.json');

// 写进 JSON 顶层的修改声明（' notice' 键，运行时按单个字查询碰不到它）；APL 第 2(a) 条要求注明改动与时间
const CHANGE_NOTICE = 'Modified on 2026-11-12 by the EchoMusic folia-style project from AnimCJK '
    + `<https://github.com/parsimonhi/animCJK> commit ${ANIMCJK_COMMIT} (graphicsJaKana.txt, graphicsZhHans.txt, graphicsJa.txt): `
    + 'only the "medians" of each character are kept, outlines and other fields are dropped; y is flipped to point down '
    + "(y' = 900 - y, a 1024 grid); strokes outside the grid (kana animation helpers) are removed; a character in more than "
    + 'one file is taken from the first of them in the order above. Distributed under the Arphic Public License, see '
    + 'licenses/nebbia-strokes/ARPHICPL.TXT and COPYING.txt.';

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** 下载 AnimCJK 的一个文件并核对 sha256；不对就抛错，不用错的数据。 */
async function fetchPinned({ file, sha256: expected }) {
    const response = await fetch(`${ANIMCJK_RAW}${file}`, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`下载 ${file} 失败：HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (sha256(buffer) !== expected) throw new Error(`${file} 的 sha256 不对：${sha256(buffer)}`);
    return buffer;
}

/**
 * 把 graphics 文件（每行一个字的 JSON）合成 { 字: 笔画中线[] }。
 * @param {string[]} graphicsTexts
 * @returns {Record<string, [number, number][][]>}
 */
function buildStrokeData(graphicsTexts) {
    /** @type {Record<string, [number, number][][]>} */
    const out = {};
    for (const text of graphicsTexts) {
        for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            const entry = JSON.parse(line);
            if (out[entry.character]) continue;
            // 假名数据里有落在 1024 方格外的辅助笔画（动画裁切用），丢掉
            out[entry.character] = entry.medians
                .map(median => median.map(([x, y]) => [x, 900 - y]))
                .filter(median => median.every(([x, y]) => x > -20 && x < 1044 && y > -20 && y < 1044));
        }
    }
    return out;
}

async function main() {
    if (['off', '0', 'false'].includes(String(process.env.FOLIA_NEBBIA_STROKES ?? '').toLowerCase())) {
        console.log('[nebbia-strokes] FOLIA_NEBBIA_STROKES=off，跳过（雾笺会退回字体骨架追踪）');
        return;
    }
    for (const file of LICENSE_FILES) {
        if (!fs.existsSync(path.join(ROOT, LICENSE_DIR, file))) {
            throw new Error(`许可文本缺失：${LICENSE_DIR}/${file}（APL 要求随数据分发，不能只发 JSON）`);
        }
    }
    const graphics = [];
    for (const item of GRAPHICS) {
        process.stdout.write(`[nebbia-strokes] 下载 ${item.file} ...\n`);
        graphics.push((await fetchPinned(item)).toString('utf8'));
    }
    const strokes = buildStrokeData(graphics);
    const json = Buffer.from(JSON.stringify({ ' notice': CHANGE_NOTICE, ...strokes }));
    // 先写临时文件再改名，写到一半被打断不会留下半个文件
    const temporary = `${OUT_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, json);
    fs.renameSync(temporary, OUT_FILE);
    console.log(`[nebbia-strokes] 生成完成：${Object.keys(strokes).length} 字，${(json.length / 1048576).toFixed(1)} MB → folia/assets/nebbia-strokes.json`);
}

main().catch((error) => {
    console.error(`[nebbia-strokes] 生成失败：${error?.message ?? error}`);
    process.exit(1);
});
