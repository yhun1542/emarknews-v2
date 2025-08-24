const axios = require('axios');
const logger = require('../utils/logger');

class AIService {
  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.cache = new Map();
    this.requestCount = 0;
    this.maxRequestsPerMinute = 50;
    this.lastResetTime = Date.now();
  }

  // [리팩토링됨] 안정성 강화: 예외 발생 없이 항상 결과를 반환하도록 구조 변경
  async translateToKorean(text) {
    if (!text || text.trim().length === 0) return '';
    
    // 1. 입력값 검사: 이미 한국어인지 확인 (엄격한 기준 40% 적용)
    if (this.isKorean(text, 0.4)) return text;
    
    const cacheKey = `translate:${text.substring(0, 100)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    if (!this.openaiApiKey) {
        return text;
    }

    // 2. AI 번역 시도 (내부적으로 재시도 처리, 실패 시 null 반환)
    const translated = await this.translateWithOpenAI(text);

    // 3. 결과 검증 및 처리 (예외 발생 없음)
    if (translated) {
        // AI가 결과를 반환했지만 유효한지 확인
        // 기준: 원문과 다르고, 한국어 검사를 통과해야 함 (완화된 기준 10% 적용)
        if (translated !== text && this.isKorean(translated, 0.1)) {
            // 성공: 캐시 저장 및 결과 반환
            this.cache.set(cacheKey, translated);
            
            // Limit cache size
            if (this.cache.size > 1000) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }
            return translated;
        } else {
            // 실패 (검증 오류): 경고 기록 및 폴백 반환
            logger.warn('AI translation validation failed (Result might be non-Korean or identical to input). Returning fallback.');
            return text;
        }
    } else {
        // 실패 (API 오류 또는 Rate Limit): 경고 기록 및 폴백 반환
        // (callOpenAI 내부에서 이미 로깅됨)
        logger.warn('AI translation process failed after retries or skipped. Returning fallback.');
        return text;
    }
  }

  // [리팩토링됨] 범용 API 호출 함수 사용
  async translateWithOpenAI(text, retries = 2) {
    const systemMessage = `당신은 전문적인 다국어 뉴스 번역가입니다. 주어진 텍스트의 언어(주로 영어 또는 일본어)를 자동으로 감지하고, 이를 자연스럽고 정확한 한국어로 번역하세요. 
IT, 기술(Tech), 비즈니스(Biz), 버즈(Buzz) 분야의 뉴스를 다룹니다. 전문 용어와 고유명사(인명, 지명, 회사명)는 한국어 표준 표기법에 맞게 정확히 번역해야 합니다. 
원문의 톤과 뉘앙스를 최대한 보존해주세요.`;

    const config = {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: `Translate the following news text into Korean:\n\n${text}` }
        ],
        max_tokens: 800,
        temperature: 0.3
    };

    // 안정화된 범용 API 호출 함수 사용
    return this.callOpenAI(config, 'Translation', retries);
  }

  // [추가됨] OpenAI API 호출 및 재시도를 처리하는 범용 함수 (핵심 안정화 로직)
  async callOpenAI(config, context, retries = 2) {
    // 총 시도 횟수 = 첫 시도(1) + 재시도 횟수(retries)
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
        try {
            // 매 시도 전 Rate limiting 확인
            if (!this.canMakeRequest()) {
                logger.warn(`[${context}] Rate limit exceeded before attempt ${attempt}. Aborting.`);
                return null; // 즉시 중단하고 null 반환
            }

            const response = await axios.post('https://api.openai.com/v1/chat/completions', config, {
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 20000 // 20초 타임아웃
            });

            this.requestCount++;

            const content = response.data.choices[0]?.message?.content?.trim();

            if (!content) {
                // 내용이 비어있으면 실패로 간주하고 재시도 루프 진행
                throw new Error('Empty response from OpenAI');
            }

            if (response.data.choices[0].finish_reason === 'length') {
                logger.warn(`[${context}] Content potentially truncated due to max_tokens limit.`);
            }

            return content; // 성공 시 결과 반환 및 루프 종료 

        } catch (error) {
            // API 호출 실패 또는 빈 응답 처리
            this.logOpenAIError(error, `${context} (Attempt ${attempt})`);

            // 재시도 횟수가 남았으면 대기
            if (attempt <= retries) {
                let delay = attempt * 1000; // 1초, 2초 지연 (지수 백오프)
                
                // 429 (Too Many Requests) 발생 시 더 길게 대기
                if (error.response?.status === 429) {
                    delay += 5000;
                }

                logger.info(`[${context}] Retrying after ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                
            } else {
                // 모든 시도 실패
                logger.error(`[${context}] All attempts failed.`);
                return null; // 최종 실패 시 null 반환
            }
        }
    }
    return null;
  }


  // [개선됨] 한국어 감지 로직: 임계값 파라미터화 및 정확도 향상
  // threshold 기본값은 0.4 (40%)
  isKorean(text, threshold = 0.4) {
    if (!text) return false;
    const koreanRegex = /[\uac00-\ud7a3]/; // 완성형 한글 범위 

    // 한국어가 전혀 없으면 즉시 false 반환
    if (!koreanRegex.test(text)) return false;

    // 분석 대상 문자 길이 계산 (공백/특수문자 제외, 영문/숫자/한글만 포함)
    // 이는 테크/비즈니스 뉴스에 영문과 숫자가 많은 특성을 반영합니다.
    const relevantText = text.replace(/[^a-zA-Z0-9\uac00-\ud7a3]/g, '');
    const textLength = relevantText.length;

    if (textLength === 0) return false;

    // 텍스트 내 한국어 문자 수 계산
    const koreanMatches = (relevantText.match(new RegExp(koreanRegex, 'g')) || []).length;
    
    // 임계값(threshold)과 비교
    return (koreanMatches / textLength) >= threshold;
  }

  // [수정됨] 요약 함수 안정성 강화
  async generateSummaryPoints(text, maxPoints = 3) {
    if (!text || text.trim().length === 0) return ['내용 없음'];

    // 입력 텍스트가 한국어인지 확인 (기본 40% 기준)
    if (!this.isKorean(text)) {
        logger.warn('AI Summary generation skipped: Input text is not Korean. Using fallback.');
        return this.extractKeySentences(text, maxPoints);
    }

    if (!this.openaiApiKey) {
        return this.extractKeySentences(text, maxPoints);
    }

    // 안정화된 AI 호출 방식 사용 (실패 시 null 반환)
    const points = await this.generateSummaryWithOpenAI(text, maxPoints);

    if (points && points.length > 0) {
        return points;
    } else {
        // AI 실패 시 폴백 사용
        return this.extractKeySentences(text, maxPoints);
    }
  }

  // [수정됨] JSON 응답을 사용하도록 리팩토링된 함수
  async generateSummaryWithOpenAI(text, maxPoints, retries = 2) {
    const config = {
        model: 'gpt-3.5-turbo-1106', // [수정됨] JSON mode를 지원하는 모델 버전 명시
        response_format: { type: "json_object" }, // [추가됨] OpenAI의 JSON 모드 활성화
        messages: [
          {
            role: 'system',
            // [수정됨] JSON 형식으로 응답하도록 프롬프트 수정
            content: `당신은 뉴스 요약 전문가입니다. 주어진 뉴스 내용을 ${maxPoints}개의 핵심 포인트로 요약해주세요. 각 포인트는 한 줄로, 중요한 사실과 숫자를 포함해야 합니다. 결과는 반드시 'points'라는 키를 가진 JSON 객체 안에 문자열 배열 형태로 반환하세요. 예시: {"points": ["첫 번째 핵심 요약입니다.", "두 번째 핵심 요약입니다."]}.`
          },
          {
            role: 'user',
            content: `다음 뉴스를 ${maxPoints}개의 핵심 포인트로 요약해주세요:\n\n${text}`
          }
        ],
        max_tokens: 600,
        temperature: 0.3
    };

    const content = await this.callOpenAI(config, 'Summary Points', retries);
    if (!content) return null;
      
    try {
      // [수정됨] 문자열 파싱 대신 안전한 JSON 파싱 사용
      const parsed = JSON.parse(content);

      // [수정됨] 결과가 예상된 구조인지 확인
      if (Array.isArray(parsed.points) && parsed.points.length > 0) {
        return parsed.points
          .map(point => String(point).trim()) // 각 포인트가 문자열인지 확인하고 공백 제거
          .filter(point => point.length > 10)
          .slice(0, maxPoints);
      } else {
        logger.warn('AI summary response parsed, but the "points" array is missing or empty.');
        return null;
      }
    } catch (error) {
      logger.error(`Failed to parse JSON summary from OpenAI: ${error.message}`);
      return null;
    }
  }

  // extractKeySentences (일본어 구두점 포함)
  extractKeySentences(text, maxPoints) {
    if (!text) return ['내용 없음'];

    const sentences = text
      .split(/[.!?。]+/)
      .map(s => s.trim())
      .filter(s => s.length > 20);

    if (sentences.length === 0) {
      return [text.substring(0, 100) + '...'];
    }

    return sentences.slice(0, maxPoints).map(s => {
      if (s.length > 150) {
        return s.substring(0, 150) + '...';
      }
      return s;
    });
  }

  // generateDetailedSummary (안정성 강화 적용)
  async generateDetailedSummary(article) {
    if (!article || (!article.content && !article.description)) return '';

    const contentText = article.content || article.description || '';

    if (!this.openaiApiKey) {
        return this.processContent(contentText);
    }

    // 안정화된 AI 호출 방식 사용
    const summary = await this.generateDetailedSummaryWithOpenAI(article);

    if (summary) {
        return summary;
    } else {
        // AI 실패 시 폴백 사용
        return this.processContent(contentText);
    }
  }

  // [리팩토링됨] 범용 API 호출 함수 사용
  async generateDetailedSummaryWithOpenAI(article, retries = 2) {
    const config = {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: '​# 1. 역할 부여 (Persona)\n당신은 글로벌 미디어 인텔리전스 기업의 수석 애널리스트입니다. 당신의 주된 임무는 복잡한 뉴스 기사를 분석하여, 시간이 없는 비즈니스 리더와 전문가들이 핵심 내용과 그 이면의 의미를 5분 안에 파악할 수 있도록 \'고농축 인사이트 리포트\'를 작성하는 것입니다. 당신의 글은 명료하고, 객관적이며, 깊이 있는 통찰력을 담고 있어야 합니다.\n​# 2. 핵심 목표 (Objective)\n아래 [입력 정보]에 제공된 뉴스 기사를 바탕으로, [출력 형식]에 맞춰 체계적인 \'뉴스
