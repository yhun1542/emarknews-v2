/**
 * Emark - RatingService (v3 - Final Optimized Version)
 *
 * 주요 변경 사항:
 * - '화제성(Velocity)' 점수 도입으로 랭킹 알고리즘 고도화.
 * - 서버 부하 감소를 위한 구조 최적화 및 사용 가이드 추가.
 * - 유틸리티 함수를 정적(static) 메서드로 통합하여 코드 구조 개선.
 * - 매직 넘버를 CONFIG 상수로 이전하여 유지보수성 향상.
 */
const crypto = require('crypto');
const logger = require('../utils/logger');

// -------------------- Configuration --------------------

const CONFIG = {
  // 섹션별 가중치 프로필 (f:신선도, v:화제성, e:참여도, s:신뢰도, d:다양성, l:로케일, u:긴급성)
  WEIGHTS: {
    buzz:     { f: 0.20, v: 0.50, e: 0.10, s: 0.10, d: 0.05, l: 0.03, u: 0.02 },
    world:    { f: 0.35, v: 0.15, e: 0.10, s: 0.30, d: 0.05, l: 0.03, u: 0.02 },
    korea:    { f: 0.30, v: 0.20, e: 0.10, s: 0.30, d: 0.05, l: 0.03, u: 0.02 },
    japan:    { f: 0.30, v: 0.20, e: 0.10, s: 0.30, d: 0.05, l: 0.03, u: 0.02 },
    business: { f: 0.25, v: 0.20, e: 0.20, s: 0.30, d: 0.03, l: 0.02, u: 0.00 },
    tech:     { f: 0.15, v: 0.50, e: 0.15, s: 0.15, d: 0.03, l: 0.02, u: 0.00 },
  },
  HALF_LIFE_MINUTES: {
    buzz: 90, world: 180, korea: 120, japan: 120, business: 240, tech: 120, default: 120,
  },
  DOMAIN_TRUST_SCORES: {
    'bbc.co.uk': 0.9, 'reuters.com': 0.9, 'apnews.com': 0.9, 'cnn.com': 0.8,
    'ft.com': 0.9, 'wsj.com': 0.9, 'bloomberg.com': 0.9, 'cnbc.com': 0.8,
    'yna.co.kr': 0.8, 'kbs.co.kr': 0.8, 'mbc.co.kr': 0.8, 'sbs.co.kr': 0.8,
    'nhk.or.jp': 0.9, 'asahi.com': 0.8, 'mainichi.jp': 0.8,
    'theverge.com': 0.8, 'arstechnica.com': 0.8, 'techcrunch.com': 0.8, 'wired.com': 0.8,
    'reddit.com': 0.6, 'x.com': 0.6, 'youtube.com': 0.7,
  },
  FATIGUE: {
    LIMIT: 5000, PENALTY_RECENT_MINUTES: 30, PENALTY_RECENT_SCORE: 0.15,
    PENALTY_OLD_MINUTES: 120, PENALTY_OLD_SCORE: 0.05,
  },
  DIVERSITY_PENALTY: {
    PER_DOMAIN: 0.05, PER_CLUSTER: 0.07, DOMAIN_THRESHOLD: 2, CLUSTER_THRESHOLD: 1,
  },
  EXPLORATION: {
    RATE: 0.15, BOOST: 0.03,
  },
  BOOST_SCORES: {
    WEEKDAY_BUSINESS: 0.02, WEEKEND_BUZZ: 0.02, SPORTS_PENALTY: -0.02,
  },
};

// -------------------- Keyword Sets (Pre-compiled Regex) --------------------
// ... (기존 RX, buildRegex, escapeRx 코드와 동일) ...
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const buildRegex = (keywords) => new RegExp(`\\b(${keywords.map(escapeRx).join('|')})\\b`, 'i');
const RX = {
  urgent: buildRegex(['breaking', 'urgent', 'alert', 'emergency', 'crisis', 'disaster', '긴급', '속보', '재난', '위기', '사고', '응급', '지진', '대피']),
  important: buildRegex(['president', 'government', 'election', 'economy', 'market', 'policy', 'war', 'treaty', '대통령', '정부', '선거', '경제', '시장', '정책', '전쟁', '협정', '정상회담']),
  buzz: buildRegex(['viral', 'trending', 'celebrity', 'entertainment', 'meme', 'influencer', 'youtube', 'tiktok', 'instagram', '바이럴', '트렌드', '연예', '엔터', '인플루언서']),
  tech: buildRegex(['ai', 'artificial intelligence', 'technology', 'startup', 'blockchain', 'quantum', 'robot', 'automation', '인공지능', '기술', '혁신', '스타트업', '블록체인', '로봇', '자동화', '반도체', 'gpu']),
  business: buildRegex(['stock', 'investment', 'finance', 'earnings', 'profit', 'revenue', 'merger', 'acquisition', '주식', '투자', '금융', '실적', '수익', '매출', '인수', '합병']),
  sports: buildRegex(['sports', 'olympic', 'football', 'soccer', 'basketball', 'baseball', '스포츠', '올림픽', '축구', '농구', '야구']),
  locations: {
    korea: buildRegex(['korea', 'korean', '한국', '서울', 'seoul']),
    japan: buildRegex(['japan', 'japanese', '일본', '도쿄', 'tokyo']),
    usa: buildRegex(['usa', 'america', '미국', '워싱턴', 'washington']),
  }
};

