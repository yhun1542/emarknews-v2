// 개선된 RSS 소스 설정 - 막힌 사이트 제거 및 새로운 소스 추가
const rssSources = {
  world: [
    // 검증된 안정적인 소스들
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { name: 'NPR World', url: 'https://feeds.npr.org/1004/rss.xml' },
    { name: 'The Guardian World', url: 'https://www.theguardian.com/world/rss' },
    { name: 'Reuters World', url: 'https://feeds.reuters.com/reuters/worldNews' },
    
    // 새로 추가된 안정적인 소스들
    { name: 'Associated Press', url: 'https://feeds.apnews.com/rss/apf-topnews' },
    { name: 'The Washington Post', url: 'https://feeds.washingtonpost.com/rss/world' },
    { name: 'CNN International', url: 'https://rss.cnn.com/rss/edition.rss' },
    { name: 'Politico', url: 'https://www.politico.com/rss/politicopicks' },
    { name: 'TMZ', url: 'https://www.tmz.com/rss.xml' },
    
    // 제거된 소스들 (404 에러):
    // - ABC News International (404 에러)
    // - CNN World (HTTP만 지원, HTTPS 문제)
  ],
  
  korea: [
    { name: 'Yonhap News', url: 'https://www.yna.co.kr/rss/news.xml' },
    { name: 'Kyunghyang', url: 'http://www.khan.co.kr/rss/rssdata/total_news.xml' },
    { name: 'Hankyung', url: 'https://rss.hankyung.com/news/economy.xml' },
    { name: 'Chosun Ilbo', url: 'https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml' },
    
    // 새로 추가된 한국 소스들
    { name: 'KBS News', url: 'http://world.kbs.co.kr/rss/rss_news.htm?lang=k' },
    { name: 'MBC News', url: 'https://imnews.imbc.com/rss/news/news_00.xml' }
  ],
  
  japan: [
    { name: 'NHK World', url: 'https://www3.nhk.or.jp/rss/news/cat0.xml' },
    { name: 'Japan Times', url: 'https://www.japantimes.co.jp/feed/' },
    { name: 'Kyodo News', url: 'https://english.kyodonews.net/rss/all.xml' },
    
    // 새로 추가된 일본 소스들
    { name: 'Asahi Shimbun', url: 'http://www.asahi.com/rss/asahi/newsheadlines.rdf' },
    { name: 'Mainichi', url: 'https://mainichi.jp/rss/etc/mainichi-flash.rss' }
  ],
  
  tech: [
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'Wired', url: 'https://www.wired.com/feed/rss' },
    
    // 새로 추가된 테크 소스들
    { name: 'Engadget', url: 'https://www.engadget.com/rss.xml' },
    { name: 'TechRadar', url: 'https://www.techradar.com/rss' },
    { name: 'ZDNet', url: 'https://www.zdnet.com/news/rss.xml' },
    { name: 'Gizmodo', url: 'https://gizmodo.com/rss' }
  ],
  
  business: [
    { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews' },
    { name: 'Bloomberg', url: 'https://feeds.bloomberg.com/markets/news.rss' },
    { name: 'Financial Times', url: 'https://www.ft.com/rss/home' },
    { name: 'Wall Street Journal', url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml' },
    
    // 새로 추가된 비즈니스 소스들
    { name: 'Forbes', url: 'https://www.forbes.com/real-time/feed2/' },
    { name: 'MarketWatch', url: 'http://feeds.marketwatch.com/marketwatch/topstories/' },
    { name: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' }
  ],
  
  buzz: [
    { name: 'BBC Trending', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
    { name: 'Vice News', url: 'https://www.vice.com/en/rss' },
    
    // 새로 추가된 버즈 소스들
    { name: 'BuzzFeed', url: 'https://www.buzzfeed.com/world.xml' },
    { name: 'Mashable', url: 'https://mashable.com/feeds/rss/all' },
    { name: 'The Daily Beast', url: 'https://www.thedailybeast.com/rss' },
    { name: 'Huffington Post', url: 'https://www.huffpost.com/section/front-page/feed' }
    
    // 제거된 소스들:
    // - Buzzfeed News (서비스 종료)
  ]
};

module.exports = { rssSources };

