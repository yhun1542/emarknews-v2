// 개선된 RSS 소스 설정 - 막힌 사이트 제거 및 새로운 소스 추가 + NewsAPI 통합
const rssSources = {
  world: [
    // 검증된 안정적인 RSS 소스들
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { name: 'NPR World', url: 'https://feeds.npr.org/1004/rss.xml' },
    { name: 'The Guardian World', url: 'https://www.theguardian.com/world/rss' },
    { name: 'Reuters World', url: 'https://feeds.reuters.com/reuters/worldNews' },
    { name: 'Associated Press', url: 'https://feeds.apnews.com/rss/apf-topnews' },
    { name: 'The Washington Post', url: 'https://feeds.washingtonpost.com/rss/world' },
    { name: 'CNN International', url: 'https://rss.cnn.com/rss/edition.rss' },
    { name: 'Politico', url: 'https://www.politico.com/rss/politicopicks' },
    { name: 'TMZ', url: 'https://www.tmz.com/rss.xml' },
    
    // NewsAPI 통합 (동적 소스)
    { name: 'NewsAPI World', url: 'newsapi://world', type: 'api' },
    { name: 'Google News World', url: 'google-news://world', type: 'api' }
  ],
  
  korea: [
    // 기존 한국 RSS 소스들
    { name: 'Yonhap News', url: 'https://www.yna.co.kr/rss/news.xml' },
    { name: 'Kyunghyang', url: 'http://www.khan.co.kr/rss/rssdata/total_news.xml' },
    { name: 'Hankyung', url: 'https://rss.hankyung.com/news/economy.xml' },
    { name: 'Chosun Ilbo', url: 'https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml' },
    { name: 'KBS News', url: 'http://world.kbs.co.kr/rss/rss_news.htm?lang=k' },
    { name: 'MBC News', url: 'https://imnews.imbc.com/rss/news/news_00.xml' },
    
    // NewsAPI 통합 (한국 관련 뉴스만, 한국어 번역 필수)
    { name: 'NewsAPI Korea', url: 'newsapi://korea', type: 'api', requiresTranslation: true },
    { name: 'Google News Korea', url: 'google-news://korea', type: 'api', requiresTranslation: true }
  ],
  
  japan: [
    // 기존 일본 RSS 소스들
    { name: 'NHK World', url: 'https://www3.nhk.or.jp/rss/news/cat0.xml' },
    { name: 'Japan Times', url: 'https://www.japantimes.co.jp/feed/' },
    { name: 'Kyodo News', url: 'https://english.kyodonews.net/rss/all.xml' },
    { name: 'Asahi Shimbun', url: 'http://www.asahi.com/rss/asahi/newsheadlines.rdf' },
    { name: 'Mainichi', url: 'https://mainichi.jp/rss/etc/mainichi-flash.rss' },
    
    // NewsAPI 통합 (일본 관련 뉴스만, 한국어 번역 필수)
    { name: 'NewsAPI Japan', url: 'newsapi://japan', type: 'api', requiresTranslation: true },
    { name: 'Google News Japan', url: 'google-news://japan', type: 'api', requiresTranslation: true }
  ],
  
  tech: [
    // 기존 테크 RSS 소스들
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'Wired', url: 'https://www.wired.com/feed/rss' },
    { name: 'Engadget', url: 'https://www.engadget.com/rss.xml' },
    { name: 'TechRadar', url: 'https://www.techradar.com/rss' },
    { name: 'ZDNet', url: 'https://www.zdnet.com/news/rss.xml' },
    { name: 'Gizmodo', url: 'https://gizmodo.com/rss' },
    
    // NewsAPI 통합
    { name: 'NewsAPI Tech', url: 'newsapi://tech', type: 'api' },
    { name: 'Google News Tech', url: 'google-news://tech', type: 'api' }
  ],
  
  business: [
    // 기존 비즈니스 RSS 소스들
    { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews' },
    { name: 'Bloomberg', url: 'https://feeds.bloomberg.com/markets/news.rss' },
    { name: 'Financial Times', url: 'https://www.ft.com/rss/home' },
    { name: 'Wall Street Journal', url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml' },
    { name: 'Forbes', url: 'https://www.forbes.com/real-time/feed2/' },
    { name: 'MarketWatch', url: 'http://feeds.marketwatch.com/marketwatch/topstories/' },
    { name: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
    
    // NewsAPI 통합
    { name: 'NewsAPI Business', url: 'newsapi://business', type: 'api' },
    { name: 'Google News Business', url: 'google-news://business', type: 'api' }
  ],
  
  buzz: [
    // 기존 버즈 RSS 소스들
    { name: 'BBC Trending', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
    { name: 'Vice News', url: 'https://www.vice.com/en/rss' },
    { name: 'BuzzFeed', url: 'https://www.buzzfeed.com/world.xml' },
    { name: 'Mashable', url: 'https://mashable.com/feeds/rss/all' },
    { name: 'The Daily Beast', url: 'https://www.thedailybeast.com/rss' },
    { name: 'Huffington Post', url: 'https://www.huffpost.com/section/front-page/feed' },
    
    // NewsAPI 통합
    { name: 'NewsAPI Entertainment', url: 'newsapi://buzz', type: 'api' },
    { name: 'Google News Entertainment', url: 'google-news://buzz', type: 'api' }
  ]
};

module.exports = { rssSources };

