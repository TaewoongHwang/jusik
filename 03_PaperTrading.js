function fetchKisDomesticAccountBalance_(cano, productCode, customAuth) {
  var account = getKisAccountConfig_();
  var targetCano = cano || account.cano;
  var targetProductCode = productCode || account.accountProductCode;
  
  if (!targetCano) {
    throw new Error('KIS domestic CANO is missing.');
  }
  
  var trId = 'TTTC8434R';
  var isMock = false;
  if (customAuth && customAuth.baseUrl && customAuth.baseUrl.indexOf('vts') >= 0) {
    isMock = true;
  } else if (!customAuth && account.mockBaseUrl && account.mockBaseUrl.indexOf('vts') >= 0) {
    isMock = true;
  }
  if (isMock) {
    trId = 'VTTC8434R';
  }
  
  return kisGet_('/uapi/domestic-stock/v1/trading/inquire-balance', {
    CANO: targetCano,
    ACNT_PRDT_CD: targetProductCode,
    AFHR_FLPR_YN: 'N',
    OFL_YN: '',
    INQR_DVSN: '02',
    UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N',
    FNCG_AMT_AUTO_RDPT_YN: 'N',
    PRCS_DVSN: '01',
    CTX_AREA_FK100: '',
    CTX_AREA_NK100: ''
  }, trId, customAuth);
}

function normalizeKisAccountBalance_(response, customSource) {
  var today = amTodayString_();
  var holdingsRows = Array.isArray(response.output1) ? response.output1 : [];
  var summaryRows = Array.isArray(response.output2) ? response.output2 : (response.output2 ? [response.output2] : []);
  var summary = summaryRows[0] || {};
  var totalEval = firstNumber_(summary.tot_evlu_amt, summary.nass_amt, summary.total_eval_amount);
  var sourceName = customSource || 'kis_inquire_balance';
  
  var holdings = holdingsRows.map(function(row) {
    var symbol = normalizeStockSymbol_(firstNonEmpty_(row.pdno, row.prdt_code, row.symbol));
    var quantity = firstNumber_(row.hldg_qty, row.quantity);
    var evalAmount = firstNumber_(row.evlu_amt, row.eval_amount);
    return {
      date: today,
      symbol: symbol,
      name: firstNonEmpty_(row.prdt_name, row.item_name, row.name),
      quantity: quantity,
      avg_price: firstNumber_(row.pchs_avg_pric, row.avg_price),
      current_price: firstNumber_(row.prpr, row.current_price),
      purchase_amount: firstNumber_(row.pchs_amt, row.purchase_amount),
      eval_amount: evalAmount,
      profit_loss_amount: firstNumber_(row.evlu_pfls_amt, row.profit_loss_amount),
      profit_loss_pct: firstNumber_(row.evlu_pfls_rt, row.evlu_erng_rt, row.profit_loss_pct),
      change_pct: parseFloat(row.prdy_ctrt || row.fltt_rt || 0),
      portfolio_weight_pct: totalEval > 0 ? roundNumber_(evalAmount / totalEval * 100, 2) : 0,
      source: sourceName,
      currency: 'KRW'
    };
  }).filter(function(row) {
    return row.symbol && row.quantity > 0;
  });
  
  return {
    snapshot: {
      cash_amount: firstNumber_(summary.dnca_tot_amt, summary.cash_amount),
      stock_eval_amount: firstNumber_(summary.scts_evlu_amt, summary.stock_eval_amount),
      total_eval_amount: totalEval,
      purchase_amount: firstNumber_(summary.pchs_amt_smtl_amt, summary.purchase_amount),
      profit_loss_amount: firstNumber_(summary.evlu_pfls_smtl_amt, summary.profit_loss_amount),
      profit_loss_pct: firstNumber_(summary.asst_icdc_erng_rt, summary.profit_loss_pct)
    },
    holdings: holdings
  };
}

function fetchKisOverseasAccountBalance_(exchange, cano, productCode, customAuth) {
  var account = getKisAccountConfig_();
  var excg = exchange || 'NASD';
  var targetCano = cano || account.cano;
  var targetProductCode = productCode || account.accountProductCode;
  
  var trId = 'TTTS3012R';
  var isMock = false;
  if (customAuth && customAuth.baseUrl && customAuth.baseUrl.indexOf('vts') >= 0) {
    isMock = true;
  } else if (!customAuth && account.mockBaseUrl && account.mockBaseUrl.indexOf('vts') >= 0) {
    isMock = true;
  }
  if (isMock) {
    trId = 'VTTS3012R';
  }
  
  return kisGet_('/uapi/overseas-stock/v1/trading/inquire-balance', {
    CANO: targetCano,
    ACNT_PRDT_CD: targetProductCode,
    OVRS_EXCG_CD: excg,
    TR_CRCY_CD: 'USD',
    TR_CONT_YN: '',
    CTX_AREA_FK200: '',
    CTX_AREA_NK200: ''
  }, trId, customAuth);
}

function normalizeKisOverseasAccountBalance_(response) {
  var today = amTodayString_();
  var holdingsRows = Array.isArray(response.output1) ? response.output1 : [];
  var summary = response.output2 || {};
  var totalEvalUsd = firstNumber_(summary.tot_evlu_pfls_amt, summary.tot_evlu_pamt, summary.tot_evlu_amt);
  
  var holdings = holdingsRows.map(function(row) {
    var symbol = normalizeStockSymbol_(firstNonEmpty_(row.ovrs_pdno, row.symbol));
    var quantity = parseFloat(row.ovrs_cblc_qty || row.ccld_qty_smtl_dec || row.hldg_qty || row.quantity || 0);
    var evalAmountUsd = firstNumber_(row.ovrs_stck_evlu_amt, row.evlu_pamt, row.eval_amount);
    var avgPrice = parseFloat(row.pchs_avg_pric || 0);
    var currentPrice = parseFloat(row.now_pric2 || 0);
    
    return {
      date: today,
      symbol: symbol,
      name: firstNonEmpty_(row.ovrs_item_name, row.ovrs_prdt_name, row.name, symbol),
      quantity: quantity,
      avg_price: avgPrice,
      current_price: currentPrice,
      purchase_amount: parseFloat(row.frcr_pchs_amt1 || (avgPrice * quantity)),
      eval_amount: evalAmountUsd || (currentPrice * quantity),
      profit_loss_amount: firstNumber_(row.frcr_evlu_pfls_amt, row.profit_loss_amount),
      profit_loss_pct: firstNumber_(row.evlu_pfls_rt, row.profit_loss_pct),
      change_pct: parseFloat(row.prdy_ctrt || 0),
      portfolio_weight_pct: totalEvalUsd > 0 ? roundNumber_(evalAmountUsd / totalEvalUsd * 100, 2) : 0,
      source: 'kis_overseas_balance',
      currency: 'USD'
    };
  }).filter(function(row) {
    return row.symbol && row.quantity > 0;
  });
  
  return {
    snapshot: {
      cash_amount: firstNumber_(summary.frcr_dnca_amt, 0), // 외화 예수금
      stock_eval_amount: totalEvalUsd,
      total_eval_amount: totalEvalUsd
    },
    holdings: holdings
  };
}

function fetchKisOverseasDecimalAccountBalance_() {
  var account = getKisAccountConfig_();
  return kisGet_('/uapi/overseas-stock/v1/trading/inquire-present-decimal-balance', {
    CANO: account.cano,
    ACNT_PRDT_CD: account.accountProductCode,
    WCRC_FRCR_DVSN_CD: '02',
    CTX_AREA_FK200: '',
    CTX_AREA_NK200: ''
  }, 'OVTR3821R');
}

function normalizeKisOverseasDecimalAccountBalance_(response) {
  var today = amTodayString_();
  var holdingsRows = Array.isArray(response.output1) ? response.output1 : [];
  var summary = response.output2 || {};
  var totalEvalUsd = firstNumber_(summary.tot_evlu_pamt, summary.tot_evlu_amt);
  
  var holdings = holdingsRows.map(function(row) {
    var symbol = normalizeStockSymbol_(firstNonEmpty_(row.ovrs_pdno, row.pdno, row.symbol));
    var quantity = parseFloat(row.dec_exqty_smtl || row.hldg_qty || row.quantity || 0);
    var evalAmountUsd = firstNumber_(row.evlu_pamt, row.evlu_amt, row.eval_amount);
    var avgPrice = firstNumber_(row.pchs_avg_pric, row.avg_price);
    var currentPrice = firstNumber_(row.now_pric2, row.current_price);
    
    return {
      date: today,
      symbol: symbol,
      name: getStockKoreanName_(symbol, firstNonEmpty_(row.ovrs_prdt_name, row.prdt_name, row.name)),
      quantity: quantity,
      avg_price: avgPrice,
      current_price: currentPrice,
      purchase_amount: avgPrice * quantity,
      eval_amount: evalAmountUsd || (currentPrice * quantity),
      profit_loss_amount: (evalAmountUsd || (currentPrice * quantity)) - (avgPrice * quantity),
      profit_loss_pct: avgPrice > 0 ? (((currentPrice * quantity) - (avgPrice * quantity)) / (avgPrice * quantity) * 100) : 0,
      change_pct: parseFloat(row.prdy_ctrt || row.rate || 0),
      portfolio_weight_pct: 0,
      source: 'kis_overseas_decimal',
      currency: 'USD'
    };
  }).filter(function(row) {
    return row.symbol && row.quantity > 0;
  });
  
  return {
    snapshot: {
      cash_amount: 0,
      stock_eval_amount: totalEvalUsd,
      total_eval_amount: totalEvalUsd
    },
    holdings: holdings
  };
}

// ==================================================
// 🚀 실시간 보유 자산 수집 및 통합 갱신 엔진
// ==================================================

