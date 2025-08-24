// NewsAPI 통합 서비스
const NewsAPI = require('newsapi');
const googleNews = require('google-news-scraper');

class NewsApiService {
    constructor() {
        // NewsAPI 초기화 (환경변수에서 API 키 가져오기)
        this.newsapi = process.env.NEWS_API_KEY ? new NewsAPI(process.env.NEWS_API_KEY) : null;
        
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
            // NewsAPI - 국제 뉴스
            if (this.newsapi) {
                const newsApiResults = await this.newsapi.v2.topHeadlines({
                    category: 'general',
                    language: 'en',
                    pageSize: 20
                });
                
                if (newsApiResults.articles) {
                    articles.push(...newsApiResults.articles.map(article => ({
                        id: this.generateId(article.url),
                        title: article.title,
                        description: article.description,
                        link: article.url,
                        source: `NewsAPI - ${article.source.name}`,
                        publishedAt: article.publishedAt,
                        domain: this.extractDomain(article.url),
                        _srcType: 'newsapi'
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
            // NewsAPI - 기술 뉴스
            if (this.newsapi) {
                const newsApiResults = await this.newsapi.v2.topHeadlines({
                    category: 'technology',
                    language: 'en',
                    pageSize: 20
                });
                
                if (newsApiResults.articles) {
                    articles.push(...newsApiResults.articles.map(article => ({
                        id: this.generateId(article.url),
                        title: article.title,
                        description: article.description,
                        link: article.url,
                        source: `NewsAPI - ${article.source.name}`,
                        publishedAt: article.publishedAt,
                        domain: this.extractDomain(article.url),
                        _srcType: 'newsapi'
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
            // NewsAPI - 비즈니스 뉴스
            if (this.newsapi) {
                const newsApiResults = await this.newsapi.v2.topHeadlines({
                    category: 'business',
                    language: 'en',
                    pageSize: 20
                });
                
                if (newsApiResults.articles) {
                    articles.push(...newsApiResults.articles.map(article => ({
                        id: this.generateId(article.url),
                        title: article.title,
                        description: article.description,
                        link: article.url,
                        source: `NewsAPI - ${article.source.name}`,
                        publishedAt: article.publishedAt,
                        domain: this.extractDomain(article.url),
                        _srcType: 'newsapi'
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
            // NewsAPI - 엔터테인먼트 뉴스
            if (this.newsapi) {
                const newsApiResults = await this.newsapi.v2.topHeadlines({
                    category: 'entertainment',
                    language: 'en',
                    pageSize: 20
                });
                
                if (newsApiResults.articles) {
                    articles.push(...newsApiResults.articles.map(article => ({
                        id: this.generateId(article.url),
                        title: article.title,
                        description: article.description,
                        link: article.url,
                        source: `NewsAPI - ${article.source.name}`,
                        publishedAt: article.publishedAt,
                        domain: this.extractDomain(article.url),
                        _srcType: 'newsapi'
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
}

module.exports = NewsApiService;

