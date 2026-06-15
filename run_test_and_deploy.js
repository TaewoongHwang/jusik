const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const projectDir = __dirname;
const testOnly = process.argv.includes('--test-only');

console.log("==================================================");
console.log("🚀 [1단계] 정적 Syntax 무결성 검증 (Static Parsing) 시작");
console.log("==================================================");

const excludeFiles = [
  'run_test_and_deploy.js',
  'syntax_checker.js',
  'test_merge_logic.js',
  'watch_and_test.js',
  'install_git_hooks.js',
  'sw.js'
];

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

const htmlFiles = fs.readdirSync(projectDir).filter(f => f.endsWith('.html'));
htmlFiles.forEach(file => {
  const filePath = path.join(projectDir, file);
  const html = fs.readFileSync(filePath, 'utf8');
  const scriptRegex = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptIndex = 0;
  while ((match = scriptRegex.exec(html)) !== null) {
    const code = match[1];
    if (!code.trim()) continue;
    scriptIndex += 1;
    try {
      new vm.Script(code, { filename: `${file}#inline-script-${scriptIndex}` });
    } catch (err) {
      syntaxError = true;
      console.error(`\x1b[31m❌ [HTML 스크립트 문법 오류] ${file} 인라인 스크립트 ${scriptIndex}\x1b[0m`);
      console.error(err.stack);
    }
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

// VM 샌드박스 가상 데이터베이스 구축
let mockSheetsData = {
  "manual_holdings": [
    ["broker", "symbol", "name", "quantity", "avg_price", "active", "memo"],
    ["shinhan", "0167A0", "SOL AI반도체", 5, 22000, "Y", ""],
    ["신한", "0167A0", "SOL AI반도체", 5, 23000, "Y", ""]
  ],
  "settings": [
    ["key", "value", "description", "updated_at"]
  ],
  "logs": [
    ["timestamp", "level", "module", "message", "details"]
  ]
};

// Google Apps Script 내장 객체 모킹
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
        }
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
    setFrozenRows: function() { return sheetObj; }
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
    alert: () => {}
  }),
  flush: () => {}
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

