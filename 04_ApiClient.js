function apiFetchJson_(url, options, moduleName) {
  var maxAttempts = 3;
  var lastError = null;
  var lastStatus = 0;
  var retryAfterSeconds = 0;
  for (var attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      var fetchOptions = Object.assign({}, options || {});
      fetchOptions.muteHttpExceptions = true;
      var response = UrlFetchApp.fetch(url, fetchOptions);
      var status = response.getResponseCode();
      lastStatus = status;
      var text = response.getContentText();
      if (status >= 200 && status < 300) {
        return text ? JSON.parse(text) : {};
      }
      retryAfterSeconds = getRetryAfterSeconds_(response);
      lastError = new Error('HTTP ' + status + ': ' + text);
    } catch (err) {
      lastError = err;
    }
    if (attempt < maxAttempts) {
      var backoffDelay = calculateApiBackoffDelay_(attempt, lastStatus, retryAfterSeconds);
      Utilities.sleep(backoffDelay);
    }
  }
  logError_(moduleName || 'api', 'API request failed', { url: url, error: String(lastError) });
  throw lastError;
}

function calculateApiBackoffDelay_(attempt, status, retryAfterSeconds) {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return Math.min(30000, retryAfterSeconds * 1000 + Math.floor(Math.random() * 1000));
  }
  var multiplier = (status === 429 || status === 503) ? 2 : 1;
  return Math.min(30000, Math.pow(2, attempt) * 1000 * multiplier + Math.floor(Math.random() * 1000));
}

function getRetryAfterSeconds_(response) {
  try {
    var headers = response.getAllHeaders ? response.getAllHeaders() : response.getHeaders();
    var value = headers['Retry-After'] || headers['retry-after'];
    var seconds = Number(value || 0);
    return isNaN(seconds) ? 0 : seconds;
  } catch (err) {
    return 0;
  }
}

function buildQueryString_(params) {
  return Object.keys(params || {}).map(function(key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
  }).join('&');
}