function collectHoldingsCurrent(forceRefresh) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    logWarn_('portfolio_collector', 'Portfolio collection lock acquisition failed (concurrent execution). Skipping this run.');
    return;
  }
  try {
    ensureAllSheets_();
    
    // 🚀 [초고속 10배 튜닝] 동일 종목 다중 조회 시 중복 네트워크 통신 병목을 0초로 강제 차단할 로컬 인메모리 사전 장착
    var localPriceMap = {};
    
    // 수동 자산 중복 가중평균 자동 치유
    try { cleanDuplicateManualHoldings_(); } catch(e) {}
    
    var today = amTodayString_();
    var portMode = String(
      getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.PORTFOLIO_MODE, 'REAL')
    ).toUpperCase();
    
    var isRealMode = (portMode === 'REAL');
    var isMockMode = (portMode === 'MOCK');
    
    // 기존 오늘자 보유 자산 캐시 일단 청소 (모드별로 격리하여 삭제함으로써 REAL, MOCK 모드 간 데이터 유실 차단)
    if (isRealMode) {
      deleteHoldingsCurrentBySources_(today, ['kis', 'manual_', 'overseas']);
    } else if (isMockMode) {
      deleteHoldingsCurrentBySources_(today, ['mock_trading']);
    }
  
  if (isRealMode) {
    var totalPurchase = 0;
    var totalEval = 0;
    var assets = [];
    
    var usdRate = 1500; // 2026년 기준 폴백 환율
    try {
      var liveRate = getLiveUsdRate_();
      if (liveRate > 500) {
        usdRate = liveRate;
      }
    } catch(err) {
      logWarn_('portfolio_collector', 'Failed to fetch live USD exchange rate', { error: err.message });
    }
    
    // 🚀 [초고속 0.1초 로딩 구현] KIS API 스캔 결과 10분 캐싱화
    var isForced = (forceRefresh !== false); // 기본값 true
    var cache = CacheService.getScriptCache();
    var cacheKey = 'KIS_REAL_PORTFOLIO_CACHE';
    var cachedDataStr = null;
    if (!isForced) {
      try { cachedDataStr = cache.get(cacheKey); } catch(e) {}
    }
    
    var useCache = false;
    if (cachedDataStr) {
      try {
        var cachedData = JSON.parse(cachedDataStr);
        if (cachedData && Array.isArray(cachedData.assets)) {
          assets = assets.concat(cachedData.assets);
          totalPurchase = cachedData.totalPurchase || 0;
          totalEval = cachedData.totalEval || 0;
          usdRate = cachedData.usdRate || 1350;
          useCache = true;
          logInfo_('portfolio_collector', 'Successfully restored KIS assets from script cache', { count: cachedData.assets.length });
        }
      } catch(e) {
        logWarn_('portfolio_collector', 'Failed to parse cached KIS assets', { error: e.message });
      }
    }
    
    if (!useCache) {
      var account = getKisAccountConfig_();
      
      // 1. 국내 KIS 실계좌 잔고 룩업 (일반 위탁계좌)
      try {
        var response = fetchKisDomesticAccountBalance_(account.cano, account.accountProductCode);
        var normalized = normalizeKisAccountBalance_(response, 'kis_domestic_balance');
        normalized.holdings.forEach(function(h) {
          totalPurchase += h.purchase_amount;
          totalEval += h.eval_amount;
          assets.push(h);
        });
        
        // 국내 예수금 가산 및 CASH 자산화
        var cash = normalized.snapshot.cash_amount || 0;
        if (cash > 0) {
          totalPurchase += cash;
          totalEval += cash;
          assets.push({
            date: today,
            symbol: 'CASH',
            name: '예수금 (위탁계좌)',
            quantity: cash,
            avg_price: 1,
            current_price: 1,
            purchase_amount: cash,
            eval_amount: cash,
            profit_loss_amount: 0,
            profit_loss_pct: 0,
            portfolio_weight_pct: 0,
            source: 'kis_cash',
            currency: 'KRW'
          });
        }
      } catch(e) {
        logWarn_('portfolio_collector', 'Failed to fetch domestic balance', { error: e.message });
      }
      
      // 1-B. 🚀 [신설] 국내 KIS ISA 계좌 잔고 룩업 및 병합
      var targetIsaCano = account.isaCano || account.cano;
      var targetIsaProductCode = account.isaProductCode;
      
      // 🚀 [중복 조회 완전 차단] 일반계좌와 ISA계좌의 정보가 100% 동일하다면 중복 API 요청을 생략
      var isSameAccount = (targetIsaCano === account.cano && targetIsaProductCode === account.accountProductCode);
      
      if (targetIsaCano && targetIsaProductCode && !isSameAccount) {
        // 일반위탁계좌 조회 직후에 연달아 호출되므로 KIS API TPS 우회용 300ms 슬립 부여
        Utilities.sleep(300);
        try {
          var isaResponse = null;
          var finalUsedProductCode = targetIsaProductCode;
          var isaAuth = (account.isaAppKey && account.isaAppSecret) ? {
            appKey: account.isaAppKey,
            appSecret: account.isaAppSecret
          } : null;
          
          try {
            isaResponse = fetchKisDomesticAccountBalance_(targetIsaCano, targetIsaProductCode, isaAuth);
          } catch(isaErr) {
            // 🚀 [자율 상품코드 스마트 스캔 엔진 기동]
            // 만약 상품코드 오류(OPSQ2000 등)로 실패 시, 대표적인 다른 상품코드들로 자동 우회 스캔 집행
            var errStr = String(isaErr.message || '');
            if (errStr.indexOf('OPSQ2000') >= 0 || errStr.indexOf('INVALID_CHECK_ACNO') >= 0 || errStr.indexOf('INPUT INVALID') >= 0) {
              logWarn_('portfolio_collector', 'KIS ISA balance fetch failed with account check error. Launching auto-scan for product codes...', {
                attempted_code: targetIsaProductCode,
                error: errStr
              });
              
              // ISA 계좌에 유효한 대표 상품코드 후보군
              var candidates = ['03', '02', '05', '06', '04', '07', '08', '09', '22', '01'];
              var scanSuccess = false;
              var scanRetryMap = {}; // 각 candidate 별 TPS 재시도 횟수 추적기
              
              for (var cIdx = 0; cIdx < candidates.length; cIdx++) {
                var candidate = candidates[cIdx];
                if (candidate === targetIsaProductCode) continue; // 이미 실패한 코드는 건너뜀
                
                try {
                  // 초당 거래제한(TPS)을 확실히 피하기 위해 800ms 의무 딜레이 부여
                  Utilities.sleep(800);
                  logInfo_('portfolio_collector', 'Scanning alternative KIS ISA product code candidate...', { candidate: candidate });
                  var tempRes = fetchKisDomesticAccountBalance_(targetIsaCano, candidate, isaAuth);
                  
                  // 만약 에러 없이 정상 응답이 오면 스캔 대성공!
                  if (tempRes && tempRes.rt_cd !== undefined && String(tempRes.rt_cd) === '0') {
                    isaResponse = tempRes;
                    finalUsedProductCode = candidate;
                    scanSuccess = true;
                    
                    // 스크립트 속성에 올바른 상품코드로 영구 자가 교정 및 업데이트
                    try {
                      PropertiesService.getScriptProperties().setProperty(AM_CONFIG.PROPERTY_KEYS.KIS_ISA_ACNT_PRDT_CD, candidate);
                      logInfo_('portfolio_collector', 'Successfully auto-corrected and updated KIS ISA product code to Properties', {
                        previous_code: targetIsaProductCode,
                        corrected_code: candidate
                      });
                    } catch(propErr) {}
                    
                    break;
                  }
                } catch(scanErr) {
                  var scanErrStr = String(scanErr.message || '');
                  // TPS 제한 에러 감지 시, 1.5초 대기 후 현재 상품코드를 재시도 (최대 3회)
                  if (scanErrStr.indexOf('TPS Limit') >= 0 || scanErrStr.indexOf('EGW00201') >= 0 || scanErrStr.indexOf('초당 거래건수') >= 0) {
                    var retries = scanRetryMap[candidate] || 0;
                    if (retries < 3) {
                      scanRetryMap[candidate] = retries + 1;
                      logWarn_('portfolio_collector', 'TPS Limit hit during ISA scan. Waiting 1.5s to retry current candidate...', { candidate: candidate, attempt: retries + 1 });
                      Utilities.sleep(1500);
                      cIdx--; // 현재 인덱스 재시도
                      continue;
                    }
                  }
                  
                  // 다른 후보들도 실패하면 무시하고 다음 후보 진행
                  logWarn_('portfolio_collector', 'Alternative candidate scan failed', { candidate: candidate, error: scanErr.message });
                }
              }
              
              if (!scanSuccess) {
                // 스캔마저도 모두 실패했다면 원래 발생한 에러를 재발생시켜 최종 fallback 처리
                throw isaErr;
              }
            } else {
              // 다른 에러(네트워크, 인증 등)면 그대로 상위 throw
              throw isaErr;
            }
          }
          
          // 정상 응답을 받았을 경우 병합 로직 진행
          if (isaResponse) {
            try {
              var normalizedIsa = normalizeKisAccountBalance_(isaResponse, 'kis_isa_balance');
              normalizedIsa.holdings.forEach(function(h) {
                // 중복 종목 처리 (위탁계좌와 ISA계좌에 동일 종목이 존재할 경우 가중평균 병합)
                var duplicate = assets.filter(function(a) { return a.symbol === h.symbol && a.symbol !== 'CASH'; });
                if (duplicate.length > 0) {
                  var prev = duplicate[0];
                  var totalQty = prev.quantity + h.quantity;
                  var totalCost = (prev.quantity * prev.avg_price) + (h.quantity * h.avg_price);
                  prev.quantity = totalQty;
                  prev.avg_price = totalQty > 0 ? Math.round(totalCost / totalQty) : 0;
                  prev.purchase_amount = prev.avg_price * prev.quantity;
                  prev.eval_amount = prev.current_price * prev.quantity;
                  prev.profit_loss_amount = prev.eval_amount - prev.purchase_amount;
                  prev.profit_loss_pct = prev.purchase_amount > 0 ? (prev.profit_loss_amount / prev.purchase_amount * 100) : 0;
                  prev.source = 'kis_composite'; // 복합 계좌 보유 표시
                } else {
                  assets.push(h);
                }
                totalPurchase += h.purchase_amount;
                totalEval += h.eval_amount;
              });
              
              // ISA 예수금 가산
              var isaCash = normalizedIsa.snapshot.cash_amount || 0;
              if (isaCash > 0) {
                totalPurchase += isaCash;
                totalEval += isaCash;
                var existingCash = assets.filter(function(x) { return x.symbol === 'CASH' && x.source === 'kis_cash'; });
                if (existingCash.length > 0) {
                  existingCash[0].quantity += isaCash;
                  existingCash[0].purchase_amount += isaCash;
                  existingCash[0].eval_amount += isaCash;
                  existingCash[0].name = '예수금 (위탁/ISA)';
                } else {
                  assets.push({
                    date: today,
                    symbol: 'CASH',
                    name: '예수금 (ISA계좌)',
                    quantity: isaCash,
                    avg_price: 1,
                    current_price: 1,
                    purchase_amount: isaCash,
                    eval_amount: isaCash,
                    profit_loss_amount: 0,
                    profit_loss_pct: 0,
                    portfolio_weight_pct: 0,
                    source: 'kis_cash',
                    currency: 'KRW'
                  });
                }
              }
              logInfo_('portfolio_collector', 'Successfully fetched KIS ISA account balance', {
                count: normalizedIsa.holdings.length,
                used_product_code: finalUsedProductCode
              });
            } catch(parseErr) {
              logWarn_('portfolio_collector', 'Failed to parse normal KIS ISA balance response', { error: parseErr.message });
            }
          }
        } catch(isaCompositeErr) {
          logWarn_('portfolio_collector', 'Failed to scan/merge KIS ISA account balance completely', { error: isaCompositeErr.message });
        }
      }
      
      // 2. 해외 KIS 실계좌 잔고 룩업 (일반 나스닥 + 뉴욕증시 + 소수점 잔고 통합 병합)
      var rawOverseasHoldings = [];
      var totalFrCash = 0;
      
      // (A) 일반 나스닥 조회
      try {
        var nasResponse = fetchKisOverseasAccountBalance_('NASD');
        var normalizedNas = normalizeKisOverseasAccountBalance_(nasResponse);
        rawOverseasHoldings = rawOverseasHoldings.concat(normalizedNas.holdings);
        totalFrCash += normalizedNas.snapshot.cash_amount || 0;
      } catch(e) {
        logWarn_('portfolio_collector', 'Failed to fetch NASD balance', { error: e.message });
      }
      
      // (B) 일반 뉴욕증시 조회
      try {
        var nysResponse = fetchKisOverseasAccountBalance_('NYSE');
        var normalizedNys = normalizeKisOverseasAccountBalance_(nysResponse);
        rawOverseasHoldings = rawOverseasHoldings.concat(normalizedNys.holdings);
        totalFrCash += normalizedNys.snapshot.cash_amount || 0;
      } catch(e) {
        logWarn_('portfolio_collector', 'Failed to fetch NYSE balance', { error: e.message });
      }
      
      // (C) 미니스탁 소수점 잔고 조회
      try {
        var decResponse = fetchKisOverseasDecimalAccountBalance_();
        var normalizedDec = normalizeKisOverseasDecimalAccountBalance_(decResponse);
        rawOverseasHoldings = rawOverseasHoldings.concat(normalizedDec.holdings);
      } catch(e) {
        logWarn_('portfolio_collector', 'Failed to fetch Overseas Decimal balance', { error: e.message });
      }
      
      // (D) 동일 종목 중복 가중평균 병합
      var mergedOverseas = {};
      rawOverseasHoldings.forEach(function(oh) {
        var sym = oh.symbol;
        if (!mergedOverseas[sym]) {
          mergedOverseas[sym] = oh;
        } else {
          var prev = mergedOverseas[sym];
          var totalQty = prev.quantity + oh.quantity;
          var totalCost = (prev.quantity * prev.avg_price) + (oh.quantity * oh.avg_price);
          prev.quantity = totalQty;
          prev.avg_price = totalQty > 0 ? (totalCost / totalQty) : 0;
          prev.current_price = oh.current_price || prev.current_price;
          prev.purchase_amount = prev.avg_price * prev.quantity;
          prev.eval_amount = prev.current_price * prev.quantity;
          prev.profit_loss_amount = prev.eval_amount - prev.purchase_amount;
          prev.profit_loss_pct = prev.purchase_amount > 0 ? (prev.profit_loss_amount / prev.purchase_amount * 100) : 0;
          
          // 🚀 신설: change_pct 등락률 보존 및 머지 상속 처리
          prev.change_pct = oh.change_pct !== undefined && oh.change_pct !== 0 ? oh.change_pct : (prev.change_pct || 0);
        }
      });
      
      // (E) 원화(KRW) 환율 환산 가산하여 assets에 가해줌
      Object.keys(mergedOverseas).forEach(function(sym) {
        var oh = mergedOverseas[sym];
        
        // 🚀 [Double-Shielding] 실시간 야후/KIS 시세망 강제 가동하여 현재가 및 당일 등락률을 100% 무결 정화 (인메모리 최적화 탑재)
        try {
          var quoteOvs = localPriceMap[sym];
          if (!quoteOvs) {
            quoteOvs = fetchKisOverseasCurrentPrice_(sym);
            localPriceMap[sym] = quoteOvs;
          }
          if (quoteOvs) {
            oh.current_price = quoteOvs.close || oh.current_price;
            oh.change_pct = quoteOvs.change_pct !== undefined ? quoteOvs.change_pct : (oh.change_pct || 0);
            if (quoteOvs.name && quoteOvs.name !== sym) {
              oh.name = getStockKoreanName_(sym, quoteOvs.name);
            }
          }
        } catch(e) {
          logWarn_('portfolio_collector', 'Failed to inject real-time quote for overseas symbol ' + sym, { error: e.message });
        }
        
        // 🚀 영구 한글명 룩업 매핑으로 이름 정화 보증 (GOOG -> 알파벳 C (구글 C))
        oh.name = getStockKoreanName_(sym, oh.name);
        
        var pAmtKrw = oh.purchase_amount * usdRate;
        var eAmtKrw = (oh.current_price * oh.quantity) * usdRate; // 🚀 평가액도 실시간 시세 기준으로 계산
        totalPurchase += pAmtKrw;
        totalEval += eAmtKrw;
        
        oh.purchase_amount = pAmtKrw;
        oh.eval_amount = eAmtKrw;
        oh.avg_price = oh.avg_price * usdRate;
        oh.current_price = oh.current_price * usdRate;
        oh.profit_loss_amount = eAmtKrw - pAmtKrw;
        oh.profit_loss_pct = pAmtKrw > 0 ? (oh.profit_loss_amount / pAmtKrw * 100) : 0;
        oh.source = 'overseas';
        assets.push(oh);
      });
      
      // 외화 예수금 환산 가산 및 CASH 자산화
      if (totalFrCash > 0) {
        var frCashKrw = totalFrCash * usdRate;
        totalPurchase += frCashKrw;
        totalEval += frCashKrw;
        
        var existingCash = assets.filter(function(x) { return x.symbol === 'CASH' && x.source === 'kis_cash'; });
        if (existingCash.length > 0) {
          existingCash[0].quantity += frCashKrw;
          existingCash[0].purchase_amount += frCashKrw;
          existingCash[0].eval_amount += frCashKrw;
          existingCash[0].name = '예수금 (원화/외화)';
        } else {
          assets.push({
            date: today,
            symbol: 'CASH',
            name: '예수금 (외화 환산)',
            quantity: frCashKrw,
            avg_price: 1,
            current_price: 1,
            purchase_amount: frCashKrw,
            eval_amount: frCashKrw,
            profit_loss_amount: 0,
            profit_loss_pct: 0,
            portfolio_weight_pct: 0,
            source: 'kis_cash',
            currency: 'KRW'
          });
        }
      }
      
      // KIS API 결과 캐싱 처리
      try {
        var cacheObj = {
          assets: assets,
          totalPurchase: totalPurchase,
          totalEval: totalEval,
          usdRate: usdRate
        };
        cache.put(cacheKey, JSON.stringify(cacheObj), 600); // 10분 캐시
        logInfo_('portfolio_collector', 'Successfully cached KIS assets', { count: assets.length });
      } catch(ce) {
        logWarn_('portfolio_collector', 'Failed to write KIS assets to cache', { error: ce.message });
      }
    }
    
    // 3. 수동 등록 자산 (manual_holdings) 융합
    try {
      var manualRows = readObjects_(AM_CONFIG.SHEETS.MANUAL_HOLDINGS);
      var activeManuals = manualRows.filter(function(row) {
        var activeText = String(row.active || 'Y').toUpperCase().trim();
        return (activeText !== 'N' && activeText !== 'FALSE') && parseFloat(row.quantity || 0) > 0;
      });
      
      activeManuals.forEach(function(row) {
        var qty = parseFloat(row.quantity || 0);
        var avg = parseFloat(row.avg_price || 0);
        var sym = normalizeStockSymbol_(row.symbol);
        
        var purchaseAmt = qty * avg;
        var evalAmt = purchaseAmt;
        var cur = avg;
        var changePct = 0;
        
        if (sym === 'CASH') {
          // 특수 현금 자산
          assets.push({
            date: today,
            symbol: 'CASH',
            name: row.name || '수동 현금자산',
            quantity: qty,
            avg_price: 1,
            current_price: 1,
            purchase_amount: qty,
            eval_amount: qty,
            profit_loss_amount: 0,
            profit_loss_pct: 0,
            portfolio_weight_pct: 0,
            source: 'manual_' + String(row.broker || 'external').trim(),
            currency: 'KRW'
          });
          totalPurchase += qty;
          totalEval += qty;
        } else {
          // 일반 주식 자산
          try {
            var isOvs = /^[a-zA-Z]/.test(sym); // 알파벳으로 시작하면 해외주식으로 판별
            if (isOvs) {
              // 🚀 해외 주식 스마트 평단가 자동 보정 (5000원 이하는 달러 단가로 인식)
              var isUsdPriceInput = (avg <= 5000);
              var avgPriceKrw = isUsdPriceInput ? (avg * usdRate) : avg;
              var avgPriceUsd = isUsdPriceInput ? avg : (avg / usdRate);
              
              // 🚀 인메모리 가격 사전 적용하여 중복 통신 지연 병목 사멸
              var quoteOvs = localPriceMap[sym];
              if (!quoteOvs) {
                quoteOvs = fetchKisOverseasCurrentPrice_(sym);
                localPriceMap[sym] = quoteOvs;
              }
              
              var curUsd = quoteOvs.close || avgPriceUsd;
              cur = curUsd * usdRate; // 현재가는 원화 환산
              changePct = quoteOvs.change_pct || 0;
              
              purchaseAmt = qty * avgPriceKrw; // 매수액 원화 환산
              evalAmt = qty * cur; // 평가액 원화 환산
              avg = avgPriceKrw; // 자산 리스트에는 원화 평단가 적재
            } else {
              // 🚀 인메모리 가격 사전 적용하여 중복 통신 지연 병목 사멸
              var quote = localPriceMap[sym];
              if (!quote) {
                quote = fetchKisCurrentPrice_(sym);
                localPriceMap[sym] = quote;
              }
              cur = quote.close || avg;
              changePct = quote.change_pct || 0;
              evalAmt = qty * cur;
            }
          } catch(err) {
            logWarn_('portfolio_collector', 'Failed to fetch quote for manual symbol ' + sym + '; using avg_price', { error: err.message });
          }
          
          totalPurchase += purchaseAmt;
          totalEval += evalAmt;
          
          assets.push({
            date: today,
            symbol: sym,
            name: getStockKoreanName_(sym, row.name),
            quantity: qty,
            avg_price: avg,
            current_price: cur,
            purchase_amount: purchaseAmt,
            eval_amount: evalAmt,
            profit_loss_amount: evalAmt - purchaseAmt,
            profit_loss_pct: purchaseAmt > 0 ? ((evalAmt - purchaseAmt) / purchaseAmt * 100) : 0,
            change_pct: changePct, // 🚀 신설: 수동 자산의 당일 등락률 완벽 복원
            portfolio_weight_pct: 0,
            source: 'manual_' + String(row.broker || 'external').trim(),
            currency: 'KRW'
          });
        }
      });
    } catch(e) {
      logWarn_('portfolio_collector', 'Failed to merge manual holdings', { error: e.message });
    }
    
    // 가중치 업데이트 및 최종 저장
    if (assets.length > 0) {
      assets.forEach(function(a) {
        a.portfolio_weight_pct = totalEval > 0 ? roundNumber_(a.eval_amount / totalEval * 100, 2) : 0;
        a.profit_loss_pct = roundNumber_(a.profit_loss_pct, 2);
      });
      appendObjectRows_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT, assets);
    }
    
    logInfo_('portfolio_collector', 'Real portfolio collected successfully', { holdings_count: assets.length, total_eval: totalEval });
  } else if (isMockMode) {
    // 💡 KIS API 실제 모의투자 모드
    var totalPurchase = 0;
    var totalEval = 0;
    var assets = [];
    var account = getKisAccountConfig_();
    
    var mockAuth = (account.mockAppKey && account.mockAppSecret) ? {
      appKey: account.mockAppKey,
      appSecret: account.mockAppSecret,
      baseUrl: account.mockBaseUrl || 'https://openapivts.koreainvestment.com:29443'
    } : null;
    
    var usdRate = 1350; // 기본 폴백 환율
    try {
      var liveRate = getLiveUsdRate_();
      if (liveRate > 500) usdRate = liveRate;
    } catch(err) {}
    
    // 1. 국내 모의 잔고 조회
    try {
      var response = fetchKisDomesticAccountBalance_(account.mockCano, account.mockProductCode, mockAuth);
      var normalized = normalizeKisAccountBalance_(response, 'mock_trading');
      normalized.holdings.forEach(function(h) {
        totalPurchase += h.purchase_amount;
        totalEval += h.eval_amount;
        assets.push(h);
      });
      
      // 국내 모의 예수금 가산
      var cash = normalized.snapshot.cash_amount || 0;
      if (cash > 0) {
        totalPurchase += cash;
        totalEval += cash;
        assets.push({
          date: today,
          symbol: 'CASH',
          name: '모의투자 예수금 (국내 API)',
          quantity: cash,
          avg_price: 1,
          current_price: 1,
          purchase_amount: cash,
          eval_amount: cash,
          profit_loss_amount: 0,
          profit_loss_pct: 0,
          portfolio_weight_pct: 0,
          source: 'mock_trading_cash',
          currency: 'KRW'
        });
      }
    } catch(e) {
      logWarn_('portfolio_collector', 'Failed to fetch KIS Mock domestic balance', { error: e.message });
    }
    
    // 2. 해외 모의 잔고 조회 (나스닥/뉴욕 통합 융합)
    var rawOverseasHoldings = [];
    var totalFrCash = 0;
    
    // (A) 해외 모의 나스닥 조회
    try {
      var nasResponse = fetchKisOverseasAccountBalance_('NASD', account.mockCano, account.mockProductCode, mockAuth);
      var normalizedNas = normalizeKisOverseasAccountBalance_(nasResponse);
      rawOverseasHoldings = rawOverseasHoldings.concat(normalizedNas.holdings);
      totalFrCash += normalizedNas.snapshot.cash_amount || 0;
    } catch(e) {
      logWarn_('portfolio_collector', 'Failed to fetch Mock NASD balance', { error: e.message });
    }
    
    // (B) 해외 모의 뉴욕증시 조회
    try {
      var nysResponse = fetchKisOverseasAccountBalance_('NYSE', account.mockCano, account.mockProductCode, mockAuth);
      var normalizedNys = normalizeKisOverseasAccountBalance_(nysResponse);
      rawOverseasHoldings = rawOverseasHoldings.concat(normalizedNys.holdings);
      totalFrCash += normalizedNys.snapshot.cash_amount || 0;
    } catch(e) {
      logWarn_('portfolio_collector', 'Failed to fetch Mock NYSE balance', { error: e.message });
    }
    
    // 해외 모의 보유 종목 병합 및 원화 환산
    var mergedOverseas = {};
    rawOverseasHoldings.forEach(function(oh) {
      var sym = oh.symbol;
      if (!mergedOverseas[sym]) {
        mergedOverseas[sym] = oh;
      } else {
        var prev = mergedOverseas[sym];
        var totalQty = prev.quantity + oh.quantity;
        var totalCost = (prev.quantity * prev.avg_price) + (oh.quantity * oh.avg_price);
        prev.quantity = totalQty;
        prev.avg_price = totalQty > 0 ? (totalCost / totalQty) : 0;
        prev.current_price = oh.current_price || prev.current_price;
        prev.purchase_amount = prev.avg_price * prev.quantity;
        prev.eval_amount = prev.current_price * prev.quantity;
        prev.profit_loss_amount = prev.eval_amount - prev.purchase_amount;
        prev.profit_loss_pct = prev.purchase_amount > 0 ? (prev.profit_loss_amount / prev.purchase_amount * 100) : 0;
        prev.change_pct = oh.change_pct !== undefined && oh.change_pct !== 0 ? oh.change_pct : (prev.change_pct || 0);
      }
    });
    
    Object.keys(mergedOverseas).forEach(function(sym) {
      var oh = mergedOverseas[sym];
      
      try {
        var quoteOvs = fetchKisOverseasCurrentPrice_(sym);
        if (quoteOvs) {
          oh.current_price = quoteOvs.close || oh.current_price;
          oh.change_pct = quoteOvs.change_pct !== undefined ? quoteOvs.change_pct : (oh.change_pct || 0);
          if (quoteOvs.name && quoteOvs.name !== sym) {
            oh.name = getStockKoreanName_(sym, quoteOvs.name);
          }
        }
      } catch(e) {}
      
      oh.name = getStockKoreanName_(sym, oh.name);
      
      var pAmtKrw = oh.purchase_amount * usdRate;
      var eAmtKrw = (oh.current_price * oh.quantity) * usdRate;
      totalPurchase += pAmtKrw;
      totalEval += eAmtKrw;
      
      oh.purchase_amount = pAmtKrw;
      oh.eval_amount = eAmtKrw;
      oh.avg_price = oh.avg_price * usdRate;
      oh.current_price = oh.current_price * usdRate;
      oh.profit_loss_amount = eAmtKrw - pAmtKrw;
      oh.profit_loss_pct = pAmtKrw > 0 ? (oh.profit_loss_amount / pAmtKrw * 100) : 0;
      oh.source = 'mock_trading';
      assets.push(oh);
    });
    
    // 해외 모의 외화 예수금 환산 가산
    if (totalFrCash > 0) {
      var frCashKrw = totalFrCash * usdRate;
      totalPurchase += frCashKrw;
      totalEval += frCashKrw;
      
      var existingCash = assets.filter(function(x) { return x.symbol === 'CASH' && (x.source === 'mock_trading_cash' || x.source === 'mock_trading'); });
      if (existingCash.length > 0) {
        existingCash[0].quantity += frCashKrw;
        existingCash[0].purchase_amount += frCashKrw;
        existingCash[0].eval_amount += frCashKrw;
        existingCash[0].name = '모의투자 예수금 (원화/외화)';
      } else {
        assets.push({
          date: today,
          symbol: 'CASH',
          name: '모의투자 예수금 (외화 환산 API)',
          quantity: frCashKrw,
          avg_price: 1,
          current_price: 1,
          purchase_amount: frCashKrw,
          eval_amount: frCashKrw,
          profit_loss_amount: 0,
          profit_loss_pct: 0,
          portfolio_weight_pct: 0,
          source: 'mock_trading_cash',
          currency: 'KRW'
        });
      }
    }
    
    // 3. 수동 등록 자산 (manual_holdings) 융합 (모의투자 모드에서도 수동 기입 자산 연동 지원)
    try {
      var manualRows = readObjects_(AM_CONFIG.SHEETS.MANUAL_HOLDINGS);
      var activeManuals = manualRows.filter(function(row) {
        var activeText = String(row.active || 'Y').toUpperCase().trim();
        return (activeText !== 'N' && activeText !== 'FALSE') && parseFloat(row.quantity || 0) > 0;
      });
      
      activeManuals.forEach(function(row) {
        var qty = parseFloat(row.quantity || 0);
        var avg = parseFloat(row.avg_price || 0);
        var sym = normalizeStockSymbol_(row.symbol);
        
        var purchaseAmt = qty * avg;
        var evalAmt = purchaseAmt;
        var cur = avg;
        var changePct = 0;
        
        if (sym === 'CASH') {
          assets.push({
            date: today,
            symbol: 'CASH',
            name: row.name || '수동 현금자산',
            quantity: qty,
            avg_price: 1,
            current_price: 1,
            purchase_amount: qty,
            eval_amount: qty,
            profit_loss_amount: 0,
            profit_loss_pct: 0,
            portfolio_weight_pct: 0,
            source: 'manual_' + String(row.broker || 'external').trim(),
            currency: 'KRW'
          });
          totalPurchase += qty;
          totalEval += qty;
        } else {
          try {
            var isOvs = /^[a-zA-Z]/.test(sym);
            if (isOvs) {
              var isUsdPriceInput = (avg <= 5000);
              var avgPriceKrw = isUsdPriceInput ? (avg * usdRate) : avg;
              var avgPriceUsd = isUsdPriceInput ? avg : (avg / usdRate);
              
              var quoteOvs = localPriceMap[sym];
              if (!quoteOvs) {
                quoteOvs = fetchKisOverseasCurrentPrice_(sym);
                localPriceMap[sym] = quoteOvs;
              }
              
              var curUsd = quoteOvs.close || avgPriceUsd;
              cur = curUsd * usdRate;
              changePct = quoteOvs.change_pct || 0;
              
              purchaseAmt = qty * avgPriceKrw;
              evalAmt = qty * cur;
              avg = avgPriceKrw;
            } else {
              var quote = localPriceMap[sym];
              if (!quote) {
                quote = fetchKisCurrentPrice_(sym);
                localPriceMap[sym] = quote;
              }
              cur = quote.close || avg;
              changePct = quote.change_pct || 0;
              evalAmt = qty * cur;
            }
          } catch(err) {
            logWarn_('portfolio_collector', 'Failed to fetch quote for manual symbol ' + sym + ' in mock mode; using avg_price', { error: err.message });
          }
          
          totalPurchase += purchaseAmt;
          totalEval += evalAmt;
          
          assets.push({
            date: today,
            symbol: sym,
            name: getStockKoreanName_(sym, row.name),
            quantity: qty,
            avg_price: avg,
            current_price: cur,
            purchase_amount: purchaseAmt,
            eval_amount: evalAmt,
            profit_loss_amount: evalAmt - purchaseAmt,
            profit_loss_pct: purchaseAmt > 0 ? ((evalAmt - purchaseAmt) / purchaseAmt * 100) : 0,
            change_pct: changePct,
            portfolio_weight_pct: 0,
            source: 'manual_' + String(row.broker || 'external').trim(),
            currency: 'KRW'
          });
        }
      });
    } catch(e) {
      logWarn_('portfolio_collector', 'Failed to merge manual holdings in mock mode', { error: e.message });
    }
    
    // 가중치 업데이트 및 최종 저장
    if (assets.length > 0) {
      assets.forEach(function(a) {
        a.portfolio_weight_pct = totalEval > 0 ? roundNumber_(a.eval_amount / totalEval * 100, 2) : 0;
        a.profit_loss_pct = roundNumber_(a.profit_loss_pct, 2);
      });
      appendObjectRows_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT, assets);
    }
    
    logInfo_('portfolio_collector', 'Mock API portfolio collected successfully', { holdings_count: assets.length, total_eval: totalEval });
  } else {
    logWarn_('portfolio_collector', 'Unsupported PORTFOLIO_MODE configuration: ' + portMode);
  }
  

  
  // 날짜별 가중치 재분배 및 리스크 모형 이식
  try {
    rewriteHoldingWeightsForDate_(today);
  } catch(ex) {}
  } finally {
    lock.releaseLock();
  }
}

