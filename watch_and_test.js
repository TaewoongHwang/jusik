const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const projectDir = __dirname;
let debounceTimeout = null;
let isRunning = false;

console.log("==================================================");
console.log("👀 [감시 기동] 실시간 파일 수정 감시 및 자동 테스트 서비스 시작");
console.log("👉 .js 및 .html 파일이 변경되면 테스트가 1초 내에 실시간 실행됩니다.");
console.log("==================================================");

// 최초 시작 시 1회 즉시 검사 실행
runTestPipeline();

// 파일 감시 함수
fs.watch(projectDir, { recursive: false }, (eventType, filename) => {
  if (!filename) return;
  if (!filename.endsWith('.js') && !filename.endsWith('.html')) return;
  
  // 제외할 테스트 관련 빌드 스크립트 무시
  if ([
    'run_test_and_deploy.js',
    'syntax_checker.js',
    'test_merge_logic.js',
    'watch_and_test.js',
    'install_git_hooks.js'
  ].includes(filename)) return;

  // 디바운싱 처리 (500ms 동안 추가 수정 발생 시 이전 트리거 취소)
  if (debounceTimeout) clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => {
    if (isRunning) {
      console.log(`\n⏳ 파일 변경 감지됨 (${filename}), 하지만 이전 테스트가 아직 기동 중입니다. 대기합니다...`);
      return;
    }
    console.log(`\n✏️ [변경 감지] ${filename} 파일 수정이 완료되어 자동 무결성 테스트를 전격 기동합니다!`);
    runTestPipeline();
  }, 500);
});

function runTestPipeline() {
  isRunning = true;
  console.log("⚙️  자동 테스트 검증 파이프라인 기동 중...");
  
  exec('node run_test_and_deploy.js --test-only', (err, stdout, stderr) => {
    isRunning = false;
    
    // 로그 보기 좋게 출력
    console.log(stdout);
    
    if (err) {
      console.error(stderr);
      // 청각적 비프음(\x07) 경보 울림!
      process.stdout.write('\x07');
      console.log("\x1b[41m\x1b[37m 🔥 [위험] 수정한 코드에 로직/구문 치명 오류가 감지되었습니다! 위 에러 내용을 보고 즉각 수정하십시오. \x1b[0m\n");
    } else {
      console.log("\x1b[42m\x1b[30m 🎉 [안전] 코드 무결성 테스트를 100% 통과했습니다. 이 상태로 안심하고 개발을 지속하세요! \x1b[0m\n");
    }
    console.log("--------------------------------------------------\n👀 계속 파일 수정을 조용히 감시하고 있습니다. (Ctrl+C를 누르면 감시가 종료됩니다)");
  });
}
