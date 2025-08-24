// NewsAPI 통합 서비스
const NewsAPI = require('newsapi');
const googleNews = require('google-news-scraper');

class NewsApiService {
    constructor() {
        // NewsAPI 초기화 (API 키 직접 설정)
        const newsApiKey = process.env.NEWS_API_KEY || '44d9347a149b40ad87b3deb8bba95183';
        this.newsapi = newsApiKey ? new NewsAPI(newsApiKey) : null;
        
        // GNews API 키 설정
        this.gnewsApiKey = process.env.GNEWS_API_KEY || '419c98f65957bb2389c3912af1aece04';
        
        // 한국 관련 키워드
        this.koreaKeywords = [
            'Korea', 'Korean', 'Seoul', 'Busan', 'K-pop', 'Samsung', 'LG', 'Hyundai', 'Kia',
            'Moon Jae-in', 'Yoon Suk-yeol', 'North Korea', 'South Korea', 'DMZ', 'Gangnam',
            'Chaebol', 'Kimchi', 'BTS', 'Blackpink', 'SK Hynix', 'POSCO', 'Lotte'
        ];
        
        // 일본 관련 키워드
        this.japanKeywords = [
            'Japan', 'Japanese', 'Tokyo', 'Osaka', 'Kyoto', 'Sony', 'Nintendo', 'Toyota', 'Honda',
            'Kishida', 'Yen', 'Nikkei', 'Anime', 'Manga', 'Sushi', 'Mount Fuji', 'Earthquake',
            'Tsunami', 'Fukushima', 'Mitsubishi', 'Panasonic', 'SoftBank', 'Rakuten'
        ];
    }

    async getWorldNews() {
        const articles = [];
        
        try {
            // 🚨 속보/긴급 뉴스 - Reuters, AP, Bloomberg
            if (this.newsapi) {
                const breakingNews = await this.newsapi.v2.topHeadlines({
                    sources: 'reuters,associated-press,bloomberg',
                    sortBy: 'publishedAt',
                    pageSize: 15
                });
                
                if (breakingNews.articles) {
                    articles.push(...breakingNews.articles.map(article => ({
                        id: this.generateId(article.url),
                        title: article.title,
                        description: article.description,
                        link: article.url,
                        source: `Breaking - ${article.source.name}`,
                        publishedAt: article.publishedAt,
                        domain: this.extractDomain(article.url),
                        _srcType: 'newsapi-breaking'
                    })));
                }
            }
            
            // 🌍 분쟁/중요 이슈 - Reuters, AP, Al Jazeera
            if (this.newsapi) {
                const conflictNews = await this.newsapi.v2.everything({
                    q: 'global conflict',
                    sources: 'reuters,associated-press,al-jazeera-english',
                    sortBy: 'publishedAt',
                    language: 'en',
                    pageSize: 10
                });
                
                if (conflictNews.articles) {
                    articles.push(...conflictNews.articles.map(article => ({
                        id: this.generateId(article.url),
                        title: article.title,
                        description: article.description,
                        link: article.url,
                        source: `Global Issues - ${article.source.name}`,
                        publishedAt: article.publishedAt,
                        domain: this.extractDomain(article.url),
                        _srcType: 'newsapi-conflict'
                    })));
                }
            }
            
            // Google News - 국제 뉴스
            const googleResults = await googleNews({
                searchTerm: 'world news',
                prettyURLs: true,
                queryVars: {
                    hl: 'en-US',
                    gl: 'US',
                    ceid: 'US:en'
                },
                timeframe: '1d',
                puppeteerArgs: []
            });
            
            if (googleResults) {
                articles.push(...googleResults.slice(0, 15).map(article => ({
                    id: this.generateId(article.link),
                    title: article.title,
                    description: article.snippet || '',
                    link: article.link,
                    source: `Google News - ${article.source}`,
                    publishedAt: article.time || new Date().toISOString(),
                    domain: this.extractDomain(article.link),
                    _srcType: 'google-news'
                })));
            }
            
        } catch (error) {
            console.error('Error fetching world news from APIs:', error.message);
        }
        
        return articles;
    }

