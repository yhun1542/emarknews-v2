/**
 * 크론 전용 뉴스 수집 메서드
 * API와 크론의 역할 분리를 위한 새로운 메서드들
 */

class NewsServiceCronOnly {
  constructor(newsService) {
    this.newsService = newsService;
    this.logger = newsService.logger;
  }

  /**
   * 크론 전용: 뉴스 수집 + AI 처리 + 캐시 저장
   * API는 이 메서드를 호출하지 않음
   */
  async collectAndCacheNews(section, readArticles = []) {
    this.logger.info(`[CRON] Starting news collection for section: ${section}`);
    
    try {
      // 1. 뉴스 수집
      const articles = await this.collectNewsFromSources(section);
      
      // 2. AI 처리
      const enrichedArticles = await this.newsService._enrichArticlesWithAI(articles, section);
      
      // 3. 랭킹 및 정렬
      const rankedArticles = await this.newsService.rankAndSort(section, enrichedArticles, readArticles);
      
      // 4. 캐시에 저장
      await this.saveToCacheWithTTL(section, rankedArticles);
      
      this.logger.info(`[CRON] Successfully collected and cached ${rankedArticles.length} articles for ${section}`);
      return rankedArticles;
      
    } catch (error) {
      this.logger.error(`[CRON] Failed to collect news for ${section}:`, error.message);
      throw error;
    }
  }

  /**
   * 뉴스 소스에서 데이터 수집
   */
  async collectNewsFromSources(section) {
    const rs = this.newsService.RSS_FEEDS[section] || [];
    let phase1 = [];
    
    // API 키가 없을 때는 RSS 우선으로 처리
    if (section === 'kr') { 
      phase1 = [ 
        this.newsService.fetchFromNaver(section), 
        ...(rs.slice(0,2).map(r => this.newsService.fetchFromRSS(r.url))) 
      ]; 
    }
    else if (section === 'japan') { 
      phase1 = [ ...(rs.slice(0,3).map(r => this.newsService.fetchFromRSS(r.url))) ]; 
    }
    else { 
      // API 키가 있을 때만 NewsAPI 사용, 없으면 RSS만 사용
      if (process.env.NEWS_API_KEY && process.env.NEWS_API_KEY !== 'your_newsapi_key_here') {
        phase1 = [ 
          this.newsService.fetchFromNewsAPI(section), 
          ...(rs.slice(0,3).map(r => this.newsService.fetchFromRSS(r.url))) 
        ];
      } else {
        phase1 = [ ...(rs.slice(0,4).map(r => this.newsService.fetchFromRSS(r.url))) ];
      }
    }
    
    const settledPromises = await Promise.allSettled(phase1);
    const articles = settledPromises
      .filter(x => x.status === 'fulfilled')
      .flatMap(x => x.value || []);
    
    this.logger.info(`[CRON] Collected ${articles.length} raw articles from sources`);
    
    // 필터링 및 중복 제거
    const filtered = this.newsService.filterRecent(articles, 336);
    const unique = this.newsService.deduplicate(filtered);
    
    this.logger.info(`[CRON] After filtering: ${unique.length} unique articles`);
    return unique;
  }

  /**
   * 캐시에 저장 (긴 TTL 사용)
   */
  async saveToCacheWithTTL(section, articles) {
    const RATING_SERVICE_VERSION = "v2.2";
    const key = `${section}_fast_${RATING_SERVICE_VERSION}`;
    
    const payload = {
      success: true,
      data: articles.slice(0, 150), // 최대 150개
      section,
      total: articles.length,
      partial: false,
      timestamp: new Date().toISOString(),
      source: 'cron'
    };

    try {
      const redis = this.newsService.redis;
      if (redis) {
        await redis.set(key, JSON.stringify(payload), 'EX', 1800); // 30분 TTL
        this.logger.info(`[CRON] Cached ${articles.length} articles to Redis with key: ${key}`);
        
        // 개별 기사도 캐싱
        await this.newsService.cacheIndividualArticles(payload.data, section);
      } else {
        this.newsService.memoryCache.set(key, payload);
        setTimeout(() => this.newsService.memoryCache.delete(key), 1800 * 1000);
        this.logger.info(`[CRON] Cached ${articles.length} articles to memory`);
      }
    } catch (error) {
      this.logger.error(`[CRON] Failed to cache articles for ${section}:`, error.message);
    }
  }
}

module.exports = NewsServiceCronOnly;

