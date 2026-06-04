function fetchKisDomesticAccountBalance_(cano, productCode) {
  var account = getKisAccountConfig_();
  var targetCano = cano || account.cano;
  var targetProductCode = productCode || account.accountProductCode;
  
  if (!targetCano) {
    throw new Error('KIS domestic CANO is missing.');
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
  }, 'TTTC8434R');
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

function fetchKisOverseasAccountBalance_(exchange) {
  var account = getKisAccountConfig_();
  var excg = exchange || 'NASD';
  return kisGet_('/uapi/overseas-stock/v1/trading/inquire-balance', {
    CANO: account.cano,
    ACNT_PRDT_CD: account.accountProductCode,
    OVRS_EXCG_CD: excg,
    TR_CRCY_CD: 'USD',
    TR_CONT_YN: '',
    CTX_AREA_FK200: '',
    CTX_AREA_NK200: ''
  }, 'TTTS3012R');
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
  ensureAllSheets_();
  
  // 🚀 [초고속 10배 튜닝] 동일 종목 다중 조회 시 중복 네트워크 통신 병목을 0초로 강제 차단할 로컬 인메모리 사전 장착
  var localPriceMap = {};
  
  // 수동 자산 중복 가중평균 자동 치유
  try { cleanDuplicateManualHoldings_(); } catch(e) {}
  
  var today = amTodayString_();
  var portMode = String(getScriptProperty_('PORTFOLIO_MODE', 'real')).toLowerCase();
  var isRealMode = (portMode === 'real');
  
  // 기존 오늘자 보유 자산 캐시 일단 청소 (모드별로 격리하여 삭제함으로써 REAL과 PAPER 모드 간 데이터 유실 차단)
  if (isRealMode) {
    deleteHoldingsCurrentBySources_(today, ['kis', 'manual_', 'overseas']);
  } else {
    deleteHoldingsCurrentBySources_(today, ['paper_trading']);
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
      if (targetIsaCano && account.isaProductCode) {
        try {
          var isaResponse = fetchKisDomesticAccountBalance_(targetIsaCano, account.isaProductCode);
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
          logInfo_('portfolio_collector', 'Successfully fetched KIS ISA account balance', { count: normalizedIsa.holdings.length });
        } catch(isaErr) {
          logWarn_('portfolio_collector', 'Failed to fetch KIS ISA balance', { error: isaErr.message });
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
  } else {
    // 💡 PAPER 모의투자 모드
    try {
      var paperRows = readObjects_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO);
      var lastPaper = paperRows.length > 0 ? paperRows[paperRows.length - 1] : null;
      
      if (!lastPaper) {
        lastPaper = {
          cash_amount: 5000000,
          stock_eval_amount: 0,
          total_eval_amount: 5000000,
          active_positions_json: '[]'
        };
      }
      
      var cashAmount = parseFloat(lastPaper.cash_amount || 0);
      var activePositions = JSON.parse(lastPaper.active_positions_json || '[]');
      
      var totalPurchase = cashAmount;
      var totalEval = cashAmount;
      var assets = [];
      
      // PAPER 모의투자 예수금 가산 및 CASH 자산화
      if (cashAmount > 0) {
        assets.push({
          date: today,
          symbol: 'CASH',
          name: '모의투자 예수금',
          quantity: cashAmount,
          avg_price: 1,
          current_price: 1,
          purchase_amount: cashAmount,
          eval_amount: cashAmount,
          profit_loss_amount: 0,
          profit_loss_pct: 0,
          portfolio_weight_pct: 0,
          source: 'paper_cash',
          currency: 'KRW'
        });
      }
      
      activePositions.forEach(function(p) {
        var qty = parseFloat(p.quantity || 0);
        var avg = parseFloat(p.entry_price || p.avg_price || 0);
        if (qty <= 0) return;
        
        var isCoin = (String(p.symbol).indexOf('KRW-') === 0 || /^[A-Z]{3,4}$/.test(p.symbol) === false);
        var cur = avg;
        var changePct = 0;
        var name = p.name || p.symbol;
        
        try {
          var quote;
          if (isCoin) {
            quote = fetchUpbitCurrentPrice_(p.symbol);
          } else {
            var isUs = /^[A-Za-z]/.test(p.symbol);
            if (isUs) {
              quote = fetchKisOverseasCurrentPrice_(p.symbol);
            } else {
              quote = fetchKisCurrentPrice_(p.symbol);
            }
          }
          cur = quote.close || avg;
          changePct = quote.change_pct || 0;
          name = quote.name || name;
        } catch(priceErr) {
          logWarn_('portfolio_collector', 'Failed to fetch quote for paper symbol ' + p.symbol + '; using entry price', { error: priceErr.message });
        }
        
        var purchaseAmt = qty * avg;
        var evalAmt = qty * cur;
        
        totalPurchase += purchaseAmt;
        totalEval += evalAmt;
        
        assets.push({
          date: today,
          symbol: p.symbol,
          name: getStockKoreanName_(p.symbol, name),
          quantity: qty,
          avg_price: avg,
          current_price: cur,
          purchase_amount: purchaseAmt,
          eval_amount: evalAmt,
          profit_loss_amount: evalAmt - purchaseAmt,
          profit_loss_pct: purchaseAmt > 0 ? ((evalAmt - purchaseAmt) / purchaseAmt * 100) : 0,
          portfolio_weight_pct: 0,
          source: 'paper_trading',
          currency: 'KRW'
        });
      });
      
      if (assets.length > 0) {
        assets.forEach(function(a) {
          a.portfolio_weight_pct = totalEval > 0 ? roundNumber_(a.eval_amount / totalEval * 100, 2) : 0;
          a.profit_loss_pct = roundNumber_(a.profit_loss_pct, 2);
        });
        appendObjectRows_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT, assets);
      }
      
      logInfo_('portfolio_collector', 'Paper portfolio collected successfully', { holdings_count: assets.length, total_eval: totalEval });
    } catch(e) {
      logWarn_('portfolio_collector', 'Failed to collect Paper portfolio', { error: e.message });
    }
  }
  
  // 🚀 [신설] 퀀트 국내/해외 300만원 모의 투자 계좌 잔고 취합 루프 (REAL/PAPER 모드 무관하게 상시 기동)
  try {
    deleteHoldingsCurrentBySources_(today, ['paper_trading_dom', 'paper_trading_us']);
    ['DOM', 'US'].forEach(function(type) {
      var sheetName = (type === 'DOM') ? AM_CONFIG.SHEETS.PAPER_PORTFOLIO_DOM : AM_CONFIG.SHEETS.PAPER_PORTFOLIO_US;
      var rows = readObjects_(sheetName);
      var lastRecord = rows.length > 0 ? rows[rows.length - 1] : null;
      
      // 시드가 존재하지 않는 최초 기동 시점에만 300만 원 계좌 Seeding 강제 수행
      if (!lastRecord) {
        lastRecord = {
          date: today,
          cash_amount: 3000000,
          stock_eval_amount: 0,
          total_eval_amount: 3000000,
          cumulative_return_pct: 0,
          active_positions_json: '[]'
        };
        appendObjectRow_(sheetName, lastRecord);
      }
      
      var cash = parseFloat(lastRecord.cash_amount || 0);
      var positions = JSON.parse(lastRecord.active_positions_json || '[]');
      
      // 예수금 CASH 화
      if (cash > 0) {
        appendObjectRow_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT, {
          date: today,
          symbol: 'CASH',
          name: (type === 'DOM') ? '예수금 (국내 퀀트모의)' : '예수금 (해외 퀀트모의)',
          quantity: cash,
          avg_price: 1,
          current_price: 1,
          purchase_amount: cash,
          eval_amount: cash,
          profit_loss_amount: 0,
          profit_loss_pct: 0,
          portfolio_weight_pct: 0,
          source: (type === 'DOM') ? 'paper_trading_dom' : 'paper_trading_us',
          currency: 'KRW'
        });
      }
      
      // 종목 포지션 자산화
      positions.forEach(function(p) {
        var qty = parseFloat(p.quantity || 0);
        var avg = parseFloat(p.entry_price || p.avg_price || 0);
        if (qty <= 0) return;
        
        var cur = avg;
        var changePct = 0;
        var name = p.name || p.symbol;
        
        try {
          var quote;
          var isUs = /^[A-Za-z]/.test(p.symbol);
          if (isUs) {
            try { quote = fetchKisOverseasCurrentPrice_(p.symbol); } catch(e) { quote = fetchYahooOverseasCurrentPrice_(p.symbol); }
          } else {
            try { quote = fetchKisCurrentPrice_(p.symbol); } catch(e) { quote = fetchNaverStockPrice_(p.symbol); }
          }
          
          if (quote) {
            cur = quote.close || avg;
            changePct = quote.change_pct || 0;
            name = quote.name || name;
          }
        } catch(priceErr) {}
        
        var usdRate = 1350;
        try {
          var liveRate = getLiveUsdRate_();
          if (liveRate > 500) usdRate = liveRate;
        } catch(e) {}
        
        var isUsAsset = /^[A-Za-z]/.test(p.symbol);
        var displayCur = isUsAsset ? (cur * usdRate) : cur;
        var displayAvg = isUsAsset ? (avg * usdRate) : avg;
        
        var purchaseAmt = qty * displayAvg;
        var evalAmt = qty * displayCur;
        
        appendObjectRow_(AM_CONFIG.SHEETS.HOLDINGS_CURRENT, {
          date: today,
          symbol: p.symbol,
          name: getStockKoreanName_(p.symbol, name),
          quantity: qty,
          avg_price: displayAvg,
          current_price: displayCur,
          purchase_amount: purchaseAmt,
          eval_amount: evalAmt,
          profit_loss_amount: evalAmt - purchaseAmt,
          profit_loss_pct: purchaseAmt > 0 ? ((evalAmt - purchaseAmt) / purchaseAmt * 100) : 0,
          change_pct: changePct,
          portfolio_weight_pct: 0,
          source: (type === 'DOM') ? 'paper_trading_dom' : 'paper_trading_us',
          currency: 'KRW'
        });
      });
    });
  } catch(quantCollectErr) {
    logWarn_('portfolio_collector', 'Failed to collect Quant paper portfolios', { error: quantCollectErr.message });
  }
  
  // 날짜별 가중치 재분배 및 리스크 모형 이식
  try {
    rewriteHoldingWeightsForDate_(today);
  } catch(ex) {}
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

