// 원본 newsService에서 ratingService 호출 테스트
const NewsService = require('./services/newsService');

async function debugRatingService() {
    console.log('🔍 원본 newsService에서 ratingService 디버그 테스트\n');
    
    try {
        const newsService = new NewsService();
        
        // ratingService가 제대로 생성되었는지 확인
        console.log('ratingService 인스턴스:', newsService.ratingService ? '✅ 생성됨' : '❌ 생성 안됨');
        
        if (newsService.ratingService) {
            // 직접 ratingService 테스트
            const testArticle = {
                title: "Breaking: President announces emergency measures",
                description: "Government takes urgent action in response to crisis",
                source: "Reuters",
                publishedAt: "2025-08-23T10:00:00.000Z"
            };
            
            console.log('\n--- 직접 ratingService 테스트 ---');
            const directRating = await newsService.ratingService.calculateRating(testArticle);
            console.log(`직접 호출 결과: ${directRating}`);
            
            // rankItems 메서드 테스트 (실제 API에서 사용되는 메서드)
            console.log('\n--- rankItems 메서드 테스트 ---');
            const testItems = [testArticle];
            
            // rankItems 메서드가 있는지 확인
            if (typeof newsService.rankItems === 'function') {
                const rankedItems = await newsService.rankItems(testItems, 'world');
                console.log('rankItems 결과:', rankedItems[0]);
                console.log(`API 형태 평점: ${rankedItems[0].rating}`);
            } else {
                console.log('❌ rankItems 메서드를 찾을 수 없습니다');
                
                // 다른 메서드들 확인
                console.log('\n사용 가능한 메서드들:');
                Object.getOwnPropertyNames(Object.getPrototypeOf(newsService))
                    .filter(name => typeof newsService[name] === 'function' && name !== 'constructor')
                    .forEach(name => console.log(`- ${name}`));
            }
        }
        
    } catch (error) {
        console.error('❌ 테스트 오류:', error);
        console.error('스택 트레이스:', error.stack);
    }
}

debugRatingService();

