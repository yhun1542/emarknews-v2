# 🔧 캐시 문제 해결 방안

## 🚨 **현재 문제**

- ratingService 코드 변경 시 캐시 때문에 새로운 평점이 반영되지 않음
- 수동으로 `/admin/clear-cache`를 호출해야만 업데이트됨
- 사용자는 오래된 평점 데이터를 계속 보게 됨

## 💡 **해결 방안**

### **1. 캐시 키 버전 관리 (권장)**

```javascript
// services/newsService.js 수정
const RATING_SERVICE_VERSION = "v2.1"; // ratingService 변경 시 버전 업데이트

async _getFast(section) {
    const key = `${section}_fast_${RATING_SERVICE_VERSION}`; // 버전 포함
    // ... 나머지 코드
}
```

**장점:**
- ratingService 변경 시 버전만 올리면 자동으로 새 캐시 사용
- 기존 캐시와 충돌 없음
- 배포 즉시 새로운 평점 반영

### **2. 캐시 TTL 단축**

```javascript
// 현재: TTL_FAST: 60초, TTL_FULL: 600초
// 제안: TTL_FAST: 30초, TTL_FULL: 300초

const FAST = {
    TTL_FAST: Number(process.env.FAST_REDIS_TTL_SEC || 30),  // 60 → 30
    TTL_FULL: Number(process.env.FULL_REDIS_TTL_SEC || 300), // 600 → 300
};
```

**장점:**
- 더 빠른 캐시 갱신
- 새로운 뉴스 더 빨리 반영

**단점:**
- 서버 부하 증가
- API 응답 시간 증가 가능성

### **3. 자동 캐시 갱신 스케줄러**

```javascript
// 매 5분마다 캐시 갱신
const cron = require('node-cron');

cron.schedule('*/5 * * * *', async () => {
    console.log('자동 캐시 갱신 시작...');
    await newsService.clearCache();
    // 주요 섹션 미리 로드
    await newsService.getSectionFast('world');
    await newsService.getSectionFast('kr');
    console.log('자동 캐시 갱신 완료');
});
```

### **4. 캐시 무효화 API**

```javascript
// ratingService 변경 시 특정 캐시만 무효화
app.post('/admin/invalidate-rating-cache', async (req, res) => {
    try {
        const sections = ['world', 'kr', 'japan', 'buzz', 'tech', 'business'];
        for (const section of sections) {
            await redis.del(`${section}_fast`);
            await redis.del(`${section}_full`);
        }
        res.json({ success: true, message: 'Rating cache invalidated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

## 🎯 **즉시 적용 가능한 해결책**

### **방법 1: 환경 변수로 TTL 단축**

Railway 배포 환경에서 환경 변수 설정:
```
FAST_REDIS_TTL_SEC=30
FULL_REDIS_TTL_SEC=300
```

### **방법 2: 캐시 키에 타임스탬프 추가**

```javascript
// 현재 시간을 캐시 키에 포함 (5분 단위)
const cacheTimestamp = Math.floor(Date.now() / (5 * 60 * 1000)); // 5분 단위
const key = `${section}_fast_${cacheTimestamp}`;
```

## 🚀 **권장 구현 순서**

1. **즉시**: 환경 변수로 TTL 단축 (30초/300초)
2. **단기**: 캐시 키 버전 관리 구현
3. **중기**: 자동 캐시 갱신 스케줄러 추가
4. **장기**: 더 정교한 캐시 무효화 시스템

## 📊 **예상 효과**

- ✅ ratingService 변경 시 즉시 반영
- ✅ 수동 캐시 클리어 불필요
- ✅ 사용자 경험 개선
- ✅ 개발 효율성 향상

