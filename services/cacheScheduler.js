// 자동 캐시 갱신 스케줄러
const cron = require('node-cron');
const NewsServiceCronOnly = require('./newsService_cron_only');

class CacheScheduler {
  constructor(newsService, io = null) {
    this.newsService = newsService;
    this.cronService = new NewsServiceCronOnly(newsService); // 크론 전용 서비스
    this.io = io; // WebSocket for real-time updates
    this.isRunning = false;
    this.logger = newsService.logger;
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
                await this.cronService.collectAndCacheNews('world');
                console.log('✅ World cache refreshed successfully');
                
                // WebSocket으로 클라이언트에 알림
                if (this.io) {
                    console.log(`📡 Sending WebSocket event for section: world`);
                    this.io.emit('cache-updated', {
                        section: 'world',
                        message: 'World news updated',
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (error) {
                console.error('❌ Failed to refresh world cache:', error.message);
            }
        }, {
            scheduled: false  // 자동 시작 비활성화
        });
        this.worldRefreshJob.start();  // 명시적 시작
        console.log('✅ World refresh job started');

        // 매 5분마다 tech 섹션 캐시 갱신
        this.techRefreshJob = cron.schedule('*/5 * * * *', async () => {
            try {
                console.log('🔄 Auto-refreshing tech cache...');
                await this.cronService.collectAndCacheNews('tech');
                console.log('✅ Tech cache refreshed successfully');
                
                // WebSocket으로 클라이언트에 알림
                if (this.io) {
                    console.log(`📡 Sending WebSocket event for section: tech`);
                    this.io.emit('cache-updated', {
                        section: 'tech',
                        message: 'Tech news updated',
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (error) {
                console.error('❌ Failed to refresh tech cache:', error.message);
            }
        }, {
            scheduled: false  // 자동 시작 비활성화
        });
        this.techRefreshJob.start();  // 명시적 시작
        console.log('✅ Tech refresh job started');

        // 매 10분마다 business 섹션 캐시 갱신
        this.businessRefreshJob = cron.schedule('*/10 * * * *', async () => {
            try {
                console.log('🔄 Auto-refreshing business cache...');
                await this.cronService.collectAndCacheNews('business');
                console.log('✅ Business cache refreshed successfully');
                
                // WebSocket으로 클라이언트에 알림
                if (this.io) {
                    console.log(`📡 Sending WebSocket event for section: business`);
                    this.io.emit('cache-updated', {
                        section: 'business',
                        message: 'Business news updated',
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (error) {
                console.error('❌ Failed to refresh business cache:', error.message);
            }
        }, {
            scheduled: false  // 자동 시작 비활성화
        });
        this.businessRefreshJob.start();  // 명시적 시작
        console.log('✅ Business refresh job started');

        // 매 15분마다 buzz 섹션 캐시 갱신
        this.buzzRefreshJob = cron.schedule('*/15 * * * *', async () => {
            try {
                console.log('🔄 Auto-refreshing buzz cache...');
                await this.cronService.collectAndCacheNews('buzz');
                console.log('✅ Buzz cache refreshed successfully');
                
                // WebSocket으로 클라이언트에 알림
                if (this.io) {
                    console.log(`📡 Sending WebSocket event for section: buzz`);
                    this.io.emit('cache-updated', {
                        section: 'buzz',
                        message: 'Buzz news updated',
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (error) {
                console.error('❌ Failed to refresh buzz cache:', error.message);
            }
        }, {
            scheduled: false  // 자동 시작 비활성화
        });
        this.buzzRefreshJob.start();  // 명시적 시작
        console.log('✅ Buzz refresh job started');

        // 매 시간마다 korea, japan 섹션 캐시 갱신
        this.asiaRefreshJob = cron.schedule('0 * * * *', async () => {
            try {
                console.log('🔄 Auto-refreshing Korea and Japan cache...');
                await Promise.all([
                    this.cronService.collectAndCacheNews('kr'),
                    this.cronService.collectAndCacheNews('japan')
                ]);
                console.log('✅ Korea and Japan cache refreshed successfully');
                
                // WebSocket으로 클라이언트에 알림
                if (this.io) {
                    console.log(`📡 Sending WebSocket event for section: kr`);
                    this.io.emit('cache-updated', {
                        section: 'kr',
                        message: 'Korea news updated',
                        timestamp: new Date().toISOString()
                    });
                    console.log(`📡 Sending WebSocket event for section: japan`);
                    this.io.emit('cache-updated', {
                        section: 'japan',
                        message: 'Japan news updated',
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (error) {
                console.error('❌ Failed to refresh Korea/Japan cache:', error.message);
            }
        }, {
            scheduled: false  // 자동 시작 비활성화
        });
        this.asiaRefreshJob.start();  // 명시적 시작
        console.log('✅ Asia refresh job started');

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
        }, {
            scheduled: false  // 자동 시작 비활성화
        });
        this.dailyClearJob.start();  // 명시적 시작
        console.log('✅ Daily clear job started');

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
                world: this.worldRefreshJob ? this.worldRefreshJob.getStatus() : 'not created',
                tech: this.techRefreshJob ? this.techRefreshJob.getStatus() : 'not created',
                business: this.businessRefreshJob ? this.businessRefreshJob.getStatus() : 'not created',
                buzz: this.buzzRefreshJob ? this.buzzRefreshJob.getStatus() : 'not created',
                asia: this.asiaRefreshJob ? this.asiaRefreshJob.getStatus() : 'not created',
                dailyClear: this.dailyClearJob ? this.dailyClearJob.getStatus() : 'not created'
            }
        };
    }
}

module.exports = CacheScheduler;

