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
당신은 세계 최고 수준의 전략 컨설팅 펌(McKinsey, BCG, Bain 급)의 시니어 파트너이자 글로벌 미디어 인텔리전스 전문가입니다. 

당신의 임무는 복잡한 뉴스 기사를 분석하여 C-레벨 경영진, 정책 결정자, 투자자들이 전략적 의사결정에 활용할 수 있는 '프리미엄 인텔리전스 브리핑'을 작성하는 것입니다.

당신의 분석은 다음 특징을 가져야 합니다:

🎯 전략적 관점: 단순한 사실 나열이 아닌, 비즈니스와 사회에 미치는 전략적 함의 분석
🔍 깊이 있는 통찰: 표면적 정보 너머의 숨겨진 패턴과 트렌드 발견
⚡ 실행 가능성: 독자가 즉시 활용할 수 있는 구체적이고 실용적인 인사이트
🌐 글로벌 맥락: 지역적 사건도 글로벌 트렌드와 연결하여 해석
📊 데이터 기반: 정량적 근거와 정성적 분석의 균형

핵심 원칙:
- Executive Summary 스타일: 바쁜 의사결정자를 위한 핵심 우선 구조
- 명료한 논리: 원인→결과→영향→전망의 명확한 인과관계
- 객관적 분석: 감정적 표현 배제, 팩트 기반 냉철한 판단
- 전문적 언어: 비즈니스 용어 활용하되 과도한 전문용어는 쉽게 설명
- 말줄임표(...) 절대 사용 금지
- 모든 문장은 완결된 형태로 작성
`;
  }

  buildUserMessage(article, detailed = false) {
    if (detailed) {
      return `
아래 뉴스 기사를 분석하여 프리미엄 인텔리전스 브리핑을 작성해주세요.

출력 형식:

🎯 EXECUTIVE SUMMARY
[전략적 제목]: 기사의 핵심을 꿰뚫는 비즈니스 관점의 새로운 제목
[한 줄 임팩트]: 이 뉴스가 시장/사회/정치에 미치는 핵심 영향을 한 문장으로 압축

📊 KEY FINDINGS (핵심 발견사항)
• 1차 임팩트: 직접적으로 발생하는 가장 중요한 변화나 사건
• 2차 파급효과: 1차 임팩트로 인해 연쇄적으로 발생할 수 있는 변화
• 숨겨진 시그널: 표면적으로 드러나지 않지만 주목해야 할 중요한 신호

🔍 STRATEGIC ANALYSIS (전략적 분석)
시장 맥락: 이 사건이 발생한 산업/시장/정치적 배경과 기존 트렌드와의 연관성
경쟁 구도 변화: 주요 플레이어들의 포지션 변화와 새로운 기회/위협 요소
리스크 & 기회: 단기(3-6개월), 중기(1-2년) 관점에서의 위험요소와 기회요소

🚀 FORWARD LOOKING (미래 전망)
시나리오 분석: 가능성 높은 2-3가지 시나리오와 각각의 확률적 평가
주목 포인트: 향후 6개월 내 모니터링해야 할 핵심 지표나 이벤트
전략적 시사점: 기업/투자자/정책결정자가 고려해야 할 구체적 액션 아이템

💡 INTELLIGENCE NOTES (인텔리전스 노트)
[핵심 용어/개념]: 비전문가도 이해할 수 있는 명확한 설명
[관련 트렌드]: 이 사건과 연결되는 글로벌 메가트렌드나 패턴
[데이터 포인트]: 주목할 만한 수치나 통계가 있다면 그 의미 해석

작성 지침:
- 영어 기사는 자연스러운 한국어로 번역하여 작성
- 한국어 기사는 한국어로 작성
- 컨설팅 리포트 스타일의 전문적이고 간결한 문체 사용
- 모든 항목을 빠짐없이 작성하되, 해당 없는 경우 "해당 없음" 표기
- 말줄임표(...) 절대 사용 금지
- 추측성 표현보다는 팩트 기반 분석 우선

[뉴스 기사 원문]
${article}
`;
    } else {
      return `
다음 뉴스 기사를 3개의 핵심 포인트로 요약해줘:
- 전략적 관점에서 간결하고 명확하게
- 비즈니스 임팩트 중심으로
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
    const isDetailed = options.detailed || false;
    const cacheKey = `summary:${isDetailed ? 'detailed:' : 'simple:'}${Buffer.from(text).toString('base64').substring(0, 32)}`;
    
    try {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return { success: true, data: { summary: cached } };
      }

      const summary = await this.queueTask(() => 
        this.summarizeArticleStreaming(text, { detailed: isDetailed })
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

