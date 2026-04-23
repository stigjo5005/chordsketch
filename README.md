# ChordSketch

오디오 파일이나 유튜브 링크를 넣으면 멜로디, 기타 코드, 간단 오선보를 만들어주는 반응형 웹앱입니다.

## 실행

```bash
python server.py
```

브라우저에서 `http://127.0.0.1:8000` 으로 접속하면 됩니다.

## 주요 기능

- 모바일 / PC 반응형 화면
- 오디오 파일 업로드 분석
- `yt-dlp` 기반 유튜브 링크 오디오 다운로드
- 멜로디 노트 표
- 시간대별 코드 진행
- 간단 오선보 표시
- 구간 요약 표시
- 텍스트 복사, 인쇄용 보기, PDF 저장
- 오선보 PNG 이미지 저장
- OpenAI 기반 선택형 AI 보정

## 배포용 파일

- `Dockerfile`
- `render.yaml`
- `railway.toml`
- `Procfile`
- `.env.example`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-render.yml`
- `.github/workflows/deploy-railway.yml`

## 환경변수

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5.4-mini
HOST=0.0.0.0
PORT=8000
```

- `OPENAI_API_KEY`를 넣으면 AI 보정 버튼이 동작합니다.
- `OPENAI_MODEL` 기본값은 `gpt-5.4-mini`입니다.

## 헬스체크

- `GET /health`

응답에는 서버 상태와 AI 보정 기능 사용 가능 여부가 포함됩니다.

## Render 배포

1. GitHub 저장소를 Render에 연결합니다.
2. `Web Service`를 만들고 Docker 배포를 선택합니다.
3. 환경변수에 `OPENAI_API_KEY`를 넣습니다.
4. `render.yaml`의 `healthCheckPath: /health`를 사용하거나 대시보드에서 동일하게 설정합니다.

## Railway 배포

1. 저장소를 Railway에 연결하거나 `railway up`을 실행합니다.
2. 루트의 `Dockerfile`과 `railway.toml`이 자동으로 사용되도록 둡니다.
3. Variables에 `OPENAI_API_KEY`를 넣습니다.
4. 배포 후 `/health`로 상태를 확인합니다.

## GitHub Actions 자동화

### 기본 검증

- `main` 또는 `master` 브랜치 푸시
- Pull Request 생성

위 경우 `.github/workflows/ci.yml`이 실행되어 서버 문법, import, 배포 파일 존재 여부를 검사합니다.

### Render 자동 배포

1. Render에서 Deploy Hook URL을 발급합니다.
2. GitHub 저장소의 Secrets에 `RENDER_DEPLOY_HOOK_URL`을 추가합니다.
3. `main` 또는 `master`에 푸시하면 `.github/workflows/deploy-render.yml`이 Render 배포를 트리거합니다.

### Railway 수동 배포

1. GitHub 저장소의 Secrets에 `RAILWAY_TOKEN`과 `RAILWAY_SERVICE`를 추가합니다.
2. GitHub Actions에서 `Deploy Railway` 워크플로를 수동 실행합니다.

`RAILWAY_SERVICE`에는 Railway 서비스 이름을 넣으면 됩니다.

## 참고

- 분석은 빠른 사용을 위해 앞 90초를 기준으로 동작합니다.
- 복잡한 밴드 믹스보다 멜로디가 또렷한 곡에서 더 잘 맞습니다.
- 결과는 정식 채보가 아니라 연습용 스케치 수준의 추정본입니다.
