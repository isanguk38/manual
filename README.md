# 더 플렌더 맥스 설명서 도우미 (API 키 없는 RAG)

미닉스 더 플렌더 맥스(MNFD-200G) 사용 설명서에 대해 질문하면 답해 주는 웹 앱입니다.
**API 키도, 서버 비용도 없습니다.** Render 무료 Static Site로 올려서 씁니다.

## 동작 방식

```
[사용자 질문]
   │
   ▼
① 검색 (브라우저, search.js)      설명서를 미리 잘라 둔 59개 조각(chunks.json)에서
                                   BM25(글자 2-gram)로 관련 조각 상위 4개를 찾음
   │
   ▼
② 답변 생성 (브라우저, WebLLM)     찾은 조각 + 질문을 사용자 기기 GPU에서 돌아가는
                                   소형 AI(Qwen)에 넣어 답변 생성 → 근거 페이지 표시
   │
   └─ AI를 못 쓰는 환경(WebGPU 미지원, 모바일 등)에서는 ①의 검색 결과만 보여줌
```

- Render는 파일(HTML/JS/JSON/PDF)만 전달합니다. AI 계산은 모두 **방문자의 브라우저**에서 일어납니다.
- 질문 내용은 어떤 서버로도 전송되지 않습니다.
- AI 모델은 처음 "AI 켜기"를 누를 때 Hugging Face에서 한 번 내려받고, 이후 브라우저에 캐시됩니다.

| 모델 | 다운로드 | GPU 메모리 | 비고 |
|---|---|---|---|
| 표준 · Qwen3.5 2B (기본) | 약 1GB | 약 2.2GB | 테스트 완료, 답변 2~4초 |
| 고품질 · Qwen3.5 4B | 약 2.3GB | 약 3.8GB | 품질은 더 좋지만 첫 다운로드가 큼 |
| 경량 · Qwen2.5 1.5B | 약 0.9GB | 약 1.5GB | 저사양용 |

> 참고: WebLLM 0.2.85의 Qwen3.5 설정에는 종료 토큰 ID 오류가 있어(" 내용"이 나오면 답변이 끊김)
> `app.js`에서 올바른 ID(248044, 248046)로 덮어쓰고 있습니다. WebLLM 버전을 올릴 때 확인하세요.

**AI 답변 지원 환경:** PC의 최신 Chrome / Edge (WebGPU 지원). 그 외 환경은 검색 모드로 동작합니다.

## 파일 구성

```
build_index.py      PDF → public/chunks.json 생성 (설명서가 바뀌면 다시 실행)
docs/manual.pdf     원본 설명서
public/             ← Render가 배포하는 폴더
  index.html, style.css
  app.js            화면 + WebLLM 연동
  search.js         한국어 BM25 검색
  chunks.json       설명서 조각 (build_index.py가 생성)
  manual.pdf        근거 페이지 링크용 원본
render.yaml         Render 설정 (Static Site)
```

## 로컬에서 실행

```bash
python -m http.server 8765 --directory public
```

브라우저에서 http://localhost:8765 접속.

## Render에 배포하기

1. 이 폴더를 GitHub 저장소로 올립니다.
   ```bash
   git init
   git add .
   git commit -m "Flender manual RAG"
   git branch -M main
   git remote add origin https://github.com/<내계정>/<저장소>.git
   git push -u origin main
   ```
2. https://dashboard.render.com → **New +** → **Blueprint** → 저장소 선택
   (`render.yaml`을 자동 인식합니다.)
   - Blueprint 대신 **Static Site**로 직접 만들 경우: Build Command는 비워두고, Publish Directory에 `public` 입력
3. 배포가 끝나면 `https://<이름>.onrender.com` 주소로 접속합니다.

Static Site는 Render 무료 플랜에 포함되며 절전(sleep)도 없습니다.

## 설명서를 교체/수정하려면

```bash
pip install pypdf
python build_index.py 새설명서.pdf
copy 새설명서.pdf public\manual.pdf
```

표 때문에 텍스트 순서가 뒤섞이는 페이지는 `build_index.py`의 `OVERRIDES`에 정리된 텍스트를 넣어 두었습니다
(현재 p.10 제품 사양, p.19 투입 금지 음식물, p.42 피해보상 표).
새 설명서에서는 페이지 번호에 맞게 `SKIP_PAGES`, `SECTIONS`, `OVERRIDES`를 조정하세요.
