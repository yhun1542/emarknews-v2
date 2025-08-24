// 자동 캐시 갱신 스케줄러
const cron = require('node-cron');

class CacheScheduler {
    constructor(newsService) {
        this.newsService = newsService;
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) {
            console.log('Cache scheduler is already running');
            return;
        }

        console.log('Starting cache scheduler...');
        this.isRunning = true;

        // 매 3분마다 world 섹션 캐시 갱신
        this.worldRefreshJob = cron.schedule('*/3 * * * *', async () => {
            try {
                console.log('🔄 Auto-refreshing world cache...');
                await this.newsService.getSectionFast('world');
                console.log('✅ World cache refreshed successfully');
            } catch (error) {
                console.error('❌ Failed to refresh world cache:', error.message);
            }
        });

        // 매 5분마다 tech 섹션 캐시 갱신
        this.techRefreshJob = cron.schedule('*/5 * * * *', async () => {
            try {
                console.log('🔄 Auto-refreshing tech cache...');
                await this.newsService.getSectionFast('tech');
                console.log('✅ Tech cache refreshed successfully');
            } catch (error) {
                console.error('❌ Failed to refresh tech cache:', error.message);
            }
        });

        // 매 10분마다 business 섹션 캐시 갱신
        this.businessRefreshJob = cron.schedule('*/10 * * * *', async () => {
            try {
                console.log('🔄 Auto-refreshing business cache...');
                await this.newsService.getSectionFast('business');
                console.log('✅ Business cache refreshed successfully');
            } catch (error) {
                console.error('❌ Failed to refresh business cache:', error.message);
            }
        });

        // 매 15분마다 buzz 섹션 캐시 갱신
        this.buzzRefreshJob = cron.schedule('*/15 * * * *', async () => {
            try {
                console.log('🔄 Auto-refreshing buzz cache...');
                await this.newsService.getSectionFast('buzz');
                console.log('✅ Buzz cache refreshed successfully');
            } catch (error) {
                console.error('❌ Failed to refresh buzz cache:', error.message);
            }
        });

        // 매 시간마다 korea, japan 섹션 캐시 갱신
        this.asiaRefreshJob = cron.schedule('0 * * * *', async () => {
            try {
                console.log('🔄 Auto-refreshing korea and japan cache...');
                await Promise.all([
                    this.newsService.getSectionFast('korea'),
                    this.newsService.getSectionFast('japan')
                ]);
                console.log('✅ Korea and Japan cache refreshed successfully');
            } catch (error) {
                console.error('❌ Failed to refresh asia cache:', error.message);
            }
        });

        // 매일 자정에 전체 캐시 클리어
        this.dailyClearJob = cron.schedule('0 0 * * *', async () => {
            try {
                console.log('🧹 Daily cache clear...');
                if (this.newsService.cache && this.newsService.cache.flushall) {
                    await this.newsService.cache.flushall();
                    console.log('✅ Daily cache clear completed');
                }
            } catch (error) {
                console.error('❌ Failed to clear daily cache:', error.message);
            }
        });

        console.log('✅ Cache scheduler started successfully');
        console.log('📅 Schedule:');
        console.log('  - World: Every 3 minutes');
        console.log('  - Tech: Every 5 minutes');
        console.log('  - Business: Every 10 minutes');
        console.log('  - Buzz: Every 15 minutes');
        console.log('  - Korea/Japan: Every hour');
        console.log('  - Full clear: Daily at midnight');
    }

    stop() {
        if (!this.isRunning) {
            console.log('Cache scheduler is not running');
            return;
        }

        console.log('Stopping cache scheduler...');
        
        if (this.worldRefreshJob) this.worldRefreshJob.stop();
        if (this.techRefreshJob) this.techRefreshJob.stop();
        if (this.businessRefreshJob) this.businessRefreshJob.stop();
        if (this.buzzRefreshJob) this.buzzRefreshJob.stop();
        if (this.asiaRefreshJob) this.asiaRefreshJob.stop();
        if (this.dailyClearJob) this.dailyClearJob.stop();

        this.isRunning = false;
        console.log('✅ Cache scheduler stopped');
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            jobs: {
                world: this.worldRefreshJob ? this.worldRefreshJob.running : false,
                tech: this.techRefreshJob ? this.techRefreshJob.running : false,
                business: this.businessRefreshJob ? this.businessRefreshJob.running : false,
                buzz: this.buzzRefreshJob ? this.buzzRefreshJob.running : false,
                asia: this.asiaRefreshJob ? this.asiaRefreshJob.running : false,
                dailyClear: this.dailyClearJob ? this.dailyClearJob.running : false
            }
        };
    }
}

module.exports = CacheScheduler;

