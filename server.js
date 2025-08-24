// server.js - EmarkNews Main Server
// EmarkNews v2 Server - Force Redeploy 2025-08-22 23:20
require('dotenv').config();
// Force deploy trigger - Cache cleared and ready for deployment
const express = require('express');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const logger = require('./utils/logger');
const NewsService = require('./services/newsService');
const AIService = require('./services/aiService');
const CacheScheduler = require('./services/cacheScheduler');
const RSSMonitor = require('./services/rssMonitor');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 8080;

// 1) 프록시 신뢰 (Railway/Nginx 등 1-hop 프록시 환경)
//   - 반드시 rate-limit, logger 등 어떤 미들웨어보다 먼저 실행
app.set('trust proxy', true); // Railway 프록시 환경에서 X-Forwarded-For 헤더 신뢰

// Initialize services
const newsService = new NewsService();
const aiService = new AIService();
const cacheScheduler = new CacheScheduler(newsService, io); // WebSocket 전달
const rssMonitor = new RSSMonitor();

// Admin endpoint for cache clearing
app.get('/admin/clear-cache', async (req, res) => {
  try {
    await newsService.clearCache();
    res.status(200).send('Cache cleared successfully!');
  } catch (error) {
    res.status(500).send('Failed to clear cache: ' + error.message);
  }
});

// Admin endpoint for rating cache invalidation
app.get('/admin/invalidate-rating-cache', async (req, res) => {
  try {
    const sections = ['world', 'kr', 'japan', 'buzz', 'tech', 'business'];
    const RATING_SERVICE_VERSION = "v2.1"; // newsService와 동일한 버전 사용
    
    let clearedCount = 0;
    for (const section of sections) {
      try {
        // Redis에서 캐시 삭제 시도
        if (process.env.REDIS_URL) {
          const { createClient } = require('redis');
          const redis = createClient({ url: process.env.REDIS_URL });
          await redis.connect();
          
          await redis.del(`${section}_fast_${RATING_SERVICE_VERSION}`);
          await redis.del(`${section}_full_${RATING_SERVICE_VERSION}`);
          
          await redis.disconnect();
          clearedCount += 2;
        }
      } catch (e) {
        logger.warn(`Failed to clear cache for section ${section}:`, e.message);
      }
    }
    
    res.status(200).json({
      success: true,
      message: `Rating cache invalidated for version ${RATING_SERVICE_VERSION}`,
      clearedKeys: clearedCount,
      sections: sections
    });
  } catch (error) {
    logger.error('Rating cache invalidation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to invalidate rating cache',
      message: error.message
    });
  }
});