    async getTechNews() {
        const articles = [];
        
        try {
            // 💡 테크/혁신 뉴스 - TechCrunch, The Verge, Wired
            if (this.newsapi) {
                const techNews = await this.newsapi.v2.everything({
                    sources: 'techcrunch,the-verge,wired',
                    sortBy: 'popularity',
                    language: 'en',
                    pageSize: 20
                });
                
                if (techNews.articles) {
                    articles.push(...techNews.articles.map(article => ({
                        id: this.generateId(article.url),
                        title: article.title,
                        description: article.description,
                        link: article.url,
                        source: `Tech - ${article.source.name}`,
                        publishedAt: article.publishedAt,
                        domain: this.extractDomain(article.url),
                        _srcType: 'newsapi-tech'
                    })));
                }
            }
            
            // Google News - 기술 뉴스
            const googleResults = await googleNews({
                searchTerm: 'technology AI artificial intelligence',
                prettyURLs: true,
                queryVars: {
                    hl: 'en-US',
                    gl: 'US',
                    ceid: 'US:en'
                },
                timeframe: '1d',
                puppeteerArgs: []
            });
            
            if (googleResults) {
                articles.push(...googleResults.slice(0, 15).map(article => ({
                    id: this.generateId(article.link),
                    title: article.title,
                    description: article.snippet || '',
                    link: article.link,
                    source: `Google News - ${article.source}`,
                    publishedAt: article.time || new Date().toISOString(),
                    domain: this.extractDomain(article.link),
                    _srcType: 'google-news'
                })));
            }
            
        } catch (error) {
            console.error('Error fetching tech news from APIs:', error.message);
        }
        
        return articles;
    }

    async getBusinessNews() {
        const articles = [];
        
        try {
            // 💼 경제/시장 뉴스 - Bloomberg, Financial Times, CNBC
            if (this.newsapi) {
                const businessNews = await this.newsapi.v2.everything({
                    sources: 'bloomberg,financial-times,cnbc',
                    sortBy: 'publishedAt',
                    language: 'en',
                    pageSize: 20
                });
                
                if (businessNews.articles) {
                    articles.push(...businessNews.articles.map(article => ({
                        id: this.generateId(article.url),
                        title: article.title,
                        description: article.description,
                        link: article.url,
                        source: `Business - ${article.source.name}`,
                        publishedAt: article.publishedAt,
                        domain: this.extractDomain(article.url),
                        _srcType: 'newsapi-business'
                    })));
                }
            }
            
            // Google News - 비즈니스 뉴스
            const googleResults = await googleNews({
                searchTerm: 'business finance economy stock market',
                prettyURLs: true,
                queryVars: {
                    hl: 'en-US',
                    gl: 'US',
                    ceid: 'US:en'
                },
                timeframe: '1d',
                puppeteerArgs: []
            });
            
            if (googleResults) {
                articles.push(...googleResults.slice(0, 15).map(article => ({
                    id: this.generateId(article.link),
                    title: article.title,
                    description: article.snippet || '',
                    link: article.link,
                    source: `Google News - ${article.source}`,
                    publishedAt: article.time || new Date().toISOString(),
                    domain: this.extractDomain(article.link),
                    _srcType: 'google-news'
                })));
            }
            
        } catch (error) {
            console.error('Error fetching business news from APIs:', error.message);
        }
        
        return articles;
    }

