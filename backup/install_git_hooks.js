const fs = require('fs');
const path = require('path');

const projectDir = __dirname;
const gitHooksDir = path.join(projectDir, '.git', 'hooks');

console.log("==================================================");
console.log("🛠️  [Git Hooks 설치] 코드 수정 전 무결성 자동화 가드 장착 시작");
console.log("==================================================");

if (!fs.existsSync(path.join(projectDir, '.git'))) {
  console.error("❌ [설치 실패] 이 폴더는 Git 저장소가 아닙니다. .git 폴더를 찾을 수 없습니다.");
  process.exit(1);
}

if (!fs.existsSync(gitHooksDir)) {
  fs.mkdirSync(gitHooksDir, { recursive: true });
}

// pre-commit 훅 스크립트 템플릿
const preCommitScript = `#!/bin/sh
# Git pre-commit hook to validate syntax & unit tests before commit

echo ""
echo "🚀 \x1b[35m[Git Hook] 커밋 전 강제 무결성 검증 (Static & Sandbox Unit Tests) 기동 중...\x1b[0m"
echo "--------------------------------------------------"

node run_test_and_deploy.js --test-only
RESULT=$?

if [ $RESULT -ne 0 ]; then
  echo ""
  echo "❌ \x1b[41m\x1b[37m [커밋 반려] 소스코드에 치명적 문법/로직 오류가 잔존하여 커밋이 강제 차단되었습니다! \x1b[0m"
  echo "👉 에러 메시지를 확인하여 수정하신 뒤 다시 커밋을 시도하세요."
  echo ""
  exit 1
fi

echo ""
echo "✅ \x1b[42m\x1b[30m [안전성 통과] 모든 유닛 테스트가 100% 무결하여 커밋을 승인합니다. \x1b[0m"
echo ""
exit 0
`;

const preCommitPath = path.join(gitHooksDir, 'pre-commit');

try {
  // pre-commit 훅 쓰기
  fs.writeFileSync(preCommitPath, preCommitScript, { encoding: 'utf8', mode: 0o755 });
  
  // 윈도우 환경 외에 맥/리눅스에서도 대비한 파일 권한 설정 시도
  try {
    fs.chmodSync(preCommitPath, '755');
  } catch(e) {}

  console.log("\x1b[32m✅ [장착 완료] pre-commit Git Hook이 완벽히 설치되었습니다!\x1b[0m");
  console.log("👉 앞으로 코드를 수정하고 'git commit' 시도 시 배후에서 자동 무결성 테스트가 강제 작동합니다.");
  console.log("👉 에러가 존재하면 커밋이 원천적으로 차단되어, 오류가 라이브 서버에 올라가는 불상사를 100% 원천 예방합니다.");
  console.log("==================================================");
} catch (err) {
  console.error("❌ [설치 실패] Git Hook 스크립트 쓰기 중 예외가 발생했습니다:");
  console.error(err.message || String(err));
  process.exit(1);
}