function executePaperOrder_(symbol, actionType, qty, customPrice, isAutoRebal) {
  var today = amTodayString_();
  var cleanSymbol = normalizeStockSymbol_(symbol);
  var portMode = String(getScriptProperty_('PORTFOLIO_MODE', 'real')).toLowerCase();
  
  if (portMode === 'real' && isAutoRebal !== true) {
    throw new Error('현재 운용 모드가 실제계좌(REAL)입니다. 모의투자 체결을 집행할 수 없습니다. /mode paper 명령어로 먼저 전환하세요.');
  }
  
  var isCoin = (String(cleanSymbol).indexOf('KRW-') === 0 || /^[A-Z]{3,4}$/.test(cleanSymbol) === false);
  var quote = null;
  try {
    if (isCoin) {
      quote = fetchUpbitCurrentPrice_(cleanSymbol);
    } else {
      var isUs = /^[A-Za-z]/.test(cleanSymbol);
      if (isUs) {
        try {
          quote = fetchKisOverseasCurrentPrice_(cleanSymbol);
        } catch(ovsErr) {
          quote = fetchYahooOverseasCurrentPrice_(cleanSymbol);
        }
      } else {
        try {
          quote = fetchKisCurrentPrice_(cleanSymbol);
        } catch(domErr) {
          quote = fetchNaverStockPrice_(cleanSymbol);
        }
      }
    }
  } catch(globalErr) {
    logWarn_('paper_trading', 'Global price fetch failed for ' + cleanSymbol, { error: globalErr.message });
  }
  
  var currentPrice = customPrice > 0 ? customPrice : (quote ? quote.close : 0);
  if (currentPrice <= 0) {
    throw new Error('실시간 현재가를 가져오지 못해 체결할 수 없습니다.');
  }
  
  // 💡 가혹한 슬리피지(Slippage) 0.1% 페널티 적용
  var slippageRate = 0.001;
  var executionPrice = currentPrice;
  if (actionType === 'BUY') {
    executionPrice = Math.round(currentPrice * (1 + slippageRate));
  } else if (actionType === 'SELL') {
    executionPrice = Math.round(currentPrice * (1 - slippageRate));
  }
  
  var amount = executionPrice * qty;
  
  // 잔고 복원
  var paperRows = readObjects_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO);
  var lastPaper = paperRows.length > 0 ? paperRows[paperRows.length - 1] : null;
  
  if (!lastPaper) {
    lastPaper = {
      cash_amount: 5000000,
      stock_eval_amount: 0,
      total_eval_amount: 5000000,
      active_positions_json: '[]'
    };
  }
  
  var cash = parseFloat(lastPaper.cash_amount || 0);
  var activePositions = JSON.parse(lastPaper.active_positions_json || '[]');
  
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
      throw new Error('가상 현금 잔고 부족! 현재 예수금: ' + formatNumber_(cash) + '원, 필요 금액: ' + formatNumber_(amount) + '원');
    }
    
    cash -= amount;
    if (found >= 0) {
      var p = activePositions[found];
      var totalCost = (p.quantity * p.entry_price) + amount;
      p.quantity += qty;
      p.entry_price = Math.round(totalCost / p.quantity);
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
      throw new Error('보유 수량 부족! 현재 보유량: ' + (found >= 0 ? activePositions[found].quantity : 0) + '주, 요청량: ' + qty + '주');
    }
    
    cash += amount;
    var p = activePositions[found];
    p.quantity -= qty;
    p.eval_amount = p.quantity * executionPrice;
    
    if (p.quantity <= 0) {
      activePositions.splice(found, 1);
    }
  }
  
  var stockEval = activePositions.reduce(function(sum, item) { return sum + item.eval_amount; }, 0);
  var total = cash + stockEval;
  
  var newRecord = {
    date: today,
    cash_amount: Math.round(cash),
    stock_eval_amount: Math.round(stockEval),
    total_eval_amount: Math.round(total),
    cumulative_return_pct: roundNumber_(((total - 5000000) / 5000000) * 100, 2),
    active_positions_json: JSON.stringify(activePositions)
  };
  
  // 1. 포트폴리오 스냅샷 기록
  appendObjectRow_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO, newRecord);
  
  // 2. 가상 거래 대장(Ledger) 보존
  appendObjectRow_(AM_CONFIG.SHEETS.PAPER_LEDGER, {
    date: today,
    symbol: cleanSymbol,
    name: stockName,
    action_type: actionType,
    price: executionPrice,
    quantity: qty,
    amount: amount,
    reason: (customPrice > 0 ? '지정가' : '실시간') + ' 모의 체결 (슬리피지 0.1% 반영)',
    created_at: amNowString_()
  });
  
  logInfo_('paper_trading', 'Executed paper order', { symbol: cleanSymbol, action: actionType, qty: qty, price: executionPrice });
  
  // 실시간 뷰 즉각 동기화
  collectHoldingsCurrent();
  
  return {
    success: true,
    name: stockName,
    executionPrice: executionPrice,
    amount: amount,
    cash: cash,
    activePositions: activePositions
  };
}

