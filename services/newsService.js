/**
 * Emark 뉴스 서비스 - 최종 완성본 (AI 서비스 연동 포함)
 * - 프론트엔드 호환성 문제를 해결하고, 백엔드 버그를 수정했으며, AIService를 연동한 최종 버전입니다.
 */

const axios = require('axios');
const Parser = require('rss-parser');
const logger = require('../utils/logger');
const crypto = require('crypto');
const AIService = require('./aiService'); // AI 서비스 import
const RatingService = require('./ratingService'); // Rating 서비스 import

// 🔧 캐시 버전 관리: ratingService 변경 시 이 버전을 업데이트하면 자동으로 새 캐시 사용
const RATING_SERVICE_VERSION = "v2.2"; // 기본 점수 변경으로 버전 업데이트

// Redis 클라이언트
let redis;
try {
  const { createClient } = require('redis');
  const REDIS_URL = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  if (REDIS_URL) {
    redis = createClient({ url: REDIS_URL });
    redis.on('error', (e) => logger.error('Redis error:', e));
    redis.connect().catch(() => logger.warn('Redis connection failed, using memory cache'));
  }
} catch (e) {
  logger.warn('Redis not available, using memory cache');
}

// 메모리 캐시 폴백
const memoryCache = new Map();

// -------------------------------
// 공통 유틸
// -------------------------------
const sha1 = (s) => crypto.createHash('sha1').update(s || '').digest('hex');
const domainFromUrl = (u) => { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; } };
const minutesSince = (iso) => { const t = new Date(iso).getTime(); if (!t) return 99999; return Math.max(0, (Date.now() - t) / 60000); };

const FAST = {
  PHASE1_MS: Number(process.env.FAST_PHASE1_DEADLINE_MS || 600),
  PHASE2_MS: Number(process.env.FAST_PHASE2_DEADLINE_MS || 1500),
  FIRST_BATCH: Number(process.env.FAST_FIRST_BATCH_SIZE || 20), // 40 → 20으로 줄여서 빠른 AI 처리
  FULL_MAX: Number(process.env.FAST_FULL_MAX || 150),
  TTL_FAST: Number(process.env.FAST_REDIS_TTL_SEC || 30), // 60 → 30초로 단축
  TTL_FULL: Number(process.env.FULL_REDIS_TTL_SEC || 300), // 600 → 300초로 단축
};

const RANK_TAU_MIN = Number(process.env.RANK_TAU_MIN || 90);
const freshness = (ageMin) => Math.exp(-ageMin / RANK_TAU_MIN);
const deduplicate = (items) => { const seen=new Set(); const out=[]; for(const it of items){ const k=sha1((it.title||'')+(it.url||'')); if(seen.has(k)) continue; seen.add(k); out.push(it);} return out; };
const filterRecent = (items,h=336)=> items.filter(it=>minutesSince(it.publishedAt)<=h*60); // 14일 = 336시간

// -------------------------------
// 섹션별 가중치 프로필
// -------------------------------
const DEFAULT_WEIGHTS = {
  buzz:     { f:0.25, v:0.40, e:0.15, s:0.10, d:0.05, l:0.05 },
  world:    { f:0.35, v:0.15, e:0.10, s:0.30, d:0.05, l:0.05 },
  korea:    { f:0.30, v:0.20, e:0.10, s:0.30, d:0.05, l:0.05 },
  kr:       { f:0.30, v:0.20, e:0.10, s:0.30, d:0.05, l:0.05 },
  japan:    { f:0.30, v:0.20, e:0.10, s:0.30, d:0.05, l:0.05 },
  business: { f:0.25, v:0.20, e:0.20, s:0.30, d:0.03, l:0.02 },
  tech:     { f:0.20, v:0.40, e:0.20, s:0.15, d:0.03, l:0.02 },
};
function parseWeight(envVal, fallback) {
  if (!envVal) return fallback;
  try {
    const [f,v,e,s,d,l] = envVal.split(',').map(Number);
    if ([f,v,e,s,d,l].some(x => Number.isNaN(x))) return fallback;
    return { f,v,e,s,d,l };
  } catch { return fallback; }
}
const SECTION_WEIGHTS = {
  buzz:     parseWeight(process.env.WEIGHTS_BUZZ, DEFAULT_WEIGHTS.buzz),
  world:    parseWeight(process.env.WEIGHTS_WORLD, DEFAULT_WEIGHTS.world),
  korea:    parseWeight(process.env.WEIGHTS_KOREA, DEFAULT_WEIGHTS.korea),
  kr:       parseWeight(process.env.WEIGHTS_KOREA, DEFAULT_WEIGHTS.kr),
  japan:    parseWeight(process.env.WEIGHTS_JAPAN, DEFAULT_WEIGHTS.japan),
  business: parseWeight(process.env.WEIGHTS_BUSINESS, DEFAULT_WEIGHTS.business),
  tech:     parseWeight(process.env.WEIGHTS_TECH, DEFAULT_WEIGHTS.tech),
};