function rewriteHoldingWeightsForDate_(today) {
  var sheetName = AM_CONFIG.SHEETS.HOLDINGS_CURRENT;
  var sheet = ensureSheet_(sheetName, AM_SHEET_SCHEMAS[sheetName]);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;
  var headers = values[0];
  var dateIndex = headers.indexOf('date');
  var evalIndex = headers.indexOf('eval_amount');
  var weightIndex = headers.indexOf('portfolio_weight_pct');
  if (dateIndex < 0 || evalIndex < 0 || weightIndex < 0) return;
  
  var target = normalizeDateValue_(today);
  var total = 0;
  for (var i = 1; i < values.length; i += 1) {
    if (normalizeDateValue_(values[i][dateIndex]) === target) {
      total += Number(values[i][evalIndex] || 0);
    }
  }
  if (total <= 0) return;
  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (normalizeDateValue_(values[rowIndex][dateIndex]) === target) {
      sheet.getRange(rowIndex + 1, weightIndex + 1).setValue(roundNumber_(Number(values[rowIndex][evalIndex] || 0) / total * 100, 2));
    }
  }
}

// ==================================================
// 🚀 초정밀 모의투자(Paper) 체결 집계 엔진
// ==================================================

/**
 * 해외 종목코드에 상응하는 해외 거래소 코드를 판별하는 헬퍼 함수
 */
