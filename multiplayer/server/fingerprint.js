/** 静态发布和服务端共享指纹算法，防止客户端/服务端运行不同版本。 */
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
export async function rulesFingerprint() {
  const hash = createHash('sha256');
  // 资料的 version 字段长期固定，不能只用它检查客户端是否运行同一套规则。
  // 整个实际规则文件与联机适配都参与指纹；重建原仓库后无需人工更改版本号。
  for (const dir of ['dist', 'multiplayer/client', 'multiplayer/shared', 'multiplayer/generated']) {
    for (const name of (await readdir(path.join(ROOT, dir))).sort()) {
      if (!name.endsWith('.js') || name.endsWith('.bundle.js') || name.endsWith('.generated.js')) continue;
      hash.update(`${dir}/${name}\n`); hash.update(await readFile(path.join(ROOT, dir, name)));
    }
  }
  return hash.digest('hex');
}
