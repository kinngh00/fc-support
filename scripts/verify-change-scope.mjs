import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scopePath = path.join(root, ".codex", "change-scope.local.json");
const mode = process.argv.includes("--staged") ? "staged" : process.argv.includes("--release") ? "release" : "working";
const ignoredScopePath = ".codex/change-scope.local.json";
const alwaysProtected = [".env", "data/", "node_modules/", ".git/"];

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function normalize(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function splitNull(value) {
  return value ? value.split("\0").map(normalize).filter(Boolean) : [];
}

function changedFiles() {
  if (mode === "staged") return splitNull(git(["diff", "--cached", "--name-only", "--diff-filter=ACMRD", "-z"]));
  const tracked = new Set([
    ...splitNull(git(["diff", "--name-only", "--diff-filter=ACMRD", "-z"])),
    ...splitNull(git(["diff", "--cached", "--name-only", "--diff-filter=ACMRD", "-z"])),
  ]);
  splitNull(git(["ls-files", "--others", "--exclude-standard", "-z"])).forEach((file) => tracked.add(file));
  return [...tracked];
}

function fail(message, details = []) {
  console.error(`\n[변경 범위 검사 실패] ${message}`);
  details.forEach((detail) => console.error(`- ${detail}`));
  console.error("\n요청 범위를 넓히지 말고 .codex/change-scope.local.json을 현재 사용자 요청에 맞게 작성하십시오.\n");
  process.exit(1);
}

const files = changedFiles().filter((file) => file !== ignoredScopePath);
if (files.length === 0) {
  console.log("변경 범위 검사 통과: 검사할 변경사항이 없습니다.");
  process.exit(0);
}

if (!existsSync(scopePath)) fail("변경사항이 있지만 로컬 변경 범위 선언이 없습니다.", files);

let scope;
try {
  scope = JSON.parse(readFileSync(scopePath, "utf8"));
} catch (error) {
  fail("변경 범위 선언 JSON을 읽을 수 없습니다.", [String(error?.message || error)]);
}

if (typeof scope.task !== "string" || scope.task.trim().length < 10) fail("task에 현재 사용자 요청을 구체적으로 적어야 합니다.");
if (!Array.isArray(scope.userInstructions) || scope.userInstructions.length === 0 || scope.userInstructions.some((item) => typeof item !== "string" || item.trim().length < 3)) {
  fail("userInstructions에 사용자의 지시 문장을 빠짐없이 기록해야 합니다.");
}
if (!Array.isArray(scope.requirements) || scope.requirements.length < scope.userInstructions.length) {
  fail("requirements는 userInstructions의 각 지시를 최소 하나씩 독립적으로 포함해야 합니다.");
}
const requirementIds = new Set();
for (const requirement of scope.requirements) {
  if (!requirement || typeof requirement !== "object" || !/^R\d+$/.test(requirement.id || "")) fail("각 requirement에는 R1 형식의 ID가 필요합니다.");
  if (requirementIds.has(requirement.id)) fail("requirement ID는 중복될 수 없습니다.", [requirement.id]);
  requirementIds.add(requirement.id);
  if (typeof requirement.instruction !== "string" || requirement.instruction.trim().length < 5) fail(`${requirement.id}의 instruction이 구체적이지 않습니다.`);
  if (typeof requirement.implementation !== "string" || requirement.implementation.trim().length < 10) fail(`${requirement.id}의 implementation이 구체적이지 않습니다.`);
  if (!["pending", "passed"].includes(requirement.status)) fail(`${requirement.id}의 status는 pending 또는 passed여야 합니다.`);
  if (!Array.isArray(requirement.evidence)) fail(`${requirement.id}의 evidence는 배열이어야 합니다.`);
}
if (!Array.isArray(scope.assumptions)) fail("assumptions를 배열로 명시해야 합니다.");
if ((mode === "staged" || mode === "release") && scope.assumptions.length > 0) fail("자의적 가정이 포함된 변경은 커밋하거나 배포할 수 없습니다.", scope.assumptions.map(String));
if (!Array.isArray(scope.allowedFiles) || scope.allowedFiles.length === 0) fail("allowedFiles는 비어 있을 수 없습니다.");

const allowed = scope.allowedFiles.map(normalize);
const invalidAllowed = allowed.filter((file) => !file || file === "." || file.endsWith("/") || /[*?\[\]]/.test(file) || path.isAbsolute(file));
if (invalidAllowed.length) fail("allowedFiles에는 와일드카드나 디렉터리 전체를 사용할 수 없습니다.", invalidAllowed);
if (new Set(allowed).size !== allowed.length) fail("allowedFiles에 중복 경로가 있습니다.");

const protectedChanges = files.filter((file) => alwaysProtected.some((entry) => file === entry || file.startsWith(entry)));
if (protectedChanges.length) fail("비밀정보 또는 로컬 데이터 경로는 변경할 수 없습니다.", protectedChanges);

const outside = files.filter((file) => !allowed.includes(file));
if (outside.length) fail("현재 요청에서 허용되지 않은 파일이 변경됐습니다.", outside);

if (!scope.allowedRegions || typeof scope.allowedRegions !== "object") fail("allowedRegions가 필요합니다.");
const missingRegions = allowed.filter((file) => !Array.isArray(scope.allowedRegions[file]) || scope.allowedRegions[file].length === 0 || scope.allowedRegions[file].some((item) => typeof item !== "string" || item.trim().length < 3));
if (missingRegions.length) fail("모든 허용 파일에 구체적인 변경 영역을 적어야 합니다.", missingRegions);

if (!scope.changeMap || typeof scope.changeMap !== "object") fail("changeMap이 필요합니다.");
const missingChangeMap = allowed.filter((file) => !Array.isArray(scope.changeMap[file]) || scope.changeMap[file].length === 0);
if (missingChangeMap.length) fail("모든 허용 파일을 changeMap의 요구사항 ID와 연결해야 합니다.", missingChangeMap);
const referencedRequirements = new Set();
for (const [file, mappings] of Object.entries(scope.changeMap)) {
  if (!allowed.includes(normalize(file))) fail("changeMap에 허용되지 않은 파일이 포함됐습니다.", [file]);
  for (const mapping of mappings) {
    if (!mapping || typeof mapping.region !== "string" || mapping.region.trim().length < 3) fail(`${file}의 changeMap region이 구체적이지 않습니다.`);
    if (!Array.isArray(mapping.requirementIds) || mapping.requirementIds.length === 0) fail(`${file}의 변경 영역에 requirement ID가 없습니다.`);
    for (const id of mapping.requirementIds) {
      if (!requirementIds.has(id)) fail(`${file}의 changeMap에 존재하지 않는 requirement ID가 있습니다.`, [String(id)]);
      referencedRequirements.add(id);
    }
  }
}
const unmappedRequirements = [...requirementIds].filter((id) => !referencedRequirements.has(id));
if (unmappedRequirements.length) fail("변경 영역과 연결되지 않은 requirement가 있습니다.", unmappedRequirements);

if (mode === "staged" || mode === "release") {
  const incomplete = scope.requirements.filter((requirement) => requirement.status !== "passed" || requirement.evidence.length === 0 || requirement.evidence.some((item) => typeof item !== "string" || item.trim().length < 3));
  if (incomplete.length) fail("구현 또는 검증이 완료되지 않은 requirement가 있습니다.", incomplete.map((requirement) => requirement.id));
}

if (typeof scope.visualChange !== "boolean") fail("visualChange를 true 또는 false로 명시해야 합니다.");
if (scope.visualChange && (mode === "staged" || mode === "release")) {
  const verification = scope.visualVerification;
  if (!verification || verification.status !== "passed") fail("UI 변경의 실제 화면 검증이 완료되지 않았습니다.");
  if (!Array.isArray(verification.requiredViewports) || !verification.requiredViewports.includes("desktop") || !verification.requiredViewports.includes("mobile")) {
    fail("UI 변경은 desktop과 mobile 화면을 모두 검증해야 합니다.");
  }
  if (!Array.isArray(verification.evidence) || verification.evidence.length < 2) fail("UI 변경의 데스크톱·모바일 검증 근거가 필요합니다.");
}

console.log(`변경 범위 검사 통과: ${files.length}개 파일이 현재 요청의 허용 범위와 일치합니다.`);