    async getKoreaNews() {
        const articles = [];
        
        try {
            // NewsAPI - 한국 관련 뉴스만
            if (this.newsapi) {
                for (const keyword of this.koreaKeywords.slice(0, 5)) { // 상위 5개 키워드만 사용
                    try {
                        const newsApiResults = await this.newsapi.v2.everything({
                            q: keyword,
                            language: 'en',
                            sortBy: 'publishedAt',
                            pageSize: 10
                        });
                        
                        if (newsApiResults.articles) {
                            const filteredArticles = newsApiResults.articles
                                .filter(article => this.isKoreaRelated(article.title + ' ' + (article.description || '')))
                                .map(article => ({
                                    id: this.generateId(article.url),
                                    title: article.title,
                                    description: article.description,
                                    link: article.url,
                                    source: `NewsAPI - ${article.source.name}`,
                                    publishedAt: article.publishedAt,
                                    domain: this.extractDomain(article.url),
                                    _srcType: 'newsapi',
                                    needsTranslation: true // 한국어 번역 필요 표시
                                }));
                            
                            articles.push(...filteredArticles);
                        }
                        
                        // API 호출 간격 조절
                        await this.delay(500);
                    } catch (error) {
                        console.error(`Error fetching Korea news for keyword ${keyword}:`, error.message);
                    }
                }
            }
            
            // Google News - 한국 관련 뉴스
            const googleResults = await googleNews({
                searchTerm: 'Korea Korean Seoul South Korea',
                prettyURLs: true,
                queryVars: {
                    hl: 'en-US',
                    gl: 'US',
                    ceid: 'US:en'
                },
                timeframe: '1d',
                puppeteerArgs: []
            });
            
            if (googleResults) {
                const filteredGoogleResults = googleResults
                    .filter(article => this.isKoreaRelated(article.title + ' ' + (article.snippet || '')))
                    .slice(0, 10)
                    .map(article => ({
                        id: this.generateId(article.link),
                        title: article.title,
                        description: article.snippet || '',
                        link: article.link,
                        source: `Google News - ${article.source}`,
                        publishedAt: article.time || new Date().toISOString(),
                        domain: this.extractDomain(article.link),
                        _srcType: 'google-news',
                        needsTranslation: true // 한국어 번역 필요 표시
                    }));
                
                articles.push(...filteredGoogleResults);
            }
            
        } catch (error) {
            console.error('Error fetching Korea news from APIs:', error.message);
        }
        
        return articles;
    }

    async getJapanNews() {
        const articles = [];
        
        try {
            // NewsAPI - 일본 관련 뉴스만
            if (this.newsapi) {
                for (const keyword of this.japanKeywords.slice(0, 5)) { // 상위 5개 키워드만 사용
                    try {
                        const newsApiResults = await this.newsapi.v2.everything({
                            q: keyword,
                            language: 'en',
                            sortBy: 'publishedAt',
                            pageSize: 10
                        });
                        
                        if (newsApiResults.articles) {
                            const filteredArticles = newsApiResults.articles
                                .filter(article => this.isJapanRelated(article.title + ' ' + (article.description || '')))
                                .map(article => ({
                                    id: this.generateId(article.url),
                                    title: article.title,
                                    description: article.description,
                                    link: article.url,
                                    source: `NewsAPI - ${article.source.name}`,
                                    publishedAt: article.publishedAt,
                                    domain: this.extractDomain(article.url),
                                    _srcType: 'newsapi',
                                    needsTranslation: true // 한국어 번역 필요 표시
                                }));
                            
                            articles.push(...filteredArticles);
                        }
                        
                        // API 호출 간격 조절
                        await this.delay(500);
                    } catch (error) {
                        console.error(`Error fetching Japan news for keyword ${keyword}:`, error.message);
                    }
                }
            }
            
            // Google News - 일본 관련 뉴스
            const googleResults = await googleNews({
                searchTerm: 'Japan Japanese Tokyo',
                prettyURLs: true,
                queryVars: {
                    hl: 'en-US',
                    gl: 'US',
                    ceid: 'US:en'
                },
                timeframe: '1d',
                puppeteerArgs: []
            });
            
            if (googleResults) {
                const filteredGoogleResults = googleResults
                    .filter(article => this.isJapanRelated(article.title + ' ' + (article.snippet || '')))
                    .slice(0, 10)
                    .map(article => ({
                        id: this.generateId(article.link),
                        title: article.title,
                        description: article.snippet || '',
                        link: article.link,
                        source: `Google News - ${article.source}`,
                        publishedAt: article.time || new Date().toISOString(),
                        domain: this.extractDomain(article.link),
                        _srcType: 'google-news',
                        needsTranslation: true // 한국어 번역 필요 표시
                    }));
                
                articles.push(...filteredGoogleResults);
            }
            
        } catch (error) {
            console.error('Error fetching Japan news from APIs:', error.message);
        }
        
        return articles;
    }

