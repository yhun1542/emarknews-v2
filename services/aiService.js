const { OpenAI } = require('openai');
const logger = require('../utils/logger');
const CacheService = require('./cacheService');

class AIService {
  constructor() {
    this.client = null;
    this.cache = new CacheService();
    this.queue = [];
    this.processing = false;
    this.concurrency = 3; // 동시성 제어
    this.remainingRequests = 50; // 초기 추정값
    this.remainingTokens = 4000; // 초기 추정값
    this.deadLetterQueue = []; // 실패한 작업들
    
    if (process.env.OPENAI_API_KEY) {
      this.client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
    } else {
      logger.warn('OpenAI API key not configured');
    }

    // Start queue processor
    this.startQueueProcessor();
  }

  /** -------- 유틸: 지수 백오프 재시도 with Jitter -------- */
  async retryWithBackoff(fn, {
    retries = 4,
    baseDelayMs = 500,
    factor = 2,
    jitterRatio = 0.25,
    onRetry = () => {}
  } = {}) {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        attempt++;
        const status = err.status ?? err.code ?? "unknown";
        // 429, 5xx만 재시도
        if (attempt > retries || !(status === 429 || (Number(status) >= 500))) {
          throw err;
        }
        const delayBase = baseDelayMs * Math.pow(factor, attempt - 1);
        const jitter = delayBase * jitterRatio * (Math.random() * 2 - 1);
        const delay = Math.max(0, Math.round(delayBase + jitter));
        await onRetry({ attempt, delay, status, err });
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  /** -------- 유틸: AbortController로 타임아웃 제어 -------- */
  withTimeout(signal, timeoutMs) {
    if (!timeoutMs) return { signal };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
    const cleanup = () => clearTimeout(timeout);

    // 외부 signal과 연결(선택)
    if (signal) {
      if (signal.aborted) controller.abort("upstream-abort");
      signal.addEventListener("abort", () => controller.abort("upstream-abort"));
    }
    return { signal: controller.signal, cleanup };
  }

  /** -------- 프롬프트(요약 정책 고정) -------- */
  getSystemMessage() {
    return `
당신은 글로벌 미디어 인텔리전스 기업의 수석 애널리스트입니다. 당신의 주된 임무는 복잡한 뉴스 기사를 분석하여, 시간이 없는 비즈니스 리더와 전문가들이 핵심 내용과 그 이면의 의미를 5분 안에 파악할 수 있도록 '고농축 인사이트 리포트'를 작성하는 것입니다. 당신의 글은 명료하고, 객관적이며, 깊이 있는 통찰력을 담고 있어야 합니다.

핵심 원칙:
- 핵심 우선: 가장 중요한 정보를 먼저 제시
- 가독성: 짧고 명확한 문장 사용, 불렛 포인트(•) 활용
- 객관성과 분석의 분리: 사실 요약과 분석/전망 명확히 구분
- 용어 설명: 전문 용어는 독자 눈높이에 맞춰 쉽게 설명
- 말줄임표(...) 절대 사용 금지
`;
  }

  buildUserMessage(article, detailed = false) {
    if (detailed) {
      return `
아래 뉴스 기사를 분석하여 고농축 인사이트 리포트를 작성해주세요.

출력 형식:

[새로운 인사이트 제목]
기사의 핵심을 꿰뚫는, 창의적인 새로운 제목

한 줄 요약
이 뉴스를 한 문장으로 압축했을 때의 핵심 메시지

핵심 포인트 3가지
• 첫 번째 포인트: (기사에서 가장 중요한 첫 번째 사실 또는 사건)
• 두 번째 포인트: (그 사실로 인해 발생하는 두 번째 중요한 내용)
• 세 번째 포인트: (주목해야 할 세 번째 핵심 사항이나 통계)

상세 분석 및 전망 (So What?)
배경과 맥락: 이 뉴스가 왜 지금 나오게 되었는지, 이전 사건들과의 연관성
핵심 의미 분석: 해당 산업이나 사회에 미치는 단기적, 장기적 파급 효과
향후 전망: 이 사건으로 인해 예상되는 미래 변화와 주목할 관전 포인트

핵심 용어 및 개념 설명
[핵심 용어 1]: (독자가 어려워할 만한 첫 번째 용어를 비유나 예시로 쉽게 설명)
[핵심 용어 2]: (독자가 어려워할 만한 두 번째 용어를 비유나 예시로 쉽게 설명)

주의사항:
- 영어면 자연스러운 한국어 번역으로 작성
- 한국어면 한국어로 작성
- 직역 대신 한국 독자가 매끄럽게 이해할 수 있는 표현 사용
- 모든 항목을 빠짐없이 작성
- 말줄임표(...) 절대 사용 금지

[뉴스 기사 원문]
${article}
`;
    } else {
      return `
다음 뉴스 기사를 3개의 핵심 포인트로 요약해줘:
- 간결하고 명확하게
- 말줄임표(...) 사용 금지
- 영어면 한국어로 번역해서 요약

[기사 원문]
${article}
`;
    }
  }

  startQueueProcessor() {
    setInterval(() => {
      if (!this.processing && this.queue.length > 0) {
        this.processQueue();
      }
    }, 1000);
  }

  async processQueue() {
    if (this.queue.length === 0 || this.processing) return;
    
    this.processing = true;
    const batch = this.queue.splice(0, this.concurrency);
    
    try {
      await Promise.all(batch.map(task => this.executeTask(task)));
    } catch (error) {
      logger.error('Queue processing error:', error);
    } finally {
      this.processing = false;
    }
  }

  async executeTask(task) {
    try {
      const result = await task.fn();
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    }
  }

  async queueTask(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
    });
  }

  /** -------- 향상된 Chat Completions API 요약 -------- */
  async summarizeArticleStreaming(article, {
    model = "gpt-4.1-mini",
    timeoutMs = 60_000,
    retries = 4,
    detailed = false
  } = {}) {
    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    const startedAt = Date.now();
    const reqId = `req_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;

    logger.info(`summarize start - reqId: ${reqId}, model: ${model}, timeout: ${timeoutMs}ms`);

    const { signal, cleanup } = this.withTimeout(undefined, timeoutMs);

    try {
      const response = await this.retryWithBackoff(async () => {
        return await this.client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: this.getSystemMessage() },
            { role: "user", content: this.buildUserMessage(article, detailed) }
          ],
          temperature: 0.3,
          max_tokens: detailed ? 2000 : 1000,
        }, { signal });
      }, {
        retries,
        onRetry: ({ attempt, delay, status, err }) => {
          logger.warn(`retrying after error - reqId: ${reqId}, attempt: ${attempt}, delay: ${delay}ms, status: ${status}, error: ${String(err)}`);
        }
      });

      this.updateRateLimits(response.headers || {});

      const finalText = response.choices[0]?.message?.content?.trim();
      
      if (!finalText) {
        throw new Error('Empty response from OpenAI');
      }

      logger.info(`summarize done - reqId: ${reqId}, elapsed: ${Date.now() - startedAt}ms, response_id: ${response?.id}, textLength: ${finalText?.length || 0}`);

      return finalText;
    } finally {
      cleanup?.();
    }
  }

  // 기존 API 호환성을 위한 래퍼 메서드들
  async summarize(text, options = {}) {
    const cacheKey = `summary:${Buffer.from(text).toString('base64').substring(0, 32)}`;
    
    try {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return { success: true, data: { summary: cached } };
      }

      const summary = await this.queueTask(() => 
        this.summarizeArticleStreaming(text, { detailed: options.detailed || false })
      );

      // 캐시 저장 (1시간)
      await this.cache.set(cacheKey, summary, 3600);

      return {
        success: true,
        data: { summary }
      };
    } catch (error) {
      logger.error('Summarization failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async translate(text, targetLang = 'ko') {
    const cacheKey = `translate:${targetLang}:${Buffer.from(text).toString('base64').substring(0, 32)}`;
    
    try {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return { success: true, data: { translated: cached } };
      }

      if (!this.client) {
        throw new Error('OpenAI client not initialized');
      }

      const response = await this.retryWithBackoff(async () => {
        return await this.client.chat.completions.create({
          model: 'gpt-4.1-mini',
          messages: [
            {
              role: 'system',
              content: `You are a professional translator. Translate the following text to ${targetLang === 'ko' ? 'Korean' : targetLang}. Maintain the original meaning and tone. Do not add explanations.`
            },
            {
              role: 'user',
              content: text
            }
          ],
          temperature: 0.3,
          max_tokens: 2000
        });
      });

      this.updateRateLimits(response.headers || {});

      const translated = response.choices[0]?.message?.content?.trim();
      
      if (!translated) {
        throw new Error('Empty translation response');
      }

      // 캐시 저장 (1시간)
      await this.cache.set(cacheKey, translated, 3600);

      return {
        success: true,
        data: { translated }
      };
    } catch (error) {
      logger.error('Translation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async generateSummaryPoints(text, maxPoints = 5) {
    try {
      const result = await this.summarize(text, { detailed: true });
      if (!result.success) {
        return [];
      }

      // 응답에서 블릿포인트 추출
      const summary = result.data.summary;
      const lines = summary.split('\n').filter(line => line.trim());
      const points = [];

      for (const line of lines) {
        if (line.includes('•') || line.includes('-') || line.includes('*')) {
          const point = line.replace(/^[•\-*]\s*/, '').trim();
          if (point && points.length < maxPoints) {
            points.push(point);
          }
        }
      }

      return points.length > 0 ? points : [summary.substring(0, 200) + '...'];
    } catch (error) {
      logger.error('Summary points generation failed:', error);
      return ['요약 정보를 생성할 수 없습니다.'];
    }
  }

  updateRateLimits(headers) {
    if (headers) {
      this.remainingRequests = parseInt(headers['x-ratelimit-remaining-requests'] || this.remainingRequests);
      this.remainingTokens = parseInt(headers['x-ratelimit-remaining-tokens'] || this.remainingTokens);
    }
  }

  logOpenAIError(error, context) {
    if (error.response) {
      logger.error(`[OpenAI API Error - ${context}] Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
      if (error.response.status === 429) {
        logger.warn('OpenAI rate limit exceeded');
      }
    } else if (error.request) {
      logger.error(`[OpenAI API No Response - ${context}] Timeout or Network error: ${error.message}`);
    } else {
      logger.error(`[OpenAI API Request Setup Error - ${context}]: ${error.message}`);
    }
  }

  isKorean(text) {
    if (!text) return false;
    const koreanRegex = /[\uac00-\ud7a3]/g;
    const textLength = text.replace(/\s+/g, '').length;
    if (textLength === 0) return false;
    const koreanMatches = (text.match(koreanRegex) || []).length;
    return (koreanMatches / textLength) > 0.3; // 30% 이상이 한글이면 한국어로 간주
  }

  getStatus() {
    return {
      initialized: !!this.client,
      queueLength: this.queue.length,
      processing: this.processing,
      concurrency: this.concurrency,
      remainingRequests: this.remainingRequests,
      remainingTokens: this.remainingTokens,
      deadLetterQueueSize: this.deadLetterQueue.length
    };
  }
}

module.exports = AIService;

