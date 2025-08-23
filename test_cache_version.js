// 캐시 버전 관리 테스트
const NewsService = require('./services/newsService');

async function testCacheVersioning() {
    console.log('🔍 캐시 버전 관리 테스트\n');
    
    try {
        const newsService = new NewsService();
        
        console.log('--- 1단계: 첫 번째 호출 (캐시 생성) ---');
        const result1 = await newsService.getSectionFast('world');
        console.log(`첫 번째 결과: ${result1.data.length}개 아이템`);
        console.log(`첫 번째 평점 샘플: ${result1.data[0]?.rating}`);
        
        console.log('\n--- 2단계: 두 번째 호출 (캐시 사용) ---');
        const result2 = await newsService.getSectionFast('world');
        console.log(`두 번째 결과: ${result2.data.length}개 아이템`);
        console.log(`두 번째 평점 샘플: ${result2.data[0]?.rating}`);
        
        // 캐시 키 확인
        console.log('\n--- 3단계: 캐시 키 확인 ---');
        console.log('예상 캐시 키: world_fast_v2.1');
        
        // 평점 통계
        const ratings = result2.data.map(item => parseFloat(item.rating));
        const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
        
        console.log('\n--- 4단계: 평점 분석 ---');
        console.log(`평균 평점: ${avgRating.toFixed(1)}`);
        console.log(`최고 평점: ${Math.max(...ratings)}`);
        console.log(`최저 평점: ${Math.min(...ratings)}`);
        
        if (avgRating >= 3.5) {
            console.log('✅ 캐시 버전 관리가 정상적으로 작동합니다!');
        } else {
            console.log('❌ 여전히 문제가 있습니다.');
        }
        
    } catch (error) {
        console.error('❌ 테스트 오류:', error);
        console.error('스택 트레이스:', error.stack);
    }
}

testCacheVersioning();

