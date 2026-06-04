const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectDir = __dirname;
const excludeFiles = [
  'run_test_and_deploy.js',
  'syntax_checker.js',
  'test_merge_logic.js',
  'watch_and_test.js',
  'install_git_hooks.js'
];

console.log("==================================================");
console.log("🚀 [1단계] 정적 Syntax 무결성 검증 (Static Parsing) 시작");
console.log("==================================================");

const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.js') && !excludeFiles.includes(f) && !f.includes('backup'));

let syntaxError = false;
files.forEach(file => {
  const filePath = path.join(projectDir, file);
  const code = fs.readFileSync(filePath, 'utf8');
  try {
    new vm.Script(code);
  } catch (err) {
    syntaxError = true;
    console.error(`\x1b[31m❌ [문법 오류 발견] ${file} 파일에 신택스 에러가 존재합니다!\x1b[0m`);
    console.error(err.stack);
  }
});

if (syntaxError) {
  console.error("\n\x1b[31m🔴 [배포 중단] 소스코드에 문법적 치명 오류가 발견되어 배포 파이프라인을 긴급 중단(Abort)합니다. 소스코드를 수정하세요.\x1b[0m\n");
  process.exit(1);
}

console.log("\x1b[32m✅ [합격] 모든 Apps Script 파일에 문법적 오류가 전혀 없음을 확인했습니다!\x1b[0m");
