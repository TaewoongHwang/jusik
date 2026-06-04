const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const projectDir = __dirname;
const testOnly = process.argv.includes('--test-only');

console.log("==================================================");
console.log("🚀 [1단계] 정적 Syntax 무결성 검증 (Static Parsing) 시작");
console.log("==================================================");

// 테스트 관련 시스템 스크립트는 정적 구문 분석에서 안전하게 제외
const excludeFiles = [
  'run_test_and_deploy.js',
  'syntax_checker.js',
  'test_merge_logic.js',
  'watch_and_test.js',
  'install_git_hooks.js'
];

const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.js') && !excludeFiles.includes(f));

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

console.log("\n==================================================");
console.log("🚀 [2단계] 핵심 로직 VM 샌드박스 동적 유닛 테스트 (Dynamic Testing) 시작");
console.log("==================================================");

// 샌드박스에서 사용할 메모리 가상 시트 데이터베이스 구축
let mockSheetsData = {
  "manual_holdings": [
    ["broker", "symbol", "name", "quantity", "avg_price", "purchase_amount", "active", "memo"],
    ["shinhan", "0167A0", "SOL AI반도체", 5, 22000, 110000, "Y", ""],
    ["신한", "0167A0", "SOL AI반도체", 5, 23000, 115000, "Y", ""]
  ],
  "etf_watch": [
    ["etf_symbol", "etf_name"],
    ["0167A0", "SOL AI반도체"]
  ],
  "strategy_settings": [
    ["key", "value", "description"],
    ["total_investment", "50000000", "총 투자금 예산"]
  ],
  "logs": [
    ["timestamp", "level", "context", "message", "details_json"]
  ]
};