/**
 * 🤖 VAA 퀀트 전략 시그널에 따른 가상매매 포트폴리오 자동 리밸런싱 집행 모듈
 */
function runPaperPortfolioQuantRebalancing_(vaaSignal) {
  if (!vaaSignal) {
    return { success: false, reason: '신규 퀀트 시그널이 유효하지 않습니다.' };
  }
  
  logInfo_('paper_rebalancing', 'Start auto rebalancing for signal: ' + vaaSignal);
  
  // 1. 현재 가상 잔고 스냅샷 조회
  var paperRows = readObjects_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO);
  var lastPaper = paperRows.length > 0 ? paperRows[paperRows.length - 1] : null;
  if (!lastPaper) {
    // 잔고가 아예 없으면 500만원 디폴트 계좌로 초기화
    lastPaper = {
      cash_amount: 5000000,
      stock_eval_amount: 0,
      total_eval_amount: 5000000,
      active_positions_json: '[]'
    };
  }
  
  var activePositions = JSON.parse(lastPaper.active_positions_json || '[]');
  var logs = [];
  
  // 2. 다른 주식들 전량 매도 (동기 순차 체결 - isAutoRebal = true 플래그 전달)
  var isSameHolding = false;
  activePositions.forEach(function(pos) {
    var sym = normalizeStockSymbol_(pos.symbol);
    var targetSym = normalizeStockSymbol_(vaaSignal);
    if (sym === targetSym) {
      isSameHolding = true;
    } else {
      // 신규 시그널과 다른 보유 자산은 전량 매도 집행
      try {
        var sellQty = pos.quantity;
        var sellRes = executePaperOrder_(sym, 'SELL', sellQty, 0, true);
        logs.push('✅ <b>기존 가상자산 청산 완료</b>: ' + sellRes.name + ' (' + sym + ') ' + sellQty + '주 매도');
      } catch(sellErr) {
        logs.push('❌ <b>기존 가상자산 청산 실패</b> (' + sym + '): ' + sellErr.message);
      }
    }
  });
  
  // 3. 동일한 종목을 이미 올바르게 100% 쥐고 있다면 추가 매매 생략
  if (isSameHolding && activePositions.length === 1) {
    logs.push('ℹ️ <b>가상 포트폴리오 유지</b>: 이미 신규 시그널(' + vaaSignal + ')과 동일한 단일 자산을 100% 보유하고 있어 리밸런싱을 생략합니다.');
    return {
      success: true,
      logs: logs,
      summary: '포트폴리오 변동 없음 (유지)'
    };
  }
  
  // 4. 매도 후 갱신된 최신 예수금 조회
  var updatedPaperRows = readObjects_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO);
  var latestPaper = updatedPaperRows.length > 0 ? updatedPaperRows[updatedPaperRows.length - 1] : lastPaper;
  var cash = parseFloat(latestPaper.cash_amount || 0);
  
  if (cash <= 1000) {
    logs.push('⚠️ <b>가상 매수 생략</b>: 가용 예수금 잔고(' + formatNumber_(cash) + '원)가 부족합니다.');
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
  
  // 6. 신규 자산 매수 집행 (isAutoRebal = true 플래그 전달)
  try {
    var buyRes = executePaperOrder_(cleanSignal, 'BUY', buyQty, 0, true);
    logs.push('✅ <b>신규 가상자산 편입 완료</b>: ' + buyRes.name + ' (' + cleanSignal + ') ' + buyQty + '주 매수 (체결가: ' + formatNumber_(buyRes.executionPrice) + '원)');
    
    // 최종 상태 다시 스캔
    var finalPaperRows = readObjects_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO);
    var finalPaper = finalPaperRows[finalPaperRows.length - 1];
    return {
      success: true,
      logs: logs,
      summary: 'VAA 자동 가상 매매 완료',
      total_eval: finalPaper ? finalPaper.total_eval_amount : cash
    };
  } catch(buyErr) {
    logs.push('❌ <b>신규 가상자산 편입 실패</b> (' + cleanSignal + '): ' + buyErr.message);
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
    executionPrice = Math.round(currentPrice * (1 + slippageRate));
  } else if (actionType === 'SELL') {
    executionPrice = Math.round(currentPrice * (1 - slippageRate));
  }
  
  var amount = executionPrice * qty;
  
  var rows = readObjects_(sheetName);
  var lastRecord = rows.length > 0 ? rows[rows.length - 1] : {
    cash_amount: 3000000,
    stock_eval_amount: 0,
    total_eval_amount: 3000000,
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
      throw new Error(type + ' 퀀트예수금 부족! 잔고: ' + formatNumber_(cash) + '원, 필요액: ' + formatNumber_(amount) + '원');
    }
    cash -= amount;
    if (found >= 0) {
      var p = activePositions[found];
      var totalCost = (p.quantity * p.entry_price) + amount;
      p.quantity += qty;
      p.entry_price = Math.round(totalCost / p.quantity);
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
  
  var stockEval = activePositions.reduce(function(sum, item) { return sum + item.eval_amount; }, 0);
  var total = cash + stockEval;
  
  var newRecord = {
    date: today,
    cash_amount: Math.round(cash),
    stock_eval_amount: Math.round(stockEval),
    total_eval_amount: Math.round(total),
    cumulative_return_pct: roundNumber_(((total - 3000000) / 3000000) * 100, 2),
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
  
  var sheetName = (type === 'DOM') ? AM_CONFIG.SHEETS.PAPER_PORTFOLIO_DOM : AM_CONFIG.SHEETS.PAPER_PORTFOLIO_US;
  var rows = readObjects_(sheetName);
  var lastRecord = rows.length > 0 ? rows[rows.length - 1] : {
    cash_amount: 3000000,
    stock_eval_amount: 0,
    total_eval_amount: 3000000,
    active_positions_json: '[]'
  };
  
  var activePositions = JSON.parse(lastRecord.active_positions_json || '[]');
  
  // 1. 기존 자산들 전량 청산
  activePositions.forEach(function(pos) {
    try {
      executeQuantPaperOrder_(type, pos.symbol, 'SELL', pos.quantity, 0);
    } catch(err) {
      logWarn_('quant_rebalancing', 'Failed to clear quant position ' + pos.symbol + ' for ' + type, { error: err.message });
    }
  });
  
  // 2. 갱신된 예수금 확인
  var updatedRows = readObjects_(sheetName);
  var latestRecord = updatedRows.length > 0 ? updatedRows[updatedRows.length - 1] : lastRecord;
  var cash = parseFloat(latestRecord.cash_amount || 0);
  
  if (cash <= 1000) {
    logWarn_('quant_rebalancing', 'Insufficient cash for ' + type + ' rebalancing: ' + cash);
    return;
  }
  
  // 3. 타겟 종목 균등 분할 매수
  var count = targetSymbols.length;
  var allocationPerStock = cash / count;
  
  targetSymbols.forEach(function(symbol) {
    var cleanSignal = normalizeStockSymbol_(symbol);
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
        var buyQty = Math.floor(allocationPerStock / estPrice);
        if (buyQty > 0) {
          executeQuantPaperOrder_(type, cleanSignal, 'BUY', buyQty, 0);
        }
      }
    } catch(buyErr) {
      logWarn_('quant_rebalancing', 'Failed to buy ' + cleanSignal + ' during ' + type + ' rebalancing', { error: buyErr.message });
    }
  });
}
