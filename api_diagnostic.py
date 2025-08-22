import requests
import json

# --------------------------------------------------
# 👇 여기에 확인하고 싶은 API의 전체 URL을 입력하세요.
# --------------------------------------------------
API_URL = "https://emarknews-v2-production.up.railway.app/api/world/fast" # EmarkNews v2 세계 뉴스 API
# --------------------------------------------------


def check_api_status(url):
    """지정된 URL의 API 상태를 진단하는 함수"""
    
    print(f"🔍 '{url}'에 대한 진단을 시작합니다...")
    
    try:
        # 타임아웃을 5초로 설정하여 요청
        response = requests.get(url, timeout=5)
        
        # 1. HTTP 상태 코드 확인
        print(f"\n✅ 1. HTTP 상태 코드: {response.status_code}")
        if 200 <= response.status_code < 300:
            print("   (성공적인 응답입니다.)")
        elif response.status_code == 404:
            print("   (오류: 해당 API 엔드포인트를 찾을 수 없습니다. URL을 확인하세요.)")
        elif 400 <= response.status_code < 500:
            print("   (오류: 클라이언트 요청에 문제가 있습니다. 파라미터 등을 확인하세요.)")
        elif 500 <= response.status_code < 600:
            print("   (오류: 서버 측에 문제가 발생했습니다. 서버 로그를 확인해야 합니다.)")
        else:
            print("   (알 수 없는 상태 코드입니다.)")

        # 2. CORS 헤더 확인
        print("\n✅ 2. CORS 정책 헤더 확인")
        cors_header = response.headers.get('Access-Control-Allow-Origin')
        if cors_header:
            print(f"   - 'Access-Control-Allow-Origin' 헤더: {cors_header}")
            if cors_header == '*':
                print("     (모든 도메인에서의 요청을 허용하고 있습니다.)")
            else:
                print(f"     ('{cors_header}' 도메인만 요청이 허용됩니다.)")
        else:
            print("   - ❌ 'Access-Control-Allow-Origin' 헤더가 응답에 없습니다.")
            print("     (이것이 프론트엔드에서 데이터를 받지 못하는 주된 원인일 수 있습니다!)")
            
        # 3. 응답 데이터 형식 확인
        print("\n✅ 3. 응답 데이터 형식 확인")
        try:
            data = response.json()
            print("   - 응답 데이터는 유효한 JSON 형식입니다.")
            print(f"   - 미리보기: {json.dumps(data, indent=2, ensure_ascii=False)[:500]}...")
        except json.JSONDecodeError:
            print("   - ❌ 응답 데이터가 JSON 형식이 아닙니다. 서버 응답을 확인하세요.")
            print(f"   - 실제 응답 내용 (앞부분): {response.text[:300]}...")


    except requests.exceptions.Timeout:
        print("\n❌ 오류: 요청 시간이 초과되었습니다. 서버가 응답하지 않거나 네트워크에 문제가 있을 수 있습니다.")
    except requests.exceptions.RequestException as e:
        print(f"\n❌ 오류: 요청 중 문제가 발생했습니다. - {e}")
    except Exception as e:
        print(f"\n❌ 알 수 없는 오류가 발생했습니다. - {e}")


if __name__ == "__main__":
    check_api_status(API_URL)

