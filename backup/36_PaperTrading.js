function runPaperTradingSimulation(dateValue) {
  return withLogging_('paper_trading', function() {
    ensureAllSheets_();
    var target = normalizeDateValue_(dateValue || amTodayString_());
    
    // 1. 해당 날짜의 사후검증(backtest_log) 데이터 가져오기
    var backtestRows = readObjects_(AM_CONFIG.SHEETS.BACKTEST_LOG).filter(function(row) {
      return normalizeDateValue_(row.date) === target;
    });
    
    if (backtestRows.length === 0) {
      logInfo_('paper_trading', 'No backtest log found for today; paper trading simulation skipped', { date: target });
      return { date: target, skipped: true, reason: 'no_backtest_data' };
    }
    
    var totalInvestment = getStrategyNumber_('total_investment', 5000000);
    
    // 2. 직전 가상 포트폴리오 잔고 정보 로드 또는 초기화
    var lastRow = getLatestPaperPortfolioRow_();
    var cash = totalInvestment;
    var activePositions = [];
    var prevTotalVal = totalInvestment;
    var startingBudget = totalInvestment;
    
    if (lastRow) {
      cash = Number(lastRow.cash_amount || 0);
      try {
        activePositions = JSON.parse(lastRow.active_positions_json || '[]');
      } catch(e) {
        activePositions = [];
      }
      prevTotalVal = Number(lastRow.total_eval_amount || totalInvestment);
    }
    
    var transactions = [];
    var updatedPositions = [];
    var stockEvalAmount = 0;
    
    // 3. 기존 보유 중인 가상 주식 매도/청산 여부 분석
    activePositions.forEach(function(pos) {
      var symbol = normalizeStockSymbol_(pos.symbol);
      var backtest = backtestRows.filter(function(b) {
        return normalizeStockSymbol_(b.symbol) === symbol;
      })[0];
      
      var quantity = Number(pos.quantity || 0);
      var entryPrice = Number(pos.entry_price || 0);
      var holdingDays = Number(pos.holding_days || 0);
      
      var exited = false;
      var exitPrice = 0;
      var reason = '';
      
      if (backtest) {
        var low = Number(backtest.next_low || 0);
        var high = Number(backtest.next_high || 0);
        var close = Number(backtest.next_close || 0);
        var invalidPrice = Number(backtest.invalid_price || 0);
        
        // 탈출조건 1: 손절선 (무효화 가격 터치)
        if (invalidPrice > 0 && low <= invalidPrice) {
          exited = true;
          var isOvr = /^[A-Za-z]/.test(symbol);
          exitPrice = isOvr ? (invalidPrice * 0.999) : Math.round(invalidPrice * 0.999); // 0.1% 슬리피지 페널티 적용!
          reason = '손절 (무효화 가격 ' + formatNumber_(invalidPrice) + ' 이탈, 슬리피지 0.1% 페널티 반영)';
        }
        // 탈출조건 2: 익절선 (목표 수익률 +10% 도달)
        else if (high >= entryPrice * 1.10) {
          exited = true;
          var rawExit = entryPrice * 1.10;
          var isOvr = /^[A-Za-z]/.test(symbol);
          exitPrice = isOvr ? (rawExit * 0.999) : Math.round(rawExit * 0.999); // 0.1% 슬리피지 페널티 적용!
          reason = '익절 (목표 수익률 +10% 달성, 슬리피지 0.1% 페널티 반영)';
        }
        // 탈출조건 3: 시간제 청산 (5거래일 보유 제한 경과)
        else if (holdingDays >= 5) {
          exited = true;
          var isOvr = /^[A-Za-z]/.test(symbol);
          exitPrice = isOvr ? (close * 0.999) : Math.round(close * 0.999); // 0.1% 슬리피지 페널티 적용!
          reason = '시간 제한 청산 (5거래일 경과, 슬리피지 0.1% 페널티 반영)';
        }
        // 보유 유지 시 가격 업데이트 및 보유일 증가
        else {
          pos.holding_days = holdingDays + 1;
          pos.current_price = close;
          pos.eval_amount = quantity * close;
          pos.return_pct = roundNumber_((close - entryPrice) / entryPrice * 100, 2);
          updatedPositions.push(pos);
          stockEvalAmount += pos.eval_amount;
        }
      } else {
        // 당일 사후검증(Top 10)에는 없지만 보유 중인 비주도주 KIS 현재가 연동
        var currentPrice = entryPrice;
        try {
          currentPrice = fetchKisCurrentPrice_(symbol).close;
          Utilities.sleep(120);
        } catch(e) {
          logWarn_('paper_trading', 'Failed to get live price for holding; using entry price', { symbol: symbol });
        }
        
        if (holdingDays >= 5) {
          exited = true;
          var isOvr = /^[A-Za-z]/.test(symbol);
          exitPrice = isOvr ? (currentPrice * 0.999) : Math.round(currentPrice * 0.999); // 0.1% 슬리피지 페널티 적용!
          reason = '시간 제한 청산 (5거래일 경과 - KIS 실시간가, 슬리피지 0.1% 페널티 반영)';
        } else {
          pos.holding_days = holdingDays + 1;
          pos.current_price = currentPrice;
          pos.eval_amount = quantity * currentPrice;
          pos.return_pct = roundNumber_((currentPrice - entryPrice) / entryPrice * 100, 2);
          updatedPositions.push(pos);
          stockEvalAmount += pos.eval_amount;
        }
      }
      
      if (exited) {
        var returnAmt = quantity * exitPrice;
        cash += returnAmt;
        transactions.push({
          date: target,
          symbol: symbol,
          name: pos.name,
          action_type: 'SELL',
          price: isOvr ? parseFloat(exitPrice.toFixed(2)) : exitPrice,
          quantity: quantity,
          amount: Math.round(returnAmt),
          reason: reason,
          created_at: amNowString_()
        });
      }
    });
    
    // 4. 당일 신규 매수 감입 체결 시뮬레이션
    backtestRows.forEach(function(row) {
      var symbol = normalizeStockSymbol_(row.symbol);
      
      // 이미 포지션을 들고 있는 종목은 신규 매수 패스
      var alreadyHolding = updatedPositions.some(function(p) {
        return normalizeStockSymbol_(p.symbol) === symbol;
      });
      if (alreadyHolding) return;
      
      var isFirstHit = String(row.first_entry_hit || '').toUpperCase() === 'Y';
      var isBreakoutHit = String(row.breakout_hit || '').toUpperCase() === 'Y';
      
      // 해당 종목의 전날 세팅된 매매계획(ENTRY_PLAN) 가져오기
      var plan = readObjects_(AM_CONFIG.SHEETS.ENTRY_PLAN).filter(function(p) {
        return normalizeStockSymbol_(p.symbol) === symbol && normalizeDateValue_(p.date) === normalizeDateValue_(row.base_date);
      })[0];
      
      if (!plan) return;
      
      var entryPrice = 0;
      var entryPct = 0;
      var reason = '';
      
      var isOvr = /^[A-Za-z]/.test(symbol);
      if (isFirstHit && plan.first_entry_price > 0) {
        var rawPrice = Number(plan.first_entry_price);
        entryPrice = isOvr ? (rawPrice * 1.001) : Math.round(rawPrice * 1.001); // 0.1% 슬리피지 매수 페널티 반영!
        entryPct = Number(plan.first_entry_pct || 10);
        reason = '1차 검토가 체결 (슬리피지 0.1% 페널티 반영)';
      } else if (isBreakoutHit && plan.breakout_price > 0) {
        var rawPrice = Number(plan.breakout_price);
        entryPrice = isOvr ? (rawPrice * 1.001) : Math.round(rawPrice * 1.001); // 0.1% 슬리피지 매수 페널티 반영!
        entryPct = Number(plan.breakout_entry_pct || 10);
        reason = '돌파 조건 체결 (슬리피지 0.1% 페널티 반영)';
      }
      
      if (entryPrice > 0 && entryPct > 0) {
        var allocatedAmt = startingBudget * (entryPct / 100);
        // 현금이 부족하면 가용 현금 전액만 활용
        if (allocatedAmt > cash) {
          allocatedAmt = cash;
        }
        
        var quantity = Math.floor(allocatedAmt / entryPrice);
        if (quantity > 0) {
          var purchaseAmt = quantity * entryPrice;
          cash -= purchaseAmt;
          var nextClose = Number(row.next_close || entryPrice);
          var pos = {
            symbol: symbol,
            name: row.name,
            quantity: quantity,
            entry_price: isOvr ? parseFloat(entryPrice.toFixed(2)) : entryPrice,
            current_price: nextClose,
            entry_date: target,
            holding_days: 1,
            eval_amount: quantity * nextClose,
            return_pct: roundNumber_((nextClose - entryPrice) / entryPrice * 100, 2)
          };
          updatedPositions.push(pos);
          stockEvalAmount += pos.eval_amount;
          
          transactions.push({
            date: target,
            symbol: symbol,
            name: row.name,
            action_type: 'BUY',
            price: isOvr ? parseFloat(entryPrice.toFixed(2)) : entryPrice,
            quantity: quantity,
            amount: Math.round(purchaseAmt),
            reason: reason,
            created_at: amNowString_()
          });
        }
      }
    });
    
    // 5. 모의 매매 체결 거래 내역(Ledger) 시트에 보관 및 실시간 텔레그램 발송
    transactions.forEach(function(tx) {
      appendObjectRow_(AM_CONFIG.SHEETS.PAPER_LEDGER, tx);
      
      var isBuy = String(tx.action_type).toUpperCase() === 'BUY';
      var title = isBuy ? '🔵 <b>가상 매수 체결 (슬리피지 적용)</b>' : '🔴 <b>가상 매도 청산 (슬리피지 적용)</b>';
      var priceUnit = /^[A-Za-z]/.test(tx.symbol) ? '$' : '원';
      var msg = [
        title,
        '종목명: ' + tx.name + ' (' + normalizeStockSymbol_(tx.symbol) + ')',
        '체결가: ' + formatNumber_(tx.price) + ' ' + priceUnit,
        '수량: ' + tx.quantity + ' 주 (금액: ' + formatNumber_(tx.amount) + '원)',
        '사유: ' + tx.reason,
        '체결일시: ' + tx.date
      ].join('\n');
      sendTelegramMessage(msg);
    });
    
    // 6. 누적 및 일일 가상 수익률 통계 연산
    var totalEvalAmount = cash + stockEvalAmount;
    var dailyReturnPct = prevTotalVal > 0 ? roundNumber_((totalEvalAmount - prevTotalVal) / prevTotalVal * 100, 2) : 0;
    var cumulativeReturnPct = startingBudget > 0 ? roundNumber_((totalEvalAmount - startingBudget) / startingBudget * 100, 2) : 0;
    
    var portfolioRow = {
      date: target,
      cash_amount: Math.round(cash),
      stock_eval_amount: Math.round(stockEvalAmount),
      total_eval_amount: Math.round(totalEvalAmount),
      daily_return_pct: dailyReturnPct,
      cumulative_return_pct: cumulativeReturnPct,
      active_positions_json: JSON.stringify(updatedPositions),
      updated_at: amNowString_()
    };
    
    // 7. 시트에 덮어쓰기 기록
    deleteRowsByDate_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO, target);
    appendObjectRow_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO, portfolioRow);
    
    logInfo_('paper_trading', 'Paper trading simulation completed for ' + target, {
      total_eval_amount: totalEvalAmount,
      cash_amount: cash,
      stock_eval_amount: stockEvalAmount,
      daily_return_pct: dailyReturnPct,
      cumulative_return_pct: cumulativeReturnPct,
      active_positions_count: updatedPositions.length,
      trades: transactions.length
    });
    
    return {
      date: target,
      portfolio: portfolioRow,
      trades: transactions
    };
  });
}