// -------------------- Utilities (Global) --------------------

const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const getDomain = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const minutesSince = (isoDate) => { const time = new Date(isoDate).getTime(); return time > 0 ? (Date.now() - time) / 60000 : Infinity; };
const clamp = (num, min, max) => Math.max(min, Math.min(num, max));
const fatigueLRU = new Map();

function fatigueMark(hash) {
  if (fatigueLRU.has(hash)) fatigueLRU.delete(hash);
  fatigueLRU.set(hash, Date.now());
  if (fatigueLRU.size > CONFIG.FATIGUE.LIMIT) {
    fatigueLRU.delete(fatigueLRU.keys().next().value);
  }
}
function fatiguePenalty(hash) {
  const lastSeen = fatigueLRU.get(hash);
  if (!lastSeen) return 0;
  const minutesAgo = (Date.now() - lastSeen) / 60000;
  if (minutesAgo < CONFIG.FATIGUE.PENALTY_RECENT_MINUTES) return CONFIG.FATIGUE.PENALTY_RECENT_SCORE;
  if (minutesAgo < CONFIG.FATIGUE.PENALTY_OLD_MINUTES) return CONFIG.FATIGUE.PENALTY_OLD_SCORE;
  return 0;
}

// -------------------- Main Service Class --------------------

class RatingService {
  constructor() {
    this.userPreferences = {
      topic: new Map(),
      domain: new Map(),
    };
  }
  
  // -------------------- Scoring Components (Static Methods) --------------------

  static calculateFreshness(ageMinutes, section) {
    const halfLife = CONFIG.HALF_LIFE_MINUTES[section] || CONFIG.HALF_LIFE_MINUTES.default;
    return Math.exp(-ageMinutes / halfLife);
  }

  static calculateVelocity(reactions = 0, ageMinutes = Infinity) {
    if (ageMinutes < 1) ageMinutes = 1; // 1분 미만은 1분으로 계산하여 점수 폭발 방지
    const ageHours = ageMinutes / 60;
    // (시간당 반응 수)를 계산하여 정규화. 1000은 튜닝 가능한 상수.
    return (reactions / ageHours) / 1000;
  }

  static calculateEngagement(reactions = 0, followers = 0) {
    const BETA = 1000;
    return reactions / Math.max(1, followers + BETA);
  }

  static sourceTrust(domain = '') {
    const baseScore = CONFIG.DOMAIN_TRUST_SCORES[domain] ?? 0.5;
    return clamp(baseScore, 0.3, 0.95);
  }

  static extractTextFeatures(title = '', description = '') {
    const combinedText = `${title}\n${description}`.toLowerCase();
    const features = {};
    for (const [key, regex] of Object.entries(RX)) {
      if (typeof regex.test === 'function') {
          features[key] = regex.test(combinedText);
      }
    }
    features.length = combinedText.length;
    return features;
  }

  // -------------------- Core Scoring Logic --------------------

  _scoreArticle(article, section = 'buzz') {
    const title = article?.title ?? '';
    const domain = (article?.domain || getDomain(article?.url) || '').toLowerCase();
    const clusterId = article?.clusterId ?? sha1(title.toLowerCase().replace(/\s+/g, ' ').slice(0, 120));
    const ageMinutes = minutesSince(article?.publishedAt);

    const features = RatingService.extractTextFeatures(title, article?.description);
    const weights = CONFIG.WEIGHTS[section] || CONFIG.WEIGHTS.buzz;
    
    // 기본 점수 요소 계산
    const f = RatingService.calculateFreshness(ageMinutes, section);
    const v = RatingService.calculateVelocity(article?.reactions, ageMinutes);
    const e = RatingService.calculateEngagement(article?.reactions, article?.followers);
    let s = RatingService.sourceTrust(domain);
    if (article?.verifiedCross) s = clamp(s + 0.1, 0, 1);
    
    const u = features.urgent ? 1 : 0;
    const l = (article?.lang && ['ko', 'ja', 'en'].includes(article.lang)) ? 1 : 0;
    
    let score = (weights.f * f) + (weights.v * v) + (weights.e * e) + (weights.s * s) + (weights.l * l) + (weights.u * u);
    
    // 시간/토픽별 보정
    const dayOfWeek = new Date().getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5 && (section === 'business' || features.business)) score += CONFIG.BOOST_SCORES.WEEKDAY_BUSINESS;
    if ((dayOfWeek === 0 || dayOfWeek === 6) && (section === 'buzz' || features.buzz)) score += CONFIG.BOOST_SCORES.WEEKEND_BUZZ;
    if (features.sports) score += CONFIG.BOOST_SCORES.SPORTS_PENALTY;