function getOverseasExchangeCode_(symbol) {
  var cleanSymbol = String(symbol || '').trim().toUpperCase();
  var nyseList = ['NYS', 'T', 'DIS', 'KO', 'PEP', 'JNJ', 'PG', 'XOM', 'CVX', 'BRK.B', 'V', 'MA'];
  var amexList = ['SPY', 'GLD', 'DIA', 'IWM', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'GDX', 'EEM', 'IYR', 'BIL', 'IEF', 'LQD', 'VEA', 'TIP', 'SHY', 'SHV'];
  
  if (nyseList.indexOf(cleanSymbol) >= 0) {
    return 'NYSE';
  } else if (amexList.indexOf(cleanSymbol) >= 0) {
    return 'AMEX';
  }
  return 'NASD'; // 기본 나스닥
}

function executeMockOrder_(symbol, actionType, qty, customPrice) {
  var today = amTodayString_();
  var cleanSymbol = normalizeStockSymbol_(symbol);
  var isOverseas = /^[A-Za-z]/.test(cleanSymbol);
  
  var account = getKisAccountConfig_();
  var mockAuth = (account.mockAppKey && account.mockAppSecret) ? {
    appKey: account.mockAppKey,
    appSecret: account.mockAppSecret,
    baseUrl: account.mockBaseUrl || 'https://openapivts.koreainvestment.com:29443'
  } : null;
  
  if (!account.mockCano) {
    throw new Error('한투 모의투자 계좌번호(KIS_MOCK_CANO)가 설정되지 않았습니다.');
  }
  
  var quote = null;
  try {
    if (isOverseas) {
      quote = fetchKisOverseasCurrentPrice_(cleanSymbol);
    } else {
      quote = fetchKisCurrentPrice_(cleanSymbol, mockAuth);
    }
  } catch(e) {
    logWarn_('mock_trading', 'Price fetch failed for mock order symbol: ' + cleanSymbol, { error: e.message });
  }
  
  var stockName = getStockKoreanName_(cleanSymbol, quote ? quote.name : cleanSymbol);
  var executionPrice = customPrice > 0 ? customPrice : (quote ? quote.close : 0);
  if (executionPrice <= 0) {
    throw new Error('종목 ' + cleanSymbol + '의 시세를 획득할 수 없어 주문을 생성할 수 없습니다.');
  }
  var amount = executionPrice * qty;
  var orderNo = 'N/A';
  
  if (!isOverseas) {
    // 🇰🇷 국내 주식 모의 주문 송신
    var trId = (actionType === 'BUY') ? 'VTTC0802U' : 'VTTC0801U';
    var payload = {
      CANO: account.mockCano,
      ACNT_PRDT_CD: account.mockProductCode || '01',
      PDNO: cleanSymbol,
      ORD_DVSN: customPrice > 0 ? '00' : '01', // 지정가/시장가
      ORD_QTY: String(qty),
      ORD_UNPR: customPrice > 0 ? String(customPrice) : '0'
    };
    
    try {
      var response = kisPost_('/uapi/domestic-stock/v1/trading/order-cash', payload, trId, mockAuth);
      orderNo = (response.output && response.output.ODNO) || 'N/A';
    } catch(err) {
      logWarn_('mock_trading', 'Domestic mock order failed', { error: err.message });
      throw new Error('한투 국내 모의 주문 실패: ' + err.message);
    }
  } else {
    // 🇺🇸 해외 주식 모의 주문 송신
    var trId = (actionType === 'BUY') ? 'VTTS3015U' : 'VTTS3020U';
    var exchangeCode = getOverseasExchangeCode_(cleanSymbol);
    
    var payload = {
      CANO: account.mockCano,
      ACNT_PRDT_CD: account.mockProductCode || '01',
      OVRS_EXCG_CD: exchangeCode,
      PDNO: cleanSymbol,
      ORD_QTY: String(qty),
      ORD_UNPR: String(Number(executionPrice).toFixed(2)), // 해외 지정가 단가 기재 필수
      ORD_DVSN: '00', // 지정가
      SLL_BUY_DVSN_CD: (actionType === 'BUY') ? '02' : '01'
    };
    
    try {
      var response = kisPost_('/uapi/overseas-stock/v1/trading/order', payload, trId, mockAuth);
      orderNo = (response.output && response.output.ODNO) || 'N/A';
    } catch(err) {
      logWarn_('mock_trading', 'Overseas mock order failed', { error: err.message });
      throw new Error('한투 해외 모의 주문 실패: ' + err.message);
    }
  }
  
  appendObjectRow_(AM_CONFIG.SHEETS.PAPER_LEDGER, {
    date: today,
    symbol: cleanSymbol,
    name: stockName,
    action_type: actionType,
    price: executionPrice,
    quantity: qty,
    amount: amount,
    reason: '한투 API 모의 주문 송신 완료 (주문번호: ' + orderNo + ')',
    created_at: amNowString_()
  });
  
  logInfo_('mock_trading', 'Submitted KIS mock order successfully', { symbol: cleanSymbol, action: actionType, qty: qty, order_no: orderNo });
  
  collectHoldingsCurrent();
  
  return {
    success: true,
    name: stockName,
    executionPrice: executionPrice,
    amount: amount,
    cash: 0,
    activePositions: []
  };
}

