// NewsAPI 통합을 위한 RSS 소스 처리 메서드 추가
// 기존 newsService.js에 추가할 메서드들

// processRssSource 메서드 - RSS와 NewsAPI를 통합 처리
async processRssSource(source, section) {
  try {
    // NewsAPI 타입인지 확인
    if (source.type === 'api') {
      return await this.fetchFromNewsApiSource(source, section);
    } else {
      // 일반 RSS 피드
      return await this.fetchFromRSS(source.url);
    }
  } catch (error) {
    this.logger.warn(`Error processing source ${source.name}:`, error.message);
    return [];
  }
}

// NewsAPI 소스별 처리 메서드
async fetchFromNewsApiSource(source, section) {
  try {
    const url = source.url;
    
    if (url.startsWith('newsapi://')) {
      const apiSection = url.replace('newsapi://', '');
      return await this.fetchFromNewsApiBySection(apiSection, source.requiresTranslation);
    } else if (url.startsWith('google-news://')) {
      const apiSection = url.replace('google-news://', '');
      return await this.fetchFromGoogleNewsBySection(apiSection, source.requiresTranslation);
    }
    
    return [];
  } catch (error) {
    this.logger.warn(`Error fetching from NewsAPI source ${source.name}:`, error.message);
    return [];
  }
}

// NewsAPI 섹션별 데이터 가져오기
async fetchFromNewsApiBySection(section, requiresTranslation = false) {
  try {
    let articles = [];
    
    switch (section) {
      case 'world':
        articles = await this.newsApiService.getWorldNews();
        break;
      case 'tech':
        articles = await this.newsApiService.getTechNews();
        break;
      case 'business':
        articles = await this.newsApiService.getBusinessNews();
        break;
      case 'buzz':
        articles = await this.newsApiService.getBuzzNews();
        break;
      case 'korea':
        articles = await this.newsApiService.getKoreaNews();
        break;
      case 'japan':
        articles = await this.newsApiService.getJapanNews();
        break;
      default:
        return [];
    }
    
    // 한국어 번역이 필요한 경우 표시
    if (requiresTranslation) {
      articles = articles.map(article => ({
        ...article,
        needsTranslation: true
      }));
    }
    
    return articles;
  } catch (error) {
    this.logger.warn(`Error fetching NewsAPI ${section}:`, error.message);
    return [];
  }
}

// Google News 섹션별 데이터 가져오기
async fetchFromGoogleNewsBySection(section, requiresTranslation = false) {
  try {
    let articles = [];
    
    switch (section) {
      case 'world':
        articles = await this.newsApiService.getWorldNews();
        break;
      case 'tech':
        articles = await this.newsApiService.getTechNews();
        break;
      case 'business':
        articles = await this.newsApiService.getBusinessNews();
        break;
      case 'buzz':
        articles = await this.newsApiService.getBuzzNews();
        break;
      case 'korea':
        articles = await this.newsApiService.getKoreaNews();
        break;
      case 'japan':
        articles = await this.newsApiService.getJapanNews();
        break;
      default:
        return [];
    }
    
    // Google News에서 온 것으로 표시
    articles = articles.map(article => ({
      ...article,
      _srcType: 'google-news'
    }));
    
    // 한국어 번역이 필요한 경우 표시
    if (requiresTranslation) {
      articles = articles.map(article => ({
        ...article,
        needsTranslation: true
      }));
    }
    
    return articles;
  } catch (error) {
    this.logger.warn(`Error fetching Google News ${section}:`, error.message);
    return [];
  }
}

module.exports = {
  processRssSource,
  fetchFromNewsApiSource,
  fetchFromNewsApiBySection,
  fetchFromGoogleNewsBySection
};