function resetPaperTradingSimulation() {
  return withLogging_('paper_trading', function() {
    ensureAllSheets_();
    clearDataRows_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO);
    clearDataRows_(AM_CONFIG.SHEETS.PAPER_LEDGER);
    
    var totalInvestment = getStrategyNumber_('total_investment', 5000000);
    var today = amTodayString_();
    
    var initialRow = {
      date: today,
      cash_amount: Math.round(totalInvestment),
      stock_eval_amount: 0,
      total_eval_amount: Math.round(totalInvestment),
      daily_return_pct: 0,
      cumulative_return_pct: 0,
      active_positions_json: '[]',
      updated_at: amNowString_()
    };
    
    appendObjectRow_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO, initialRow);
    logInfo_('paper_trading', 'Paper trading simulator reset successfully', { total_investment: totalInvestment });
    safeUiAlert_('가상 투자 시뮬레이터가 초기 예산(' + formatNumber_(totalInvestment) + '원) 기준으로 깨끗하게 리셋되었습니다.');
    return initialRow;
  });
}

function getLatestPaperPortfolioRow_() {
  var rows = readObjects_(AM_CONFIG.SHEETS.PAPER_PORTFOLIO);
  if (rows.length === 0) return null;
  rows.sort(function(a, b) {
    return String(a.date).localeCompare(String(b.date));
  });
  return rows[rows.length - 1];
}

function runPaperTradingSimulationFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    '가상 투자 시뮬레이터 실행',
    '오늘의 사후검증(backtest_log) 결과를 바탕으로 모의 매매 시뮬레이션을 실행하시겠습니까?\n' +
    '이 작업은 오늘 포지션 진입/청산 및 거래 내역(paper_ledger)을 갱신합니다.',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) return;
  
  try {
    var result = runPaperTradingSimulation();
    if (result.skipped) {
      ui.alert('시뮬레이션 건너뜀\n\n이유: ' + result.reason);
    } else {
      ui.alert(
        '가상 시뮬레이션 완료\n\n' +
        '날짜: ' + result.date + '\n' +
        '총자산: ' + formatNumber_(result.portfolio.total_eval_amount) + ' 원\n' +
        '누적 수익률: ' + formatPercentText_(result.portfolio.cumulative_return_pct) + '\n' +
        '체결 거래 수: ' + result.trades.length + ' 건\n\n' +
        '결과 시트: paper_portfolio, paper_ledger'
      );
    }
  } catch(err) {
    ui.alert('오류 발생\n\n' + (err.message || String(err)));
  }
}
