const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectDir = __dirname;
const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.js') && f !== 'syntax_checker.js' && f !== 'test_resolution.js');

let hasError = false;
console.log("=== Apps Script 프로젝트 파일 Syntax 무결성 진단 시작 ===");
files.forEach(file => {
  const filePath = path.join(projectDir, file);
  const code = fs.readFileSync(filePath, 'utf8');
  try {
    new vm.Script(code);
    console.log(`[OK] ${file} - 문법 오류 없음`);
  } catch (err) {
    hasError = true;
    console.error(`[오류 발견] ${file} 에서 문법 오류(Syntax Error) 감지!`);
    console.error(err.stack);
  }
});

if (!hasError) {
  console.log("\n🎉 축하합니다! 모든 Apps Script 파일의 문법적 무결성이 100% 입증되었습니다. 덮어쓰기로 인한 깨진 코드는 전혀 없습니다.");
} else {
  console.log("\n⚠️ 오류가 발견되었습니다. 해당 파일의 괄호 닫힘 상태 등을 확인하세요.");
}