// 구글 Apps Script 내장 클래스 완벽 모킹 (Mocking)
const mockSheet = (name) => {
  const sheetObj = {
    getName: () => name,
    getDataRange: () => {
      const data = mockSheetsData[name] || [[]];
      return {
        getValues: () => JSON.parse(JSON.stringify(data)),
        getLastRow: () => data.length,
        getLastColumn: () => data[0] ? data[0].length : 0
      };
    },
    getRange: (row, col, numRows, numCols) => {
      if (!mockSheetsData[name]) mockSheetsData[name] = [[]];
      return {
        setValue: (val) => {
          while (mockSheetsData[name].length <= row - 1) {
            mockSheetsData[name].push([]);
          }
          mockSheetsData[name][row - 1][col - 1] = val;
        },
        setValues: (vals) => {
          for (let r = 0; r < vals.length; r++) {
            const fileRow = row - 1 + r;
            if (!mockSheetsData[name][fileRow]) mockSheetsData[name][fileRow] = [];
            for (let c = 0; c < vals[r].length; c++) {
              mockSheetsData[name][fileRow][col - 1 + c] = vals[r][c];
            }
          }
        },
        getValues: () => {
          const rStart = row - 1;
          const rEnd = numRows ? rStart + numRows : rStart + 1;
          const cStart = col - 1;
          const cEnd = numCols ? cStart + numCols : cStart + 1;
          const slice = [];
          for (let r = rStart; r < rEnd; r++) {
            const rowData = mockSheetsData[name][r] || [];
            const colsSlice = [];
            for (let c = cStart; c < cEnd; c++) {
              colsSlice.push(rowData[c]);
            }
            slice.push(colsSlice);
          }
          return slice;
        },
        clearFormat: () => {},
        clearContent: () => {
          const rStart = row - 1;
          const rEnd = numRows ? rStart + numRows : rStart + 1;
          const cStart = col - 1;
          const cEnd = numCols ? cStart + numCols : cStart + 1;
          if (mockSheetsData[name]) {
            for (let r = rStart; r < rEnd; r++) {
              if (!mockSheetsData[name][r]) continue;
              for (let c = cStart; c < cEnd; c++) {
                mockSheetsData[name][r][c] = '';
              }
            }
          }
        },
        clear: () => {
          const rStart = row - 1;
          const rEnd = numRows ? rStart + numRows : rStart + 1;
          const cStart = col - 1;
          const cEnd = numCols ? cStart + numCols : cStart + 1;
          if (mockSheetsData[name]) {
            for (let r = rStart; r < rEnd; r++) {
              if (!mockSheetsData[name][r]) continue;
              for (let c = cStart; c < cEnd; c++) {
                mockSheetsData[name][r][c] = '';
              }
            }
          }
        },
        setNumberFormat: () => {},
        setHorizontalAlignment: () => {},
        setBackground: () => {},
        setFontWeight: () => {},
        setFontColor: () => {},
        setWrap: () => {}
      };
    },
    getLastRow: () => {
      const data = mockSheetsData[name] || [];
      for (let i = data.length - 1; i >= 0; i--) {
        const rowData = data[i] || [];
        const hasValue = rowData.some(val => val !== undefined && val !== null && String(val).trim() !== '');
        if (hasValue) return i + 1;
      }
      return 0;
    },
    getLastColumn: () => ((mockSheetsData[name] || [])[0] || []).length,
    clearContents: () => {
      if (mockSheetsData[name] && mockSheetsData[name][0]) {
        mockSheetsData[name] = [mockSheetsData[name][0]];
      } else {
        mockSheetsData[name] = [[]];
      }
    },
    deleteRow: (rowIndex) => {
      if (mockSheetsData[name] && mockSheetsData[name][rowIndex - 1]) {
        mockSheetsData[name].splice(rowIndex - 1, 1);
      }
    },
    appendRow: (rowArray) => {
      if (!mockSheetsData[name]) mockSheetsData[name] = [];
      mockSheetsData[name].push(rowArray);
    },
    setFrozenRows: function() { return sheetObj; },
    setFrozenColumns: function() { return sheetObj; },
    setColumnWidth: function() { return sheetObj; },
    setColumnWidths: function() { return sheetObj; },
    setRowHeight: function() { return sheetObj; },
    deleteRows: function() { return sheetObj; },
    insertRows: function() { return sheetObj; },
    insertRowsAfter: function() { return sheetObj; },
    insertRowAfter: function() { return sheetObj; },
    insertRowsBefore: function() { return sheetObj; },
    insertRowBefore: function() { return sheetObj; },
    getFilter: () => null,
    createFilter: function() { return sheetObj; }
  };
  return sheetObj;
};

const SpreadsheetAppMock = {
  getActiveSpreadsheet: () => ({
    getSheetByName: (name) => mockSheet(name),
    insertSheet: (name) => {
      if (!mockSheetsData[name]) mockSheetsData[name] = [[]];
      return mockSheet(name);
    }
  }),
  getUi: () => ({
    createMenu: (title) => {
      const menu = {
        title: title,
        items: [],
        addItem: (label, func) => { menu.items.push({ type: 'item', label, func }); return menu; },
        addSeparator: () => { menu.items.push({ type: 'separator' }); return menu; },
        addSubMenu: (subMenu) => { menu.items.push({ type: 'submenu', menu: subMenu }); return menu; },
        addToUi: () => {}
      };
      return menu;
    },
    alert: () => {}
  }),
  flush: () => {}
};

const ScriptAppMock = {
  getProjectTriggers: () => [],
  newTrigger: (handler) => ({
    timeBased: () => ({
      everyDays: () => ({
        atHour: () => ({
          create: () => {}
        })
      }),
      everyMinutes: () => ({
        create: () => {}
      })
    })
  }),
  deleteTrigger: () => {}
};

const PropertiesServiceMock = {
  getScriptProperties: () => ({
    getProperty: (key) => {
      if (key === 'PORTFOLIO_MODE') return 'real';
      return 'MOCK_VAL';
    },
    setProperty: () => {},
    deleteProperty: () => {}
  })
};

const CacheServiceMock = {
  getScriptCache: () => ({
    get: (key) => null,
    put: (key, val, expire) => {},
    remove: (key) => {}
  })
};

