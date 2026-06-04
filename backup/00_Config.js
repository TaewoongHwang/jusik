var AM_CONFIG = {
  VERSION: '0.2.0-real-mvp',
  DEFAULT_ENV: 'real',
  DEFAULT_KIS_BASE_URL: 'https://openapi.koreainvestment.com:9443',
  SHEETS: {
    SETTINGS: 'settings',
    PROMPTS: 'prompts',
    STRATEGY_SETTINGS: 'strategy_settings',
    LOGS: 'logs',
    QUALITY_CHECKS: 'quality_checks',
    COMMAND_GUIDE: 'command_guide',
    MOBILE_COMMANDS: 'mobile_commands',
    MARKET_CALENDAR: 'market_calendar',
    MARKET_UNIVERSE: 'market_universe',
    MARKET_UNIVERSE_CHECK: 'market_universe_check',
    MARKET_DAILY: 'market_daily',
    INDICATORS_DAILY: 'indicators_daily',
    MARKET_BREADTH_DAILY: 'market_breadth_daily',
    SECTOR_STRENGTH_DAILY: 'sector_strength_daily',
    INVESTOR_FLOW_DAILY: 'investor_flow_daily',
    INVESTOR_FLOW_SCORE: 'investor_flow_score',
    MACRO_RAW: 'macro_raw',
    MACRO_SCORE: 'macro_score',
    NEWS_BRIEFING: 'news_briefing',
    NEWS_SCORE_DAILY: 'news_score_daily',
    ETF_WATCH: 'etf_watch',
    ETF_HOLDINGS: 'etf_holdings',
    ETF_STOCK_SCORE: 'etf_stock_score',
    DART_CORP_MASTER: 'dart_corp_master',
    FINANCIAL_RAW: 'financial_raw',
    FINANCIAL_RATIOS: 'financial_ratios',
    LEADER_CANDIDATES: 'leader_candidates',
    LEADER_50: 'leader_50',
    KOSDAQ_LEADER_50: 'kosdaq_leader_50',
    LEADER_HISTORY: 'leader_history',
    RISK_ALERTS: 'risk_alerts',
    SCENARIO_DAILY: 'scenario_daily',
    ENTRY_PLAN: 'entry_plan',
    AI_MARKET_BRIEFING: 'ai_market_briefing',
    AI_STOCK_ANALYSIS: 'ai_stock_analysis',
    PREMARKET_BRIEFING: 'premarket_briefing',
    PREMARKET_RESULT_REVIEW: 'premarket_result_review',
    ACCOUNT_SNAPSHOT: 'account_snapshot',
    MANUAL_HOLDINGS: 'manual_holdings',
    HOLDINGS_CURRENT: 'holdings_current',
    HOLDINGS_ADVICE: 'holdings_advice',
    PORTFOLIO_RISK: 'portfolio_risk',
    BACKTEST_LOG: 'backtest_log',
    PAPER_PORTFOLIO: 'paper_portfolio',
    PAPER_LEDGER: 'paper_ledger'
  },
  PROPERTY_KEYS: {
    KIS_ENV: 'KIS_ENV',
    KIS_BASE_URL: 'KIS_BASE_URL',
    KIS_APP_KEY: 'KIS_APP_KEY',
    KIS_APP_SECRET: 'KIS_APP_SECRET',
    KIS_ACCESS_TOKEN: 'KIS_ACCESS_TOKEN',
    KIS_ACCESS_TOKEN_EXPIRES_AT: 'KIS_ACCESS_TOKEN_EXPIRES_AT',
    GEMINI_API_KEY: 'GEMINI_API_KEY',
    GEMINI_MODEL: 'GEMINI_MODEL',
    DART_API_KEY: 'DART_API_KEY',
    KRX_API_KEY: 'KRX_API_KEY',
    FRED_API_KEY: 'FRED_API_KEY',
    ECOS_API_KEY: 'ECOS_API_KEY',
    REPORT_EMAIL: 'REPORT_EMAIL',
    KIS_CANO: 'KIS_CANO',
    KIS_ACNT_PRDT_CD: 'KIS_ACNT_PRDT_CD',
    TELEGRAM_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN',
    TELEGRAM_CHAT_ID: 'TELEGRAM_CHAT_ID',
    PORTFOLIO_MODE: 'PORTFOLIO_MODE'
  },
  SCORE_WEIGHTS: {
    leader: 45,
    chart: 15,
    etf: 15,
    financial: 15,
    macro: 10
  },
  RISK_LEVEL_MAX_POSITION_PCT: {
    low: 5,
    medium: 3,
    high: 2
  }
};