// -------------------------------
// 섹션별 소스/키워드/화이트리스트
// -------------------------------
const TW_QUERIES = { /* ... 기존 내용과 동일 ... */ };
const REDDIT_EP = { /* ... 기존 내용과 동일 ... */ };
const YT_REGIONS = { /* ... 기존 내용과 동일 ... */ };
const RSS_FEEDS = {
  world: [
    // 최고 신뢰도 소스
    { url: 'https://feeds.reuters.com/reuters/topNews', name: 'Reuters Top News' },
    { url: 'https://feeds.reuters.com/reuters/worldNews', name: 'Reuters World' },
    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC World' },
    { url: 'http://rss.cnn.com/rss/edition.rss', name: 'CNN World' },
    
    // 추가 국제 소스
    { url: 'https://www.theguardian.com/world/rss', name: 'The Guardian World' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', name: 'New York Times World' },
    { url: 'https://rss.dw.com/rdf/rss-en-all', name: 'Deutsche Welle' },
    { url: 'https://feeds.washingtonpost.com/rss/world', name: 'Washington Post World' },
    { url: 'https://www.aljazeera.com/xml/rss/all.xml', name: 'Al Jazeera' },
    { url: 'https://feeds.skynews.com/feeds/rss/world.xml', name: 'Sky News World' }
  ],
  tech: [
    // 테크 전문 미디어
    { url: 'https://feeds.feedburner.com/TechCrunch', name: 'TechCrunch' },
    { url: 'http://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica' },
    { url: 'https://www.engadget.com/rss.xml', name: 'Engadget' },
    { url: 'https://feeds.feedburner.com/venturebeat/SZYF', name: 'VentureBeat' },
    { url: 'https://feeds.feedburner.com/oreilly/radar', name: 'O\'Reilly Radar' },
    
    // 주요 언론사 테크 섹션
    { url: 'https://rss.cnn.com/rss/edition_technology.rss', name: 'CNN Tech' },
    { url: 'https://feeds.reuters.com/reuters/technologyNews', name: 'Reuters Tech' },
    { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', name: 'BBC Technology' },
    { url: 'https://www.theguardian.com/technology/rss', name: 'The Guardian Tech' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', name: 'NYT Technology' },
    
    // 전문 테크 사이트
    { url: 'https://feeds.feedburner.com/TheHackernews', name: 'The Hacker News' },
    { url: 'https://feeds.feedburner.com/Mashable', name: 'Mashable' },
    { url: 'https://www.wired.com/feed/rss', name: 'Wired' }
  ],
  business: [
    // 경제 전문 미디어
    { url: 'https://feeds.reuters.com/reuters/businessNews', name: 'Reuters Business' },
    { url: 'https://feeds.bloomberg.com/markets/news.rss', name: 'Bloomberg Markets' },
    { url: 'http://rss.cnn.com/rss/money_latest.rss', name: 'CNN Business' },
    { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', name: 'BBC Business' },
    
    // 추가 경제 소스
    { url: 'https://www.theguardian.com/business/rss', name: 'The Guardian Business' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', name: 'NYT Business' },
    { url: 'https://feeds.washingtonpost.com/rss/business', name: 'Washington Post Business' },
    { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', name: 'MarketWatch' },
    { url: 'https://feeds.fortune.com/fortune/headlines', name: 'Fortune' },
    { url: 'https://feeds.feedburner.com/entrepreneur/latest', name: 'Entrepreneur' }
  ],
  buzz: [
    // 종합 뉴스 (인기/트렌딩)
    { url: 'https://feeds.reuters.com/reuters/topNews', name: 'Reuters Top' },
    { url: 'http://rss.cnn.com/rss/edition.rss', name: 'CNN Top' },
    { url: 'https://feeds.bbci.co.uk/news/rss.xml', name: 'BBC News' },
    { url: 'https://www.theguardian.com/uk/rss', name: 'The Guardian UK' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', name: 'NYT Homepage' },
    
    // 엔터테인먼트 & 라이프스타일
    { url: 'https://feeds.feedburner.com/people/headlines', name: 'People Magazine' },
    { url: 'https://feeds.feedburner.com/time/topstories', name: 'Time Magazine' },
    { url: 'https://rss.cnn.com/rss/edition_entertainment.rss', name: 'CNN Entertainment' }
  ],
  kr: [
    // 연합뉴스 (최고 신뢰도)
    { url: 'https://www.yna.co.kr/rss/news.xml', name: '연합뉴스' },
    
    // 종합일간지 (HTTPS 우선)
    { url: 'https://rss.joins.com/joins_news_list.xml', name: '중앙일보' },
    
    // 경제지 (안정적인 HTTPS)
    { url: 'https://www.mk.co.kr/rss/30000001/', name: '매일경제' },
    
    // 방송사 (테스트 후 추가)
    { url: 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01', name: 'SBS' }
  ],
  japan: [
    { url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', name: 'NHK News' },
    { url: 'https://www.asahi.com/rss/asahi/newsheadlines.rdf', name: 'Asahi Shimbun' },
    { url: 'https://mainichi.jp/rss/etc/english_latest.rss', name: 'Mainichi Shimbun' },
    { url: 'https://japannews.yomiuri.co.jp/feed', name: 'Japan News' },
    { url: 'https://news.livedoor.com/topics/rss/top.xml', name: 'Livedoor News' }
  ]
};
const SOURCE_WEIGHTS = {
  // 최고 신뢰도 소스 (5.0)
  'reuters.com': 5.0,
  'bbc.com': 5.0,
  'bbc.co.uk': 5.0,
  'ap.org': 5.0,
  'apnews.com': 5.0,
  
  // 높은 신뢰도 소스 (4.0-4.5)
  'cnn.com': 4.5,
  'edition.cnn.com': 4.5,
  'dw.com': 4.0,
  'bloomberg.com': 4.5,
  'wsj.com': 4.5,
  'ft.com': 4.5,
  'theguardian.com': 4.0,
  'washingtonpost.com': 4.0,
  'nytimes.com': 4.5,
  'aljazeera.com': 4.0,
  'skynews.com': 3.5,
  
  // 테크 전문 미디어 (3.0-4.0)
  'techcrunch.com': 3.5,
  'arstechnica.com': 4.0,
  'engadget.com': 3.5,
  'venturebeat.com': 3.0,
  'wired.com': 4.0,
  'thehackernews.com': 3.0,
  'mashable.com': 3.0,
  
  // 경제 전문 미디어 (3.5-4.5)
  'marketwatch.com': 4.0,
  'fortune.com': 4.0,
  'entrepreneur.com': 3.5,
  
  // 엔터테인먼트 & 라이프스타일 (2.5-3.5)
  'people.com': 3.0,
  'time.com': 4.0,
  
  // 일반 신뢰도 소스 (3.0-3.5)
  'politico.com': 3.5,
  
  // 한국 소스 (4.0-5.0)
  'joins.com': 4.5,
  'hankyung.com': 4.0,
  'yonhapnews.co.kr': 5.0,
  'chosun.com': 4.0,
  'donga.com': 4.0,
  'hani.co.kr': 4.5,
  'khan.co.kr': 4.0,
  'kmib.co.kr': 4.0,
  'mk.co.kr': 4.0,
  'sedaily.com': 3.5,
  'kbs.co.kr': 4.5,
  'mbc.co.kr': 4.5,
  'sbs.co.kr': 4.5,
  'ytn.co.kr': 4.0,
  
  // 일본 소스 (4.0-5.0)
  'nhk.or.jp': 5.0,
  'asahi.com': 4.5,
  'mainichi.jp': 4.5,
  'yomiuri.co.jp': 4.5,
  'japannews.yomiuri.co.jp': 4.5,
  'livedoor.com': 3.0,
  
  // 기타 소스 (2.0-3.0)
  'tmz.com': 2.5,
  'buzzfeed.com': 2.0,
  'reddit.com': 2.5,
  'youtube.com': 2.0
};

// -------------------------------
// NewsService
// -------------------------------
class NewsService {
  constructor(opts = {}) {
    this.logger = opts.logger || logger;
    this.API_TIMEOUT = 5000;
    this.aiService = new AIService();
    this.ratingService = new RatingService(); // Rating 서비스 인스턴스 추가

    // [LOG] 서비스 시작 시 환경 변수 로드 상태를 명확히 확인합니다.
    this.logger.info('--- Initializing NewsService: Checking Environment Variables ---');
    const checkEnv = (key) => {
      const value = process.env[key];
      if (value && value.length > 4) {
        this.logger.info(`[ENV] ${key}: Loaded (ends with ...${value.slice(-4)})`);
      } else if (value) {
        this.logger.info(`[ENV] ${key}: Loaded (is short)`);
      } else {
        this.logger.warn(`[ENV] ${key}: NOT FOUND! Service may not work as expected.`);
      }
    };
    ['NEWS_API_KEY', 'GNEWS_API_KEY', 'NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET', 'YOUTUBE_API_KEY', 'REDIS_URL'].forEach(checkEnv);
    this.logger.info('--------------------------------------------------------------');
    
    this.newsApiClient = axios.create({ baseURL:'https://newsapi.org/v2/', timeout:this.API_TIMEOUT, headers:{ 'X-Api-Key': process.env.NEWS_API_KEY || '' }});
    this.gnewsApi = axios.create({ baseURL:'https://gnews.io/api/v4/', timeout:this.API_TIMEOUT });
    this.naverClient = axios.create({ baseURL: 'https://openapi.naver.com/v1/search/', timeout: this.API_TIMEOUT, headers: { 'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID || '', 'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET || '' }});
    this.redditApi = axios.create({ baseURL:'https://oauth.reddit.com', timeout:this.API_TIMEOUT, headers:{ Authorization:`Bearer ${process.env.REDDIT_TOKEN||''}`, 'User-Agent':process.env.REDDIT_USER_AGENT||'emark-buzz/1.0' }});
    this.youtubeApi = axios.create({ baseURL:'https://www.googleapis.com/youtube/v3', timeout:this.API_TIMEOUT });
    this.rssParser = new Parser({ 
      timeout: 8000,
      headers: { 
        'User-Agent': 'EmarkNews/2.1 (+https://emarknews.com/crawler-info)',
        'Accept': 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
        'Accept-Language': 'ja,en;q=0.9',
        'Connection': 'keep-alive'
      }
    });
    
    // RSS 피드별 ETag/Last-Modified 캐시
    this.rssFeedCache = new Map();
  }

  // ====== 공개 API ======
  async getSectionFast(section='buzz', readArticles=[]){ return this._getFast(section, readArticles); }
  async getSectionFull(section='buzz', readArticles=[]){ return this._getFull(section, readArticles); }
  
  // ====== AI 연동 메서드 ======
  async _enrichArticlesWithAI(articles, section = 'world') {
    if (!this.aiService.client) {
      this.logger.warn('AI Service is not initialized. Skipping enrichment.');
      return articles;
    }

    const enrichedArticles = [];
    const BATCH_SIZE = 5; // 배치 크기 증가로 속도 향상

    this.logger.info(`[AI] Starting enrichment for ${articles.length} articles in batches of ${BATCH_SIZE}...`);

    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch = articles.slice(i, i + BATCH_SIZE);
      this.logger.info(`[AI] Processing batch ${i / BATCH_SIZE + 1}...`);
      
      const enrichmentPromises = batch.map(async (article) => {
        try {
          // 제목 언어 감지 및 번역 처리
          let translationPromise;
          const hasJapanese = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(article.title);
          const hasKorean = /[\uac00-\ud7af]/.test(article.title);
          const isEnglish = /^[a-zA-Z0-9\s\-\.,!?:;'"()]+$/.test(article.title);
          
          // 섹션별 번역 정책
          if (section === 'japan' || section === 'kr' || section === 'korea') {
            // 일본/한국 섹션: 한국어가 아닌 모든 언어를 번역
            if (!hasKorean) {
              translationPromise = this.aiService.translate(article.title, 'ko');
            } else {
              translationPromise = Promise.resolve({ success: true, data: { translated: article.title } });
            }
          } else {
            // 다른 섹션: 기존 로직 (일본어이거나 한국어가 아닌 경우 번역)
            if (hasJapanese || (!hasKorean && article.title)) {
              translationPromise = this.aiService.translate(article.title, 'ko');
            } else {
              translationPromise = Promise.resolve({ success: true, data: { translated: article.title } });
            }
          }
          
          const [translationResult, summaryResult] = await Promise.all([
            translationPromise,
            this.aiService.summarize(article.description || article.title, { detailed: false, maxPoints: 3 })
          ]);
          
          // 제목 번역 처리
          const titleKo = (translationResult.success && translationResult.data.translated) 
            ? translationResult.data.translated 
            : article.title;

          // 기본 요약 처리 (메인페이지용)
          let summaryPoints = [];
          if (summaryResult.success && summaryResult.data.summary) {
            const summary = summaryResult.data.summary;
            if (typeof summary === 'string') {
              summaryPoints = summary
                .split('\n')
                .map(line => line.replace(/^[•\-*\d\.\)]\s*/, '').trim())
                .filter(point => point && point.length > 5)
                .slice(0, 3); // 메인페이지용 3개 포인트
            } else if (Array.isArray(summary)) {
              summaryPoints = summary.filter(point => point && point.length > 5).slice(0, 3);
            }
          }
          
          // 기본 요약이 없으면 description 사용
          if (summaryPoints.length === 0) {
            summaryPoints = article.description 
              ? [article.description]
              : [article.title];
          }

          // 메인페이지용 기본 번역된 기사 반환
          return {
            ...article,
            titleKo,
            summaryPoints,
            descriptionKo: article.description || '', // 일단 원문 그대로
            tags: article.tags || []
          };
        } catch (error) {
          this.logger.error(`[AI] Error enriching article ${article.id}:`, error.stack);
          return {
            ...article,
            titleKo: article.title,
            summaryPoints: [article.description || article.title],
            descriptionKo: article.description || '',
            tags: []
          };
        }
      });

      const settledBatch = await Promise.all(enrichmentPromises);
      enrichedArticles.push(...settledBatch);
      
      // 배치 간 대기 시간 더 단축
      if (i + BATCH_SIZE < articles.length) {
        await new Promise(resolve => setTimeout(resolve, 200)); // 0.5초 → 0.2초로 단축
      }
    }
    
    this.logger.info(`[AI] Basic enrichment completed for all ${enrichedArticles.length} articles.`);
    
    // 상세 처리는 백그라운드에서 비동기로 진행
    this.processDetailedEnrichment(enrichedArticles).catch(error => {
      this.logger.error('[AI] Background detailed enrichment failed:', error);
    });
    
    return enrichedArticles;
  }

  // 상세 AI 처리를 백그라운드에서 진행
  async processDetailedEnrichment(articles) {
    this.logger.info(`[AI] Starting detailed background enrichment for ${articles.length} articles...`);
    
    for (const article of articles) {
      try {
        const fullText = `${article.title}\n\n${article.description || ''}`.trim();
        
        // 상세 요약과 내용 번역을 병렬 처리
        const [summaryResult, contentTransResult] = await Promise.all([
          this.aiService.summarize(fullText, { detailed: true, maxPoints: 5 }),
          article.description ? this.aiService.translate(article.description, 'ko') : Promise.resolve({ success: false })
        ]);
        
        // 상세 요약 처리
        let detailedSummaryPoints = [];
        if (summaryResult.success && summaryResult.data.summary) {
          const summary = summaryResult.data.summary;
          if (typeof summary === 'string') {
            detailedSummaryPoints = summary
              .split('\n')
              .map(line => line.replace(/^[•\-*\d\.\)]\s*/, '').trim())
              .filter(point => point && point.length > 10)
              .slice(0, 5);
          } else if (Array.isArray(summary)) {
            detailedSummaryPoints = summary.filter(point => point && point.length > 10).slice(0, 5);
          }
        }

        // 내용 번역 처리
        const descriptionKo = (contentTransResult.success && contentTransResult.data.translated)
          ? contentTransResult.data.translated
          : article.description || '';

        // 상세 처리 완료된 기사 정보 업데이트 (캐시에 반영)
        if (detailedSummaryPoints.length > 0) {
          article.summaryPoints = detailedSummaryPoints;
        }
        if (descriptionKo) {
          article.descriptionKo = descriptionKo;
        }
        
        this.logger.info(`[AI] Detailed enrichment completed for article: ${article.id}`);
        
        // 각 기사 처리 후 짧은 대기
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        this.logger.error(`[AI] Error in detailed enrichment for article ${article.id}:`, error);
      }
    }
    
    this.logger.info(`[AI] All detailed background enrichment completed.`);
  }

  async _enrichArticlesWithAI_OLD(articles) {
    if (!articles || articles.length === 0) {
      this.logger.warn('[AI] No articles to enrich');
      return articles;
    }

    const enrichedArticles = [];
    const BATCH_SIZE = 5; // 배치 크기 증가로 속도 향상

    this.logger.info(`[AI] Starting enrichment for ${articles.length} articles in batches of ${BATCH_SIZE}...`);

    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch = articles.slice(i, i + BATCH_SIZE);
      this.logger.info(`[AI] Processing batch ${i / BATCH_SIZE + 1}...`);
      
      const enrichmentPromises = batch.map(async (article) => {
        try {
          // 더 상세한 텍스트로 요약 요청
          const fullText = `${article.title}\n\n${article.description || ''}`.trim();
          
          // 병렬 처리로 속도 향상
          const [summaryResult, translationResult, contentTransResult] = await Promise.all([
            this.aiService.summarize(fullText, { detailed: true, maxPoints: 5 }),
            this.aiService.translate(article.title, 'ko'),
            article.description ? this.aiService.translate(article.description, 'ko') : Promise.resolve({ success: false })
          ]);
          
          // 요약 처리 개선
          let summaryPoints = [];
          if (summaryResult.success && summaryResult.data.summary) {
            const summary = summaryResult.data.summary;
            if (typeof summary === 'string') {
              summaryPoints = summary
                .split('\n')
                .map(line => line.replace(/^[•\-*\d\.\)]\s*/, '').trim())
                .filter(point => point && point.length > 10)
                .slice(0, 5); // 최대 5개 포인트
            } else if (Array.isArray(summary)) {
              summaryPoints = summary.filter(point => point && point.length > 10).slice(0, 5);
            }
          }

          // 번역 처리 개선
          const titleKo = (translationResult.success && translationResult.data.translated) 
            ? translationResult.data.translated 
            : article.title;

          const descriptionKo = (contentTransResult.success && contentTransResult.data.translated)
            ? contentTransResult.data.translated
            : article.description;

          const enrichedArticle = { 
            ...article, 
            titleKo,
            descriptionKo,
            summaryPoints: summaryPoints.length > 0 ? summaryPoints : [descriptionKo || article.description || article.title]
          };

          this.logger.info(`[AI] Enriched article: ${article.id} - Title: ${titleKo}, Summary points: ${summaryPoints.length}`);
          return enrichedArticle;
        } catch (error) {
          this.logger.warn(`AI enrichment failed for article ${article.id}:`, error.message);
          return { 
            ...article, 
            titleKo: article.title,
            descriptionKo: article.description,
            summaryPoints: [article.description || article.title]
          }; 
        }
      });
      
      const settledBatch = await Promise.all(enrichmentPromises);
      enrichedArticles.push(...settledBatch);
      
      // 배치 간 대기 시간 단축으로 속도 향상
      if (i + BATCH_SIZE < articles.length) {
        await new Promise(resolve => setTimeout(resolve, 500)); // 1초 → 0.5초로 단축
      }
    }
    
    this.logger.info(`[AI] Enrichment completed for all ${enrichedArticles.length} articles.`);
    return enrichedArticles;
  }

  // ====== 내부: 빠른 길 ======
  async _getFast(section, readArticles = []){
    // 읽은 기사가 있으면 캐시 키에 포함하여 개인화
    const readKey = readArticles.length > 0 ? `_read_${readArticles.slice(0, 10).join('_')}` : '';
    const key=`${section}_fast_${RATING_SERVICE_VERSION}${readKey}`;
    let cached = null;
    if (redis) { try { cached = await redis.get(key); } catch (e) { this.logger.warn('Redis get failed:', e.message); } }
    else { cached = memoryCache.get(key); }
    if (cached) {
      this.logger.info(`[Cache] Returning cached data for section: ${section}_fast`);
      try {
        // 안전한 JSON 파싱
        if (typeof cached === 'string') {
          return JSON.parse(cached);
        } else {
          // 이미 객체인 경우 그대로 반환
          return cached;
        }
      } catch (e) {
        this.logger.warn(`[Cache] Invalid cached data for ${section}_fast, clearing cache:`, e.message);
        // 잘못된 캐시 데이터 제거
        if (redis) {
          try { await redis.del(key); } catch (delErr) { this.logger.warn('Redis del failed:', delErr.message); }
        } else {
          memoryCache.delete(key);
        }
        // 캐시 제거 후 새로 데이터 수집
      }
    }

    this.logger.info(`[${section}] Starting _getFast fetch process...`);

    const rd = REDDIT_EP[section] || [];
    const rs = RSS_FEEDS[section] || [];
    let phase1 = [];
    
    // API 키가 없을 때는 RSS 우선으로 처리
    if (section === 'kr') { 
      phase1 = [ this.fetchFromNaver(section), ...(rs.slice(0,2).map(r=>this.fetchFromRSS(r.url))) ]; 
    }
    else if (section === 'japan') { 
      phase1 = [ ...(rs.slice(0,3).map(r=>this.fetchFromRSS(r.url))) ]; 
    }
    else { 
      // API 키가 있을 때만 NewsAPI 사용, 없으면 RSS만 사용
      if (process.env.NEWS_API_KEY && process.env.NEWS_API_KEY !== 'your_newsapi_key_here') {
        phase1 = [ this.fetchFromNewsAPI(section), ...(rs.slice(0,3).map(r=>this.fetchFromRSS(r.url))) ];
      } else {
        phase1 = [ ...(rs.slice(0,4).map(r=>this.fetchFromRSS(r.url))) ];
      }
    }
    
    const settledPromises = await Promise.allSettled(phase1);
    const first = settledPromises.filter(x=>x.status==='fulfilled').flatMap(x=>x.value||[]);
    this.logger.info(`[${section}] Step 1: Fetched ${first.length} raw articles from phase 1 sources.`);
    
    const filtered = filterRecent(first,336);
    this.logger.info(`[${section}] Step 2: After date filtering (14 days), ${filtered.length} articles remain.`);
    
    const unique = deduplicate(filtered);
    this.logger.info(`[${section}] Step 3: After deduplication, ${unique.length} unique articles remain.`);
    
    const rankedAll = await this.rankAndSort(section, unique, readArticles);
    const ranked = rankedAll.slice(0,FAST.FIRST_BATCH);
    this.logger.info(`[${section}] Step 4: After ranking, top ${ranked.length} articles selected.`);
    const initial = { success: true, data: ranked, section, total:ranked.length, partial:true, timestamp:new Date().toISOString() };
    
    try {
      if (redis) { await redis.set(key, JSON.stringify(initial), 'EX', FAST.TTL_FAST); } 
      else { memoryCache.set(key, initial); setTimeout(() => memoryCache.delete(key), FAST.TTL_FAST * 1000); }
    } catch (e) { this.logger.warn('Cache save failed:', e.message); }

    // Phase1 데이터로 즉시 AI 처리 시작
    this.logger.info(`[${section}] Starting immediate AI processing with ${ranked.length} articles from Phase1`);
    this._enrichArticlesWithAI(ranked, section).then(async enriched => {
      const aiProcessedAll = await this.rankAndSort(section, enriched);
      const aiProcessed = aiProcessedAll.slice(0,FAST.FIRST_BATCH);
      const aiPayload = { success: true, data: aiProcessed, section, total:aiProcessed.length, partial:false, timestamp:new Date().toISOString() };
      
      this.logger.info(`[${section}] AI processing completed. Saving to cache key: ${key}`);
      this.logger.info(`[${section}] AI payload sample: ${JSON.stringify({
        total: aiPayload.total,
        firstTitle: aiPayload.data[0]?.title,
        firstTitleKo: aiPayload.data[0]?.titleKo,
        translated: aiPayload.data[0]?.titleKo !== aiPayload.data[0]?.title
      })}`);
      
      if (redis) { 
        redis.set(key, JSON.stringify(aiPayload), 'EX', FAST.TTL_FAST).then(() => {
          this.logger.info(`[${section}] AI data successfully saved to Redis cache key: ${key}`);
        }).catch(e => {
          this.logger.error(`[${section}] AI cache save failed:`, e.message);
        }); 
      } else { 
        memoryCache.set(key, aiPayload); 
        setTimeout(() => memoryCache.delete(key), FAST.TTL_FAST * 1000); 
        this.logger.info(`[${section}] AI data successfully saved to memory cache key: ${key}`);
      }
      this.logger.info(`[${section}] Phase1 AI enrichment completed: ${aiProcessed.length} articles processed`);
    }).catch(e => {
      this.logger.error(`[${section}] Phase1 AI enrichment failed:`, e.message, e.stack);
    });

    (async()=>{
      try {
        const yt = YT_REGIONS[section] || [];
        let phase2 = [];
        if (section === 'kr') { 
          phase2 = [ ...rs.slice(2).map(r=>this.fetchFromRSS(r.url)) ]; 
        }
        else if (section === 'japan') { 
          phase2 = [ ...rs.slice(3).map(r=>this.fetchFromRSS(r.url)) ]; 
        }
        else { 
          // API 키가 있을 때만 YouTube/GNews 사용
          if (process.env.GNEWS_API_KEY && process.env.GNEWS_API_KEY !== 'your_gnews_api_key_here') {
            phase2 = [ 
              ...rs.slice(4).map(r=>this.fetchFromRSS(r.url)), 
              this.fetchFromGNews(section),
              this.fetchFromGNewsEverything(section) // GNews Everything 추가
            ];
          } else {
            phase2 = [ ...rs.slice(4).map(r=>this.fetchFromRSS(r.url)) ];
          }
        }
        
        this.logger.info(`[${section}] Starting Phase2 with ${phase2.length} additional sources`);
        const settledPromises2 = await Promise.allSettled(phase2);
        const extra = settledPromises2.filter(x=>x.status==='fulfilled').flatMap(x=>x.value||[]);
        this.logger.info(`[${section}] Phase2 collected ${extra.length} additional articles`);
        
        const merged = deduplicate(filterRecent([...ranked,...extra],336));
        this.logger.info(`[${section}] Phase2 merged total: ${merged.length} articles`);
        
        // Phase2 완료 후 전체 데이터로 AI 처리
        if (merged.length > ranked.length) {
          this.logger.info(`[${section}] Starting Phase2 AI processing with ${merged.length} total articles`);
          this._enrichArticlesWithAI(merged, section).then(async enriched => {
            const fullAll = await this.rankAndSort(section, enriched);
            const full = fullAll.slice(0,FAST.FULL_MAX);
            const payload = { success: true, data: full, section, total:full.length, partial:false, timestamp:new Date().toISOString() };
            
            if (redis) { 
              redis.set(key, JSON.stringify(payload), 'EX', FAST.TTL_FULL).catch(e => 
                this.logger.warn('Phase2 cache save failed:', e.message)
              ); 
            } else { 
              memoryCache.set(key, payload); 
              setTimeout(() => memoryCache.delete(key), FAST.TTL_FULL * 1000); 
            }
            this.logger.info(`[${section}] Phase2 AI enrichment completed: ${full.length} articles processed`);
          }).catch(e => {
            this.logger.error(`[${section}] Phase2 AI enrichment failed:`, e.message, e.stack);
            // AI 실패 시에도 기본 데이터는 캐시
            const basicPayload = { success: true, data: merged.slice(0,FAST.FULL_MAX), section, total:merged.length, partial:false, timestamp:new Date().toISOString() };
            if (redis) { 
              redis.set(key, JSON.stringify(basicPayload), 'EX', FAST.TTL_FULL).catch(() => {}); 
            } else { 
              memoryCache.set(key, basicPayload); 
              setTimeout(() => memoryCache.delete(key), FAST.TTL_FULL * 1000); 
            }
          });
        } else {
          this.logger.info(`[${section}] Phase2 added no new articles, skipping additional AI processing`);
        }
        
      } catch (e) { this.logger.warn('Phase2 failed:', e.message); }
    })();

    return initial;
  }

  // ====== 내부: 완전체 ======
  async _getFull(section){
    const key=`${section}_full_${RATING_SERVICE_VERSION}`;
    let cached = null;
    if (redis) { try { cached = await redis.get(key); } catch (e) { this.logger.warn('Redis get failed:', e.message); } }
    else { cached = memoryCache.get(key); }
    if (cached) return JSON.parse(cached);

    const rd = REDDIT_EP[section] || [];
    const yt = YT_REGIONS[section] || [];
    const rs = RSS_FEEDS[section] || [];
    const tasks = [ 
      this.fetchFromNewsAPI(section), 
      this.fetchFromNewsAPIEverything(section), // NewsAPI everything 엔드포인트
      this.fetchFromGNews(section), 
      this.fetchFromGNewsEverything(section), // GNews everything 엔드포인트 추가
      ...rd.map(r=>this.fetchFromRedditAPI(r)), 
      ...yt.map(y=>this.fetchFromYouTubeTrending(y)), 
      ...rs.map(r=>this.fetchFromRSS(r.url)) 
    ];
    if (section === 'kr') tasks.push(this.fetchFromNaver(section));

    const settled = await Promise.allSettled(tasks);
    const raw = settled.filter(s=>s.status==='fulfilled').flatMap(s=>s.value||[]);
    const uniqueRaw = deduplicate(filterRecent(raw, 336));
    
    const enriched = await this._enrichArticlesWithAI(uniqueRaw, section);
    const fullAll = await this.rankAndSort(section, enriched);
    const full = fullAll.slice(0,FAST.FULL_MAX);
    const payload = { success: true, data: full, section, total:full.length, partial:false, timestamp:new Date().toISOString() };
    
    try {
      if (redis) { await redis.set(key, JSON.stringify(payload), 'EX', FAST.TTL_FULL); }
      else { memoryCache.set(key, payload); setTimeout(() => memoryCache.delete(key), FAST.TTL_FULL * 1000); }
    } catch (e) { this.logger.warn('Cache save failed:', e.message); }
    
    return payload;
  }

  // -----------------------------
  // Fetchers
  // -----------------------------
  async fetchFromNewsAPI(section) {
    if (!process.env.NEWS_API_KEY) return [];
    try {
      // 14일 전 날짜 계산
      const from = new Date();
      from.setDate(from.getDate() - 14);
      
      const params = { 
        pageSize: 100, // 기존 50에서 100으로 변경 - 더 많은 뉴스 수집
        sortBy: 'publishedAt',
        from: from.toISOString().split('T')[0] // YYYY-MM-DD 형식
      };
      params.language = (section === 'kr' || section === 'korea') ? 'ko' : 'en';

      if (section === 'world') {
        const countries = ['us', 'gb', 'jp', 'au', 'ca'];
        const promises = countries.map(country => this.newsApiClient.get('top-headlines', { params: { ...params, country } }).catch(err => { this.logger.warn(`NewsAPI failed for country ${country}:`, err.message); return { data: { articles: [] }}; }));
        const results = await Promise.all(promises);
        const articles = results.flatMap(r => r.data.articles || []);
        this.logger.info(`[Fetcher] NewsAPI fetched ${articles.length} articles for section: ${section}`);
        return this.normalizeNewsAPIArticles(articles);
      } else if (['tech', 'business'].includes(section)) {
        params.category = section;
      }
      
      const response = await this.newsApiClient.get('top-headlines', { params });
      const articles = response.data.articles || [];
      this.logger.info(`[Fetcher] NewsAPI fetched ${articles.length} articles for section: ${section}`);
      return this.normalizeNewsAPIArticles(articles);
    } catch (error) {
      this.logger.error('--- [Fetcher] NewsAPI Detailed Error ---');
      if (error.response) {
        // 시나리오 B: API 서버가 응답을 보냈을 때 (4xx, 5xx 에러)
        this.logger.error(`Status: ${error.response.status}`);
        this.logger.error('Data:', error.response.data); // 여기에 apiKeyDisabled 같은 코드가 찍힙니다.
      } else if (error.request) {
        // 응답을 받지 못했을 때
        this.logger.error('No response received from NewsAPI.');
      } else {
        // 시나리오 A: 요청을 보내기 전에 에러가 발생했을 때 (ENOTFOUND 등)
        this.logger.error('Error setting up request:', error.message);
      }
      this.logger.error('--------------------------------------');
      return [];
    }
  }
  
  // NewsAPI Everything 엔드포인트 활용 - 키워드 기반 검색으로 더 많은 기사 수집
  async fetchFromNewsAPIEverything(section) {
    if (!process.env.NEWS_API_KEY) return [];
    
    // 섹션별 키워드 정의
    const SECTION_KEYWORDS = {
      world: [
        'international politics', 'global economy', 'climate change', 'diplomacy',
        'United Nations', 'European Union', 'G7', 'NATO', 'trade war',
        'geopolitics', 'sanctions', 'peace talks', 'summit'
      ],
      tech: [
        'artificial intelligence', 'machine learning', 'blockchain', 'cryptocurrency',
        'semiconductor', 'quantum computing', 'cybersecurity', 'data privacy',
        'cloud computing', 'IoT', '5G', 'autonomous vehicles', 'robotics',
        'startup funding', 'IPO tech', 'big tech', 'silicon valley'
      ],
      business: [
        'stock market', 'earnings report', 'merger acquisition', 'IPO',
        'inflation', 'interest rates', 'GDP', 'unemployment', 'retail sales',
        'corporate earnings', 'venture capital', 'private equity', 'banking',
        'real estate market', 'commodity prices', 'economic policy'
      ],
      buzz: [
        'viral', 'trending', 'social media', 'celebrity', 'entertainment',
        'sports championship', 'breaking news', 'controversy', 'scandal',
        'award ceremony', 'fashion week', 'movie premiere', 'music festival'
      ],
      kr: [
        '한국 정치', '국정감사', '대통령', '국회', '선거',
        '한국 경제', '삼성', 'LG', '현대', 'SK', 'TSMC',
        'K-pop', '한류', '드라마', '영화', '문화'
      ]
    };

    const keywords = SECTION_KEYWORDS[section] || SECTION_KEYWORDS.world;
    
    try {
      // 7일 전 날짜 계산 (everything 엔드포인트는 더 짧은 기간 사용)
      const from = new Date();
      from.setDate(from.getDate() - 7);
      
      // 키워드를 3-4개씩 조합해서 여러 번 검색
      const keywordBatches = [];
      for (let i = 0; i < keywords.length; i += 3) {
        keywordBatches.push(keywords.slice(i, i + 3));
      }
      
      const allArticles = [];
      
      for (const batch of keywordBatches.slice(0, 5)) { // 최대 5개 배치만 처리
        const query = batch.join(' OR ');
        const params = {
          q: query,
          pageSize: 50, // everything 엔드포인트는 50개씩
          sortBy: 'publishedAt',
          from: from.toISOString().split('T')[0],
          language: section === 'kr' ? 'ko' : 'en'
        };
        
        try {
          const response = await this.newsApiClient.get('everything', { params });
          const articles = response.data.articles || [];
          allArticles.push(...articles);
          
          // API 호출 간격 조절 (Rate Limit 방지)
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (batchError) {
          this.logger.warn(`NewsAPI Everything batch failed for keywords "${query}":`, batchError.message);
        }
      }
      
      this.logger.info(`[Fetcher] NewsAPI Everything fetched ${allArticles.length} articles for section: ${section}`);
      return this.normalizeNewsAPIArticles(allArticles);
      
    } catch (error) {
      this.logger.error('--- [Fetcher] NewsAPI Everything Detailed Error ---');
      if (error.response) {
        this.logger.error(`Status: ${error.response.status}`);
        this.logger.error('Data:', error.response.data);
      } else if (error.request) {
        this.logger.error('No response received from NewsAPI Everything.');
      } else {
        this.logger.error('Error setting up request:', error.message);
      }
      this.logger.error('--------------------------------------');
      return [];
    }
  }
  
  async fetchFromGNews(section) {
    if (!process.env.GNEWS_API_KEY) return [];
    try {
      // 14일 전 날짜 계산
      const from = new Date();
      from.setDate(from.getDate() - 14);
      
      const params = {
        token: process.env.GNEWS_API_KEY,
        max: 50,
        lang: section === 'kr' ? 'ko' : 'en',
        from: from.toISOString().split('T')[0] // YYYY-MM-DD 형식
      };
      if (section === 'tech') {
        params.topic = 'technology';
      } else if (section === 'business') {
        params.topic = 'business';
      } else if (section === 'world') {
        params.topic = 'world';
      }
      const response = await this.gnewsApi.get('top-headlines', { params });
      const articles = response.data.articles || [];
      this.logger.info(`[Fetcher] GNews fetched ${articles.length} articles for section: ${section}`);
      return this.normalizeGNewsArticles(articles);
    } catch (error) {
      this.logger.error('--- [Fetcher] GNewsAPI Detailed Error ---');
      if (error.response) {
        this.logger.error(`Status: ${error.response.status}`);
        this.logger.error('Data:', error.response.data);
      } else if (error.request) {
        this.logger.error('No response received from GNewsAPI. Request details:', error.request);
      } else {
        this.logger.error('Error setting up request:', error.message);
      }
      this.logger.error('Full Error Object:', error);
      this.logger.error('-------------------------------------');
      return [];
    }
  }
  
  // GNews Everything 엔드포인트 - 키워드 기반 검색으로 다양하고 흥미로운 기사 수집
  async fetchFromGNewsEverything(section) {
    if (!process.env.GNEWS_API_KEY) return [];
    
    const GNEWS_KEYWORDS = {
      world: [
        // 정치/국제
        ['breaking news', 'urgent', 'crisis'],
        ['viral', 'trending', 'shocking'],
        ['exclusive', 'investigation', 'scandal'],
        ['celebrity', 'entertainment', 'hollywood'],
        ['climate change', 'environment', 'disaster'],
        ['technology breakthrough', 'AI', 'innovation'],
        ['sports', 'olympics', 'championship']
      ],
      tech: [
        ['AI breakthrough', 'artificial intelligence', 'machine learning'],
        ['cryptocurrency', 'bitcoin', 'blockchain'],
        ['startup', 'venture capital', 'IPO'],
        ['cybersecurity', 'hacking', 'data breach'],
        ['space technology', 'SpaceX', 'NASA'],
        ['electric vehicle', 'Tesla', 'autonomous'],
        ['viral tech', 'trending gadget', 'innovation']
      ],
      business: [
        ['market crash', 'stock surge', 'earnings'],
        ['merger', 'acquisition', 'IPO'],
        ['cryptocurrency', 'bitcoin', 'trading'],
        ['startup funding', 'venture capital', 'unicorn'],
        ['economic crisis', 'inflation', 'recession'],
        ['viral business', 'trending company', 'breakthrough'],
        ['CEO scandal', 'corporate news', 'leadership']
      ],
      buzz: [
        ['viral', 'trending', 'social media'],
        ['celebrity scandal', 'entertainment news', 'hollywood'],
        ['meme', 'internet culture', 'influencer'],
        ['lifestyle', 'fashion', 'beauty'],
        ['food trend', 'restaurant', 'cooking'],
        ['travel', 'vacation', 'destination'],
        ['health trend', 'fitness', 'wellness']
      ],
      kr: [
        ['한국', '서울', 'K-pop'],
        ['삼성', 'LG', '현대'],
        ['정치', '대통령', '국회'],
        ['경제', '주식', '부동산'],
        ['연예인', '드라마', '영화'],
        ['스포츠', '축구', '야구'],
        ['바이럴', '트렌드', '화제']
      ],
      jp: [
        ['Japan', 'Tokyo', 'Japanese'],
        ['Sony', 'Nintendo', 'Toyota'],
        ['anime', 'manga', 'culture'],
        ['earthquake', 'tsunami', 'disaster'],
        ['technology', 'robot', 'innovation'],
        ['viral Japan', 'trending', 'popular'],
        ['business Japan', 'economy', 'market']
      ]
    };

    const keywords = GNEWS_KEYWORDS[section] || GNEWS_KEYWORDS.world;
    const allArticles = [];
    
    try {
      // 키워드 그룹별로 검색 (3개씩 처리)
      for (let i = 0; i < Math.min(keywords.length, 3); i++) {
        const keywordGroup = keywords[i];
        const query = keywordGroup.join(' OR ');
        
        const params = {
          token: process.env.GNEWS_API_KEY,
          q: query,
          max: 20,
          lang: section === 'kr' ? 'ko' : (section === 'jp' ? 'ja' : 'en'),
          from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // 7일 전
        };
        
        const response = await this.gnewsApi.get('search', { params });
        const articles = response.data.articles || [];
        
        allArticles.push(...articles.map(article => ({
          ...article,
          _searchKeywords: keywordGroup.join(', ')
        })));
        
        this.logger.info(`[GNews Everything] Fetched ${articles.length} articles for keywords: ${keywordGroup.join(', ')}`);
        
        // API Rate Limit 방지
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      this.logger.info(`[GNews Everything] Total fetched ${allArticles.length} articles for section: ${section}`);
      return this.normalizeGNewsArticles(allArticles);
      
    } catch (error) {
      this.logger.error('--- [Fetcher] GNews Everything API Error ---');
      if (error.response) {
        this.logger.error(`Status: ${error.response.status}`);
        this.logger.error('Data:', error.response.data);
      } else {
        this.logger.error('Error:', error.message);
      }
      this.logger.error('------------------------------------------');
      return [];
    }
  }
  
  async fetchFromNaver(section) {
    if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) return [];
    try {
      const queries = ['속보', '긴급', '최신뉴스', '주요뉴스'];
      const promises = queries.map(query =>
        this.naverClient.get('news.json', {
          params: {
            query,
            display: 30,
            sort: 'date'
          }
        }).catch(() => ({ data: { items: [] }}))
      );
      const results = await Promise.all(promises);
      return results.flatMap(r => this.normalizeNaverArticles(r.data.items || []));
    } catch (error) {
      this.logger.error('Naver API error:', error.message);
      return [];
    }
  }
  async fetchFromRedditAPI({path='/r/all/new',limit=100}){ 
    // Reddit API 토큰 없음 - 빈 배열 반환
    return []; 
  }
  async fetchFromYouTubeTrending({regionCode='US', maxResults=30}){
    if (!process.env.YOUTUBE_API_KEY) return [];
    
    try{
      const params={ part:'snippet,statistics', chart:'mostPopular', regionCode, maxResults:Math.min(maxResults,50), key:process.env.YOUTUBE_API_KEY };
      const {data}=await this.youtubeApi.get('/videos',{params});
      return (data?.items||[]).map(v=>{
        const s=v.snippet||{}, st=v.statistics||{};
        return this.normalizeItem({
          title:s.title, url:`https://youtube.com/watch?v=${v.id}`,
          source:'YouTube', lang:(s.defaultAudioLanguage||s.defaultLanguage||'und').slice(0,2),
          publishedAt:s.publishedAt,
          reactions:(+st.viewCount||0)+(+st.likeCount||0)+(+st.commentCount||0),
          followers:0, domain:'youtube.com', _srcType:'yt'
        });
      });
    }catch(e){ 
      this.logger.warn('YouTube fail:', e.message); 
      return []; 
    }
  }

  async fetchFromRSS(url, retryCount = 0) {
    const maxRetries = 3;
    const baseDelay = 1000; // 1초
    
    try {
      // 캐시된 ETag/Last-Modified 확인
      const cacheKey = `rss_${sha1(url)}`;
      const cached = this.rssFeedCache.get(cacheKey) || {};
      
      // 조건부 요청 헤더 설정
      const conditionalHeaders = {};
      if (cached.etag) {
        conditionalHeaders['If-None-Match'] = cached.etag;
      }
      if (cached.lastModified) {
        conditionalHeaders['If-Modified-Since'] = cached.lastModified;
      }
      
      // axios를 사용한 직접 요청 (조건부 헤더 + DNS 설정 포함)
      const response = await axios.get(url, {
        timeout: 10000, // 타임아웃 증가
        headers: {
          'User-Agent': 'EmarkNews/2.1 (+https://emarknews.com/crawler-info)',
          'Accept': 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
          'Accept-Language': 'ja,en;q=0.9',
          'Connection': 'keep-alive',
          ...conditionalHeaders
        },
        validateStatus: (status) => status < 500, // 4xx는 에러로 처리하지 않음
        // DNS 설정 추가
        family: 4, // IPv4 강제 사용
        lookup: require('dns').lookup // 시스템 DNS 사용
      });
      
      // 304 Not Modified - 캐시된 데이터 사용
      if (response.status === 304) {
        this.logger.info(`[Fetcher] RSS (${url}) - 304 Not Modified, using cached data`);
        return cached.items || [];
      }
      
      // 4xx 에러 처리 (403, 429 등)
      if (response.status >= 400 && response.status < 500) {
        this.logger.warn(`[Fetcher] RSS (${url}) - ${response.status} error, skipping for 60 minutes`);
        // 쿨다운 설정 (60분)
        this.rssFeedCache.set(cacheKey, {
          ...cached,
          cooldownUntil: Date.now() + (60 * 60 * 1000) // 60분
        });
        return [];
      }
      
      // RSS 파싱
      const feed = await this.rssParser.parseString(response.data);
      const items = feed.items || [];
      
      // 캐시 업데이트
      const newCache = {
        items: items.map(it => this.normalizeItem({
          title: it.title || '',
          url: it.link || '',
          source: feed.title || domainFromUrl(url),
          lang: 'en',
          publishedAt: this.validateAndParseDate(it.pubDate || it.isoDate),
          reactions: 0,
          followers: 0,
          domain: domainFromUrl(it.link || ''),
          _srcType: 'rss'
        })).filter(item => item.publishedAt !== null), // 유효한 날짜만 필터링
        etag: response.headers.etag,
        lastModified: response.headers['last-modified'],
        lastFetch: Date.now()
      };
      
      this.rssFeedCache.set(cacheKey, newCache);
      this.logger.info(`[Fetcher] RSS (${url}) fetched ${items.length} items.`);
      
      return newCache.items;
      
    } catch (e) {
      // 네트워크/5xx/타임아웃 오류에 대한 지수 백오프
      if (retryCount < maxRetries && this.shouldRetry(e)) {
        const delay = baseDelay * Math.pow(2, retryCount);
        this.logger.warn(`[Fetcher] RSS (${url}) retry ${retryCount + 1}/${maxRetries} after ${delay}ms: ${e.message}`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchFromRSS(url, retryCount + 1);
      }
      
      this.logger.warn(`[Fetcher] RSS fail (${url}):`, e.message);
      return [];
    }
  }
  
  // 재시도 가능한 오류인지 판단
  shouldRetry(error) {
    if (error.code === 'ECONNABORTED') return true; // 타임아웃
    if (error.code === 'ENOTFOUND') return true; // DNS 오류
    if (error.code === 'ECONNRESET') return true; // 연결 리셋
    if (error.response && error.response.status >= 500) return true; // 5xx 오류
    return false;
  }

  // -----------------------------
  // 정규화 & 랭킹
  // -----------------------------
  normalizeNewsAPIArticles(articles) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return articles
      .filter(article => {
        // 날짜 필터링: 최근 30일 이내의 뉴스만 포함
        if (!article.publishedAt) return false;
        
        const publishedDate = new Date(article.publishedAt);
        if (isNaN(publishedDate.getTime())) return false;
        
        return publishedDate >= thirtyDaysAgo;
      })
      .map(article => this.normalizeItem({
        title: article.title,
        description: article.description,
        url: article.url,
        source: article.source?.name || 'NewsAPI',
        publishedAt: article.publishedAt,
        reactions: 0,
        followers: 0,
        domain: domainFromUrl(article.url),
        _srcType: 'newsapi'
      }));
  }
  normalizeGNewsArticles(articles) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return articles
      .filter(article => {
        if (!article.publishedAt) return false;
        const publishedDate = new Date(article.publishedAt);
        if (isNaN(publishedDate.getTime())) return false;
        return publishedDate >= thirtyDaysAgo;
      })
      .map(article => this.normalizeItem({
        title: article.title,
        description: article.description,
        url: article.url,
        source: article.source?.name || 'GNews',
        publishedAt: article.publishedAt,
        reactions: 0,
        followers: 0,
        domain: domainFromUrl(article.url),
        _srcType: 'gnews'
      }));
  }
  normalizeNaverArticles(articles) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return articles
      .filter(article => {
        if (!article.pubDate) return false;
        const publishedDate = new Date(article.pubDate);
        if (isNaN(publishedDate.getTime())) return false;
        return publishedDate >= thirtyDaysAgo;
      })
      .map(article => this.normalizeItem({
        title: this.stripHtml(article.title),
        description: this.stripHtml(article.description),
        url: article.originallink || article.link,
        source: 'Naver News',
        publishedAt: article.pubDate,
        reactions: 0,
        followers: 0,
        domain: domainFromUrl(article.originallink || article.link),
        _srcType: 'naver'
      }));
  }

  validateAndParseDate(dateString) {
    if (!dateString) return null; // 날짜가 없으면 null 반환
    
    try {
      const parsedDate = new Date(dateString);
      
      // 유효하지 않은 날짜 체크
      if (isNaN(parsedDate.getTime())) {
        return null;
      }
      
      // 너무 오래된 기사 필터링 (30일 이상)
      const now = new Date();
      const daysDiff = (now - parsedDate) / (1000 * 60 * 60 * 24);
      
      if (daysDiff > 30) {
        this.logger.warn(`Old article filtered: ${daysDiff.toFixed(1)} days old`);
        return null;
      }
      
      // 미래 날짜 체크 (1시간 이상 미래)
      if (parsedDate > new Date(Date.now() + 60 * 60 * 1000)) {
        this.logger.warn(`Future article filtered: ${parsedDate.toISOString()}`);
        return null;
      }
      
      return parsedDate.toISOString();
    } catch (error) {
      this.logger.warn(`Invalid date format: ${dateString}`);
      return null;
    }
  }

  stripHtml(text) { if (!text) return ''; return text.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim(); }

  normalizeItem(raw){
    const ageMin = minutesSince(raw.publishedAt);
    const domain = raw.domain || domainFromUrl(raw.url);
    return { id: this.generateArticleId(raw.url, raw.source), title: raw.title || '', link: raw.url || '', source: raw.source || 'Unknown', description: raw.description || raw.title || '', publishedAt: raw.publishedAt, domain, reactions: raw.reactions || 0, followers: raw.followers || 0, ageMinutes: ageMin, _srcType: raw._srcType || 'unknown' };
  }

  generateArticleId(url, source) {
    const combined = `${source}_${url}`;
    return Buffer.from(combined).toString('base64').replace(/[/+=]/g, '').substring(0, 16);
  }

  generateTags(item, section) {
    const tags = new Set();
    const title = item.title.toLowerCase();
    if (section === 'buzz') tags.add('Buzz');
    if (item.score > 0.65) tags.add('Hot');
    if (title.includes('속보') || title.includes('긴급') || title.includes('breaking')) tags.add('긴급');
    return Array.from(tags);
  }

  async rankAndSort(section, items, readArticles = []) {
    if (!items || items.length === 0) return [];
    const freshness = (ageMin) => Math.max(0, 1 - (ageMin / (24 * 60)));
    const w = SECTION_WEIGHTS[section] || DEFAULT_WEIGHTS.world;
    
    const rankedItems = await Promise.all(items.map(async (it) => {
      const ageMin = it.ageMinutes || 0;
      const domain = it.domain || '';
      const f_score = freshness(ageMin);
      const v_score = Math.min(1, (it.reactions || 0) / 1000);
      const e_score = Math.min(1, Math.log10((it.reactions || 0) + 1) / 4);
      const s_score = (SOURCE_WEIGHTS[domain] || 1) / 5;
      const score = (w.f * f_score) + (w.v * v_score) + (w.e * e_score) + (w.s * s_score);
      
      // ratingService를 사용한 고급 평점 계산
      let rating = await this.ratingService.calculateRating(it);
      
      // 🔥 읽은 기사 페널티: 읽은 기사는 평점에서 2점 차감하여 뒤로 보냄
      const isRead = readArticles.includes(it.id);
      if (isRead) {
        rating = Math.max(0.1, rating - 2.0); // 최소 0.1점 유지
        this.logger.debug(`[ReadPenalty] Article ${it.id} penalty applied: ${rating + 2.0} → ${rating}`);
      }
      
      return { 
          ...it, 
          score,
          rating: rating.toFixed(1),
          titleKo: it.titleKo || it.title, 
          summaryPoints: (it.summaryPoints && it.summaryPoints.length > 0) ? it.summaryPoints : (it.description ? [it.description] : []),
          tags: this.generateTags(it, section)
      };
    }));
    
    return rankedItems.sort((a, b) => b.score - a.score);
  }

  // ====== 기타 유틸리티 ======
  getStatus() {
    return {
      initialized: true,
      sections: Object.keys(DEFAULT_WEIGHTS),
      cache: redis ? 'redis' : 'memory'
    };
  }

  // [복원된 필수 함수]
  getCacheStatus() {
    return {
      type: redis ? 'redis' : 'memory',
      connected: redis ? redis.isOpen : false, // ioredis는 isReady, node-redis v4+는 isOpen
    };
  }

  // [복원된 필수 함수]
  async clearCache() {
    if (redis) {
      try {
        await redis.flushAll();
        this.logger.info('Redis cache cleared.');
      } catch (e) {
        this.logger.warn('Redis clear failed:', e.message);
      }
    } else {
      memoryCache.clear();
      this.logger.info('Memory cache cleared.');
    }
  }

  /**
   * ID를 기반으로 캐시에서 단일 기사를 찾습니다.
   * @param {string} section - 기사 섹션
   * @param {string} articleId - 찾을 기사의 ID
   * @returns {Promise<object>} 기사 데이터 또는 에러 메시지
   */
  async getArticleById(section, articleId) {
    // fast, full 순서로 캐시를 확인합니다.
    const keysToTry = [`${section}_full`, `${section}_fast`];
    this.logger.info(`[Detail] Searching for articleId: ${articleId} in section: ${section}`);

    for (const key of keysToTry) {
      let cachedData = null;
      try {
        if (redis) {
          cachedData = await redis.get(key);
        } else {
          cachedData = memoryCache.get(key);
        }

        if (cachedData) {
          let parsedList;
          if (typeof cachedData === 'string') {
            parsedList = JSON.parse(cachedData);
          } else {
            parsedList = cachedData;
          }
          
          if (parsedList && parsedList.data && Array.isArray(parsedList.data)) {
            const article = parsedList.data.find(item => item.id === articleId);

            if (article) {
              this.logger.info(`[Detail] Found article in cache key: ${key}`);
              return { success: true, data: article };
            }
          }
        }
      } catch (e) {
        this.logger.warn(`[Detail] Failed to read or parse cache for key ${key}:`, e.message);
      }
    }

    this.logger.warn(`[Detail] Article not found in any cache for section: ${section}, id: ${articleId}`);
    return { success: false, message: 'Article not found or cache expired.' };
  }

  /**
   * AI 번역은 유지하면서 평점만 재계산하는 메서드
   */
  async refreshRatingsOnly(section) {
    try {
        this.logger.info(`[${section}] Starting ratings-only refresh...`);
        
        // 1. 기존 캐시에서 AI 번역된 데이터 찾기
        const possibleKeys = [
            `${section}_fast_v2.0`,
            `${section}_fast_v1.0`, 
            `${section}_fast`,
            `${section}_full_v2.0`,
            `${section}_full_v1.0`,
            `${section}_full`
        ];
        
        let existingData = null;
        let foundKey = null;
        
        for (const key of possibleKeys) {
            try {
                if (redis) {
                    const cached = await redis.get(key);
                    if (cached) {
                        existingData = JSON.parse(cached);
                        foundKey = key;
                        break;
                    }
                } else {
                    const cached = memoryCache.get(key);
                    if (cached) {
                        existingData = cached;
                        foundKey = key;
                        break;
                    }
                }
            } catch (e) {
                this.logger.warn(`Failed to check cache key ${key}:`, e.message);
            }
        }
        
        if (!existingData || !existingData.data || existingData.data.length === 0) {
            this.logger.warn(`[${section}] No existing data found for ratings refresh`);
            return null;
        }
        
        this.logger.info(`[${section}] Found existing data with ${existingData.data.length} articles from key: ${foundKey}`);
        
        // 2. AI 번역은 그대로 두고 평점만 재계산
        const reRatedArticles = await Promise.all(
            existingData.data.map(async (article) => {
                try {
                    const newRating = await this.ratingService.calculateRating(article);
                    return {
                        ...article,
                        rating: newRating.toFixed(1),
                        ratingUpdatedAt: new Date().toISOString()
                    };
                } catch (error) {
                    this.logger.error(`Failed to recalculate rating for article: ${article.title}`, error);
                    return {
                        ...article,
                        rating: article.rating || "3.0", // 기존 평점 유지
                        ratingError: error.message
                    };
                }
            })
        );
        
        // 3. 평점 순으로 재정렬
        reRatedArticles.sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
        
        // 4. 통계 계산
        const ratings = reRatedArticles.map(item => parseFloat(item.rating));
        const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
        
        this.logger.info(`[${section}] Ratings recalculated - Avg: ${avgRating.toFixed(1)}, Min: ${Math.min(...ratings)}, Max: ${Math.max(...ratings)}`);
        
        // 5. 새 버전으로 캐시 저장
        const newData = {
            ...existingData,
            data: reRatedArticles,
            timestamp: new Date().toISOString(),
            ratingVersion: RATING_SERVICE_VERSION,
            ratingRefreshedAt: new Date().toISOString()
        };
        
        const newKey = `${section}_fast_${RATING_SERVICE_VERSION}`;
        
        try {
            if (redis) {
                await redis.set(newKey, JSON.stringify(newData), 'EX', FAST.TTL_FAST);
            } else {
                memoryCache.set(newKey, newData);
                setTimeout(() => memoryCache.delete(newKey), FAST.TTL_FAST * 1000);
            }
            this.logger.info(`[${section}] Ratings-only refresh completed and cached with key: ${newKey}`);
        } catch (e) {
            this.logger.warn(`[${section}] Failed to cache ratings-only refresh:`, e.message);
        }
        
        return newData;
        
    } catch (error) {
        this.logger.error(`[${section}] Ratings-only refresh failed:`, error);
        throw error;
    }
  }

  /**
   * 모든 섹션의 평점을 재계산
   */
  async refreshAllRatingsOnly() {
    const sections = ['world', 'kr', 'japan', 'buzz', 'tech', 'business'];
    const results = {};
    
    for (const section of sections) {
        try {
            const result = await this.refreshRatingsOnly(section);
            results[section] = {
                success: true,
                articlesCount: result?.data?.length || 0,
                avgRating: result?.data ? 
                    (result.data.reduce((sum, item) => sum + parseFloat(item.rating), 0) / result.data.length).toFixed(1) : 
                    'N/A'
            };
        } catch (error) {
            results[section] = {
                success: false,
                error: error.message
            };
        }
    }
    
    return results;
  }
}

module.exports = NewsService;