// Admin endpoint for ratings-only refresh (AI 번역 유지)
app.get('/admin/refresh-ratings-only', async (req, res) => {
  try {
    const results = await newsService.refreshAllRatingsOnly();
    
    const summary = {
      success: true,
      message: 'Ratings refreshed without losing AI translations',
      timestamp: new Date().toISOString(),
      sections: results
    };
    
    res.json(summary);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to refresh ratings: ' + error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Admin endpoint for RSS monitoring status
app.get('/admin/rss-status', async (req, res) => {
  try {
    const healthSummary = rssMonitor.getHealthSummary();
    const brokenFeeds = rssMonitor.getBrokenFeeds();
    const workingFeeds = rssMonitor.getWorkingFeeds();
    
    res.json({
      success: true,
      health: healthSummary,
      brokenFeeds: brokenFeeds,
      workingFeeds: workingFeeds,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get RSS status: ' + error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Admin endpoint for manual RSS check
app.get('/admin/check-rss', async (req, res) => {
  try {
    const results = await rssMonitor.checkAllFeeds();
    
    res.json({
      success: true,
      message: 'RSS feeds checked successfully',
      results: results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to check RSS feeds: ' + error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Admin endpoint for cache scheduler status
app.get('/admin/scheduler-status', async (req, res) => {
  try {
    const status = cacheScheduler.getStatus();
    
    res.json({
      success: true,
      scheduler: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get scheduler status: ' + error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Admin endpoint for single section ratings refresh
app.get('/admin/refresh-ratings/:section', async (req, res) => {
  try {
    const { section } = req.params;
    const validSections = ['world', 'kr', 'japan', 'buzz', 'tech', 'business'];
    
    if (!validSections.includes(section)) {
      return res.status(400).json({
        success: false,
        error: `Invalid section. Must be one of: ${validSections.join(', ')}`
      });
    }
    
    const result = await newsService.refreshRatingsOnly(section);
    
    if (result) {
      const ratings = result.data.map(item => parseFloat(item.rating));
      const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      
      res.status(200).json({
        success: true,
        message: `Ratings refreshed for section: ${section}`,
        section: section,
        articlesCount: result.data.length,
        avgRating: avgRating.toFixed(1),
        minRating: Math.min(...ratings),
        maxRating: Math.max(...ratings),
        timestamp: result.ratingRefreshedAt
      });
    } else {
      res.status(404).json({
        success: false,
        message: `No cached data found for section: ${section}`
      });
    }
  } catch (error) {
    logger.error(`Ratings refresh failed for section ${req.params.section}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh ratings for section',
      message: error.message
    });
  }
});

// 2) rate-limit: 표준 헤더만 사용하고, proxy 신뢰 기반 IP 추출
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_WINDOW_MS ?? 60_000),
  limit: Number(process.env.RATE_LIMIT ?? 120),
  standardHeaders: true,    // RFC 표준 헤더
  legacyHeaders: false,     // 레거시 헤더 비활성
  keyGenerator: (req) => req.ip, // trust proxy 설정 시 client IP 정확히 인식
  message: 'Too many requests, please try again later.'
  // validate 옵션 제거 - trust proxy true로 설정했으므로 기본 동작 사용
});

// Security middleware - [최종 CSP 설정]
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        // helmet의 기본 보안 설정을 대부분 유지합니다.
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        
        // [수정] API 연결 허용 목록
        "connect-src": [
            "'self'", 
            "https://emarknews.com", 
            "https://emarknews-v2-production.up.railway.app"
        ],
        
        // [수정] 인라인 스크립트 허용
        "script-src": ["'self'", "'unsafe-inline'"],
        
        // [수정] 외부 폰트 및 스타일시트 허용 (기존 프론트엔드 코드에 필요)
        "font-src": ["'self'", "https:", "data:"],
        "style-src": ["'self'", "https:", "'unsafe-inline'"],
      },
    },
  })
);

// CORS 설정 강화
app.use(cors({
  origin: [
    'https://emarknews.com',
    'https://www.emarknews.com',
    'https://emarknews-v2-production.up.railway.app',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200
}));

// Performance middleware
app.use(compression());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) }}));
// Basic middleware
app.use(express.json());

// (2) /api 에서는 304가 나오지 않도록 강제 no-store + 변동 ETag
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  // Express는 ETag가 이미 있으면 새로 계산하지 않음 → 304 방지
  res.set('ETag', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  next();
});

app.use('/api/', limiter);

// Static files with proper caching
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1y',
  immutable: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
    // Add versioning for CSS/JS files
    if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    services: {
      server: 'running',
      redis: newsService.getCacheStatus(),
      ai: aiService.getStatus()
    }
  });
});

// Main news endpoint

// New NewsService API Routes (빠른 로딩)
app.get('/api/:section/fast', async (req, res) => {
  // 30초 타임아웃 설정
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        error: 'Request timeout',
        message: 'API response took too long'
      });
    }
  }, 30000);

  try {
    const { section } = req.params;
    const { read } = req.query; // 읽은 기사 ID 목록 (쉼표로 구분)
    const validSections = ['world', 'kr', 'korea', 'japan', 'buzz', 'tech', 'business'];
    
    if (!validSections.includes(section)) {
      clearTimeout(timeout);
      return res.status(400).json({
        success: false,
        error: `Invalid section. Must be one of: ${validSections.join(', ')}`
      });
    }

    // 읽은 기사 목록 파싱
    const readArticles = read ? read.split(',').map(id => id.trim()).filter(id => id) : [];
    
    const result = await newsService.getSectionFast(section, readArticles);
    clearTimeout(timeout);
    
    if (!res.headersSent) {
      res.json(result);
    }
  } catch (error) {
    clearTimeout(timeout);
    logger.error(`API Error - /api/${req.params.section}/fast:`, error);
    
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch news',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
});

// AI API Test endpoints (GET for testing)
app.get('/api/translate', (req, res) => {
  res.json({
    success: true,
    message: 'AI Translation API is working. Use POST method with {"text": "your text", "targetLang": "ko"}'
  });
});

app.get('/api/summarize', (req, res) => {
  res.json({
    success: true,
    message: 'AI Summary API is working. Use POST method with {"text": "your text", "maxPoints": 5}'
  });
});

// AI Translation endpoint (moved up to avoid route conflicts)
app.post('/api/translate', async (req, res) => {
  try {
    const { text, targetLang = 'ko' } = req.body;
    
    if (!text || text.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }
    
    const result = await aiService.translate(text, targetLang);
    const translated = result.success ? result.data.translated : 'Translation failed';
    
    res.json({
      success: true,
      data: {
        original: text,
        translated: translated,
        targetLanguage: targetLang
      }
    });
  } catch (error) {
    logger.error('API Error - /api/translate:', error);
    res.status(500).json({
      success: false,
      error: 'Translation failed'
    });
  }
});

// AI Summary endpoint (moved up to avoid route conflicts)
app.post('/api/summarize', async (req, res) => {
  try {
    const { text, maxPoints = 5, detailed = false } = req.body;
    
    if (!text || text.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }
    
    const result = await aiService.summarize(text, { maxPoints, detailed });
    const summary = result.success ? result.data.summary : 'Summarization failed';
    
    res.json({
      success: true,
      data: {
        original: text,
        summary: summary,
        points: Array.isArray(summary) ? summary.length : 1,
        detailed: detailed
      }
    });
  } catch (error) {
    logger.error('API Error - /api/summarize:', error);
    res.status(500).json({
      success: false,
      error: 'Summarization failed'
    });
  }
});

// New NewsService API Routes (완전체)
app.get('/api/:section', async (req, res) => {
  try {
    const { section } = req.params;
    const validSections = ['world', 'kr', 'korea', 'japan', 'buzz', 'tech', 'business'];
    
    if (!validSections.includes(section)) {
      return res.status(400).json({
        success: false,
        error: `Invalid section. Must be one of: ${validSections.join(', ')}`
      });
    }

    const result = await newsService.getSectionFull(section);
    res.json(result);
  } catch (error) {
    logger.error(`API Error - /api/${req.params.section}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch news',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 4) 다운 방지용 fail-open 월드뉴스 라우트 (기존 호환성)
const { worldHandler } = require('./services/news/worldSafe');
app.get('/api/news/world', worldHandler); // 기존 동일 경로가 있어도 이 라인이 먼저면 우선 적용됨

// API Routes
app.get('/api/news/:section', async (req, res) => {
  try {
    const { section } = req.params;
    const { page = 1, limit = 30, useCache = 'true' } = req.query;
    
    const validSections = ['world', 'kr', 'japan', 'buzz', 'tech', 'business'];
    if (!validSections.includes(section)) {
      return res.status(400).json({
        success: false,
        error: `Invalid section. Must be one of: ${validSections.join(', ')}`
      });
    }

    const result = await newsService.getNews(
      section,
      useCache === 'true',
      parseInt(page),
      parseInt(limit)
    );

    res.json(result);
  } catch (error) {
    logger.error(`API Error - /api/news/${req.params.section}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch news',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Fast article detail endpoint (Redis optimized)
app.get('/api/article/:section/:id/fast', async (req, res) => {
  const startTime = Date.now();
  try {
    const { section, id } = req.params;
    
    const article = await newsService.getArticleFast(section, id);
    
    if (!article) {
      return res.status(404).json({ 
        success: false, 
        error: 'Article not found',
        loadTime: Date.now() - startTime
      });
    }
    
    res.json({ 
      success: true, 
      data: article,
      cached: true,
      loadTime: Date.now() - startTime
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      loadTime: Date.now() - startTime
    });
  }
});

// Get specific article
app.get('/api/article/:section/:id', async (req, res) => {
  try {
    const { section, id } = req.params;
    const result = await newsService.getArticleById(section, id);
    
    if (!result || !result.success) {
      return res.status(404).json({
        success: false,
        error: 'Article not found'
      });
    }
    
    const article = result.data;
    
    // 상세보기에서는 더 자세한 AI 요약 생성
    if (article.description || article.content) {
      try {
        const textToSummarize = article.content || article.description || article.title;
        const detailedSummary = await aiService.generateSummaryPoints(textToSummarize, 8); // 더 많은 포인트
        
        if (detailedSummary && detailedSummary.length > 0) {
          article.summaryPoints = detailedSummary;
        }
      } catch (aiError) {
        logger.warn(`AI detailed summary failed for article ${id}:`, aiError.message);
        // AI 실패 시 기존 요약 사용
      }
    }
    
    res.json({
      success: true,
      data: article
    });
  } catch (error) {
    logger.error(`API Error - /api/article/${req.params.section}/${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch article'
    });
  }
});

// Detail endpoint (for frontend compatibility)
app.get('/api/detail', async (req, res) => {
  try {
    const { section, id } = req.query;
    const validSections = ['world', 'kr', 'korea', 'japan', 'buzz', 'tech', 'business'];
    
    // 디버깅 로그 추가
    logger.info(`[DEBUG] Detail API called with section: "${section}", id: "${id}"`);
    logger.info(`[DEBUG] Valid sections: ${validSections.join(', ')}`);
    logger.info(`[DEBUG] Section type: ${typeof section}, includes check: ${validSections.includes(section)}`);
    
    if (!validSections.includes(section)) {
      logger.error(`[DEBUG] Section validation failed for: "${section}"`);
      return res.status(400).json({
        success: false,
        error: `Invalid section. Must be one of: ${validSections.join(', ')}`
      });
    }
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Article ID is required'
      });
    }
    
    const result = await newsService.getArticleById(section, id);
    
    if (!result || !result.success) {
      return res.status(404).json({
        success: false,
        error: 'Article not found'
      });
    }
    
    res.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    logger.error(`API Error - /api/detail:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch article details'
    });
  }
});

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { q, section, limit = 20 } = req.query;
    
    if (!q || q.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }
    
    const results = await newsService.searchNews(
      q.trim(),
      section,
      parseInt(limit)
    );
    
    res.json({
      success: true,
      query: q,
      count: results.length,
      data: results
    });
  } catch (error) {
    logger.error('API Error - /api/search:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed'
    });
  }
});

// API Stats endpoint
app.get('/api/stats', (req, res) => {
  res.json({
    success: true,
    data: {
      uptime: Math.floor(process.uptime()),
      memory: {
        used: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.floor(process.memoryUsage().heapTotal / 1024 / 1024)
      },
      timestamp: new Date().toISOString(),
      services: {
        news: newsService.getStatus(),
        ai: aiService.getStatus(),
        cache: newsService.getCacheStatus()
      }
    }
  });
});

// Clear cache endpoint (admin only - add auth in production)
app.post('/api/cache/clear', async (req, res) => {
  try {
    await newsService.clearCache();
    res.json({
      success: true,
      message: 'Cache cleared successfully'
    });
  } catch (error) {
    logger.error('API Error - /api/cache/clear:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear cache'
    });
  }
});

// Serve HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/detail.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'detail.html'));
});

// SPA를 위한 catch-all 라우트: 위에서 일치하는 라우트가 없을 경우
// 모든 GET 요청에 대해 index.html을 서빙합니다.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});



// WebSocket 연결 처리
io.on('connection', (socket) => {
  logger.info('Client connected to WebSocket', { socketId: socket.id });
  
  socket.on('disconnect', () => {
    logger.info('Client disconnected from WebSocket', { socketId: socket.id });
  });
  
  // 클라이언트에게 연결 확인 메시지 전송
  socket.emit('connected', { 
    message: 'WebSocket connected successfully',
    timestamp: new Date().toISOString()
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`EmarkNews server running on port ${PORT}`, { service: 'emarknews' });
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`, { service: 'emarknews' });
  logger.info(`Health check: http://localhost:${PORT}/health`, { service: 'emarknews' });
  logger.info(`WebSocket server ready for real-time updates`, { service: 'emarknews' });
  
  // 자동 캐시 갱신 스케줄러 시작
  cacheScheduler.start();
  
  // RSS 피드 모니터링 시작
  rssMonitor.startAutoCheck();
  
  logger.info('🚀 Cache scheduler and RSS monitor started', { service: 'emarknews' });
});