var AM_SHEET_SCHEMAS = {};
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.SETTINGS] = ['key', 'value', 'description', 'updated_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.PROMPTS] = ['key', 'value', 'description', 'updated_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.STRATEGY_SETTINGS] = ['key', 'value', 'description', 'updated_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.LOGS] = ['timestamp', 'level', 'module', 'message', 'details'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.QUALITY_CHECKS] = ['date', 'checked_at', 'status', 'quality_score', 'critical_count', 'warning_count', 'info_count', 'next_action', 'summary_json'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.COMMAND_GUIDE] = ['priority', 'category', 'situation', 'check_first', 'run_command', 'expected_result', 'if_problem', 'notes', 'updated_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.MOBILE_COMMANDS] = ['priority', 'category', 'command_key', 'command_name', 'description', 'run', 'status', 'requested_at', 'finished_at', 'last_message', 'updated_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.MARKET_CALENDAR] = ['date', 'kr_open', 'us_open', 'holiday_name', 'memo', 'updated_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.MARKET_UNIVERSE] = ['symbol', 'name', 'market', 'sector', 'active'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.MARKET_UNIVERSE_CHECK] = ['checked_at', 'symbol', 'name', 'market', 'sector', 'active', 'current_ok', 'daily_ok', 'daily_rows', 'status', 'message'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.MARKET_DAILY] = ['date', 'symbol', 'name', 'market', 'sector', 'close', 'change_pct', 'volume', 'trading_value', 'source', 'raw_json'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.INDICATORS_DAILY] = ['date', 'symbol', 'ma5', 'ma20', 'ma60', 'ma120', 'weekly_ma20', 'rsi14', 'volume_ratio', 'near_52w_high_pct', 'atr14', 'atr14_pct', 'trend_filter_passed', 'chart_score'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.MARKET_BREADTH_DAILY] = ['date', 'market', 'stock_count', 'up_count', 'down_count', 'flat_count', 'up_ratio', 'down_ratio', 'ma20_above_count', 'ma20_above_ratio', 'near_high_count', 'near_high_ratio', 'volume_expansion_count', 'volume_expansion_ratio', 'total_trading_value', 'avg_change_pct', 'breadth_score', 'memo'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.SECTOR_STRENGTH_DAILY] = ['date', 'sector', 'stock_count', 'avg_change_pct', 'up_ratio', 'total_trading_value', 'relative_trading_value_pct', 'sector_score'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.INVESTOR_FLOW_DAILY] = ['date', 'symbol', 'foreign_net_buy_qty', 'foreign_net_buy_value', 'institution_net_buy_qty', 'institution_net_buy_value', 'individual_net_buy_qty', 'individual_net_buy_value', 'source', 'raw_json'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.INVESTOR_FLOW_SCORE] = ['date', 'symbol', 'foreign_score', 'institution_score', 'combined_flow_score', 'flow_comment'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.MACRO_RAW] = ['date', 'name', 'value', 'change', 'change_pct', 'source', 'raw_json'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.MACRO_SCORE] = ['date', 'market_regime', 'macro_alignment_score', 'memo'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.NEWS_BRIEFING] = ['date', 'session', 'summary_json', 'sources_json', 'created_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.NEWS_SCORE_DAILY] = ['date', 'session', 'risk_on_score', 'risk_off_score', 'sector_score', 'net_news_score', 'top_sectors', 'dominant_impact', 'memo'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.ETF_WATCH] = ['etf_symbol', 'etf_name', 'category', 'active'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.ETF_HOLDINGS] = ['date', 'etf_symbol', 'etf_name', 'category', 'symbol', 'name', 'weight_pct', 'source', 'raw_json'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.ETF_STOCK_SCORE] = ['date', 'symbol', 'etf_count', 'avg_weight_pct', 'sector_etf_count', 'etf_score'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.DART_CORP_MASTER] = ['symbol', 'corp_code', 'corp_name', 'stock_code', 'updated_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.FINANCIAL_RAW] = ['date', 'symbol', 'corp_code', 'period', 'account_name', 'amount', 'raw_json'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.FINANCIAL_RATIOS] = ['date', 'symbol', 'revenue_growth', 'op_income_growth', 'op_margin', 'roe', 'debt_ratio', 'current_ratio', 'ocf', 'fcf', 'financial_score'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.LEADER_CANDIDATES] = ['date', 'rank', 'symbol', 'name', 'sector', 'close', 'change_pct', 'trading_value', 'leader_score', 'chart_score', 'etf_score', 'flow_score', 'financial_score', 'macro_score', 'sector_score', 'risk_penalty', 'total_score', 'memo'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.LEADER_50] = ['date', 'rank', 'symbol', 'name', 'sector', 'close', 'change_pct', 'trading_value', 'leader_score', 'etf_score', 'flow_score', 'financial_score', 'risk_level', 'total_score'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.KOSDAQ_LEADER_50] = ['date', 'rank', 'symbol', 'name', 'market', 'sector', 'close', 'change_pct', 'trading_value', 'leader_score', 'chart_score', 'etf_score', 'flow_score', 'financial_score', 'risk_level', 'total_score'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.LEADER_HISTORY] = ['date', 'list_type', 'symbol', 'name', 'market', 'sector', 'rank', 'previous_rank', 'rank_change', 'status', 'total_score', 'previous_total_score'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.RISK_ALERTS] = ['date', 'symbol', 'risk_type', 'risk_level', 'message', 'source'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.SCENARIO_DAILY] = ['date', 'scenario', 'conditions', 'response_plan'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.ENTRY_PLAN] = ['date', 'symbol', 'name', 'current_price', 'first_entry_price', 'first_entry_pct', 'second_entry_price', 'second_entry_pct', 'breakout_price', 'breakout_entry_pct', 'invalid_price', 'max_position_pct', 'scenario', 'memo'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.AI_MARKET_BRIEFING] = ['date', 'market_regime', 'briefing_json', 'created_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.AI_STOCK_ANALYSIS] = ['date', 'symbol', 'name', 'analysis_json', 'created_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.PREMARKET_BRIEFING] = ['date', 'base_leader_date', 'briefing_json', 'created_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.PREMARKET_RESULT_REVIEW] = ['date', 'base_leader_date', 'market_bias', 'actual_market_regime', 'bias_score', 'watch_count', 'watch_positive_count', 'watch_avg_return_pct', 'sector_match_score', 'prediction_score', 'summary', 'detail_json', 'created_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.ACCOUNT_SNAPSHOT] = ['date', 'cash_amount', 'stock_eval_amount', 'total_eval_amount', 'purchase_amount', 'profit_loss_amount', 'profit_loss_pct', 'raw_json', 'created_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.MANUAL_HOLDINGS] = ['broker', 'symbol', 'name', 'quantity', 'avg_price', 'current_price', 'purchase_amount', 'eval_amount', 'profit_loss_amount', 'profit_loss_pct', 'active', 'memo'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.HOLDINGS_CURRENT] = ['date', 'symbol', 'name', 'quantity', 'avg_price', 'current_price', 'purchase_amount', 'eval_amount', 'profit_loss_amount', 'profit_loss_pct', 'portfolio_weight_pct', 'source', 'raw_json'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.HOLDINGS_ADVICE] = ['date', 'symbol', 'name', 'action_view', 'summary', 'position_check', 'risk_comment', 'valid_condition', 'avoid_condition', 'rebalance_up', 'rebalance_down', 'next_check', 'advice_json', 'created_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.PORTFOLIO_RISK] = ['date', 'risk_type', 'risk_level', 'message', 'details_json', 'created_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.BACKTEST_LOG] = ['date', 'base_date', 'list_type', 'symbol', 'name', 'rank', 'base_close', 'next_open', 'next_high', 'next_low', 'next_close', 'next_return_pct', 'first_entry_price', 'first_entry_hit', 'second_entry_price', 'second_entry_hit', 'breakout_price', 'breakout_hit', 'invalid_price', 'invalid_hit', 'scenario', 'result', 'memo'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.PAPER_PORTFOLIO] = ['date', 'cash_amount', 'stock_eval_amount', 'total_eval_amount', 'daily_return_pct', 'cumulative_return_pct', 'active_positions_json', 'updated_at'];
AM_SHEET_SCHEMAS[AM_CONFIG.SHEETS.PAPER_LEDGER] = ['date', 'symbol', 'name', 'action_type', 'price', 'quantity', 'amount', 'reason', 'created_at'];

function amTodayString_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function amNowString_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function normalizeDateValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var text = String(value || '').replace(/^"+|"+$/g, '').trim();
  var isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoMatch) {
    return Utilities.formatDate(new Date(text), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return text;
}

function normalizeStockSymbol_(symbol) {
  var text = String(symbol || '').trim().toUpperCase();
  if (!text) return '';
  if (/^\d+$/.test(text)) {
    return text.padStart(6, '0');
  }
  return text;
}

// Deploy trigger 39 to clean up remote Node.js utility scripts