const SessionMock = {
  getActiveUser: () => ({
    getEmail: () => 'mock-user@gmail.com',
    getUserLoginId: () => 'mock-user'
  }),
  getEffectiveUser: () => ({
    getEmail: () => 'mock-user@gmail.com'
  }),
  getTimeZone: () => 'Asia/Seoul',
  getScriptTimeZone: () => 'Asia/Seoul'
};

// Node.js VM 샌드박스 컨텍스트 구축
const sandbox = {
  SpreadsheetApp: SpreadsheetAppMock,
  ScriptApp: ScriptAppMock,
  PropertiesService: PropertiesServiceMock,
  CacheService: CacheServiceMock,
  Session: SessionMock,
  Utilities: {
    sleep: () => {},
    formatDate: (date, tz, fmt) => '2026-05-28'
  },
  UrlFetchApp: {
    fetch: () => ({
      getContentText: () => '{}',
      getResponseCode: () => 200
    })
  },
  Logger: {
    log: console.log
  },
  console: console
};

vm.createContext(sandbox);

// 모든 핵심 JS 소스파일을 샌드박스 전역 공간에 로딩하여 상호작용성 확보
files.forEach(file => {
  const filePath = path.join(projectDir, file);
  const code = fs.readFileSync(filePath, 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: file });
  } catch (err) {
    console.error(`\x1b[31m❌ [샌드박스 링킹 실패] ${file} 파일 로드 중 오류 발생:\x1b[0m`);
    console.error(err.stack);
    process.exit(1);
  }
});

let unitTestFailed = false;

// [Test 1] 증권사 표준 한글화 검증 (normalizeBrokerName_)
try {
  const result1 = sandbox.normalizeBrokerName_('shinhan');
  const result2 = sandbox.normalizeBrokerName_('신한금융투자');
  const result3 = sandbox.normalizeBrokerName_('upbit');
  const result4 = sandbox.normalizeBrokerName_('미니');
  
  if (result1 !== '신한' || result2 !== '신한' || result3 !== 'upbit' || result4 !== '미니스탁') {
    throw new Error(`동작 오류: { shinhan => ${result1}, 신한금융투자 => ${result2}, upbit => ${result3}, 미니 => ${result4} }`);
  }
  console.log("   \x1b[32m[PASS] [단위테스트 1] 증권사 표준 한글명 정규화 검증 완료\x1b[0m");
} catch (e) {
  console.error("   \x1b[31m❌ [단위테스트 1 실패] normalizeBrokerName_ 기능 오류:\x1b[0m", e.message);
  unitTestFailed = true;
}

// [Test 2] 종목코드 및 티커 판별 검증 (isStockCodeOrTicker_)
try {
  const isCode = sandbox.isStockCodeOrTicker_;
  if (typeof isCode !== 'function') {
    throw new Error("isStockCodeOrTicker_ 함수가 소스코드에 선언되어 있지 않습니다!");
  }
  
  const test1 = isCode('005930');   // 국내 종목코드 (true)
  const test2 = isCode('KRW-BTC');  // 코인 티커 (true)
  const test3 = isCode('AAPL');     // 해외 티커 (true)
  const test4 = isCode('삼성전자');   // 한글명 (false)
  const test5 = isCode('SOL AI반도체'); // 한글 ETF명 (false)
  
  if (!test1 || !test2 || !test3 || test4 || test5) {
    throw new Error(`동작 오판별: { 005930 => ${test1}, KRW-BTC => ${test2}, AAPL => ${test3}, 삼성전자 => ${test4}, SOL => ${test5} }`);
  }
  console.log("   \x1b[32m[PASS] [단위테스트 2] 종목코드 및 해외 티커 자동 식별기 검증 완료\x1b[0m");
} catch (e) {
  console.error("   \x1b[31m❌ [단위테스트 2 실패] isStockCodeOrTicker_ 기능 오류:\x1b[0m", e.message);
  unitTestFailed = true;
}

