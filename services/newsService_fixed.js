// 캐시 키 버전 관리 패치
// 이 코드를 기존 newsService.js의 상단에 추가하세요

// ratingService 변경 시 이 버전을 업데이트하면 자동으로 새 캐시 사용
const RATING_SERVICE_VERSION = "v2.1";

// _getFast 메서드에서 캐시 키 생성 부분 수정
// 기존: const key=`${section}_fast`;
// 수정: const key=`${section}_fast_${RATING_SERVICE_VERSION}`;

// _getFull 메서드에서도 동일하게 적용
// 기존: const key=`${section}_full`;  
// 수정: const key=`${section}_full_${RATING_SERVICE_VERSION}`;

// 예시 구현:
/*
async _getFast(section) {
    const key = `${section}_fast_${RATING_SERVICE_VERSION}`;
    let cached = null;
    if (redis) { 
        try { 
            cached = await redis.get(key); 
        } catch (e) { 
            this.logger.warn('Redis get failed:', e.message); 
        } 
    } else { 
        cached = memoryCache.get(key); 
    }
    
    // ... 나머지 코드는 동일
}
*/

// 추가 개선사항:
// 1. TTL 단축을 위한 환경 변수 설정
const IMPROVED_FAST = {
    TTL_FAST: Number(process.env.FAST_REDIS_TTL_SEC || 30),  // 60 → 30초로 단축
    TTL_FULL: Number(process.env.FULL_REDIS_TTL_SEC || 300), // 600 → 300초로 단축
};

// 2. 캐시 무효화 헬퍼 함수
async function invalidateRatingCache() {
    const sections = ['world', 'kr', 'japan', 'buzz', 'tech', 'business'];
    const promises = [];
    
    for (const section of sections) {
        if (redis) {
            promises.push(redis.del(`${section}_fast_${RATING_SERVICE_VERSION}`));
            promises.push(redis.del(`${section}_full_${RATING_SERVICE_VERSION}`));
        } else {
            memoryCache.delete(`${section}_fast_${RATING_SERVICE_VERSION}`);
            memoryCache.delete(`${section}_full_${RATING_SERVICE_VERSION}`);
        }
    }
    
    if (promises.length > 0) {
        await Promise.allSettled(promises);
    }
    
    console.log('Rating cache invalidated for version:', RATING_SERVICE_VERSION);
}

// 3. 자동 캐시 갱신 (선택사항)
// const cron = require('node-cron');
// cron.schedule('*/5 * * * *', async () => {
//     console.log('Auto cache refresh started...');
//     await invalidateRatingCache();
//     // 주요 섹션 미리 로드
//     await this.getSectionFast('world');
//     await this.getSectionFast('kr');
//     console.log('Auto cache refresh completed');
// });

module.exports = {
    RATING_SERVICE_VERSION,
    invalidateRatingCache
};

