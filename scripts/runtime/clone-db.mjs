import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { rootDir } from "./shared.mjs";

export function cloneProductionDatabase({ force = false } = {}) {
  const sourcePath = path.join(rootDir, "data", "fc-support.db");
  const targetPath = path.join(rootDir, "data", "test", "fc-support-test.db");
  if (!existsSync(sourcePath)) throw new Error("운영 DB가 없어 테스트 DB를 복제할 수 없습니다.");
  if (existsSync(targetPath) && !force) return targetPath;
  mkdirSync(path.dirname(targetPath), { recursive: true });
  rmSync(targetPath, { force: true });
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const escaped = targetPath.replaceAll("'", "''");
  source.exec(`VACUUM INTO '${escaped}'`);
  source.close();
  return targetPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(cloneProductionDatabase({ force: process.argv.includes("--force") }));
}