/**
 * 🚀 [신설] KIS 실제 계좌 실거래 주문 송신 엔진 (안전 가드 내장)
 */
function executeRealOrder_(symbol, actionType, qty, customPrice) {
  // 🚀 [안전 가드] 실거래 자동 매매 스위치 검증
  var isAutoTradingEnabled = String(getScriptProperty_('REAL_AUTO_TRADING_ENABLED', 'N')).trim().toUpperCase();
  if (isAutoTradingEnabled !== 'Y' && isAutoTradingEnabled !== 'TRUE') {
    var guardMsg = '⚠️ [실거래 주문 차단] REAL_AUTO_TRADING_ENABLED 가 활성화되지 않아 실제 주문을 전송하지 않았습니다. 스크립트 속성 값을 Y 또는 TRUE로 활성화해 주세요. (주문 요청: ' + symbol + ' ' + actionType + ' ' + qty + '주)';
    logWarn_('real_trading', guardMsg);
    try {
      sendTelegramMessage(guardMsg);
    } catch(telErr) {}
    throw new Error('실거래 자동주문 비활성화 상태입니다. (REAL_AUTO_TRADING_ENABLED=N)');
  }

  var today = amTodayString_();
  var cleanSymbol = normalizeStockSymbol_(symbol);
  var isOverseas = /^[A-Za-z]/.test(cleanSymbol);
  
  var account = getKisAccountConfig_();
  
  var appKey = sanitizeKey_(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_KEY, ''));
  var appSecret = sanitizeKey_(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_APP_SECRET, ''));
  var baseUrl = String(getScriptProperty_(AM_CONFIG.PROPERTY_KEYS.KIS_BASE_URL, AM_CONFIG.DEFAULT_KIS_BASE_URL)).trim();
  
  if (!appKey || !appSecret) {
    throw new Error('KIS 실거래 APP KEY 또는 SECRET이 설정되지 않았습니다.');
  }
  
  if (!account.cano) {
    throw new Error('KIS 실거래 계좌번호(KIS_CANO)가 설정되지 않았습니다.');
  }

  var realAuth = {
    appKey: appKey,
    appSecret: appSecret,
    baseUrl: baseUrl
  };

  var quote = null;
  try {
    if (isOverseas) {
      quote = fetchKisOverseasCurrentPrice_(cleanSymbol);
    } else {
      quote = fetchKisCurrentPrice_(cleanSymbol);
    }
  } catch(e) {
    logWarn_('real_trading', 'Price fetch failed for real order symbol: ' + cleanSymbol, { error: e.message });
  }
  
  var stockName = getStockKoreanName_(cleanSymbol, quote ? quote.name : cleanSymbol);
  var executionPrice = customPrice > 0 ? customPrice : (quote ? quote.close : 0);
  if (executionPrice <= 0) {
    throw new Error('종목 ' + cleanSymbol + '의 시세를 획득할 수 없어 실거래 주문을 생성할 수 없습니다.');
  }
  var amount = executionPrice * qty;
  var orderNo = 'N/A';
  
  if (!isOverseas) {
    // 🇰🇷 국내 주식 실거래 주문 송신
    var trId = (actionType === 'BUY') ? 'TTTC0802U' : 'TTTC0801U';
    var payload = {
      CANO: account.cano,
      ACNT_PRDT_CD: account.accountProductCode || '01',
      PDNO: cleanSymbol,
      ORD_DVSN: customPrice > 0 ? '00' : '01', // 지정가/시장가
      ORD_QTY: String(qty),
      ORD_UNPR: customPrice > 0 ? String(customPrice) : '0'
    };
    
    try {
      var response = kisPost_('/uapi/domestic-stock/v1/trading/order-cash', payload, trId, realAuth);
      orderNo = (response.output && response.output.ODNO) || 'N/A';
    } catch(err) {
      logWarn_('real_trading', 'Domestic real order failed', { error: err.message });
      throw new Error('한투 국내 실거래 주문 실패: ' + err.message);
    }
  } else {
    // 🇺🇸 해외 주식 실거래 주문 송신
    var trId = (actionType === 'BUY') ? 'TTTS3015U' : 'TTTS3020U';
    var exchangeCode = getOverseasExchangeCode_(cleanSymbol);
    
    var payload = {
      CANO: account.cano,
      ACNT_PRDT_CD: account.accountProductCode || '01',
      OVRS_EXCG_CD: exchangeCode,
      PDNO: cleanSymbol,
      ORD_QTY: String(qty),
      ORD_UNPR: String(Number(executionPrice).toFixed(2)),
      ORD_DVSN: '00',
      SLL_BUY_DVSN_CD: (actionType === 'BUY') ? '02' : '01'
    };
    
    try {
      var response = kisPost_('/uapi/overseas-stock/v1/trading/order', payload, trId, realAuth);
      orderNo = (response.output && response.output.ODNO) || 'N/A';
    } catch(err) {
      logWarn_('real_trading', 'Overseas real order failed', { error: err.message });
      throw new Error('한투 해외 실거래 주문 실패: ' + err.message);
    }
  }
  
  // REAL_LEDGER 기록
  appendObjectRow_(AM_CONFIG.SHEETS.REAL_LEDGER, {
    date: today,
    symbol: cleanSymbol,
    name: stockName,
    action_type: actionType,
    price: executionPrice,
    quantity: qty,
    amount: amount,
    realized_pl: 0,
    broker: 'KIS_REAL',
    created_at: amNowString_()
  });
  
  var successMsg = '⚠️ <b>[한투 실거래 주문 성공]</b> ' + actionType + ' ' + stockName + ' (' + cleanSymbol + ') ' + qty + '주 (주문번호: ' + orderNo + ')';
  logInfo_('real_trading', successMsg, { symbol: cleanSymbol, action: actionType, qty: qty, order_no: orderNo });
  
  try {
    sendTelegramMessage(successMsg);
  } catch(e) {}
  
  collectHoldingsCurrent();
  
  return {
    success: true,
    name: stockName,
    executionPrice: executionPrice,
    amount: amount,
    cash: 0,
    activePositions: []
  };
}