    async getBuzzNews() {
        const articles = [];
        
        try {
            // 🎬 버즈/재미 뉴스 - Variety, Hollywood Reporter
            if (this.newsapi) {
                const buzzNews = await this.newsapi.v2.everything({
                    sources: 'variety,entertainment-weekly,the-hollywood-reporter',
                    sortBy: 'popularity',
                    pageSize: 20
                });
                
                if (buzzNews.articles) {
                    articles.push(...buzzNews.articles.map(article => ({
                        id: this.generateId(article.url),
                        title: article.title,
                        description: article.description,
                        link: article.url,
                        source: `Entertainment - ${article.source.name}`,
                        publishedAt: article.publishedAt,
                        domain: this.extractDomain(article.url),
                        _srcType: 'newsapi-entertainment'
                    })));
                }
            }
            
            // Google News - 엔터테인먼트 뉴스
            const googleResults = await googleNews({
                searchTerm: 'entertainment celebrity movies music',
                prettyURLs: true,
                queryVars: {
                    hl: 'en-US',
                    gl: 'US',
                    ceid: 'US:en'
                },
                timeframe: '1d',
                puppeteerArgs: []
            });
            
            if (googleResults) {
                articles.push(...googleResults.slice(0, 15).map(article => ({
                    id: this.generateId(article.link),
                    title: article.title,
                    description: article.snippet || '',
                    link: article.link,
                    source: `Google News - ${article.source}`,
                    publishedAt: article.time || new Date().toISOString(),
                    domain: this.extractDomain(article.link),
                    _srcType: 'google-news'
                })));
            }
            
        } catch (error) {
            console.error('Error fetching buzz news from APIs:', error.message);
        }
        
        return articles;
    }

    isKoreaRelated(text) {
        const lowerText = text.toLowerCase();
        return this.koreaKeywords.some(keyword => 
            lowerText.includes(keyword.toLowerCase())
        );
    }

    isJapanRelated(text) {
        const lowerText = text.toLowerCase();
        return this.japanKeywords.some(keyword => 
            lowerText.includes(keyword.toLowerCase())
        );
    }

    generateId(url) {
        return Buffer.from(url).toString('base64').substring(0, 16);
    }

    extractDomain(url) {
        try {
            return new URL(url).hostname;
        } catch {
            return 'unknown';
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * newsapi:// 프로토콜 URL 처리
     * @param {string} url - newsapi://tech 형태의 URL
     * @returns {Array} - RSS 형태로 변환된 기사 배열
     */
    async fetchFromNewsAPIProtocol(url) {
        if (!url.startsWith('newsapi://')) {
            throw new Error('Invalid NewsAPI protocol URL');
        }

        const section = url.replace('newsapi://', '');
        
        try {
            switch (section) {
                case 'world':
                    return await this.getWorldNews();
                case 'tech':
                    return await this.getTechNews();
                case 'business':
                    return await this.getBusinessNews();
                case 'korea':
                    return await this.getKoreaNews();
                case 'japan':
                    return await this.getJapanNews();
                case 'buzz':
                    return await this.getBuzzNews();
                default:
                    console.warn(`Unknown NewsAPI section: ${section}, falling back to world news`);
                    return await this.getWorldNews();
            }
        } catch (error) {
            console.error(`Error fetching NewsAPI data for ${section}:`, error.message);
            return [];
        }
    }

    /**
     * URL이 NewsAPI 프로토콜인지 확인
     * @param {string} url 
     * @returns {boolean}
     */
    isNewsAPIProtocol(url) {
        return typeof url === 'string' && url.startsWith('newsapi://');
    }
}

module.exports = NewsApiService;

