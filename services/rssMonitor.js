// RSS 피드 상태 모니터링 서비스
const { rssSources } = require('../config/rssSources');
const fetch = require('node-fetch');

class RSSMonitor {
    constructor() {
        this.feedStatus = {};
        this.lastCheck = null;
        this.checkInterval = 30 * 60 * 1000; // 30분마다 체크
    }

    async checkAllFeeds() {
        console.log('🔍 Starting RSS feed health check...');
        this.lastCheck = new Date();
        
        const results = {
            timestamp: this.lastCheck,
            totalFeeds: 0,
            workingFeeds: 0,
            brokenFeeds: 0,
            sections: {}
        };

        for (const [sectionName, feeds] of Object.entries(rssSources)) {
            console.log(`📡 Checking ${sectionName} section...`);
            
            const sectionResults = {
                total: feeds.length,
                working: 0,
                broken: 0,
                feeds: {}
            };

            for (const feed of feeds) {
                const status = await this.checkSingleFeed(feed);
                sectionResults.feeds[feed.name] = status;
                
                if (status.working) {
                    sectionResults.working++;
                    results.workingFeeds++;
                } else {
                    sectionResults.broken++;
                    results.brokenFeeds++;
                }
                
                results.totalFeeds++;
                
                // 요청 간격 조절 (서버 부담 방지)
                await this.delay(1000);
            }

            results.sections[sectionName] = sectionResults;
            console.log(`✅ ${sectionName}: ${sectionResults.working}/${sectionResults.total} working`);
        }

        this.feedStatus = results;
        
        console.log('📊 RSS Health Check Summary:');
        console.log(`  Total Feeds: ${results.totalFeeds}`);
        console.log(`  Working: ${results.workingFeeds} (${Math.round(results.workingFeeds/results.totalFeeds*100)}%)`);
        console.log(`  Broken: ${results.brokenFeeds} (${Math.round(results.brokenFeeds/results.totalFeeds*100)}%)`);
        
        return results;
    }

    async checkSingleFeed(feed) {
        const startTime = Date.now();
        
        try {
            const response = await fetch(feed.url, {
                method: 'HEAD',
                timeout: 10000,
                headers: {
                    'User-Agent': 'EmarkNews RSS Monitor/1.0'
                }
            });

            const responseTime = Date.now() - startTime;
            
            const status = {
                name: feed.name,
                url: feed.url,
                working: response.ok,
                statusCode: response.status,
                responseTime: responseTime,
                lastChecked: new Date(),
                error: null
            };

            if (!response.ok) {
                status.error = `HTTP ${response.status} ${response.statusText}`;
            }

            return status;

        } catch (error) {
            return {
                name: feed.name,
                url: feed.url,
                working: false,
                statusCode: null,
                responseTime: Date.now() - startTime,
                lastChecked: new Date(),
                error: error.message
            };
        }
    }

    getBrokenFeeds() {
        if (!this.feedStatus.sections) return [];
        
        const brokenFeeds = [];
        
        for (const [sectionName, section] of Object.entries(this.feedStatus.sections)) {
            for (const [feedName, feed] of Object.entries(section.feeds)) {
                if (!feed.working) {
                    brokenFeeds.push({
                        section: sectionName,
                        name: feedName,
                        url: feed.url,
                        error: feed.error,
                        statusCode: feed.statusCode
                    });
                }
            }
        }
        
        return brokenFeeds;
    }

    getWorkingFeeds() {
        if (!this.feedStatus.sections) return [];
        
        const workingFeeds = [];
        
        for (const [sectionName, section] of Object.entries(this.feedStatus.sections)) {
            for (const [feedName, feed] of Object.entries(section.feeds)) {
                if (feed.working) {
                    workingFeeds.push({
                        section: sectionName,
                        name: feedName,
                        url: feed.url,
                        responseTime: feed.responseTime
                    });
                }
            }
        }
        
        return workingFeeds;
    }

    getHealthSummary() {
        if (!this.feedStatus.timestamp) {
            return {
                status: 'never_checked',
                message: 'RSS feeds have never been checked'
            };
        }

        const timeSinceCheck = Date.now() - this.feedStatus.timestamp.getTime();
        const hoursAgo = Math.round(timeSinceCheck / (1000 * 60 * 60));
        
        const workingPercentage = Math.round(
            (this.feedStatus.workingFeeds / this.feedStatus.totalFeeds) * 100
        );

        let status = 'healthy';
        let message = `${workingPercentage}% of feeds working`;

        if (workingPercentage < 50) {
            status = 'critical';
            message = `Critical: Only ${workingPercentage}% of feeds working`;
        } else if (workingPercentage < 80) {
            status = 'warning';
            message = `Warning: ${workingPercentage}% of feeds working`;
        }

        return {
            status,
            message,
            workingFeeds: this.feedStatus.workingFeeds,
            totalFeeds: this.feedStatus.totalFeeds,
            workingPercentage,
            lastChecked: this.feedStatus.timestamp,
            hoursAgo
        };
    }

    startAutoCheck() {
        console.log('🚀 Starting automatic RSS monitoring...');
        
        // 즉시 한 번 체크
        this.checkAllFeeds();
        
        // 30분마다 자동 체크
        this.autoCheckInterval = setInterval(() => {
            this.checkAllFeeds();
        }, this.checkInterval);
        
        console.log('✅ RSS monitoring started (checks every 30 minutes)');
    }

    stopAutoCheck() {
        if (this.autoCheckInterval) {
            clearInterval(this.autoCheckInterval);
            this.autoCheckInterval = null;
            console.log('⏹️ RSS monitoring stopped');
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = RSSMonitor;