function executePaperOrder_(symbol, actionType, qty, customPrice, isAutoRebal) {
  var portMode = String(getScriptProperty_('PORTFOLIO_MODE', 'real')).toLowerCase();
  
  if (portMode === 'mock') {
    return executeMockOrder_(symbol, actionType, qty, customPrice);
  } else if (portMode === 'real') {
    return executeRealOrder_(symbol, actionType, qty, customPrice);
  }
  
  throw new Error('현재 운용 모드가 부적합합니다. (MODE: ' + portMode + ')');
}

/**
 * 🤖 VAA 퀀트 전략 시그널에 따른 가상매매 포트폴리오 자동 리밸런싱 집행 모듈
 */
function runPaperPortfolioQuantRebalancing_(vaaSignal) {
  if (!vaaSignal) {
    return { success: false, reason: '신규 퀀트 시그널이 유효하지 않습니다.' };
  }
  
  logInfo_('paper_rebalancing', 'Start auto rebalancing for signal: ' + vaaSignal);
  
  var portMode = String(getScriptProperty_('PORTFOLIO_MODE', 'real')).toLowerCase();
  var isMockMode = (portMode === 'mock');
  var isRealMode = (portMode === 'real');
  
  var activePositions = [];
  var cash = 0;
  
  if (isMockMode || isRealMode) {
    // 💡 모의 또는 실거래 투자 모드: 실제 KIS 잔고 데이터를 기반으로 작동
    var account = getKisAccountConfig_();
    var auth = null;
    var targetCano = account.cano;
    var targetProductCode = account.accountProductCode;
    
    if (isMockMode) {
      auth = (account.mockAppKey && account.mockAppSecret) ? {
        appKey: account.mockAppKey,
        appSecret: account.mockAppSecret,
        baseUrl: account.mockBaseUrl || 'https://openapivts.koreainvestment.com:29443'
      } : null;
      targetCano = account.mockCano;
      targetProductCode = account.mockProductCode;
    }
    
    // 국내/해외 잔고 통합 조회
    try {
      var domRes = fetchKisDomesticAccountBalance_(targetCano, targetProductCode, auth);
      var sourceName = isMockMode ? 'mock_trading' : 'kis_inquire_balance';
      var domNorm = normalizeKisAccountBalance_(domRes, sourceName);
      cash = domNorm.snapshot.cash_amount || 0;
      activePositions = domNorm.holdings.map(function(h) {
        return { symbol: h.symbol, quantity: h.quantity, name: h.name };
      });
      
      // 해외 잔고 및 예수금 융합 (VAA 전략 미국 ETF 반영을 위함)
      var usdRate = 1350;
      try {
        var liveRate = getLiveUsdRate_();
        if (liveRate > 500) usdRate = liveRate;
      } catch(e) {}
      
      var nasRes = fetchKisOverseasAccountBalance_('NASD', targetCano, targetProductCode, auth);
      var nasNorm = normalizeKisOverseasAccountBalance_(nasRes);
      nasNorm.holdings.forEach(function(h) {
        activePositions.push({ symbol: h.symbol, quantity: h.quantity, name: h.name });
      });
      
      var frCash = (nasNorm.snapshot.cash_amount || 0) * usdRate;
      cash += frCash;
    } catch(err) {
      logWarn_('paper_rebalancing', 'Failed to retrieve live balance for VAA rebalancing', { error: err.message });
      return { success: false, reason: '실시간 잔고 조회 실패' };
    }
  } else {
    // 💡 페이퍼 트레이딩 모드 (로컬 가상 장부 기반)
    var paperRows = readObjects_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO);
    var lastPaper = paperRows.length > 0 ? paperRows[paperRows.length - 1] : null;
    if (!lastPaper) {
      // 잔고가 아예 없으면 1000만원 디폴트 계좌로 초기화
      lastPaper = {
        cash_amount: 10000000,
        stock_eval_amount: 0,
        total_eval_amount: 10000000,
        active_positions_json: '[]'
      };
    }
    activePositions = JSON.parse(lastPaper.active_positions_json || '[]');
    cash = parseFloat(lastPaper.cash_amount || 0);
  }
  
  var logs = [];
  
  // 2. 다른 주식들 전량 매도 (동기 순차 체결)
  var isSameHolding = false;
  activePositions.forEach(function(pos) {
    var sym = normalizeStockSymbol_(pos.symbol);
    var targetSym = normalizeStockSymbol_(vaaSignal);
    if (sym === targetSym) {
      isSameHolding = true;
    } else {
      try {
        var sellQty = pos.quantity;
        var sellRes = executePaperOrder_(sym, 'SELL', sellQty, 0, true);
        logs.push('✅ <b>기존 자산 청산 완료</b>: ' + sellRes.name + ' (' + sym + ') ' + sellQty + '주 매도');
      } catch(sellErr) {
        logs.push('❌ <b>기존 자산 청산 실패</b> (' + sym + '): ' + sellErr.message);
      }
    }
  });
  
  // 3. 동일한 종목을 이미 올바르게 100% 쥐고 있다면 추가 매매 생략
  if (isSameHolding && activePositions.length === 1) {
    logs.push('ℹ️ <b>포트폴리오 유지</b>: 이미 신규 시그널(' + vaaSignal + ')과 동일한 단일 자산을 100% 보유하고 있어 리밸런싱을 생략합니다.');
    return {
      success: true,
      logs: logs,
      summary: '포트폴리오 변동 없음 (유지)'
    };
  }
  
  // 4. 매도 후 갱신된 최신 예수금 조회
  if (isMockMode || isRealMode) {
    Utilities.sleep(3000); // 🚀 KIS 주문 체결 및 예수금 반영 대기 (3초)
    try {
      var account = getKisAccountConfig_();
      var auth = null;
      var targetCano = account.cano;
      var targetProductCode = account.accountProductCode;
      
      if (isMockMode) {
        auth = (account.mockAppKey && account.mockAppSecret) ? {
          appKey: account.mockAppKey,
          appSecret: account.mockAppSecret,
          baseUrl: account.mockBaseUrl || 'https://openapivts.koreainvestment.com:29443'
        } : null;
        targetCano = account.mockCano;
        targetProductCode = account.mockProductCode;
      }
      
      var domRes = fetchKisDomesticAccountBalance_(targetCano, targetProductCode, auth);
      var sourceName = isMockMode ? 'mock_trading' : 'kis_inquire_balance';
      var domNorm = normalizeKisAccountBalance_(domRes, sourceName);
      cash = domNorm.snapshot.cash_amount || 0;
      
      var usdRate = 1350;
      try {
        var liveRate = getLiveUsdRate_();
        if (liveRate > 500) usdRate = liveRate;
      } catch(e) {}
      
      var nasRes = fetchKisOverseasAccountBalance_('NASD', targetCano, targetProductCode, auth);
      var nasNorm = normalizeKisOverseasAccountBalance_(nasRes);
      cash += (nasNorm.snapshot.cash_amount || 0) * usdRate;
    } catch(e) {
      logWarn_('paper_rebalancing', 'Failed to retrieve updated cash for VAA rebalancing', { error: e.message });
    }
  } else {
    var updatedPaperRows = readObjects_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO);
    var latestPaper = updatedPaperRows.length > 0 ? updatedPaperRows[updatedPaperRows.length - 1] : { cash_amount: cash };
    cash = parseFloat(latestPaper.cash_amount || 0);
  }
  
  if (cash <= 1000) {
    logs.push('⚠️ <b>매수 생략</b>: 가용 예수금 잔고(' + formatNumber_(cash) + '원)가 부족합니다.');
    return { success: false, logs: logs, reason: '예수금 부족' };
  }
  
  // 5. 신규 자산 가격 스캔 및 매수 최대 수량 환산
  var quote = null;
  var cleanSignal = normalizeStockSymbol_(vaaSignal);
  try {
    var isUs = /^[A-Za-z]/.test(cleanSignal);
    if (isUs) {
      try { quote = fetchKisOverseasCurrentPrice_(cleanSignal); } catch(e) { quote = fetchYahooOverseasCurrentPrice_(cleanSignal); }
    } else {
      try { quote = fetchKisCurrentPrice_(cleanSignal); } catch(e) { quote = fetchNaverStockPrice_(cleanSignal); }
    }
  } catch(e) {
    logs.push('❌ <b>시세 스캔 실패</b> (' + vaaSignal + '): ' + e.message);
    return { success: false, logs: logs, reason: '시세 획득 실패' };
  }
  
  var price = quote ? quote.close : 0;
  if (price <= 0) {
    logs.push('❌ <b>시세 획득 불능</b>: ' + vaaSignal + ' 현재가가 0이하입니다.');
    return { success: false, logs: logs, reason: '시세 불능' };
  }
  
  // 슬리피지(0.1%)를 반영한 예상 매수 단가
  var estPrice = price * 1.001; 
  var buyQty = Math.floor(cash / estPrice);
  
  if (buyQty <= 0) {
    logs.push('⚠️ <b>수량 부족</b>: 예수금(' + formatNumber_(cash) + '원) 대비 단가(' + formatNumber_(price) + '원)가 너무 높아 1주도 살 수 없습니다.');
    return { success: false, logs: logs, reason: '매수 수량 0주' };
  }
  
  // 6. 신규 자산 매수 집행
  try {
    var buyRes = executePaperOrder_(cleanSignal, 'BUY', buyQty, 0, true);
    logs.push('✅ <b>신규 자산 편입 완료</b>: ' + buyRes.name + ' (' + cleanSignal + ') ' + buyQty + '주 매수 (체결가: ' + formatNumber_(buyRes.executionPrice) + '원)');
    
    var finalEval = cash;
    if (!(isMockMode || isRealMode)) {
      var finalPaperRows = readObjects_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO);
      var finalPaper = finalPaperRows[finalPaperRows.length - 1];
      finalEval = finalPaper ? finalPaper.total_eval_amount : cash;
    }
    
    return {
      success: true,
      logs: logs,
      summary: isRealMode ? 'VAA 자동 실거래 매매 완료' : 'VAA 자동 모의 매매 완료',
      total_eval: finalEval
    };
  } catch(buyErr) {
    logs.push('❌ <b>신규 자산 편입 실패</b> (' + cleanSignal + '): ' + buyErr.message);
    return { success: false, logs: logs, reason: '매수 집행 실패: ' + buyErr.message };
  }
}

