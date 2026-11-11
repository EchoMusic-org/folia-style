// 把 manifest.json 的 version 设成发布 tag 的版本（v 前缀去掉）：发布产物与 tag 恒一致。
// 只改 CI 工作副本（zip 里的 manifest），仓库 HEAD 的 manifest 仍由发布者手动维护。
import fs from 'node:fs';

const version = process.argv[2] ?? '';
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    console.error(`用法：node dev/set-manifest-version.mjs X.Y.Z（收到 "${version}"）`);
    process.exit(1);
}
const file = new URL('../manifest.json', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
if (manifest.version === version) {
    console.log(`manifest.version 已是 ${version}`);
} else {
    manifest.version = version;
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`manifest.version：${manifest.version} → ${version}`);
}
