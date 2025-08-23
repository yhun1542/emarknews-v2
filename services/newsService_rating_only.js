// newsService.js에 추가할 메서드들

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

// 사용 예시:
// const newsService = new NewsService();
// await newsService.refreshRatingsOnly('world');
// await newsService.refreshAllRatingsOnly();