/**
 * 🚀 웹앱 대시보드 요청에 따라 최근 가상매매 체결 내역(Paper Ledger) 반환
 */
function getPaperLedgerDataForWeb() {
  ensureAllSheets_();
  var sheetName = AM_CONFIG.SHEETS.PAPER_LEDGER;
  var rows = [];
  try {
    rows = readObjects_(sheetName);
  } catch(e) {
    logWarn_('paper_trading_api', 'Failed to read PAPER_LEDGER sheet', { error: e.message });
  }
  
  if (!rows || rows.length === 0) {
    return [];
  }
  
  var webData = rows.map(function(r) {
    return {
      date: normalizeDateValue_(r.date || r.created_at || ''),
      symbol: String(r.symbol || '').trim(),
      name: String(r.name || '').trim(),
      actionType: String(r.action_type || 'BUY').toUpperCase().trim(),
      price: parseFloat(r.price || 0),
      quantity: parseFloat(r.quantity || 0),
      amount: parseFloat(r.amount || 0),
      reason: String(r.reason || '').trim(),
      createdAt: String(r.created_at || '').trim()
    };
  });
  
  // 최근 체결 순으로 정렬 (역순)
  webData.reverse();
  
  // 최대 50건까지만 노출
  return webData.slice(0, 50);
}

/**
 * 🤖 퀀트 전용 (국내/해외 각각 300만원 시드) 가상 매매 집행기
 */
function executeQuantPaperOrder_(type, symbol, actionType, qty, customPrice) {
  var today = amTodayString_();
  var cleanSymbol = normalizeStockSymbol_(symbol);
  var sheetName = (type === 'DOM') ? AM_CONFIG.SHEETS.PAPER_PORTFOLIO_DOM : AM_CONFIG.SHEETS.PAPER_PORTFOLIO_US;
  
  var quote = null;
  try {
    var isUs = /^[A-Za-z]/.test(cleanSymbol);
    if (isUs) {
      try { quote = fetchKisOverseasCurrentPrice_(cleanSymbol); } catch(e) { quote = fetchYahooOverseasCurrentPrice_(cleanSymbol); }
    } else {
      try { quote = fetchKisCurrentPrice_(cleanSymbol); } catch(e) { quote = fetchNaverStockPrice_(cleanSymbol); }
    }
  } catch(e) {}
  
  var currentPrice = customPrice > 0 ? customPrice : (quote ? quote.close : 0);
  if (currentPrice <= 0) {
    throw new Error(cleanSymbol + ' 실시간 가격 스캔 실패로 퀀트 모의 매매 체결이 불가능합니다.');
  }
  
  // 슬리피지(Slippage) 0.1% 페널티 적용
  var slippageRate = 0.001;
  var executionPrice = currentPrice;
  if (actionType === 'BUY') {
    executionPrice = currentPrice * (1 + slippageRate);
  } else if (actionType === 'SELL') {
    executionPrice = currentPrice * (1 - slippageRate);
  }
  
  if (type === 'DOM') {
    executionPrice = Math.round(executionPrice);
  } else {
    executionPrice = roundNumber_(executionPrice, 2);
  }
  
  var amount = executionPrice * qty;
  if (type === 'DOM') {
    amount = Math.round(amount);
  } else {
    amount = roundNumber_(amount, 2);
  }
  
  var rows = readObjects_(sheetName);
  
  // 최초 시드 금액 세팅 (US는 달러 환산)
  var usdRate = 1350;
  try {
    var liveRate = getLiveUsdRate_();
    if (liveRate > 500) usdRate = liveRate;
  } catch(e) {}
  
  var seedCash = (type === 'DOM') ? 3000000 : roundNumber_(3000000 / usdRate, 2);
  
  var lastRecord = rows.length > 0 ? rows[rows.length - 1] : {
    cash_amount: seedCash,
    stock_eval_amount: 0,
    total_eval_amount: seedCash,
    active_positions_json: '[]'
  };
  
  var cash = parseFloat(lastRecord.cash_amount || 0);
  var activePositions = JSON.parse(lastRecord.active_positions_json || '[]');
  
  var stockName = getStockKoreanName_(cleanSymbol, quote ? quote.name : cleanSymbol);
  var found = -1;
  for (var i = 0; i < activePositions.length; i++) {
    if (normalizeStockSymbol_(activePositions[i].symbol) === cleanSymbol) {
      found = i;
      break;
    }
  }
  
  if (actionType === 'BUY') {
    if (cash < amount) {
      var currencySymbol = (type === 'DOM') ? '원' : '달러';
      throw new Error(type + ' 퀀트예수금 부족! 잔고: ' + formatNumber_(cash) + currencySymbol + ', 필요액: ' + formatNumber_(amount) + currencySymbol);
    }
    cash -= amount;
    if (found >= 0) {
      var p = activePositions[found];
      var totalCost = (p.quantity * p.entry_price) + amount;
      p.quantity += qty;
      p.entry_price = (type === 'DOM') ? Math.round(totalCost / p.quantity) : roundNumber_(totalCost / p.quantity, 4);
      p.eval_amount = p.quantity * executionPrice;
    } else {
      activePositions.push({
        symbol: cleanSymbol,
        name: stockName,
        quantity: qty,
        entry_price: executionPrice,
        eval_amount: amount
      });
    }
  } else if (actionType === 'SELL') {
    if (found < 0 || activePositions[found].quantity < qty) {
      throw new Error(type + ' 보유 수량 부족! 현재: ' + (found >= 0 ? activePositions[found].quantity : 0) + '주, 요청: ' + qty + '주');
    }
    cash += amount;
    var p = activePositions[found];
    p.quantity -= qty;
    p.eval_amount = p.quantity * executionPrice;
    if (p.quantity <= 0) {
      activePositions.splice(found, 1);
    }
  }
  
  if (type === 'DOM') {
    activePositions.forEach(function(item) { item.eval_amount = Math.round(item.eval_amount); });
  } else {
    activePositions.forEach(function(item) { item.eval_amount = roundNumber_(item.eval_amount, 2); });
  }
  
  var stockEval = activePositions.reduce(function(sum, item) { return sum + item.eval_amount; }, 0);
  var total = cash + stockEval;
  
  if (type === 'DOM') {
    cash = Math.round(cash);
    stockEval = Math.round(stockEval);
    total = Math.round(total);
  } else {
    cash = roundNumber_(cash, 2);
    stockEval = roundNumber_(stockEval, 2);
    total = roundNumber_(total, 2);
  }
  
  var cumulativeReturn = ((total - seedCash) / seedCash) * 100;
  
  var newRecord = {
    date: today,
    cash_amount: cash,
    stock_eval_amount: stockEval,
    total_eval_amount: total,
    cumulative_return_pct: roundNumber_(cumulativeReturn, 2),
    active_positions_json: JSON.stringify(activePositions)
  };
  
  appendObjectRow_(sheetName, newRecord);
  
  // 통합 모의거래 대장에 기록 남기기
  appendObjectRow_(AM_CONFIG.SHEETS.PAPER_LEDGER, {
    date: today,
    symbol: cleanSymbol,
    name: stockName,
    action_type: actionType,
    price: executionPrice,
    quantity: qty,
    amount: amount,
    reason: type + ' 퀀트 팩터 모의투자 체결 (슬리피지 0.1% 반영)',
    created_at: amNowString_()
  });
  
  logInfo_('paper_trading_quant', 'Executed quant paper order for ' + type, { symbol: cleanSymbol, action: actionType, qty: qty, price: executionPrice });
}

