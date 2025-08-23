// rankAndSort 메서드 테스트
const NewsService = require('./services/newsService');

async function testRankAndSort() {
    console.log('🔍 rankAndSort 메서드 테스트\n');
    
    try {
        const newsService = new NewsService();
        
        const testItems = [
            {
                title: "Breaking: President announces emergency measures",
                description: "Government takes urgent action in response to crisis",
                source: "Reuters",
                publishedAt: "2025-08-23T10:00:00.000Z",
                ageMinutes: 60,
                domain: "reuters.com"
            },
            {
                title: "Israeli defense minister warns of escalating tensions",
                description: "Government officials discuss military response options",
                source: "Associated Press", 
                publishedAt: "2025-08-23T09:00:00.000Z",
                ageMinutes: 120,
                domain: "apnews.com"
            },
            {
                title: "Stock market shows mixed signals",
                description: "Financial markets continue to fluctuate amid uncertainty",
                source: "Bloomberg",
                publishedAt: "2025-08-23T08:00:00.000Z",
                ageMinutes: 180,
                domain: "bloomberg.com"
            }
        ];
        
        console.log('--- rankAndSort 메서드 테스트 ---');
        const rankedItems = await newsService.rankAndSort('world', testItems);
        
        console.log('\n=== 결과 ===');
        rankedItems.forEach((item, index) => {
            console.log(`${index + 1}. [평점: ${item.rating}] [점수: ${item.score?.toFixed(2)}] ${item.title.substring(0, 50)}...`);
        });
        
        const ratings = rankedItems.map(item => parseFloat(item.rating));
        const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
        
        console.log(`\n평균 평점: ${avgRating.toFixed(1)}`);
        console.log(`최고 평점: ${Math.max(...ratings)}`);
        console.log(`최저 평점: ${Math.min(...ratings)}`);
        
        // 현재 API와 비교
        console.log('\n=== 비교 분석 ===');
        if (avgRating >= 3.5) {
            console.log('✅ rankAndSort는 정상적으로 작동합니다!');
            console.log('🔍 문제: 실제 API에서 이 메서드가 호출되지 않거나 결과가 덮어써지고 있습니다.');
        } else {
            console.log('❌ rankAndSort에도 문제가 있습니다.');
        }
        
    } catch (error) {
        console.error('❌ 테스트 오류:', error);
        console.error('스택 트레이스:', error.stack);
    }
}

testRankAndSort();

