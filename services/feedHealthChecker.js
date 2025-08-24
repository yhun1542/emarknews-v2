// 피드 헬스 체커 - RSS 피드 상태 모니터링 및 자동 관리
const { fetchWithRetry, logAxiosError } = require('./rss/httpClient');
const logger = require('../utils/logger');

class FeedHealthChecker {
  constructor() {
    this.feedHealth = new Map(); // 피드별 상태 저장
    this.maxFailures = 3; // 연속 실패 허용 횟수
    this.checkInterval = 24 * 60 * 60 * 1000; // 24시간마다 체크
    this.isRunning = false;
  }

  /**
   * 피드 헬스 체크 시작
   */
  start() {
    if (this.isRunning) {
      logger.warn('Feed health checker is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Feed health checker started');
    
    // 즉시 한 번 실행
    this.checkAllFeeds();
    
    // 정기적으로 실행
    this.intervalId = setInterval(() => {
      this.checkAllFeeds();
    }, this.checkInterval);
  }

  /**
   * 피드 헬스 체크 중지
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Feed health checker stopped');
  }

  /**
   * 모든 피드 상태 체크
   */
  async checkAllFeeds() {
    const { rssSources } = require('../config/rssSources');
    const results = {
      total: 0,
      healthy: 0,
      unhealthy: 0,
      disabled: 0,
      details: {}
    };

    logger.info('Starting feed health check...');

    for (const [section, feeds] of Object.entries(rssSources)) {
      results.details[section] = {
        total: feeds.length,
        healthy: 0,
        unhealthy: 0,
        disabled: 0,
        feeds: []
      };

      for (const feed of feeds) {
        results.total++;
        results.details[section].total++;

        const health = await this.checkSingleFeed(feed);
        results.details[section].feeds.push(health);

        if (health.disabled) {
          results.disabled++;
          results.details[section].disabled++;
        } else if (health.healthy) {
          results.healthy++;
          results.details[section].healthy++;
        } else {
          results.unhealthy++;
          results.details[section].unhealthy++;
        }
      }
    }

    logger.info('Feed health check completed:', {
      total: results.total,
      healthy: results.healthy,
      unhealthy: results.unhealthy,
      disabled: results.disabled
    });

    return results;
  }

  /**
   * 단일 피드 상태 체크
   */
  async checkSingleFeed(feed) {
    const feedKey = `${feed.name}_${feed.url}`;
    const currentHealth = this.feedHealth.get(feedKey) || {
      name: feed.name,
      url: feed.url,
      consecutiveFailures: 0,
      lastSuccess: null,
      lastFailure: null,
      disabled: false,
      lastError: null
    };

    // NewsAPI 프로토콜은 별도 처리
    if (feed.url.startsWith('newsapi://') || feed.url.startsWith('google-news://')) {
      currentHealth.healthy = true;
      currentHealth.status = 'API endpoint (not checked)';
      currentHealth.responseTime = 0;
      this.feedHealth.set(feedKey, currentHealth);
      return currentHealth;
    }

    const startTime = Date.now();
    
    try {
      const response = await fetchWithRetry(feed.url, 2); // 2회 재시도
      const responseTime = Date.now() - startTime;
      
      // 성공
      currentHealth.healthy = true;
      currentHealth.consecutiveFailures = 0;
      currentHealth.lastSuccess = new Date().toISOString();
      currentHealth.lastError = null;
      currentHealth.status = `OK (${response.status})`;
      currentHealth.responseTime = responseTime;
      
      // 비활성화된 피드가 다시 작동하면 활성화
      if (currentHealth.disabled) {
        currentHealth.disabled = false;
        logger.info(`Feed re-enabled: ${feed.name}`);
      }

    } catch (error) {
      // 실패
      const responseTime = Date.now() - startTime;
      currentHealth.healthy = false;
      currentHealth.consecutiveFailures++;
      currentHealth.lastFailure = new Date().toISOString();
      currentHealth.lastError = error.message;
      currentHealth.responseTime = responseTime;
      
      // HTTP 상태 코드별 처리
      if (error.response) {
        currentHealth.status = `HTTP ${error.response.status}`;
        
        // 영구적인 오류 (404, 403 등)는 즉시 비활성화
        if ([404, 403, 410].includes(error.response.status)) {
          currentHealth.disabled = true;
          logger.warn(`Feed disabled due to permanent error: ${feed.name} (${error.response.status})`);
        }
      } else if (error.code) {
        currentHealth.status = error.code;
      } else {
        currentHealth.status = 'Unknown error';
      }
      
      // 연속 실패 횟수가 임계값을 초과하면 비활성화
      if (currentHealth.consecutiveFailures >= this.maxFailures && !currentHealth.disabled) {
        currentHealth.disabled = true;
        logger.warn(`Feed disabled due to consecutive failures: ${feed.name} (${currentHealth.consecutiveFailures} failures)`);
      }

      logAxiosError(error, { feedName: feed.name, feedUrl: feed.url });
    }

    this.feedHealth.set(feedKey, currentHealth);
    return currentHealth;
  }

  /**
   * 특정 피드 수동 활성화/비활성화
   */
  setFeedStatus(feedName, feedUrl, disabled) {
    const feedKey = `${feedName}_${feedUrl}`;
    const health = this.feedHealth.get(feedKey);
    
    if (health) {
      health.disabled = disabled;
      health.consecutiveFailures = disabled ? health.consecutiveFailures : 0;
      this.feedHealth.set(feedKey, health);
      
      logger.info(`Feed ${disabled ? 'disabled' : 'enabled'} manually: ${feedName}`);
      return true;
    }
    
    return false;
  }

  /**
   * 피드 상태 조회
   */
  getFeedHealth(feedName, feedUrl) {
    const feedKey = `${feedName}_${feedUrl}`;
    return this.feedHealth.get(feedKey);
  }

  /**
   * 모든 피드 상태 조회
   */
  getAllFeedHealth() {
    const result = {};
    for (const [key, health] of this.feedHealth.entries()) {
      result[key] = health;
    }
    return result;
  }

  /**
   * 건강한 피드만 필터링
   */
  getHealthyFeeds(feeds) {
    return feeds.filter(feed => {
      const feedKey = `${feed.name}_${feed.url}`;
      const health = this.feedHealth.get(feedKey);
      
      // 상태 정보가 없거나 비활성화되지 않은 피드만 반환
      return !health || !health.disabled;
    });
  }

  /**
   * 피드 상태 통계
   */
  getHealthStats() {
    const stats = {
      total: this.feedHealth.size,
      healthy: 0,
      unhealthy: 0,
      disabled: 0,
      avgResponseTime: 0
    };

    let totalResponseTime = 0;
    let responseTimeCount = 0;

    for (const health of this.feedHealth.values()) {
      if (health.disabled) {
        stats.disabled++;
      } else if (health.healthy) {
        stats.healthy++;
      } else {
        stats.unhealthy++;
      }

      if (health.responseTime > 0) {
        totalResponseTime += health.responseTime;
        responseTimeCount++;
      }
    }

    if (responseTimeCount > 0) {
      stats.avgResponseTime = Math.round(totalResponseTime / responseTimeCount);
    }

    return stats;
  }
}

module.exports = FeedHealthChecker;