    // 사용자 피드백 보정
    score += this.userPreferences.domain.get(domain) ?? 0;
    if (features.tech) score += this.userPreferences.topic.get('tech') ?? 0;
    if (features.business) score += this.userPreferences.topic.get('business') ?? 0;

    // 노출 피로도 감점
    const fatigue = fatiguePenalty(clusterId) + fatiguePenalty(sha1(title.toLowerCase()));
    
    return { score: clamp(score - fatigue, 0, 1), features, domain, clusterId };
  }

  /**
   * ⚠️ [성능 주의] 이 함수는 CPU 사용량이 매우 높으므로, 실시간 API 요청 내에서 직접 호출하는 것을 피해야 합니다.
   * 반드시 별도의 백그라운드 작업(Cron Job)을 통해 주기적으로 실행하고, 그 결과를 캐시에 저장하여 사용하세요.
   * @param {Array<object>} articles - 기사 객체 배열
   * @param {string} section - 섹션
   * @param {number} take - 반환할 기사 수
   * @returns {Array<object>} 랭킹된 기사 배열
   */
  rankArticles(articles, section = 'buzz', take = 100) {
    if (!Array.isArray(articles) || articles.length === 0) return [];
    
    const weights = CONFIG.WEIGHTS[section] || CONFIG.WEIGHTS.buzz;
    const domainCounts = new Map();
    const clusterCounts = new Map();
    const seenDomains = new Set();
    const rankedArticles = [];

    const scoredArticles = articles.map(a => {
      const { score, features, domain, clusterId } = this._scoreArticle(a, section);
      return { ...a, _score: score, _features: features, domain, clusterId };
    }).sort((a, b) => b._score - a._score);

    for (const article of scoredArticles) {
      if (rankedArticles.length >= take) break;

      let adjustedScore = article._score;
      const diversityP = RatingService.calculateDiversityPenalty({ domainCounts, clusterCounts }, article.domain, article.clusterId);
      adjustedScore -= weights.d * diversityP;

      if (!seenDomains.has(article.domain) && Math.random() < CONFIG.EXPLORATION.RATE) {
        adjustedScore += CONFIG.EXPLORATION.BOOST;
      }
      
      article._finalScore = adjustedScore;
      rankedArticles.push(article);

      domainCounts.set(article.domain, (domainCounts.get(article.domain) || 0) + 1);
      clusterCounts.set(article.clusterId, (clusterCounts.get(article.clusterId) || 0) + 1);
      seenDomains.add(article.domain);
    }
    
    rankedArticles.sort((a, b) => b._finalScore - a._finalScore);

    rankedArticles.slice(0, 50).forEach(article => {
      fatigueMark(article.clusterId);
      fatigueMark(sha1((article.title ?? '').toLowerCase()));
    });
    
    return rankedArticles;
  }
  
  // -------------------- Public API Methods --------------------

  async calculateRating(article, section = 'buzz') {
    const { score } = this._scoreArticle(article, section);
    // 기본값 2.5 기준으로 조정: 2.5 + (score * 2.5)로 1.0~5.0 범위 유지
    const rating = clamp(2.5 + (score - 0.6) * 2.5, 1, 5);
    return Math.round(rating * 2) / 2;
  }

  async generateTags(article) {
    const { title, description, publishedAt } = article;
    const features = RatingService.extractTextFeatures(title, description);
    const tags = new Set();
    if (features.urgent) tags.add('긴급');
    if (features.important) tags.add('중요');
    const hoursAgo = (Date.now() - new Date(publishedAt ?? Date.now())) / 36e5;
    if (hoursAgo < 2) tags.add('Hot');
    if (features.buzz) tags.add('바이럴');
    if (features.tech) tags.add('테크');
    if (features.business) tags.add('경제');
    const combinedText = `${title ?? ''} ${description ?? ''}`;
    if (RX.locations.korea.test(combinedText)) tags.add('한국');
    return Array.from(tags).slice(0, 4);
  }

  getImportanceScore(article, section = 'buzz') {
    const { score, features } = this._scoreArticle(article, section);
    let importance = score * 6;
    if (features.urgent) importance += 2;
    if (features.important) importance += 1.2;
    if (features.buzz) importance += 0.8;
    if (features.sports) importance -= 0.4;
    return clamp(importance, 0, 10);
  }

  updateUserFeedback({ topic, domain }, delta = 0.05) {
    if (topic) {
      const current = this.userPreferences.topic.get(topic) ?? 0;
      this.userPreferences.topic.set(topic, clamp(current + delta, -0.3, 0.3));
    }
    if (domain) {
      const current = this.userPreferences.domain.get(domain) ?? 0;
      this.userPreferences.domain.set(domain, clamp(current + delta, -0.3, 0.3));
    }
  }

  getStatus() {
    return {
      fatigueCacheSize: fatigueLRU.size,
      userPrefTopics: Object.fromEntries(this.userPreferences.topic),
      userPrefDomains: Object.fromEntries(this.userPreferences.domain),
    };
  }
}

module.exports = new RatingService();