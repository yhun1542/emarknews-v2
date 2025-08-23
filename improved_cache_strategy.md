# 🚀 개선된 캐시 전략

## 🚨 **현재 문제**

- 캐시 클리어 시 AI 번역 결과(`titleKo`, `summaryPoints`)도 함께 삭제됨
- ratingService 변경 시에도 AI 번역을 다시 해야 함
- 불필요한 AI API 비용과 시간 소모
- 429 Rate Limit 에러 발생 가능성

## 💡 **해결 전략: 3단계 캐시 시스템**

### **1단계: 원본 뉴스 캐시 (Raw News)**
```javascript
// 키: news_raw_{section}_{date}
// TTL: 30분 (뉴스 업데이트 주기)
// 내용: 원본 뉴스 데이터 (제목, 링크, 설명 등)
```

### **2단계: AI 번역 캐시 (AI Translation)**
```javascript
// 키: ai_translation_{article_hash}
// TTL: 7일 (영구에 가까운 캐시)
// 내용: titleKo, summaryPoints, 번역 결과
```

### **3단계: 평점 캐시 (Rating)**
```javascript
// 키: rating_{section}_{rating_version}
// TTL: 10분 (평점 시스템 변경 시 즉시 갱신)
// 내용: 최종 평점이 적용된 완성 데이터
```

## 🔧 **구현 방법**

### **방법 1: 캐시 분리 (권장)**

```javascript
class ImprovedNewsService {
    // 1. 원본 뉴스 가져오기
    async getRawNews(section) {
        const key = `news_raw_${section}_${this.getDateKey()}`;
        // 캐시 확인 후 없으면 RSS/API에서 가져오기
    }
    
    // 2. AI 번역 적용 (개별 아티클별 캐시)
    async applyAITranslation(articles) {
        const results = [];
        for (const article of articles) {
            const hash = this.getArticleHash(article);
            const key = `ai_translation_${hash}`;
            
            let translation = await this.getCache(key);
            if (!translation) {
                translation = await this.aiService.translateArticle(article);
                await this.setCache(key, translation, 7 * 24 * 60 * 60); // 7일
            }
            
            results.push({ ...article, ...translation });
        }
        return results;
    }
    
    // 3. 평점 적용 (버전별 캐시)
    async applyRating(articles, section) {
        const key = `rating_${section}_${RATING_SERVICE_VERSION}`;
        
        let ratedArticles = await this.getCache(key);
        if (!ratedArticles) {
            ratedArticles = await this.rankAndSort(section, articles);
            await this.setCache(key, ratedArticles, 10 * 60); // 10분
        }
        
        return ratedArticles;
    }
}
```

### **방법 2: 평점만 재계산 (빠른 해결책)**

```javascript
async getSectionFast(section) {
    // 1. 기존 캐시에서 AI 번역된 데이터 가져오기
    const existingKey = `${section}_fast_v2.0`; // 이전 버전
    let existingData = await this.getCache(existingKey);
    
    if (existingData && existingData.data) {
        // 2. AI 번역은 그대로 두고 평점만 재계산
        const reRatedArticles = await Promise.all(
            existingData.data.map(async (article) => ({
                ...article,
                rating: (await this.ratingService.calculateRating(article)).toFixed(1)
            }))
        );
        
        // 3. 평점 순으로 재정렬
        reRatedArticles.sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
        
        // 4. 새 버전으로 캐시 저장
        const newKey = `${section}_fast_${RATING_SERVICE_VERSION}`;
        const newData = { ...existingData, data: reRatedArticles };
        await this.setCache(newKey, newData, FAST.TTL_FAST);
        
        return newData;
    }
    
    // 기존 데이터가 없으면 전체 프로세스 실행
    return this._getFastComplete(section);
}
```

### **방법 3: 하이브리드 캐시 무효화**

```javascript
// 평점만 변경된 경우
app.get('/admin/refresh-ratings-only', async (req, res) => {
    const sections = ['world', 'kr', 'japan', 'buzz', 'tech', 'business'];
    
    for (const section of sections) {
        // 기존 AI 번역 데이터 유지하면서 평점만 업데이트
        await newsService.refreshRatingsOnly(section);
    }
    
    res.json({ success: true, message: 'Ratings refreshed without losing AI translations' });
});

// AI 번역도 새로 해야 하는 경우
app.get('/admin/full-refresh', async (req, res) => {
    await newsService.clearCache(); // 전체 캐시 클리어
    res.json({ success: true, message: 'Full cache refresh initiated' });
});
```

## 📊 **예상 효과**

### **현재 시스템:**
- ratingService 변경 → 전체 캐시 클리어 → AI 번역 재실행 (비용 $$)

### **개선된 시스템:**
- ratingService 변경 → 평점만 재계산 → AI 번역 유지 (비용 $)

### **비용 절약:**
- AI API 호출: 90% 감소
- 응답 시간: 80% 단축
- 개발 효율성: 크게 향상

## 🎯 **즉시 적용 가능한 해결책**

1. **단기 (오늘)**: 평점만 재계산하는 엔드포인트 추가
2. **중기 (이번 주)**: 캐시 분리 시스템 구현
3. **장기 (다음 주)**: 완전한 3단계 캐시 시스템 적용