const UtilitiesMock = {
  formatDate: (date, tz, format) => {
    const d = new Date(date);
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${dy}`;
  },
  sleep: (ms) => {}
};

const LockServiceMock = {
  getScriptLock: () => ({
    tryLock: (timeout) => true,
    releaseLock: () => {}
  })
};

const HtmlServiceMock = {
  createHtmlOutput: (contents) => ({
    getContentText: () => contents
  })
};

// 샌드박스 콘텍스트 생성
const sandbox = {
  HtmlService: HtmlServiceMock,
  console: console,
  SpreadsheetApp: SpreadsheetAppMock,
  PropertiesService: PropertiesServiceMock,
  CacheService: CacheServiceMock,
  Utilities: UtilitiesMock,
  LockService: LockServiceMock,
  Session: { getScriptTimeZone: () => "Asia/Seoul" },
  UrlFetchApp: {
    _lastPayload: null,
    fetch: function(url, options) {
      if (options && options.payload) {
        try {
          this._lastPayload = JSON.parse(options.payload);
        } catch(e) {
          this._lastPayload = options.payload;
        }
      }
      if (url.indexOf('finance.yahoo.com') >= 0) {
        var mockCloses = [];
        for (var i = 0; i < 25; i++) {
          mockCloses.push(100 + i);
        }
        var chartData = {
          chart: {
            result: [{
              meta: { regularMarketPrice: 124, chartPreviousClose: 100 },
              indicators: {
                quote: [{
                  close: mockCloses
                }]
              }
            }]
          }
        };
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify(chartData)
        };
      }
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ access_token: "MOCK_TOKEN", expires_in: 7200 })
      };
    }
  }
};

vm.createContext(sandbox);

// 샌드박스에 소스 파일 적재 및 구동
files.forEach(file => {
  const filePath = path.join(projectDir, file);
  const code = fs.readFileSync(filePath, 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
});

// 동적 로직 단위 테스트 수행
try {
  // [단위테스트 1] 기본 주소 정규화 및 브로커 치유 검증
  const cleanBroker = sandbox.normalizeBrokerName_('shinhan');
  const cleanBroker2 = sandbox.normalizeBrokerName_('신한금융');
  if (cleanBroker === '신한' && cleanBroker2 === '신한') {
    console.log("   [PASS] [단위테스트 1] 증권사 표준 한글명 정규화 검증 완료");
  } else {
    throw new Error('Broker normalization failed: ' + cleanBroker + ', ' + cleanBroker2);
  }

  // [단위테스트 2] 종목코드 식별기 검증
  const cleanSym = sandbox.normalizeStockSymbol_('  0167a0 ');
  if (cleanSym === '0167A0') {
    console.log("   [PASS] [단위테스트 2] 종목코드 대문자 정규화 검증 완료");
  } else {
    throw new Error('Stock symbol normalization failed');
  }

  // [단위테스트 3] 수동 자산 영/한 중복가중평균 자가 치유 병합 엔진 무결성 입증
  sandbox.cleanDuplicateManualHoldings_();
  const mergedRows = mockSheetsData["manual_holdings"];
  // shinhan 0167A0 (수량 5, 평단 22000) 와 신한 0167A0 (수량 5, 평단 23000) 이
  // [신한]의 [0167A0] 종목 수량 10, 평단 22500 으로 병합되어야 함
  const mergedHolding = mockSheetsData["manual_holdings"][1]; // 첫 행은 헤더, 두 번째 행이 데이터
  if (mergedHolding && mergedHolding[0] === '신한' && mergedHolding[1] === '0167A0' && mergedHolding[3] === 10 && mergedHolding[4] === 22500) {
    console.log("   [PASS] [단위테스트 3] 수동 자산 영/한 중복가중평균 자가 치유 병합 엔진 무결성 입증 완료");
  } else {
    throw new Error('Manual holdings bulk weighted average merging failed: ' + JSON.stringify(mergedHolding));
  }

  // [단위테스트 4] KIS 토큰 발급 페이로드 검증 (AppSecret 오타 방지벽)
  sandbox.UrlFetchApp._lastPayload = null; // 초기화
  sandbox.getKisAccessToken_(); // 토큰 발급 강제 기동
  const tokenPayload = sandbox.UrlFetchApp._lastPayload;
  if (tokenPayload && tokenPayload.appsecret && !tokenPayload.secretkey) {
    console.log("   [PASS] [단위테스트 4] KIS 토큰 발급 페이로드 규격(appsecret) 무결성 검증 완료");
  } else {
    throw new Error('KIS token payload verification failed! Missing appsecret or using secretkey: ' + JSON.stringify(tokenPayload));
  }

  // [단위테스트 5] 날짜 타임존 정규화 검증 (중복 적재 방지벽)
  const normalizedIsoDate = sandbox.normalizeDateValue_('2026-05-29T15:00:00.000Z');
  if (normalizedIsoDate === '2026-05-30') {
    console.log("   [PASS] [단위테스트 5] ISO 날짜 타임존(GMT+9) 세이프 정규화 검증 완료");
  } else {
    throw new Error('Timezone-safe date normalization failed! Expected 2026-05-30 but got: ' + normalizedIsoDate);
  }

  // [단위테스트 6] 퀀트 팩터 채점 공식 및 계산 무결성 검증
  // 1) 정상 케이스 검증
  const mockScoredStocks = [
    {
      symbol: '005930',
      name: '삼성전자',
      price: 70000,
      per: 16.67,
      pbr: 1.25,
      per_val: 16.67,
      pbr_val: 1.25,
      rsi: 55,
      srim_price: 77000,
      safety_margin: 9.1,
      quant_score: 85
    }
  ];
  const validRes = sandbox.validateQuantFactors_(mockScoredStocks);
  if (!validRes.success) {
    throw new Error('Valid stocks failed validation check: ' + validRes.message);
  }

  // 2) 비정상 케이스 감지 검증 (음수 가격, RSI 오버 등 이상 감지)
  const mockAnomalyStocks = [
    {
      symbol: '000660',
      name: 'SK하이닉스',
      price: -100,
      per: 'N/A',
      pbr: 1.5,
      per_val: 9999,
      pbr_val: 1.5,
      rsi: 120,
      srim_price: 150000,
      safety_margin: 100.1,
      quant_score: 95
    }
  ];
  const invalidRes = sandbox.validateQuantFactors_(mockAnomalyStocks);
  if (invalidRes.success || invalidRes.anomalies.length === 0) {
    throw new Error('Validation failed to detect anomalies!');
  }
  console.log("   [PASS] [단위테스트 6] 퀀트 팩터 무결성 이상치 검증기 정상 동작 입증 완료");
  
  // [단위테스트 7] 기술적 지표 및 볼린저 밴드 자가연산 무결성 검증
  const techInd = sandbox.calculate50DayMomentumAndRSI_('005930');
  if (techInd.sma5 === 122 && techInd.sma20 === 114.5 && techInd.bollinger_upper > 0 && techInd.bollinger_lower > 0 && techInd.technical_signal) {
    console.log("   [PASS] [단위테스트 7] 기술적 지표 및 볼린저 밴드 자가연산 무결성 검증 완료");
  } else {
    throw new Error('Technical indicators unit test failed! Obtained: ' + JSON.stringify(techInd));
  }

  // [단위테스트 8] 계좌번호 및 상품코드 스마트 정제 엔진 검증
  const testCases = [
    { cano: "12345678-03", prdt: "", expectedCano: "12345678", expectedPrdt: "03" },
    { cano: "1234567803", prdt: "", expectedCano: "12345678", expectedPrdt: "03" },
    { cano: "12345678", prdt: "3", expectedCano: "12345678", expectedPrdt: "03" },
    { cano: " 12345678 - 03 \n", prdt: "03", expectedCano: "12345678", expectedPrdt: "03" },
    { cano: "12345678", prdt: "03", expectedCano: "12345678", expectedPrdt: "03" }
  ];
  
  testCases.forEach((tc, index) => {
    const res = sandbox.cleanAndExtractKisAccount_(tc.cano, tc.prdt);
    if (res.cano !== tc.expectedCano || res.productCode !== tc.expectedPrdt) {
      throw new Error(`Sanitization Unit Test failed at case ${index + 1}: input(${tc.cano}, ${tc.prdt}) -> expected(${tc.expectedCano}, ${tc.expectedPrdt}) but got(${res.cano}, ${res.productCode})`);
    }
  });
  console.log("   [PASS] [단위테스트 8] 계좌번호 및 상품코드 스마트 정제 엔진(Sanitizer) 검증 완료");

  // [단위테스트 9] 화면 모드가 REAL이어도 강제 MOCK 실행 모드가 주문 계층까지 전달되는지 검증
  const originalExecuteMockOrder = sandbox.executeMockOrder_;
  let forcedMockCall = null;
  sandbox.executeMockOrder_ = function(symbol, actionType, qty, customPrice, isAutoRebal) {
    forcedMockCall = { symbol, actionType, qty, customPrice, isAutoRebal };
    return { success: true, orderNo: 'MOCK-ORDER' };
  };
  const forcedMockResult = sandbox.executePaperOrder_('SPY', 'BUY', 2, 0, true, 'mock');
  sandbox.executeMockOrder_ = originalExecuteMockOrder;
  if (!forcedMockResult.success || !forcedMockCall || forcedMockCall.symbol !== 'SPY' || forcedMockCall.isAutoRebal !== true) {
    throw new Error('Forced MOCK execution mode was not propagated to the order layer.');
  }
  console.log("   [PASS] [단위테스트 9] 강제 MOCK 주문 모드 전달 및 REAL 화면 모드 격리 검증 완료");

  // [단위테스트 10] 모의 주문 취소 요청에 모의 계좌번호/상품코드가 포함되는지 검증
  const originalKisPost = sandbox.kisPost_;
  let cancelPayload = null;
  sandbox.kisPost_ = function(path, payload) {
    cancelPayload = payload;
    return { rt_cd: '0', output: { ODNO: 'CANCEL-ORDER' }, msg1: 'OK' };
  };
  const cancelResult = sandbox.cancelOrModifyDomesticOrder_(
    '12345',
    '12345',
    '02',
    1,
    0,
    {
      appKey: 'MOCK_KEY',
      appSecret: 'MOCK_SECRET',
      baseUrl: 'https://openapivts.koreainvestment.com:29443',
      cano: '87654321',
      productCode: '03'
    }
  );
  sandbox.kisPost_ = originalKisPost;
  if (!cancelResult.success || !cancelPayload || cancelPayload.CANO !== '87654321' || cancelPayload.ACNT_PRDT_CD !== '03') {
    throw new Error('Mock cancellation account routing failed: ' + JSON.stringify(cancelPayload));
  }
  console.log("   [PASS] [단위테스트 10] 워치독 모의계좌 취소 라우팅 검증 완료");

  // [단위테스트 11] 워치독이 실계좌 주문을 절대 조회/취소하지 않는지 검증
  let realOrderTouched = false;
  const originalGetAccount = sandbox.getKisAccountConfig_;
  const originalFetchDomesticNccld = sandbox.fetchKisDomesticNccldOrders_;
  sandbox.getKisAccountConfig_ = function() {
    return { cano: 'REAL', accountProductCode: '01', mockCano: 'MOCK', mockProductCode: '01' };
  };
  sandbox.fetchKisDomesticNccldOrders_ = function() {
    realOrderTouched = true;
    return [];
  };
  sandbox.checkAndResolveUnfilledOrders([{
    symbol: '005930',
    name: '테스트',
    action_type: 'BUY',
    order_no: 'REAL-ORDER',
    quantity: 1,
    is_mock: false
  }]);
  sandbox.getKisAccountConfig_ = originalGetAccount;
  sandbox.fetchKisDomesticNccldOrders_ = originalFetchDomesticNccld;
  if (realOrderTouched) {
    throw new Error('Watchdog attempted to access a REAL account order.');
  }
  console.log("   [PASS] [단위테스트 11] 워치독 실계좌 주문 차단 검증 완료");

  // [단위테스트 12] 공개 대시보드 쓰기 API가 ADMIN_TOKEN 없이는 실행되지 않는지 검증
  let unauthorizedWriteBlocked = false;
  try {
    sandbox.toggleInvestmentModeFromWeb('MOCK', 'WRONG_TOKEN');
  } catch (e) {
    unauthorizedWriteBlocked = true;
  }
  if (!unauthorizedWriteBlocked) {
    throw new Error('Dashboard write API accepted an invalid ADMIN_TOKEN.');
  }
  const authorizedModeChange = sandbox.toggleInvestmentModeFromWeb('MOCK', 'MOCK_VAL');
  if (!authorizedModeChange || authorizedModeChange.mode !== 'MOCK') {
    throw new Error('Dashboard write API rejected the configured ADMIN_TOKEN.');
  }
  console.log("   [PASS] [단위테스트 12] 대시보드 쓰기 API 관리자 토큰 차단 검증 완료");

    // [단위테스트 13] 텔레그램 실시간 웹훅 doPost(e) 토큰 보안 제어 검증
  let webhookEventProcessed = false;
  const originalProcessUpdate = sandbox.processTelegramUpdateEvent_;
  sandbox.processTelegramUpdateEvent_ = function(e) {
    webhookEventProcessed = true;
    return { getResponseCode: () => 200, getContentText: () => 'OK' };
  };
  
  // 1) 인증 토큰이 없을 때 차단되는지 검증
  const res1 = sandbox.doPost({ parameter: { token: 'WRONG_TOKEN' }, postData: { contents: '{}' } });
  if (res1.getContentText() !== 'Unauthorized' || webhookEventProcessed) {
    throw new Error('Telegram webhook accepted a request with invalid token.');
  }
  
  // 2) 올바른 인증 토큰을 제공했을 때 작동하는지 검증
  const res2 = sandbox.doPost({ parameter: { token: 'MOCK_VAL' }, postData: { contents: '{}' } });
  sandbox.processTelegramUpdateEvent_ = originalProcessUpdate;
  if (!webhookEventProcessed) {
    throw new Error('Telegram webhook rejected a valid token.');
  }
  console.log("   [PASS] [단위테스트 13] 텔레그램 실시간 웹훅 doPost(e) 토큰 보안 검증 완료");

  console.log("\x1b[32m✅ [합격] 모든 핵심 로직 유닛 테스트가 100% 정상 작동합니다!\x1b[0m");
} catch (ex) {
  console.error("\x1b[31m❌ [유닛 테스트 실패] 동적 테스트 검증 중 오류가 감지되었습니다!\x1b[0m");
  console.error(ex.stack || String(ex));
  process.exit(1);
}

if (testOnly) {
  console.log("\n💡 [--test-only] 플래그가 지정되어 빌드를 안전 중단하며 배포를 진행하지 않습니다.");
  process.exit(0);
}

console.log("\n==================================================");
console.log("🚀 [3단계] 자동 클라우드 빌드 및 실시간 안전 배포 (CI/CD) 기동");
console.log("==================================================");

try {
  console.log("📤 서버 최신화 (npx clasp push -f) 전송 중...");
  const pushOut = execSync('npx clasp push -f', { encoding: 'utf8' });
  console.log(pushOut);
  console.log("   [성공] clasp push 완료!");

  try {
    console.log("\n🚀 라이브 웹앱 주소 실시간 배포 릴리스 중...");
    // clasp deploy -i [DeploymentId] 옵션을 통해 주소를 평생 고정시키고 소스코드 버전만 실시간 덮어쓰기 갱신
    const deployOut = execSync('npx clasp deploy -i AKfycbzNBBpzQDGet6ccuIE8EF72D1R61MS4qkdKxnw2lvoBs3radRiBnsiFy5I1zUWCl5hGCg -d "JUSIK AI Live Release"', { encoding: 'utf8' });
    console.log(deployOut);

    console.log("==================================================");
    console.log("🎉 [배포 완료] 안전 배포 파이프라인이 전과정을 100% 무결점으로 완료했습니다!");
    console.log("💡 브라우저 탭에서 구글 스프레드시트를 [새로고침(F5)]하여 AI Scanner 메뉴를 즉시 복원해 주세요.");
    console.log("==================================================");
  } catch (deployErr) {
    const errMsg = deployErr.stdout || deployErr.message || '';
    if (errMsg.includes('Cannot create more versions') || errMsg.includes('limit of 200 versions')) {
      console.warn("\n\x1b[33m⚠️ [경고: 버전 한도 초과] Google Apps Script의 버전 개수 한도(200개)에 도달했습니다.\x1b[0m");
      console.warn("\x1b[33m- clasp push는 성공했으므로 구글 스프레드시트 내에서의 실행(메뉴 클릭, 시간 트리거 등)은 최신 코드로 정상 작동합니다.\x1b[0m");
      console.warn("\x1b[33m- 다만 텔레그램 봇 웹앱 실시간 배포(/exec URL)는 이전 버전을 유지합니다.\x1b[0m");
      console.warn("\x1b[33m- 해결하려면 구글 스프레드시트 -> [확장 프로그램] -> [Apps Script]의 에디터 화면에 진입하신 뒤,\x1b[0m");
      console.warn("\x1b[33m  우측 상단의 [배포] -> [배포 관리]에서 불필요한 과거 배포를 삭제하거나 정리해야 추가 버전 생성이 가능합니다.\x1b[0m");
      console.warn("\x1b[33m  또는 스프레드시트를 복사하여 새 스크립트 프로젝트를 생성하면 버전 카운트가 초기화됩니다.\x1b[0m\n");
      console.log("==================================================");
      console.log("🎉 [배포 완료 (부분 성공)] 코드 전송 완료. 버전 한도로 인한 웹앱 배포만 보류되었습니다.");
      console.log("==================================================");
    } else {
      console.error("\x1b[31m❌ [배포 실패] 클라우드 전송 및 배포 중 네트워크 오류가 감지되었습니다!\x1b[0m");
      console.error(errMsg);
      process.exit(1);
    }
  }
} catch (pushErr) {
  console.error("\x1b[31m❌ [전송 실패] npx clasp push 중 오류가 발생했습니다!\x1b[0m");
  console.error(pushErr.stdout || pushErr.message);
  process.exit(1);
}