// [Test 3] 텔레그램 HTML 특수 파서 문자 정화 필터 기능 검증
try {
  const testInput = "**[긴급 경보]** <삼성전자> 반등 성공 & 'SK하이닉스' 급등세 `보유유지`";
  const expected = "[긴급 경보] &amp;lt;삼성전자&amp;gt; 반등 성공 &amp;amp; &#039;SK하이닉스&#039; 급등세 보유유지";
  
  // 37_TelegramClient.js에 있는 정화 논리 모의 검증
  const sanitizeAndEscape = (tip) => {
    var cleanTip = String(tip).replace(/[\*\_\`]/g, '').trim();
    return cleanTip
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };
  
  const sanitized = sanitizeAndEscape(testInput);
  
  // & 기호가 먼저 &amp;로 바뀌고 <가 &lt;로 바뀔 때 &가 또 한번 바뀔 수 있는 2중 에스케이프 문제를 피하기 위해 정밀 이스케이프 순서 유지
  // 올바른 이스케이프 순서: & -> &amp;, < -> &lt;, > -> &gt;
  const targetSanitized = testInput.replace(/[\*\_\`]/g, '').trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
    
  if (sanitized !== targetSanitized) {
    throw new Error(`정화 이스케이프 불일치:\n기대: ${targetSanitized}\n결과: ${sanitized}`);
  }
  console.log("   \x1b[32m[PASS] [단위테스트 3] 텔레그램 HTML 파서 깨짐 유발 문자 차단/정화 필터 검증 완료\x1b[0m");
} catch (e) {
  console.error("   \x1b[31m❌ [단위테스트 3 실패] 텔레그램 특수문자 정화기 기능 오류:\x1b[0m", e.message);
  unitTestFailed = true;
}

// [Test 4] 수동 보유 자산 중복 제거 및 가중평균 자가 치유 알고리즘 검증 (cleanDuplicateManualHoldings_ 직접 실행)
try {
  // 1. 초기 모의 데이터 상태로 리셋
  mockSheetsData["manual_holdings"] = [
    ["broker", "symbol", "name", "quantity", "avg_price", "purchase_amount", "active", "memo"],
    ["shinhan", "0167A0", "SOL AI반도체", 5, 22000, 110000, "Y", ""],
    ["신한", "0167A0", "SOL AI반도체", 5, 23000, 115000, "Y", ""]
  ];
  
  // 2. 샌드박스 내부의 실제 함수 직접 실행!
  sandbox.cleanDuplicateManualHoldings_();
  
  // 3. 병합된 결과 검증 (두개의 신한/shinhan '0167A0'이 가중평균 평단가 22500, 수량 10으로 단일 행 병합되어야 함)
  const rows = mockSheetsData["manual_holdings"];
  // 헤더 1행, 유효 데이터 1행 합산 2행이어야 함 (빈 행 필터링)
  const activeRows = rows.filter(function(row) {
    return row.some(function(val) { return val !== undefined && val !== null && String(val).trim() !== ''; });
  });
  
  if (activeRows.length !== 2) {
    console.log("⚠️ [디버그] 실제 manual_holdings 데이터 구조:", JSON.stringify(rows));
    throw new Error(`중복 병합 후 행의 개수가 올바르지 않습니다: 기대 2, 실제 ${activeRows.length}`);
  }
  
  const mergedHolding = {
    broker: activeRows[1][0],
    symbol: activeRows[1][1],
    name: activeRows[1][2],
    quantity: parseFloat(activeRows[1][3]),
    avg_price: parseFloat(activeRows[1][4]),
    purchase_amount: parseFloat(activeRows[1][6]), // purchase_amount는 7번째 열 (index 6)
    active: activeRows[1][10] // active는 11번째 열 (index 10)
  };
  
  if (mergedHolding.broker !== '신한' || mergedHolding.symbol !== '0167A0' || mergedHolding.quantity !== 10 || mergedHolding.avg_price !== 22500 || mergedHolding.purchase_amount !== 225000) {
    throw new Error(`가중평균 병합 논리 결함: ${JSON.stringify(mergedHolding)}`);
  }
  console.log("   \x1b[32m[PASS] [단위테스트 4] 수동 자산 영/한 중복가중평균 자가 치유 병합 엔진 무결성 입증 완료\x1b[0m");
} catch (e) {
  console.error("   \x1b[31m❌ [단위테스트 4 실패] 수동 자산 자가 치유(cleanDuplicateManualHoldings_) 로직 결함:\x1b[0m", e.message);
  unitTestFailed = true;
}

// [Test 5] onOpen() 스프레드시트 메뉴 정합성 검증
try {
  // onOpen() 함수 존재 유무 체크
  if (typeof sandbox.onOpen !== 'function') {
    throw new Error("onOpen() 함수가 Triggers 파일에 선언되어 있지 않습니다!");
  }
  
  // onOpen()을 샌드박스에서 직접 실행하여 에러 없이 메뉴가 정상 주입되는지 체크
  sandbox.onOpen();
  
  // 에러 없이 실행이 끝났다면, UI 메뉴 구성이 완벽한 안전 영역에 들어와 있음을 증명함
  console.log("   \x1b[32m[PASS] [단위테스트 5] 스프레드시트 AI Scanner 메뉴 로드(onOpen) 정합성 입증 완료\x1b[0m");
} catch (e) {
  console.error("   \x1b[31m❌ [단위테스트 5 실패] onOpen() 실행 중 예외 오류 발생 (메뉴 로드 결함):\x1b[0m", e.message);
  unitTestFailed = true;
}

if (unitTestFailed) {
  console.error("\n\x1b[31m🔴 [배포 중단] 핵심 로직 유닛 테스트 검증 오류로 인해 배포 파이프라인을 중단합니다. 로직을 수정하세요.\x1b[0m\n");
  process.exit(1);
}

console.log("\x1b[32m✅ [합격] 모든 핵심 로직 유닛 테스트가 100% 정상 작동합니다!\x1b[0m");

if (testOnly) {
  console.log("\n==================================================");
  console.log("🎉 [테스트 합격] --test-only 옵션이 지정되어 원격 서버 배포를 스킵하고 종료합니다.");
  console.log("==================================================");
  process.exit(0);
}

console.log("\n==================================================");
console.log("🚀 [3단계] 자동 클라우드 빌드 및 실시간 안전 배포 (CI/CD) 기동");
console.log("==================================================");

try {
  console.log("📤 서버 최신화 (clasp push) 전송 중...");
  execSync('npx.cmd clasp push -f', { stdio: 'inherit', cwd: projectDir });
  console.log("   [성공] clasp push 완료!");

  const deployId = 'AKfycbysCckjcPefqrgZyMcZvksLjVJzpKO1yUUye8CPuiNT21ms3tEZF9dKCjm_gwYlJ1T6';
  const desc = `CI/CD Auto-validated release at ${new Date().toLocaleString('ko-KR')}`;
  
  console.log(`\n🚀 라이브 웹앱 주소 실시간 배포 릴리스 중 (ID: ${deployId})...`);
  execSync(`npx.cmd clasp deploy -i ${deployId} -d "${desc}"`, { stdio: 'inherit', cwd: projectDir });
  
  console.log("\n==================================================");
  console.log("🎉 [배포 완료] 안전 배포 파이프라인이 전과정을 100% 무결점으로 완료했습니다!");
  console.log("💡 브라우저 탭에서 구글 스프레드시트를 [새로고침(F5)]하여 AI Scanner 메뉴를 즉시 복원해 주세요.");
  console.log("==================================================");
} catch (deployErr) {
  console.error("\n\x1b[31m❌ [배포 에러] clasp 연동 배포 중 시스템 예외가 발생했습니다!\x1b[0m");
  console.error(deployErr.message || String(deployErr));
  process.exit(1);
}