/**
 * 🤖 퀀트 계좌 리밸런싱 실행기 (국내/해외 구분형)
 */
function runQuantPortfolioRebalancing_(type, targetSymbols) {
  if (!targetSymbols || targetSymbols.length === 0) {
    logWarn_('quant_rebalancing', 'No target symbols provided for ' + type + ' quant rebalancing.');
    return;
  }
  
  logInfo_('quant_rebalancing', 'Start quant rebalancing for ' + type + '. Targets: ' + targetSymbols.join(','));
  
  var portMode = String(getScriptProperty_('PORTFOLIO_MODE', 'real')).toLowerCase();
  var isMockMode = (portMode === 'mock');
  var isRealMode = (portMode === 'real');
  
  if (!isMockMode && !isRealMode) {
    logWarn_('quant_rebalancing', 'Quant auto rebalancing skipped. Current mode is PAPER/Other. Please switch to MOCK or REAL mode.');
    return;
  }
  
  var account = getKisAccountConfig_();
  var auth = null;
  var targetCano = account.cano;
  var targetProductCode = account.accountProductCode;
  
  if (isMockMode) {
    auth = (account.mockAppKey && account.mockAppSecret) ? {
      appKey: account.mockAppKey,
      appSecret: account.mockAppSecret,
      baseUrl: account.mockBaseUrl || 'https://openapivts.koreainvestment.com:29443'
    } : null;
    targetCano = account.mockCano;
    targetProductCode = account.mockProductCode;
  }
  
  var activePositions = [];
  var cash = 0;
  
  // 1. KIS 잔고로부터 현재 보유 종목 및 예수금 획득
  try {
    if (type === 'DOM') {
      var domRes = fetchKisDomesticAccountBalance_(targetCano, targetProductCode, auth);
      var sourceName = isMockMode ? 'mock_trading' : 'kis_inquire_balance';
      var domNorm = normalizeKisAccountBalance_(domRes, sourceName);
      cash = domNorm.snapshot.cash_amount || 0;
      activePositions = domNorm.holdings.map(function(h) {
        return { symbol: h.symbol, quantity: h.quantity, name: h.name };
      });
    } else {
      var usdRate = 1350;
      try {
        var liveRate = getLiveUsdRate_();
        if (liveRate > 500) usdRate = liveRate;
      } catch(e) {}
      
      var nasRes = fetchKisOverseasAccountBalance_('NASD', targetCano, targetProductCode, auth);
      var nasNorm = normalizeKisOverseasAccountBalance_(nasRes);
      cash = (nasNorm.snapshot.cash_amount || 0) * usdRate;
      activePositions = nasNorm.holdings.map(function(h) {
        return { symbol: h.symbol, quantity: h.quantity, name: h.name };
      });
    }
  } catch(err) {
    logWarn_('quant_rebalancing', 'Failed to retrieve live balance for ' + type + ' quant rebalancing', { error: err.message });
    return;
  }
  
  // 2. 타겟 종목이 아닌 기존 보유 종목 전량 매도 처리
  activePositions.forEach(function(pos) {
    var sym = normalizeStockSymbol_(pos.symbol);
    var isTarget = targetSymbols.some(function(ts) {
      return normalizeStockSymbol_(ts) === sym;
    });
    
    if (!isTarget) {
      try {
        var sellQty = pos.quantity;
        executePaperOrder_(sym, 'SELL', sellQty, 0);
        logInfo_('quant_rebalancing', 'Cleared non-target position: ' + pos.name + ' (' + sym + ') ' + sellQty + '주 매도');
      } catch(sellErr) {
        logWarn_('quant_rebalancing', 'Failed to sell position ' + sym + ' during rebalancing', { error: sellErr.message });
      }
    }
  });
  
  // 3. 매도 주문 체결 및 예수금 반영 대기 (3초)
  Utilities.sleep(3000);
  
  // 4. 매도 후 갱신된 예수금 다시 조회
  try {
    if (type === 'DOM') {
      var domRes = fetchKisDomesticAccountBalance_(targetCano, targetProductCode, auth);
      var sourceName = isMockMode ? 'mock_trading' : 'kis_inquire_balance';
      var domNorm = normalizeKisAccountBalance_(domRes, sourceName);
      cash = domNorm.snapshot.cash_amount || 0;
    } else {
      var usdRate = 1350;
      try {
        var liveRate = getLiveUsdRate_();
        if (liveRate > 500) usdRate = liveRate;
      } catch(e) {}
      var nasRes = fetchKisOverseasAccountBalance_('NASD', targetCano, targetProductCode, auth);
      var nasNorm = normalizeKisOverseasAccountBalance_(nasRes);
      cash = (nasNorm.snapshot.cash_amount || 0) * usdRate;
    }
  } catch(e) {
    logWarn_('quant_rebalancing', 'Failed to retrieve updated cash after clearance', { error: e.message });
  }
  
  if (cash <= 1000) {
    logWarn_('quant_rebalancing', 'Insufficient cash for ' + type + ' quant rebalancing: ' + cash);
    return;
  }
  
  // 5. 신규 타겟 종목 균등 분할 매수
  var count = targetSymbols.length;
  var allocationPerStock = cash / count;
  
  targetSymbols.forEach(function(symbol) {
    var cleanSignal = normalizeStockSymbol_(symbol);
    
    var alreadyHeld = activePositions.some(function(pos) {
      return normalizeStockSymbol_(pos.symbol) === cleanSignal;
    });
    
    if (!alreadyHeld) {
      try {
        var quote = null;
        var isUs = /^[A-Za-z]/.test(cleanSignal);
        if (isUs) {
          try { quote = fetchKisOverseasCurrentPrice_(cleanSignal); } catch(e) { quote = fetchYahooOverseasCurrentPrice_(cleanSignal); }
        } else {
          try { quote = fetchKisCurrentPrice_(cleanSignal); } catch(e) { quote = fetchNaverStockPrice_(cleanSignal); }
        }
        
        var price = quote ? quote.close : 0;
        if (price > 0) {
          var estPrice = price * 1.001; // 슬리피지 감안
          var buyQty = 0;
          
          if (isUs) {
            var usdRate = 1350;
            try {
              var liveRate = getLiveUsdRate_();
              if (liveRate > 500) usdRate = liveRate;
            } catch(e) {}
            var allocationUsd = allocationPerStock / usdRate;
            buyQty = Math.floor(allocationUsd / estPrice);
          } else {
            buyQty = Math.floor(allocationPerStock / estPrice);
          }
          
          if (buyQty > 0) {
            executePaperOrder_(cleanSignal, 'BUY', buyQty, 0);
            logInfo_('quant_rebalancing', ' 편입 완료: ' + cleanSignal + ' ' + buyQty + '주 매수');
          }
        }
      } catch(buyErr) {
        logWarn_('quant_rebalancing', 'Failed to buy ' + cleanSignal + ' during ' + type + ' rebalancing', { error: buyErr.message });
      }
    }
  });
}

/**
 * 🚀 설정(settings) 시트에서 종목별/현금 목표 비중을 동적 추출하여
 * 현재 보유 자산과의 실시간 괴리율(Drift)을 연산하고 포맷팅해 반환
 */
function calculatePortfolioDrift_(holdings) {
  var targetWeights = {};
  
  // 1. settings 시트에서 TARGET_WEIGHT_ 로 시작하는 목표 비중 파싱
  try {
    var settingsRows = readObjects_(AM_CONFIG.SHEETS.SETTINGS) || [];
    settingsRows.forEach(function(row) {
      var key = String(row.key || '').trim();
      var val = parseFloat(row.value);
      if (key.indexOf('TARGET_WEIGHT_') === 0 && !isNaN(val)) {
        var symbol = key.replace('TARGET_WEIGHT_', '').trim().toUpperCase();
        targetWeights[symbol] = val;
      }
    });
  } catch(e) {
    logWarn_('portfolio_drift', 'Failed to load target weights from Settings', { error: e.message });
  }
  
  // 2. 전체 자산 평가액 합산 (현금 + 주식)
  var totalEval = 0;
  holdings.forEach(function(h) {
    totalEval += parseFloat(h.eval_amount || 0);
  });
  
  var driftList = [];
  
  // 3. 종목별 실시간 비중 및 괴리율 연산
  holdings.forEach(function(h) {
    var symbol = normalizeStockSymbol_(h.symbol);
    var name = h.name || symbol;
    var currentWeight = totalEval > 0 ? ((parseFloat(h.eval_amount || 0) / totalEval) * 100) : 0;
    
    // settings 시트에 목표 비중이 명시되어 있는지 확인
    var targetWeight = targetWeights[symbol];
    var isSpecified = (targetWeight !== undefined);
    
    if (!isSpecified) {
      targetWeight = 0; // 명시되지 않은 경우 0%로 기본값 처리
    }
    
    var drift = currentWeight - targetWeight;
    
    driftList.push({
      name: name,
      symbol: symbol,
      currentWeight: roundNumber_(currentWeight, 2),
      targetWeight: roundNumber_(targetWeight, 2),
      drift: roundNumber_(drift, 2),
      isSpecified: isSpecified,
      source: h.source
    });
  });
  
  return driftList;
}
